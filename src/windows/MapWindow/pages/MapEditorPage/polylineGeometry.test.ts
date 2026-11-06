import { describe, expect, it } from "vitest";
import {
  POLYLINE_SAMPLES_PER_SPAN,
  controlIndexFor,
  dashPath,
  distanceToPath,
  distanceToSegment,
  nearestOnPath,
  pathBounds,
  pointTangentAtLength,
  ribbonPolygon,
  smoothPolyline,
} from "./polylineGeometry";

/**
 * 折线几何（B4-2）。
 *
 * 【为什么这些用例值得写】几何算错的**表现都不是报错**：
 *   · 平滑没穿过控制点 → 用户拖节点时线不跟手，拖了三次点还在原处；
 *   · 距离算的是直边而不是曲线 → 线弯出去的那一段"看得见却点不中"；
 *   · 采样下标换算错一格 → 双击插点插到线头，整条线重排。
 * 三条都只能靠断言数学性质抓出来。
 */

const P = (x: number, y: number) => ({ x, y });

describe("smoothPolyline · Catmull-Rom", () => {
  it("曲线穿过每一个控制点（用户拖哪个点，线就过哪个点）", () => {
    const pts = [P(0, 0), P(100, 60), P(200, 0), P(300, 90)];
    const path = smoothPolyline(pts, false);
    for (const p of pts) {
      const hit = path.some((q) => Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6);
      expect(hit, `控制点 (${p.x},${p.y}) 不在采样路径上`).toBe(true);
    }
  });

  it("开链：首尾就是首尾控制点，点数 = 段数 × 采样数 + 1", () => {
    const pts = [P(0, 0), P(50, 50), P(100, 0)];
    const path = smoothPolyline(pts, false, 4);
    expect(path[0]).toEqual(pts[0]);
    expect(path[path.length - 1]).toEqual(pts[2]);
    // 2 段 × 4 采样，再补一个终点
    expect(path).toHaveLength(2 * 4 + 1);
  });

  it("闭环：不重复首点（闭合由绘制方 closePath 负责），点数 = 控制点数 × 采样数", () => {
    const pts = [P(0, 0), P(100, 0), P(100, 100), P(0, 100)];
    const path = smoothPolyline(pts, true, 5);
    expect(path).toHaveLength(4 * 5);
    const last = path[path.length - 1];
    expect(Math.hypot(last.x - pts[0].x, last.y - pts[0].y)).toBeGreaterThan(0);
  });

  it("退化输入不抛错：0 点 → []、1 点 → 原点、2 点 → 直线", () => {
    expect(smoothPolyline([], false)).toEqual([]);
    expect(smoothPolyline([P(3, 4)], false)).toEqual([P(3, 4)]);
    expect(smoothPolyline([P(0, 0), P(10, 10)], false)).toEqual([P(0, 0), P(10, 10)]);
  });

  it("默认采样数与常量一致（写死另一个数字会让插点换算错位）", () => {
    expect(smoothPolyline([P(0, 0), P(10, 0), P(20, 0)], false)).toHaveLength(
      2 * POLYLINE_SAMPLES_PER_SPAN + 1,
    );
  });
});

describe("距离与最近段", () => {
  it("点到线段：投影落在线段内取垂距，落在线段外取端点距", () => {
    expect(distanceToSegment(P(5, 3), P(0, 0), P(10, 0))).toBeCloseTo(3);
    expect(distanceToSegment(P(-4, 0), P(0, 0), P(10, 0))).toBeCloseTo(4);
    expect(distanceToSegment(P(14, 3), P(0, 0), P(10, 0))).toBeCloseTo(5);
  });

  it("零长度段退化成点距（重叠顶点的脏数据不该算出 NaN）", () => {
    expect(distanceToSegment(P(3, 4), P(0, 0), P(0, 0))).toBeCloseTo(5);
  });

  it("路径距离取所有段的最小值；闭环多算一段回到起点", () => {
    const square = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)];
    expect(distanceToPath(square, P(5, 1), false)).toBeCloseTo(1);
    // 开链时左边缘 (0,0)-(0,10) 不在路径里：(-1,5) 到最近的已画段只能绕到
    // 底边/顶边的端点 (0,0)/(0,10)，距离 √(1²+5²)；闭环补上左边那条边后才是 1
    expect(distanceToPath(square, P(-1, 5), false)).toBeCloseTo(Math.hypot(1, 5));
    expect(distanceToPath(square, P(-1, 5), true)).toBeCloseTo(1);
  });

  it("nearestOnPath 返回线上最近点与采样段下标", () => {
    const path = [P(0, 0), P(10, 0), P(20, 0)];
    const near = nearestOnPath(path, P(12, 4), false);
    expect(near).not.toBeNull();
    expect(near?.pathIndex).toBe(1);
    expect(near?.distance).toBeCloseTo(4);
    // 最近点是**线上**的投影，不是鼠标位置（否则插点会把线拽出尖角）
    expect(near?.point).toEqual(P(12, 0));
  });

  it("路径不足两点时 nearestOnPath 返回 null（没有「段」可言）", () => {
    expect(nearestOnPath([P(0, 0)], P(1, 1), false)).toBeNull();
  });
});

describe("controlIndexFor · 采样段 → 控制点插入位", () => {
  it("每个 span 的采样段映射到同一个插入位", () => {
    expect(controlIndexFor(0, 10)).toBe(1);
    expect(controlIndexFor(9, 10)).toBe(1);
    expect(controlIndexFor(10, 10)).toBe(2);
    expect(controlIndexFor(23, 10)).toBe(3);
  });

  it("默认采样数与 smoothPolyline 同源（改一处必须两处一起改）", () => {
    expect(controlIndexFor(POLYLINE_SAMPLES_PER_SPAN - 1)).toBe(1);
    expect(controlIndexFor(POLYLINE_SAMPLES_PER_SPAN)).toBe(2);
  });
});

describe("dashPath · 虚线", () => {
  it("沿总长切出若干实线段（实段总长 ≤ 段总长）", () => {
    const pieces = dashPath([P(0, 0), P(100, 0)], 10, 10);
    expect(pieces.length).toBeGreaterThan(1);
    let total = 0;
    for (const piece of pieces) {
      for (let i = 1; i < piece.length; i += 1) {
        total += Math.hypot(piece[i].x - piece[i - 1].x, piece[i].y - piece[i - 1].y);
      }
    }
    // 100 长、实 10 虚 10 ⇒ 实段合计约 50（允许首尾截断）
    expect(total).toBeGreaterThan(40);
    expect(total).toBeLessThan(60);
  });

  it("每段都是可画的（≥2 点）", () => {
    for (const piece of dashPath([P(0, 0), P(50, 0), P(50, 50)], 6, 4)) {
      expect(piece.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("虚长为 0 不死循环（退化成一条实线）", () => {
    const pieces = dashPath([P(0, 0), P(30, 0)], 5, 0);
    expect(pieces.length).toBeGreaterThanOrEqual(1);
    expect(pieces[0].length).toBeGreaterThanOrEqual(2);
  });

  it("单点 / 空路径返回空（没有可画的段）", () => {
    expect(dashPath([], 5, 5)).toEqual([]);
    expect(dashPath([P(0, 0)], 5, 5)).toEqual([]);
  });
});

describe("pathBounds", () => {
  it("返回包围盒；空路径 null", () => {
    expect(pathBounds([P(-5, 2), P(7, -3), P(0, 9)])).toEqual({
      x: -5,
      y: -3,
      width: 12,
      height: 12,
    });
    expect(pathBounds([])).toBeNull();
  });
});

describe("pointTangentAtLength · 弧长取点", () => {
  const straight = [P(0, 0), P(100, 0)];

  it("直线上的位置与切向：s=30 处在 (30,0)，切向朝 +x", () => {
    const r = pointTangentAtLength(straight, 30);
    expect(r.x).toBeCloseTo(30);
    expect(r.y).toBeCloseTo(0);
    expect(r.tx).toBeCloseTo(1);
    expect(r.ty).toBeCloseTo(0);
  });

  it("s 超出总弧长时钳到末端（影线不会走到线外）", () => {
    const r = pointTangentAtLength(straight, 999);
    expect(r.x).toBeCloseTo(100);
    expect(r.y).toBeCloseTo(0);
  });

  it("s 为负时钳到起点", () => {
    expect(pointTangentAtLength(straight, -5).x).toBeCloseTo(0);
  });

  it("退化输入不抛错：空路径给原点与默认切向，单点给该点", () => {
    expect(pointTangentAtLength([], 3)).toMatchObject({ x: 0, y: 0 });
    expect(pointTangentAtLength([P(7, 8)], 3)).toMatchObject({ x: 7, y: 8 });
  });
});

describe("ribbonPolygon · 变宽带状多边形", () => {
  it("直线路径：左右两侧各 n 个点 + 两端圆头扇，外接范围 = 各点半宽", () => {
    const path = [P(0, 0), P(100, 0)];
    const poly = ribbonPolygon(path, () => 4);
    // 左 2 + 末端扇 6 + 右 2 + 起端扇 6 = 16
    expect(poly).toHaveLength(16);
    const maxY = Math.max(...poly.map((p) => p.y));
    const minY = Math.min(...poly.map((p) => p.y));
    expect(maxY).toBeCloseTo(2); // 半宽 2
    expect(minY).toBeCloseTo(-2);
    const maxX = Math.max(...poly.map((p) => p.x));
    // 圆头扇 6 格内插凸出半宽，但采样点取不到正外侧那一格 —— 足够圆即可
    expect(maxX).toBeGreaterThan(101.9);
    expect(maxX).toBeLessThanOrEqual(102);
  });

  it("宽度按 widthAt 逐点生效（前窄后宽的带子两端跨度不同）", () => {
    const poly = ribbonPolygon([P(0, 0), P(100, 0)], (i) => (i === 0 ? 1 : 5));
    const startY = Math.max(...poly.filter((p) => p.x < 1).map((p) => Math.abs(p.y)));
    const endY = Math.max(...poly.filter((p) => p.x > 99).map((p) => Math.abs(p.y)));
    expect(startY).toBeCloseTo(0.5);
    expect(endY).toBeCloseTo(2.5);
  });

  it("折角处法线取差分方向（不产生长度爆掉的尖刺）", () => {
    // 直角拐弯 (50,0) 处，若法线没做相邻段平均，外侧点会甩到 √2 倍半宽以外。
    // 只量拐角附近的多边形点（带子的其余部分本来就远离拐角）。
    const poly = ribbonPolygon([P(0, 0), P(50, 0), P(50, 50)], () => 4);
    const nearCorner = poly.filter((p) => p.x > 45 && p.y < 5);
    expect(nearCorner.length).toBeGreaterThan(0);
    const maxDist = Math.max(...nearCorner.map((p) => Math.hypot(p.x - 50, p.y - 0)));
    expect(maxDist).toBeLessThanOrEqual(Math.SQRT2 * 2 + 1e-6);
  });

  it("退化输入：少于 2 点返回空", () => {
    expect(ribbonPolygon([], () => 1)).toEqual([]);
    expect(ribbonPolygon([P(3, 3)], () => 1)).toEqual([]);
  });
});
