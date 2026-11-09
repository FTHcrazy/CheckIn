import { describe, expect, it } from "vitest";
import { expandTerrainMix, randomRecipe } from "./mapRecipe";
import { flippableOf, mulberry32, pickTerrainSprites, type SpriteSource } from "./terrain-assets";
import { isTerrainKind, TERRAIN_KINDS, TERRAIN_META, type TerrainKind } from "./terrain";
import { isSpriteZone } from "./zones";
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
 *  - 随机配方 share 合计 = 1、地形键合法、山体与开阔地必出。
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

/**
 * 地貌带（第三轴，review §6 P0-1）。
 *
 * 三级顺序：① 本带（凑得成"一族"，即 ≥ `MIN_ZONE_POOL` 张）→ ② core 通用池
 * → ③ 地形回退链。①② 都空时才放开「同地形任意带」。
 */
describe("pickTerrainSprites × 地貌带", () => {
  const ZONED: SpriteSource[] = [
    { id: "peak-snow-a", src: "a.png", terrains: ["mountain"], zones: ["snow"] },
    { id: "peak-snow-b", src: "bb.png", terrains: ["mountain"], zones: ["snow"] },
    { id: "peak-core", src: "b.png", terrains: ["mountain"], zones: ["core"] },
    { id: "peak-desert", src: "c.png", terrains: ["mountain"], zones: ["desert"] },
    { id: "peak-legacy", src: "d.png", terrains: ["mountain"] }, // 未标带 = core
  ];

  it("带内素材够用时只用本带（不掺主池，否则等于没分带）", () => {
    const pool: SpriteSource[] = [
      { id: "snow-a", src: "a.png", terrains: ["mountain"], zones: ["snow"] },
      { id: "snow-b", src: "b.png", terrains: ["mountain"], zones: ["snow"] },
      { id: "core-a", src: "c.png", terrains: ["mountain"], zones: ["core"] },
    ];
    const picked = pickTerrainSprites(pool, "mountain", { count: 2, seed: 4, zone: "snow" });
    expect(picked.map((s) => s.id).sort()).toEqual(["snow-a", "snow-b"]);
  });

  it("本带只凑到两张时用 core 补位，绝不跨到别的带", () => {
    const picked = pickTerrainSprites(ZONED, "mountain", { count: 3, seed: 4, zone: "snow" });
    const ids = picked.map((s) => s.id);
    expect(ids).toHaveLength(3); // 两张雪 + 一张 core（core / 未标带的 legacy 之一）
    expect(ids.filter((id) => id.startsWith("peak-snow"))).toHaveLength(2);
    expect(ids.filter((id) => id === "peak-desert")).toHaveLength(0);
    expect(ids.some((id) => id === "peak-core" || id === "peak-legacy")).toBe(true);
  });

  it("本带只有一张 ≠ 一族：不用它，退回通用池（否则整片地铺同一张图）", () => {
    const lonely: SpriteSource[] = [
      { id: "only-snow", src: "a.png", terrains: ["mountain"], zones: ["snow"] },
      { id: "core-a", src: "b.png", terrains: ["mountain"], zones: ["core"] },
    ];
    const picked = pickTerrainSprites(lonely, "mountain", { count: 2, seed: 2, zone: "snow" });
    expect(picked.map((s) => s.id)).toEqual(["core-a"]);
  });

  it("本带 + core 都不够时才放开全带（小池不饿死）", () => {
    const tiny: SpriteSource[] = [
      { id: "only-desert", src: "d.png", terrains: ["mountain"], zones: ["desert"] },
    ];
    const picked = pickTerrainSprites(tiny, "mountain", { count: 2, seed: 1, zone: "snow" });
    expect(picked.map((s) => s.id)).toEqual(["only-desert"]);
  });

  it("不传 zone = 老行为（五张全可用）", () => {
    const picked = pickTerrainSprites(ZONED, "mountain", { count: 5, seed: 9 });
    expect(picked).toHaveLength(5);
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

  it("SPRITES 每条 zones 非空且合法（漏标 = 分带静默失效）", () => {
    for (const sprite of SPRITES) {
      expect(sprite.zones.length, `${sprite.id} 未标注 zones`).toBeGreaterThan(0);
      for (const z of sprite.zones) {
        expect(isSpriteZone(z), `${sprite.id} 含非法地貌带 ${String(z)}`).toBe(true);
      }
    }
  });

  it("三个带都有专属素材（否则分带等于只有主池）", () => {
    for (const zone of ["snow", "grass", "desert"] as const) {
      const own = SPRITES.filter((s) => !s.zones.includes("core") && s.zones.includes(zone));
      expect(own.length, `${zone} 带没有专属素材`).toBeGreaterThanOrEqual(2);
    }
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

describe("守卫：随机配方（2.45.0 取代「热门地图」预设）", () => {
  /** 山体族：这三档不进任何内容类目，由「山体」密度档单独控制 */
  const MOUNTAIN_FAMILY: TerrainKind[] = ["mountain", "highland", "volcano"];

  it("同 seed 同配方；share 合计 = 1；地形键合法且份额为正", () => {
    const a = randomRecipe(20261109);
    expect(randomRecipe(20261109)).toEqual(a);
    const sum = a.terrainMix.reduce((acc, m) => acc + m.share, 0);
    expect(sum).toBeCloseTo(1, 9);
    for (const m of a.terrainMix) {
      expect(isTerrainKind(m.terrain), `含非法地形 ${m.terrain}`).toBe(true);
      expect(m.share).toBeGreaterThan(0);
    }
  });

  it("真的在随机：不同 seed 抽出不同配比（不是一个换了名字的固定表）", () => {
    const signatures = new Set(
      Array.from({ length: 16 }, (_, i) => JSON.stringify(randomRecipe(i + 1).terrainMix)),
    );
    expect(signatures.size).toBeGreaterThan(8);
  });

  it("每张图都有骨架：山体族 + 开阔地 + 水系必出（否则图没有构图也没有水）", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const kinds = randomRecipe(seed).terrainMix.map((m) => m.terrain);
      expect(kinds.some((t) => MOUNTAIN_FAMILY.includes(t)), `seed=${seed} 无山体`).toBe(true);
      expect(
        kinds.some((t) => t === "plain" || t === "grassland"),
        `seed=${seed} 无开阔地`,
      ).toBe(true);
      expect(kinds.some((t) => t === "river" || t === "lake"), `seed=${seed} 无水系`).toBe(true);
    }
  });

  it("expandTerrainMix：合计恰为 total，配比方向正确", () => {
    const recipe = randomRecipe(2026);
    for (const total of [1, 7, 20, 100]) {
      const expanded = expandTerrainMix(recipe, total);
      const sum = expanded.reduce((s, m) => s + m.count, 0);
      expect(sum).toBe(total);
      // 最大份额地形拿到的数量不少于最小份额地形
      const byShare = [...recipe.terrainMix].sort((a, b) => b.share - a.share);
      const countOf = (t: string) => expanded.find((m) => m.terrain === t)?.count ?? 0;
      expect(countOf(byShare[0].terrain)).toBeGreaterThanOrEqual(
        countOf(byShare[byShare.length - 1].terrain),
      );
    }
  });

  it("真实素材池冒烟：三种随机配方都能在 SPRITES 上抽满自己的地形请求", () => {
    for (const recipe of [randomRecipe(1), randomRecipe(2), randomRecipe(3)]) {
      const requests = expandTerrainMix(recipe, 20);
      for (const { terrain, count } of requests) {
        const picked = pickTerrainSprites(SPRITES, terrain, { count, seed: 2026 });
        expect(
          picked.length,
          `${recipe.id} / ${terrain}：${count} 张请求只拿到 ${picked.length}`,
        ).toBe(count);
      }
    }
  });
});

describe("flippableOf · 镜像翻转元数据（P1-4）", () => {
  it("缺省即可翻（自然地貌没有『正面』，逐条登记 flippable 是负担）", () => {
    expect(flippableOf({ id: "m1", src: "m1.png", terrains: ["mountain"] })).toBe(true);
  });

  it("显式 false 才不可翻（有朝向的人造物 / 文字类）；其余值一律按可翻", () => {
    expect(flippableOf({ id: "ship", src: "s.png", terrains: ["sea"], flippable: false })).toBe(
      false,
    );
    // 语义是"缺省开、显式 false 关"：素材登记表是源码受控数据，不是用户数据，
    // 与 elementFlipXOf（读旧存档、严格 === true）的兜底方向刻意不同 ——
    // 脏值宁多翻不漏翻，漏翻会让"破重复"静默失效。
    expect(
      flippableOf({ id: "x", src: "x.png", terrains: ["mountain"], flippable: 0 as unknown as boolean }),
    ).toBe(true);
  });

  it("真实素材池守卫：不可翻的只能是有朝向的人造物（港渡 / 门洞类）", () => {
    // 白名单钉住意图：谁不可翻必须是有意的（新增素材默认可翻，
    // 要登记 false 就得来这里改白名单，防止"随手一标"把整族地貌钉死）
    const NON_FLIPPABLE = new Set([
      "port-dock",
      "port-harbor",
      "bridge-arch",
      "sailing-ship",
      "ruins-arch",
      "mountain-pass",
      "great-gate",
    ]);
    const actual = new Set(SPRITES.filter((s) => s.flippable === false).map((s) => s.id));
    expect([...actual].sort()).toEqual([...NON_FLIPPABLE].sort());
  });
});
