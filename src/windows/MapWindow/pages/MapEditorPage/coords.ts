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

/**
 * 手工落位避让的 AABB 外扩量（世界单位，参考实现口径 +30px）。
 *
 * 【为什么是外扩而不是严格 AABB】严格的"中心落在已有素材的命中盒内"只拦
 * 深叠；+30 的呼吸边把"贴着边摆"也拦下来 —— 摆出来的图才是"一坨一坨、
 * 边缘留白"，而不是贴纸拼边。参考实现 `@142908` 用 30px（屏幕像素），
 * 我们在**世界单位**上取同一个数：落位避让关心的是素材与素材的相对关系
 * （素材自身就是世界单位标定的），与视口缩放无关。
 */
export const ELEMENT_PLACE_PAD = 30;

/**
 * 手工落位避让（P2-3）：`center` 是否落进任一已有元素命中盒的外扩区内。
 *
 * 【语义】参考实现 `@142908`：手拖**新**素材落位时，AABB(+30px) 拦住"中心
 * 被已有素材压住"的落点 —— 不拦就可能出现"聚落被压在山体正中间，
 * 看得见但选不到"。盒的形状与 `hitTestElement` 完全同构（底部锚点、
 * width×scale 外接盒），`boxes` 直接复用命中测试的参数形状。
 *
 * 【只拦"新落位"，不拦"移动既有素材"】拦截如果作用于拖拽，用户就永远
 * 无法把压住的素材拖开解围 —— 调用方（useMapEditor.placeSprite）只在
 * 新建素材时调用本函数；`moveElementBy` 路径不设防。
 *
 * 【外扩只在水平两侧 + 竖直两端各一次】即呼吸边加在盒外围一圈，
 * 不是把 scale 放大。
 */
export function isCenterCovered(
  center: { x: number; y: number },
  boxes: readonly { x: number; y: number; width: number; height: number; scale: number }[],
): boolean {
  for (const el of boxes) {
    const halfW = (el.width * el.scale) / 2 + ELEMENT_PLACE_PAD;
    const top = el.y - el.height * el.scale - ELEMENT_PLACE_PAD;
    const bottom = el.y + ELEMENT_PLACE_PAD;
    if (
      center.x >= el.x - halfW &&
      center.x <= el.x + halfW &&
      center.y >= top &&
      center.y <= bottom
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 多边形命中测试（射线法，不要求凸多边形）。
 *
 * 【为什么单列一个函数】区块多边形是崎岖化的凹多边形（regions.ts §2 的产物），
 * 不能用「点到各边同侧」的凸多边形判据。射线法（point-in-polygon）对任意简单
 * 多边形都成立，O(n) 即可，供「点选区块 → 圈定生成子图」用。
 *
 * 【有限性】`NaN` 顶点直接跳过（一条边含 NaN 时射线交点在 NaN 里丢失，结果仍
 * 是"不在内/在外"的稳定判断，不会抛错）；顶点少于 3 个恒为 false。
 */
export function hitTestPolygon(
  point: { x: number; y: number },
  polygon: readonly { x: number; y: number }[],
): boolean {
  if (polygon.length < 3) return false;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;

  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    // 含 NaN 的边不参与判定（否则比较结果为 false，可能整体判错一次）
    if (
      !Number.isFinite(xi) ||
      !Number.isFinite(yi) ||
      !Number.isFinite(xj) ||
      !Number.isFinite(yj)
    ) {
      continue;
    }
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * 子图「贴合变换」—— 把子图本地坐标映射到父图世界坐标的仿射变换。
 *
 * 【为什么是「外接矩形等比缩放 + 居中」而不是「旋转/非等比拉伸」】
 * 子图是一张独立地图，塞进父图区块时最自然的方式是「等比缩放铺满区块包围盒、
 * 居中放置」。等比保证子图内容不变形；居中保证子图中心落在区块包围盒中心。
 * 旋转/非等比贴合（boundary 篇的 A2 方案）是可选增强，本函数只做最稳的 A1。
 *
 * 【子图 bounds 与区块包围盒的坐标域】子图的 `bounds` 是**子图本地坐标**里的
 * 世界范围（原点在子图中心）；区块的 `polygon` 是**父图世界坐标**。本函数输入
 * 「子图 bounds」与「父图里的目标矩形（通常是区块包围盒）」，输出一个
 * `{ x, y, scale }`：子图本地点 p 映射到父图世界 = `p × scale + (x, y)`。
 *
 * 【无级缩放如何继承】这个 scale 是**常数**（不随视口缩放变）。真正驱动子图
 * 无级缩放的仍是根 `world.scale`——子图子树挂在这个常数变换之下，再被根
 * 缩放连带变换，于是「等效缩放 = 根缩放 × 本常数」，子图 LOD 用等效值查表。
 *
 * 纯函数、无 DOM，单测在 `coords.test.ts`。
 */
export interface SubmapFit {
  /** 子图本地**原点**在父图世界坐标里的位置 */
  x: number;
  y: number;
  /** 子图本地 → 父图世界的等比缩放 */
  scale: number;
}

export function fitSubmapTransform(
  submapBounds: { x: number; y: number; width: number; height: number },
  targetRect: { x: number; y: number; width: number; height: number },
): SubmapFit {
  /**
   * 【有限性校验（AGENTS §6.0）】子图 bounds 与目标矩形都来自文档数据 / 区块
   * 几何，可能混入 `NaN` / 非正尺寸（序列化损坏）。等比缩放 = 目标宽 / 子图宽，
   * 一旦分母为 0 或 NaN，`scale` 就是 `Infinity` / `NaN`，子图子树直接消失且
   * 报错埋在 Pixi 内部。这里任何一边非法就退回「恒等变换 + 目标中心」，
   * 至少让子图以原始尺寸出现在正确位置，而不是整棵消失。
   */
  const sw = submapBounds.width;
  const sh = submapBounds.height;
  const tw = targetRect.width;
  const th = targetRect.height;
  const centerX = Number.isFinite(targetRect.x) ? targetRect.x + tw / 2 : 0;
  const centerY = Number.isFinite(targetRect.y) ? targetRect.y + th / 2 : 0;

  if (
    !Number.isFinite(sw) ||
    !Number.isFinite(sh) ||
    !Number.isFinite(tw) ||
    !Number.isFinite(th) ||
    sw <= 0 ||
    sh <= 0 ||
    tw <= 0 ||
    th <= 0
  ) {
    return { x: centerX, y: centerY, scale: 1 };
  }

  // 等比缩放：取「宽比」与「高比」的较小者，子图完整落在目标矩形内且不变形
  const scale = Math.min(tw / sw, th / sh);
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;

  /**
   * 位移 = 目标中心 − **子图 bounds 中心** × s。
   *
   * 【为什么必须减 bounds 中心，而不是直接返回目标中心】映射是
   * `世界 = 本地点 × s + (x, y)`，即 `p = 0`（子图**坐标系原点**）落在 `(x, y)`。
   * 而子图内容的包围盒中心是 `bounds.x + w/2`，通常**不是 0** —— 早期版本直接
   * 把目标中心当 `(x, y)`，等于假设"子图内容一定以原点为中心"。bounds 居中时
   * 这个巧合成立（所以一直没暴露），一旦绑定一张内容偏在一侧的地图（路径 A′），
   * 整个子图就会整体平移出去，且**不报错、只在画面上"看起来偏了"**。
   */
  const scx = Number.isFinite(submapBounds.x) ? submapBounds.x + sw / 2 : 0;
  const scy = Number.isFinite(submapBounds.y) ? submapBounds.y + sh / 2 : 0;
  return { x: centerX - scx * s, y: centerY - scy * s, scale: s };
}
