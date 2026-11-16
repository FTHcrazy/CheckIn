import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MapEditorPage 页面级回归（拆分）：折线工具（B4-2 / R-MAP-26）。
 *
 * 本文件不 mock MapCanvas，只替换 pixi 后端与纹理，真实覆盖
 * 「工具切换 → 落点 → 收尾落库 → 选中 → 拖节点 → 双击增删点 → 锁定 → 键盘」
 * 整条链路。拆分原因与探针注入方式见 `index.generate.test.tsx` 头部。
 *
 * 数值前提（可复算）：画布 1024²、初始缩放 0.8、官道基准宽 5 世界单位 ⇒
 * 线命中容差 = 5/2 + 6px ÷ 0.8 = 10 世界单位；节点命中 8px 屏幕 = 10 世界单位。
 * 用例里的"线上 / 空白"坐标都按这两个数挑的，别随手挪。
 */
import {
  clickCanvas,
  dragCanvas,
  host,
  installPointerShims,
  localOf,
  rect,
  setup,
} from "./__test-utils";
import { resetMapStores } from "./store/reset";
import { useMapDocStore } from "./store/useMapDocStore";
import { useMapSelectionStore } from "./store/useMapSelectionStore";
import { docPolylines } from "./types";

const { spritePositions, labelNodes } = vi.hoisted(() => ({
  spritePositions: [] as { x: number; y: number }[],
  labelNodes: [] as {
    text: string;
    destroyed: boolean;
    style: { fontSize?: number } | null;
  }[],
}));

vi.mock("pixi.js", async () => {
  const { createPixiMock } = await import("./__pixi-mock");
  return createPixiMock({ spritePositions, labelNodes });
});

vi.mock("./hooks/useTextureCache", () => ({
  useTextureCache: () => ({ textures: {}, ready: true }),
}));

installPointerShims();

let rectSpy: ReturnType<typeof vi.spyOn>;

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

vi.setConfig({ testTimeout: 120000 });

/* ───────────── 查询小工具 ───────────── */

const polylines = () => docPolylines(useMapDocStore.getState().doc);
const polylineTool = () => screen.getByRole("button", { name: "折线" });
const finishButton = () => screen.getByRole("button", { name: "完成折线" });
const drawCount = () =>
  document.querySelector(".map-editor__draw-count")?.textContent ?? "";
const panel = () => document.querySelector('[data-testid="polyline-panel"]');

/** 渲染页面 → 进入折线模式 → 画两点 → 点「完成」（落库并自动选中） */
async function drawLine(a = { x: 0, y: 0 }, b = { x: 100, y: 0 }) {
  await setup();
  fireEvent.click(polylineTool());
  clickCanvas(localOf(a));
  clickCanvas(localOf(b));
  expect(drawCount()).toContain("2 点");
  fireEvent.click(finishButton());
}

describe("MapEditorPage 折线工具", () => {
  it("完成：≥2 点落库、自动选中（属性面板浮出）、退出绘制态", async () => {
    await drawLine();

    const list = polylines();
    expect(list).toHaveLength(1);
    expect(list[0].points[0].x).toBeCloseTo(0, 5);
    expect(list[0].points[1].x).toBeCloseTo(100, 5);
    // 默认样式档 + 未生成区块时的落笔层级 = 层级无关
    expect(list[0].styleId).toBe("road-main");
    expect(list[0].level).toBeNull();

    expect(panel()).not.toBeNull();
    expect(polylineTool().getAttribute("aria-pressed")).toBe("false");
  });

  it("少于 2 点：Enter 收尾直接丢弃并退出模式，不产生幽灵线", async () => {
    await setup();
    fireEvent.click(polylineTool());
    clickCanvas(localOf({ x: 0, y: 0 }));
    expect(drawCount()).toContain("1 点");

    fireEvent.keyDown(window, { key: "Enter" });
    expect(polylines()).toHaveLength(0);
    expect(polylineTool().getAttribute("aria-pressed")).toBe("false");
  });

  it("双击收尾：第二次按下判成收尾，不落第三个点", async () => {
    await setup();
    fireEvent.click(polylineTool());
    clickCanvas(localOf({ x: -50, y: 0 }));
    clickCanvas(localOf({ x: 80, y: 0 }));
    // 第三下与第二下同处、间隔 < 350ms ⇒ 收尾（此前缺陷：这里会多落一个点）
    clickCanvas(localOf({ x: 80, y: 0 }));

    expect(polylines()).toHaveLength(1);
    expect(polylines()[0].points).toHaveLength(2);
  });

  it("点线选中 / 点空白取消：属性面板随之浮出与收起", async () => {
    await drawLine();
    // 空白：距线 200+ 世界单位，远超 10 的命中容差
    clickCanvas(localOf({ x: -260, y: -200 }));
    expect(panel()).toBeNull();

    // 线的正中（与两端各 50 单位，远超节点命中圈）⇒ 重新选中
    clickCanvas(localOf({ x: 50, y: 0 }));
    expect(panel()).not.toBeNull();
  });

  it("拖节点：按绝对世界坐标移动，且拖拽全程只占一步撤销", async () => {
    await drawLine();
    expect(useMapDocStore.getState().undoStack).toHaveLength(1); // 落库一步

    // 抓住起点 (0,0)（恰在 10 世界单位的命中圈内）拖到 (60,0)
    dragCanvas(localOf({ x: 0, y: 0 }), localOf({ x: 60, y: 0 }));

    const pts = polylines()[0].points;
    expect(pts[0].x).toBeCloseTo(60, 5);
    expect(pts[0].y).toBeCloseTo(0, 5);
    expect(pts[1].x).toBeCloseTo(100, 5);
    // 拖拽开始压的那一步（历史缺陷：每个 move 压一步会把 50 步撤销吃光）
    expect(useMapDocStore.getState().undoStack).toHaveLength(2);

    // 撤销一步回到拖拽前，另一点不受影响
    useMapDocStore.getState().undo();
    expect(polylines()[0].points[0].x).toBeCloseTo(0, 5);
    expect(polylines()[0].points[1].x).toBeCloseTo(100, 5);
  });

  it("双击线上插点（取线上最近点，不是鼠标位置）；再双击该节点删掉它", async () => {
    await drawLine();

    // 双击线正中 (50,0)：距两端节点各 50 单位 ⇒ 不会误判成删节点
    const mid = localOf({ x: 50, y: 0 });
    fireEvent.doubleClick(host(), { clientX: mid.x, clientY: mid.y });

    expect(polylines()[0].points).toHaveLength(3);
    // 直线的 Catmull-Rom 平滑曲线恰好过中点，插的位置应是 (50,0) 附近
    expect(polylines()[0].points[1].x).toBeCloseTo(50, 1);
    expect(polylines()[0].points[1].y).toBeCloseTo(0, 1);

    // 现在正中是一个节点：同一处再双击 ⇒ 删点（节点优先于插点）
    fireEvent.doubleClick(host(), { clientX: mid.x, clientY: mid.y });
    expect(polylines()[0].points).toHaveLength(2);
  });

  it("锁定「折线」层：点线不再选中并提示先解锁", async () => {
    await drawLine();
    clickCanvas(localOf({ x: -260, y: -200 })); // 先取消选中
    expect(panel()).toBeNull();

    // ⚠️ 锁定必须包在 act 里：它发生在 React 事件之外，不 flush 的话
    // 下面那次点击用的还是「未锁」的旧闭包 —— 真实应用里锁来自面板点击
    // （同一次 React 提交），不存在这个时序。
    await act(async () => {
      useMapDocStore.getState().setLayerLocked("polyline", true);
    });
    clickCanvas(localOf({ x: 50, y: 0 })); // 点在线上

    expect(panel()).toBeNull();
    expect(document.body.textContent).toContain("已锁定");

    // 解锁后同一点位恢复可选（锁定只是暂时挡住，不破坏任何数据）
    await act(async () => {
      useMapDocStore.getState().setLayerLocked("polyline", false);
    });
    clickCanvas(localOf({ x: 50, y: 0 }));
    expect(panel()).not.toBeNull();
  });

  it("Delete 键分两个语境：绘制态退一个草稿点，选中态删整条线", async () => {
    await setup();
    fireEvent.click(polylineTool());
    clickCanvas(localOf({ x: 0, y: 0 }));
    clickCanvas(localOf({ x: 100, y: 0 }));
    expect(drawCount()).toContain("2 点");

    // 绘制态：线还没落库，Delete 只退草稿点（历史缺陷：这里被 closeDraft 抢走，
    // 选择模式下素材永远删不掉 —— 靠 tool 分流修掉）
    fireEvent.keyDown(window, { key: "Delete" });
    expect(drawCount()).toContain("1 点");
    expect(polylines()).toHaveLength(0);

    // 退到 1 点再 Enter：少于 2 点丢弃并退出
    fireEvent.keyDown(window, { key: "Enter" });
    expect(polylineTool().getAttribute("aria-pressed")).toBe("false");
  });

  it("选中态 Delete 删整条线（折线优先于素材删除）", async () => {
    await drawLine();
    expect(polylines()).toHaveLength(1);

    fireEvent.keyDown(window, { key: "Delete" });
    expect(polylines()).toHaveLength(0);
    expect(panel()).toBeNull();

    // 删线可撤销
    useMapDocStore.getState().undo();
    expect(polylines()).toHaveLength(1);
  });
});

describe("MapEditorPage 折线 · B4-3（闭合 / 剪贴板 / 微移）", () => {
  /** 画三点（三角形）备用：闭合与开关用例的公共前置 */
  async function drawTriangle() {
    await setup();
    fireEvent.click(polylineTool());
    clickCanvas(localOf({ x: 0, y: 0 }));
    clickCanvas(localOf({ x: 100, y: 0 }));
    clickCanvas(localOf({ x: 50, y: 100 }));
    fireEvent.click(finishButton());
  }

  it("点回起点（≥3 点、10px 屏幕 = 12.5 世界单位内）＝ 闭合收尾", async () => {
    await drawTriangle();
    expect(polylines()).toHaveLength(1);
    expect(polylines()[0].closed).toBe(false);

    // 重新进入绘制态再验证闭合路径：点回首点附近
    fireEvent.click(polylineTool());
    clickCanvas(localOf({ x: 0, y: 0 }));
    clickCanvas(localOf({ x: 100, y: 0 }));
    clickCanvas(localOf({ x: 50, y: 100 }));
    // 距首点 5 世界单位 = 4px 屏幕 < DRAFT_CLOSE_PX(10px)；距末点 (50,100) 很远
    clickCanvas(localOf({ x: 5, y: 0 }));

    expect(polylines()).toHaveLength(2);
    expect(polylines()[1].closed).toBe(true);
    expect(polylines()[1].points).toHaveLength(3); // 没有把"回起点"多落一个点
    // 收尾后退出绘制态并自动选中
    expect(polylineTool().getAttribute("aria-pressed")).toBe("false");
    expect(panel()).not.toBeNull();
  });

  it("属性面板「闭合」开关：两点线禁用（零面积闭环没有意义）", async () => {
    await drawLine();
    const sw = screen.getByRole("switch", { name: "折线首尾相连" }) as HTMLButtonElement;
    expect(sw.disabled).toBe(true);
  });

  it("属性面板「闭合」开关：≥3 点切换写 closed", async () => {
    await drawTriangle();
    const sw = () => screen.getByRole("switch", { name: "折线首尾相连" }) as HTMLButtonElement;
    expect(sw().disabled).toBe(false);
    expect(sw().getAttribute("aria-checked")).toBe("false");
    fireEvent.click(sw());
    expect(polylines()[0].closed).toBe(true);
    expect(sw().getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw());
    expect(polylines()[0].closed).toBe(false);
  });

  it("Ctrl+C / Ctrl+V：粘贴出斜移 16 单位的副本并选中它（剪贴板可连用）", async () => {
    await drawLine();
    fireEvent.keyDown(window, { key: "c", ctrlKey: true });
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });

    const list = polylines();
    expect(list).toHaveLength(2);
    expect(list[1].points[0]).toEqual({ x: 16, y: 16 });
    expect(list[1].styleId).toBe("road-main");

    // 粘贴出来的那条获得折线选中（面板语义跟对象类型走）
    const selection = useMapSelectionStore.getState();
    expect(selection.selectedPolylineId).toBe(list[1].id);
    expect(selection.selectedId).toBeNull();

    // 再贴一次：剪贴板不消耗
    fireEvent.keyDown(window, { key: "v", ctrlKey: true });
    expect(polylines()).toHaveLength(3);
  });

  it("Ctrl+D 复制一份；方向键整体微移（精调步长 4 世界单位，一步撤销）", async () => {
    await drawLine();
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    expect(polylines()).toHaveLength(2);

    // 微移作用于当前选中的那份（复制出来的副本）
    const before = polylines().find((p) => p.id === useMapSelectionStore.getState().selectedPolylineId)!;
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    const after = polylines().find((p) => p.id === before.id)!;
    expect(after.points[0].x).toBeCloseTo(before.points[0].x - 8, 5);
    expect(after.points[1].x).toBeCloseTo(before.points[1].x - 8, 5);

    // 连按合并：两步方向键只占一步撤销
    const stack = useMapDocStore.getState().undoStack.length;
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(useMapDocStore.getState().undoStack.length).toBe(stack); // 与前两按同键合并
  });

  it("Shift+方向键加速微移（步长 16 世界单位）", async () => {
    await drawLine();
    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true });
    expect(polylines()[0].points[0].x).toBeCloseTo(16, 5);
  });
});
