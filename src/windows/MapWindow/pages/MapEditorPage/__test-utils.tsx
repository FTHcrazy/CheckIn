import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntApp } from "antd";
import { expect } from "vitest";
import MapEditorPage from "./index";

/**
 * MapEditorPage 页面级回归测试的**共享工具与常量**。
 *
 * 【为什么拆出来】`index.test.tsx` 原先是单个 2214 行的大文件，内部 51 条用例无法
 * 并行，独占全量测试约 722s。拆成 4 个 `index*.test.tsx` 后由 vitest 文件级并行
 * 消化；这些常量、指针事件桩、以及 `clickCanvas`/`zoomBy`/`chooseOption` 等查询
 * helper 是所有拆分文件共用的，收在这里避免 4 份复制粘贴各改各的。
 *
 * 【本文件不是测试文件】命名不带 `.test.`，vitest 不会把它收集成用例；
 * 它 import 被测页面（`./index`），因此必须在各拆分文件 `vi.mock("pixi.js")` /
 * `vi.mock("./hooks/useTextureCache")` 注册**之后**才被 import —— 各文件顶部
 * 的 import 顺序已保证这一点（`vi.mock` 被提升到 import 之前）。
 */

/** 画布基准尺寸（由 getBoundingClientRect 桩决定） */
export const CANVAS = 1024;
/**
 * 初始适配后的缩放。fitToRect 对 1024×1024 的底图在 1024×1024 画布上：
 * min(1024/1024, 1024/1024) * FIT_PADDING(0.8) = 0.8。
 *
 * 这里刻意写死 0.8 而**不**从源码 import FIT_PADDING：那是被测行为本身，
 * 跟着源码走就失去断言价值（改成 1.0 铺满画布这种回归将无人发现）。
 */
export const SCALE = 0.8;
/** 初始视口中心恒为底图中心 = 世界原点 */
export const VIEW = { x: 0, y: 0 };
/** 四周留白宽度（画布像素）：底图占 819px，两侧各余 ≈102px */
export const MARGIN = (CANVAS - CANVAS * SCALE) / 2;

export const rect = {
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

/** jsdom 未实现 PointerEvent / 指针捕获：用 MouseEvent 顶替并补空实现 */
export function installPointerShims(): void {
  if (typeof window.PointerEvent === "undefined") {
    (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
  }
  if (typeof Element.prototype.setPointerCapture !== "function") {
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
  }
}

/** 世界坐标 → 画布本地像素（与 coords.worldToScreen 同式） */
export function localOf(world: { x: number; y: number }) {
  return {
    x: (world.x - VIEW.x) * SCALE + CANVAS / 2,
    y: (world.y - VIEW.y) * SCALE + CANVAS / 2,
  };
}

/** 画布本地像素 → 世界坐标（与 coords.screenToWorld 同式） */
export function worldOf(local: { x: number; y: number }) {
  return {
    x: (local.x - CANVAS / 2) / SCALE + VIEW.x,
    y: (local.y - CANVAS / 2) / SCALE + VIEW.y,
  };
}

export function host(): HTMLElement {
  return document.querySelector(".map-canvas") as HTMLElement;
}

/** 单击画布（无位移） */
export function clickCanvas(local: { x: number; y: number }) {
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
export function dragCanvas(from: { x: number; y: number }, to: { x: number; y: number }) {
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
export function deleteButton(): HTMLElement {
  return screen.getByRole("button", { name: "delete" });
}

/**
 * 工具栏缩放标签文本。
 * 注意不能用 getByText —— 该 span 的祖先容器 textContent 同样是 "90%"，
 * 会命中多个元素而报错。
 */
export function zoomLabel(): string {
  return document.querySelector(".map-editor__zoom-label")?.textContent ?? "";
}

/** 工具栏素材计数文本（同上，用类选择器精确定位） */
export function countLabel(): string {
  return document.querySelector(".map-editor__count")?.textContent ?? "";
}

/** 工具栏层级胶囊文本；未生成区块时该元素不渲染，返回空串 */
export function levelChip(): string {
  return document.querySelector(".map-editor__level-chip")?.textContent ?? "";
}

/** 画布下方提示：说明新放置的素材会归入哪一级 */
export function canvasHint(): string {
  return document.querySelector(".map-editor__canvas-hint")?.textContent ?? "";
}

/**
 * 世界坐标 → 画布本地像素，缩放取自**页面当前真实显示**的值。
 *
 * 不能用上面那个基于常量 SCALE 的 localOf：本组用例会在 80% 与 228% 之间来回，
 * 换算必须跟着实际视口走。（缩放锚点是画布中心，所以视口中心恒为世界原点。）
 */
export function localAt(world: { x: number; y: number }) {
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
export function zoomBy(button: "zoom-in" | "zoom-out", times: number) {
  const el = screen.getByRole("button", { name: button });
  for (let i = 0; i < times; i += 1) fireEvent.click(el);
}

/** 工具栏"已生成 N 块"文本；无区块时该元素不渲染，返回空串 */
export function regionLabel(): string {
  return document.querySelector(".map-editor__region-count")?.textContent ?? "";
}

/** 素材面板底部提示：反映当前是否处于"待放置"态 */
export function pendingHint(): string {
  return document.querySelector(".sprite-panel__hint")?.textContent ?? "";
}

/** 工具栏陆地种子标签；未生成陆地时该元素不渲染，返回空串 */
export function landLabel(): string {
  return document.querySelector(".map-editor__land-seed")?.textContent ?? "";
}

/** 工具栏地名计数（恒渲染，0 也在） */
export function labelCount(): string {
  return document.querySelector(".map-editor__label-count")?.textContent ?? "";
}

/**
 * 地名编辑覆盖层。
 *
 * 它是绝对定位的 DOM 输入框（Pixi 没有输入控件），用类选择器取而不是按 role：
 * 同一时刻页面上还可能有一个「地名」属性输入框，按 role 取会命中多个。
 */
export function draftInput(): HTMLInputElement | null {
  return document.querySelector(".map-canvas__label-input") as HTMLInputElement | null;
}

/** 三个工具栏下拉的稳定标识（antd 的 role=combobox 有三个，按 role 取会撞） */
export type SelectName = "style" | "export" | "label-size";

/**
 * 读某个下拉**当前选中**的文案。
 *
 * 【类名按 antd 6 的实际 DOM 写】本仓是 antd **6.6.2**，内部结构已不是 5.x 的
 * `.ant-select-selector` / `.ant-select-selection-item`，而是 `.ant-select-content`
 * （选中项）/ `.ant-select-input`（输入框）/ `.ant-select-suffix`（箭头）。
 * 按 5.x 的类名去查只会得到 `null`，而错误表现是"下拉里明明显示了原色，断言说空"。
 */
export function selectValue(which: SelectName): string {
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
export function chooseOption(which: SelectName, label: string) {
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
export function pickSprite(label: string) {
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
export function openMore(): HTMLElement {
  // 幂等：面板已在 DOM 里（dropdown 未关闭）时直接复用，避免重复点击导致 toggle 关闭
  let panel = document.querySelector(".map-editor__more-panel") as HTMLElement | null;
  if (panel) return panel;
  fireEvent.click(screen.getByRole("button", { name: "more" }));
  panel = document.querySelector(".map-editor__more-panel") as HTMLElement | null;
  if (!panel) throw new Error("「更多」面板未展开");
  return panel;
}

/** 渲染页面并等待初始适配完成（缩放标签变成 80%） */
export async function setup() {
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
