/**
 * 地图画布 · 坐标系统一（纯函数，必须有单测）
 *
 * 【设计原则】两层渲染（WebGL 底图 + SVG 交互）必须共享同一套坐标变换。
 * 任何坐标换算只能从这里取，禁止在组件内另行推导 —— 这是保证
 * "SVG 展示的图像与 PNG 位置一致" 的唯一手段。
 *
 * 术语：
 *   world  —— 地图逻辑坐标（双精度，原点在地图中心）
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

/** 画布尺寸（CSS 像素，两层必须完全一致） */
export interface CanvasSize {
  width: number;
  height: number;
}

/**
 * 世界坐标 → 屏幕坐标
 *
 * 注意：世界原点在地图中心，屏幕原点在左上角，
 * 所以必须先减去画布中心，再乘缩放，最后加回画布中心。
 * 这一步做错，两层就会整体偏移半个画布。
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
 * 【为什么必须这么做】若以画布中心为锚点缩放，光标下的内容会漂移，
 * 用户感觉"抓不住"。实测这是地图类工具最容易被吐槽的体验问题之一。
 *
 * 实现：保证「缩放前光标下的世界坐标」== 「缩放后光标下的世界坐标」
 */
export function zoomAt(
  viewport: Viewport,
  screenAnchor: { x: number; y: number },
  factor: number,
  size: CanvasSize,
  limits: { min: number; max: number } = { min: 0.1, max: 8 },
): Viewport {
  const nextScale = clamp(viewport.scale * factor, limits.min, limits.max);
  // 已达边界时直接返回原对象，避免无意义的 re-render
  if (nextScale === viewport.scale) return viewport;

  // 锚点下的世界坐标（缩放前后必须不变）
  const world = screenToWorld(screenAnchor, viewport, size);
  // 反解：要让 world 在同样屏幕位置，视口中心应在哪
  const nextX = world.x - (screenAnchor.x - size.width / 2) / nextScale;
  const nextY = world.y - (screenAnchor.y - size.height / 2) / nextScale;

  return { x: nextX, y: nextY, scale: nextScale };
}

/** 生成用于 SVG 的等价变换串（与 WebGL 层参数必须同源） */
export function viewportToSvgTransform(
  viewport: Viewport,
  size: CanvasSize,
): string {
  // 与 worldToScreen 完全等价的矩阵表达：
  // translate(画布中心) scale(s) translate(-视口中心)
  const tx = size.width / 2 - viewport.x * viewport.scale;
  const ty = size.height / 2 - viewport.y * viewport.scale;
  return `translate(${tx}, ${ty}) scale(${viewport.scale})`;
}

/** 生成用于 WebGL(Pixi) 的等价变换（三者必须由同一份 viewport 推出） */
export function viewportToStageTransform(
  viewport: Viewport,
  size: CanvasSize,
): { x: number; y: number; scale: number } {
  return {
    x: size.width / 2 - viewport.x * viewport.scale,
    y: size.height / 2 - viewport.y * viewport.scale,
    scale: viewport.scale,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
