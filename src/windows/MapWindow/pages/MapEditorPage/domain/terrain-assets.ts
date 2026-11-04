/**
 * 地形选材引擎（R-MAP-22 S1，架构见 map-asset-system-architecture.md §五）
 *
 * 生成器（B3）的**唯一取料口**：按地形从素材池加权随机抽取。
 * 纯函数、seed 确定性（同 seed 同结果，「换一张」= seed++）、
 * **不 import React / PIXI / sprites.ts / 任何组件**——本地打包池与
 * 用户导入池都归一成 SpriteSource 喂进来，引擎不认素材来源。
 *
 * 依赖方向铁律（守卫测试钉住）：本文件只准 import ./terrain。
 */

import { TERRAIN_META, type TerrainKind } from "./terrain";
import type { SpriteZone } from "./zones";

/** 本地素材与导入素材的公共形状（sprites.ts 的 SpriteDef 与 map_assets 归一后都满足） */
export interface SpriteSource {
  /** 稳定标识（存档存 id，不存路径） */
  id: string;
  /** 图片地址 */
  src: string;
  /** 地形语义多标签（决定进哪些配方） */
  terrains: readonly TerrainKind[];
  /**
   * 地貌带多标签（第三轴，zones.ts）：同一地形在不同气候下用哪一族画风。
   * 缺省 = `["core"]`（全带通用）—— 导入素材没标注也不会被排除，只是不参与
   * 气候分带。"人文 / 港渡 / 遗迹"这类跨气候成立的素材就该只标 core。
   */
  zones?: readonly SpriteZone[];
  /** 配方内出现倾向，缺省 1 */
  weight?: number;
  /**
   * 点要素自带名池（城郭/港渡/遗迹）：生成器据此判定"谁该带地名"。
   * 缺省 = 纯地貌，批量起名时跳过。本地登记表与导入素材（S2 标注）都带。
   */
  names?: readonly string[];
}

/** 素材的带标签（缺省 core：未标注 = 全带通用） */
export function zonesOf(source: SpriteSource): readonly SpriteZone[] {
  return source.zones && source.zones.length > 0 ? source.zones : ["core"];
}

/** 可注入的确定性随机源（mulberry32 兼容签名） */
export type Rng = () => number;

/** mulberry32：同 seed 同序列；seed 相同 ⇒ pickTerrainSprites 结果相同 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PickOptions {
  /** 期望数量（池不足时有多少给多少） */
  count: number;
  /** 确定性种子（「换一张」= seed++） */
  seed: number;
  /** 排除的素材 id（如画布上已用过的） */
  excludeIds?: readonly string[];
  /**
   * 目标地貌带（zones.ts）。缺省 = 不分带（老行为）。
   *
   * 给定后按序收窄：
   *   ① 同地形 + 本带（**带内至少 `MIN_ZONE_POOL` 张才算一族**，否则跳过）→
   *   ② 同地形 + core（通用池）→ ③ 地形回退链。
   * ①② 全空时才放开「同地形任意带」—— 此时地形本身才是气候答案
   * （core 带里的 `desert` 地形就该铺沙），不然小池会饿死。
   * 换句话说：**只要有本带素材、且它凑得成一族，就绝不跨带**。
   */
  zone?: SpriteZone;
}

/** 一个带的素材要凑到这个数才算"一族"（低于它就不分带，退回通用池） */
export const MIN_ZONE_POOL = 2;

/**
 * 按地形随机取材。
 *
 * 语义：**主地形优先、回退链补位**——先在 `terrains` 含 terrain 的素材里
 * 加权不放回抽取；不足 count 时按 `TERRAIN_META[terrain].fallbacks` 顺序
 * 逐级向前补位，直到凑满或全链耗尽（有多少给多少，不抛错）。
 * 给定 `zone` 时先按带筛一层（见 `PickOptions.zone` 的三级顺序）。
 * 池本身不被修改；excludeIds 的素材视同不存在。
 */
export function pickTerrainSprites(
  pool: readonly SpriteSource[],
  terrain: TerrainKind,
  opts: PickOptions,
): SpriteSource[] {
  const excluded = new Set(opts.excludeIds ?? []);
  const remaining = pool.filter((s) => !excluded.has(s.id));
  const rng = mulberry32(opts.seed);
  const picked: SpriteSource[] = [];
  const pickedIds = new Set<string>();

  /** 某地形在某带还有几张可选（判断凑不凑得成一族） */
  const countInZone = (kind: TerrainKind, zone: SpriteZone): number =>
    remaining.filter((s) => s.terrains.includes(kind) && zonesOf(s).includes(zone)).length;

  const takeFrom = (kind: TerrainKind, need: number, zones?: readonly SpriteZone[]): void => {
    const candidates = remaining.filter(
      (s) =>
        s.terrains.includes(kind) &&
        !pickedIds.has(s.id) &&
        (!zones || zonesOf(s).some((z) => zones.includes(z))),
    );
    for (let i = 0; i < need && candidates.length > 0; i++) {
      const total = candidates.reduce((sum, s) => sum + (s.weight ?? 1), 0);
      let r = rng() * total;
      let idx = candidates.length - 1;
      for (let j = 0; j < candidates.length; j++) {
        r -= candidates[j].weight ?? 1;
        if (r < 0) {
          idx = j;
          break;
        }
      }
      const [chosen] = candidates.splice(idx, 1);
      pickedIds.add(chosen.id);
      picked.push(chosen);
    }
  };

  if (opts.zone && opts.zone !== "core") {
    const zone = opts.zone;
    // ① 本带：**只有凑得成"一族"才用**。带内只剩一张时，"分带"会把整片地
    //    铺成同一张图（实测：沙漠带的山体只有「石林」一张，南半张图出现
    //    十二次同一块石头）。单张不构成画风，退回通用池更耐看。
    if (countInZone(terrain, zone) >= MIN_ZONE_POOL) {
      takeFrom(terrain, opts.count, [zone]);
    }
    // ② 通用池（core）：任何气候都成立
    if (picked.length < opts.count) takeFrom(terrain, opts.count - picked.length, ["core"]);
    // ③ ① ② 都**一张没有**时才放开全带。这一层不是为了"凑数"，而是因为
    //    此时答案在**地形本身**：core 带里的 `desert` 地形就该铺沙，
    //    分带不该把它饿死。反之，只要本带/core 有货，就绝不跨带。
    if (picked.length === 0) takeFrom(terrain, opts.count);
  } else {
    takeFrom(terrain, opts.count);
  }

  if (picked.length < opts.count) {
    for (const fb of TERRAIN_META[terrain].fallbacks) {
      if (picked.length >= opts.count) break;
      takeFrom(fb, opts.count - picked.length);
    }
  }
  return picked;
}
