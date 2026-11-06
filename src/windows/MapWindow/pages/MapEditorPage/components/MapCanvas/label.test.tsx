import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { worldLayerIndexOf } from "./layers";

/**
 * 标注层的渲染契约（PRD §6.3.4 四条 + 两条纪律）。
 *
 * 为什么这一层必须单独测：`labelSync.ts` 的名字叫"增量同步"，而"增量"这件事
 * **在画面上看不出来** —— 每帧重建 300 个 Text 与只改 300 个 scale，截图一模一样，
 * 差别只在滚轮时掉不掉帧。所以这里用 mock 数**构造次数**：
 *
 *   · 视口变化后 `Text` 构造次数不增加 ⇒ 增量成立；
 *   · 每个节点的 `scale.set` 收到 `1/scale` ⇒ 屏幕恒定字号成立。
 *
 * 另外三条是"看不见但不能错"的：层级容器 alpha 与素材同源、删标注要真销毁节点、
 * 避让只动渲染句柄绝不写回文档。
 */

interface FakeNode {
  alpha: number;
  destroyed: boolean;
  parent: FakeNode | null;
  children: FakeNode[];
  text: string;
  resolution: number;
  style: { fontSize?: number; fontFamily?: string; stroke?: unknown; align?: string } | null;
  scaleValue: number;
  positionValue: { x: number; y: number };
}

const { texts, styles, apps } = vi.hoisted(() => ({
  texts: [] as unknown[],
  styles: [] as Array<Record<string, unknown>>,
  apps: [] as unknown[],
}));

vi.mock("pixi.js", () => {
  class FakeContainer {
    children: FakeContainer[] = [];
    parent: FakeContainer | null = null;
    alpha = 1;
    visible = true;
    /** 风格滤镜挂在层级容器之外的四层上；本文件不测滤镜，只要有这个字段 */
    filters: unknown[] = [];
    destroyed = false;
    scaleValue = 1;
    positionValue = { x: 0, y: 0 };
    scale = {
      set: (v: number) => {
        this.scaleValue = v;
      },
    };
    position = {
      set: (x: number, y: number) => {
        this.positionValue = { x, y };
      },
    };
    addChild(...kids: unknown[]) {
      for (const kid of kids) {
        const child = kid as FakeContainer;
        child.parent?.removeChild(child);
        child.parent = this;
        this.children.push(child);
      }
      return kids[0];
    }
    removeChild(child?: unknown) {
      const i = this.children.indexOf(child as FakeContainer);
      if (i >= 0) this.children.splice(i, 1);
      if (child) (child as FakeContainer).parent = null;
    }
    destroy() {
      this.destroyed = true;
    }
    /**
     * 剔除要读的**局部**包围盒（与视口无关，可安全缓存；见 `cull.ts` 文件头）。
     * 返回原点零矩形 ⇒ 与含原点的视野框恒相交 ⇒ 默认不会剔掉任何层，
     * 本文件的"容器 alpha / Text 个数"断言不受剔除干扰。
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
  }

  class FakeGraphics extends FakeContainer {
    clear() {
      return this;
    }
    rect() {
      return this;
    }
    /** 折线节点手柄 / 绘制态顶点用（B4-2）：缺方法同样是 TypeError */
    circle() {
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
  }

  /** 文字替身：**构造次数**就是"重建了几次"，这是本文件的核心断言对象 */
  class Text extends FakeContainer {
    text = "";
    resolution = 1;
    style: { fontSize?: number } | null = null;
    anchor = { set: vi.fn() };
    constructor(options?: unknown) {
      super();
      const o = options as { text?: string; style?: { fontSize?: number } } | undefined;
      this.text = typeof o?.text === "string" ? o.text : "";
      this.style = o?.style ?? null;
      texts.push(this);
    }
    destroy() {
      super.destroy();
    }
  }

  /**
   * 样式替身：既记下构造参数，也把字段**铺到实例上**。
   *
   * 真实的 `Text` 会把 `style` 存成 `TextStyle` 实例（不是原始 options），
   * 所以 "字号对不对" 只能从实例字段读 —— mock 若只留 options，断言就只能
   * 去翻全局数组，读不出"哪个节点是几号字"。
   */
  class TextStyle {
    fontSize?: number;
    fontFamily?: string;
    fill?: unknown;
    stroke?: unknown;
    align?: string;
    constructor(options?: Record<string, unknown>) {
      styles.push(options ?? {});
      Object.assign(this as object, options ?? {});
    }
  }

  class RenderTexture {
    destroy = vi.fn();
    static create = vi.fn(() => new RenderTexture());
  }
  class BlurFilter {
    constructor(options?: unknown) {
      void options;
    }
  }
  /** 风格滤镜替身（`style.ts` 顶层 import，缺导出会在 import 阶段抛错） */
  class ColorMatrixFilter {
    matrix: number[] = [];
    destroy = vi.fn();
  }
  class Application {
    canvas = document.createElement("canvas");
    stage = new FakeContainer();
    renderer = { render: vi.fn() };
    init = vi.fn(async () => {});
    destroy = vi.fn();
    constructor() {
      apps.push(this);
    }
  }

  const Texture = { EMPTY: Symbol("empty") };
  return {
    Application,
    Container: FakeContainer,
    Sprite: FakeSprite,
    Graphics: FakeGraphics,
    Text,
    TextStyle,
    RenderTexture,
    BlurFilter,
    ColorMatrixFilter,
    /* 子图羽化的隔离滤镜替身（submapRender 给 content 挂它，让 erase 只擦子图纹理） */
    AlphaFilter: class {
      alpha = 1;
    },
    Texture,
  };
});

// 依赖 mock 之后再导入被测组件
import MapCanvas from "./index";
import type { MapLabel, MapDocument } from "../../types";

const noop = () => {};

function makeDoc(labels: MapLabel[]): MapDocument {
  return {
    version: 2,
    baseImageId: "base-1",
    land: null,
    style: "none",
    labels,
    showRegions: true,
    elements: [],
    regions: [],
  };
}

function tree(options: {
  labels: MapLabel[];
  scale?: number;
  levelAlphas?: number[];
  onLabelEditRequest?: (id: string, screen: { x: number; y: number }) => void;
}) {
  const doc = makeDoc(options.labels);
  return (
    <div style={{ width: 800, height: 600 }}>
      <MapCanvas
        doc={doc}
        labels={doc.labels}
        viewport={{ x: 0, y: 0, scale: options.scale ?? 1 }}
        textures={{}}
        texturesReady
        selectedId={null}
        pendingSpriteId={null}
        levelAlphas={options.levelAlphas}
        onLabelEditRequest={options.onLabelEditRequest}
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

/** 放行 Pixi 的异步 init，并把由此触发的提交与 effect 全部排干 */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * 场景图上的 world → labelLayer。
 *
 * 【为什么按名字取】以前写的是 `world.children[5]` 加一段"索引为什么是 5"的注释。
 * T5 在 overlay 之后插了 `draftLayer`，任何"从后往前数"的取法都会静默指错层；
 * 而 `labelLayer` 恰好还在第 6 个位置上，这种"这次碰巧没坏"的写法最危险。
 * 顺序的唯一定义处是 `layers.ts` 的 `WORLD_LAYER_ORDER`。
 */
function labelLayer() {
  const world = (apps[0] as { stage: FakeNode }).stage.children[0];
  return world.children[worldLayerIndexOf("labelLayer")];
}

/** 造 n 条标注，默认都是"层级无关" */
function labelsOf(n: number, level: number | null = null, size: 10 | 12 | 16 = 12): MapLabel[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `lb_${i}`,
    text: `地名${i}`,
    x: i * 4,
    y: i * 3,
    size,
    level,
  }));
}

const asNodes = () => texts as FakeNode[];

beforeEach(() => {
  texts.length = 0;
  styles.length = 0;
  apps.length = 0;
});

describe("标注层 · 增量与屏显字号", () => {
  /**
   * PRD §6.3.4 第一条。
   *
   * 300 条是 PRD §9 的性能口径里标注那一份配额。断言"视口变化不重建"必须用
   * **构造次数**：重建出来的 Text 与原地改 scale 的画面完全一样，只有计数能分辨。
   */
  it("300 条标注挂载后，视口变化只改 scale、不重建 Text", async () => {
    const labels = labelsOf(300);
    // 一开始就放在 200%：首帧也必须拿到 1/scale，否则会有一屏巨字（见同步 effect 的注释）
    const { rerender } = render(tree({ labels, scale: 2 }));
    await flush();

    expect(texts).toHaveLength(300);
    for (const node of asNodes()) expect(node.scaleValue).toBe(0.5);

    // ── 缩回 100% ──
    rerender(tree({ labels, scale: 1 }));
    await flush();
    expect(texts).toHaveLength(300);
    for (const node of asNodes()) expect(node.scaleValue).toBe(1);

    // ── 缩到 40%：scale = 1/0.4 = 2.5 ──
    rerender(tree({ labels, scale: 0.4 }));
    await flush();
    expect(texts).toHaveLength(300);
    for (const node of asNodes()) expect(node.scaleValue).toBeCloseTo(2.5, 6);

    // 三次渲染共用一个 Text：同一批 id 没有一个是新建的
    const distinct = new Set(texts).size;
    expect(distinct).toBe(300);
  });

  it("改文案只写 node.text，不重建节点", async () => {
    const labels = labelsOf(2);
    const { rerender } = render(tree({ labels }));
    await flush();

    const edited = labels.map((l, i) => (i === 0 ? { ...l, text: "改过的名字" } : l));
    rerender(tree({ labels: edited }));
    await flush();

    expect(texts).toHaveLength(2);
    expect(asNodes()[0].text).toBe("改过的名字");
  });

  it("新增 / 删除标注：按 id 增量，不牵动其它节点", async () => {
    const two = labelsOf(2);
    const { rerender } = render(tree({ labels: two }));
    await flush();
    expect(texts).toHaveLength(2);

    // 新增一条：只多造一个节点，前两个是同一批对象
    const three = [...two, { id: "lb_x", text: "新地名", x: 0, y: 0, size: 12 as const, level: null }];
    rerender(tree({ labels: three }));
    await flush();
    expect(texts).toHaveLength(3);
    expect(asNodes()[2].text).toBe("新地名");

    // 删掉中间那一条：对应节点被销毁并从父容器摘除，兄弟不受影响
    const removed = asNodes()[1];
    rerender(tree({ labels: [two[0], three[2]] }));
    await flush();
    expect(texts).toHaveLength(3); // 没有新建
    expect(removed.destroyed).toBe(true);
    expect(removed.parent).toBeNull();
    expect(asNodes()[0].destroyed).toBe(false);
    expect(asNodes()[2].destroyed).toBe(false);
  });
});

describe("标注层 · 层级权重（与素材同源）", () => {
  /** PRD §6.3.4 第二条：容器 alpha 必须等于 `levelAlphas[i]` */
  it("层级切换时容器 alpha 等于 levelAlphas[i]，层级无关的恒为 1", async () => {
    const labels: MapLabel[] = [
      { id: "a", text: "大陆", x: 0, y: 0, size: 16, level: 0 },
      { id: "b", text: "洲", x: 0, y: 20, size: 12, level: 1 },
      { id: "c", text: "郡", x: 0, y: 40, size: 10, level: 3 },
      { id: "d", text: "无层级", x: 0, y: 60, size: 12, level: null },
    ];

    const { rerender } = render(tree({ labels, levelAlphas: [0, 0, 0, 1] }));
    await flush();

    // 容器顺序 = [L0, L1, L2, L3, LOOSE]（LOOSE 永远最后，否则会被层级容器淡掉）
    const layers = labelLayer().children;
    expect(layers).toHaveLength(5);
    expect(layers.map((l) => l.alpha)).toEqual([0, 0, 0, 1, 1]);

    // 缩到"洲"那一级：权重整体挪一级，层级无关的标注不受影响
    rerender(tree({ labels, levelAlphas: [0, 1, 0, 0] }));
    await flush();
    expect(labelLayer().children.map((l) => l.alpha)).toEqual([0, 1, 0, 0, 1]);

    // 交叉带：相邻两级各半
    rerender(tree({ labels, levelAlphas: [0, 0, 0.5, 0.5] }));
    await flush();
    expect(labelLayer().children.map((l) => l.alpha)).toEqual([0, 0, 0.5, 0.5, 1]);
  });

  /** 层级越界必须并入最细一级（与素材同一条规则），否则标注会永久不可见 */
  it("层级数变少后越界标注并入最细一级，不会永久消失", async () => {
    const labels: MapLabel[] = [{ id: "a", text: "郡里的地名", x: 0, y: 0, size: 12, level: 3 }];

    const { rerender } = render(tree({ labels, levelAlphas: [0, 0, 0, 1] }));
    await flush();
    expect(labelLayer().children[3].children).toHaveLength(1);

    // 改成两级：level 3 的标注要落进"最细一级"（索引 1）
    rerender(tree({ labels, levelAlphas: [0.5, 0.5] }));
    await flush();

    const layers = labelLayer().children;
    // 层级容器数跟着层级数缩减，只剩 [L0, L1, LOOSE]
    expect(layers).toHaveLength(3);
    expect(layers[1].children).toHaveLength(1);
    expect(layers[1].alpha).toBeCloseTo(0.5, 6);
    // 节点没有被重建（仍是同一个），只是换了容器
    expect(texts).toHaveLength(1);
  });
});

describe("标注层 · 删除与字号", () => {
  /** PRD §6.3.4 第三条的渲染侧：文档里没了，节点必须真的销毁 */
  it("标注从文档消失：节点被销毁并从容器摘除（不留孤儿）", async () => {
    const labels = labelsOf(1);
    const { rerender } = render(tree({ labels }));
    await flush();
    const node = asNodes()[0];

    rerender(tree({ labels: [] }));
    await flush();

    expect(node.destroyed).toBe(true);
    expect(node.parent).toBeNull();
    // 容器保留（下次加标注直接复用），只是空了
    expect(labelLayer().children.length).toBeGreaterThan(0);
    expect(labelLayer().children.every((c) => c.children.length === 0)).toBe(true);
  });

  /** PRD §6.3.4 第四条：字号档 10 / 12 / 16 直接进 TextStyle.fontSize */
  it("字号档位对应 10 / 12 / 16（手动选，不按层级自动绑）", async () => {
    const labels: MapLabel[] = [
      { id: "s10", text: "小", x: 0, y: 0, size: 10, level: null },
      { id: "s12", text: "中", x: 0, y: 20, size: 12, level: null },
      { id: "s16", text: "大", x: 0, y: 40, size: 16, level: null },
    ];
    render(tree({ labels }));
    await flush();

    expect(texts).toHaveLength(3);
    expect(asNodes().map((n) => n.style?.fontSize)).toEqual([10, 12, 16]);
    // 字体与白描边也照 PRD §6.3.2 的定值走
    expect(styles[0].fontFamily).toContain("Songti SC");
    expect(styles[0].stroke).toEqual({ color: 0xf6f0e0, width: 3 });
    expect(styles[0].fill).toBe(0x1b1f1c);
  });
});

describe("标注层 · 避让", () => {
  /**
   * 避让只改**渲染句柄**的 y，绝不写回 `doc.labels`。
   *
   * 写回去就是渲染层改业务状态：截图比对会发现文档被渲染悄悄改了，
   * 撤销栈也会被"渲染细节"污染（滚一下滚轮就多几十步历史）。
   */
  it("同层级重叠时后者逐格上移（每次 6 单位、最多 3 次），且文档对象一个字段都没被改", async () => {
    const labels: MapLabel[] = [
      { id: "a", text: "长安", x: 0, y: 0, size: 12, level: null },
      // 完全重叠：x/y 都一样
      { id: "b", text: "洛阳", x: 0, y: 0, size: 12, level: null },
    ];
    // 冻结一份快照，事后逐字段比对
    const before = JSON.stringify(labels);

    render(tree({ labels }));
    await flush();

    const [first, second] = asNodes();
    expect(first.positionValue).toEqual({ x: 0, y: 0 });
    /**
     * 12 号字的行高约 14.4 世界单位，而步长只有 6 —— 让一格仍然叠着，
     * 所以要一直让到第 3 格（-18）才真正分开。这正是"最多让 3 次"的由来：
     * 步长按 PRD 取 6（手动微调的粒度），次数上限保证文字不会被推到离原位太远。
     */
    expect(second.positionValue).toEqual({ x: 0, y: -18 });
    expect(JSON.stringify(labels)).toBe(before);
  });

  it("不同层级之间不互相让位（它们不会同时以高权重出现）", async () => {
    const labels: MapLabel[] = [
      { id: "a", text: "长安", x: 0, y: 0, size: 12, level: 0 },
      { id: "b", text: "洛阳", x: 0, y: 0, size: 12, level: 3 },
    ];
    render(tree({ labels, levelAlphas: [1, 0, 0, 1] }));
    await flush();

    const [first, second] = asNodes();
    expect(first.positionValue).toEqual({ x: 0, y: 0 });
    expect(second.positionValue).toEqual({ x: 0, y: 0 });
  });
});

describe("标注层 · 双击编辑", () => {
  /**
   * 双击标注 → `onLabelEditRequest(id, 屏幕坐标)`。
   *
   * 回调给的是**屏幕**坐标（DOM 输入框要绝对定位到 CSS 像素空间），换算必须走
   * `coords.ts` 的 `worldToScreen`。本用例的画布尺寸在 jsdom 里是 0（未桩
   * getBoundingClientRect），视口也停在原点，所以 (0,0) 世界点 → (0,0) 屏幕点，
   * 正好能验证"没有多算一次"。缩放下限、画布中心等分支由 `coords.test.ts` 覆盖。
   */
  it("双击命中标注：回调 id 与屏幕坐标；点空白处不触发", async () => {
    const onLabelEditRequest = vi.fn();
    const labels: MapLabel[] = [{ id: "a", text: "长安", x: 0, y: 0, size: 12, level: null }];

    const { container } = render(tree({ labels, onLabelEditRequest }));
    await flush();

    const host = container.querySelector(".map-canvas") as HTMLElement;

    // 点在标注包围盒外：不回调（否则画布随便双击都会弹出输入框）
    fireEvent.doubleClick(host, { clientX: 400, clientY: 300 });
    expect(onLabelEditRequest).not.toHaveBeenCalled();

    fireEvent.doubleClick(host, { clientX: 0, clientY: 0 });
    expect(onLabelEditRequest).toHaveBeenCalledTimes(1);
    expect(onLabelEditRequest).toHaveBeenCalledWith("a", { x: 0, y: 0 });
  });

  /** 正在淡出的标注不该能被双击进去编辑（与"看不见就点不中"同一条门槛） */
  it("层级权重过低时双击不响应", async () => {
    const onLabelEditRequest = vi.fn();
    const labels: MapLabel[] = [{ id: "a", text: "长安", x: 0, y: 0, size: 12, level: 3 }];

    const { container } = render(
      // levelAlphas[3] = 0：这条标注在画面上已经完全消失
      tree({ labels, levelAlphas: [1, 0, 0, 0], onLabelEditRequest }),
    );
    await flush();

    fireEvent.doubleClick(container.querySelector(".map-canvas") as HTMLElement, {
      clientX: 0,
      clientY: 0,
    });
    expect(onLabelEditRequest).not.toHaveBeenCalled();
  });
});
