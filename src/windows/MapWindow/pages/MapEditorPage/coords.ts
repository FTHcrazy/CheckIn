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
export const ZOOM_LIMITS = { min: 0.1, max: 8 } as const;

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
  limits = ZOOM_LIMITS,
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

/** 平移：按屏幕像素位移换算成世界坐标位移 */
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
 * 计算「让指定世界矩形适配画布」的视口
 * 用于"适应窗口"按钮与底图首次载入时的初始视口。
 */
export function fitToRect(
  rect: { x: number; y: number; width: number; height: number },
  size: CanvasSize,
  padding = 0.9,
  limits = ZOOM_LIMITS,
): Viewport {
  if (rect.width <= 0 || rect.height <= 0 || size.width <= 0 || size.height <= 0) {
    return { x: 0, y: 0, scale: 1 };
  }
  const scale = clamp(
    Math.min(size.width / rect.width, size.height / rect.height) * padding,
    limits.min,
    limits.max,
  );
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
