import { describe, expect, it, vi } from "vitest";

// 纯几何层不 new 任何 Pixi 对象，但模块顶层 import 了 pixi.js（还经 labelSync 间接
// 依赖 Text / TextStyle）—— 用空替身兜住，让「几何 / 门控 / 烘焙倍率」的正确性能
// 脱离 WebGL 环境单测。替身只需"能被 import"，本文件不实例化它们。
vi.mock("pixi.js", () => ({
  Container: class {},
  Graphics: class {},
  Sprite: class {},
  Texture: { EMPTY: {} },
  Text: class {},
  TextStyle: class {},
  ColorMatrixFilter: class {},
  /* 子图羽化的隔离滤镜替身（buildSubmapNode 给 content 挂它） */
  AlphaFilter: class {},
}));

import {
  featherBands,
  insetPolygon,
  polygonBounds,
  submapBakeResolution,
  submapBorderWidth,
  submapContentPlan,
  submapLevelAlphas,
  submapNodeSpec,
  SUBMAP_BAKE_MAX_RES,
  SUBMAP_BAKE_MIN_RES,
} from "./submapRender";
import { REGION_BORDER_PX, type MapRegion } from "../../regions";
import type { MapSubmap } from "../../types";

/**
 * 嵌套子图渲染的**纯几何层**单测。
 *
 * 测四件事（都可脱离 Pixi 断言）：
 *   · 贴合变换（fit）把子图 bounds 等比缩放进区块包围盒、居中；
 *   · 渐入门控（enterWeight）随父图缩放单调不减、阈值处 ≈ 0.5；
 *   · 子图**内部**层级权重（用等效缩放查子图自己的 levelAlphas）；
 *   · 海岸烘焙倍率的量化与封顶。
 */

/** 一个带 submap 的区块 */
function regionWithSubmap(submap: MapSubmap, polygon: Array<{ x: number; y: number }>): MapRegion {
  return {
    id: "r1",
    parentId: null,
    level: 0,
    name: "区块",
    seed: { x: 0, y: 0 },
    polygon,
    color: 0xffffff,
    submap,
  };
}

function makeSubmap(bounds: { x: number; y: number; width: number; height: number }): MapSubmap {
  return {
    id: "sm_1",
    bounds,
    land: null,
    regions: [],
    elements: [],
    labels: [],
    style: "none",
    baseImageId: "base-1",
  };
}

/** 造一个方块区块（子图分区用） */
function blockRegion(id: string, level: number, x: number, y: number, size = 10): MapRegion {
  return {
    id,
    parentId: null,
    level,
    name: id,
    seed: { x: 0, y: 0 },
    polygon: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
    color: 0xffffff,
  };
}

describe("polygonBounds：区块包围盒", () => {
  it("取所有顶点的轴对齐包围盒", () => {
    const b = polygonBounds([
      { x: -10, y: 5 },
      { x: 20, y: -15 },
      { x: 5, y: 10 },
    ]);
    expect(b).toEqual({ x: -10, y: -15, width: 30, height: 25 });
  });

  it("空多边形 / 全 NaN 顶点退回零矩形", () => {
    expect(polygonBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(polygonBounds([{ x: Number.NaN, y: Number.NaN }])).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });
});

describe("submapNodeSpec：子图节点规格", () => {
  const polygon = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  it("没有 submap 的区块：hasSubmap = false，不产出贴合/门控", () => {
    const plain: MapRegion = {
      id: "r2",
      parentId: null,
      level: 0,
      name: "普通",
      seed: { x: 0, y: 0 },
      polygon,
      color: 0xffffff,
    };
    const spec = submapNodeSpec(plain, 1);
    expect(spec.hasSubmap).toBe(false);
    expect(spec.enterWeight).toBe(0);
  });

  it("贴合变换：子图 bounds 等比缩放进区块包围盒、居中", () => {
    // 区块 100×100，子图 512×512 → 缩放 = min(100/512, 100/512) = 0.1953
    const submap = makeSubmap({ x: -256, y: -256, width: 512, height: 512 });
    const spec = submapNodeSpec(regionWithSubmap(submap, polygon), 1);
    expect(spec.hasSubmap).toBe(true);
    expect(spec.fit.scale).toBeCloseTo(100 / 512, 12);
    // 居中 = 区块包围盒中心 (50, 50)
    expect(spec.fit.x).toBeCloseTo(50, 12);
    expect(spec.fit.y).toBeCloseTo(50, 12);
  });

  it("渐入门控：父图缩放低于阈值 ⇒ 权重 0，高于阈值 ⇒ 1，阈值处 ≈ 0.5", () => {
    const submap = makeSubmap({ x: 0, y: 0, width: 100, height: 100 });
    // 显式指定阈值 2
    const region = regionWithSubmap(submap, polygon);
    region.submapEnterScale = 2;

    expect(submapNodeSpec(region, 0.5).enterWeight).toBe(0);
    expect(submapNodeSpec(region, 8).enterWeight).toBe(1);
    expect(submapNodeSpec(region, 2).enterWeight).toBeCloseTo(0.5, 6);
  });

  it("阈值缺省时按区块长边反推（长边越大阈值越小）", () => {
    const submap = makeSubmap({ x: 0, y: 0, width: 100, height: 100 });
    // 区块 100 长边 → enterScale = LOD_BLOCK_PX(360) / 100 = 3.6
    const spec = submapNodeSpec(regionWithSubmap(submap, polygon), 1);
    expect(spec.enterScale).toBeCloseTo(360 / 100, 12);
  });

  it("等效缩放 = 父图缩放 × 贴合缩放", () => {
    const submap = makeSubmap({ x: -256, y: -256, width: 512, height: 512 });
    const spec = submapNodeSpec(regionWithSubmap(submap, polygon), 2);
    expect(spec.effectiveScale).toBeCloseTo(2 * (100 / 512), 12);
  });
});

describe("submapLevelAlphas：子图**内部**的层级权重", () => {
  /**
   * 【为什么要单独测它】这是「缩进去逐级显露子图自己的洲/国家/郡」的唯一来源。
   * 用父图缩放直接查表会错位一整档（在县城尺度就把小溪村的郡级分区全点亮），
   * 而错位的表现只是"分区线叠在一起"，不报错、不看画面发现不了。
   */
  const paper = { x: -512, y: -512, width: 1024, height: 1024 };

  it("没有分区 ⇒ 空权重（不画任何层级，而不是画一层全亮）", () => {
    expect(submapLevelAlphas(makeSubmap(paper), 5)).toEqual([]);
  });

  it("单级子图：任何等效缩放下都是 [1]", () => {
    const submap = makeSubmap(paper);
    submap.regions = [blockRegion("a", 0, 0, 0)];
    for (const s of [0.05, 0.5, 3, 40]) {
      expect(submapLevelAlphas(submap, s)).toEqual([1]);
    }
  });

  it("多级子图：等效缩放越小越只有粗一级，越大越偏细一级（Σα ≡ 1）", () => {
    const submap = makeSubmap(paper);
    submap.regions = [
      ...Array.from({ length: 3 }, (_, i) => blockRegion(`c${i}`, 0, i * 10, 0)),
      ...Array.from({ length: 48 }, (_, i) => blockRegion(`f${i}`, 1, i * 2, 20)),
    ];
    const coarse = submapLevelAlphas(submap, 0.2);
    const mid = submapLevelAlphas(submap, 2);
    const fine = submapLevelAlphas(submap, 20);

    for (const alphas of [coarse, mid, fine]) {
      expect(alphas).toHaveLength(2);
      expect(alphas.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
    }
    // 缩得远：细一级几乎不亮；缩得近：粗一级几乎退场
    expect(coarse[0]).toBeGreaterThan(0.95);
    expect(coarse[1]).toBeLessThan(0.05);
    expect(fine[1]).toBeGreaterThan(0.95);
    expect(fine[0]).toBeLessThan(0.05);
  });
});

describe("submapContentPlan：分级 + 权重一次算齐", () => {
  const paper = { x: -512, y: -512, width: 1024, height: 1024 };

  it("按层级分组、升序排列，空层不出现", () => {
    const submap = makeSubmap(paper);
    submap.regions = [
      blockRegion("c0", 0, 0, 0),
      blockRegion("f0", 2, 40, 0),
      blockRegion("c1", 0, 20, 0),
    ];
    const plan = submapContentPlan(submap, 1);
    expect(plan.levels.map((l) => l.level)).toEqual([0, 2]);
    expect(plan.levels[0].regions.map((r) => r.id)).toEqual(["c0", "c1"]);
    expect(plan.levels[1].regions.map((r) => r.id)).toEqual(["f0"]);
  });

  it("顶点不足 3 的退化区块被跳过（不产出画不出来的多边形）", () => {
    const submap = makeSubmap(paper);
    submap.regions = [
      { ...blockRegion("ok", 0, 0, 0) },
      { ...blockRegion("bad", 0, 0, 0), polygon: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    ];
    const plan = submapContentPlan(submap, 1);
    expect(plan.levels[0].regions.map((r) => r.id)).toEqual(["ok"]);
  });

  it("权重与分组同源：单级时 alpha 恒 1", () => {
    const submap = makeSubmap(paper);
    submap.regions = [blockRegion("a", 0, 0, 0)];
    expect(submapContentPlan(submap, 0.01).levelAlphas).toEqual([1]);
  });
});

describe("submapBorderWidth：屏幕恒定线宽", () => {
  it("线宽 × 缩放 ≈ 常量像素（量化误差 ≤ 8%）", () => {
    for (const scale of [0.2, 0.5, 1, 2, 3.7, 12, 40]) {
      const px = submapBorderWidth(scale) * scale;
      expect(px).toBeGreaterThan(REGION_BORDER_PX / 1.08);
      expect(px).toBeLessThan(REGION_BORDER_PX * 1.08);
    }
  });

  it("相邻缩放落在同一量化档 ⇒ 线宽逐位相等（避免每格重建几何）", () => {
    expect(submapBorderWidth(1.0)).toBe(submapBorderWidth(1.02));
    expect(submapBorderWidth(2.0)).toBe(submapBorderWidth(2.03));
  });

  it("脏缩放（0 / NaN）给出有限正值", () => {
    for (const bad of [0, -3, Number.NaN]) {
      const w = submapBorderWidth(bad);
      expect(Number.isFinite(w)).toBe(true);
      expect(w).toBeGreaterThan(0);
    }
  });
});

describe("submapBakeResolution：海岸烘焙倍率", () => {
  it("随等效缩放升高，且封顶 SUBMAP_BAKE_MAX_RES", () => {
    const res = [0.05, 0.2, 0.5, 1, 2, 4, 20].map((s) => submapBakeResolution(s, 2));
    for (let i = 1; i < res.length; i += 1) expect(res[i]).toBeGreaterThanOrEqual(res[i - 1]);
    expect(Math.max(...res)).toBe(SUBMAP_BAKE_MAX_RES);
  });

  it("量化到 2 的幂次档：2 倍以内的缩放不触发重烘", () => {
    // 基础倍率 0.25 时：等效缩放 3 / 3.5 → 目标 0.75 / 0.875，都落在同一档（1 倍）
    expect(submapBakeResolution(3, 0.25)).toBe(submapBakeResolution(3.5, 0.25));
    // 跨档才会换值（1.5×0.5=0.75 → 1 倍；3×0.5=1.5 → 2 倍）
    expect(submapBakeResolution(3, 0.5)).not.toBe(submapBakeResolution(1.5, 0.5));
  });

  it("脏入参退回下限，不产出 0 尺寸纹理", () => {
    expect(submapBakeResolution(Number.NaN, Number.NaN)).toBe(SUBMAP_BAKE_MIN_RES);
    expect(submapBakeResolution(0, 2)).toBe(SUBMAP_BAKE_MIN_RES);
    expect(submapBakeResolution(-5, 2)).toBe(SUBMAP_BAKE_MIN_RES);
  });
});

describe("边界羽化（insetPolygon / featherBands）", () => {
  /** 顺时针正方形（屏幕坐标 y 向下，顶点序 = TL→TR→BR→BL） */
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  it("insetPolygon：正方形向内缩 depth，四边各收进 depth", () => {
    const inset = insetPolygon(square, 8);
    expect(inset[0]).toEqual({ x: 8, y: 8 });
    expect(inset[1]).toEqual({ x: 92, y: 8 });
    expect(inset[2]).toEqual({ x: 92, y: 92 });
    expect(inset[3]).toEqual({ x: 8, y: 92 });
  });

  it("insetPolygon：绕向相反的多边形同样向内缩（不缩成向外扩）", () => {
    const reversed = [...square].reverse();
    const inset = insetPolygon(reversed, 8);
    for (const p of inset) {
      expect(p.x).toBeGreaterThanOrEqual(7.9);
      expect(p.x).toBeLessThanOrEqual(92.1);
      expect(p.y).toBeGreaterThanOrEqual(7.9);
      expect(p.y).toBeLessThanOrEqual(92.1);
    }
    // 面积必须变小（向内），不能反向膨胀
    const area = (poly: Array<{ x: number; y: number }>) =>
      Math.abs(poly[1].x - poly[0].x) * Math.abs(poly[2].y - poly[1].y);
    expect(area(inset)).toBeLessThan(100 * 100);
  });

  it("featherBands：steps 段同心带，宽度 = width/steps，alpha 线性递减", () => {
    const bands = featherBands(square, 24, 6);
    expect(bands).toHaveLength(6);
    expect(bands[0].width).toBeCloseTo(4);
    // 最外圈几乎全擦（透父图），最内圈几乎不擦
    expect(bands[0].alpha).toBeCloseTo(1 - 0.5 / 6);
    expect(bands[5].alpha).toBeCloseTo(1 - 5.5 / 6);
    expect(bands[0].alpha).toBeGreaterThan(bands[5].alpha);
    // 各带的路径深度单调内缩：第 i 带路径上离原边界的最近距离 = (i-0.5)*step
    expect(bands[0].path[0].x).toBeCloseTo(2);
    expect(bands[5].path[0].x).toBeCloseTo(22);
  });

  it("featherBands：退化入参返回空（不挂羽化层）", () => {
    expect(featherBands([{ x: 0, y: 0 }])).toEqual([]);
    expect(featherBands(square, 0)).toEqual([]);
    expect(featherBands(square, 24, 0)).toEqual([]);
  });
});
