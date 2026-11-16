/**
 * 一键成图生成器（B3 / R-MAP-21）纯函数测试。
 *
 * 引擎是确定性的（同 seed 同结果），因此所有断言都可以写**具体值**而不是
 * 区间 —— 具体值一旦变了，说明有人动了算法或参数，必须是有意的。
 */
import { describe, expect, it } from "vitest";
import { generateLand, insetLand, landAreaRatio, pointInLand } from "../land";
import {
  CONTENT_KEYS,
  ELEMENT_SIZE_FACTOR,
  GRID_SIZES,
  MOUNTAIN_TERRAINS,
  NAMED_LABEL_QUOTA,
  assignPlacementNames,
  defaultContents,
  elementSeedOf,
  generateMap,
  installSpriteNamesResolver,
  landSeedOf,
  nameSeedOf,
  resolveGeneratorTuning,
  resolveTerrainMix,
  summarizeGeneration,
  type GeneratorRichness,
  type SpritePlacement,
} from "./generator";
import { mulberry32, type SpriteSource } from "./terrain-assets";
import { randomRecipe, type MapRecipe } from "./mapRecipe";
import { TERRAIN_KINDS, type TerrainKind } from "./terrain";
import { SPRITES, SPRITE_MAP } from "../sprites";

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
/**
 * 测试配方（固定配比）：山多林密 + 一点河与遗迹。
 *
 * 【为什么不再引用产品配方】2.45.0 删掉了三个固定预设，产品侧只剩「按 seed 随机」；
 * 用例需要**稳定**的配比来钉布点行为，所以在这里写死一份 —— 它属于测试夹具，
 * 不随产品调参漂移。`settlement` 刻意不在配比里：聚落自 2.45.0 起走
 * `planSettlements` 的选址算法，不再由区域生长产生。
 */
const RECIPE: MapRecipe = {
  id: "test-recipe",
  label: "测试配方",
  terrainMix: [
    { terrain: "mountain", share: 0.55 },
    { terrain: "forest", share: 0.3 },
    { terrain: "river", share: 0.1 },
    { terrain: "landmark", share: 0.05 },
  ],
};

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
  // 真实 id（2.46.0）：验"没有 tier 字段时间按 spriteId 反查层级"这条兜底路径
  "city-major": ["临江城", "云中城"],
  "city-mid": ["青石镇", "柳荫镇"],
  "village-b": ["石桥村", "上河村"],
  "port-dock": ["望潮港", "白沙港"],
};
installSpriteNamesResolver((id) => SPRITE_NAMES[id]);

function makeOpts(seed: number, richness: GeneratorRichness = "standard") {
  return {
    seed,
    bounds: BOUNDS,
    recipe: RECIPE,
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

  it("最大素材渲染宽度 ≤ 陆地包围盒宽度的 15%（陆地不该像小岛）", () => {
    // 问题 1 验收：同 seed 下，最大的山（baseWidth × scale）不得超过陆地实测宽度的
    // 约一成半。总闸 0.6→0.42 时上限 35%；对齐逆向目标（素材≈陆宽 8~12%）后
    // 总闸再收到 0.32，实测最大 ≈12%，阈值收到 15%（审计守卫 region-land-audit
    // 用"最长陆轴"口径再钉一次，两处口径互补）。
    let minX = Infinity;
    let maxX = -Infinity;
    for (const ring of land.polygons) {
      for (const p of ring) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
      }
    }
    const landWidth = Math.max(1, maxX - minX);
    const maxRenderWidth = Math.max(
      ...gen.placements.map((p) => sizeOf(p.spriteId).width * p.scale),
    );
    expect(
      maxRenderWidth,
      `最大渲染宽 ${maxRenderWidth.toFixed(1)} / 陆地宽 ${landWidth.toFixed(1)}`,
    ).toBeLessThanOrEqual(landWidth * 0.15);
  });

  it("丰度档单调：dense ≥ standard ≥ sparse", () => {
    const sparse = generateMap(makeOpts(31337, "sparse")).placements.length;
    const standard = generateMap(makeOpts(31337, "standard")).placements.length;
    const dense = generateMap(makeOpts(31337, "dense")).placements.length;
    expect(dense).toBeGreaterThan(standard);
    expect(standard).toBeGreaterThan(sparse);
  });

  it("scale 落在归一链的值域内；rotation 按地貌带分级（2.42.0 对齐逆向源值）", () => {
    for (const p of gen.placements) {
      // 体量 = 格网补偿(1|1.1) × 地形体量 × 总闸 × (1+D)，D 按带 ≤12%
      expect(p.scale).toBeGreaterThan(0.05);
      expect(p.scale).toBeLessThanOrEqual(1.7);
      // 旋转幅度按**带**取逆向源值：草带（丘陵）±15°、其余 ±5°（BAND_PARAMS）
      const amp = p.zone === "grass" ? 15 : 5;
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

  it("确定性去重 + 总量受格网容量封顶（同簇允许层叠 —— 逆向即如此）", () => {
    // 【2.42.0】对齐逆向源码后**刻意允许层叠**（每格 3 层错位 +10、丛簇内互相
    // 压边）：旧的「两两相离 / 最小间距 >4」断言把均匀撒点固化了，与参考的
    // 手绘层叠直接冲突，删除。要钉的契约换成两条：
    // ① 结构性去重：同 spriteId 的 (flip, 量化scale, 量化rotation) 全图至多一次；
    const seen = new Set<string>();
    for (const p of gen.placements) {
      const key = `${p.spriteId}|${p.flipX ? "F" : "N"}|${p.scale.toFixed(2)}|${p.rotation.toFixed(1)}`;
      expect(seen.has(key), `外观组合撞车：${key}`).toBe(false);
      seen.add(key);
    }
    // ② 总量封顶：总量 = 陆地格 × 每格层（≤3）或森林丛（≤7），不再有"目标总数"。
    //    用宽松上界（陆地包围盒面积 / 最疏格网 × 3 × 2）兜住"循环失控"这种回归。
    const grid = GRID_SIZES.standard;
    const cap = ((1024 * 1024) / (grid * grid)) * 3 * 2;
    expect(gen.placements.length).toBeLessThanOrEqual(cap);
    expect(gen.placements.length).toBeGreaterThan(0);
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
      const share = RECIPE.terrainMix.find((m) => m.terrain === terrain)?.share ?? 0;
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
 * 批次 A 守卫：海岸内缩 + z 分层（对应「地图渲染对齐」序 1 / 序 2）。
 *
 * 【为什么钉这两条】内缩与分层都是"看起来改了、其实没生效"的高发点：
 * 内缩若只加了常量、没接到落海判定上，素材照样压岸；分层若表建了、排序没接，
 * 森林照样盖住山。守卫直接对产出（placements 的坐标与顺序）断言，绕过内部实现。
 */
describe("批次A 守卫：海岸内缩与 z 分层", () => {
  const gen = generateMap(makeOpts(20260411));
  const inset = insetLand(gen.land);

  it("每个素材锚点都落在内缩轮廓内（素材不压海岸）", () => {
    expect(gen.placements.length).toBeGreaterThan(0);
    for (const p of gen.placements) {
      expect(pointInLand({ x: p.x, y: p.y }, inset), `${p.spriteId} 压到海岸`).toBe(true);
    }
  });

  it("z 分层档位优先：层小的更靠前，同层内仍按 y 升序", () => {
    // 与 generator 内部 TERRAIN_LAYER 同源的一份档位表（测试不 import 私有常量，
    // 用完整 Record<TerrainKind, number> 内联 —— 编译期同样保证 20 项写全）。
    const LAYER: Record<TerrainKind, number> = {
      forest: 0,
      jungle: 0,
      swamp: 0,
      river: 1,
      lake: 1,
      coast: 1,
      sea: 1,
      desert: 1,
      plain: 1,
      grassland: 1,
      snowfield: 1,
      tundra: 1,
      hill: 1.5,
      valley: 1.5,
      mountain: 2,
      highland: 2,
      volcano: 2,
      settlement: 3,
      landmark: 3,
      oasis: 3,
    };
    const ps = gen.placements;
    // 档位优先：整个数组的层数单调不减（层小的下标必小于层大的下标）
    for (let i = 0; i < ps.length; i += 1) {
      for (let j = i + 1; j < ps.length; j += 1) {
        expect(LAYER[ps[i].terrain]).toBeLessThanOrEqual(LAYER[ps[j].terrain]);
      }
    }
    // 同层内仍按脚底 y 升序
    for (let i = 0; i + 1 < ps.length; i += 1) {
      if (LAYER[ps[i].terrain] === LAYER[ps[i + 1].terrain]) {
        expect(ps[i].y).toBeLessThanOrEqual(ps[i + 1].y);
      }
    }
    // 钉「森林压底、山地置顶」的字面意图：两者同图时，森林必在全部山地之前
    const forestIdx = ps.findIndex((p) => p.terrain === "forest");
    const mountainIdx = ps.findIndex((p) => p.terrain === "mountain");
    if (forestIdx >= 0 && mountainIdx >= 0) {
      expect(forestIdx).toBeLessThan(mountainIdx);
    }
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
    recipe: MOUNTAIN_ONLY,
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
      recipe: { ...MOUNTAIN_ONLY, climate: "snow" },
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
   * RECIPE = 十万大山（mountain 有预设池，但山不带名 → 不吃池点名）。
   */
  const at = (
    spriteId: string,
    x: number,
    y: number,
    terrain: TerrainKind,
  ): SpritePlacement => ({ spriteId, x, y, scale: 1, rotation: 0, flipX: false, terrain, zone: "core" });

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
    const a = assignPlacementNames(synthetic(), RECIPE, 555);
    const b = assignPlacementNames(synthetic(), RECIPE, 555);
    expect(a).toEqual(b);
    const rerolled = assignPlacementNames(synthetic(), RECIPE, 555, { nameSeed: 0xabcdef });
    const aTexts = a.map((n) => n.text).join("|");
    const bTexts = rerolled.map((n) => n.text).join("|");
    expect(aTexts).not.toBe(bTexts);
  });

  it("全局查重：地名不重复", () => {
    const named = assignPlacementNames(synthetic(), RECIPE, 888);
    const texts = named.map((n) => n.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("taken 集合里的名字被避开（手动地名不被生成器抢走）", () => {
    const baseline = assignPlacementNames(synthetic(), RECIPE, 555);
    // 把 baseline 的第一名占掉再摇：结果里不应再出现它（池足够大时）
    const first = baseline[0];
    const withTaken = assignPlacementNames(synthetic(), RECIPE, 555, {
      taken: new Set([first.text]),
    });
    expect(withTaken.map((n) => n.text)).not.toContain(first.text);
  });

  it("只有带名素材产生地名（纯地貌不命名，防山名刷屏）", () => {
    const named = assignPlacementNames(synthetic(), RECIPE, 555);
    // 山不吃预设池点名：mountain 预设池只在素材自带 names 时才被消费
    expect(named.map((n) => n.index).sort()).toEqual([6, 7, 8, 9]);
  });

  /** 带层级的布点（2.46.0）：`tier` 由选址阶段写入，点名按它分档 */
  const withTier = (
    spriteId: string,
    x: number,
    y: number,
    tier: "city" | "town" | "village",
  ): SpritePlacement => ({ ...at(spriteId, x, y, "settlement"), tier });

  it("大城优先：名额不会被村名挤光（2.46.0 之前就是被挤光的）", () => {
    // 4 城 + 8 镇 + 24 村。旧实现按布点顺序取前 12 个 —— 聚落顺序是城→镇→村，
    // 看似城在前，但真实池里"村落"数量是城/镇的 5~10 倍，且城的素材常因落位
    // 失败被跳过，实测 seed 26 的 12 个名里 7 个是村名、4 座大城只有 1 座有名。
    const mixed: SpritePlacement[] = [
      ...Array.from({ length: 4 }, (_, i) => withTier("city-major", i * 10, 0, "city")),
      ...Array.from({ length: 8 }, (_, i) => withTier("city-mid", i * 10, 10, "town")),
      ...Array.from({ length: 24 }, (_, i) => withTier("village-b", i * 10, 20, "village")),
    ];
    const named = assignPlacementNames(mixed, RECIPE, 4242);
    const tierOfNamed = named.map((n) => mixed[n.index].tier);
    expect(tierOfNamed.filter((t) => t === "city")).toHaveLength(4); // 城全点名
    expect(named).toHaveLength(NAMED_LABEL_QUOTA); // 总配额不变（村负责填满）
    // 镇最多 4 个：剩下的名额给村，村不抢城/镇的预算
    expect(tierOfNamed.filter((t) => t === "town").length).toBeLessThanOrEqual(4);
    expect(tierOfNamed.filter((t) => t === "village").length).toBe(12 - 4 - 4);
  });

  it("字号分层：城 16 / 镇与地标 12 / 村 10", () => {
    const mixed: SpritePlacement[] = [
      withTier("city-major", 0, 0, "city"),
      withTier("city-mid", 10, 0, "town"),
      withTier("village-b", 20, 0, "village"),
      // 港/关隘/遗迹这类点要素归 "其它"：与镇同档
      at("port-dock", 30, 0, "settlement"),
    ];
    const named = assignPlacementNames(mixed, RECIPE, 7);
    const sizeAt = (index: number) => named.find((n) => n.index === index)?.size;
    expect(sizeAt(0)).toBe(16);
    expect(sizeAt(1)).toBe(12);
    expect(sizeAt(2)).toBe(10);
    expect(sizeAt(3)).toBe(12);
  });

  it("没有 tier 字段（老文档 / 合成数据）时按 spriteId 反查层级", () => {
    const legacy: SpritePlacement[] = [
      at("city-major", 0, 0, "settlement"),
      at("village-b", 10, 0, "settlement"),
    ];
    const named = assignPlacementNames(legacy, RECIPE, 9);
    const sizeAt = (index: number) => named.find((n) => n.index === index)?.size;
    expect(sizeAt(0)).toBe(16);
    expect(sizeAt(1)).toBe(10);
  });

  it("city-mid 靠反查会被读成 city —— 这正是布点必须带 tier 的原因", () => {
    // 同一个素材 id，两种语义：城镇用 `city-mid` 当首选，大城把它当第三顺位
    const asTown = assignPlacementNames([withTier("city-mid", 0, 0, "town")], RECIPE, 11);
    expect(asTown[0].size).toBe(12);
    const legacy = assignPlacementNames([at("city-mid", 0, 0, "settlement")], RECIPE, 11);
    expect(legacy[0].size).toBe(16); // 反查先命中 city 链 → 当成大城
  });
});

describe("summarizeGeneration", () => {
  const at = (spriteId: string, x: number, y: number, terrain: TerrainKind): SpritePlacement => ({
    spriteId,
    x,
    y,
    scale: 1,
    rotation: 0,
    flipX: false,
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

/* ─────────────────── 镜像翻转（观感批次 C · P1-4） ─────────────────── */

/**
 * 独立小池：一半可翻（缺省）、一半不可翻（显式 false）。
 *
 * 【为什么不动上面的 makePool】生成器是确定性的：池里增删任何一条都会改变
 * rng 消耗序列，既有用例钉住的"具体值"会集体漂移 —— 翻转的用例自带池，
 * 互不惊扰。
 */
function makeFlipPool(): SpriteSource[] {
  return [
    { id: "m1", src: "m1.png", terrains: ["mountain"] },
    { id: "m2", src: "m2.png", terrains: ["mountain"], flippable: false },
  ];
}

describe("generateMap 镜像翻转（P1-4）", () => {
  const flipOpts = (seed: number) => ({
    seed,
    bounds: BOUNDS,
    recipe: RECIPE,
    richness: "standard" as const,
    mode: "full" as const,
    pool: makeFlipPool(),
    sizeOf: () => ({ width: 120, height: 70 }),
  });

  it("flipX 随布点产出且同 seed 可复现：可翻素材有翻有正，换 seed 序列不同", () => {
    const a = generateMap(flipOpts(97531));
    const b = generateMap(flipOpts(97531));
    expect(b.placements).toEqual(a.placements);
    expect(a.placements.length).toBeGreaterThan(0);

    // 上百实例各掷 50%，全正 / 全反的概率 ~2^-N：有翻有正才算"随机生效"
    const m1 = a.placements.filter((p) => p.spriteId === "m1");
    expect(m1.length).toBeGreaterThan(0);
    expect(m1.some((p) => p.flipX)).toBe(true);
    expect(m1.some((p) => !p.flipX)).toBe(true);

    // 换 seed：翻面序列不该逐实例全同（「换一张」对翻转同样成立）
    const c = generateMap(flipOpts(97532));
    expect(c.placements.map((p) => p.flipX)).not.toEqual(a.placements.map((p) => p.flipX));
  });

  it("flippable: false 的素材恒不翻面（有朝向的人造物翻了会说谎）", () => {
    const gen = generateMap(flipOpts(4242));
    const noFlip = gen.placements.filter((p) => p.spriteId === "m2");
    expect(noFlip.length).toBeGreaterThan(0);
    expect(noFlip.every((p) => p.flipX === false)).toBe(true);
  });

  /**
   * 验收①（review §9.2.2 序 4，主理人裁决后抬升为**结构性保证**）：任意 seed
   * 一键成图后，同屏「像素完全一致」的素材对数恒 = 0。
   *
   * 【"像素完全一致"的判据】spriteId 相同 + 翻面相同 + scale 相同（生成器把
   * 实例缩放钉到 0.01）+ rotation 相同（钉到 0.1°）—— 四者全等时两张贴图
   * 在任何视口下逐像素重合。
   *
   * 【为什么必须多 seed】QA 用真实池 + 全预设 + dense 做 60 seeds 独立扫描，
   * 证明"翻转砍半期望"只是统计性的：稀池档（沼泽/十万大山）下量化抖动自身
   * 会碰撞，59/180 张图仍有 ≥1 对一致素材。生成器已补**确定性去重**（同一
   * spriteId 的 (flip, 量化scale, 量化rotation) 组合全图至多登记一次，撞车
   * 先翻反 flip、仍撞重掷 rotation），本守卫按 ≥20 seeds × 全预设 × dense
   * 钉死"任意 seed 恒 0"。
   */
  it("验收①（结构性）：20 seeds × 全预设 × dense，像素完全一致的素材对数恒 = 0", () => {
    const pixelKeyOf = (p: SpritePlacement) =>
      `${p.spriteId}|${p.flipX ? "F" : "N"}|${p.scale.toFixed(2)}|${p.rotation.toFixed(1)}`;
    // 随机配方 × 20 seeds：产品侧已经没有固定预设了，这里覆盖三种随机抽法
    for (const recipe of [randomRecipe(1), randomRecipe(7), randomRecipe(99)]) {
      for (let seed = 1; seed <= 20; seed++) {
        const gen = generateMap({
          seed,
          bounds: BOUNDS,
          recipe,
          richness: "dense",
          mode: "full",
          pool: SPRITES,
          sizeOf: (id) => {
            const d = SPRITE_MAP[id];
            return d ? { width: d.baseWidth, height: d.baseHeight } : { width: 90, height: 70 };
          },
        });
        const keys = gen.placements.map(pixelKeyOf);
        const dup = keys.length - new Set(keys).size;
        expect(dup, `${recipe.id} seed=${seed} 有 ${dup} 对像素完全一致的素材`).toBe(0);
      }
    }
  }, 120_000);
});

/**
 * 面板控制（对齐逆向目标的「生成内容 / 山体 / 河流 / 要素大小」）。
 *
 * 四组控制都只落在**配方层**：内容开关与分族密度改 `terrainMix`，要素大小改
 * 全局体量倍率。因此断言也分两类 —— "某族还有没有"看 `byTerrain` 计数，
 * "该多该少"看中位数比值；都不必逐实例比对坐标。
 */
describe("generateMap 面板控制（内容开关 / 分族密度 / 要素大小）", () => {
  /** 按地形统计实例数（`terrain` 是布点上记录的取用配方） */
  const countByTerrain = (ps: readonly SpritePlacement[]): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const p of ps) out[p.terrain] = (out[p.terrain] ?? 0) + 1;
    return out;
  };

  const withTuning = (
    seed: number,
    tuning: Parameters<typeof resolveGeneratorTuning>[0],
  ) =>
    generateMap({
      ...makeOpts(seed),
      tuning: resolveGeneratorTuning(tuning),
    });

  it("缺省 tuning ⇒ 与 2.39.0（不传 tuning）逐实例完全相同", () => {
    const plain = generateMap(makeOpts(20260411));
    const explicit = generateMap({
      ...makeOpts(20260411),
      tuning: resolveGeneratorTuning({}),
    });
    expect(explicit.placements).toEqual(plain.placements);
  });

  it("关掉「森林」⇒ 一个森林实例都不铺，总量基本不缩水", () => {
    const base = generateMap(makeOpts(20260411));
    const noForest = withTuning(20260411, {
      contents: { ...defaultContents(), forest: false },
    });
    expect(countByTerrain(noForest.placements).forest ?? 0).toBe(0);
    expect((countByTerrain(base.placements).forest ?? 0)).toBeGreaterThan(0);
    /**
     * 腾出来的份额分给其它族 ⇒ 总量**大致**不缩水。
     *
     * 【为什么不是"完全相等"】`total` 是硬上限而不是承诺值：落位要过"贴图整体在
     * 内缩岸线内 + 簇内最小间距 + 跨格碰撞"，换一批地形后能落下的个数会差一截 ——
     * 关掉森林后主族变成大体量的山（160×93），跨格碰撞更早拦人，实测 71 → 61。
     * "份额重新归一"这件事由 `resolveTerrainMix` 的合计数用例单独钉住；这里只钉
     * "不是整片消失"。
     */
    expect(noForest.placements.length).toBeGreaterThan(base.placements.length * 0.6);
  });

  it("「山体：无」⇒ 山地族一条不剩；「河流：无」⇒ 一条河都不画", () => {
    const noMountain = withTuning(20260411, { mountainDensity: "none" });
    const byTerrain = countByTerrain(noMountain.placements);
    for (const t of MOUNTAIN_TERRAINS) expect(byTerrain[t] ?? 0).toBe(0);

    // 2.44.0 起水系是**折线**（河 + 湖），不再是素材：判据改成 polylines
    const base = generateMap(makeOpts(20260411));
    expect(base.polylines.filter((l) => l.kind === "river").length).toBeGreaterThan(0);
    expect(base.polylines.filter((l) => l.kind === "lake").length).toBeGreaterThan(0);

    const noRiver = withTuning(20260411, { riverDensity: "none" });
    expect(noRiver.polylines).toEqual([]);
    // 其它族被归一化放大 ⇒ 图不会被削薄
    expect(noRiver.placements.length).toBeGreaterThan(0);
  });

  it("「山体：多 / 少」真的改变该族占比（同 seed 对照）", () => {
    const more = countByTerrain(withTuning(20260411, { mountainDensity: "more" }).placements);
    const less = countByTerrain(withTuning(20260411, { mountainDensity: "less" }).placements);
    const mountainOf = (m: Record<string, number>) =>
      MOUNTAIN_TERRAINS.reduce((acc, t) => acc + (m[t] ?? 0), 0);
    expect(mountainOf(more)).toBeGreaterThan(mountainOf(less));
  });

  it("生成内容全不勾 + 山体/河流「无」⇒ 只出陆地（与骨架档同一出口），不抛错", () => {
    const all = defaultContents();
    for (const key of CONTENT_KEYS) all[key] = false;
    /**
     * 【为什么还要把「山体」调到无】山体族（mountain / highland / volcano）**不属于
     * 任何内容类目** —— 参考面板里山也不是勾选项，它只受「山体」那一档控制。
     * 所以"内容全不勾"仍会铺山；要让配方彻底空掉，必须连山体档一起关。
     */
    const gen = withTuning(20260411, {
      contents: all,
      mountainDensity: "none",
      riverDensity: "none",
    });
    expect(gen.placements).toHaveLength(0);
    expect(gen.land.polygons.length).toBeGreaterThan(0);
  });

  it("要素大小「最小」⇒ 全图中位缩放约为正常档的 0.66 倍", () => {
    const median = (ps: readonly SpritePlacement[]) => {
      const xs = ps.map((p) => p.scale).sort((a, b) => a - b);
      return xs[Math.floor(xs.length / 2)] ?? 0;
    };
    const normal = median(generateMap(makeOpts(20260411)).placements);
    const tiny = median(withTuning(20260411, { elementSize: "tiny" }).placements);
    expect(tiny / normal).toBeCloseTo(ELEMENT_SIZE_FACTOR.tiny, 1);
    expect(tiny).toBeLessThan(normal);
  });

  it("resolveTerrainMix：份额按内容开关与密度档重算后仍归一（合计 = 总数）", () => {
    const tuning = resolveGeneratorTuning({ mountainDensity: "less" });
    const slots = resolveTerrainMix(RECIPE, tuning, 120);
    expect(slots.reduce((acc, s) => acc + s.count, 0)).toBe(120);
    // 山体份额 0.55 × 0.45 = 0.2475，重归一后仍应是最大族之一
    expect(slots.find((s) => s.terrain === "mountain")).toBeTruthy();
  });
});

/**
 * 大陆形状 / 底色透传（2.41.0）。
 *
 * `generateMap` 只是中转：shape 原样进 `buildLand`、底色按 id 查表后落到
 * `land.baseColor`（bakeCoast 读它上色）。这里钉住两端 —— 中转丢了就是
 * 「面板上选了没反应」。
 */
describe("generateMap 大陆形状 / 底色透传", () => {
  it("shape 进陆地：盘古档恒 1 块岛、三大洲恒 3 块", () => {
    for (const seed of [7, 9176]) {
      expect(generateMap({ ...makeOpts(seed), shape: "pangaea" }).land.polygons).toHaveLength(1);
      expect(
        generateMap({ ...makeOpts(seed), shape: "threeContinents" }).land.polygons,
      ).toHaveLength(3);
    }
  });

  it("landColorId 落到 land.baseColor；不传 = 无该字段（渲染回落羊皮纸）", () => {
    const colored = generateMap({ ...makeOpts(7), landColorId: "sage" });
    expect(colored.land.baseColor).toBe(0xb7bfa0);
    const plain = generateMap(makeOpts(7));
    expect(plain.land.baseColor).toBeUndefined();
  });
});
