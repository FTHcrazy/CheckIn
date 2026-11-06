import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORLD_LAYER_ORDER, worldLayerIndexOf, type WorldLayerName } from "./layers";

/**
 * 海岸烘焙在组件层的回归测试（PRD §6.1.4 / 架构 T03 第 5 步）。
 *
 * 与 `coastBake.test.ts` 的分工：那边测**纯函数**（尺寸、坐标系、四层装配），
 * 这里测**触发时机** —— 什么时候该重建、什么时候必须不重建。
 *
 * 三条断言对应三个真实故障：
 *   · 同指纹却重建 → 滚轮每格都做三次高斯模糊，帧率塌；
 *   · 换了陆地不重建 → "生成陆地了但海岸还是旧的"，静默错误；
 *   · land 变 null 不清空 → 撤销「生成陆地」后海岸还挂在画面上。
 */

interface FakeNode {
  children: FakeNode[];
  alpha: number;
  visible: boolean;
  texture: unknown;
  width: number;
  height: number;
  /** 风格滤镜挂载点：本文件要断言"哪些节点挂了、哪些一个都没挂" */
  filters: unknown[];
}

/**
 * 按**名字**取 world 的某个图层。
 *
 * 禁止裸下标：加一层不该让一堆断言连带变红（架构 §6-1）。
 * 顺序的唯一定义处是 `layers.ts` 的 `WORLD_LAYER_ORDER`。
 */
function layerOf(world: FakeNode, name: WorldLayerName): FakeNode {
  return world.children[worldLayerIndexOf(name)];
}

/** 每次 RenderTexture.create 的参数（用来数"重建了几次"） */
const created: Array<{ width: number; height: number }> = [];
/** 所有假纹理对象，按创建顺序 */
const textures: Array<{ destroy: ReturnType<typeof vi.fn> }> = [];
const apps: Array<{ stage: FakeNode; renderer: { render: ReturnType<typeof vi.fn> } }> = [];

/**
 * 假包围盒的全局开关（仅剔除用例使用）。
 *
 * `null`（默认）= 原点零矩形，与任何含原点的视野框恒相交 ⇒ 一个都不剔。
 * 剔除用例把它设成"远在天边"的矩形，就能真的观察到 `visible` 被写成 false。
 * 用 `vi.hoisted` 是因为 `vi.mock` 的工厂会被提升到文件最顶端。
 */
const boundsOverride = vi.hoisted(() => ({
  value: null as null | { minX: number; minY: number; maxX: number; maxY: number },
}));

vi.mock("pixi.js", () => {
  class FakeContainer {
    children: FakeNode[] = [];
    alpha = 1;
    visible = true;
    filters: unknown[] = [];
    mask: unknown = null;
    width = 0;
    height = 0;
    texture: unknown = null;
    blendMode = "normal";
    anchor = { set: vi.fn() };
    position = { x: 0, y: 0, set: vi.fn() };
    scale = { x: 1, y: 1, set: vi.fn() };
    addChild(...kids: unknown[]) {
      this.children.push(...(kids as FakeNode[]));
      return kids[0];
    }
    removeChild() {}
    destroy() {}
    /**
     * 剔除要读的包围盒。
     *
     * 返回原点处的零矩形 ⇒ 与任何"含原点"的视野框都相交 ⇒ 默认**不会**把层
     * 剔掉。这个文件断言的是 `coast.visible` 与烘焙次数，剔除若在这里悄悄
     * 把某层藏了，红的是别的用例、根因却在这 —— 所以让替身默认"永远可见"。
     */
    getLocalBounds() {
      return boundsOverride.value ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
    /**
     * 局部 → 舞台。jsdom 里没有真实的变换矩阵（替身的 `position.set` 不累积状态），
     * 因此按恒等处理。**本文件的剔除用例只验证"接线"**（哪些层会被写 `visible`、
     * 父容器与全幅层有没有被误碰），**不验证**"缓存是否跨视口复用" ——
     * 那条的真实验证在 `cull.test.ts` 的「回归 S-1」用例里（替身复刻了
     * "舞台包围盒随视口变化"这一关键性质）。
     */
    toGlobal(point: { x: number; y: number }) {
      return { x: point.x, y: point.y };
    }
    /** 舞台空间包围盒：修复 S-1 后剔除**不应**再调用它（保留只为兜住误用） */
    getBounds() {
      return boundsOverride.value ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    }
    /** 静态层缓存：jsdom 没有 WebGL，只记"调过"这一事实 */
    cacheAsTexture = vi.fn();
    updateCacheTexture = vi.fn();
  }
  class FakeGraphics extends FakeContainer {
    moveTo() {
      return this;
    }
    /**
     * 折线绘制（B4-2）会走 `moveTo` / `lineTo` + `stroke`。
     * 替身**缺方法不是静默跳过，是 TypeError** —— 折线层一接进来，
     * 所有挂载画布的文件都会在 effect 里炸，而报错指向折线而不是替身。
     */
    lineTo() {
      return this;
    }
    bezierCurveTo() {
      return this;
    }
    closePath() {
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
    rect() {
      return this;
    }
    /** 折线节点手柄 / 绘制态顶点用（B4-2）：缺方法同样是 TypeError */
    circle() {
      return this;
    }
    clear() {
      return this;
    }
  }
  class FakeSprite extends FakeContainer {
    constructor(texture?: unknown) {
      super();
      this.texture = texture ?? null;
    }
  }
  /**
   * 纸纹平铺精灵替身。
   *
   * 【必须补】`coastBake` 现在用 `TilingSprite` 铺纸纹（见 `LAND_TEXTURE_STEPS`），
   * 而 `vi.mock` 的工厂**缺导出不是"取到 undefined"，是直接抛错** ——
   * 少了这条，本文件所有烘焙用例都会在 effect 里抛
   * "No 'TilingSprite' export is defined on the 'pixi.js' mock"。
   */
  class FakeTilingSprite extends FakeSprite {
    tilePosition = { x: 0, y: 0, set: vi.fn() };
    tileScale = { x: 1, y: 1, set: vi.fn() };
    constructor(options?: { texture?: unknown; width?: number; height?: number }) {
      super(options?.texture ?? null);
      this.width = options?.width ?? 0;
      this.height = options?.height ?? 0;
    }
  }
  /**
   * 文字与样式替身。
   *
   * 【必须补】`vi.mock` 的工厂**缺导出会在 import 阶段直接抛错**，而
   * `labelSync.ts` 在模块顶层就 import 了 `Text` / `TextStyle` —— 只要 MapCanvas
   * 引入标注层，这两个导出就必须存在，否则整个文件在 import 阶段就红。
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
    constructor(options?: unknown) {
      super();
      const o = options as { text?: string } | undefined;
      this.text = typeof o?.text === "string" ? o.text : "";
    }
  }
  class BlurFilter {
    constructor(options?: unknown) {
      void options;
    }
  }
  /**
   * 风格滤镜替身。
   *
   * 【必须补】`style.ts` 在模块顶层 `import { ColorMatrixFilter } from "pixi.js"`，
   * 而 `vi.mock` 的工厂**缺导出会在 import 阶段直接抛错** —— 只加一条风格
   * 逻辑就会让整个文件的用例在收集阶段全红，报错还指向别的文件。
   *
   * 这里刻意只保留 `matrix` 与 `destroy`：本文件不测颜色映射（那是
   * `style.test.ts` 的事），只需要"它存在、能被赋值"。
   */
  class ColorMatrixFilter {
    matrix: number[] = [];
    destroy = vi.fn();
  }
  class RenderTexture {
    destroy = vi.fn();
    static create(options: { width: number; height: number }) {
      created.push(options);
      const rt = new RenderTexture();
      textures.push(rt);
      return rt;
    }
  }
  class Application {
    canvas = document.createElement("canvas");
    stage = new FakeContainer();
    renderer = { render: vi.fn() };
    init = vi.fn(async () => {});
    destroy = vi.fn();
    constructor() {
      apps.push(this as unknown as (typeof apps)[number]);
    }
  }
  const Texture = { EMPTY: Symbol("empty") };
  return {
    Application,
    Container: FakeContainer,
    Graphics: FakeGraphics,
    Sprite: FakeSprite,
    TilingSprite: FakeTilingSprite,
    BlurFilter,
    ColorMatrixFilter,
    /* 子图羽化的隔离滤镜替身（submapRender 给 content 挂它，让 erase 只擦子图纹理） */
    AlphaFilter: class {
      alpha = 1;
    },
    RenderTexture,
    Texture,
    Text,
    TextStyle,
  };
});

// 依赖 mock 之后再导入被测组件
import { Texture } from "pixi.js";
import MapCanvas from "./index";
import { generateLand } from "../../land";
import type { MapDocument, MapLand, Rect } from "../../types";

const BOUNDS: Rect = { x: -512, y: -512, width: 1024, height: 1024 };
const LAND_A: MapLand = generateLand({ seed: 20261009, bounds: BOUNDS, islands: 1 });
const LAND_B: MapLand = generateLand({ seed: 4242, bounds: BOUNDS, islands: 2 });

const noop = () => {};

function tree(options: {
  land?: MapLand | null;
  viewportScale?: number;
  style?: "none" | "ink";
  showRegions?: boolean;
  levelAlphas?: number[];
  enableCulling?: boolean;
  layerState?: MapDocument["layerState"];
}) {
  const showRegions = options.showRegions ?? true;
  return (
    <div style={{ width: 800, height: 600 }}>
      <MapCanvas
        doc={{
          version: 2,
          baseImageId: "base-1",
          land: options.land ?? null,
          style: options.style ?? "none",
          labels: [],
          showRegions,
          elements: [],
          regions: [],
          ...(options.layerState ? { layerState: options.layerState } : {}),
        }}
        land={options.land ?? null}
        style={options.style ?? "none"}
        showRegions={showRegions}
        viewport={{ x: 0, y: 0, scale: options.viewportScale ?? 1 }}
        textures={{}}
        texturesReady
        selectedId={null}
        pendingSpriteId={null}
        levelAlphas={options.levelAlphas ?? []}
        enableCulling={options.enableCulling ?? true}
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

/** 放行 Pixi 的异步 init，并把由此触发的提交排干 */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * 给画布容器一个真实尺寸（800 × 600）。
 *
 * 【为什么必须】jsdom 的 `getBoundingClientRect()` 恒返回 0 尺寸，画布据此把
 * `size` 初始化为 `{0,0}`，而剔除在"画布还没有尺寸"时会跳过 —— 于是所有与
 * 剔除有关的断言都会测到"什么都没发生"，永远绿。返回一个复原函数。
 */
function stubCanvasRect() {
  const rect = {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON: () => ({}),
  } as DOMRect;
  const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
  return () => spy.mockRestore();
}

/**
 * 场景图上的 world → coast → coastSprite。
 *
 * 【为什么按名字取图层】以前这里写的是 `world.children[1]` 加一句"索引为什么是 1"
 * 的注释 —— 加一层（T5 的 `draftLayer`）就要回来改注释和所有裸下标，而失败信息
 * 只是"长度不对"。现在一律走 `layerOf()`，顺序的唯一定义处是 `layers.ts`。
 */
function nodes() {
  const world = apps[0].stage.children[0] as unknown as FakeNode;
  const coast = layerOf(world, "coast");
  const sprite = coast.children[0] as unknown as FakeNode;
  return { world, coast, sprite };
}

beforeEach(() => {
  created.length = 0;
  textures.length = 0;
  apps.length = 0;
});

describe("MapCanvas 海岸烘焙", () => {
  it("首次有陆地：烘一次，coast 可见，图层数与 WORLD_LAYER_ORDER 一致", async () => {
    render(tree({ land: LAND_A }));
    await flush();

    expect(created).toHaveLength(1);
    const { world, coast, sprite } = nodes();
    // +1：regionMask（区块层陆地掩膜）挂在 world 末尾，不占 WORLD_LAYER_ORDER 槽位
    expect(world.children).toHaveLength(WORLD_LAYER_ORDER.length + 1);
    expect(coast.visible).toBe(true);
    expect(sprite.texture).toBe(textures[0]);
    expect((apps[0].renderer.render as unknown as { mock: { calls: unknown[] } }).mock.calls)
      .toHaveLength(1);
  });

  it("同一块陆地重渲染（含视口变化）：一次都不重建", async () => {
    const { rerender } = render(tree({ land: LAND_A }));
    await flush();
    expect(created).toHaveLength(1);

    // 视口变化是最高频的操作 —— 它绝不能触发重烘（烘焙的唯一输入不含 viewport）
    rerender(tree({ land: LAND_A, viewportScale: 2.5 }));
    await flush();
    rerender(tree({ land: LAND_A, viewportScale: 0.4 }));
    await flush();

    expect(created).toHaveLength(1);
  });

  it("换陆地：重建一次，且旧纹理在**新纹理挂上之后**才销毁", async () => {
    const { rerender } = render(tree({ land: LAND_A }));
    await flush();
    const first = textures[0];

    rerender(tree({ land: LAND_B }));
    await flush();

    expect(created).toHaveLength(2);
    const { sprite } = nodes();
    // 先算新的 → 成功后原子替换 → 再销毁旧的（避免闪一帧空白）
    expect(sprite.texture).toBe(textures[1]);
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(textures[1].destroy).not.toHaveBeenCalled();
  });

  it("换风格：重烘一次，风格烤在纹理里、海岸容器自己不挂滤镜（N-2）", async () => {
    const { rerender } = render(tree({ land: LAND_A, style: "none" }));
    await flush();
    expect(created).toHaveLength(1);

    rerender(tree({ land: LAND_A, style: "ink" }));
    await flush();
    expect(created).toHaveLength(2);

    // 新纹理真的换上了（不是"重烘了但画面没变"）
    const { coast, sprite } = nodes();
    expect(sprite.texture).toBe(textures[1]);
    // 【N-2 的关键】风格已经在海岸纹理里，容器上再挂一次就是同一个矩阵乘两遍
    expect(coast.filters).toHaveLength(0);
  });

  it("land 变 null：清空纹理并隐藏海岸层（撤销「生成陆地」的信号）", async () => {
    const { rerender } = render(tree({ land: LAND_A }));
    await flush();
    const first = textures[0];

    rerender(tree({ land: null }));
    await flush();

    const { coast, sprite } = nodes();
    expect(coast.visible).toBe(false);
    expect(sprite.texture).toBe(Texture.EMPTY);
    expect(first.destroy).toHaveBeenCalledTimes(1);
    // 容器不销毁：下次生成陆地时直接复用，避免重建场景图
    expect(coast.children).toHaveLength(1);
  });

  it("land 从 null 变有值：重新烘出来（撤销后重做）", async () => {
    const { rerender } = render(tree({ land: null }));
    await flush();
    expect(created).toHaveLength(0);
    expect(nodes().coast.visible).toBe(false);

    rerender(tree({ land: LAND_A }));
    await flush();
    expect(created).toHaveLength(1);
    expect(nodes().coast.visible).toBe(true);
  });

  it("卸载时释放最后一张纹理（4096² RT 约 64MB，漏一次就涨一次）", async () => {
    const { unmount } = render(tree({ land: LAND_A }));
    await flush();
    const first = textures[0];

    unmount();
    await flush();
    expect(first.destroy).toHaveBeenCalledTimes(1);
  });

  it("无陆地时完全不建 RenderTexture（缺省 = 老用法）", async () => {
    render(tree({ land: null }));
    await flush();
    expect(created).toHaveLength(0);
    expect((apps[0].renderer.render as unknown as { mock: { calls: unknown[] } }).mock.calls)
      .toHaveLength(0);
  });

  /**
   * 「显示分区」开关（架构 T04 第 4.3 步）。
   *
   * 【为什么只允许改容器 alpha】关掉分区是"给读者看的成品图"，用户会频繁切换：
   * 条件渲染会让 223 个多边形、约 1.5 万顶点每次重画；改 alpha 是一次赋值。
   * 这里把"几何一点没动"也钉住 —— 层级容器的子节点数不能变。
   */
  it("关掉显示分区：只把 regionLayer 的 alpha 归零，几何一个都没重建", async () => {
    // 给一个层级权重，让区块层真的建出"容器 + 填充 + 边界"三个节点
    const { rerender } = render(tree({ land: null, showRegions: true, levelAlphas: [1] }));
    await flush();

    const world = apps[0].stage.children[0] as unknown as FakeNode;
    const regionLayer = layerOf(world, "regionLayer");
    expect(regionLayer.alpha).toBe(1);
    expect(regionLayer.children).toHaveLength(1);
    const childCount = regionLayer.children[0].children.length;
    expect(childCount).toBe(2); // 填充 + 边界

    rerender(tree({ land: null, showRegions: false, levelAlphas: [1] }));
    await flush();

    expect(regionLayer.alpha).toBe(0);
    // 容器与子节点一个都没少：关掉只是"不显示"，不是"不渲染"
    expect(regionLayer.children).toHaveLength(1);
    expect(regionLayer.children[0].children).toHaveLength(childCount);

    // 再打开：回到 1（开关是可逆的，不销毁任何东西）
    rerender(tree({ land: null, showRegions: true, levelAlphas: [1] }));
    await flush();
    expect(regionLayer.alpha).toBe(1);
  });

  /**
   * 风格滤镜的挂载纪律（B4 / PRD §6.4 + 返工 N-2）。
   *
   * 【分工】海岸在**烘焙期**上色（矩阵烤进纹理），其余三层在运行期换 filters。
   * 挂错节点**不会报错**，只会让某一块颜色不对：
   *   · 海岸额外挂一次 → 同一个矩阵乘两遍（羊皮纸明显发暗发黄）；
   *   · 挂在 `world` 上 → 选中框、四周留白一起被染色；
   *   · 挂在 `overlay` 上 → 选中框变淡，"看起来没选中"；
   *   · 挂在被缓存的 `staticLayer` 上 → 被缓存节点吞掉自己的滤镜（白挂）。
   * 四种错法都只在"盯着画面慢慢来回切"时才看得出来，所以钉在这里。
   */
  it("切风格：只有 region / element / label 三层挂滤镜，coast 与 world、静态层、overlay 一个都没有", async () => {
    const { rerender } = render(tree({ land: LAND_A, style: "none", levelAlphas: [1] }));
    await flush();

    const { world } = nodes();
    const staticLayer = layerOf(world, "staticLayer");
    const coast = layerOf(world, "coast");
    const regionLayer = layerOf(world, "regionLayer");
    const elementLayer = layerOf(world, "elementLayer");
    const submapLayer = layerOf(world, "submapLayer");
    const labelLayer = layerOf(world, "labelLayer");
    const overlay = layerOf(world, "overlay");
    // submapLayer 属 z 序之一，本用例只关心滤镜挂载，不逐个断言它
    void submapLayer;

    // 原色：三层都是空数组（不是 undefined —— 说明确实赋过空值）
    for (const node of [regionLayer, elementLayer, labelLayer]) {
      expect(node.filters).toHaveLength(0);
    }

    rerender(tree({ land: LAND_A, style: "ink", levelAlphas: [1] }));
    await flush();

    for (const node of [regionLayer, elementLayer, labelLayer]) {
      expect(node.filters).toHaveLength(1);
    }
    // 三层共用同一个实例：一次切风格只造一个滤镜，不是三份
    expect(regionLayer.filters[0]).toBe(labelLayer.filters[0]);

    // 这四处绝不能挂
    expect(coast.filters).toHaveLength(0);
    expect(world.filters).toHaveLength(0);
    expect(staticLayer.filters).toHaveLength(0);
    expect(overlay.filters).toHaveLength(0);

    // 切回原色：数组清空（这就是"原色"真正生效的地方）
    rerender(tree({ land: LAND_A, style: "none", levelAlphas: [1] }));
    await flush();
    for (const node of [regionLayer, elementLayer, labelLayer]) {
      expect(node.filters).toHaveLength(0);
    }
  });

  /**
   * 视口剔除的接线（B5 / PRD §6.6.1）。
   *
   * 【为什么必须有一条"真的把某层藏了"的用例】纯函数用例只能证明 `intersect`
   * 算得对，证明不了**接上了没有**：effect 少写一个依赖、或者遍历错了对象，
   * 表现都是"什么都没发生"，测试全绿但功能不存在。
   *
   * 【为什么必须同时断言三层"不许动"】`coast` / 静态层 / `overlay` 是全幅内容，
   * 一旦被判成不可见：`staticLayer` 会在下次 `updateCacheTexture()` 时烤出
   * 一张**空纹理**（之后怎么缩放都是白的），这是无法自愈的破坏。
   */
  it("剔除：视野外的层级容器被置为不可见，但 coast / 静态层 / overlay 一个都不碰", async () => {
    // jsdom 的 getBoundingClientRect 恒返回 0 尺寸，而剔除在"画布还没有尺寸"时
    // 会直接跳过（那是真实存在的首帧状态）。这里必须给出真实尺寸，
    // 否则整条用例测的是"什么都没发生"，永远绿。
    const restoreRect = stubCanvasRect();

    // 先正常渲染一次，确认默认（包围盒在原点）不会误剔
    const first = render(tree({ land: LAND_A, levelAlphas: [1] }));
    await flush();
    const before = apps[0].stage.children[0] as unknown as FakeNode;
    expect(layerOf(before, "regionLayer").children[0].visible).toBe(true);
    first.unmount();

    // 把所有包围盒挪到"远在天边"，重新挂一次 —— 层级容器必须被藏起来
    boundsOverride.value = { minX: 9000, minY: 9000, maxX: 9500, maxY: 9500 };
    apps.length = 0;
    const second = render(tree({ land: LAND_A, levelAlphas: [1] }));
    await flush();

    const world = apps[0].stage.children[0] as unknown as FakeNode;
    const staticLayer = layerOf(world, "staticLayer");
    const coast = layerOf(world, "coast");
    const regionLayer = layerOf(world, "regionLayer");
    const elementLayer = layerOf(world, "elementLayer");
    const submapLayer = layerOf(world, "submapLayer");
    const labelLayer = layerOf(world, "labelLayer");
    const overlay = layerOf(world, "overlay");
    // 层级容器（regionLayer 的子容器）被剔掉
    expect(regionLayer.children[0].visible).toBe(false);
    // 但父容器与三层全幅内容必须原样可见
    expect(regionLayer.visible).toBe(true);
    expect(staticLayer.visible).toBe(true);
    expect(coast.visible).toBe(true);
    expect(overlay.visible).toBe(true);
    expect(elementLayer.visible).toBe(true);
    expect(submapLayer.visible).toBe(true);
    expect(labelLayer.visible).toBe(true);
    second.unmount();
    boundsOverride.value = null;
    restoreRect();
  });

  it("关掉剔除：即便包围盒在视野外也保持可见（测试里必须能一键关掉）", async () => {
    const restoreRect = stubCanvasRect();
    boundsOverride.value = { minX: 9000, minY: 9000, maxX: 9500, maxY: 9500 };
    apps.length = 0;
    render(tree({ land: LAND_A, levelAlphas: [1], enableCulling: false }));
    await flush();

    const world = apps[0].stage.children[0] as unknown as FakeNode;
    const regionLayer = layerOf(world, "regionLayer");
    expect(regionLayer.children[0].visible).toBe(true);
    boundsOverride.value = null;
    restoreRect();
  });
});

/**
 * 逻辑图层显隐（B4-1）。
 *
 * 【为什么在画布层钉】面板把状态写进文档之后，"关掉素材层素材还在画面上"这种
 * 断裂只可能发生在两处：文档没传到画布，或传到了但没人消费。前者由面板/store
 * 的用例覆盖，后者只有真挂一次画布才看得见。
 *
 * 【为什么断言 `visible` 而不是 `alpha`】这三个层是"有就画、没有就空"的纯内容层，
 * 关掉用 `visible=false` 整棵子树都不进渲染；`regionLayer` 仍走 `alpha`
 * （它要在半透明填充下继续透出陆地材质，见上一组用例）。
 */
describe("MapCanvas 逻辑图层显隐", () => {
  it("关掉素材层：elementLayer.visible 变 false，其余层不受影响", async () => {
    const { rerender } = render(tree({ land: null, layerState: {} }));
    await flush();

    const world = apps[0].stage.children[0] as unknown as FakeNode;
    expect(layerOf(world, "elementLayer").visible).toBe(true);

    rerender(tree({ land: null, layerState: { element: { visible: false } } }));
    await flush();

    expect(layerOf(world, "elementLayer").visible).toBe(false);
    expect(layerOf(world, "labelLayer").visible).toBe(true);
    expect(layerOf(world, "submapLayer").visible).toBe(true);

    // 再打开：回到可见（开关可逆，不销毁任何几何）
    rerender(tree({ land: null, layerState: {} }));
    await flush();
    expect(layerOf(world, "elementLayer").visible).toBe(true);
  });

  it("地名 / 子图各关各的（三层的开关互不串台）", async () => {
    render(tree({ land: null, layerState: { label: { visible: false }, submap: { visible: false } } }));
    await flush();

    const world = apps[0].stage.children[0] as unknown as FakeNode;
    expect(layerOf(world, "labelLayer").visible).toBe(false);
    expect(layerOf(world, "submapLayer").visible).toBe(false);
    expect(layerOf(world, "elementLayer").visible).toBe(true);
  });

  it("锁定不影响渲染（锁 ≠ 隐藏）：locked 只由命中测试消费", async () => {
    render(tree({ land: null, layerState: { element: { locked: true } } }));
    await flush();

    const world = apps[0].stage.children[0] as unknown as FakeNode;
    expect(layerOf(world, "elementLayer").visible).toBe(true);
    expect(layerOf(world, "elementLayer").alpha).toBe(1);
  });
});
