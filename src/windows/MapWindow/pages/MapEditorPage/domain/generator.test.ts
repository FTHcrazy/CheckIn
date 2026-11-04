/**
 * 一键成图生成器（B3 / R-MAP-21）纯函数测试。
 *
 * 引擎是确定性的（同 seed 同结果），因此所有断言都可以写**具体值**而不是
 * 区间 —— 具体值一旦变了，说明有人动了算法或参数，必须是有意的。
 */
import { describe, expect, it } from "vitest";
import { generateLand, pointInLand } from "../land";
import {
  assignPlacementNames,
  elementSeedOf,
  generateMap,
  installSpriteNamesResolver,
  landSeedOf,
  nameSeedOf,
  summarizeGeneration,
  type GeneratorRichness,
  type SpritePlacement,
} from "./generator";
import { mulberry32, type SpriteSource } from "./terrain-assets";
import { MAP_PRESETS } from "./mapPresets";
import { TERRAIN_KINDS, type TerrainKind } from "./terrain";

/** 测试用小池：形状与 sprites.ts 的 SpriteDef 同构（id/src/terrains/weight） */
function makePool(): SpriteSource[] {
  return [
    { id: "m1", src: "m1.png", terrains: ["mountain"] },
    { id: "m2", src: "m2.png", terrains: ["mountain"] },
    { id: "m3", src: "m3.png", terrains: ["mountain", "hill"], weight: 1.5 },
    { id: "h1", src: "h1.png", terrains: ["hill"] },
    { id: "f1", src: "f1.png", terrains: ["forest"] },
    { id: "t1", src: "t1.png", terrains: ["forest"] },
    { id: "t2", src: "t2.png", terrains: ["forest"] },
    { id: "s1", src: "s1.png", terrains: ["settlement"], names: ["青石镇", "杏花村"] },
    { id: "s2", src: "s2.png", terrains: ["settlement"], names: ["临江城"] },
  ];
}

const BOUNDS = { x: -512, y: -512, width: 1024, height: 1024 };
const PRESET = MAP_PRESETS[0];

const SIZE_TABLE: Record<string, { width: number; height: number }> = {
  m1: { width: 160, height: 93 },
  m2: { width: 120, height: 70 },
  m3: { width: 200, height: 127 },
  h1: { width: 100, height: 61 },
  f1: { width: 130, height: 130 },
  t1: { width: 42, height: 86 },
  t2: { width: 48, height: 51 },
  s1: { width: 105, height: 66 },
  s2: { width: 135, height: 130 },
};

const sizeOf = (id: string) => SIZE_TABLE[id] ?? { width: 90, height: 70 };

/** 测试装上素材名池解析器（hook 装配时同款动作） */
const SPRITE_NAMES: Record<string, string[]> = {
  s1: ["青石镇", "杏花村"],
  s2: ["临江城"],
};
installSpriteNamesResolver((id) => SPRITE_NAMES[id]);

function makeOpts(seed: number, richness: GeneratorRichness = "standard") {
  return {
    seed,
    bounds: BOUNDS,
    preset: PRESET,
    richness,
    mode: "full" as const,
    pool: makePool(),
    sizeOf,
  };
}

describe("generateMap 确定性", () => {
  it("同 seed + 同参数 → 陆地与逐实例布点完全相同", () => {
    const a = generateMap(makeOpts(424242));
    const b = generateMap(makeOpts(424242));
    expect(b.land).toEqual(a.land);
    expect(b.placements).toEqual(a.placements);
  });

  it("换 seed → 布点不同（换一张有意义的必要前提）", () => {
    const a = generateMap(makeOpts(1));
    const b = generateMap(makeOpts(2));
    // 布点序列（spriteId + 坐标）不该完全一致
    const keyOf = (r: { spriteId: string; x: number; y: number }) =>
      `${r.spriteId}@${r.x.toFixed(1)},${r.y.toFixed(1)}`;
    const aKeys = a.placements.map(keyOf).sort();
    const bKeys = b.placements.map(keyOf).sort();
    expect(aKeys).not.toEqual(bKeys);
  });

  it("elementSeed 覆盖只换素材，陆地逐字节不动（只换素材档的前提）", () => {
    const base = generateMap(makeOpts(777));
    const rerolled = generateMap({ ...makeOpts(777), elementSeed: elementSeedOf(777) ^ 0x1234 });
    expect(rerolled.land).toEqual(base.land);
    expect(rerolled.placements).not.toEqual(base.placements);
  });

  it("三条子流盐值互不相同且确定", () => {
    expect(landSeedOf(42)).toBe(landSeedOf(42));
    expect(elementSeedOf(42)).toBe(elementSeedOf(42));
    expect(nameSeedOf(42)).toBe(nameSeedOf(42));
    expect(new Set([landSeedOf(42), elementSeedOf(42), nameSeedOf(42)]).size).toBe(3);
  });
});

describe("generateMap 布点合法性", () => {
  const gen = generateMap(makeOpts(20260411));
  const land = gen.land;

  it("有产出（陆地 ≥1 块、素材铺了出来）", () => {
    expect(land.polygons.length).toBeGreaterThanOrEqual(1);
    // 目标 120 是**上限**：碰撞拒绝（允许层叠但拦深叠）会让实际数量自适应回落，
    // 真实 53 张池（含大量小体量树/草）会明显高于这个悲观小池的值
    expect(gen.placements.length).toBeGreaterThanOrEqual(40);
  });

  it("每个布点都落在陆地内（不允许素材漂在海面上）", () => {
    for (const p of gen.placements) {
      expect(pointInLand({ x: p.x, y: p.y }, land), p.spriteId).toBe(true);
    }
  });

  it("丰度档单调：dense ≥ standard ≥ sparse", () => {
    const sparse = generateMap(makeOpts(31337, "sparse")).placements.length;
    const standard = generateMap(makeOpts(31337, "standard")).placements.length;
    const dense = generateMap(makeOpts(31337, "dense")).placements.length;
    expect(dense).toBeGreaterThan(standard);
    expect(standard).toBeGreaterThan(sparse);
  });

  it("scale/rotation 在抖动区间内", () => {
    for (const p of gen.placements) {
      expect(p.scale).toBeGreaterThanOrEqual(0.85);
      expect(p.scale).toBeLessThanOrEqual(1.2);
      expect(p.rotation).toBeGreaterThanOrEqual(-7);
      expect(p.rotation).toBeLessThanOrEqual(7);
    }
  });

  it("布点不深叠（核心盒两两相离；允许手绘式的边缘层叠）", () => {
    // 与引擎同款核心系数：55% 收缩 + 2 呼吸边
    const CORE = 0.55;
    const boxes = gen.placements.map((p) => {
      const { width, height } = sizeOf(p.spriteId);
      const w = width * p.scale * CORE;
      const h = height * p.scale * CORE;
      return { x0: p.x - w / 2 - 2, x1: p.x + w / 2 + 2, y0: p.y - h - 2, y1: p.y + 2 };
    });
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlap = a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
        expect(overlap, `#${i} 与 #${j} 深叠`).toBe(false);
      }
    }
  });

  it("配方成片：同一配方的布点聚在各自中心邻域（空间上读得出地形）", () => {
    // 十万大山 mountain 占 55%：mountain 配方的点云半径应明显小于整张纸
    const byTerrain = new Map<TerrainKind, { x: number; y: number }[]>();
    for (const p of gen.placements) {
      const list = byTerrain.get(p.terrain) ?? [];
      list.push({ x: p.x, y: p.y });
      byTerrain.set(p.terrain, list);
    }
    for (const [terrain, pts] of byTerrain) {
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      const maxDist = Math.max(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy)));
      // 配方点云直径不超过纸宽（成片而非满地乱撒）；主地形（份额 ≥0.5）放宽到 1.1 倍
      const share = PRESET.terrainMix.find((m) => m.terrain === terrain)?.share ?? 0;
      const limit = share >= 0.5 ? 1024 * 1.1 : 1024;
      expect(maxDist * 2, `${terrain} 点云过散`).toBeLessThan(limit);
    }
  });

  it("骨架档：只出陆地，布点为空", () => {
    const skeleton = generateMap({ ...makeOpts(99), mode: "skeleton" });
    expect(skeleton.land.polygons.length).toBeGreaterThanOrEqual(1);
    expect(skeleton.placements).toHaveLength(0);
  });
});

describe("assignPlacementNames", () => {
  /**
   * 合成布点（不依赖 generateMap 的产出构成）：
   * 6 座山（无 names，纯地貌）+ 4 个聚落（s1/s2 自带 names）。
   * PRESET = 十万大山（mountain 有预设池，但山不带名 → 不吃池点名）。
   */
  const synthetic = (): SpritePlacement[] => [
    { spriteId: "m1", x: 0, y: 0, scale: 1, rotation: 0, terrain: "mountain" },
    { spriteId: "m2", x: 40, y: 0, scale: 1, rotation: 0, terrain: "mountain" },
    { spriteId: "m3", x: 80, y: 0, scale: 1, rotation: 0, terrain: "mountain" },
    { spriteId: "m1", x: 120, y: 0, scale: 1, rotation: 0, terrain: "mountain" },
    { spriteId: "m2", x: 160, y: 0, scale: 1, rotation: 0, terrain: "mountain" },
    { spriteId: "m3", x: 200, y: 0, scale: 1, rotation: 0, terrain: "mountain" },
    { spriteId: "s1", x: 0, y: 300, scale: 1, rotation: 0, terrain: "settlement" },
    { spriteId: "s2", x: 60, y: 300, scale: 1, rotation: 0, terrain: "settlement" },
    { spriteId: "s1", x: 120, y: 300, scale: 1, rotation: 0, terrain: "settlement" },
    { spriteId: "s2", x: 180, y: 300, scale: 1, rotation: 0, terrain: "settlement" },
  ];

  it("同 seed 同名；只换名档（nameSeed 覆盖）能摇出不同组合", () => {
    const a = assignPlacementNames(synthetic(), PRESET, 555);
    const b = assignPlacementNames(synthetic(), PRESET, 555);
    expect(a).toEqual(b);
    const rerolled = assignPlacementNames(synthetic(), PRESET, 555, { nameSeed: 0xabcdef });
    const aTexts = a.map((n) => n.text).join("|");
    const bTexts = rerolled.map((n) => n.text).join("|");
    expect(aTexts).not.toBe(bTexts);
  });

  it("全局查重：地名不重复", () => {
    const named = assignPlacementNames(synthetic(), PRESET, 888);
    const texts = named.map((n) => n.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("taken 集合里的名字被避开（手动地名不被生成器抢走）", () => {
    const baseline = assignPlacementNames(synthetic(), PRESET, 555);
    // 把 baseline 的第一名占掉再摇：结果里不应再出现它（池足够大时）
    const first = baseline[0];
    const withTaken = assignPlacementNames(synthetic(), PRESET, 555, {
      taken: new Set([first.text]),
    });
    expect(withTaken.map((n) => n.text)).not.toContain(first.text);
  });

  it("只有带名素材产生地名（纯地貌不命名，防山名刷屏）", () => {
    const named = assignPlacementNames(synthetic(), PRESET, 555);
    // 山不吃预设池点名：mountain 预设池只在素材自带 names 时才被消费
    expect(named.map((n) => n.index).sort()).toEqual([6, 7, 8, 9]);
  });
});

describe("summarizeGeneration", () => {
  it("按分类聚合计数（categoryOf 注入）", () => {
    const land = generateLand({ seed: 1, bounds: BOUNDS });
    const placements = [
      { spriteId: "m1", x: 0, y: 0, scale: 1, rotation: 0, terrain: "mountain" as TerrainKind },
      { spriteId: "m1", x: 5, y: 5, scale: 1, rotation: 0, terrain: "mountain" as TerrainKind },
      { spriteId: "s1", x: 9, y: 9, scale: 1, rotation: 0, terrain: "settlement" as TerrainKind },
    ];
    const s = summarizeGeneration(land, placements, 2, (id) =>
      id.startsWith("m") ? "mountain" : "settlement",
    );
    expect(s.byCategory).toEqual({ mountain: 2, settlement: 1 });
    expect(s.namedCount).toBe(2);
    expect(s.landCount).toBe(land.polygons.length);
  });

  it("未登记分类归入 other（不丢数）", () => {
    const land = generateLand({ seed: 1, bounds: BOUNDS });
    const s = summarizeGeneration(
      land,
      [{ spriteId: "x1", x: 0, y: 0, scale: 1, rotation: 0, terrain: "plain" as TerrainKind }],
      0,
      () => undefined,
    );
    expect(s.byCategory.other).toBe(1);
  });
});

describe("生成器 × 真实守卫约定", () => {
  it("每条素材的 terrains 都能被某个配方命中（漏标注 = 生成器看不到它）", () => {
    // 池内素材必须至少挂一个合法枚举（与 terrain-assets 守卫呼应）
    const pool = makePool();
    for (const s of pool) {
      expect(s.terrains.length).toBeGreaterThan(0);
      for (const t of s.terrains) expect(TERRAIN_KINDS).toContain(t);
    }
  });

  it("种子碰撞检查：mulberry32 在不同 seed 下序列不同（抽样验证）", () => {
    const a: number[] = [];
    const b: number[] = [];
    const ra = mulberry32(1);
    const rb = mulberry32(2);
    for (let i = 0; i < 8; i++) {
      a.push(ra());
      b.push(rb());
    }
    expect(a).not.toEqual(b);
  });
});
