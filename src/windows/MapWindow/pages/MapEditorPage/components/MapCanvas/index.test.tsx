import { StrictMode } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORLD_LAYER_ORDER, worldLayerIndexOf, type WorldLayerName } from "./layers";

/**
 * MapCanvas 的 Pixi 生命周期回归测试。
 *
 * ── 真实缺陷 ──
 * 报错：`Uncaught TypeError: this._cancelResize is not a function`
 *   at _Application.destroy (pixi.js)
 *   at index.tsx:140  ← MapCanvas 初始化 effect 的 cleanup
 *
 * 根因链：
 *   1. Pixi v8 的 `Application.init()` 是 **async**，内部先
 *      `await autoDetectRenderer()`，**之后**才逐个执行插件 `init`；
 *      而 `ResizePlugin.init` 正是那个给 `this._cancelResize` 赋值的插件。
 *   2. `ResizePlugin.destroy()` 里无条件调用 `this._cancelResize()`。
 *   3. React 19 StrictMode 在开发模式下把 effect 跑成
 *      「挂载 → 卸载 → 再挂载」。第一次卸载时 `init()` 可能仍在 await 窗口内，
 *      此时 cleanup 调 `instance.destroy()` → 插件字段尚为 undefined → TypeError，
 *      且异常发生在 cleanup 里会连累后续渲染，表现为画布一直空白。
 *
 * 修复：在 effect 内用 `initDone` / `destroyPending` 记录状态 ——
 *   init 未完成时收到的卸载请求只置位、不销毁，等 init 完成后自行销毁。
 *
 * 本测试用「init 未 resolve 前 destroy 即抛错」的假 Application 复现该时序，
 * 把「init 完成前不得 destroy」这条不变量钉死在行为层面。
 */

/** 手动可控的 deferred：让测试精确掌握 init 何时 resolve */
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 本次渲染期间创建的假 Application 实例 */
interface FakeApp {
  init: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  canvas: HTMLCanvasElement;
  /** `stage` 只挂一个 `world` —— 选中框用例要沿着它往下找到 overlay */
  stage: { children: unknown[]; addChild: ReturnType<typeof vi.fn> };
}

/** 本次渲染期间创建的全部假精灵 —— 用于断言"它挂在哪个容器下、那个容器多透明" */
interface FakeSpriteRef {
  width: number;
  height: number;
  parent: FakeContainerRef | null;
  /** 缩放（P1-4 镜像翻转写的就是 scale.x 的符号，断言读回方向用） */
  scale: { x: number; y: number };
  /** 每次 position.set 的落点（翻转不位移 / 移动同步探针） */
  positionCalls: Array<[number, number]>;
}
interface FakeContainerRef {
  alpha: number;
  children: unknown[];
}

/**
 * 按**名字**取 world 的子图层。
 *
 * 【为什么不再用 `children.at(-1)` / `children[4]`】那些是把 z 序抄成了魔数：
 * T5 在 overlay 之后加了 `draftLayer`，`at(-1)` 就悄悄指向了草稿层 ——
 * 断言会红，而红的原因是"图层数变了"，读起来像新功能写错（架构 §6-1）。
 * 顺序的唯一定义处是 `layers.ts` 的 `WORLD_LAYER_ORDER`。
 */
function layerOf(world: FakeContainerRef, name: WorldLayerName): unknown {
  return world.children[worldLayerIndexOf(name)];
}
/** 假 Graphics：`rects` / `polys` / `fills` 记录画过的矩形、多边形与填充（高亮分级断言用） */
interface FakeGraphicsRef {
  rects: number[][];
  polys: number[][];
  fills: unknown[];
  /** 草稿顶点圈探针（`circle(x,y,r)` 的参数） */
  circles: number[][];
  /** `poly()` 之外的绘制：草稿折线与虚线走 moveTo/lineTo */
  moveCount: number;
  lineCount: number;
  /** 每次 `stroke(options)` —— 数"这一层被画了几笔" */
  strokes: unknown[];
  /**
   * `clear()` 的累计次数（**不清零**）。
   *
   * 【为什么必须要这个探针】"这一层被重画了"不能只看 `strokes.length`：
   * 草稿层每次重画都是 `clear()` + 重新落笔，落笔笔数是个常数，**首帧**画过之后
   * 就恒 > 0。于是"指针移动到底有没有重画草稿层"用 `strokes.length > 0` 是问不出来的
   * —— QA 实测把 `pointermove` 里的 `drawDraftRef.current()` 整行删掉，那条
   * 「性能守卫」照样绿（首帧的笔数把它撑住了）。累计 `clear()` 次数才能区分
   * "画过一次" 与 "每一帧都在重画"。
   */
  clearCount: number;
}

let apps: FakeApp[] = [];
let sprites: FakeSpriteRef[] = [];
/** 本次渲染/构建期间创建的假 Graphics —— 区块填充/描边 alpha 的行为级断言读它 */
let graphics: FakeGraphicsRef[] = [];
/** init 调用是否已完成；未完成时 destroy 复刻真实插件的抛错行为 */
let initSettled = false;

vi.mock("pixi.js", () => {
  class FakeContainer {
    children: unknown[] = [];
    parent: FakeContainer | null = null;
    /** 容器透明度：素材层靠它做层级交叉淡化 */
    alpha = 1;
    /** 剔除写的就是它 */
    visible = true;
    /** 风格滤镜挂载点 */
    filters: unknown[] = [];
    addChild(...kids: unknown[]) {
      for (const kid of kids) {
        const child = kid as FakeContainer;
        child.parent?.removeChild(child);
        child.parent = this;
        this.children.push(kid);
      }
      return kids[0];
    }
    removeChild(child?: unknown) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      if (child) (child as FakeContainer).parent = null;
    }
    destroy() {}
    scale = { set: vi.fn() };
    position = { set: vi.fn() };
    /**
     * 剔除读的**局部**包围盒（与视口无关，可缓存）：原点零矩形 ⇒ 与含原点的
     * 视野框恒相交 ⇒ 默认不剔任何层。本文件断言的是"素材挂在哪个层级容器、
     * 容器多透明"，剔除不该插手；剔除自身的行为在 `cull.test.ts` 里测。
     */
    getLocalBounds() {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
    /** 局部 → 舞台：jsdom 无真实变换，恒等即可 */
    toGlobal(point: { x: number; y: number }) {
      return { x: point.x, y: point.y };
    }
    /** 静态层缓存（jsdom 无 WebGL）：只记"调过" */
    cacheAsTexture = vi.fn();
    updateCacheTexture = vi.fn();
  }

  class FakeSprite extends FakeContainer {
    anchor = { set: vi.fn() };
    width = 0;
    height = 0;
    rotation = 0;
    texture: unknown = null;
    /**
     * 缩放带可读写的 x/y：P1-4 镜像翻转写的就是 `scale.x` 的符号
     * （父类只有 noop 的 `set`，读不回方向）。
     */
    scale = { x: 1, y: 1, set: vi.fn() };
    /** 每次 `position.set` 的参数落点：钉"翻转不位移 / 移动后落位正确"用 */
    positionCalls: Array<[number, number]> = [];
    position = {
      set: vi.fn((x: number, y: number) => {
        this.positionCalls.push([x, y]);
      }),
    };
    constructor() {
      super();
      sprites.push(this as unknown as FakeSpriteRef);
    }
  }

  class FakeGraphics extends FakeContainer {
    /**
     * 每次 `rect(x, y, w, h)` 的参数。
     *
     * 选中框是画在 overlay 这个 Graphics 上的**唯一**东西，所以 `rects.at(-1)`
     * 就是"当前选中框的宽高" —— 这是在不真渲一张图的条件下，唯一能钉住
     * "选中框尺寸也必须乘层级因子"的探针（漏乘时它会变成视觉尺寸的 8 倍）。
     */
    rects: number[][] = [];
    /**
     * 每次 `poly(points)` 的顶点数组。
     *
     * 【为什么也要记】区块选中高亮是画在 overlay 上的**多边形**（不是矩形），
     * 断言"点了区块画面上确实多了一笔画"只能靠它。用户报障就是"点区块没有
     * 任何反馈"，这条探针直接对着那个缺陷。
     */
    polys: number[][] = [];
    /**
     * 每次 `fill(options)` 的参数。
     *
     * 【为什么需要】R-REG-05 的判据是"非叶子选中时**不铺面**"，而"铺面"在
     * Graphics 上就是一次 `fill()`。只数 `poly()` 笔数分不清"一笔填充"与
     * "一笔描边"——叶子三笔里第一笔就是填充，两者 polys 都是 3 与 1 的差别
     * 掩盖了真正的语义。这里把 `fill()` 单独记一笔，断言 `fills.length === 0`。
     */
    fills: unknown[] = [];
    /**
     * 每次 `circle(x, y, r)` 的参数。
     *
     * 【为什么单独一个探针】草稿顶点是**圆点**（`circle`），不是多边形 ——
     * 用 `polys` 数不到它们。T5 要断言"每个已落点都有一个顶点圈"，只能靠它。
     */
    circles: number[][] = [];
    /** `moveTo` / `lineTo` 的累计次数：草稿折线与预览虚线走这两个（不走 `poly`） */
    moveCount = 0;
    lineCount = 0;
    /** 每次 `stroke(options)`：数"这一层被画了几笔"（`clear()` 之后重新计数） */
    strokes: unknown[] = [];
    /** 累计 `clear()` 次数（不清零）：用来区分"画过一次"与"每帧重画" */
    clearCount = 0;
    clear() {
      // 与真实 Graphics 一致：clear() 会把之前画的全丢掉
      this.clearCount += 1;
      this.rects.length = 0;
      this.polys.length = 0;
      this.fills.length = 0;
      this.circles.length = 0;
      this.strokes.length = 0;
      this.moveCount = 0;
      this.lineCount = 0;
    }
    rect(x: number, y: number, w: number, h: number) {
      this.rects.push([x, y, w, h]);
      return this;
    }
    poly(points: number[]) {
      this.polys.push(points);
      return this;
    }
    fill(options?: unknown) {
      this.fills.push(options);
      return this;
    }
    stroke(options?: unknown) {
      this.strokes.push(options);
      return this;
    }
    circle(x: number, y: number, r: number) {
      this.circles.push([x, y, r]);
      return this;
    }
    moveTo() {
      this.moveCount += 1;
      return this;
    }
    lineTo() {
      this.lineCount += 1;
      return this;
    }
    /** 收集实例：子图区块的 fill/stroke 参数只能从建出来的 Graphics 上读回 */
    constructor() {
      super();
      graphics.push(this as unknown as FakeGraphicsRef);
    }
  }

  class Application {
    canvas = document.createElement("canvas");
    stage = new FakeContainer();
    /**
     * 渲染器替身：烘焙 effect 会调 `renderer.render({container, target, clear})`。
     * 不建模任何真实渲染 —— 这里只需要"它被调用过"这一事实。
     */
    renderer = { render: vi.fn() };
    init = vi.fn(async () => {
      // 模拟 await autoDetectRenderer()：此刻插件字段（_cancelResize）尚不存在
      await initDeferred.promise;
      initSettled = true;
    });
    destroy = vi.fn(() => {
      // 复刻 ResizePlugin.destroy() 在插件未 init 时的崩溃
      if (!initSettled) {
        throw new TypeError("this._cancelResize is not a function");
      }
    });
    constructor() {
      apps.push(this as unknown as FakeApp);
    }
  }

  /**
   * RenderTexture 替身。
   *
   * 【为什么必须在这里补】`vi.mock` 的工厂**缺导出会在 import 阶段直接抛错**
   * （不是"取到 undefined"）。coastBake.ts 在模块顶层就 import 了它，
   * 因此只要 MapCanvas 引入海岸烘焙，这个导出就必须存在 ——
   * 否则 5 个既有用例会集体在 import 阶段红，且报错指向 mock 工厂，
   * 极易被误判成"测试环境问题"。
   */
  class RenderTexture {
    /** 记录每次烘焙的参数，供断言"同指纹不重建" */
    static create = vi.fn((options: { width: number; height: number }) => ({
      ...options,
      destroy: vi.fn(),
    }));
    destroy = vi.fn();
  }

  /** 模糊滤镜替身：只记录参数，不做任何事 */
  class BlurFilter {
    options: unknown;
    constructor(options?: unknown) {
      this.options = options;
    }
  }

  /** 色彩矩阵滤镜替身（B4 风格预设用；本批先占位） */
  class ColorMatrixFilter {
    matrix: number[] = [];
    saturate = vi.fn();
    brightness = vi.fn();
    /** 切风格时旧实例要被销毁（累乘会让来回切换不可逆） */
    destroy = vi.fn();
  }

  /**
   * 文字与样式替身（B3 标注层）。
   *
   * `anchor` 必须补：`labelSync` 建节点时会 `anchor.set(0.5, 0.5)`（居中锚点，
   * 避让往上让才对称）。缺了它会在标注同步那一刻抛
   * "node.anchor is undefined"，而报错栈指向 effect，容易被误判成渲染时序问题。
   */
  class TextStyle {
    constructor(options?: unknown) {
      void options;
    }
  }
  class Text extends FakeContainer {
    text = "";
    resolution = 1;
    style: unknown = null;
    anchor = { set: vi.fn() };
    constructor(options?: unknown) {
      super();
      const o = options as { text?: string } | undefined;
      this.text = typeof o?.text === "string" ? o.text : "";
    }
  }

  const initDeferred = createDeferred<void>();
  // 暴露给测试，用于放行 init
  (globalThis as Record<string, unknown>).__releaseInit = () => initDeferred.resolve();

  const Texture = { EMPTY: Symbol("empty") };
  return {
    Application,
    Container: FakeContainer,
    Sprite: FakeSprite,
    Graphics: FakeGraphics,
    Texture,
    RenderTexture,
    BlurFilter,
    ColorMatrixFilter,
    /* 子图羽化的隔离滤镜替身（submapRender 给 content 挂它，让 erase 只擦子图纹理） */
    AlphaFilter: class {
      alpha = 1;
    },
    TextStyle,
    Text,
  };
});

// 依赖 mock 之后再导入被测组件
import MapCanvas from "./index";
import { Container } from "pixi.js";
import type { MapDocument, MapSubmap } from "../../types";
import type { MapRegion, Point } from "../../regions";
import {
  REGION_FILL_ALPHA,
  REGION_BORDER_ALPHA,
  regionFillAlphaOf,
  regionBorderAlphaOf,
} from "../../regions";
import { buildSubmapNode, type SubmapEnvRef } from "./submapRender";
import { elementSizeFactor } from "../../lod";

// jsdom 未实现 PointerEvent / 指针捕获：用 MouseEvent 顶替并补空实现，
// 否则 `setPointerCapture` 会在 React 的 pointerdown 处理里抛
// "not a function"，指针链路整条静默失效（症状：fireEvent 后回调一次都没触发）。
if (typeof window.PointerEvent === "undefined") {
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
}
if (typeof Element.prototype.setPointerCapture !== "function") {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
import { SPRITE_MAP } from "../../sprites";
import { resetMapDocStore, useMapDocStore } from "../../store/useMapDocStore";

function makeDoc(elements: MapDocument["elements"] = []): MapDocument {
  return {
    version: 2,
    baseImageId: "base-1",
    land: null,
    style: "none",
    labels: [],
    showRegions: true,
    elements,
    regions: [],
  };
}

const noop = () => {};

function canvasTree(
  options: {
    doc?: MapDocument;
    levelAlphas?: number[];
    /** 选中态：`drawOverlay` 只在这个 id 非空时才画框 */
    selectedId?: string | null;
    /** 选中的区块 id（画区块高亮） */
    selectedRegionId?: string | null;
    /** 手画草稿顶点（`null` = 不在画区模式，见 props 注释） */
    draftPoints?: readonly Point[] | null;
    /** 请求闭合（画布判定「双击 / 命中首顶点」后回调） */
    onDraftClose?: () => void;
    /** 单击落点回调（用来断言"闭合的那一下不落点"） */
    onCanvasClickWorld?: (world: { x: number; y: number }) => void;
  } = {},
) {
  return (
    <div style={{ width: 800, height: 600 }}>
      <MapCanvas
        doc={options.doc ?? makeDoc()}
        viewport={{ x: 0, y: 0, scale: 1 }}
        textures={{}}
        texturesReady={false}
        selectedId={options.selectedId ?? null}
        selectedRegionId={options.selectedRegionId ?? null}
        pendingSpriteId={null}
        levelAlphas={options.levelAlphas}
        draftPoints={options.draftPoints ?? null}
        onDraftClose={options.onDraftClose}
        onSizeChange={noop}
        onWheel={noop}
        onPan={noop}
        onCanvasClickWorld={options.onCanvasClickWorld ?? noop}
        onElementDragStart={noop}
        onElementDragDelta={noop}
      />
    </div>
  );
}

function renderCanvas(
  strict: boolean,
  options: {
    doc?: MapDocument;
    levelAlphas?: number[];
    selectedId?: string | null;
    selectedRegionId?: string | null;
    draftPoints?: readonly Point[] | null;
    onDraftClose?: () => void;
    onCanvasClickWorld?: (world: { x: number; y: number }) => void;
  } = {},
) {
  const tree = canvasTree(options);
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

/**
 * 放行 init 并等 React 把由此触发的重渲染与 effect 全部冲刷完。
 *
 * 只 `await Promise.resolve()` 若干次是不够的：init 完成后 `setApp` 触发的提交
 * 可能排在调度器里而非当前微任务队列，断言会抢在"容器已建、精灵已挂"之前跑，
 * 表现为"sprite 根本没被创建"。`act` 才会把这次提交排干。
 */
async function flushInit() {
  (globalThis as unknown as { __releaseInit: () => void }).__releaseInit();
  await act(async () => {});
}

/** 放开一个假的元素实例（世界上只用得到 spriteId/坐标/层级） */
function elem(
  id: string,
  spriteId: string,
  level: number | null,
  overrides: Partial<MapDocument["elements"][number]> = {},
): MapDocument["elements"][number] {
  return { id, spriteId, x: 0, y: 0, scale: 1, rotation: 0, level, ...overrides };
}

beforeEach(() => {
  apps = [];
  sprites = [];
  graphics = [];
  initSettled = false;
  // 文档 store 是模块级单例：本文件只有合并判决用例用到它，其余用例也不该被污染
  resetMapDocStore(makeDoc());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MapCanvas Pixi 生命周期", () => {
  it("StrictMode 双挂载：init 未完成时卸载不得调用 destroy（回归 _cancelResize）", async () => {
    const { unmount } = renderCanvas(true);

    // 此刻 init 仍挂在 await 上（未 release）——对应 StrictMode 第一次卸载的时机
    expect(apps.length).toBeGreaterThan(0);
    for (const app of apps) {
      // 若修复失效，cleanup 会在 init settle 前调 destroy → 触发 TypeError
      expect(app.destroy).not.toHaveBeenCalled();
    }

    // 卸载（模拟 StrictMode 的第一次 cleanup）
    expect(() => unmount()).not.toThrow();

    // 未完成 init 的实例仍不得被 destroy
    for (const app of apps) {
      expect(app.destroy).not.toHaveBeenCalled();
    }

    // 放行 init：修复逻辑应在此刻自行销毁被弃用的实例
    await flushInit();

    // 至少有一个实例被销毁（被卸载的那个），且全程无异常
    expect(apps.some((a) => a.destroy.mock.calls.length > 0)).toBe(true);
  });

  it("init 已完成后再卸载：destroy 正常调用一次", async () => {
    const { unmount } = renderCanvas(false);

    // 放行 init 并等待 effect 内的建图逻辑跑完
    await flushInit();

    expect(apps.length).toBeGreaterThan(0);
    const app = apps[0];

    unmount();
    // 此时 initDone 为真，cleanup 应直接销毁
    expect(app.destroy).toHaveBeenCalledTimes(1);
  });
});

/**
 * 素材的层级归属 —— 渲染层的行为契约。
 *
 * 用户报障：在郡那一级摆的山，缩到上一级（国家）去看**没有任何变化**，
 * 没有跟着层级走。根因是素材当时是"全局一层贴纸"：既不参与层级、也不随层级显隐。
 *
 * 现在素材按放置层级分容器，容器 alpha 直接取该层级的权重（与区块边界同一份）。
 * 这里把"容器 alpha = 层级权重"这条钉死 —— 页面级测试的 Pixi 替身不建模 alpha，
 * 那边覆盖不到这层。
 */
describe("MapCanvas 素材层级显隐", () => {
  /**
   * 山脉（mountain-20）baseWidth = 120，森林（forest-1）= 90，据此认出各自精灵。
   *
   * ⚠️ 精灵的**实际宽度**不再是 baseWidth：素材按层级自动缩小（每级减半，
   * 见 `lod.elementSizeFactor`）。所以认精灵时要按"基准宽 × 层级因子"算，
   * `drawWidth` 就是这条换算的唯一出处 —— 它同时顺带验证了尺寸本身，
   * 若因子丢了（恒为 1），下面的 `findSprite` 会立刻找不到精灵。
   */
  const MOUNTAIN_BASE = 120;
  const FOREST_BASE = 90;

  /** 绘制宽度（元素自身 scale 恒为 1） */
  const drawWidth = (base: number, level: number | null, levelCount: number) =>
    base * elementSizeFactor(level, levelCount);

  const findSprite = (width: number) => {
    const hit = sprites.find((s) => s.width === width);
    expect(hit, `未找到宽度为 ${width} 的素材精灵`).toBeDefined();
    return hit as FakeSpriteRef;
  };

  it("素材挂在所属层级的容器下，容器 alpha = 该层级权重", async () => {
    const doc = makeDoc([
      elem("a", "mountain-20", 3), // 在「郡」那一级放置
      elem("b", "forest-1", null), // 生成区块之前放置 → 层级无关
    ]);

    const { rerender } = renderCanvas(false, { doc, levelAlphas: [0, 0, 0, 1] });
    await flushInit();

    // 郡权重为 1 → 山可见；层级无关 → 恒为 1
    expect(findSprite(drawWidth(MOUNTAIN_BASE, 3, 4)).parent?.alpha).toBe(1);
    expect(findSprite(drawWidth(FOREST_BASE, null, 4)).parent?.alpha).toBe(1);
    // 两个素材必须在**不同**容器里，否则"按层级显隐"无从谈起
    expect(findSprite(drawWidth(MOUNTAIN_BASE, 3, 4)).parent).not.toBe(
      findSprite(drawWidth(FOREST_BASE, null, 4)).parent,
    );

    // ── 缩到「洲」那一级：郡的权重归 0，山随之消失 ──
    rerender(canvasTree({ doc, levelAlphas: [0, 1, 0, 0] }));
    await act(async () => {});

    expect(findSprite(drawWidth(MOUNTAIN_BASE, 3, 4)).parent?.alpha).toBe(0);
    // 层级无关的素材不受任何层级切换影响
    expect(findSprite(drawWidth(FOREST_BASE, null, 4)).parent?.alpha).toBe(1);
  });

  it("交叉带里两级各半：素材按自己的层级权重呈现，不会一档全亮一档全灭", async () => {
    const doc = makeDoc([elem("a", "mountain-20", 2), elem("b", "forest-1", 3)]);
    renderCanvas(false, { doc, levelAlphas: [0, 0, 0.5, 0.5] });
    await flushInit();

    // 国家级素材 50%、郡级素材 50% —— 正是"上一级淡出的同时下一级淡入"
    expect(findSprite(drawWidth(MOUNTAIN_BASE, 2, 4)).parent?.alpha).toBeCloseTo(0.5, 6);
    expect(findSprite(drawWidth(FOREST_BASE, 3, 4)).parent?.alpha).toBeCloseTo(0.5, 6);
  });

  it("层级数变少时越界素材并入最细一级，不会永久消失", async () => {
    const doc = makeDoc([elem("a", "mountain-20", 3)]);
    // 只剩两级：level 3 的素材应当并到第 1 级（= 0.5），而不是被藏起来
    renderCanvas(false, { doc, levelAlphas: [0.5, 0.5] });
    await flushInit();

    // 并入第 1 级 ⇒ 尺寸因子是 0.5（不是 4 级时的 0.125）
    const mountain = findSprite(drawWidth(MOUNTAIN_BASE, 1, 2));
    expect(mountain.parent?.alpha).toBeCloseTo(0.5, 6);
    // 且它必须挂在"层级 1"的容器下，而不是那个已经不在场景里的旧容器
    expect(mountain.parent).not.toBeNull();
  });

  /**
   * 尺寸本身：**素材必须比它所属的区块小**。
   *
   * 用户报障的后半段：「最小的单位尺寸太小了，根本无法添加几个要素」——
   * 郡的长边实测 70~90 世界单位，而素材基准宽是 80~160，比郡还大。
   * 素材与区块同在 world 容器下、同倍缩放，所以放大多少倍都不改变这个比例，
   * 必须在世界里就按层级把素材缩小。
   */
  it("郡级素材宽 = 基准 × 1/8（郡的长边 ≈ 88 世界单位，山占约 1/6~1/4）", async () => {
    const doc = makeDoc([elem("a", "mountain-20", 3), elem("b", "forest-1", null)]);
    renderCanvas(false, { doc, levelAlphas: [0, 0, 0, 1] });
    await flushInit();

    const mountain = findSprite(drawWidth(MOUNTAIN_BASE, 3, 4));
    expect(mountain.width).toBeCloseTo(MOUNTAIN_BASE / 8, 6); // 120 → 15
    expect(mountain.height).toBeCloseTo(70 / 8, 6);

    // 层级无关的老素材（生成区块之前放的）尺寸一点不变 —— 老文档观感不变
    expect(findSprite(FOREST_BASE).width).toBe(FOREST_BASE);
    expect(findSprite(FOREST_BASE).height).toBe(FOREST_BASE);
  });

  /**
   * 选中框必须与**视觉尺寸**同源缩放（尺寸三处中的第三处）。
   *
   * 【为什么单独钉一条】另两处（精灵尺寸、命中测试）都有用例，唯独选中框没有：
   * 把 `drawOverlay` 里的层级因子删掉，郡级素材的框会变成 `120 × 70`
   * —— 视觉尺寸的 8 倍，框比素材大出几圈 —— 而**其它用例全绿**。
   * 这种"改坏了没人红"的位置，正是变异测试要抓的盲区。
   *
   * 断言的取值路径：`world` 里名叫 `overlay` 的那个子节点（z 序见 `layers.ts`），
   * 选中框是它上面**唯一**的 `rect(...)` 调用。
   */
  it("选中框跟着素材一起缩：郡级框宽 = 基准宽 × 1/8（漏乘就是 8 倍）", async () => {
    const def = SPRITE_MAP["mountain-20"];
    const doc = makeDoc([elem("a", "mountain-20", 3)]);
    renderCanvas(false, { doc, levelAlphas: [0, 0, 0, 1], selectedId: "a" });
    await flushInit();

    const world = apps[0].stage.children[0] as FakeContainerRef;
    // 图层数与清单一致；这条顺带证明 overlay 确实被挂上了
    expect(world.children).toHaveLength(WORLD_LAYER_ORDER.length);
    const overlay = layerOf(world, "overlay") as FakeGraphicsRef;

    const rect = overlay.rects.at(-1);
    expect(rect, "overlay 上没有画过选中框").toBeDefined();
    const [, , w, h] = rect as [number, number, number, number];

    const factor = elementSizeFactor(3, 4); // 郡级 ⇒ 0.125
    expect(w).toBeCloseTo(def.baseWidth * factor, 6);
    expect(h).toBeCloseTo(def.baseHeight * factor, 6);
    // 反向断言：漏乘层级因子时 w 恰好是 baseWidth，这一条必须因此变红
    expect(w).not.toBeCloseTo(def.baseWidth, 6);
    expect(h).not.toBeCloseTo(def.baseHeight, 6);
  });

  /**
   * 选中区块必须画出高亮。
   *
   * 【为什么单独立一条】用户报障原话是"点击区域块，没有点击反馈，到底选中的是
   * 哪一块"。数据侧（selectedRegionId / RegionPanel）早就通了，唯独画布上
   * 什么都没画 —— 这类"状态对了、画面没动"的缺陷，只有"overlay 上有没有
   * poly 调用"能在不真渲染的情况下钉住。
   *
   * 断言口径：高亮由三笔叠加（淡填充 + 外发光 + 细白线），所以选中一个
   * 4 顶点的区块时，`polys` 里应当出现 3 组、每组 8 个数字（4 点 × xy）。
   */
  it("选中区块时 overlay 画出三笔高亮（点区块必须有视觉反馈）", async () => {
    const polygon = [
      { x: -100, y: -100 },
      { x: 100, y: -100 },
      { x: 100, y: 100 },
      { x: -100, y: 100 },
    ];
    const doc: MapDocument = {
      ...makeDoc(),
      regions: [
        {
          id: "r1",
          parentId: null,
          level: 0,
          name: "甲",
          seed: { x: 0, y: 0 },
          polygon,
          color: 0x445566,
        },
      ],
    };

    renderCanvas(false, { doc, levelAlphas: [1], selectedRegionId: "r1" });
    await flushInit();

    const world = apps[0].stage.children[0] as FakeContainerRef;
    const overlay = layerOf(world, "overlay") as FakeGraphicsRef;
    expect(overlay.polys, "选中区块后 overlay 上一笔都没画").toHaveLength(3);
    for (const flat of overlay.polys) {
      expect(flat).toHaveLength(polygon.length * 2);
    }
    // 顶点必须来自被选中的那个区块（而不是随便某个区块）
    expect(overlay.polys[0]).toEqual(polygon.flatMap((p) => [p.x, p.y]));

    // ── 反例：同一份文档、不选中任何区块 → 一笔都不该画 ──
    // 少了这条，"所有区块永远高亮"这种退化也能让上面通过。
    const second = renderCanvas(false, { doc, levelAlphas: [1] });
    await flushInit();
    const world2 = apps.at(-1)!.stage.children[0] as FakeContainerRef;
    const overlay2 = layerOf(world2, "overlay") as FakeGraphicsRef;
    expect(overlay2.polys).toHaveLength(0);
    second.unmount();
  });

  /**
   * 子图内容变了必须重建子树。
   *
   * 【为什么单独立一条】结构 effect 早期只判断"这个区块有没有节点"，于是重新圈定
   * 之后画面还停在**旧分区**上 —— 不报错、不刷新，只是"点了生成但没变化"。
   * `doc` 是不可变更新，重新圈定会给出新的 `submap` 对象；用引用比较即可。
   */
  it("重新圈定子图（submap 引用变了）⇒ 子树重建，而不是继续画旧分区", async () => {
    const polygon = [
      { x: -100, y: -100 },
      { x: 100, y: -100 },
      { x: 100, y: 100 },
      { x: -100, y: 100 },
    ];
    const subRegion = {
      id: "sub1",
      parentId: null,
      level: 0,
      name: "子块",
      seed: { x: 0, y: 0 },
      polygon,
      color: 0x334455,
    };
    const makeSubmap = (id: string) => ({
      id,
      bounds: { x: -50, y: -50, width: 100, height: 100 },
      land: null,
      regions: [subRegion],
      elements: [],
      labels: [],
      style: "none" as const,
      baseImageId: "base-1",
    });
    const makeDocWith = (submap: ReturnType<typeof makeSubmap>): MapDocument => ({
      ...makeDoc(),
      regions: [
        {
          id: "r1",
          parentId: null,
          level: 0,
          name: "甲",
          seed: { x: 0, y: 0 },
          polygon,
          color: 0x445566,
          submap,
        },
      ],
    });

    const docA = makeDocWith(makeSubmap("sm_a"));
    const { rerender } = renderCanvas(false, { doc: docA, levelAlphas: [1] });
    await flushInit();

    const world = apps[0].stage.children[0] as FakeContainerRef;
    // z 序：static / coast / region / element / submap / label / overlay / draft
    const submapLayer = layerOf(world, "submapLayer") as FakeContainerRef;
    expect(submapLayer.children, "有 submap 的区块没挂上子树").toHaveLength(1);
    const firstNode = submapLayer.children[0];

    // 同引用重渲染：不该重建（否则每次 setState 都白付一次烘焙）
    rerender(canvasTree({ doc: docA, levelAlphas: [1] }));
    await act(async () => {});
    expect(submapLayer.children[0], "内容未变却重建了子树").toBe(firstNode);

    // 换一份 submap（= 重新圈定）：必须换成新子树
    rerender(canvasTree({ doc: makeDocWith(makeSubmap("sm_b")), levelAlphas: [1] }));
    await act(async () => {});
    expect(submapLayer.children).toHaveLength(1);
    expect(submapLayer.children[0], "submap 内容变了但子树没重建").not.toBe(firstNode);
  });
});

/**
 * 区块高亮分级（R-REG-05）—— 叶子面高亮 / 非叶子容器态。
 *
 * 【为什么必须在这一层测】"不铺面"是一个**渲染行为**：数据侧完全看不出来，
 * 页面级用例也读不到 Graphics 的绘制调用。`FakeGraphics` 的 `polys` / `fills`
 * 探针是唯一能在不真渲一张图的条件下钉住它的手段（架构 §4.6）。
 *
 * 【回归基线】叶子必须仍然画**三笔**且填充一次 —— 既有用例
 * 「选中区块时 overlay 画出三笔高亮」就是这条基线，本组不改它。
 */
describe("MapCanvas 区块高亮分级（叶子 / 非叶子）", () => {
  const SQUARE = [
    { x: -100, y: -100 },
    { x: 100, y: -100 },
    { x: 100, y: 100 },
    { x: -100, y: 100 },
  ];

  const region = (
    id: string,
    parentId: string | null,
    level: number,
    polygon = SQUARE,
  ): MapDocument["regions"][number] => ({
    id,
    parentId,
    level,
    name: id,
    seed: { x: 0, y: 0 },
    polygon,
    color: 0x445566,
  });

  /** 取本次渲染里 world 的 overlay（按名字取，见 `layerOf`） */
  const overlayOf = (index: number) =>
    layerOf(apps[index].stage.children[0] as FakeContainerRef, "overlay") as FakeGraphicsRef;

  it("选中非叶子区块：不铺面（fills 为 0）且只描一笔", async () => {
    const doc: MapDocument = {
      ...makeDoc(),
      regions: [region("p", null, 0), region("c", "p", 1)],
    };
    renderCanvas(false, { doc, levelAlphas: [1], selectedRegionId: "p" });
    await flushInit();

    const overlay = overlayOf(0);
    expect(overlay.polys, "非叶子只该有一笔容器描边").toHaveLength(1);
    expect(overlay.fills, "非叶子不得铺面（淡填充会把内部子边界压掉）").toHaveLength(0);
    // 那一笔必须沿被选中区块的多边形（不是随便某个形状）
    expect(overlay.polys[0]).toEqual(SQUARE.flatMap((p) => [p.x, p.y]));
  });

  it("选中叶子区块：仍是现状三笔（面高亮回归基线，逐参数不变）", async () => {
    // 「c」没有子节点 ⇒ 叶子；即使它是 level 1（不是最深级）也必须走面高亮
    const doc: MapDocument = {
      ...makeDoc(),
      regions: [region("p", null, 0), region("c", "p", 1)],
    };
    renderCanvas(false, { doc, levelAlphas: [0, 1], selectedRegionId: "c" });
    await flushInit();

    const overlay = overlayOf(0);
    expect(overlay.polys).toHaveLength(3);
    expect(overlay.fills).toHaveLength(1);
  });

  /**
   * 【判决用例（PRD §6-A，必须写）】
   *
   * 合并会把"国家"的郡全删掉，于是"国家"成为**叶子但 `level = 2`**
   * （比最深级 3 更浅）。若判据写成 `level === maxLevel`，这个刚合并出来的区块
   * 会既不能高亮、也无法确认选中 —— 用户做完合并立刻失去操作反馈。
   *
   * 所以这里先断言"有子郡 ⇒ 只一笔、不铺面"，再把子郡从文档里去掉（模拟合并后），
   * 断言同一个父块变成"三笔 + 一次填充"。
   */
  it("判决用例：合并掉全部子块后（level 不是最深）出现面高亮三笔", async () => {
    const parent = region("country", null, 2);
    const child1 = region("county-1", "country", 3, [
      { x: -100, y: -100 },
      { x: 0, y: -100 },
      { x: 0, y: 0 },
      { x: -100, y: 0 },
    ]);
    const child2 = region("county-2", "country", 3, [
      { x: 0, y: -100 },
      { x: 100, y: -100 },
      { x: 100, y: 0 },
      { x: 0, y: 0 },
    ]);
    const levelAlphas = [0, 0, 1, 0]; // 视口停在「国家」这一级

    const withChildren: MapDocument = {
      ...makeDoc(),
      regions: [parent, child1, child2],
    };
    const { rerender } = renderCanvas(false, {
      doc: withChildren,
      levelAlphas,
      selectedRegionId: "country",
    });
    await flushInit();

    const before = overlayOf(0);
    expect(before.polys, "有子郡时父块是容器态").toHaveLength(1);
    expect(before.fills, "有子郡时父块不得铺面").toHaveLength(0);

    // ── 模拟"合并掉全部子区块"：文档里只剩父块（level 仍是 2）──
    rerender(
      canvasTree({
        doc: { ...makeDoc(), regions: [parent] },
        levelAlphas,
        selectedRegionId: "country",
      }),
    );
    await act(async () => {});

    const after = overlayOf(0);
    expect(after.polys, "合并后父块已是叶子 ⇒ 必须出现面高亮三笔").toHaveLength(3);
    expect(after.fills, "合并后必须有一次淡填充").toHaveLength(1);
  });

  /**
   * 【判决用例 · 端到端版】上一条靠"直接换一份 doc"模拟合并，这条真的走
   * `store.mergeSubtree`（含 `planMerge` / `applyMerge` / 一步快照），再把
   * store 里的新文档喂给画布 —— 数据链路（store）与渲染链路（Graphics 探针）
   * 在同一条用例里对齐。
   *
   * 【为什么要两条】上一条钉的是 `drawOverlay` 的判据（叶子 vs level），
   * 这条钉的是"合并真的把子块删干净了、且父块的 polygon 一点没动" —— 只要
   * `applyMerge` 少删一层，父块就仍然是"非叶子"，三笔不会出现。
   */
  it("判决用例（端到端）：经 store 合并掉郡之后，level=2 的国家再被选中必须出现三笔", async () => {
    const parent = region("country", null, 2);
    const child1 = region("county-1", "country", 3, [
      { x: -100, y: -100 },
      { x: 0, y: -100 },
      { x: 0, y: 0 },
      { x: -100, y: 0 },
    ]);
    const child2 = region("county-2", "country", 3, [
      { x: 0, y: -100 },
      { x: 100, y: -100 },
      { x: 100, y: 0 },
      { x: 0, y: 0 },
    ]);
    const levelAlphas = [0, 0, 1, 0]; // 视口停在「国家」这一级

    resetMapDocStore({ ...makeDoc(), regions: [parent, child1, child2] });

    const { rerender } = renderCanvas(false, {
      doc: useMapDocStore.getState().doc,
      levelAlphas,
      selectedRegionId: "country",
    });
    await flushInit();

    const before = overlayOf(0);
    expect(before.polys, "有郡时国家是容器态").toHaveLength(1);
    expect(before.fills, "有郡时国家不得铺面").toHaveLength(0);

    // ── 真的走一次合并 ──
    const result = useMapDocStore.getState().mergeSubtree("country");
    expect(result).toEqual({ removed: 2, withSubmap: 0 });

    const live = useMapDocStore.getState().doc;
    expect(live.regions.map((r) => r.id)).toEqual(["country"]);
    // P 的几何与引用都不变（合并不重贴合，顶点数不变 ⇒ 渲染缓存 key 不变）
    expect(live.regions[0]).toEqual(parent);
    expect(live.regions[0].polygon).toEqual(parent.polygon);

    // ── 把 store 里的新文档喂回画布 ──
    rerender(
      canvasTree({ doc: live, levelAlphas, selectedRegionId: "country" }),
    );
    await act(async () => {});

    const after = overlayOf(0);
    expect(after.polys, "合并后国家是叶子 ⇒ 必须出现面高亮三笔").toHaveLength(3);
    expect(after.fills, "合并后必须有一次淡填充").toHaveLength(1);
  });
});

/**
 * 手画草稿层（R-REG-03 / 架构 §2.6.1）。
 *
 * 三条必须钉住的性质，每条都对应一个"看起来能用、其实很贵/很脏"的实现：
 *   ① **独立图层**：草稿不画在 overlay 上 —— 否则导出前的 `clearOverlay()`
 *      会把用户画到一半的线一起清掉；
 *   ② **只重画草稿**：连续指针移动只允许 `draftLayer.clear()` + 重写几笔，
 *      不得触碰区块几何（判据：区块层 `poly()` 次数不变、`doc.regions` 引用不变）；
 *   ③ **`null` 与 `[]` 不同**：前者"不在画区模式"、后者"在模式里但一个点都没落"，
 *      两者画面上都一样（什么都不画），但指针行为不同，所以用真假区分而不是加布尔。
 */
describe("MapCanvas 手画草稿层", () => {
  /** 一个方形的四个顶点（世界坐标，首尾不重复） */
  const DRAFT: readonly Point[] = [
    { x: -80, y: -80 },
    { x: 80, y: -80 },
    { x: 80, y: 80 },
    { x: -80, y: 80 },
  ];

  /** 取本次渲染的草稿层（按名字，见 `layerOf`） */
  const draftOf = (index = 0) =>
    layerOf(apps[index].stage.children[0] as FakeContainerRef, "draftLayer") as FakeGraphicsRef;

  /** 取本次渲染的 overlay（同上；本 describe 内的 `overlayOf` 不外泄） */
  const overlayAt = (index = 0) =>
    layerOf(apps[index].stage.children[0] as FakeContainerRef, "overlay") as FakeGraphicsRef;

  /** 区块层的可见几何笔数 = 所有层级容器的「填充 + 边界」的 `poly()` 次数之和 */
  const regionPolyCount = (index = 0) => {
    const world = apps[index].stage.children[0] as FakeContainerRef;
    const regionLayer = layerOf(world, "regionLayer") as FakeContainerRef;
    let total = 0;
    for (const level of regionLayer.children as FakeContainerRef[]) {
      const [fill, border] = level.children as FakeGraphicsRef[];
      total += (fill?.polys.length ?? 0) + (border?.polys.length ?? 0);
    }
    return total;
  };

  /** 一块顶层区块，让区块层真的画出几何（性能守卫要数它的 `poly()`） */
  const docWithRegion = (): MapDocument => ({
    ...makeDoc(),
    regions: [
      {
        id: "r1",
        parentId: null,
        level: 0,
        name: "大陆 1",
        seed: { x: 0, y: 0 },
        polygon: [
          { x: -200, y: -200 },
          { x: 200, y: -200 },
          { x: 200, y: 200 },
          { x: -200, y: 200 },
        ],
        color: 0x445566,
      },
    ],
  });

  it("草稿画在独立的 draftLayer 上：顶点圈与折线都在它身上，overlay 一笔不多", async () => {
    renderCanvas(false, { doc: docWithRegion(), levelAlphas: [1], draftPoints: DRAFT });
    await flushInit();

    const draft = draftOf();
    // 每个已落点至少一个顶点圈（实现是"填充 + 描边"各一圈，这里只要求不少于点数 ——
    // 圈数属于视觉细节，断言精确值会让"给首点多加一圈高亮"这种正常改动变红）
    expect(draft.circles.length).toBeGreaterThanOrEqual(DRAFT.length);
    // 已确定的边是一条**开链**折线：n 个点 ⇒ 至少 n-1 段
    expect(draft.lineCount).toBeGreaterThanOrEqual(DRAFT.length - 1);
    // 画过东西（不是只 clear 了一下）
    expect(draft.strokes.length).toBeGreaterThan(0);

    // ⚠️ 关键：overlay 上不许出现任何笔画 —— 导出前的 `clearOverlay()` 会清空它，
    // 草稿若画在上面，用户画到一半导出一次就全没了
    expect(overlayAt(0).polys).toHaveLength(0);
    expect(overlayAt(0).rects).toHaveLength(0);
  });

  it("draftPoints = null（不在画区模式）：草稿层一笔都不画", async () => {
    renderCanvas(false, { doc: docWithRegion(), levelAlphas: [1], draftPoints: null });
    await flushInit();

    const draft = draftOf();
    expect(draft.circles).toHaveLength(0);
    expect(draft.strokes).toHaveLength(0);
  });

  it("draftPoints = []（在模式里但没落点）：同样一笔都不画，但模式是开着的", async () => {
    renderCanvas(false, { doc: docWithRegion(), levelAlphas: [1], draftPoints: [] });
    await flushInit();

    const draft = draftOf();
    expect(draft.circles).toHaveLength(0);
    expect(draft.strokes).toHaveLength(0);
  });

  it("性能守卫：连续 20 次 pointermove 只重画草稿层，区块层 poly() 次数一次都不变", async () => {
    const doc = docWithRegion();
    const before = useMapDocStore.getState().doc;
    const { container } = renderCanvas(false, { doc, levelAlphas: [1], draftPoints: DRAFT });
    await flushInit();

    const polyBefore = regionPolyCount();
    // 前置条件：区块层真的画了东西（否则"次数不变"是废话，永远绿）
    expect(polyBefore).toBeGreaterThan(0);

    const canvas = container.querySelector(".map-canvas") as HTMLElement;
    expect(canvas, "没找到 .map-canvas 宿主元素").not.toBeNull();
    const clearsBefore = draftOf().clearCount;
    for (let i = 0; i < 20; i += 1) {
      fireEvent.pointerMove(canvas, { clientX: 10 + i, clientY: 20 + i });
    }

    // ① 区块几何一笔都没重建
    expect(regionPolyCount(), "指针移动重建了区块几何").toBe(polyBefore);
    // ② 文档引用不变（任何一次 "落点/提交" 都会换掉它）
    expect(useMapDocStore.getState().doc).toBe(before);
    // ③ 而草稿层确实**每一帧**都重画了 —— 否则上两条会退化成"什么都没发生"也绿。
    //    这里数的是 `clear()` 的**增量**（不是 `strokes.length`）：草稿层的落笔笔数
    //    是常数，首帧之后就恒 > 0，用总数根本分不出"画过一次"和"每帧都画"。
    const draft = draftOf();
    expect(draft.strokes.length, "指针移动没有重画草稿层").toBeGreaterThan(0);
    expect(
      draft.clearCount - clearsBefore,
      "20 次 pointermove 并没有 20 次重画草稿层（增量对不上 ⇒ 指针移动其实没驱动重绘）",
    ).toBe(20);
  });

  /**
   * 单击一次（down + up），坐标即**世界坐标**。
   *
   * 本文件的 jsdom 里画布矩形恒为 0×0、视口是 `{x:0,y:0,scale:1}`，于是
   * `getLocalPoint` 得到的就是 clientX/Y，`screenToWorld` 再原样返回 —— 两者相等。
   */
  function clickAt(canvas: HTMLElement, x: number, y: number) {
    fireEvent.pointerDown(canvas, { clientX: x, clientY: y, pointerId: 1, button: 0 });
    fireEvent.pointerUp(canvas, { clientX: x, clientY: y, pointerId: 1, button: 0 });
  }

  it("同一处连点两下（间隔 < 350ms）⇒ 第一下落点、第二下只请求闭合，**不落点**", async () => {
    const onDraftClose = vi.fn();
    const onCanvasClickWorld = vi.fn();
    const { container } = renderCanvas(false, {
      doc: docWithRegion(),
      levelAlphas: [1],
      draftPoints: DRAFT,
      onDraftClose,
      onCanvasClickWorld,
    });
    await flushInit();

    const canvas = container.querySelector(".map-canvas") as HTMLElement;
    clickAt(canvas, 300, 300); // ① 远离首顶点 ⇒ 正常落点
    clickAt(canvas, 300, 300); // ② 与上一笔同处且极快 ⇒ 判成双击

    // 落点只发生一次（第二下被 pointerdown 的闭合判定吃掉）——
    // 这正是旧实现（挂在 dblclick 上）做不到的：那时顶点已经落下，只能事后补救
    expect(onCanvasClickWorld).toHaveBeenCalledTimes(1);
    expect(onDraftClose).toHaveBeenCalledTimes(1);
  });

  it("单击首顶点（已落 4 点）⇒ 请求闭合，**不落点**", async () => {
    const onDraftClose = vi.fn();
    const onCanvasClickWorld = vi.fn();
    const { container } = renderCanvas(false, {
      doc: docWithRegion(),
      levelAlphas: [1],
      draftPoints: DRAFT,
      onDraftClose,
      onCanvasClickWorld,
    });
    await flushInit();

    const canvas = container.querySelector(".map-canvas") as HTMLElement;
    clickAt(canvas, DRAFT[0].x, DRAFT[0].y);
    expect(onDraftClose).toHaveBeenCalledTimes(1);
    expect(onCanvasClickWorld).not.toHaveBeenCalled();
  });

  it("不足 3 点时点首顶点不闭合（免得把「我在定位」当成「我要收尾」）", async () => {
    const onDraftClose = vi.fn();
    const onCanvasClickWorld = vi.fn();
    const { container } = renderCanvas(false, {
      doc: docWithRegion(),
      levelAlphas: [1],
      draftPoints: [DRAFT[0], DRAFT[1]],
      onDraftClose,
      onCanvasClickWorld,
    });
    await flushInit();

    const canvas = container.querySelector(".map-canvas") as HTMLElement;
    clickAt(canvas, DRAFT[0].x, DRAFT[0].y);
    expect(onDraftClose).not.toHaveBeenCalled();
    // 但这一下与上一个点重合 ⇒ 被页面的同点去重吃掉；画布本身照常回调
    expect(onCanvasClickWorld).toHaveBeenCalledTimes(1);
  });

  it("`dblclick` 不再是闭合的第二条路径（只剩 pointerdown 一条）", async () => {
    const onDraftClose = vi.fn();
    const { container } = renderCanvas(false, {
      doc: docWithRegion(),
      levelAlphas: [1],
      draftPoints: DRAFT,
      onDraftClose,
    });
    await flushInit();

    // 只发 dblclick、不发 down/up：若还有人挂在 dblclick 上，这里会命中
    fireEvent.doubleClick(container.querySelector(".map-canvas") as HTMLElement);
    expect(onDraftClose).not.toHaveBeenCalled();
  });
});

/**
 * 素材镜像翻转（观感批次 C · P1-4）—— 渲染层的行为契约。
 *
 * 【钉什么】翻转的唯一语义是 `scale.x` 取反；其余一切（位置 / 宽高 / 层级容器）
 * 必须与未翻转时完全一致：锚点 (0.5, 1) 水平居中，翻转绕竖直中轴进行，
 * 脚底点与外接盒都不动 —— 命中测试（coords.hitTestElement）与选中框因此
 * 天然与原图一致，"点哪选哪"不需要任何反算。
 * 同时钉旧档兼容：老文档没有 flipX 字段，读点（elementFlipXOf）回落 false。
 */
describe("MapCanvas 素材镜像翻转（P1-4）", () => {
  const BASE = SPRITE_MAP["mountain-20"].baseWidth; // 120

  const findSprite = (width: number) => {
    const hit = sprites.find((s) => s.width === width);
    expect(hit, `未找到宽度为 ${width} 的素材精灵`).toBeDefined();
    return hit as FakeSpriteRef;
  };

  it("flipX = true：scale.x 为负且幅值不变，同屏一正一反互不干扰", async () => {
    const doc = makeDoc([
      elem("a", "mountain-20", null),
      { ...elem("b", "mountain-20", null), flipX: true, x: 300, y: 500 },
    ]);
    renderCanvas(false, { doc, levelAlphas: [] });
    await flushInit();

    const mountainSprites = sprites.filter((s) => s.width === BASE);
    expect(mountainSprites, "两个素材各建一个精灵").toHaveLength(2);
    const flipped = mountainSprites.filter((s) => s.scale.x < 0);
    const plain = mountainSprites.filter((s) => s.scale.x > 0);
    expect(flipped, "恰好一个翻面").toHaveLength(1);
    expect(plain, "恰好一个原样").toHaveLength(1);
    // 幅值不被翻转改写：|scale.x| 恒等于幅值（mock 下 width 赋值不改 scale，
    // 生产代码显式 abs 归正 —— 这条钉住"翻转只改符号、不改大小"）
    expect(Math.abs(flipped[0].scale.x)).toBe(1);
    expect(plain[0].scale.x).toBe(1);
  });

  it("旧存档素材没有 flipX 字段：按 false 渲染（scale.x 为正），不报错", async () => {
    // elem() 造的元素不带 flipX —— 2.34.0 及之前的存档都是这个形状
    const doc = makeDoc([elem("a", "mountain-20", null)]);
    renderCanvas(false, { doc, levelAlphas: [] });
    await flushInit();
    expect(findSprite(BASE).scale.x).toBeGreaterThan(0);
  });

  it("翻转状态切换（撤销 / 重做）：同一精灵只改符号，不重建", async () => {
    const docFlipped = makeDoc([{ ...elem("a", "mountain-20", null), flipX: true }]);
    const { rerender } = renderCanvas(false, { doc: docFlipped, levelAlphas: [] });
    await flushInit();
    expect(findSprite(BASE).scale.x).toBeLessThan(0);

    // 撤销回到未翻转：不能销毁重建（重建 = 纹理重绑 + 容器重挂，白付一次）
    rerender(canvasTree({ doc: makeDoc([elem("a", "mountain-20", null)]), levelAlphas: [] }));
    await act(async () => {});
    expect(sprites.filter((s) => s.width === BASE)).toHaveLength(1);
    expect(findSprite(BASE).scale.x).toBeGreaterThan(0);
  });
});

/**
 * 镜像翻转的边界补钉（原 QA 独立文件 `qa-flipx-boundary.test.tsx` 并入，
 * 2026-11-06 收编）—— 覆盖守卫用例没碰到的三个角落：
 *   1. 脏档 flipX 非布尔真值：读点严格 `=== true`，渲染不得翻转、不得报错；
 *   2. 素材被手工移动（x/y 变化）：翻转符号保持，不被位置同步冲掉
 *      （pixi 8 的 `_setWidth` 保留符号，生产代码必须每次显式重设 ——
 *      这条钉住"符号重设与位置同步互不干扰"）；
 *   3. 子图内素材的翻转渲染（submapRender.ts 的翻面行此前没有测试钉过）。
 */
describe("MapCanvas 素材镜像翻转 · 边界补钉", () => {
  const BASE = SPRITE_MAP["mountain-20"].baseWidth; // 120

  it("脏档 flipX = 'true'（字符串）：渲染不翻转（scale.x 为正）且不报错", async () => {
    const doc = makeDoc([
      elem("a", "mountain-20", null, { flipX: "true" as unknown as boolean }),
    ]);
    render(canvasTree({ doc, levelAlphas: [] }));
    await flushInit();
    const found = sprites.filter((s) => s.width === BASE);
    expect(found).toHaveLength(1);
    expect(found[0].scale.x).toBeGreaterThan(0);
  });

  it("脏档 flipX = 1（数字真值）：同样不翻转", async () => {
    const doc = makeDoc([elem("a", "mountain-20", null, { flipX: 1 as unknown as boolean })]);
    render(canvasTree({ doc, levelAlphas: [] }));
    await flushInit();
    expect(sprites.filter((s) => s.width === BASE)[0].scale.x).toBeGreaterThan(0);
  });

  it("翻转素材被移动：符号保持负值，位置同步到新坐标", async () => {
    const doc1 = makeDoc([{ ...elem("a", "mountain-20", null), flipX: true }]);
    const { rerender } = render(canvasTree({ doc: doc1, levelAlphas: [] }));
    await flushInit();
    const sprite = sprites.find((s) => s.width === BASE) as FakeSpriteRef;
    expect(sprite.scale.x).toBeLessThan(0);

    // 模拟拖拽落档：只改 x/y，flipX 原样保留
    const doc2 = makeDoc([
      { ...elem("a", "mountain-20", null), flipX: true, x: 500, y: 700 },
    ]);
    rerender(canvasTree({ doc: doc2, levelAlphas: [] }));
    await act(async () => {});
    expect(sprite.scale.x).toBeLessThan(0);
    expect(sprite.positionCalls.at(-1)).toEqual([500, 700]);
  });
});

describe("子图素材镜像翻转（buildSubmapNode，与父图同一条规则）", () => {
  const BASE = SPRITE_MAP["mountain-20"].baseWidth; // 120
  const env: SubmapEnvRef = {
    current: { renderer: null, textures: {}, baseResolution: 1 },
  };

  function makeSubmapWith(elements: MapDocument["elements"]): MapSubmap {
    return {
      id: "sm_1",
      bounds: { x: -50, y: -50, width: 100, height: 100 },
      land: null,
      regions: [],
      elements,
      labels: [],
      style: "none",
      baseImageId: "base-1",
    };
  }

  function regionWithSubmap(submap: MapSubmap): MapRegion {
    return {
      id: "r1",
      parentId: null,
      level: 0,
      name: "区块",
      seed: { x: 0, y: 0 },
      polygon: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      color: 0xffffff,
      submap,
    };
  }

  it("子图元素 flipX = true：精灵 scale.x 为负、位置不位移；缺省：为正", () => {
    const submap = makeSubmapWith([
      { ...elem("s1", "mountain-20", null), flipX: true },
      elem("s2", "mountain-20", null),
    ]);
    // buildSubmapNode(parent, region, parentScale, env)：jsdom 无 WebGL，
    // 替身容器只当挂载点用
    const container = new Container();
    const node = buildSubmapNode(
      container as never,
      regionWithSubmap(submap),
      2.2,
      env,
    );
    expect(node).not.toBeNull();
    const subSprites = sprites.filter((s) => s.width === BASE);
    expect(subSprites, "两个素材各建一个精灵").toHaveLength(2);
    const flipped = subSprites.filter((s) => s.scale.x < 0);
    const plain = subSprites.filter((s) => s.scale.x > 0);
    expect(flipped, "恰好一个翻面").toHaveLength(1);
    expect(plain, "恰好一个原样").toHaveLength(1);
    // 翻转精灵的位置 = 元素自己的子图本地坐标（不被翻转位移）
    expect(flipped[0].positionCalls.at(-1)).toEqual([0, 0]);
    expect(plain[0].positionCalls.at(-1)).toEqual([0, 0]);
  });

  it("子图元素 flipX = 'true' 脏档：不翻转", () => {
    const submap = makeSubmapWith([
      { ...elem("s1", "mountain-20", null), flipX: "true" as unknown as boolean },
    ]);
    const container = new Container();
    const node = buildSubmapNode(
      container as never,
      regionWithSubmap(submap),
      2.2,
      env,
    );
    expect(node).not.toBeNull();
    const subSprites = sprites.filter((s) => s.width === BASE);
    expect(subSprites).toHaveLength(1);
    expect(subSprites[0].scale.x).toBeGreaterThan(0);
  });
});

/* ───── QA 边界补钉：子图区块静态衰减（行为级，守卫只钉了源码形态） ───── */

describe("子图内区块静态衰减（buildSubmapNode 行为级）", () => {
  const env: SubmapEnvRef = {
    current: { renderer: null, textures: {}, baseResolution: 1 },
  };

  function submapRegion(level: number): MapRegion {
    return {
      id: `r_${level}`,
      parentId: null,
      level,
      name: `区块${level}`,
      seed: { x: 0, y: 0 },
      polygon: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 50 },
        { x: 0, y: 50 },
      ],
      color: 0xffffff,
    };
  }

  /** 只建子图节点（不渲染父 MapCanvas）⇒ graphics 里全是子图的绘制调用 */
  function buildWith(regions: MapRegion[]): FakeGraphicsRef[] {
    const submap: MapSubmap = {
      id: "sm_1",
      bounds: { x: -50, y: -50, width: 100, height: 100 },
      land: null,
      regions,
      elements: [],
      labels: [],
      style: "none",
      baseImageId: "base-1",
    };
    const node = buildSubmapNode(
      new Container() as never,
      {
        id: "r1",
        parentId: null,
        level: 0,
        name: "区块",
        seed: { x: 0, y: 0 },
        polygon: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
        color: 0xffffff,
        submap,
      },
      2.2,
      env,
    );
    expect(node).not.toBeNull();
    return graphics;
  }

  const alphaOf = (options: unknown): number | undefined =>
    (options as { alpha?: number } | undefined)?.alpha;

  it("子图 level=2 的区块：实际填充 alpha = regionFillAlphaOf(2)（同一张表）", () => {
    const gs = buildWith([submapRegion(2)]);
    const fillAlphas = gs.flatMap((g) => g.fills.map(alphaOf));
    expect(fillAlphas).toContain(regionFillAlphaOf(2));
    // 没有漏乘静态系数的旧路径
    expect(fillAlphas).not.toContain(REGION_FILL_ALPHA);
  });

  it("子图 level=99 越界区块：系数回落 1，alpha = 全局填充（朝不衰减兜底）", () => {
    const gs = buildWith([submapRegion(99)]);
    const fillAlphas = gs.flatMap((g) => g.fills.map(alphaOf));
    expect(fillAlphas).toContain(regionFillAlphaOf(99));
    expect(regionFillAlphaOf(99)).toBe(REGION_FILL_ALPHA);
  });

  it("子图边界与填充同表：level=2 的 stroke alpha = regionBorderAlphaOf(2)", () => {
    const gs = buildWith([submapRegion(2)]);
    const strokeAlphas = gs.flatMap((g) => g.strokes.map(alphaOf));
    expect(strokeAlphas).toContain(regionBorderAlphaOf(2));
    expect(strokeAlphas).not.toContain(REGION_BORDER_ALPHA);
    // 边界 : 填充的浓度比与全局比恒等（同一张表的直接推论）
    expect(regionBorderAlphaOf(2) / regionFillAlphaOf(2)).toBeCloseTo(
      REGION_BORDER_ALPHA / REGION_FILL_ALPHA,
      10,
    );
  });
});
