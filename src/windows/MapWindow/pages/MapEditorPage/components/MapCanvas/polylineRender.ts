/**
 * 折线的**绘制**：把一条 `MapPolyline` 画到 `Graphics` 上（只依赖几何与样式表）。
 *
 * 【为什么独立于 MapCanvas】三件事让"画一条线"必须单独可测：
 *   ① 双层描边（深褐 + 米白芯）的**先后顺序**错了会得到"一根灰棍"而不是手绘感的线，
 *      而画布测试里只能看到"多了个 Graphics"，看不出先后；
 *   ② 虚线与两端渐隐是**多条子路径**拼出来的，路数错了肉眼要盯很久才看出"虚得太密"；
 *   ③ 线宽的屏幕下限是"世界单位 / 像素"的换算，安静地算错只会让线一直偏细。
 * 这里用最小能力集（`StrokeTarget`）而不是 `Graphics` 类型做参数，单测拿一个记录
 * 对象就能断言"画了几笔、什么颜色、什么粗细"。
 */

import type { Point } from "../../regions";
import type { MapPolyline } from "../../types";
import { dashPath, pointTangentAtLength, ribbonPolygon, smoothPolyline } from "../../polylineGeometry";
import {
  dashLengthsOf,
  effectiveWidthWorld,
  polylineStyleOf,
  type PolylineStyle,
} from "../../polylineStyle";

/**
 * 描边目标的最小能力集（`Graphics` 天然满足）。
 *
 * 【为什么不直接用 `Graphics`】单测要断言"画了什么"，而真 `Graphics` 把指令吞进
 * 自己的缓冲里，只能靠 mock 整个 pixi。收窄成四个方法后，测试里一个记录对象即可。
 */
export interface StrokeTarget {
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  stroke(options: {
    width: number;
    color: number;
    alpha: number;
    alignment?: number;
    cap?: "butt" | "round" | "square";
    join?: "round" | "bevel" | "miter";
  }): unknown;
  /**
   * 可选的填充能力（真 `Graphics` 有；测试替身可能没有）。
   * 变宽（河流）要一次 `beginFill` 填一个带状多边形 —— 能力不满足时
   * `drawPolyline` 回退到等宽描边，而不是让一条河崩掉整张图。
   */
  beginFill?(color: number, alpha?: number): unknown;
  endFill?(): unknown;
}

/** 一笔描边的规格 */
export interface StrokeSpec {
  color: number;
  width: number;
  alpha: number;
  /** 虚线节奏（世界单位 `[实, 虚]`）；缺省 = 实线 */
  dash?: readonly [number, number] | null;
  /** 两端渐隐（势力边界） */
  fadeEnds?: boolean;
}

/** 沿路径下笔（不描边），`closed` 时补一段回到起点 */
function tracePath(target: StrokeTarget, path: readonly Point[], closed: boolean): void {
  if (path.length === 0) return;
  target.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i += 1) target.lineTo(path[i].x, path[i].y);
  if (closed) target.lineTo(path[0].x, path[0].y);
}

/**
 * 按规格描一笔（实线 / 虚线 / 两端渐隐）。
 *
 * 【渐隐的实现】把路径按"沿线的进度"分档给 alpha（首尾 15% 淡、中间实）。
 * 用多笔叠画会比按弧长做渐变省一个数量级的成本，而边界这种"长长的虚线"上
 * 肉眼分辨不出分段 —— 真要逐段渐变，得把线拆成上百个 `stroke` 调用。
 *
 * `cap` / `join` 取 round：手绘线条的端头与拐角都是圆的；`butt` 会让
 * 拐角出现尖角缺口（虚线尤其明显，像一段段被剪断的木棍）。
 */
export function strokeStyled(
  target: StrokeTarget,
  path: readonly Point[],
  closed: boolean,
  spec: StrokeSpec,
): void {
  if (path.length < 2 || spec.width <= 0) return;

  // 闭环要把"回到起点"这一段也纳入虚线节奏，否则首尾相接处会出现一个实段
  const dashSource = closed ? [...path, path[0]] : path;
  const pieces: Point[][] = spec.dash
    ? dashPath(dashSource, spec.dash[0], spec.dash[1])
    : [dashSource as Point[]];
  if (pieces.length === 0) return;

  const stroke = (points: readonly Point[], alpha: number) => {
    if (points.length < 2) return;
    tracePath(target, points, false);
    target.stroke({
      width: spec.width,
      color: spec.color,
      alpha,
      alignment: 0.5,
      cap: "round",
      join: "round",
    });
  };

  if (!spec.fadeEnds || pieces.length === 1) {
    for (const piece of pieces) stroke(piece, spec.alpha);
    return;
  }
  // 逐段给 alpha：按"第几段 / 共几段"近似沿线进度，首尾各 15% 淡出
  const n = pieces.length;
  for (let i = 0; i < n; i += 1) {
    const ratio = i / (n - 1);
    const edge = ratio < 0.15 || ratio > 0.85;
    stroke(pieces[i], spec.alpha * (edge ? 0.35 : 1));
  }
}

/** 路径总弧长（开链；闭环的补段由调用方自己加） */
function pathLengthOf(path: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  return total;
}

/**
 * 变宽的带状填充（河流）：按弧长从 `taper.from` 线性插到 `taper.to`。
 *
 * 【为什么用填充而不是分段描边】河流带 0.92 透明度，分段描边的圆头接缝
 * 必然叠画出一串深色斑点（0.92²≈0.85 的透出率差异肉眼可辨）；
 * 一次 `beginFill` 填一个多边形，透明度处处均匀。taper 与 dash 互斥
 * （样式表里河流不是虚线；真出现两者时本分支忽略 dash）。
 */
function drawTaperedFill(
  target: StrokeTarget,
  path: readonly Point[],
  taper: { from: number; to: number },
  width: number,
  color: number,
  alpha: number,
  widthRatio = 1,
): void {
  if (!target.beginFill || !target.endFill) return;
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i += 1) {
    cum[i] = cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  const total = cum[cum.length - 1] || 1;
  const widthAt = (i: number) =>
    width * widthRatio * (taper.from + (taper.to - taper.from) * (cum[i] / total));
  const polygon = ribbonPolygon(path, widthAt);
  if (polygon.length < 3) return;
  target.beginFill(color, alpha);
  target.moveTo(polygon[0].x, polygon[0].y);
  for (let i = 1; i < polygon.length; i += 1) target.lineTo(polygon[i].x, polygon[i].y);
  target.endFill();
}

/**
 * 一侧影线笔刷（山脊）：沿弧长每 `spacingScale × 线宽` 在行进方向**右手侧**
 * 戳一根垂直短线，长短交替。落点与长度都是确定性的（不掷随机数）——
 * 同一条线在重绘（拖动、缩放、选中态切换）之间必须长一个模样，
 * 否则每次交互整条山脊的"毛边"都会跳动。
 */
function drawHatch(
  target: StrokeTarget,
  path: readonly Point[],
  closed: boolean,
  hatch: NonNullable<PolylineStyle["hatch"]>,
  width: number,
  baseAlpha: number,
): void {
  const spacing = hatch.spacingScale * width;
  if (spacing <= 0) return;
  // 闭环的影线要把"回到起点"的补段也走完，否则接缝处少一根毛
  const source = closed ? [...path, path[0]] : path;
  const total = pathLengthOf(source);
  const alpha = baseAlpha * (hatch.alpha ?? 1);
  let tick = 0;
  // 从一个 spacing 之后开始：贴着线头的影线会跟端帽糊成一团
  for (let s = spacing; s < total; s += spacing, tick += 1) {
    const { x, y, tx, ty } = pointTangentAtLength(source, s);
    const len = (tick % 2 === 0 ? hatch.lengthScale[0] : hatch.lengthScale[1]) * width;
    target.moveTo(x, y);
    target.lineTo(x + ty * len, y - tx * len);
    target.stroke({
      width: Math.max(0.1, hatch.widthScale * width),
      color: hatch.color,
      alpha,
      alignment: 0.5,
      cap: "round",
      join: "round",
    });
  }
}

/**
 * 一条折线的完整绘制：主线 + （可选）内描亮芯 + （可选）影线笔刷。
 *
 * @param scale 当前视口缩放（线宽的屏幕下限靠它换算）
 * @param alpha 层级权重（= `elementWeight(level, levelAlphas)`）
 *
 * 【顺序】先画深色宽线、再画浅色窄线 —— 反过来会被宽线整块盖掉，
 * 表现为"双线样式跟单线一模一样"；影线最后画（叠在主线之上）。
 *
 * 【closed 的退化保护】少于 3 个点的"闭环"画出来是零面积的来回线，
 * 一律按开链处理（数据里可以留着 `closed:true`，渲染与命中共用这一守卫）。
 */
export function drawPolyline(
  target: StrokeTarget,
  line: MapPolyline,
  options: { scale: number; alpha: number },
): void {
  if (line.points.length < 2) return;
  const closed = line.closed && line.points.length >= 3;
  const style: PolylineStyle = polylineStyleOf(line.styleId, line.kind);
  const width = effectiveWidthWorld(style, line.widthScale, options.scale);
  const baseAlpha = (style.alpha ?? 1) * options.alpha;
  if (baseAlpha <= 0) return;

  const path = smoothPolyline(line.points, closed);

  // 变宽（河流）：带状填充。**先探能力再进分支** —— 目标不支持 fill 时必须
  // 落回等宽描边，而不是走进 taper 分支后什么都没画就 return（线直接消失）。
  const canFill =
    typeof target.beginFill === "function" && typeof target.endFill === "function";
  if (style.taper && !closed && canFill) {
    drawTaperedFill(target, path, style.taper, width, style.color, baseAlpha);
    if (style.casing) {
      drawTaperedFill(target, path, style.taper, width, style.casing.color, baseAlpha, style.casing.width / style.width);
    }
    if (style.hatch) drawHatch(target, path, closed, style.hatch, width, baseAlpha);
    return;
  }

  const dash = dashLengthsOf(style, width);

  strokeStyled(target, path, closed, {
    color: style.color,
    width,
    alpha: baseAlpha,
    dash,
    fadeEnds: style.fadeEnds,
  });

  if (style.casing) {
    // 内描按"相对主线宽"等比换算：用户把线宽拉到 2 倍时，芯也要一起变粗，
    // 否则粗线上会出现一条细得像发丝的白线（比不画芯更难看）
    const casingWidth = width * (style.casing.width / style.width);
    strokeStyled(target, path, closed, {
      color: style.casing.color,
      width: casingWidth,
      alpha: baseAlpha,
      dash,
      fadeEnds: style.fadeEnds,
    });
  }

  if (style.hatch) drawHatch(target, path, closed, style.hatch, width, baseAlpha);
}
