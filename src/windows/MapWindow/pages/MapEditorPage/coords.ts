/**
 * 地图画布 · 坐标系统（纯函数，必须覆盖单元测试）
 *
 * 【设计原则】所有坐标换算只能从这里取，禁止在组件内另行推导。
 * 这是保证「素材位置与底图位置一致」的唯一手段（架构报告 §12）。
 *
 * 术语：
 *   world  —— 地图逻辑坐标（原点在地图中心，避免深层缩放的浮点抖动）
 *   screen —— 画布视口像素坐标（DOM 坐标，原点在画布左上角）
 */

/** 视口状态：整个地图编辑器的唯一事实源 */
export interface Viewport {
  /** 视口中心对应的世界坐标 X */
  x: number;
  /** 视口中心对应的世界坐标 Y */
  y: number;
  /** 缩放倍率，1 = 100% */
  scale: number;
}

/** 画布尺寸（CSS 像素） */
export interface CanvasSize {
  width: number;
  height: number;
}

/** 缩放上下限（PRD §4.7） */
export interface ZoomLimits {
  min: number;
  max: number;
}

/**
 * 默认缩放上下限。
 *
 * 【它只是"还没有区块"时的兜底】一旦生成了区块，真实上下限由 `lod.ts` 的
 * `zoomLimitsForBlocks` 按「层级 + 最细一级的实际块长边 + 画布尺寸」反推
 * （上限 = 让最细一级的一块铺满画布短边所需缩放）—— 那时本常量就不参与了。
 * 这里保留 0.1~8 是为了：打开编辑器但还没点"生成区块"时仍能正常缩放，
 * 且这个区间与"整图适配 0.7~0.8 倍"在同一量级（能缩回整图、能放大 10 倍）。
 *
 * 不要写成 `as const`：那样推导出的是字面量类型 `{ readonly min: 0.1; max: 8 }`，
 * 一旦它被用作默认参数，函数签名就只接受「恰好等于这两个字面量」的对象，
 * 而 `zoomLimitsFor()` 按层级反推出的 `{ min: number; max: number }` 会被拒。
 */
export const ZOOM_LIMITS: ZoomLimits = { min: 0.1, max: 8 };

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * 世界坐标 → 屏幕坐标
 *
 * 世界原点在地图中心、屏幕原点在左上角，所以先减画布中心、
 * 再乘缩放、最后加回画布中心。这一步算错就会整体偏移半个画布。
 */
export function worldToScreen(
  world: { x: number; y: number },
  viewport: Viewport,
  size: CanvasSize,
): { x: number; y: number } {
  return {
    x: (world.x - viewport.x) * viewport.scale + size.width / 2,
    y: (world.y - viewport.y) * viewport.scale + size.height / 2,
  };
}

/** 屏幕坐标 → 世界坐标（worldToScreen 的精确逆运算） */
export function screenToWorld(
  screen: { x: number; y: number },
  viewport: Viewport,
  size: CanvasSize,
): { x: number; y: number } {
  return {
    x: (screen.x - size.width / 2) / viewport.scale + viewport.x,
    y: (screen.y - size.height / 2) / viewport.scale + viewport.y,
  };
}

/**
 * 以光标为锚点缩放
 *
 * 必须保证「缩放前光标下的世界坐标」==「缩放后光标下的世界坐标」，
 * 否则用户会感觉抓不住画面（地图类工具最易被吐槽的体验问题）。
 */
export function zoomAt(
  viewport: Viewport,
  screenAnchor: { x: number; y: number },
  factor: number,
  size: CanvasSize,
  limits: ZoomLimits = ZOOM_LIMITS,
): Viewport {
  const nextScale = clamp(viewport.scale * factor, limits.min, limits.max);
  if (nextScale === viewport.scale) return viewport;

  const world = screenToWorld(screenAnchor, viewport, size);
  return {
    x: world.x - (screenAnchor.x - size.width / 2) / nextScale,
    y: world.y - (screenAnchor.y - size.height / 2) / nextScale,
    scale: nextScale,
  };
}

/**
 * 一档缩放的倍率。
 *
 * 1.1 是"小格微调"的精度基准：在郡那一级（≈200%）一格只走 20 个百分点，
 * 用户能停在"两个郡之间的恰好位置"。
 */
export const ZOOM_STEP = 1.1;

/**
 * 一档滚轮对应的逻辑像素数。
 *
 * 【为什么需要它】缩放上限从 8.9 抬到 20 左右之后，若一格滚轮只走 1.1 倍，
 * 从适配缩放（0.70）滚到上限要走 35 格（实测）—— 用户会以为"滚不动了"。
 * 触控板一次滑动能给出 300~800 的 deltaY，正是"大 delta 一次到位"的机会。
 *
 * 【为什么是 50 而不是 100】Chrome/Windows 一格鼠标滚轮的 `deltaY` 恰好是
 * 100，按 100 折算等于"什么也没改"（仍是 35 格）。取 50 ⇒ 一格 = 2 档 = 1.21 倍，
 * 全程 17 格（见 `useMapEditor.test.tsx` 附近的实测），与 Google Maps 一类
 * 应用的手感（每格 1.2~1.25）一致，而小 delta（3~10）仍被下面的地板钳到 1 档。
 */
export const WHEEL_NOTCH_PX = 50;

/**
 * 单个滚轮事件最多折算成几档。
 *
 * 触控板"甩"一下能给出四位数 deltaY；不封顶会一步从整图跳到上限、中间细节
 * 全被跳过（且无法再复现"我停在哪一格"）。
 */
export const WHEEL_MAX_STEPS = 6;

/**
 * 把滚轮事件的 `deltaY` 折算成缩放倍率。
 *
 * 三条约束，缺一条手感就坏：
 *   · **方向**：`deltaY < 0`（向上滚）= 放大，与操作系统一致；
 *   · **地板 1 档**：小 delta（触控板慢速、工具栏按钮传的 ±1）永远走满一档，
 *     否则"轻轻推一下滚轮"会变成 1.001 倍，看起来像没反应；
 *   · **上限 `WHEEL_MAX_STEPS` 档**：见上。
 *
 * 纯函数、无 DOM，单测在 `coords.test.ts`。
 */
export function wheelZoomFactor(deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  const steps = Math.min(WHEEL_MAX_STEPS, Math.max(1, Math.abs(deltaY) / WHEEL_NOTCH_PX));
  const factor = ZOOM_STEP ** steps;
  return deltaY < 0 ? factor : 1 / factor;
}

/**
 * 平移：按屏幕像素位移换算成世界坐标位移
 */
export function panByScreenDelta(
  viewport: Viewport,
  dxScreen: number,
  dyScreen: number,
): Viewport {
  return {
    x: viewport.x - dxScreen / viewport.scale,
    y: viewport.y - dyScreen / viewport.scale,
    scale: viewport.scale,
  };
}

/**
 * 「适应窗口」时底图占视口的比例，其余部分作为四周的**留白**。
 *
 * 【为什么必须留白】底图一旦铺满画布，四条边都被画框裁掉，读起来是"一块
 * 望不到边的大陆"——轮廓不可见，反而失了分量。留下一圈空白后，整张地图
 * 作为**一张完整的图纸**呈现：边界、外轮廓全都在视野里，四周的空白正好
 * 把它衬出来。0.8 = 四周各留视口的 10%。
 *
 * 【与主题的关系】底图之外的这片空白由画布背景提供（见 MapCanvas 的
 * `backgroundAlpha: 0`），因此它会跟随主题的 `--app-bg`，深浅主题都成立。
 */
export const FIT_PADDING = 0.8;

/**
 * 让矩形适配画布所需的缩放（**不含上下限钳制**）。
 *
 * 单独抽出来是因为它有两个用途：一是"适应窗口"，二是**推导缩放下限** ——
 * 无论层级配置成几级，用户都必须能把整张地图缩进视野，所以下限取
 * `min(层级推出来的下限, 这里的适配缩放)`。两者共用同一个换算，避免各写一遍。
 */
export function fitScaleFor(
  rect: { x: number; y: number; width: number; height: number },
  size: CanvasSize,
  padding = FIT_PADDING,
): number {
  if (rect.width <= 0 || rect.height <= 0 || size.width <= 0 || size.height <= 0) return 1;
  return Math.min(size.width / rect.width, size.height / rect.height) * padding;
}

/**
 * 计算「让指定世界矩形适配画布」的视口
 * 用于"适应窗口"按钮与底图首次载入时的初始视口。
 */
export function fitToRect(
  rect: { x: number; y: number; width: number; height: number },
  size: CanvasSize,
  padding = FIT_PADDING,
  limits: ZoomLimits = ZOOM_LIMITS,
): Viewport {
  if (rect.width <= 0 || rect.height <= 0 || size.width <= 0 || size.height <= 0) {
    return { x: 0, y: 0, scale: 1 };
  }
  const scale = clamp(fitScaleFor(rect, size, padding), limits.min, limits.max);
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
    scale,
  };
}

/** 命中测试：判断世界坐标是否落在某元素的拖动区域内 */
export function hitTestElement(
  worldPoint: { x: number; y: number },
  element: { x: number; y: number; width: number; height: number; scale: number },
): boolean {
  // 元素的 x/y 是其「底部锚点」（贴图脚底），命中区在锚点上方
  const w = element.width * element.scale;
  const h = element.height * element.scale;
  const left = element.x - w / 2;
  const right = element.x + w / 2;
  const top = element.y - h;
  const bottom = element.y;
  return (
    worldPoint.x >= left &&
    worldPoint.x <= right &&
    worldPoint.y >= top &&
    worldPoint.y <= bottom
  );
}
