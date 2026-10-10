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
const { spritePositions } = vi.hoisted(() => ({
  spritePositions: [] as { x: number; y: number }[],
}));

vi.mock("pixi.js", () => {
  /** 只声明被测代码真正用到的成员，类型宽松以便子类覆写 */
  type Setter = { set: (...args: number[]) => void };

  class FakeContainer {
    children: unknown[] = [];
    scale: Setter = { set: () => {} };
    position: Setter = { set: () => {} };
    addChild(...kids: unknown[]) {
      this.children.push(...kids);
      return kids[0];
    }
    removeChild() {}
    destroy() {}
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
    // 立刻 resolve：测试只关心坐标与手势，不关心 Pixi 生命周期
    init = vi.fn(async () => {});
    destroy = vi.fn();
  }

  const Texture = { EMPTY: Symbol("empty") };
  return {
    Application,
    Container: FakeContainer,
    Sprite: FakeSprite,
    Graphics: FakeGraphics,
    Texture,
  };
});

/** 纹理加载无关本测试：直接给空表 + ready，避免触碰真实网络/解码 */
vi.mock("./hooks/useTextureCache", () => ({
  useTextureCache: () => ({ textures: {}, ready: true }),
}));

// 依赖 mock 之后再导入被测页面
import MapEditorPage from "./index";
import { worldToScreen } from "./coords";

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

/** 连点缩放按钮若干次 */
function zoomBy(button: "zoom-in" | "zoom-out", times: number) {
  for (let i = 0; i < times; i += 1) {
    fireEvent.click(screen.getByRole("button", { name: button }));
  }
}

/** 工具栏"已生成 N 块"文本；无区块时该元素不渲染，返回空串 */
function regionLabel(): string {
  return document.querySelector(".map-editor__region-count")?.textContent ?? "";
}

/** 素材面板底部提示：反映当前是否处于"待放置"态 */
function pendingHint(): string {
  return document.querySelector(".sprite-panel__hint")?.textContent ?? "";
}

/** 选中左侧面板的素材（进入待放置态） */
function pickSprite(label: string) {
  const img = screen.getByAltText(label);
  fireEvent.click(img.closest("button") as HTMLElement);
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
  rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
});

afterEach(() => {
  // 未开启 vitest globals 时 RTL 不会自动清理，DOM 会跨用例累积
  cleanup();
  rectSpy.mockRestore();
});

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

  it("区块：可生成、可撤销、可重做、可清除", async () => {
    await setup();

    const generate = screen.getByRole("button", { name: /生成区块/ });
    /** 每次重新查询：按钮的 disabled 会随状态切换，避免持有过期节点 */
    const clearRegionsBtn = () => screen.getByRole("button", { name: "minus-circle" });

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
    // 默认 4 级共 223 块（3 + 12 + 48 + 160）；改成 2 级应只剩前两级 15 块
    const depth = screen.getByRole("spinbutton");
    fireEvent.change(depth, { target: { value: "2" } });
    fireEvent.blur(depth);

    fireEvent.click(screen.getByRole("button", { name: /生成区块/ }));
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

    const zoomIn = () => screen.getByRole("button", { name: "zoom-in" });
    const zoomOut = () => screen.getByRole("button", { name: "zoom-out" });

    for (let i = 0; i < 11; i += 1) fireEvent.click(zoomIn());
    await waitFor(() => expect(state()).toBe("228% → 郡"), { timeout: 3000 });

    // 「适应窗口」应当精确回到起点（无极衔接可逆，不该有迟滞或漂移）
    fireEvent.click(screen.getByRole("button", { name: "expand" }));
    await waitFor(() => expect(state()).toBe("80% → 洲 ↔ 国家"), { timeout: 3000 });

    // 继续缩出去：洲淡出、大陆淡入，最终只剩大陆
    for (let i = 0; i < 9; i += 1) fireEvent.click(zoomOut());
    await waitFor(() => expect(state()).toBe("34% → 大陆"), { timeout: 3000 });
  }, 15000);

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
    clickCanvas(localAt({ x: anchor.x, y: 0 }));
    expect(deleteButton()).not.toBeDisabled();
  }, 15000);

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
  }, 15000);
});
