/**
 * 一键成图生成器（B3 / R-MAP-21）纯函数测试。
 *
 * 引擎是确定性的（同 seed 同结果），因此所有断言都可以写**具体值**而不是
 * 区间 —— 具体值一旦变了，说明有人动了算法或参数，必须是有意的。
 */
import { describe, expect, it } from "vitest";
import { generateLand, landAreaRatio, pointInLand } from "../land";
import {
  RICHNESS_TOTALS,
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

  it("scale = 格边长补偿 × 地形体量 × 簇抖动；rotation 按素材体量分级", () => {
    for (const p of gen.placements) {
      // 下界：dense 档格子最小（~0.72）× 点符号体量（0.48）× 簇 0.88 × 微调 0.94
      // 上界：sparse 档格子最大（~1.32）× 山地 1.0 × 簇 1.14 × 微调 1.06
      expect(p.scale).toBeGreaterThan(0.2);
      expect(p.scale).toBeLessThanOrEqual(1.7);
      // 参考实现：丘陵一类小体量 ±15°、主池大体量 ±5~7°。这里按基准宽度分级
      const amp = sizeOf(p.spriteId).width >= 120 ? 7 : 15;
      expect(Math.abs(p.rotation), `${p.spriteId} 转得太多`).toBeLessThanOrEqual(amp);
    }
  });

  /**
   * 比例和谐的硬契约：**点符号必须明显小于地貌**。
   *
   * 【为什么钉这条】素材的 `baseWidth` 是"这张图原来画多大"，不是"它在图上该多大"：
   * 城郭贴图（135×130）与一条山脉（200×127）体量相当，若共用一个尺度，城堡会和
   * 山峰一样高。参考实现里城郭只有山峰的三分之一 —— 它的素材池是按用途分组后
   * 各自归一的（`TERRAIN_SCALE`）。这条一红，说明"什么该大什么该小"又被拉平了。
   */
  it("点符号（遗迹/聚落）的渲染宽度明显小于山地 —— 城堡不该和山一样高", () => {
    const medianWidthOf = (terrain: TerrainKind): number => {
      const widths = gen.placements
        .filter((p) => p.terrain === terrain)
        .map((p) => sizeOf(p.spriteId).width * p.scale)
        .sort((a, b) => a - b);
      return widths.length === 0 ? 0 : widths[Math.floor(widths.length / 2)];
    };
    const mountain = medianWidthOf("mountain");
    expect(mountain).toBeGreaterThan(0);
    expect(medianWidthOf("landmark")).toBeLessThan(mountain * 0.6);
    // 森林成片但要低于山脊（不然一张图会被林子糊住）
    expect(medianWidthOf("forest")).toBeLessThan(mountain * 0.95);
  });

  it("不重合、不超发（总数是上限；同簇内允许层叠）", () => {
    // 【为什么不再断言「两两相离」】手绘山脉就是叠着画的：同一丛簇里几座山
    // 互相压边才出厚度。旧断言把「均匀撒点」这个实现固化了，反而挡住了 P0-2。
    // 现在要钉的是**渲染级的糊**：两个实例不许落在同一点。
    const anchors = new Set(gen.placements.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`));
    expect(anchors.size).toBe(gen.placements.length);
    let minDist = Infinity;
    for (let i = 0; i < gen.placements.length; i++) {
      for (let j = i + 1; j < gen.placements.length; j++) {
        const a = gen.placements[i];
        const b = gen.placements[j];
        minDist = Math.min(minDist, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
    expect(minDist).toBeGreaterThan(4);
    expect(gen.placements.length).toBeLessThanOrEqual(RICHNESS_TOTALS.standard);
  });

  it("成团：多数实例在格内半径内挨着同类（不是均匀撒点）", () => {
    // 丛簇的判据：一个布点在 `cellSize*0.32*2` 内应当能找到同伴。
    // 用「同类最近邻距离中位数」表达，比数格子稳健（不依赖内部实现）。
    const pts = gen.placements;
    const nn: number[] = [];
    for (const p of pts) {
      let best = Infinity;
      for (const q of pts) {
        if (q === p) continue;
        best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
      }
      nn.push(best);
    }
    nn.sort((a, b) => a - b);
    const median = nn[Math.floor(nn.length / 2)];
    // 均匀撒点的最近邻中位数 ≈ 0.5·√(陆地面积/实例数) ≈ 45+；
    // 成团后应明显更小（实测见下方注释），给足余量防 flake
    expect(median, `最近邻中位数 ${median.toFixed(1)} 太大 = 又变成均匀撒点`).toBeLessThan(34);
  });

  it("配方成片：非主地形的同类最近邻明显小于「均匀撒点」的理论值", () => {
    // 【为什么换掉旧判据】旧断言比的是「点云直径 ≤ 纸宽」，那是"中心 + 半径"
    // 撒点法的特征值 —— 区域生长必然把主地形铺满全图（它就是那张纸的底色），
    // 直径必然超标。真正要钉的是**成团**：同类布点的最近邻距离应当远小于
    // 在同样面积里均匀撒同样多点的理论距离 `0.5·√(面积/数量)`。
    const area = landAreaRatio(land) * BOUNDS.width * BOUNDS.height;
    const byTerrain = new Map<TerrainKind, { x: number; y: number }[]>();
    for (const p of gen.placements) {
      const list = byTerrain.get(p.terrain) ?? [];
      list.push({ x: p.x, y: p.y });
      byTerrain.set(p.terrain, list);
    }
    let mainShare = 0;
    for (const [terrain, pts] of byTerrain) {
      const share = PRESET.terrainMix.find((m) => m.terrain === terrain)?.share ?? 0;
      // 主地形是画面的骨架：它应当铺得最广（不是成团，是"底色"）
      if (share >= 0.5) {
        mainShare = pts.length / gen.placements.length;
        continue;
      }
      if (pts.length < 6) continue; // 样本太小，中位数没有意义
      const nn = pts.map((p) => {
        let best = Infinity;
        for (const q of pts) if (q !== p) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
        return best;
      });
      nn.sort((a, b) => a - b);
      const nnMedian = nn[Math.floor(nn.length / 2)];
      const uniform = 0.5 * Math.sqrt(area / pts.length);
      expect(
        nnMedian,
        `${terrain} 最近邻中位数 ${nnMedian.toFixed(1)} 接近均匀撒点 ${uniform.toFixed(1)}`,
      ).toBeLessThan(uniform * 0.7);
    }
    // 主地形占半数以上：整张图读起来是「一座大山系 + 嵌在其中的林与水」
    expect(mainShare).toBeGreaterThan(0.45);
  });

  it("骨架档：只出陆地，布点为空", () => {
    const skeleton = generateMap({ ...makeOpts(99), mode: "skeleton" });
    expect(skeleton.land.polygons.length).toBeGreaterThanOrEqual(1);
    expect(skeleton.placements).toHaveLength(0);
  });
});

/**
 * 地貌带（第三轴，review §6 P0-1）。
 *
 * 分带最容易"看起来改了、其实没生效"：带标签加了但选材没传 zone，
 * 或者 zone 传了但格网全落在同一纬度。所以这里用**互斥池**做判据 ——
 * 每个素材只属于一个带，任何一条错配都立刻被抓到。
 */
describe("generateMap 地貌带", () => {
  /** 互斥池：同地形、三个带各一张，谁被抽到就说明那格是哪个带 */
  const ZONE_POOL: SpriteSource[] = [
    { id: "z-snow", src: "s.png", terrains: ["mountain"], zones: ["snow"] },
    { id: "z-core", src: "c.png", terrains: ["mountain"], zones: ["core"] },
    { id: "z-desert", src: "d.png", terrains: ["mountain"], zones: ["desert"] },
  ];
  const MOUNTAIN_ONLY = {
    id: "zone-probe",
    label: "分带探针",
    terrainMix: [{ terrain: "mountain" as TerrainKind, share: 1 }],
  };

  const gen = generateMap({
    seed: 20261104,
    bounds: BOUNDS,
    preset: MOUNTAIN_ONLY,
    richness: "standard",
    mode: "full",
    pool: ZONE_POOL,
    sizeOf,
  });

  it("每条布点都带带标签，且四个带都出得来（纬度分带真的在分）", () => {
    expect(gen.placements.length).toBeGreaterThan(20);
    const zones = new Set(gen.placements.map((p) => p.zone));
    expect(zones.has("snow")).toBe(true);
    expect(zones.has("desert")).toBe(true);
    expect(zones.has("core") || zones.has("grass")).toBe(true);
  });

  it("雪带不抽沙带素材（分带的全部意义）", () => {
    for (const p of gen.placements) {
      if (p.zone === "snow") expect(p.spriteId, "雪带抽到了沙带素材").not.toBe("z-desert");
      if (p.zone === "desert") expect(p.spriteId, "沙带抽到了雪带素材").not.toBe("z-snow");
    }
  });

  it("预设锁定气候时全图只用该带（「万里雪原」南缘不该冒沙丘）", () => {
    const locked = generateMap({
      seed: 20261104,
      bounds: BOUNDS,
      preset: { ...MOUNTAIN_ONLY, climate: "snow" },
      richness: "sparse",
      mode: "full",
      pool: ZONE_POOL,
      sizeOf,
    });
    expect(locked.placements.length).toBeGreaterThan(0);
    expect(new Set(locked.placements.map((p) => p.zone))).toEqual(new Set(["snow"]));
    for (const p of locked.placements) expect(p.spriteId).not.toBe("z-desert");
  });
});

describe("assignPlacementNames", () => {
  /**
   * 合成布点（不依赖 generateMap 的产出构成）：
   * 6 座山（无 names，纯地貌）+ 4 个聚落（s1/s2 自带 names）。
   * PRESET = 十万大山（mountain 有预设池，但山不带名 → 不吃池点名）。
   */
  const at = (
    spriteId: string,
    x: number,
    y: number,
    terrain: TerrainKind,
  ): SpritePlacement => ({ spriteId, x, y, scale: 1, rotation: 0, terrain, zone: "core" });

  const synthetic = (): SpritePlacement[] => [
    at("m1", 0, 0, "mountain"),
    at("m2", 40, 0, "mountain"),
    at("m3", 80, 0, "mountain"),
    at("m1", 120, 0, "mountain"),
    at("m2", 160, 0, "mountain"),
    at("m3", 200, 0, "mountain"),
    at("s1", 0, 300, "settlement"),
    at("s2", 60, 300, "settlement"),
    at("s1", 120, 300, "settlement"),
    at("s2", 180, 300, "settlement"),
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
  const at = (spriteId: string, x: number, y: number, terrain: TerrainKind): SpritePlacement => ({
    spriteId,
    x,
    y,
    scale: 1,
    rotation: 0,
    terrain,
    zone: "core",
  });

  it("按分类聚合计数（categoryOf 注入）", () => {
    const land = generateLand({ seed: 1, bounds: BOUNDS });
    const placements = [at("m1", 0, 0, "mountain"), at("m1", 5, 5, "mountain"), at("s1", 9, 9, "settlement")];
    const s = summarizeGeneration(land, placements, 2, (id) =>
      id.startsWith("m") ? "mountain" : "settlement",
    );
    expect(s.byCategory).toEqual({ mountain: 2, settlement: 1 });
    expect(s.namedCount).toBe(2);
    expect(s.landCount).toBe(land.polygons.length);
  });

  it("按地貌带聚合（分带失效时摘要立刻现形）", () => {
    const land = generateLand({ seed: 1, bounds: BOUNDS });
    const s = summarizeGeneration(
      land,
      [
        { ...at("m1", 0, 0, "mountain"), zone: "snow" },
        { ...at("m2", 5, 5, "mountain"), zone: "snow" },
        { ...at("m3", 9, 9, "mountain"), zone: "desert" },
      ],
      0,
      () => "mountain",
    );
    expect(s.byZone).toEqual({ snow: 2, desert: 1 });
  });

  it("未登记分类归入 other（不丢数）", () => {
    const land = generateLand({ seed: 1, bounds: BOUNDS });
    const s = summarizeGeneration(land, [at("x1", 0, 0, "plain")], 0, () => undefined);
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
