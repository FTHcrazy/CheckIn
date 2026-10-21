/**
 * 导出 PNG 的纯函数层（R27 / S5，RG-X 系列）
 *
 * 导出走 `webContents.capturePage()`：**截的就是用户眼前那一帧**，所以不存在
 * 「屏幕上一套、导出另一套」的第二渲染器（这正是 RG-X-02 / RG-G-04 一直在防的）。
 * 代价是两件必须由我们自己兜住的事，也正好是本文件的两块内容：
 *
 * 1. **截哪一块**：`capturePage(rect)` 的单位是 DIP（= CSS px），不是设备像素。
 *    矩形要整取（小数会让截图错半像素）、要 clamp 进视口（画布被挤出可视区时
 *    `getBoundingClientRect()` 会给负数），还得挡住「1×1 的废图」。
 *    像素 = CSS × DPR 由 `pixelSize` 说明：**1× 屏就是 1×**，不假装 2×
 *    （`zoomFactor=2` 缩的是 CSS 视口，不是提高采样，附录 A 已否决）。
 *
 * 2. **别把 UI 截进去**：工具栏、缩放控件、密度提示条、连线手柄、选中描边都是
 *    「屏幕上的辅助」，不是「图的一部分」。清单在这里定义一次，scss 按清单写
 *    规则（`export-png.test.ts` 双向校验：清单里每条都要在 scss 里有落点，
 *    否则等于写了条死规则 —— 这类「看不见的失效」只能靠源码断言拦）。
 *
 * 文件名消毒与 `novel-export-file` 同口径（RG-X-09）：两条通道各写一份正则迟早
 * 会漂移，但这里没法复用主进程的实现（跨进程），所以用同一份字符集 + 单测锚定。
 */

/** 导出期间挂在画布根节点上的类（纯 CSS 抑制，不触发 React 重渲染） */
export const EXPORT_CLASS = "is-exporting";

/** 画布小于这个边长就没有导出价值（折叠态 / 未布局完成） */
export const EXPORT_MIN_SIDE = 48;

/**
 * 覆盖物：导出时**整块隐藏**。
 *
 * 顺序与重要性无关，列进来只有一条标准：它在屏幕上存在是为了「操作」，
 * 而不是为了「看图」。`visibility: hidden` 而不是 `display: none`：
 * 前者不触发 reflow / 不改变布局，截图期间图面一个像素都不会挪。
 */
export const EXPORT_HIDE_SELECTORS = [
  ".rel-canvas__toolbar",
  ".rel-canvas__dense",
  ".react-flow__controls",
  ".react-flow__attribution",
  ".rel-node__handle",
  ".react-flow__selection",
] as const;

/**
 * 覆盖物：不隐藏，只把「选中态」压回常态。
 *
 * 选中的节点有外发光、选中的边是主题色 2px —— 那是「你正在操作这条」的提示，
 * 导出后用户看到会以为图上真有一条更粗的边。
 */
export const EXPORT_NEUTRALIZE_SELECTORS = [
  ".react-flow__node.selected",
  ".react-flow__edge.selected",
] as const;

export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** `getBoundingClientRect()` 的最小子集（便于单测直接喂字面量） */
export interface BoxLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * DOMRect → `capturePage` 的整数矩形（DIP）。
 *
 * - **整取**：`Math.round` 两端再相减，而不是各自取宽高。否则「left=10.6,
 *   width=300.4」会截成「11 + 300」，右缘少 0.4px 变成白边 / 少一条边。
 * - **clamp 到视口**：画布放在右侧时 `left` 可能是正数、也可能因为横向滚动为
 *   负数；Electron 对越界矩形不报错，只给你一张填黑的图。
 * - **最小 1**：宽度为 0 的截图在 Electron 里会返回空图，直接走「导出失败」
 *   比让用户等三秒重试好。
 */
export function resolveCaptureRect(
  box: BoxLike,
  viewport?: { width: number; height: number },
): CaptureRect {
  const maxWidth = viewport ? Math.max(viewport.width, 0) : Number.POSITIVE_INFINITY;
  const maxHeight = viewport ? Math.max(viewport.height, 0) : Number.POSITIVE_INFINITY;

  const left = box.left;
  const top = box.top;
  const right = box.left + box.width;
  const bottom = box.top + box.height;

  const x = clamp(Math.round(left), 0, maxWidth);
  const y = clamp(Math.round(top), 0, maxHeight);
  const width = clamp(Math.round(right), 0, maxWidth) - x;
  const height = clamp(Math.round(bottom), 0, maxHeight) - y;

  return {
    x,
    y,
    width: Math.max(width, 1),
    height: Math.max(height, 1),
  };
}

/** 画布够不够大：太小时导出的是一张没有信息的图，不如直接告诉用户 */
export function isRectUsable(rect: CaptureRect): boolean {
  return rect.width >= EXPORT_MIN_SIDE && rect.height >= EXPORT_MIN_SIDE;
}

/**
 * 导出像素尺寸 = CSS 尺寸 × DPR（RG-X-01 改写后的口径）。
 *
 * `devicePixelRatio` 在 1× 屏是 1、2× 屏是 2；用户把窗口拖到另一块屏时
 * 它会在不重载的情况下变化，所以每次导出都要现读，不能缓存。
 */
export function pixelSize(
  rect: CaptureRect,
  dpr: number,
): { width: number; height: number } {
  const factor = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return {
    width: Math.round(rect.width * factor),
    height: Math.round(rect.height * factor),
  };
}

/** Windows / macOS 都不接受的文件名字符（九个，与主进程 `novel-export-file` 同集） */
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;

/**
 * 文件名消毒（RG-X-09）：非法字符 → `_`；已带 `.png` 不产生 `.png.png`；
 * 消毒后只剩空白则回落默认名（书名是空串时用户不该拿到一个 `.png`）。
 */
export function sanitizeFileName(raw: string, ext = "png"): string {
  const suffix = ext.replace(/^\./, "").toLowerCase() || "png";
  const fallback = "人物关系图";
  // 合并连续空白：书名里有换行时文件名会变成两截，看着像被截断了
  const cleaned = (raw ?? "").replace(INVALID_FILENAME_CHARS, "_").replace(/\s+/g, " ").trim();
  const base = cleaned || fallback;
  const lower = base.toLowerCase();
  const stem = lower.endsWith(`.${suffix}`) ? base.slice(0, -(suffix.length + 1)) : base;
  return `${stem.trim() || fallback}.${suffix}`;
}

/** 导出时的默认文件名：`<书名> 人物关系图.png` */
export function exportFileName(workName: string): string {
  const name = (workName ?? "").trim();
  return sanitizeFileName(name ? `${name} 人物关系图` : "人物关系图");
}
