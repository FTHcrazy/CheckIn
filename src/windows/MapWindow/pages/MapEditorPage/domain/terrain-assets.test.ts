import { describe, expect, it } from "vitest";
import { MAP_PRESETS, expandTerrainMix } from "./mapPresets";
import { mulberry32, pickTerrainSprites, type SpriteSource } from "./terrain-assets";
import { isTerrainKind, TERRAIN_KINDS, TERRAIN_META, type TerrainKind } from "./terrain";
import { SPRITES } from "../sprites";

/**
 * 选材引擎单元测试 + 体系守卫（架构 §五 / §十二.3）。
 *
 * 引擎四条（B3 集成时防止纯函数被改成有状态）：
 *  seed 确定性 / 多标签命中 / 回退链补位 / exclude 生效。
 *
 * 守卫三条（§十二.3，防止「静默失效」）：
 *  - SPRITES 每条 terrains 非空且枚举合法（漏标注 = 进不了任何配方）；
 *  - 每个地形要么有素材、要么回退链可达有素材的地形（防空转枚举）；
 *  - 预设 share 合计 = 1、地形键合法。
 */

const src = (id: string, terrains: SpriteSource["terrains"], weight?: number): SpriteSource => ({
  id,
  src: `mock://${id}`,
  terrains,
  ...(weight === undefined ? {} : { weight }),
});

describe("mulberry32 确定性", () => {
  it("同 seed 同序列，不同 seed 不同序列", () => {
    const a1 = mulberry32(42);
    const a2 = mulberry32(42);
    const seq1 = Array.from({ length: 8 }, () => a1());
    const seq2 = Array.from({ length: 8 }, () => a2());
    expect(seq2).toEqual(seq1);
    const b = mulberry32(43);
    const seq3 = Array.from({ length: 8 }, () => b());
    expect(seq3).not.toEqual(seq1);
  });

  it("输出落在 [0,1)", () => {
    const rng = mulberry32(0);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("pickTerrainSprites", () => {
  const POOL: SpriteSource[] = [
    src("swamp-reeds", ["swamp", "lake"]),
    src("swamp-weeds", ["swamp"]),
    src("swamp-dead", ["swamp"]),
    src("lake-ship", ["lake", "sea"]),
    src("mountain-peak", ["mountain", "snowfield"]),
    src("snow-mound", ["snowfield", "tundra"]),
  ];

  it("seed 确定性：同 seed 同结果（「换一张」= seed++ 的前提）", () => {
    const r1 = pickTerrainSprites(POOL, "swamp", { count: 3, seed: 7 });
    const r2 = pickTerrainSprites(POOL, "swamp", { count: 3, seed: 7 });
    expect(r2.map((s) => s.id)).toEqual(r1.map((s) => s.id));
    // 换 seed 允许不同（不强断言必不同——小池可能撞结果，这里池够大）
    const r3 = pickTerrainSprites(POOL, "swamp", { count: 3, seed: 8 });
    expect(r3.map((s) => s.id)).not.toEqual(r1.map((s) => s.id));
  });

  it("多标签命中：同一素材可被多个地形抽到", () => {
    const forSwamp = pickTerrainSprites(POOL, "swamp", { count: 3, seed: 1 });
    const forLake = pickTerrainSprites(POOL, "lake", { count: 3, seed: 1 });
    expect(forSwamp.map((s) => s.id)).toContain("swamp-reeds");
    expect(forLake.map((s) => s.id)).toContain("swamp-reeds");
    expect(forLake.map((s) => s.id)).toContain("lake-ship");
  });

  it("不放回：count 超过池容量时返回全部且 id 唯一", () => {
    const picked = pickTerrainSprites(POOL, "swamp", { count: 6, seed: 3 });
    const ids = picked.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    // swamp 主池 3 张 + lake 回退补位：swamp-reeds 已被主池抽走（多标签不放回），
    // 回退只剩 lake-ship → 合计 4
    expect(ids).toHaveLength(4);
    expect(ids.filter((id) => id === "swamp-reeds")).toHaveLength(1);
  });

  it("excludeIds 生效：被排除的素材视同不存在", () => {
    const picked = pickTerrainSprites(POOL, "swamp", {
      count: 3,
      seed: 1,
      excludeIds: ["swamp-reeds", "swamp-weeds"],
    });
    const ids = picked.map((s) => s.id);
    expect(ids).not.toContain("swamp-reeds");
    expect(ids).not.toContain("swamp-weeds");
    expect(ids).toContain("swamp-dead");
  });

  it("回退链补位：主地形不足时按 fallbacks 顺序向前凑满", () => {
    // tundra 主池只有 snow-mound（多标签挂了 tundra）；不足 2 张 →
    // 按 fallbacks [snowfield, ...] 补位：snowfield 池里 mountain-peak 可用
    const picked = pickTerrainSprites(POOL, "tundra", { count: 2, seed: 5 });
    expect(picked.map((s) => s.id)).toEqual(["snow-mound", "mountain-peak"]);
  });

  it("池枯竭不抛错：有多少给多少", () => {
    const picked = pickTerrainSprites(POOL, "volcano", { count: 4, seed: 9 });
    // volcano 主池空 → 回退 mountain → mountain-peak 1 张
    expect(picked.map((s) => s.id)).toEqual(["mountain-peak"]);
  });

  it("weight 加权：高权重素材显著高频", () => {
    const weighted: SpriteSource[] = [src("rare", ["grassland"]), src("common", ["grassland"], 10)];
    let commonCount = 0;
    for (let seed = 0; seed < 200; seed++) {
      const [picked] = pickTerrainSprites(weighted, "grassland", { count: 1, seed });
      if (picked.id === "common") commonCount++;
    }
    // 理论 ~10/11 ≈ 90.9%；放宽到 70% 防边界抖动
    expect(commonCount).toBeGreaterThan(140);
  });

  it("不改写入参池", () => {
    const snapshot = POOL.map((s) => ({ ...s }));
    pickTerrainSprites(POOL, "swamp", { count: 6, seed: 2 });
    expect(POOL).toEqual(snapshot);
  });
});

// ── 守卫（架构 §十二.3）────────────────────────────────────────

describe("守卫：素材标注完整性", () => {
  it("SPRITES 每条 terrains 非空且全部为合法枚举（漏标注 = 静默失效）", () => {
    for (const sprite of SPRITES) {
      expect(
        sprite.terrains.length,
        `${sprite.id} 未标注 terrains，进不了任何地形配方`,
      ).toBeGreaterThan(0);
      for (const t of sprite.terrains) {
        expect(isTerrainKind(t), `${sprite.id} 的 terrains 含非法地形 ${String(t)}`).toBe(true);
      }
    }
  });

  it("id 唯一（存档存 id，重复 id = 存档错乱）", () => {
    const ids = SPRITES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每个地形要么有素材、要么回退链可达有素材的地形（防空转枚举）", () => {
    const covered = new Set(TERRAIN_KINDS.filter((k) => SPRITES.some((s) => s.terrains.includes(k))));
    for (const kind of TERRAIN_KINDS) {
      if (covered.has(kind)) continue;
      // 沿回退链 BFS，必须到达 covered 集（visited 集同时保证无环时有限步终止）
      const visited = new Set<TerrainKind>([kind]);
      const queue: TerrainKind[] = [kind];
      let reachable = false;
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const fb of TERRAIN_META[cur].fallbacks) {
          if (covered.has(fb)) {
            reachable = true;
            break;
          }
          if (!visited.has(fb)) {
            visited.add(fb);
            queue.push(fb);
          }
        }
        if (reachable) break;
      }
      expect(reachable, `${kind} 无素材且回退链不可达有素材地形`).toBe(true);
    }
  });
});

describe("守卫：热门地图预设", () => {
  it("每个预设 share 合计 = 1（浮点容差内），地形键合法，id 唯一", () => {
    const ids = MAP_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of MAP_PRESETS) {
      const sum = preset.terrainMix.reduce((s, m) => s + m.share, 0);
      expect(sum, `${preset.id} share 合计 ${sum} ≠ 1`).toBeCloseTo(1, 9);
      for (const m of preset.terrainMix) {
        expect(isTerrainKind(m.terrain), `${preset.id} 含非法地形`).toBe(true);
        expect(m.share).toBeGreaterThan(0);
      }
    }
  });

  it("expandTerrainMix：合计恰为 total，配比方向正确", () => {
    const preset = MAP_PRESETS[0];
    for (const total of [1, 7, 20, 100]) {
      const expanded = expandTerrainMix(preset, total);
      const sum = expanded.reduce((s, m) => s + m.count, 0);
      expect(sum).toBe(total);
      // 最大份额地形拿到的数量不少于最小份额地形
      const byShare = [...preset.terrainMix].sort((a, b) => b.share - a.share);
      const countOf = (t: string) => expanded.find((m) => m.terrain === t)?.count ?? 0;
      expect(countOf(byShare[0].terrain)).toBeGreaterThanOrEqual(
        countOf(byShare[byShare.length - 1].terrain),
      );
    }
  });

  it("真实素材池冒烟：3 个预设都能在 SPRITES 上抽满自己的地形请求", () => {
    for (const preset of MAP_PRESETS) {
      const requests = expandTerrainMix(preset, 20);
      for (const { terrain, count } of requests) {
        const picked = pickTerrainSprites(SPRITES, terrain, { count, seed: 2026 });
        expect(
          picked.length,
          `${preset.id} / ${terrain}：${count} 张请求只拿到 ${picked.length}`,
        ).toBe(count);
      }
    }
  });
});
