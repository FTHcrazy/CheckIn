/**
 * 折线几何：Catmull-Rom 平滑、命中距离、虚线切分（纯函数，必须有单测）。
 *
 * 【为什么单独一个模块，而不是写在 MapCanvas 里】
 *   同一套几何有四个消费者，且它们必须**给出同一个答案**：
 *     ① 渲染 —— 把控制点变成画面上的曲线；
 *     ② 命中测试 —— "我点的这一点算不算按在这条线上"；
 *     ③ 双击线段插点 —— "新点该插在第几个控制点之后"；
 *     ④ 单测 —— 不可能为了算一条线去起一个 Pixi 场景。
 *   若各自实现一遍，"看得见的线"与"点得中的线"就会差开几像素，
 *   表现为"线在这里，点上去却选不中"（本项目素材层踩过同款：尺寸三处各写一遍）。
 *
 * 【为什么是 Catmull-Rom 而不是贝塞尔 / B 样条】
 *   · 曲线**穿过每一个控制点** —— 用户拖节点时，线必须跟着手指走；
 *     贝塞尔的控制点只是"拉手"，线会明显偏离用户点的位置，拖起来很不直观。
 *   · 与 `land.ts` 的 `drawLandPath` 同一条算法：海岸是平滑的，河却是一段段硬折线
 *     会立刻露馅（2.28.0 的「旋转不和谐」就是这类"两套几何混用"的观感问题）。
 *   · 不需要全局求解，逐段独立计算 —— 拖一个节点只影响相邻两段，重算成本恒定。
 *
 * 【与 `MapPolyline.points` 的关系】`points` 是**控制点**（用户落的点，进文档、
 * 进撤销栈）；本模块产出的是**采样点**（只活在渲染与命中的一次计算里，绝不写回）。
 */

import type { Point } from "./regions";

/**
 * 每段（两个控制点之间）的采样数。
 *
 * 【为什么是 10】采样点之间是直线段，段数太少时放大会看出折角（一条 200 世界单位
 * 的长边在 300% 缩放下会露出 5~6 个拐点），太多则纯属浪费（每个点都要进 Graphics
 * 路径）。10 段在最大缩放下每段约 6~20 屏幕像素，肉眼已是光滑曲线。
 *
 * 【为什么不随缩放自适应】自适应意味着"缩放一次就要重建全部折线几何"——
 * 违反本项目「视口变化不重建几何」的底线（见 MapCanvas 各 effect 的注释）。
 * 固定采样即可：折线的可见缩放跨度远小于区块（区块跨 40 倍，折线通常不足 10 倍）。
 */
export const POLYLINE_SAMPLES_PER_SPAN = 10;

/**
 * 端点外推的镜像距离（倍数于首段长度）。
 *
 * 【为什么要外推】Catmull-Rom 的第一段需要 P0（首点之前的一个"虚拟点"）。
 * 直接把首点复制一份当 P0 会让起点处的切线退化为零 —— 表现为**线的两端发直、
 * 中间却是弯的**（用户一眼能看出"这根线头是硬的"）。把 P0 取成首点关于次点的
 * 镜像，起点切线就与第二段自然衔接。
 */
const ENDPOINT_MIRROR = 1;

/** 取 `points[i]`；闭环时首尾相接，开链时越界钳到端点 */
function at(points: readonly Point[], i: number, closed: boolean): Point {
  const n = points.length;
  if (closed) return points[((i % n) + n) % n];
  return points[Math.min(n - 1, Math.max(0, i))];
}

/**
 * 开链的端点外推：`points[0]` 关于 `points[1]` 的镜像（越界钳制由调用方负责）。
 *
 * 单点 / 两点时的退化情况在这里被抹平：两点时镜像点与首点**不重合**（否则首段
 * 切线为零、线头会翘），镜像距离按首段长度等比取。
 */
function mirrorOf(inner: Point, outer: Point): Point {
  return {
    x: inner.x + (inner.x - outer.x) * ENDPOINT_MIRROR,
    y: inner.y + (inner.y - outer.y) * ENDPOINT_MIRROR,
  };
}

/** Catmull-Rom 单点求值（tension 0.5 的标准形式，曲线穿过 p1、p2） */
function catmullRom(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y:
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

/**
 * 把控制点平滑成采样点（首尾保留原控制点，因此"拖哪个点线就过哪个点"）。
 *
 * @param points 控制点（世界坐标）
 * @param closed `true` = 首尾相连（湖泊 / 势力范围轮廓）
 * @returns 采样后的点列；`closed` 时首尾**不重复**（由绘制方闭合），点数 = 段数 × 采样数
 *
 * 【退化输入】0 点 → `[]`；1 点 → 该点本身；2 点 → 首尾两点（直线就是它的平滑结果，
 * 不必插值）。这三种情况都会真实出现（画到一半的草稿、只有一个点的脏数据），
 * 抛错会让"画第一笔"就崩掉。
 */
export function smoothPolyline(
  points: readonly Point[],
  closed: boolean,
  samples: number = POLYLINE_SAMPLES_PER_SPAN,
): Point[] {
  const n = points.length;
  if (n === 0) return [];
  if (n === 1) return [{ x: points[0].x, y: points[0].y }];
  if (n === 2) {
    return [
      { x: points[0].x, y: points[0].y },
      { x: points[1].x, y: points[1].y },
    ];
  }

  const steps = Math.max(1, Math.round(samples));
  const spanCount = closed ? n : n - 1;
  const out: Point[] = [];
  for (let i = 0; i < spanCount; i += 1) {
    const p1 = points[i];
    const p2 = at(points, i + 1, closed);
    // 开链的两个端点需要外推（闭环直接按模取，永远有邻居）
    const p0 = closed
      ? at(points, i - 1, true)
      : i === 0
        ? mirrorOf(p1, p2)
        : points[i - 1];
    const p3 = closed ? at(points, i + 2, true) : i + 2 >= n ? mirrorOf(p2, p1) : points[i + 2];
    // 首段含起点；末段不含终点（留给下一段的起点，或闭环回到起点）
    for (let s = 0; s < steps; s += 1) {
      out.push(catmullRom(p0, p1, p2, p3, s / steps));
    }
  }
  // 开链补上终点：上面的循环每个 span 都只到"终点前一步"
  if (!closed) out.push({ x: points[n - 1].x, y: points[n - 1].y });
  return out;
}

/** 点到线段的距离（零长度段退化为点距） */
export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(point.x - a.x, point.y - a.y);
  // 投影参数钳到 [0,1]：投影落在线段外时，最近点就是端点
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

/** 点到整条路径的最短距离（路径 = 采样点列，首尾相接由调用方决定） */
export function distanceToPath(path: readonly Point[], point: Point, closed = false): number {
  if (path.length === 0) return Number.POSITIVE_INFINITY;
  if (path.length === 1) return Math.hypot(point.x - path[0].x, point.y - path[0].y);
  let best = Number.POSITIVE_INFINITY;
  const last = closed ? path.length : path.length - 1;
  for (let i = 0; i < last; i += 1) {
    const d = distanceToSegment(point, path[i], path[(i + 1) % path.length]);
    if (d < best) best = d;
  }
  return best;
}

/**
 * 路径上离目标点最近的那一段（含最近点坐标）。
 *
 * 【给双击插点用】用户双击"线上某处"，新控制点必须插在**那一段控制点之间**，
 * 否则线形会突变（插到端点会让新点跑到线头，整条线重排）。
 * 返回的 `pathIndex` 是**采样点**下标，换算回控制点下标的步骤见
 * `controlIndexFor`（两者不是一回事：一个 span 有 `samples` 个采样段）。
 */
export function nearestOnPath(
  path: readonly Point[],
  point: Point,
  closed = false,
): { distance: number; pathIndex: number; point: Point } | null {
  if (path.length < 2) return null;
  let best: { distance: number; pathIndex: number; point: Point } | null = null;
  const last = closed ? path.length : path.length - 1;
  for (let i = 0; i < last; i += 1) {
    const a = path[i];
    const b = path[(i + 1) % path.length];
    const d = distanceToSegment(point, a, b);
    if (best && d >= best.distance) continue;
    // 最近点本身也要算出来：插点时用它（而不是用鼠标位置），线上的点才落在线里
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t =
      len2 < 1e-12
        ? 0
        : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
    best = { distance: d, pathIndex: i, point: { x: a.x + dx * t, y: a.y + dy * t } };
  }
  return best;
}

/**
 * 采样段下标 → "新控制点该插在 points 的第几个位置之后"。
 *
 * 例：每段 10 采样，`pathIndex = 23` 落在第 2 个 span（控制点 2 → 3 之间），
 * 新点插在 `points[3]` 之前 ⇒ 返回 3。换算必须与 `smoothPolyline` 的采样数一致，
 * 因此 `samples` 参数默认取同一个常量 —— 两处各写一个 10 是"改一处忘一处"的经典开端。
 */
export function controlIndexFor(pathIndex: number, samples: number = POLYLINE_SAMPLES_PER_SPAN): number {
  const steps = Math.max(1, Math.round(samples));
  return Math.floor(pathIndex / steps) + 1;
}

/**
 * 把路径切成虚线子路径（实线段数组）。
 *
 * 【为什么自己做虚线】Pixi 的 `Graphics.stroke` 没有 dash 参数（8.x 也没有），
 * 而虚线是手绘地图里"小路 / 势力边界"的关键语义（实线一律读作"官道"）。
 * 做法是按弧长在采样点上走，每 `on` 距离截一段、跳过 `off` 距离。
 *
 * `on` / `off` 用**世界单位**（调用方按线宽换算），于是虚线随图缩放而伸缩 ——
 * 与线宽同一口径。若按屏幕像素，缩到整图时一条小路会碎成上百个点。
 */
export function dashPath(path: readonly Point[], on: number, off: number): Point[][] {
  if (path.length < 2 || on <= 0 || off < 0) return path.length >= 2 ? [[...path]] : [];
  const out: Point[][] = [];
  let current: Point[] = [{ ...path[0] }];
  let pen = true;
  let remaining = on;

  for (let i = 1; i < path.length; i += 1) {
    let from = path[i - 1];
    const to = path[i];
    let segLen = Math.hypot(to.x - from.x, to.y - from.y);

    // 一段可能横跨多个虚实切换点：循环消耗，直到这一段走完
    while (segLen > 1e-9) {
      if (segLen <= remaining) {
        remaining -= segLen;
        if (pen) current.push({ ...to });
        break;
      }
      const t = remaining / segLen;
      const cut = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
      if (pen) {
        current.push(cut);
        // 实线段收尾：不足 2 点的碎片丢弃（一条零长度的"实线"画不出来）
        if (current.length >= 2) out.push(current);
        current = [];
      } else {
        current = [cut];
      }
      pen = !pen;
      from = cut;
      segLen -= remaining;
      remaining = pen ? on : off;
      // off = 0 时 pen 永远为 true，remaining 会是 on，不会死循环
      if (remaining <= 1e-9) remaining = on;
    }
  }
  if (pen && current.length >= 2) out.push(current);
  return out;
}

/**
 * 沿路径按**弧长**取位置与单位切向（`s` 超出末端时钳到端点）。
 *
 * 【给谁用】B4-3 的两个"沿线的花纹"消费者：
 *   ① `ridge` 的影线笔刷 —— 每 `spacing` 距离在路径一侧戳一根短笔；
 *   ② 变宽带的端头圆扇 —— 需要端点处的行进方向。
 * 切向用相邻采样点的差分（中心差分，端点一侧差分）而不是逐段斜率：
 * 折线的采样点已经足够密，中心差分给出的"笔刷朝向"在拐弯处是渐变的，
 * 逐段斜率会让影线在拐点上突然甩 30°。
 */
export function pointTangentAtLength(
  path: readonly Point[],
  s: number,
): { x: number; y: number; tx: number; ty: number } {
  const n = path.length;
  if (n === 0) return { x: 0, y: 0, tx: 1, ty: 0 };
  if (n === 1) return { x: path[0].x, y: path[0].y, tx: 1, ty: 0 };

  let rest = Math.max(0, s);
  for (let i = 1; i < n; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen < 1e-9) continue;
    if (rest > segLen) {
      rest -= segLen;
      continue;
    }
    const t = rest / segLen;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      tx: (b.x - a.x) / segLen,
      ty: (b.y - a.y) / segLen,
    };
  }
  // 走完还没消耗完 = `s` 超过总弧长：钳到末端，切向取最后一段
  const a = path[n - 2];
  const b = path[n - 1];
  const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: b.x, y: b.y, tx: (b.x - a.x) / segLen, ty: (b.y - a.y) / segLen };
}

/**
 * 变宽带状多边形（河流「源头细、入海粗」的填充几何，B4-3）。
 *
 * @param path 平滑采样点列
 * @param widthAt 按采样点下标给出该处的**总宽**（世界单位）
 * @returns 一个多边形顶点列（左侧顺去 + 末端圆头扇 + 右侧逆回 + 起端圆头扇），
 *          交给 `beginFill` 一次填成
 *
 * 【为什么是"填充带"而不是"分段描边"】河流带透明度（0.92）：分段描边的圆头
 * 在段与段的接缝处必然叠画，0.92 叠 0.92 ≈ 0.99，沿线会出一串深色斑点；
 * 一次 `beginFill` 填一个多边形没有任何叠画，透明度处处均匀。
 *
 * 【圆头端帽】半圆用 6 格扇形逼近 —— 河源与入海口的线头是圆的，
 * 平头会让"细的那头"看起来像被剪刀剪断。
 *
 * 【已知取舍】急弯内侧的偏移可能自交（半宽 > 曲率半径时）：
 * Catmull-Rom 采样 + 手绘河流的曲率下几乎不出现，出现了也只是填色多边形
 * 上一个微小的重叠区，与"分段描边"的接缝斑点相比是明显更轻的瑕疵。
 */
export function ribbonPolygon(
  path: readonly Point[],
  widthAt: (index: number) => number,
): Point[] {
  const n = path.length;
  if (n < 2) return [];

  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i < n; i += 1) {
    // 切向取相邻采样点的差分（端点一侧差分）；半宽沿法线两侧各摊一半
    const prev = path[Math.max(0, i - 1)];
    const next = path[Math.min(n - 1, i + 1)];
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const len = Math.hypot(tx, ty);
    if (len < 1e-9) {
      tx = 1;
      ty = 0;
    } else {
      tx /= len;
      ty /= len;
    }
    const half = Math.max(0, widthAt(i)) / 2;
    left.push({ x: path[i].x - ty * half, y: path[i].y + tx * half });
    right.push({ x: path[i].x + ty * half, y: path[i].y - tx * half });
  }

  // 圆头端帽：从一侧偏移点绕到另一侧，走**外侧**（行进方向那半圆）。
  // 内侧半圆会把带子的端头"凹"进去，视觉上是缺口而不是圆头。
  const cap = (center: Point, from: Point, to: Point, outward: { tx: number; ty: number }) => {
    const r = Math.hypot(from.x - center.x, from.y - center.y);
    if (r < 1e-9) return [];
    const a0 = Math.atan2(from.y - center.y, from.x - center.x);
    let da = Math.atan2(to.y - center.y, to.x - center.x) - a0;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    // 半圆的中点必须朝外：朝内就把行进方向反转（多绕一整圈）
    const outwardAngle = Math.atan2(outward.ty, outward.tx);
    const mid = a0 + da / 2;
    if (Math.cos(mid - outwardAngle) < 0) da += da > 0 ? -Math.PI * 2 : Math.PI * 2;
    const steps = 6;
    const pts: Point[] = [];
    for (let k = 1; k <= steps; k += 1) {
      const ang = a0 + (da * k) / (steps + 1);
      pts.push({ x: center.x + Math.cos(ang) * r, y: center.y + Math.sin(ang) * r });
    }
    return pts;
  };

  const endTangent = pointTangentAtLength(path, Number.POSITIVE_INFINITY);
  const startTangent = { tx: -endTangent.tx, ty: -endTangent.ty };

  const out: Point[] = [...left];
  out.push(...cap(path[n - 1], left[n - 1], right[n - 1], endTangent));
  for (let i = n - 1; i >= 0; i -= 1) out.push(right[i]);
  out.push(...cap(path[0], right[0], left[0], startTangent));
  return out;
}

/**
 * 路径的包围盒（剔除与调试用；空路径返回 `null`）。
 */
export function pathBounds(path: readonly Point[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  if (path.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of path) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
