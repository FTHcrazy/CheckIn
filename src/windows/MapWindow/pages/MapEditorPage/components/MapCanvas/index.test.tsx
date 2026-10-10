import { StrictMode } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  stage: { addChild: ReturnType<typeof vi.fn> };
}

/** 本次渲染期间创建的全部假精灵 —— 用于断言"它挂在哪个容器下、那个容器多透明" */
interface FakeSpriteRef {
  width: number;
  height: number;
  parent: FakeContainerRef | null;
}
interface FakeContainerRef {
  alpha: number;
  children: unknown[];
}

let apps: FakeApp[] = [];
let sprites: FakeSpriteRef[] = [];
/** init 调用是否已完成；未完成时 destroy 复刻真实插件的抛错行为 */
let initSettled = false;

vi.mock("pixi.js", () => {
  class FakeContainer {
    children: unknown[] = [];
    parent: FakeContainer | null = null;
    /** 容器透明度：素材层靠它做层级交叉淡化 */
    alpha = 1;
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
  }

  class FakeSprite extends FakeContainer {
    anchor = { set: vi.fn() };
    width = 0;
    height = 0;
    rotation = 0;
    texture: unknown = null;
    constructor() {
      super();
      sprites.push(this as unknown as FakeSpriteRef);
    }
  }

  class FakeGraphics extends FakeContainer {
    clear() {}
    rect() {
      return this;
    }
    poly() {
      return this;
    }
    fill() {
      return this;
    }
    stroke() {
      return this;
    }
  }

  class Application {
    canvas = document.createElement("canvas");
    stage = new FakeContainer();
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

  const initDeferred = createDeferred<void>();
  // 暴露给测试，用于放行 init
  (globalThis as Record<string, unknown>).__releaseInit = () => initDeferred.resolve();

  const Texture = { EMPTY: Symbol("empty") };
  return { Application, Container: FakeContainer, Sprite: FakeSprite, Graphics: FakeGraphics, Texture };
});

// 依赖 mock 之后再导入被测组件
import MapCanvas from "./index";
import type { MapDocument } from "../../types";

function makeDoc(elements: MapDocument["elements"] = []): MapDocument {
  return { version: 1, baseImageId: "base-1", elements, regions: [] };
}

const noop = () => {};

function canvasTree(options: { doc?: MapDocument; levelAlphas?: number[] } = {}) {
  return (
    <div style={{ width: 800, height: 600 }}>
      <MapCanvas
        doc={options.doc ?? makeDoc()}
        viewport={{ x: 0, y: 0, scale: 1 }}
        textures={{}}
        texturesReady={false}
        selectedId={null}
        pendingSpriteId={null}
        levelAlphas={options.levelAlphas}
        onSizeChange={noop}
        onWheel={noop}
        onPan={noop}
        onCanvasClickWorld={noop}
        onElementDragStart={noop}
        onElementDragDelta={noop}
      />
    </div>
  );
}

function renderCanvas(
  strict: boolean,
  options: { doc?: MapDocument; levelAlphas?: number[] } = {},
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
function elem(id: string, spriteId: string, level: number | null): MapDocument["elements"][number] {
  return { id, spriteId, x: 0, y: 0, scale: 1, rotation: 0, level };
}

beforeEach(() => {
  apps = [];
  sprites = [];
  initSettled = false;
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
  /** 山脉（mountain-20）baseWidth = 120，森林（forest-1）= 90，据此认出各自精灵 */
  const MOUNTAIN_W = 120;
  const FOREST_W = 90;

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
    expect(findSprite(MOUNTAIN_W).parent?.alpha).toBe(1);
    expect(findSprite(FOREST_W).parent?.alpha).toBe(1);
    // 两个素材必须在**不同**容器里，否则"按层级显隐"无从谈起
    expect(findSprite(MOUNTAIN_W).parent).not.toBe(findSprite(FOREST_W).parent);

    // ── 缩到「洲」那一级：郡的权重归 0，山随之消失 ──
    rerender(canvasTree({ doc, levelAlphas: [0, 1, 0, 0] }));
    await act(async () => {});

    expect(findSprite(MOUNTAIN_W).parent?.alpha).toBe(0);
    // 层级无关的素材不受任何层级切换影响
    expect(findSprite(FOREST_W).parent?.alpha).toBe(1);
  });

  it("交叉带里两级各半：素材按自己的层级权重呈现，不会一档全亮一档全灭", async () => {
    const doc = makeDoc([elem("a", "mountain-20", 2), elem("b", "forest-1", 3)]);
    renderCanvas(false, { doc, levelAlphas: [0, 0, 0.5, 0.5] });
    await flushInit();

    // 国家级素材 50%、郡级素材 50% —— 正是"上一级淡出的同时下一级淡入"
    expect(findSprite(MOUNTAIN_W).parent?.alpha).toBeCloseTo(0.5, 6);
    expect(findSprite(FOREST_W).parent?.alpha).toBeCloseTo(0.5, 6);
  });

  it("层级数变少时越界素材并入最细一级，不会永久消失", async () => {
    const doc = makeDoc([elem("a", "mountain-20", 3)]);
    // 只剩两级：level 3 的素材应当并到第 1 级（= 0.5），而不是被藏起来
    renderCanvas(false, { doc, levelAlphas: [0.5, 0.5] });
    await flushInit();

    const mountain = findSprite(MOUNTAIN_W);
    expect(mountain.parent?.alpha).toBeCloseTo(0.5, 6);
    // 且它必须挂在"层级 1"的容器下，而不是那个已经不在场景里的旧容器
    expect(mountain.parent).not.toBeNull();
  });
});
