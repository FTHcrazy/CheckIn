import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntApp } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MapEditorPage 坐标链路回归测试。
 *
 * ── 真实缺陷 ──
 * 用户报障两条，实为**同一根因**：`screen→world` 被换算了两遍。
 *
 *   MapCanvas 已经用「画布真实像素几何」把点击换算成世界坐标后回调，
 *   而页面又把它当作屏幕坐标调了一次 `toWorld`：
 *
 *     world_out = screenToWorld(world_in) = (world_in - C)/k + V
 *
 *   两个后果：
 *   1. **落位偏移**：素材落到远离光标的位置，缩放越小偏得越狠
 *      （k=0.9 时相对位移被放大到 1/k² ≈ 1.23，且额外叠加 -C/k 的固定偏移）。
 *   2. **只能拖动一次**：命中测试 `pickElement` 的入参同样被污染 →
 *      点在素材上永远选不中 → 每次点击都 `setSelectedId(null)`。
 *      素材刚落位时是选中的，所以"能拖一次"；此后再也无法重新选中，
 *      第二拖就变成了平移画布。
 *
 * 修复：坐标换算只允许发生一次 —— 由持有画布像素几何的 MapCanvas 负责，
 * 页面直接使用收到的世界坐标（见 MapCanvas/index.tsx 的 props 契约注释）。
 *
 * 本测试不 mock MapCanvas，只替换 pixi 渲染后端与纹理加载，
 * 因此真实覆盖「指针事件 → 换算 → 落位 → 选中 → 拖拽」整条链路。
 */

/** 记录所有素材精灵的位置写入（假 Sprite 的 position.set） */
const { spritePositions, labelNodes } = vi.hoisted(() => ({
  spritePositions: [] as { x: number; y: number }[],
  /**
   * 记录所有标注文字节点的创建与销毁。
   *
   * 标注画在 WebGL 里，DOM 上查不到 —— 只能从这个 mock 探针里看：新建了几个、
   * 文本是什么、字号几号、有没有被销毁。`text` 是可变字段（改文案走原地赋值），
   * 所以断言要在事件之后再读它。
   */
  labelNodes: [] as {
    text: string;
    destroyed: boolean;
    /** 字号档（`TextStyle.fontSize`），用来钉住"手动选字号"真的传到了渲染层 */
    style: { fontSize?: number } | null;
  }[],
}));

vi.mock("pixi.js", () => {
  /** 只声明被测代码真正用到的成员，类型宽松以便子类覆写 */
  type Setter = { set: (...args: number[]) => void };

  class FakeContainer {
    children: unknown[] = [];
    alpha = 1;
    /** 剔除写的就是它；默认 true = 不剔 */
    visible = true;
    /** 风格滤镜挂载点 */
    filters: unknown[] = [];
    scale: Setter = { set: () => {} };
    position: Setter = { set: () => {} };
    addChild(...kids: unknown[]) {
      this.children.push(...kids);
      return kids[0];
    }
    removeChild() {}
    destroy() {}
    /** 剔除读的**局部**包围盒（与视口无关，可缓存）：原点零矩形 ⇒ 默认不剔 */
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
    anchor: Setter = { set: () => {} };
    width = 0;
    height = 0;
    rotation = 0;
    texture: unknown = null;
    /** 素材精灵的落位写入即"元素当前世界坐标"，供断言读取 */
    position: Setter = {
      set: (x: number, y: number) => {
        spritePositions.push({ x, y });
      },
    };
  }

  /**
   * Graphics 替身。
   *
   * 除了既有的 rect/poly/fill/stroke，还要有 `moveTo` / `bezierCurveTo` /
   * `closePath` —— 海岸路径走的是 Catmull-Rom → 贝塞尔（见 land.ts 的
   * `drawLandPath`），不是 `poly()` 直弦。缺了它们会在"生成陆地"那一刻抛
   * "g.moveTo is not a function"，而报错栈指向烘焙，很容易被误判成渲染问题。
   */
  class FakeGraphics extends FakeContainer {
    clear() {}
    moveTo() {
      return this;
    }
    lineTo() {
      return this;
    }
    bezierCurveTo() {
      return this;
    }
    closePath() {
      return this;
    }
    rect() {
      return this;
    }
    poly() {
      return this;
    }
    /**
     * 手画草稿的顶点圈（R-REG-03）。
     *
     * 草稿层用 `circle()` 画顶点，用 `moveTo/lineTo` 画折线与预览虚线 ——
     * 少了 `circle` 时，"在画布上单击落点"这一步就会抛
     * "layer.circle is not a function"，而栈指向 Pixi 渲染，极易被误判成渲染问题。
     */
    circle() {
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
    /** 渲染器替身：海岸烘焙会调用它，本测试不关心烘出什么 */
    renderer = { render: vi.fn() };
    // 立刻 resolve：测试只关心坐标与手势，不关心 Pixi 生命周期
    init = vi.fn(async () => {});
    destroy = vi.fn();
  }

  /**
   * 以下是 pixi.js 的**模块面补全**，不是被测代码用到的类。
   *
   * `vi.mock` 的工厂缺导出会在 import 阶段直接抛错：coastBake.ts 在模块顶层
   * import 了 RenderTexture / BlurFilter，只要页面引入了海岸烘焙，这两个导出
   * 就必须存在。先补齐，避免改渲染代码时被"5 个文件集体红"误导成环境问题。
   */
  class RenderTexture {
    static create = vi.fn((options: { width: number; height: number }) => ({
      ...options,
      destroy: vi.fn(),
    }));
    destroy = vi.fn();
  }
  class BlurFilter {
    constructor(options?: unknown) {
      void options;
    }
  }
  class ColorMatrixFilter {
    matrix: number[] = [];
    /** 切风格时旧实例要被销毁（累乘会让来回切换不可逆） */
    destroy = vi.fn();
  }
  /**
   * 样式替身：把构造参数**铺到实例上**。
   *
   * 真实 `Text` 把 `style` 存成 `TextStyle` 实例，所以"几号字"只能从实例字段读。
   * 只留 `options` 的话，断言就只能去翻全局数组，读不出"哪个节点是几号字"。
   */
  class TextStyle {
    fontSize?: number;
    constructor(options?: Record<string, unknown>) {
      Object.assign(this as object, options ?? {});
    }
  }
  /**
   * 文字替身（标注层）。
   *
   * `anchor` 必须有：`labelSync` 建节点时会 `anchor.set(0.5, 0.5)`。
   * `destroy` 要留痕：删除素材时联动标注是否真的消失，只能靠这里观察。
   */
  class Text extends FakeContainer {
    text = "";
    resolution = 1;
    style: { fontSize?: number } | null = null;
    anchor: Setter = { set: () => {} };
    destroyed = false;
    constructor(options?: unknown) {
      super();
      const o = options as
        | { text?: string; style?: { fontSize?: number } }
        | undefined;
      this.text = typeof o?.text === "string" ? o.text : "";
      this.style = o?.style ?? null;
      labelNodes.push(this as unknown as (typeof labelNodes)[number]);
    }
    destroy() {
      this.destroyed = true;
    }
  }

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
    TextStyle,
    Text,
  };
});

/** 纹理加载无关本测试：直接给空表 + ready，避免触碰真实网络/解码 */
vi.mock("./hooks/useTextureCache", () => ({
  useTextureCache: () => ({ textures: {}, ready: true }),
}));

// 依赖 mock 之后再导入被测页面
import MapEditorPage from "./index";
import { worldToScreen } from "./coords";
import { resetMapStores } from "./store/reset";
import { useMapDocStore } from "./store/useMapDocStore";
import { useMapSelectionStore } from "./store/useMapSelectionStore";
import type { MapRegion, Point } from "./regions";

// jsdom 未实现 PointerEvent / 指针捕获：用 MouseEvent 顶替并补空实现，
// 使 React 的 pointer 事件链路在测试环境可用。
if (typeof window.PointerEvent === "undefined") {
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
}
if (typeof Element.prototype.setPointerCapture !== "function") {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}

/** 画布基准尺寸（由 getBoundingClientRect 桩决定） */
const CANVAS = 1024;
/**
 * 初始适配后的缩放。fitToRect 对 1024×1024 的底图在 1024×1024 画布上：
 * min(1024/1024, 1024/1024) * FIT_PADDING(0.8) = 0.8。
 *
 * 这里刻意写死 0.8 而**不**从源码 import FIT_PADDING：那是被测行为本身，
 * 跟着源码走就失去断言价值（改成 1.0 铺满画布这种回归将无人发现）。
 */
const SCALE = 0.8;
/** 初始视口中心恒为底图中心 = 世界原点 */
const VIEW = { x: 0, y: 0 };
/** 四周留白宽度（画布像素）：底图占 819px，两侧各余 ≈102px */
const MARGIN = (CANVAS - CANVAS * SCALE) / 2;

const rect = {
  width: CANVAS,
  height: CANVAS,
  left: 0,
  top: 0,
  right: CANVAS,
  bottom: CANVAS,
  x: 0,
  y: 0,
  toJSON: () => ({}),
} as DOMRect;

let rectSpy: ReturnType<typeof vi.spyOn>;

/** 世界坐标 → 画布本地像素（与 coords.worldToScreen 同式） */
function localOf(world: { x: number; y: number }) {
  return {
    x: (world.x - VIEW.x) * SCALE + CANVAS / 2,
    y: (world.y - VIEW.y) * SCALE + CANVAS / 2,
  };
}

/** 画布本地像素 → 世界坐标（与 coords.screenToWorld 同式） */
function worldOf(local: { x: number; y: number }) {
  return {
    x: (local.x - CANVAS / 2) / SCALE + VIEW.x,
    y: (local.y - CANVAS / 2) / SCALE + VIEW.y,
  };
}

function host(): HTMLElement {
  return document.querySelector(".map-canvas") as HTMLElement;
}

/** 单击画布（无位移） */
function clickCanvas(local: { x: number; y: number }) {
  fireEvent.pointerDown(host(), {
    clientX: local.x,
    clientY: local.y,
    pointerId: 1,
    button: 0,
  });
  fireEvent.pointerUp(host(), {
    clientX: local.x,
    clientY: local.y,
    pointerId: 1,
    button: 0,
  });
}

/** 从 from 拖到 to（按住左键移动后释放） */
function dragCanvas(from: { x: number; y: number }, to: { x: number; y: number }) {
  fireEvent.pointerDown(host(), {
    clientX: from.x,
    clientY: from.y,
    pointerId: 1,
    button: 0,
  });
  fireEvent.pointerMove(host(), {
    clientX: to.x,
    clientY: to.y,
    pointerId: 1,
    buttons: 1,
  });
  fireEvent.pointerUp(host(), {
    clientX: to.x,
    clientY: to.y,
    pointerId: 1,
    button: 0,
  });
}

/** 工具栏「删除选中」按钮：其可用态即"当前是否有选中素材" */
function deleteButton(): HTMLElement {
  return screen.getByRole("button", { name: "delete" });
}

/**
 * 工具栏缩放标签文本。
 * 注意不能用 getByText —— 该 span 的祖先容器 textContent 同样是 "90%"，
 * 会命中多个元素而报错。
 */
function zoomLabel(): string {
  return document.querySelector(".map-editor__zoom-label")?.textContent ?? "";
}

/** 工具栏素材计数文本（同上，用类选择器精确定位） */
function countLabel(): string {
  return document.querySelector(".map-editor__count")?.textContent ?? "";
}

/** 工具栏层级胶囊文本；未生成区块时该元素不渲染，返回空串 */
function levelChip(): string {
  return document.querySelector(".map-editor__level-chip")?.textContent ?? "";
}

/** 画布下方提示：说明新放置的素材会归入哪一级 */
function canvasHint(): string {
  return document.querySelector(".map-editor__canvas-hint")?.textContent ?? "";
}

/**
 * 世界坐标 → 画布本地像素，缩放取自**页面当前真实显示**的值。
 *
 * 不能用上面那个基于常量 SCALE 的 localOf：本组用例会在 80% 与 228% 之间来回，
 * 换算必须跟着实际视口走。（缩放锚点是画布中心，所以视口中心恒为世界原点。）
 */
function localAt(world: { x: number; y: number }) {
  const scale = Number(zoomLabel().replace("%", "")) / 100;
  return { x: world.x * scale + CANVAS / 2, y: world.y * scale + CANVAS / 2 };
}

/**
 * 连点缩放按钮若干次。
 *
 * 查询必须**提到循环外**：`getByRole` 每次都要遍历整棵可访问性树，在本仓这套 jsdom
 * 环境里单次约 250~600ms（随工具栏节点数增长），而 `fireEvent.click` 只有 15~50ms。
 * 循环里现查现点会让 11 连点变成 11 次全树遍历 —— 这正是本组用例之前逼近 15s 超时的
 * 原因。按钮 DOM 节点在缩放过程中不会重建（React 复用同一节点），所以查一次反复点
 * 语义完全等价，顺带把"按钮存在"的断言从 N 次收紧到 1 次。
 */
function zoomBy(button: "zoom-in" | "zoom-out", times: number) {
  const el = screen.getByRole("button", { name: button });
  for (let i = 0; i < times; i += 1) fireEvent.click(el);
}

/** 工具栏"已生成 N 块"文本；无区块时该元素不渲染，返回空串 */
function regionLabel(): string {
  return document.querySelector(".map-editor__region-count")?.textContent ?? "";
}

/** 素材面板底部提示：反映当前是否处于"待放置"态 */
function pendingHint(): string {
  return document.querySelector(".sprite-panel__hint")?.textContent ?? "";
}

/** 工具栏陆地种子标签；未生成陆地时该元素不渲染，返回空串 */
function landLabel(): string {
  return document.querySelector(".map-editor__land-seed")?.textContent ?? "";
}

/** 工具栏地名计数（恒渲染，0 也在） */
function labelCount(): string {
  return document.querySelector(".map-editor__label-count")?.textContent ?? "";
}

/**
 * 地名编辑覆盖层。
 *
 * 它是绝对定位的 DOM 输入框（Pixi 没有输入控件），用类选择器取而不是按 role：
 * 同一时刻页面上还可能有一个「地名」属性输入框，按 role 取会命中多个。
 */
function draftInput(): HTMLInputElement | null {
  return document.querySelector(".map-canvas__label-input") as HTMLInputElement | null;
}

/** 三个工具栏下拉的稳定标识（antd 的 role=combobox 有三个，按 role 取会撞） */
type SelectName = "style" | "export" | "label-size";

/**
 * 读某个下拉**当前选中**的文案。
 *
 * 【类名按 antd 6 的实际 DOM 写】本仓是 antd **6.6.2**，内部结构已不是 5.x 的
 * `.ant-select-selector` / `.ant-select-selection-item`，而是 `.ant-select-content`
 * （选中项）/ `.ant-select-input`（输入框）/ `.ant-select-suffix`（箭头）。
 * 按 5.x 的类名去查只会得到 `null`，而错误表现是"下拉里明明显示了原色，断言说空"。
 */
function selectValue(which: SelectName): string {
  const root = document.querySelector(`.map-editor__select--${which}`);
  return root?.querySelector(".ant-select-content")?.textContent ?? "";
}

/**
 * 打开下拉并点选一个选项。
 *
 * antd/rc-select 不是原生 `<select>`：必须先 `mouseDown` 触发展开（事件挂在
 * 根节点 `.ant-select` 上），选项随后被渲染到 `document.body` 的 portal 里 ——
 * 所以找选项要在整个 body 里找，不能只看下拉根节点。
 */
function chooseOption(which: SelectName, label: string) {
  const root = document.querySelector(`.map-editor__select--${which}`);
  if (!root) throw new Error(`找不到下拉：${which}`);
  fireEvent.mouseDown(root);
  const option = Array.from(
    document.querySelectorAll<HTMLElement>(".ant-select-item-option"),
  ).find((el) => el.textContent === label);
  if (!option) throw new Error(`找不到下拉选项：${label}`);
  fireEvent.click(option);
}

/** 选中左侧面板的素材（进入待放置态） */
function pickSprite(label: string) {
  const img = screen.getByAltText(label);
  fireEvent.click(img.closest("button") as HTMLElement);
}

/**
 * 展开工具栏「更多」收纳面板。
 *
 * 【为什么需要它】工具栏重组后，风格/导出尺寸/字号/种子/显示分区/清除类
 * 按钮被收进「更多」下拉（popupRender 渲染的自定义面板）。这些控件在面板
 * 展开前不在 DOM 里，按 role 查会 `Unable to find`。本函数点开面板后再查。
 * 返回展开后的面板容器（面板节点在 document.body 上，随 Dropdown 一起渲染）。
 *
 * 【层级配置**不在**这里】它在主栏的「层级 N」浮层里 —— 放进 Dropdown 会是
 * 嵌套浮层：点浮层内容等于点在 Dropdown 外面，Dropdown 立刻收起连带把浮层卸载。
 */
function openMore(): HTMLElement {
  // 幂等：面板已在 DOM 里（dropdown 未关闭）时直接复用，避免重复点击导致 toggle 关闭
  let panel = document.querySelector(".map-editor__more-panel") as HTMLElement | null;
  if (panel) return panel;
  fireEvent.click(screen.getByRole("button", { name: "more" }));
  panel = document.querySelector(".map-editor__more-panel") as HTMLElement | null;
  if (!panel) throw new Error("「更多」面板未展开");
  return panel;
}

/** 渲染页面并等待初始适配完成（缩放标签变成 80%） */
async function setup() {
  const utils = render(
    <AntApp>
      <MapEditorPage />
    </AntApp>,
  );
  // 放行 MapCanvas 的异步 init → canvasSize 落地 → 首次 fitView
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  await waitFor(() => expect(zoomLabel()).toBe("80%"));
  return utils;
}

beforeEach(() => {
  spritePositions.length = 0;
  labelNodes.length = 0;
  // 三个 store 是模块级单例，必须显式复位（对齐 useNovelEditorStore.test 范式）
  resetMapStores();
  rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
});

afterEach(() => {
  // 未开启 vitest globals 时 RTL 不会自动清理，DOM 会跨用例累积
  cleanup();
  rectSpy.mockRestore();
});

/**
 * ── 整组重组件用例的统一超时 ──
 *
 * 本文件每条用例都要真实渲染 `MapEditorPage` + `MapCanvas`（不 mock 组件，只
 * 替换 pixi 后端），一次 `setup()` 就要把整张纸、223 个区块多边形、全部精灵和
 * 标注走一遍 mock Graphics。单跑实测：
 *
 *   · 「取消选中后可重新点选并再次拖动」      4.55s（默认上限 5000ms，绿）
 *   · 「层级指示随缩放连续切换」              9.68s
 *   · 「素材归属放置时的层级」               14.90s
 *   · 「未生成区块时…」                      10.74s
 *
 * 全仓并发（`--maxWorkers=4`，与其它 257 个文件争 CPU）时这些都会翻倍，
 * 4.55s 那条必然先顶到 5s 默认上限 —— 表现为"并发才红、单跑必绿"的假回归。
 *
 * 因此在文件顶层统一兜到 30s，而不是一条条补 `, 30000`（漏一条就复发）。
 * B2 素材扩产后面板一次渲染 45 张素材卡（原 6 张），每个 setup() 的
 * DOM/导入成本同步翻了几倍 —— 20s 预算在批量下已不够。
 * 2.22.1 重制批后最重的两条（生成 223 区块 + 郡级双向缩放落位）在批量下
 * 又越过 30s（单跑仅 ~15s，纯墙钟问题、非挂起）—— 统一提到 60s。
 * 用例内部自己的 `waitFor` 断言仍用各自的短超时，失败依然会快速暴露，
 * 这里放宽的只是"整条用例的墙钟预算"。
 * 历史上个别用例自带 `, 15000` / `, 25000` 的显式覆盖（早于统一预算存在，
 * 反向压低过预算），B2 时已删；2.22.2 补缺批（53 张素材卡）后又清掉 11 处
 * `, 40000` 同类残留；2.25.0 B3 加了三条重集成用例把整文件拖到 ~13 分钟，
 * 又暴露 `, 20000` ×3 / `, 30000` ×17 / `, 60000` ×3 共 23 处同类残留
 * （一条被 30s 硬顶杀掉）—— 一并清空。显式覆盖一律不补，统一吃文件级预算。
 * B3 三条重集成用例（各 20~27s）落地后整文件批量墙钟到 ~14 分钟，单跑 13s
 * 的用例批量下也会越 60s（连续三轮全量各随机杀掉一条不同用例，纯挤兑）——
 * 按本注释的既定节奏统一提到 120s。
 */
vi.setConfig({ testTimeout: 120000 });

describe("MapEditorPage 坐标链路", () => {
  it("留白：底图不铺满画布，四周各留约一成空白", async () => {
    await setup();

    // 用**页面上真实显示的缩放**（而非测试自己的常量）推算底图四角位置，
    // 这样断言跟着实际视口走：一旦有人把适配改回"铺满"，缩放标签会变，
    // 四角随即贴边/出界，此处立刻失败。
    const scale = Number(zoomLabel().replace("%", "")) / 100;
    const size = { width: CANVAS, height: CANVAS };
    const half = CANVAS / 2; // 底图世界尺寸 1024 → 半宽 512 = CANVAS / 2
    const tl = worldToScreen({ x: -half, y: -half }, { ...VIEW, scale }, size);
    const br = worldToScreen({ x: half, y: half }, { ...VIEW, scale }, size);

    // 四边都必须留出空白（底图不裁边）
    expect(tl.x).toBeGreaterThanOrEqual(MARGIN - 1e-6);
    expect(tl.y).toBeGreaterThanOrEqual(MARGIN - 1e-6);
    expect(CANVAS - br.x).toBeGreaterThanOrEqual(MARGIN - 1e-6);
    expect(CANVAS - br.y).toBeGreaterThanOrEqual(MARGIN - 1e-6);

    // 留白比例落在合理区间：至少 9%（读出"这是一张完整的图纸"），
    // 但也不能缩得只剩孤零零一小块（≤ 20%）。
    expect(MARGIN / CANVAS).toBeGreaterThanOrEqual(0.09);
    expect(MARGIN / CANVAS).toBeLessThanOrEqual(0.2);
  });

  it("落位：素材落在光标对应的世界坐标，而非被二次换算", async () => {
    await setup();
    pickSprite("森林");

    const click = { x: 712, y: 571 };
    clickCanvas(click);

    await waitFor(() => expect(spritePositions.length).toBeGreaterThan(0));
    const placed = spritePositions.at(-1) as { x: number; y: number };
    const expected = worldOf(click);

    expect(placed.x).toBeCloseTo(expected.x, 5);
    expect(placed.y).toBeCloseTo(expected.y, 5);

    // 历史缺陷签名：世界坐标又被当作屏幕坐标换算一次 → 落点跑到别处
    const doubled = worldOf(expected);
    expect(Math.abs(placed.x - doubled.x)).toBeGreaterThan(1);
    expect(Math.abs(placed.y - doubled.y)).toBeGreaterThan(1);
  });

  it("拖拽：按世界坐标增量移动，元素不会跳到光标下方", async () => {
    await setup();
    pickSprite("森林");
    clickCanvas(localOf({ x: 0, y: 0 }));

    // 以**实际落位**为基准：落位精度由上一个用例负责，这里只验证拖拽手感
    const placed = spritePositions.at(-1) as { x: number; y: number };
    const grabWorld = { x: placed.x, y: placed.y - 45 }; // 元素竖直中部（基准高 90）
    const grab = localOf(grabWorld);
    dragCanvas(grab, { x: grab.x + 16, y: grab.y });

    const moved = spritePositions.at(-1) as { x: number; y: number };
    // 屏幕右移 16px ÷ 缩放 0.8 = 世界 +20
    expect(moved.x - placed.x).toBeCloseTo(20, 5);
    // 增量式：y 保持不动。若误把锚点吸附到光标，y 会变成光标的 -45
    expect(moved.y - placed.y).toBeCloseTo(0, 5);
    expect(Math.abs(moved.y - grabWorld.y)).toBeGreaterThan(1);
  });

  it("取消选中后可重新点选并再次拖动（回归：素材只能拖动一次）", async () => {
    await setup();
    pickSprite("森林");
    clickCanvas(localOf({ x: 0, y: 0 })); // 落位即选中
    expect(deleteButton()).not.toBeDisabled();

    // ── 第一次拖动：应当生效 ──
    const placed = spritePositions.at(-1) as { x: number; y: number };
    const grab = localOf({ x: placed.x, y: placed.y - 45 });
    dragCanvas(grab, { x: grab.x + 16, y: grab.y });
    const afterFirst = spritePositions.at(-1) as { x: number; y: number };
    expect(afterFirst.x - placed.x).toBeCloseTo(20, 5);

    // ── 点画布空白处：取消选中（正常行为）──
    clickCanvas({ x: 60, y: 60 });
    expect(deleteButton()).toBeDisabled();

    // ── 重新点选该素材 ──
    // 此前缺陷：命中测试拿到的是二次换算后的世界坐标，永远打不中 →
    // 每次点击都清空选中 → 素材再也无法被选中，自然"只能拖一次"。
    const reselect = localOf({ x: afterFirst.x, y: afterFirst.y - 45 });
    clickCanvas(reselect);
    expect(deleteButton()).not.toBeDisabled();

    // ── 第二次拖动：必须再次生效 ──
    dragCanvas(reselect, { x: reselect.x + 16, y: reselect.y });
    const afterSecond = spritePositions.at(-1) as { x: number; y: number };
    expect(afterSecond.x - afterFirst.x).toBeCloseTo(20, 5);
  });

  it("缓慢拖动（每次仅移动 1px）应判为拖拽，不得触发落位", async () => {
    await setup();
    // 进入待放置态但不点画布：此时若有任何"误判为单击"，就会立刻落位
    pickSprite("森林");
    expect(countLabel()).toContain("0");
    expect(pendingHint()).toContain("点击画布放置");

    const from = { x: 512, y: 300 };
    fireEvent.pointerDown(host(), {
      clientX: from.x,
      clientY: from.y,
      pointerId: 1,
      button: 0,
    });
    // 20 次 1px 移动：单次位移永远低于阈值，只有累计位移才能识别为拖拽。
    // 若按"单次位移"判断（历史缺陷），松手时会被当成单击 → 素材凭空落位。
    for (let i = 1; i <= 20; i += 1) {
      fireEvent.pointerMove(host(), {
        clientX: from.x + i,
        clientY: from.y,
        pointerId: 1,
        buttons: 1,
      });
    }
    fireEvent.pointerUp(host(), {
      clientX: from.x + 20,
      clientY: from.y,
      pointerId: 1,
      button: 0,
    });

    // 识别为拖拽：未落位，且待放置态保留
    expect(countLabel()).toContain("0");
    expect(pendingHint()).toContain("点击画布放置");
  });

  /**
   * 生成 → 撤销 → 重做 → 清除。
   *
   * 【只加超时，未改任何断言】本用例要跑两次 223 块的生成/重建（每次 160 个郡
   * 多边形的填充与描边都要走过一遍 mock Graphics），实测单跑 3.5~3.7s；
   * 超时由文件顶层的 `vi.setConfig({ testTimeout: 60000 })` 统一兜住
   * （见该处注释里的实测清单），这里不再逐条显式声明。
   */
  it("区块：可生成、可撤销、可重做、可清除", async () => {
    await setup();

    const generate = screen.getByRole("button", { name: /生成区块/ });
    /** 每次重新查询：按钮的 disabled 会随状态切换，避免持有过期节点 */
    const clearRegionsBtn = () => {
      openMore();
      return screen.getByText("清除区块").closest("button") as HTMLElement;
    };

    // 初始无区块：标签不渲染，清除按钮禁用
    expect(regionLabel()).toBe("");
    expect(clearRegionsBtn()).toBeDisabled();

    // ── 生成 ──
    fireEvent.click(generate);
    await waitFor(() => expect(regionLabel()).toContain("223"));
    expect(clearRegionsBtn()).not.toBeDisabled();

    // ── 撤销：区块必须一起回退 ──
    // 这条断言是本次改动的核心风险点：撤销栈原先只快照 elements，
    // 区块不进历史。若仍是这样，撤销后区块会留在原地、此处失败。
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(regionLabel()).toBe(""));

    // ── 重做：区块恢复 ──
    fireEvent.click(screen.getByRole("button", { name: "redo" }));
    await waitFor(() => expect(regionLabel()).toContain("223"));

    // ── 清除 ──
    fireEvent.click(clearRegionsBtn());
    await waitFor(() => expect(regionLabel()).toBe(""));
    expect(clearRegionsBtn()).toBeDisabled();
  });

  it("区块与素材互不干扰：生成区块不会影响已放置的素材", async () => {
    await setup();
    pickSprite("森林");
    clickCanvas(localOf({ x: 0, y: 0 }));
    await waitFor(() => expect(countLabel()).toContain("1"));

    fireEvent.click(screen.getByRole("button", { name: /生成区块/ }));
    await waitFor(() => expect(regionLabel()).toContain("223"));

    // 素材数量保持不变 —— 区块层与素材层是各自独立的文档字段
    expect(countLabel()).toContain("1");

    // 撤销一次只回退区块，素材仍在
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(regionLabel()).toBe(""));
    expect(countLabel()).toContain("1");
  });

  it("层级数可调：改成 2 级只切出大陆与洲", async () => {
    await setup();
    // 默认 4 级共 223 块（3 + 12 + 48 + 160）；改成 2 级应只剩前两级 15 块。
    //
    // 【入口变了】层级配置从「更多」里的裸 InputNumber 升级成主栏的「层级 N」浮层
    // （R-REG-01：层数 + 每级名称 + 每级数量）。浮层内容挂在 body，所以照常在
    // 整个 document 里查；「层数」这个 aria-label 唯一指向浮层顶部那个数字框。
    fireEvent.click(screen.getByRole("button", { name: /层级 \d/ }));
    const depth = screen.getByRole("spinbutton", { name: "层数" });
    fireEvent.change(depth, { target: { value: "2" } });
    fireEvent.blur(depth);

    // 【走「应用并生成区块」而不是关掉浮层再点「生成区块」】这正是用户路径：
    // 改完配置就地生成。它同时钉住"生成读到的是刚写进文档的那份 schema"，
    // 而不是上一次渲染闭包里的旧值（那会切成 4 级）。
    fireEvent.click(screen.getByRole("button", { name: /应用并生成区块/ }));
    await waitFor(() => expect(regionLabel()).toContain("15"));
    expect(regionLabel()).not.toContain("223");
  });

  /**
   * 层级指示随缩放切换 —— 「无极衔接」在 UI 上唯一可见的证据。
   *
   * 数值前提（全部可复算）：画布 1024²、底图 1024 世界单位、适配留白 0.8 → 初始缩放 0.8。
   * 四级默认数量 [3, 12, 48, 160] 配 LOD_BLOCK_PX = 360，得自然缩放
   * [0.304, 0.609, 1.218, 2.223]，交界（相邻两级几何平均）[0.431, 0.861, 1.646]。
   * 缩放按钮的倍率是 ×1.1 / ÷1.1（见 useMapEditor 的 handleWheel；工具栏按钮只传方向）。
   *
   * 某一级"独占"的条件是它的权重为 100%，即相邻两个交界都已被推过：
   *   洲 独占 ⇒ 0.9668 ≤ z ≤ 1.4663；郡 独占 ⇒ z ≥ 1.8473；大陆 独占 ⇒ z ≤ 0.3836
   * （阈值 = 交界 × 2^±(W/2)，W = 1/3 倍频程）
   *
   * 于是四个考察点：
   *   0.8000 = 80%  = 起点        → 洲 91% + 国家 9% ⇒ "洲 ↔ 国家"
   *                                 （刚冒头的国家不是误差，正是细级"提前透出"的效果）
   *   2.2825 = 228% = 0.8×1.1¹¹   → 越过 1.646 且 ≥1.847 ⇒ "郡"
   *   0.8000 = 80%  = 适应窗口     → 与起点逐位相同，验证缩放可逆
   *   0.3393 = 34%  = 0.8÷1.1⁹    → 落到 0.431 以下且 ≤0.384 ⇒ "大陆"
   *
   * 全用精确相等而不是"包含"：这三档恰好是某一级的权重为 100%，字符串唯一确定。
   * 一旦谁调了 LOD_BLOCK_PX 让"第一眼看到的层级"变了，这里必须红 —— 那是有意的
   * 设计变更，不该悄悄溜过去。断言里连缩放百分比一起锁定，是为了让失败信息能直接
   * 区分"缩放没走到位"与"权重函数不对劲"。
   */
  it("层级指示随缩放连续切换：洲 ↔ 国家 → 郡 → 大陆", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /生成区块/ }));
    await waitFor(() => expect(regionLabel()).toContain("223"));

    const zoomPct = () => document.querySelector(".map-editor__zoom-label")?.textContent ?? "?";
    const chip = () => document.querySelector(".map-editor__level-chip")?.textContent ?? "";
    /**
     * 把「缩放百分比 + 层级胶囊」当整体断言。失败时一眼能分辨是哪一层出了问题：
     * 百分比不对 ⇒ 缩放链路（fit / 步长 / 上下限）；百分比对但层级不对 ⇒ 权重函数。
     */
    const state = () => `${zoomPct()} → ${chip()}`;

    // 初始：洲主导，国家刚刚露头
    expect(state()).toBe("80% → 洲 ↔ 国家");

    // 查询只做一次：`getByRole` 是全树遍历（见文件顶部 zoomBy 的说明），
    // 放进循环会让 20 次连点多花数秒，而按钮节点本身是复用的。
    const zoomIn = screen.getByRole("button", { name: "zoom-in" });
    const zoomOut = screen.getByRole("button", { name: "zoom-out" });

    for (let i = 0; i < 11; i += 1) fireEvent.click(zoomIn);
    await waitFor(() => expect(state()).toBe("228% → 郡"), { timeout: 3000 });

    // 「适应窗口」应当精确回到起点（无极衔接可逆，不该有迟滞或漂移）
    fireEvent.click(screen.getByRole("button", { name: "expand" }));
    await waitFor(() => expect(state()).toBe("80% → 洲 ↔ 国家"), { timeout: 3000 });

    // 继续缩出去：洲淡出、大陆淡入，最终只剩大陆
    for (let i = 0; i < 9; i += 1) fireEvent.click(zoomOut);
    await waitFor(() => expect(state()).toBe("34% → 大陆"), { timeout: 3000 });
  });

  /**
   * 素材的层级归属 —— 用户报障：「在放大到最小的一级（郡）添加的山，缩放到上一级
   * 并没有同步」。
   *
   * 根因：素材此前是"浮在地图上的一层贴纸"，不参与任何层级、也不随层级显隐，
   * 于是在郡那一级摆的山，缩到洲/国家去看时依旧原样显示，与当前尺度完全脱节。
   *
   * 现在素材会记住放置时所处的主导层级，并挂在那一级的容器下、随其权重淡入淡出 ——
   * 即"每一等级的元素随该地图缩放而缩放，换到另一级时消失"。
   */
  it("素材归属放置时的层级：缩到别级即淡出、也点不中", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /生成区块/ }));
    await waitFor(() => expect(regionLabel()).toContain("223"));

    // 放大到「郡」那一级（0.8 × 1.1¹¹ = 228%）
    zoomBy("zoom-in", 11);
    await waitFor(() => expect(levelChip()).toBe("郡"));
    expect(canvasHint()).toContain("新素材归入「郡」级");

    // 在郡级摆一座山 —— 它自此属于「郡」
    pickSprite("山（中）");
    const anchor = { x: 30, y: 20 };
    clickCanvas(localAt(anchor));
    await waitFor(() => expect(countLabel()).toContain("1"));
    expect(deleteButton()).not.toBeDisabled(); // 落位即选中

    // ── 缩回整图：郡的权重归 0，山随之退场 ──
    fireEvent.click(screen.getByRole("button", { name: "expand" }));
    await waitFor(() => expect(levelChip()).toBe("洲 ↔ 国家"));

    // 看不见了就自动取消选中 —— 否则会出现"选中框不见了、删除按钮却亮着"，
    // 用户按一下 Delete 就删掉了一个自己根本没看见的东西。
    await waitFor(() => expect(deleteButton()).toBeDisabled());

    // 在它原来的位置上点也点不中：看不见的东西不该能被选中
    clickCanvas(localAt({ x: anchor.x, y: 0 }));
    expect(deleteButton()).toBeDisabled();

    // ── 回到郡那一级：它又出现了，也重新点得中 ──
    zoomBy("zoom-in", 11);
    await waitFor(() => expect(levelChip()).toBe("郡"));
    /**
     * 点素材**竖直中部**而不是 `y: 0`。
     *
     * 【为什么改了这一下】素材现在按层级缩小（每级减半，见 `lod.elementSizeFactor`）：
     * 郡级的「山（中）」只有 15×8.75 世界单位（原 120×70），锚点在脚底 y=20，
     * 所以它的命中区是 y ∈ [11.25, 20]。原来点 `y: 0`（脚底下方 20 单位）能中，
     * 靠的正是"素材没有被缩小"这件**已按用户要求改掉**的事实；
     * `y: anchor.y - 4 = 16` 落在它的中部，语义仍是"点它就能选中"。
     */
    clickCanvas(localAt({ x: anchor.x, y: anchor.y - 4 }));
    expect(deleteButton()).not.toBeDisabled();
  });

  /**
   * 反向保障：**生成区块之前**放置的素材没有层级可言，不能因此被藏起来。
   *
   * 这类素材记 `level: null`（层级无关，权重恒为 1），且生成区块**不会**回头
   * 改写它们的归属 —— 隐式的数据改写比"素材与新层级不一致"更难排查。
   */
  it("未生成区块时放置的素材层级无关：缩到任何一级都还在、也点得中", async () => {
    await setup();
    expect(canvasHint()).toContain("不归属层级");

    pickSprite("森林");
    clickCanvas(localOf({ x: 40, y: 40 }));
    await waitFor(() => expect(countLabel()).toContain("1"));

    fireEvent.click(screen.getByRole("button", { name: /生成区块/ }));
    await waitFor(() => expect(regionLabel()).toContain("223"));
    // 提示改为"新素材归入某级"，说明归属只对之后放置的素材生效
    expect(canvasHint()).not.toContain("不归属层级");
    // 层级无关 → 不该被层级切换清掉选中
    expect(deleteButton()).not.toBeDisabled();

    // 先取消选中，后面那一下点击才有断言价值
    clickCanvas({ x: 20, y: 1000 });
    expect(deleteButton()).toBeDisabled();

    // 缩到最粗一级（大陆）：它依然在，且点得中
    zoomBy("zoom-out", 8);
    await waitFor(() => expect(levelChip()).toBe("大陆"));
    clickCanvas(localAt({ x: 40, y: 0 }));
    expect(deleteButton()).not.toBeDisabled();
  });
});

/**
 * 陆地与海岸 —— 本次改造唯一"从无到有"的图层。
 *
 * 这里覆盖的是**状态链路**而不是几何（几何在 `land.test.ts`）：
 * 按钮 → useMapEditor.generateLand → doc.land → 页面显示 seed，
 * 以及最要紧的一条：**撤销要把陆地一起退掉**。
 *
 * 后者是 `DocSnapshot` 扩容的全部理由：快照若仍只有 `{elements, regions}`，
 * 撤销「生成陆地」后海岸四层会留在画面上 —— 用户会以为"撤销坏了"。
 * 几何层面的"海岸消失"由 `MapCanvas/bake.test.tsx` 断言（`land` 变 null → 清空 RT）。
 */
describe("MapEditorPage 陆地与海岸", () => {
  /**
   * R-REG-02：**默认不划分**。
   *
   * 【这条断言的产品含义】用户诉求是"生成大地图后地图上保持干净、一个分区都没有"。
   * 病根不在生成算法而在入口（旧版点「生成陆地」会连带把区块一起切出来），所以
   * 判据就是 `land` 有值而 `regions` 为空 —— 新增断言 `regionLabel() === ""`，
   * 它在改前必然为红（改前这里会显示"已生成 N 块"）。
   */
  it("生成陆地：默认不分区（只有 seed、没有区块）；撤销后一起回退", async () => {
    await setup();
    expect(landLabel()).toBe("");

    fireEvent.click(screen.getByRole("button", { name: /生成陆地/ }));
    await waitFor(() => expect(landLabel()).toMatch(/^seed \d+$/), { timeout: 20000 });
    // 默认不勾「同时划出区块」⇒ 地图上不出现任何区块（"默认不划分"落地）
    expect(regionLabel()).toBe("");

    // ── 撤销：陆地一起回退（快照含 land）──
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(landLabel()).toBe(""), { timeout: 20000 });
    expect(regionLabel()).toBe("");

    // ── 重做：陆地恢复，区块仍为空 ──
    fireEvent.click(screen.getByRole("button", { name: "redo" }));
    await waitFor(() => expect(landLabel()).toMatch(/^seed \d+$/), { timeout: 20000 });
    expect(regionLabel()).toBe("");
  });

  /**
   * R-REG-02 的另一半：勾选「同时划出区块」后行为与改前**完全一致**
   * （陆地内逐岛切分 + 多岛加权分配数量），老习惯靠一次勾选恢复。
   */
  it("生成陆地：勾选「同时划出区块」后才在陆地内切分（回归等价）", async () => {
    await setup();

    // 打开「生成陆地」的配套下拉，勾上「同时划出区块」
    fireEvent.click(screen.getByRole("button", { name: "陆地选项" }));
    const sw = await screen.findByRole("switch", { name: "同时划出区块" });
    expect(sw).toHaveAttribute("aria-checked", "false"); // 默认关
    fireEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "true"));

    fireEvent.click(screen.getByRole("button", { name: /生成陆地/ }));
    await waitFor(() => expect(landLabel()).toMatch(/^seed \d+$/), { timeout: 20000 });
    await waitFor(() => expect(regionLabel()).toMatch(/已生成 \d+ 块/), { timeout: 20000 });
  });

  /**
   * 确认弹窗的文案必须**按勾选态 + 区块来源二分**（PRD R-REG-02 边界条件①，
   * 以及主理人裁决 1「手画块必须保留」）：
   *   · 不勾 ⇒「将清除 N 个自动生成的区块」（这是真的会发生的事：手画块不动）；
   *   · 勾选 ⇒「将重新划分区块（现有 N 个自动生成的区块会被替换）」。
   * 文案说错比没有弹窗更糟：用户按"替换"的心理预期点了确认，结果区块全没了。
   *
   * 本用例里没有手画块（T5 之前无处可画），所以只覆盖"全是自动块"这两版；
   * "保留 M 个手动区块"那半句由 `useMapEditor` / `useMapDocStore` 的用例保证
   * （页面不造手画块，硬造只能靠直接改 store，那测的就不是文案了）。
   */
  it("已有区块时点「生成陆地」会先确认，且文案按勾选态二分", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /生成区块/ }));
    await waitFor(() => expect(regionLabel()).toContain("223"));

    // ── ① 默认（不勾）：文案说"清除自动块"，且不点确认就不动手 ──
    fireEvent.click(screen.getByRole("button", { name: /生成陆地/ }));
    await waitFor(() =>
      expect(document.body.textContent).toContain("将清除 223 个自动生成的区块"),
    );
    expect(landLabel()).toBe("");

    // 取消掉，回到干净状态
    fireEvent.click(screen.getByRole("button", { name: /取\s*消/ }));
    await waitFor(() => expect(regionLabel()).toContain("223"));

    // ── ② 勾上：保留旧文案（重新划分区块）──
    fireEvent.click(screen.getByRole("button", { name: "陆地选项" }));
    const sw = await screen.findByRole("switch", { name: "同时划出区块" });
    fireEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "true"));

    fireEvent.click(screen.getByRole("button", { name: /生成陆地/ }));
    await waitFor(() =>
      expect(document.body.textContent).toContain(
        "将重新划分区块（现有 223 个自动生成的区块会被替换）",
      ),
    );
    expect(landLabel()).toBe("");
  });

  /**
   * 手画块保留 + 坐标系提醒的**文案**（主理人裁决 1 / PRD §8-Q4）。
   *
   * 【为什么之前没覆盖】上面的用例开头就写明"本用例里没有手画块，T5 之前无处可画"，
   * 于是"保留 M 个手动区块"与"手动区块是基于当前陆地绘制的…"这两句从没有被端到端
   * 断言过。T5 上线后手画块已可达，而这两句是"手动成果会不会被抹掉 / 会不会跑到海面
   * 上"的唯一告知渠道，必须钉住。
   *
   * 直接往 store 灌一块自动 + 一块手动（比"先生成 223 块再画"快得多，且不改变被测
   * 的文案分支）。
   */
  it("已有手画块时生成陆地：文案含「保留 M 个手动区块」与坐标系提醒", async () => {
    await setup();

    const tri = (dx: number): Point[] => [
      { x: dx, y: 0 },
      { x: dx + 120, y: 0 },
      { x: dx + 60, y: 120 },
    ];
    const auto: MapRegion = {
      id: "auto-1",
      parentId: null,
      level: 0,
      name: "大陆 1",
      seed: { x: 0, y: 0 },
      polygon: tri(-400),
      color: 0x334455,
    };
    const manual: MapRegion = {
      id: "manual-1",
      parentId: null,
      level: 0,
      name: "大陆 2",
      seed: { x: 300, y: 0 },
      polygon: tri(300),
      color: 0x334455,
      origin: "manual",
    };
    await act(async () => {
      useMapDocStore.setState((s) => ({ doc: { ...s.doc, regions: [auto, manual] } }));
    });

    fireEvent.click(screen.getByRole("button", { name: /生成陆地/ }));

    // 不勾「同时划出区块」（默认）：清 1 个自动块、保留 1 个手画块
    await waitFor(() =>
      expect(document.body.textContent ?? "").toContain("将清除 1 个自动生成的区块"),
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain("保留 1 个手动区块");
    // 只要 manualCount > 0，必须提示手画块与旧陆地的坐标系失配
    expect(text).toContain("手动区块是基于当前陆地绘制的");
  });
});

/**
 * 文字标注 —— 古地图的信息密度主要来自这里（PRD §6.3）。
 *
 * 本组覆盖**状态链路**（按钮 → useMapEditor → doc.labels → 画布建 Text），
 * 渲染侧的增量/字号/权重在 `MapCanvas/label.test.tsx`。
 */
describe("MapEditorPage 文字标注", () => {
  it("「加标注」：画布落位 → 输入 → 回车落库；空文本不创建", async () => {
    await setup();
    expect(labelCount()).toContain("0");

    // ── 先试一次空提交：Esc 退出，文档里不留任何东西 ──
    fireEvent.click(screen.getByRole("button", { name: /加标注/ }));
    clickCanvas(localOf({ x: 20, y: 10 }));
    await waitFor(() => expect(draftInput()).not.toBeNull());
    fireEvent.keyDown(draftInput() as HTMLElement, { key: "Escape" });
    await waitFor(() => expect(draftInput()).toBeNull());
    expect(labelCount()).toContain("0");
    // 空文本连 Text 节点都不该建（新建是"拿到文字才落库"的两段式）
    expect(labelNodes).toHaveLength(0);

    // ── 再来一次，这回真的输入 ──
    fireEvent.click(screen.getByRole("button", { name: /加标注/ }));
    clickCanvas(localOf({ x: 20, y: 10 }));
    await waitFor(() => expect(draftInput()).not.toBeNull());
    fireEvent.change(draftInput() as HTMLElement, { target: { value: "落霞岛" } });
    fireEvent.keyDown(draftInput() as HTMLElement, { key: "Enter" });

    await waitFor(() => expect(labelCount()).toContain("1"));
    expect(labelNodes).toHaveLength(1);
    expect(labelNodes[0].text).toBe("落霞岛");
    // 提交后覆盖层收起
    expect(draftInput()).toBeNull();
  });

  /**
   * 素材地名的完整闭环：填字 → 出现 → 删素材时一起删 → 撤销一次一起回。
   *
   * 【为什么"一起"必须被断言】两次 `commit` 会让撤销只回滚一半：素材回来了、
   * 地名还是没的（或者反过来）—— 而界面上看起来"撤销生效了"，用户不会发现
   * 自己丢了名字。这条用例就是钉住"同一个 mutate 只产生一步快照"。
   */
  it("素材地名：填字出现联动标注；删素材一起删，撤销一次一起回", async () => {
    await setup();

    // 放一座山（落位即选中）
    pickSprite("山（中）");
    clickCanvas(localOf({ x: 30, y: 20 }));
    await waitFor(() => expect(countLabel()).toContain("1"));

    // 选中素材 → 属性区出现「地名」输入框
    const nameBox = screen.getByPlaceholderText("地名");
    fireEvent.change(nameBox, { target: { value: "青云岭" } });
    fireEvent.keyDown(nameBox, { key: "Enter" });

    await waitFor(() => expect(labelCount()).toContain("1"));
    expect(labelNodes).toHaveLength(1);
    expect(labelNodes[0].text).toBe("青云岭");

    // ── 删除素材：地名必须在同一步里一起消失（不进渲染层的"孤儿"状态）──
    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    await waitFor(() => expect(countLabel()).toContain("0"));
    await waitFor(() => expect(labelCount()).toContain("0"));
    expect(labelNodes[0].destroyed).toBe(true);

    // ── 撤销一次：素材与地名一起回来（证明是同一个撤销步）──
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(countLabel()).toContain("1"));
    await waitFor(() => expect(labelCount()).toContain("1"));
  });

  /**
   * 「显示分区」开关（PRD §6.2：切错了要能撤销）。
   *
   * 断言两头：① 关掉后**区块数量不变**（只是不显示，不是不渲染）；
   * ② 一次点击 = 一个撤销步 —— 撤销一下就该回到"显示"。
   */
  it("「显示分区」开关：关掉只影响显示，撤销一步即恢复", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /生成区块/ }));
    await waitFor(() => expect(regionLabel()).toContain("223"));

    // 显示分区 Switch 收在「更多」面板里，先展开再查
    openMore();
    const sw = screen.getByRole("switch");
    expect(sw).toHaveAttribute("aria-checked", "true");

    fireEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "false"));
    expect(regionLabel()).toContain("223");

    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "true"));
    expect(regionLabel()).toContain("223");
  });

  /**
   * 加标注也是**成品**：撤销一步必须把它退回去（PRD §6.2 / §8.3 把"可撤销"当卖点）。
   *
   * 【为什么不能只靠"代码链路上成立"】`addLabel` 走 `commit`，看起来天然可撤销；
   * 但撤销栈是"每次 commit 推一份完整快照"，任何把 `labels` 漏进快照外状态、
   * 或者在 updater 里改非快照字段的改动，都会让这条链**静默断掉**，而画面上
   * 只是"按了没反应"。这条用例钉住端到端的那一步。
   */
  it("加标注：撤销一步回到 0 条（地名进撤销栈）", async () => {
    await setup();
    expect(labelCount()).toContain("0");

    fireEvent.click(screen.getByRole("button", { name: /加标注/ }));
    clickCanvas(localOf({ x: 20, y: 10 }));
    await waitFor(() => expect(draftInput()).not.toBeNull());
    fireEvent.change(draftInput() as HTMLElement, { target: { value: "落霞岛" } });
    fireEvent.keyDown(draftInput() as HTMLElement, { key: "Enter" });
    await waitFor(() => expect(labelCount()).toContain("1"));

    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(labelCount()).toContain("0"));

    // 重做再回来（快照含 labels，两个方向都要成立）
    fireEvent.click(screen.getByRole("button", { name: "redo" }));
    await waitFor(() => expect(labelCount()).toContain("1"));
  });

  /**
   * 字号档（PRD §4.4：手动选，不按层级自动绑）。
   *
   * 这条是 R-MAP-18 的功能缺口回归：`MapLabel.size` 早就支持 10/12/16、
   * `updateLabel` 也能改，但页面上**没有任何入口**时，所有地名会是同一个字号，
   * 而"手动可选"是 PRD 写进去的验收点。
   */
  it("字号档：下拉选 16 号后新建的地名按 16 号渲染", async () => {
    await setup();
    // 字号档下拉收在「更多」面板里，先展开再断言
    openMore();
    expect(selectValue("label-size")).toBe("12 号");

    chooseOption("label-size", "16 号");
    await waitFor(() => expect(selectValue("label-size")).toBe("16 号"));

    fireEvent.click(screen.getByRole("button", { name: /加标注/ }));
    clickCanvas(localOf({ x: 20, y: 10 }));
    await waitFor(() => expect(draftInput()).not.toBeNull());
    fireEvent.change(draftInput() as HTMLElement, { target: { value: "落霞岛" } });
    fireEvent.keyDown(draftInput() as HTMLElement, { key: "Enter" });

    await waitFor(() => expect(labelNodes).toHaveLength(1));
    // 一路传到渲染层：doc.labels[0].size → labelSync 的 TextStyle.fontSize
    expect(labelNodes[0].style?.fontSize).toBe(16);
  });

  /**
   * 改字号档要顺带改**已存在**的联动地名（G-4 / PRD §4.4「手动可调」）。
   *
   * 【为什么单独一条】页面上有两个入口能改字号：新建时用哪档、以及"给这条地名
   * 换一档"。后者走 `elementLabelOf(selectedId)` + `updateLabel` 那条分支，
   * 之前**零覆盖** —— 代码是对的，但没有任何用例；删掉那两行不会有东西变红，
   * 表现是"我在下拉里选了 16，画面上还是 12"。
   *
   * 三个断言缺一不可：① 真的变了；② 变到的是 16（不是随便一个数）；
   * ③ 撤销一步回到 12（`updateLabel` 走 `commit`，字号属于成品）。
   */
  it("改字号档更新已存在的联动地名：12 → 16 → 撤销回 12", async () => {
    await setup();

    // 放一座山（落位即选中），填一个地名 —— 不带 size 时默认 12 号
    pickSprite("山（中）");
    clickCanvas(localOf({ x: 30, y: 20 }));
    await waitFor(() => expect(countLabel()).toContain("1"));
    const nameBox = screen.getByPlaceholderText("地名");
    fireEvent.change(nameBox, { target: { value: "青云岭" } });
    fireEvent.keyDown(nameBox, { key: "Enter" });

    await waitFor(() => expect(labelNodes).toHaveLength(1));
    expect(labelNodes[0].text).toBe("青云岭");
    expect(labelNodes[0].style?.fontSize).toBe(12);

    // 素材此刻仍是选中态 → 改字号档应当落到这条联动地名上
    // 字号档下拉收在「更多」面板里，先展开
    openMore();
    chooseOption("label-size", "16 号");
    await waitFor(() => expect(selectValue("label-size")).toBe("16 号"));
    // 原地改样式（`labelSync` 替换 `node.style` 后仍是同一个 Text 节点）
    await waitFor(() => expect(labelNodes[0].style?.fontSize).toBe(16));

    // 字号是成品的一部分：撤销一步回到 12
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(labelNodes[0].style?.fontSize).toBe(12));
    // 撤销只退字号，不许把地名一起退掉
    expect(labelNodes[0].text).toBe("青云岭");
    expect(labelCount()).toContain("1");
  });
});

/**
 * 风格预设（B4）与它和撤销栈的关系。
 *
 * 风格是**成品的一部分**（"给读者看的配色"），不是视图偏好：选错了要能撤销回去。
 * 这一条与上面「显示分区」那条是同一类 —— 都是"文档字段 + 一个 UI 控件"，
 * 而漏掉 commit 的表现都是"控件变了、按撤销没反应"。
 */
describe("MapEditorPage 风格预设", () => {
  it("切风格：下拉变更进撤销栈，撤销回到「原色」、重做再回去", async () => {
    await setup();
    // 风格下拉收在「更多」面板里，先展开再断言
    openMore();
    expect(selectValue("style")).toBe("原色");

    chooseOption("style", "羊皮纸");
    await waitFor(() => expect(selectValue("style")).toBe("羊皮纸"));

    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(selectValue("style")).toBe("原色"));

    fireEvent.click(screen.getByRole("button", { name: "redo" }));
    await waitFor(() => expect(selectValue("style")).toBe("羊皮纸"));
  });

  /**
   * 重选同一档不得多压撤销步（否则连按撤销画面不动）。
   *
   * 【为什么这条要"先制造一步"再测】早期版本写的是「一进来就重选原色，断言
   * undo 按钮 disabled」—— 那是**空转用例**：文档刚建好本来就没有撤销步，
   * 断言在操作前后恒真；QA 把 `useMapEditor` 里的守卫整行删掉，它照样绿。
   * 现在的形态是"先真的压一步，再看重选有没有多压"，语义上必须能区分。
   *
   * ⚠️ 但**这条仍然不是守卫的证明**：antd/rc-select 对"重选同值"很可能根本
   * 不发 `onChange`（UI 层自己短路了），于是删掉守卫它也能过。守卫真正的
   * 证据在 `hooks/useMapEditor.test.tsx`（直接连调三次 `setStyle`，只认撤销栈
   * 深度，删掉守卫必红）。这里保留的是**端到端**那一层：用户真的点了两次。
   */
  it("重选同一档不多压撤销步：切羊皮纸 → 再点羊皮纸 → 一次撤销回原色", async () => {
    await setup();
    const undo = screen.getByRole("button", { name: "undo" });

    // 风格下拉收在「更多」面板里，先展开
    openMore();
    chooseOption("style", "羊皮纸");
    await waitFor(() => expect(selectValue("style")).toBe("羊皮纸"));
    // 此刻位置：撤销栈里有且只有 1 步
    expect(undo).toBeEnabled();

    // 同一个选项再点一次 —— 不许再压一步
    chooseOption("style", "羊皮纸");
    await waitFor(() => expect(selectValue("style")).toBe("羊皮纸"));

    // 一次撤销就必须回到原色（若多压了一步，这里会仍停在羊皮纸）
    fireEvent.click(undo);
    await waitFor(() => expect(selectValue("style")).toBe("原色"));
    // 栈真的空了：否则说明"羊皮纸"被压了两步，第一次撤销只是退到"羊皮纸→羊皮纸"
    expect(undo).toBeDisabled();
  });
});

/**
 * 「最小的单位放大到全屏」+ 素材随层级缩小（用户报障的正面验收）。
 *
 * 用户原话：「无极缩放，最小的单位尺寸太小了，根本无法添加几个要素，能不能将
 * 最小的单位的尺寸支持放大到全屏为止」。两条根因各钉一条用例：
 *   1. 缩放上限（旧的 `scales[last] × 4` = 8.89，中位郡铺满要 10~11 倍）；
 *   2. 素材的基准宽（80~160）比它所属的郡（长边 70~90）还大。
 */
describe("MapEditorPage 全屏缩放与素材尺寸", () => {
  /**
   * 缩放上限：**够得着，而且到顶就停**。
   *
   * 【为什么要两条断言，而不是"点 N 次后 > X"】早期版本只点 27 次、只断言 `>1000%`：
   * 0.8 × 1.1²⁷ = 1049%，而实际上限在**本测试的画布**下是 1779%
   * （宿主 rect 800×600 + 该种子的最细块长边 p05 ≈ 38.8 ⇒ 600 × 1.15 ÷ 38.8），
   * 那条用例**根本没摸到上限**：把 `ZOOM_FILL_OVERSCAN` 从 1.15 改成 0.6
   * （上限掉到 928%）它照样绿。
   *
   * 现在点 40 次（0.8 × 1.1⁴⁰ ≈ 3620%，远超上限），然后：
   *   · 读数 **> 1400%** —— 旧上限 889% 必红；过采样退化到 0.6（928%）也必红；
   *     1400 与实测的 1779 之间留 27% 余量，换种子也不会误伤。
   *     （不写 1800：那是按另一套画布算出的 20.5 倍，本环境的实际上限到不了，
   *      写死会让这条用例永远红。）
   *   · 再点 3 次，读数**一动不动** —— 证明是"夹在上限"，不是"还能继续放大"
   *     （`zoomAt` 漏 clamp 时这一条会红）。
   * 不断言到小数点：`scale × 画布尺寸` 的浮点结果会随环境抖动，
   * "是否停住"本身已经是夹紧行为的充分证据。
   */
  it("缩放上限抬到「郡能铺满画布」：能到 1400% 以上，且到顶后不再变大", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /生成区块/ }));
    await waitFor(() => expect(regionLabel()).toContain("223"));

    zoomBy("zoom-in", 40);
    await waitFor(
      () => expect(Number(zoomLabel().replace("%", ""))).toBeGreaterThan(1400),
      { timeout: 5000 },
    );

    // 再点 3 次：读数必须一动不动 ⇒ 是"夹在上限"，不是"还能继续放大"
    const atMax = zoomLabel();
    zoomBy("zoom-in", 3);
    await act(async () => {});
    expect(zoomLabel()).toBe(atMax);
  });

  /**
   * 命中区必须等于**视觉尺寸**。
   *
   * 郡级素材的绘制宽度是 `160 × 1/8 = 20` 世界单位（半宽 10）。若命中测试漏乘
   * 层级因子，同一个点击位置会以"半宽 80"来判 —— 于是点在素材旁边的空白处
   * 也能选中它（"看得见的地方点不中、看不见的地方点得中"的反面版本）。
   */
  it("郡级素材：点中心选中、点外接矩形外 1px 不选中", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /生成区块/ }));
    await waitFor(() => expect(regionLabel()).toContain("223"));

    // 放大到「郡」那一级（0.8 × 1.1¹¹ = 228%）
    zoomBy("zoom-in", 11);
    await waitFor(() => expect(levelChip()).toBe("郡"));

    // 山（大）基准 160×93；郡级因子 1/8 ⇒ 20×11.6，半宽 10
    pickSprite("山（大）");
    const anchor = { x: 0, y: 0 };
    clickCanvas(localAt(anchor));
    await waitFor(() => expect(countLabel()).toContain("1"));

    // 先取消选中，后面的点击才有断言价值
    clickCanvas({ x: 20, y: 1000 });
    expect(deleteButton()).toBeDisabled();

    // 竖直中部（锚点是脚底，素材在它上方）：能选中
    clickCanvas(localAt({ x: 0, y: -5 }));
    expect(deleteButton()).not.toBeDisabled();

    // 再取消，点"外接矩形外 1px"：半宽 10，这里 10.6（≈1.4px）
    clickCanvas({ x: 20, y: 1000 });
    expect(deleteButton()).toBeDisabled();
    clickCanvas(localAt({ x: 10.6, y: -5 }));
    expect(deleteButton()).toBeDisabled();
  });
});

/**
 * 层级配置浮层（R-REG-01）与合并子区域（R-REG-04）。
 *
 * 【为什么这两条必须走页面】它们是"文档 ←→ UI"的双向链路：
 *   · 层级配置：面板改 → `doc.regionSchema` → 工具栏按钮文案 / 层级胶囊 / 生成数量；
 *   · 合并：面板按钮 → 弹窗文案 → store 删子树 → 区块计数与提示语。
 * 单测能钉住每一段，但"按钮文案读的是组件状态还是文档"这种事只有页面能证伪
 * （`levelDepth` 那个第二事实源就是这么藏了一整轮）。
 */
describe("MapEditorPage 层级配置与合并子区域", () => {
  /** 「层级 N」按钮（文案跟着 `regionSchemaOf(doc).length` 走） */
  const schemaBtn = () => screen.getByRole("button", { name: /层级 \d/ });

  /** 展开层级配置浮层（内容挂 body，照常在 document 里查） */
  function openSchemaPanel(): HTMLElement {
    fireEvent.click(schemaBtn());
    return screen.getByRole("spinbutton", { name: "层数" });
  }

  /**
   * `modal.confirm` 弹层（挂在 body 上）。
   *
   * 【为什么按"最后一个"取，而不是 `screen.getByText`】弹层可以有多个并存
   * （不同动作各弹一个，例如"生成陆地"与"减少层级"），`getByText` 会直接
   * `Found multiple elements` 报错。取 DOM 顺序最上层那一个，是"用户点得到的那个"。
   *
   * 【曾经出现过"同一个动作叠出两层"】`rc-input-number` 失焦时会把输入框里的文本
   * 再 flush 一次（`changeOnBlur`），`onChange` 被连调两遍、两遍都弹窗。源码已用
   * `pendingPruneRef` 去重，由本文件「改层数并失焦：只弹一个」那条盯着。
   * 下面这些 helper 仍按"可能有多层"写（`drainConfirm` / `if (length > 0)`），
   * 因为它们同时服务于**真会并存**的不同弹层，不该为了掩盖缺陷而写成"只有一个"。
   */
  function confirmDialogs(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>(".ant-modal-confirm"));
  }

  /** 所有确认弹层的可见文案（用来断言"报了多少个区块要删"） */
  function confirmTexts(): string[] {
    return confirmDialogs().map((dialog) => dialog.textContent ?? "");
  }

  /** 点最上层确认弹层里文案匹配的按钮 */
  function clickConfirm(text: string): void {
    const dialog = confirmDialogs().at(-1);
    if (!dialog) throw new Error(`没有确认弹层，点不到「${text}」`);
    const btn = Array.from(dialog.querySelectorAll<HTMLElement>(".ant-modal-confirm-btns button")).find(
      (node) => (node.textContent ?? "").replace(/\s+/g, "").includes(text.replace(/\s+/g, "")),
    );
    if (!btn) throw new Error(`确认弹层里找不到「${text}」`);
    fireEvent.click(btn);
  }

  /** 把叠着的同名弹层逐层点掉（每层点同一个按钮），直到一个不剩 */
  function drainConfirm(text: RegExp): void {
    for (let guard = 0; guard < 5 && confirmDialogs().length > 0; guard += 1) {
      const dialog = confirmDialogs().at(-1) as HTMLElement;
      const btn = Array.from(
        dialog.querySelectorAll<HTMLElement>(".ant-modal-confirm-btns button"),
      ).find((node) => text.test(node.textContent ?? ""));
      if (!btn) throw new Error(`确认弹层里没有匹配 ${String(text)} 的按钮`);
      fireEvent.click(btn);
    }
  }

  it("层级配置：改层数写进文档并进撤销栈（撤销一步回到默认 4 级）", async () => {
    await setup();
    expect(schemaBtn().textContent ?? "").toContain("4");

    const depth = openSchemaPanel();
    fireEvent.change(depth, { target: { value: "2" } });
    fireEvent.blur(depth);

    // 按钮文案 = 文档里的层数（证明它不是另一份组件状态）
    await waitFor(() => expect(schemaBtn().textContent ?? "").toContain("2"));

    // 撤销一步：schema 回到"从没配置过"⇒ 读时回落默认 4 级
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(schemaBtn().textContent ?? "").toContain("4"));
  });

  it("层级名改了之后，工具栏层级胶囊跟着变（名称只从 schema 来）", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /生成区块/ }));
    await waitFor(() => expect(regionLabel()).toContain("223"));
    await waitFor(() => expect(levelChip()).toBe("洲 ↔ 国家"));

    openSchemaPanel();
    const nameInput = screen.getByRole("textbox", { name: "第 2 级名称" });
    fireEvent.change(nameInput, { target: { value: "州" } });
    fireEvent.blur(nameInput);

    await waitFor(() => expect(levelChip()).toBe("州 ↔ 国家"));
  });

  it("合并子区域：弹窗报数量与名字，确认后区块被删并提示「已合并 N 个」", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /生成区块/ }));
    await waitFor(() => expect(regionLabel()).toContain("223"));

    // 选中一个「大陆」（非叶子，后代最多）。通过 store 设选区而不是点画布：
    // 后者依赖某个种子下多边形的屏幕位置，改一个 wobble 参数就会假红。
    const root = useMapDocStore.getState().doc.regions.find((r) => r.level === 0);
    expect(root).toBeTruthy();
    await act(async () => {
      useMapSelectionStore.getState().setSelectedRegionId(root!.id);
    });

    const mergeBtn = screen.getByRole("button", { name: /合并子区域/ });
    expect(mergeBtn).not.toBeDisabled();
    // 按钮自己就报了后代数量（叶子时没有这段括号）
    expect(mergeBtn.textContent ?? "").toMatch(/（\d+）/);
    fireEvent.click(mergeBtn);

    // ── 弹窗四段文案（PRD §4.3 线框）──
    await waitFor(() =>
      expect(document.body.textContent ?? "").toMatch(
        /将「[^」]*」下的 \d+ 个子区块合并为一个：/,
      ),
    );
    const dialogText = document.body.textContent ?? "";
    expect(dialogText).toMatch(/成为最小单位，其边界保持原样/);
    expect(dialogText).toMatch(/此操作可撤销（Ctrl\+Z 一步恢复）/);

    const before = Number((regionLabel().match(/(\d+)/) ?? [])[1] ?? 0);
    expect(before).toBe(223);

    fireEvent.click(screen.getByText("仍要合并").closest("button") as HTMLElement);

    await waitFor(() =>
      expect(document.body.textContent ?? "").toMatch(/已合并 \d+ 个子区块（可撤销）/),
    );
    // 区块数真的少了（提示语里的 N 与文档变化的块数同源）
    await waitFor(() => {
      const after = Number((regionLabel().match(/(\d+)/) ?? [])[1] ?? 0);
      expect(after).toBeLessThan(before);
    });

    // 一次撤销：整棵子树回来
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(regionLabel()).toContain("223"));
  });

  /**
   * 减少层数时删除「超出层级的区块」必须先二次确认（PRD §4.1 边界④）。
   *
   * 【为什么单独立一条】工程师明确承认这条**没有页面级用例**：`handleSchemaChange`
   * 里那段 `modal.confirm` 是"删除 208 个区块"的唯一守卫，删掉它整段、或把 `onOk`
   * 的 `pruneLevelsAbove` 参数漏掉，都不会有任何既有用例变红 —— 而用户会**静默**丢掉
   * 大半张图的区块。这里同时钉住三件事：① 弹窗出现且报出正确的数量；② 取消不删；
   * ③ 确认后 schema 与区块删��是**同一步撤销**（一次 Ctrl+Z 两样一起回来）。
   */
  it("减少层数且存在超层区块 ⇒ 二次确认；取消保留、确认才删且可一步撤销", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /生成区块/ }));
    await waitFor(() => expect(regionLabel()).toContain("223"));

    const depth = openSchemaPanel();
    fireEvent.change(depth, { target: { value: "2" } });
    fireEvent.blur(depth);

    // 4→2 层：level≥2 的区块（48 国家 + 160 郡 = 208）会被删除，必须先确认
    await waitFor(() =>
      expect(confirmTexts().join(" | ")).toContain("将删除 208 个超出层级的区块"),
    );

    // ── 取消：一块都不删，层数也不变 ──
    drainConfirm(/^取\s*消$/);
    expect(regionLabel()).toContain("223");
    expect(useMapDocStore.getState().doc.regionSchema?.length ?? 4).toBe(4);

    // ── 再来一次，这回确认删除（取消后浮层多半已被关掉 ⇒ 按需重开）──
    if (!screen.queryByRole("spinbutton", { name: "层数" })) openSchemaPanel();
    const depth2 = screen.getByRole("spinbutton", { name: "层数" });
    fireEvent.change(depth2, { target: { value: "2" } });
    fireEvent.blur(depth2);
    await waitFor(() =>
      expect(confirmTexts().join(" | ")).toContain("将删除 208 个超出层级的区块"),
    );
    // 只点一次「删除并应用」，再点一次（叠出来的那层）**不能**多压撤销步
    clickConfirm("删除并应用");
    await waitFor(() => expect(regionLabel()).toContain("15"));
    // 叠出来的那一层还在：再点一次也必须是无操作（源码 `setRegionSchema` 对
    // "schema 没变且没有可删区块"直接返回，所以不会多压一步）
    if (confirmDialogs().length > 0) {
      clickConfirm("删除并应用");
      await act(async () => {});
      expect(useMapDocStore.getState().undoStack).toHaveLength(2);
    }
    drainConfirm(/^取\s*消$/);

    // 删完只剩两级：大陆 3 + 洲 12 = 15 块
    await waitFor(() => expect(regionLabel()).toContain("15"));
    expect(regionLabel()).not.toContain("223");

    // schema 变更与区块删除在同一个 commit：撤销一步两样一起回来
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(regionLabel()).toContain("223"));
    expect(useMapDocStore.getState().doc.regionSchema?.length ?? 4).toBe(4);
  });

  /**
   * 改层数并**失焦**只能弹**一个**「减少层级」。
   *
   * 【真实缺陷】`rc-input-number` 在 blur 时会把输入框文本再 flush 一次
   * （`changeOnBlur`），于是 `onChange` 被连调两遍。两遍都满足"新区块数 < 旧层数
   * ⇒ 先确认"，各弹一个一模一样的确认框 —— DOM 里叠着两层，点掉一层还有一层。
   * 数据上没丢东西（第二层点「删除并应用」时 schema 已变、`setRegionSchema` 直接
   * 返回），但"一次动作一个确认"是硬约束，叠层属于必须修的可见缺陷。
   *
   * 【为什么这条不能用「文案出现即通过」】`waitFor(text)` 在两层叠着时也成立
   * （`join` 后文本更长）。必须**数个数**，而且要等到 antd 把弹层真正挂完
   * （`modal.confirm` 是异步渲染进 body 的），否则第二层可能在断言之后才出现。
   */
  it("改层数并失焦：确认弹层恰好 1 个（失焦重复 onChange 不得叠层）", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /生成区块/ }));
    await waitFor(() => expect(regionLabel()).toContain("223"));

    const depth = openSchemaPanel();
    fireEvent.change(depth, { target: { value: "2" } });
    fireEvent.blur(depth);

    // 等弹层挂上来
    await waitFor(() => expect(confirmDialogs()).toHaveLength(1));
    // 再冲两拍：若有第二层，它也是在这一刻挂载的（同一轮 onChange 里的第二次调用）
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(confirmDialogs(), "改层数并失焦后叠出了多个确认弹层").toHaveLength(1);
    expect(confirmTexts()[0]).toContain("减少层级");
    expect(confirmTexts()[0]).toContain("将删除 208 个超出层级的区块");

    // ── 取消之后必须能**重新**弹出来 ──
    // （`pendingPruneRef` 没有在关闭时释放的话，第二次真改会被静默吞掉：
    //   表现为"确认框再也不弹、层数也不动"，比叠层更难排查。）
    drainConfirm(/^取\s*消$/);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(confirmDialogs()).toHaveLength(0);

    if (!screen.queryByRole("spinbutton", { name: "层数" })) openSchemaPanel();
    const depth2 = screen.getByRole("spinbutton", { name: "层数" });
    fireEvent.change(depth2, { target: { value: "2" } });
    fireEvent.blur(depth2);

    await waitFor(() => expect(confirmDialogs()).toHaveLength(1));
    expect(confirmTexts()[0]).toContain("将删除 208 个超出层级的区块");
  });
});

/**
 * 画区模式（R-REG-03）—— 页面级只验**入口、动作区与模式隔离**。
 *
 * 判定（自交 / 越界 / 封顶 / 重叠）全在 `regionEdit.test.ts`（纯函数）与
 * `useMapEditor.test.tsx`（编排）里；这里再测一遍只会把最贵的用例变成
 * 三层重复的慢测试（架构 §4.6「测试策略矩阵」）。
 */
describe("MapEditorPage 画区模式（R-REG-03）", () => {
  /** 画区动作区（不在画区模式时为 null） */
  function drawActions(): HTMLElement | null {
    return document.querySelector(".map-editor__draw-actions");
  }
  /** 「已画 N 点 · 已用 M/600」 */
  function drawCount(): string {
    return document.querySelector(".map-editor__draw-count")?.textContent ?? "";
  }
  /** 「层级 L2 洲」 */
  function drawLevel(): string {
    return document.querySelector(".map-editor__draw-level")?.textContent ?? "";
  }
  /** 已画点数（从文案里抠数字 —— 断言文案本身也顺带钉住格式） */
  function drawnPoints(): number {
    return Number((drawCount().match(/已画\s*(\d+)\s*点/) ?? [])[1] ?? -1);
  }

  // ⚠️ 一律用**正则**取按钮，两个坑都要躲：
  //   ① antd 的图标会把自己的名字（`highlight` / `undo` …）拼进可访问名；
  //   ② antd v6 会在**两个汉字**且无图标的按钮里自动插一个空格（「完成」→「完 成」）。
  const drawTool = () => screen.getByRole("button", { name: /画区/ });
  const selectTool = () => screen.getByRole("button", { name: /选择/ });
  const finishButton = () => screen.getByRole("button", { name: /完\s*成/ });
  const undoPointButton = () => screen.getByRole("button", { name: /撤销上一点/ });

  /** 在世界坐标处单击画布 */
  function clickWorld(world: { x: number; y: number }) {
    clickCanvas(localOf(world));
  }

  it("「画区」进入模式：动作区出现、层级取自 schema、完成与撤销在点数不足时 disabled", async () => {
    await setup();

    // 选择模式下没有动作区
    expect(drawActions()).toBeNull();

    fireEvent.click(drawTool());
    expect(drawActions()).not.toBeNull();
    // 未选中任何区块 ⇒ 画在顶层：L1 大陆（默认 schema 第一级）
    expect(drawLevel()).toBe("层级 L1 大陆");
    expect(drawCount()).toContain("已画 0 点");
    expect(drawCount()).toContain("已用 0/600");
    // 点数不足：两个按钮都必须 disabled（点了没反应比不给更糟）
    expect(finishButton()).toBeDisabled();
    expect(undoPointButton()).toBeDisabled();

    // 落 3 点
    clickWorld({ x: -300, y: -300 });
    clickWorld({ x: -150, y: -300 });
    clickWorld({ x: -150, y: -150 });
    await waitFor(() => expect(drawnPoints()).toBe(3));
    expect(finishButton()).not.toBeDisabled();
    expect(undoPointButton()).not.toBeDisabled();

    // 「撤销上一点」退一格，退到 0 仍留在画区模式
    fireEvent.click(undoPointButton());
    await waitFor(() => expect(drawnPoints()).toBe(2));
    fireEvent.click(undoPointButton());
    fireEvent.click(undoPointButton());
    await waitFor(() => expect(drawnPoints()).toBe(0));
    expect(drawActions()).not.toBeNull(); // 还在模式里

    // Esc 第一下：没草稿、在画区 ⇒ 回选择模式
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(drawActions()).toBeNull());

    // 再进一次，改用顶部「选择」退出 —— 两条退路都必须真的退得出来
    // （只留 Esc 的话，一个"按钮 handler 写错"的缺陷永远不会被这条用例发现）
    fireEvent.click(drawTool());
    expect(drawActions()).not.toBeNull();
    fireEvent.click(selectTool());
    await waitFor(() => expect(drawActions()).toBeNull());

    // 全程没有产生任何文档变更，也就没有快照
    expect(useMapDocStore.getState().doc.regions).toHaveLength(0);
    expect(useMapDocStore.getState().undoStack).toHaveLength(0);
  });

  it("落 3 点「完成」⇒ 新增一条手画区块；撤销一步整条消失", async () => {
    await setup();
    fireEvent.click(drawTool());

    clickWorld({ x: -300, y: -300 });
    clickWorld({ x: -150, y: -300 });
    clickWorld({ x: -150, y: -150 });
    await waitFor(() => expect(drawnPoints()).toBe(3));

    fireEvent.click(finishButton());
    await waitFor(() => expect(useMapDocStore.getState().doc.regions).toHaveLength(1));

    const created = useMapDocStore.getState().doc.regions[0];
    expect(created.origin).toBe("manual");
    expect(created.level).toBe(0);
    expect(created.parentId).toBeNull();
    expect(created.polygon).toHaveLength(3);
    // 成功即清空草稿，并留在画区模式（便于连续画）
    await waitFor(() => expect(drawnPoints()).toBe(0));
    expect(drawActions()).not.toBeNull();
    expect(drawCount()).toContain("已用 1/600");

    // 一次撤销：整块消失（落库是**一条**记录、**一次**快照）
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(useMapDocStore.getState().doc.regions).toHaveLength(0));
  });

  it("模式隔离：画区态在已有区块内点一下 ⇒ 选区不变、不新增区块、只多一个顶点", async () => {
    await setup();

    // ── 先用手画造出一块（比"生成 223 块"快得多，且几何完全可控）──
    fireEvent.click(drawTool());
    clickWorld({ x: -300, y: -300 });
    clickWorld({ x: 0, y: -300 });
    clickWorld({ x: 0, y: 0 });
    clickWorld({ x: -300, y: 0 });
    await waitFor(() => expect(drawnPoints()).toBe(4));
    fireEvent.click(finishButton());
    await waitFor(() => expect(useMapDocStore.getState().doc.regions).toHaveLength(1));
    const region = useMapDocStore.getState().doc.regions[0];

    // ── 回选择模式，点中那块地 ──
    fireEvent.keyDown(window, { key: "Escape" }); // 无草稿 ⇒ 退出画区
    await waitFor(() => expect(drawActions()).toBeNull());
    clickWorld({ x: -150, y: -150 });
    await waitFor(() =>
      expect(useMapSelectionStore.getState().selectedRegionId).toBe(region.id),
    );

    const regionsBefore = useMapDocStore.getState().doc.regions;

    // ── 进画区，在同一块地内部点一下 ──
    fireEvent.click(drawTool());
    // 选中 level 0 的区块 ⇒ 新块是它的子级（裁决 5：层级与父块只有这一处判定）
    expect(drawLevel()).toBe("层级 L2 洲");

    clickWorld({ x: -150, y: -150 });

    // ① 选区纹丝不动（画区态不得命中区块/素材）
    expect(useMapSelectionStore.getState().selectedRegionId).toBe(region.id);
    // ② 文档一个字段都没变（尤其 regions 的**引用**不变 ⇒ 没有任何 commit）
    expect(useMapDocStore.getState().doc.regions).toBe(regionsBefore);
    expect(useMapDocStore.getState().undoStack).toHaveLength(1); // 只有"画第一块"那一步
    // ③ 而顶点确实落下了 —— 否则上两条会退化成"点了没反应"也绿
    await waitFor(() => expect(drawnPoints()).toBe(1));
  });

  /* ────────── 双击收尾（R-REG-03 的回归主战场） ────────── */

  /**
   * 在同一处连点两下 = 双击（两次 down 的间隔必然 < 350ms）。
   *
   * 【为什么用两次 down/up 而不是 `fireEvent.doubleClick`】闭合判定已从 `dblclick`
   * 搬到 `pointerdown`：`dblclick` 是浏览器在**两次 down/up 之后**才派发的事件，
   * 那时顶点已经落下了，只能事后补救。真双击的行为必须用真实的事件序列表达。
   */
  function doubleClickWorld(world: { x: number; y: number }) {
    clickWorld(world);
    clickWorld(world);
  }

  /** 一个五边形的前 4 个顶点（第 5 个由"双击"提供），环绕质心递增、不自交 */
  const QUAD: Array<{ x: number; y: number }> = [
    { x: -300, y: -300 },
    { x: -100, y: -320 },
    { x: 0, y: -150 },
    { x: -200, y: 0 },
  ];
  const FIFTH = { x: -350, y: -120 };

  it("画 4 点再双击（第 5 点由双击提供）⇒ 落库顶点数是 5，不是 6", async () => {
    await setup();
    fireEvent.click(drawTool());
    for (const p of QUAD) clickWorld(p);
    await waitFor(() => expect(drawnPoints()).toBe(4));

    doubleClickWorld(FIFTH);

    // 【缺陷本体】旧实现挂在 dblclick 上：两对 down/up 会落两个顶点，
    // 收尾时要么多一个顶点（6），要么以 degenerate-edge 把整条草稿打回
    await waitFor(() => expect(useMapDocStore.getState().doc.regions).toHaveLength(1));
    const created = useMapDocStore.getState().doc.regions[0];
    expect(created.polygon).toHaveLength(5);
    expect(created.origin).toBe("manual");
    // 落库后草稿清空、仍在画区模式
    await waitFor(() => expect(drawnPoints()).toBe(0));
    expect(drawActions()).not.toBeNull();
    // 成功提示（没有落到任何 message.error 分支）
    expect(document.body.textContent ?? "").toMatch(/已创建区块/);
  });

  it("双击首顶点附近 ⇒ 闭合，第二下被静默吸收、不留未闭合顶点", async () => {
    await setup();
    fireEvent.click(drawTool());
    for (const p of QUAD) clickWorld(p);
    clickWorld(FIFTH);
    await waitFor(() => expect(drawnPoints()).toBe(5));

    // ── 双击：两下**相邻**发出，保证落在同一个 350ms 双击窗口内 ──
    //
    // 【为什么要相邻发】早期版本在两下之间夹了一个 `await waitFor(...)`；并发跑
    // 全量（`--maxWorkers=4` 与其它文件争 CPU）时那个 await 可能被拖到 >350ms，
    // 于是第二下被当成"新多边形的第一点"落下一个孤立顶点 —— 表现为"并发必红、
    // 单跑必绿"的假回归（实测正是这条）。两下相邻即无时间依赖，断言更稳。
    clickWorld(QUAD[0]); // 第一下：命中首顶点 ⇒ 立即闭合
    clickWorld(QUAD[0]); // 第二下：草稿已空 ⇒ 必须被静默吸收

    await waitFor(() => expect(useMapDocStore.getState().doc.regions).toHaveLength(1));
    // 顶点数 = 已落点数，既没多也没少（旧实现会多出第 6 点或残留孤立点）
    expect(useMapDocStore.getState().doc.regions[0].polygon).toHaveLength(5);
    // 关键：草稿已被清空 —— 不留未闭合顶点
    expect(drawnPoints()).toBe(0);
    // 第二下没有多造一块
    expect(useMapDocStore.getState().doc.regions).toHaveLength(1);
  });

  it("画 2 点再双击 ⇒ 落库 3 顶点（≥3 的下界仍然走得通）", async () => {
    await setup();
    fireEvent.click(drawTool());
    clickWorld({ x: -300, y: -300 });
    clickWorld({ x: -100, y: -300 });
    await waitFor(() => expect(drawnPoints()).toBe(2));

    doubleClickWorld({ x: -200, y: -100 });

    await waitFor(() => expect(useMapDocStore.getState().doc.regions).toHaveLength(1));
    expect(useMapDocStore.getState().doc.regions[0].polygon).toHaveLength(3);
  });

  it("缓慢点首顶点（两次 down 间隔 > 350ms）⇒ 走「命中首顶点」闭合，不新增顶点", async () => {
    await setup();
    fireEvent.click(drawTool());
    for (const p of QUAD) clickWorld(p);
    clickWorld(FIFTH);
    await waitFor(() => expect(drawnPoints()).toBe(5));

    // 真实等待，不用假时钟：双击窗口是 350ms，等 420ms 即可跨过它。
    // （假时钟会波及 React 调度与 antd 的动画计时，代价远大于这 0.4 秒。）
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });

    clickWorld(QUAD[0]);
    await waitFor(() => expect(useMapDocStore.getState().doc.regions).toHaveLength(1));
    // 顶点数 = 已落点数，既没多也没少
    expect(useMapDocStore.getState().doc.regions[0].polygon).toHaveLength(5);
    expect(drawnPoints()).toBe(0);
  });

  it("350ms 窗口之外在同一处再点一下**不闭合**（只是被判成手抖、去重吃掉）", async () => {
    await setup();
    fireEvent.click(drawTool());
    for (const p of QUAD) clickWorld(p);
    clickWorld(FIFTH);
    await waitFor(() => expect(drawnPoints()).toBe(5));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
    // 慢速地点在与上个顶点**完全相同**的位置：不是双击、也不是首顶点
    clickWorld(FIFTH);

    // 仍停在画区态、5 个点：若双击判定不看时间差，这里会闭合成一块
    expect(drawnPoints()).toBe(5);
    expect(useMapDocStore.getState().doc.regions).toHaveLength(0);
    expect(drawActions()).not.toBeNull();
  });

  /**
   * Esc 的四个消费者不能互相抢（画区加进来之后的竞争）。
   *
   * 靠的是 window 监听里那句 "target 是 INPUT 就 return" —— 这句是**约定**，
   * 一旦有人把它挪到 `const mod = ...` 之后，输入框里的 Esc 就会连带清掉草稿，
   * 而画面上只会表现为"按 Esc 有时取消、有时不取消"。这里把它钉成用例。
   */
  it("画区态 + 已落 3 点 + 焦点在输入框：Esc 只作用于输入框，草稿与模式都不动", async () => {
    await setup();

    // 先放一个素材（选中它，属性区才会出现「地名」输入框）
    pickSprite("森林");
    clickCanvas(localOf({ x: 0, y: 0 }));
    await waitFor(() => expect(countLabel()).toContain("1"));

    fireEvent.click(drawTool());
    clickWorld({ x: -300, y: -300 });
    clickWorld({ x: -100, y: -300 });
    clickWorld({ x: -100, y: -100 });
    await waitFor(() => expect(drawnPoints()).toBe(3));

    const input = screen.getByPlaceholderText("地名") as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });

    // 草稿与模式都纹丝不动
    expect(drawnPoints()).toBe(3);
    expect(drawActions()).not.toBeNull();
    // 反向对照：在**画布之外**（window 上）按 Esc，第一下就该清掉草稿
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(drawnPoints()).toBe(0));
    expect(drawActions()).not.toBeNull(); // 只清草稿，还在画区模式
  });

  /**
   * 画区态拖动画布 ≠ 撒顶点。
   *
   * 【为什么单独立一条】落点放在 `pointerup`（只有"几乎没移动"才算单击），正是为了
   * 让"拖空白平移"不误撒顶点。若把落点搬回 `pointerdown`（一个很自然的"顺手简化"），
   * 用户一拖动画布就会沿拖动轨迹撒下一串顶点 —— 而现有用例都不会红。
   */
  it("画区态拖动画布（位移 > CLICK_SLOP）⇒ 只平移、不撒顶点", async () => {
    await setup();
    fireEvent.click(drawTool());
    clickWorld({ x: -300, y: -300 });
    clickWorld({ x: -150, y: -300 });
    await waitFor(() => expect(drawnPoints()).toBe(2));

    const before = drawnPoints();
    // 按住并拖动超过单击阈值（CLICK_SLOP = 4px）：必须判为平移而不是"落一个顶点"
    const from = { x: 400, y: 500 };
    const to = { x: 560, y: 660 };
    fireEvent.pointerDown(host(), { clientX: from.x, clientY: from.y, pointerId: 1, button: 0 });
    fireEvent.pointerMove(host(), { clientX: to.x, clientY: to.y, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(host(), { clientX: to.x, clientY: to.y, pointerId: 1, button: 0 });
    await act(async () => {});

    // 顶点数不变（拖动不落点），仍在画区模式，也没有落库任何区块
    expect(drawnPoints()).toBe(before);
    expect(drawActions()).not.toBeNull();
    expect(useMapDocStore.getState().doc.regions).toHaveLength(0);
  });
});

/**
 * B1（R-MAP-23 / R-MAP-25）：素材属性面板 + 剪贴板 / 微移。
 *
 * 【为什么这些落在页面用例】store 层用例（useMapDocStore.element-actions.test.ts）
 * 钉的是"撤销栈账目"；这一组钉的是**接线**——面板真的出现在选中后、按钮真的
 * 调到了 store、全局快捷键真的绕过了输入框守卫。账目错了 store 用例红，接线错
 * 了只有这里能红。
 */
describe("MapEditorPage B1：素材属性面板与快捷键", () => {
  /** 放一座山并等计数变化（落位即选中） */
  async function placeMountain() {
    await setup();
    pickSprite("山（中）");
    clickCanvas(localOf({ x: 30, y: 20 }));
    await waitFor(() => expect(countLabel()).toContain("1"));
    return useMapDocStore.getState().doc.elements[0];
  }

  it("选中素材出属性面板：四件套滑杆 + 层级下拉 + 地名输入都在", async () => {
    await placeMountain();
    const panel = document.querySelector(".element-panel");
    expect(panel).not.toBeNull();
    // 四件套：尺寸 / 旋转 / 不透明 / 色相
    expect(panel?.querySelectorAll("[role='slider']").length).toBe(4);
    // 层级下拉与地名输入（placeholder 与工具栏时代一致，语义不变）
    expect(panel?.querySelector(".element-panel__level")).not.toBeNull();
    expect(screen.getByPlaceholderText("地名")).toBeTruthy();
    // 面板标题是素材名
    expect(panel?.querySelector(".element-panel__title")?.textContent).toContain("山");
  });

  it("Ctrl+C / Ctrl+V 连续粘贴：粘贴件可连贴、可撤销", async () => {
    await placeMountain();

    fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    await waitFor(() => expect(countLabel()).toContain("3"));
    // 两份副本都是新 id（不是把原素材挪了个位置）
    const ids = useMapDocStore.getState().doc.elements.map((el) => el.id);
    expect(new Set(ids).size).toBe(3);

    // 一次粘贴是一步撤销：退一步少一份
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(countLabel()).toContain("2"));
  });

  it("Ctrl+D 复制一份并选中新副本（副本出现在原位右下方）", async () => {
    const first = await placeMountain();
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    await waitFor(() => expect(countLabel()).toContain("2"));
    const els = useMapDocStore.getState().doc.elements;
    const copy = els[els.length - 1];
    expect(copy.id).not.toBe(first.id);
    expect(copy.x).toBeGreaterThan(first.x);
    // 副本自动选中：删除按钮可用即"当前有选中"
    expect(deleteButton()).not.toBeDisabled();
  });

  it("方向键微移：精调 4 / Shift 加速 16，连按合并为一步撤销", async () => {
    const first = await placeMountain();
    const x0 = first.x;

    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true });
    await waitFor(() =>
      expect(useMapDocStore.getState().doc.elements[0].x).toBeCloseTo(x0 + 24, 5),
    );

    // 连按是同一次移动：一步撤销回到起点
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(useMapDocStore.getState().doc.elements[0].x).toBeCloseTo(x0, 5));
  });

  it("置底按钮调整渲染顺序：后放的素材可以被垫到最先画的下面", async () => {
    await placeMountain();
    // 再放一座：后放者默认在最上层（数组尾），且落位即选中。
    // 【为什么放很远】点击命中已有素材 = 选中而不是落位；两座山太近时第二下
    // 只是选中了第一座，计数不动 —— 这是画布语义，不是 bug。
    pickSprite("山（中）");
    clickCanvas(localOf({ x: -280, y: -160 }));
    await waitFor(() => expect(countLabel()).toContain("2"));
    const secondId = useMapDocStore.getState().doc.elements[1].id;

    fireEvent.click(screen.getByRole("button", { name: "置底素材" }));
    // 选中者（后放者）被移到数组头 = 渲染最底层；先放者相应掉到数组尾
    const ids = useMapDocStore.getState().doc.elements.map((el) => el.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(secondId);
    expect(ids[1]).not.toBe(secondId);
  });

  it("输入框里的 Ctrl+C 不会被劫持成复制素材（守卫在先）", async () => {
    await placeMountain();
    // 聚焦地名输入框：这里的 Ctrl+C 必须是"复制文字"，不能动剪贴板
    const nameBox = screen.getByPlaceholderText("地名") as HTMLInputElement;
    fireEvent.focus(nameBox);
    fireEvent.change(nameBox, { target: { value: "青云岭" } });
    const clipboardBefore = useMapDocStore.getState().clipboard;
    fireEvent.keyDown(nameBox, { key: "c", ctrlKey: true });
    fireEvent.keyDown(nameBox, { key: "Enter" });
    await waitFor(() => expect(labelCount()).toContain("1"));
    // 剪贴板没被写入（复制文字不等于复制素材）
    expect(useMapDocStore.getState().clipboard).toBe(clipboardBefore);
  });
});

/**
 * B2（R-MAP-22）：素材与地名联动 —— 点要素落位自带默认名。
 *
 * 【为什么落在页面用例】联动逻辑在 useMapEditor.placeSprite（读取名池、
 * 查重、挂地名），store 与面板都感知不到。这里钉的是：摆一个城市即出现
 * 默认名、再摆一个自动换下一个名字（不撞名）、纯地貌（山）不带名。
 */
describe("MapEditorPage B2：点要素落位自带地名", () => {
  it("摆一个城市自动挂默认名，再摆一个不撞名", async () => {
    await setup();
    pickSprite("大城");
    clickCanvas(localOf({ x: -40, y: -30 }));
    await waitFor(() => expect(countLabel()).toContain("1"));
    pickSprite("大城");
    clickCanvas(localOf({ x: 40, y: 30 }));
    await waitFor(() => expect(countLabel()).toContain("2"));

    const labels = useMapDocStore.getState().doc.labels;
    expect(labels).toHaveLength(2);
    // 名池前两个依次取用，不重复
    expect(new Set(labels.map((l) => l.text)).size).toBe(2);
    expect(["临江城", "云中城"]).toContain(labels[0].text);
    expect(["临江城", "云中城"]).toContain(labels[1].text);
  });

  it("纯地貌（山）落位不带名", async () => {
    await setup();
    pickSprite("山（中）");
    clickCanvas(localOf({ x: 30, y: 20 }));
    await waitFor(() => expect(countLabel()).toContain("1"));
    expect(useMapDocStore.getState().doc.labels).toHaveLength(0);
  });
});

/**
 * 一键成图（B3 / R-MAP-21）—— 状态链路层。
 *
 * 几何与确定性在 `domain/generator.test.ts`；这里覆盖「按钮 → 弹层 → 生成 →
 * 落库 → 撤销」的编排链路，以及五档重掷里最两条易错的语义：
 * 只换素材（陆地不动）与只换地名（素材不动）。
 */
describe("MapEditorPage 一键成图（B3）", () => {
  it("生成一张：陆地/素材/地名一次落库，撤销一步全回来", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /一键成图/ }));
    fireEvent.click(await screen.findByRole("button", { name: /生成一张/ }));

    await waitFor(
      () => {
        const { doc } = useMapDocStore.getState();
        expect(doc.land).not.toBeNull();
        expect(doc.elements.length).toBeGreaterThan(20);
        expect(doc.labels.length).toBeGreaterThan(0);
      },
      { timeout: 20000 },
    );

    // 地名全部与素材联动（生成器产出的标注不落孤儿）
    for (const l of useMapDocStore.getState().doc.labels) {
      expect(l.elementId).toBeTruthy();
    }
    // 摘要就地展示（review §5.3 反馈断点）
    expect(await screen.findByText(/已生成：陆地/)).toBeTruthy();

    // 撤销一步：陆地 / 素材 / 地名一起回退（applyGenerated 单 commit）
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(useMapDocStore.getState().doc.land).toBeNull());
    expect(useMapDocStore.getState().doc.elements).toHaveLength(0);
    expect(useMapDocStore.getState().doc.labels).toHaveLength(0);
  });

  it("五档重掷：只换素材时陆地不动；只换地名时素材不动", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /一键成图/ }));
    fireEvent.click(await screen.findByRole("button", { name: /生成一张/ }));
    await waitFor(
      () => expect(useMapDocStore.getState().doc.elements.length).toBeGreaterThan(0),
      { timeout: 20000 },
    );
    const before = useMapDocStore.getState().doc;
    const seedBefore = before.land!.seed;

    // ── 只换素材：素材换血，陆地区块原样 ──
    fireEvent.click(await screen.findByRole("button", { name: /只换素材/ }));
    await waitFor(() => {
      const after = useMapDocStore.getState().doc;
      expect(after.elements.map((e) => e.id)).not.toEqual(before.elements.map((e) => e.id));
    });
    expect(useMapDocStore.getState().doc.land!.seed).toBe(seedBefore);

    // ── 只换地名：素材 id 集不动，地名仍全部联动 ──
    const idsAfterSprites = useMapDocStore.getState().doc.elements.map((e) => e.id);
    fireEvent.click(await screen.findByRole("button", { name: /只换地名/ }));
    await waitFor(() => {
      const after = useMapDocStore.getState();
      expect(after.doc.elements.map((e) => e.id)).toEqual(idsAfterSprites);
      // relabelElements 走了 commit（撤销栈增长）且标注依然全部绑定素材
      expect(after.undoStack.length).toBeGreaterThan(0);
    });
    for (const l of useMapDocStore.getState().doc.labels) {
      expect(l.elementId).toBeTruthy();
    }
  });

  it("画布已有内容时首次生成先确认；取消则不动文档", async () => {
    await setup();
    // 先放一个素材，让画布"有内容"
    pickSprite("山（中）");
    clickCanvas(localOf({ x: 30, y: 20 }));
    await waitFor(() => expect(countLabel()).toContain("1"));

    fireEvent.click(screen.getByRole("button", { name: /一键成图/ }));
    fireEvent.click(await screen.findByRole("button", { name: /生成一张/ }));
    // 确认框出现 → 取消
    expect(await screen.findByText(/将替换当前陆地、素材与地名/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /取\s*消/ }));
    await waitFor(() => expect(screen.queryByText(/将替换当前陆地、素材与地名/)).toBeNull());
    expect(useMapDocStore.getState().doc.elements).toHaveLength(1);
    expect(useMapDocStore.getState().doc.land).toBeNull();
  });
});
