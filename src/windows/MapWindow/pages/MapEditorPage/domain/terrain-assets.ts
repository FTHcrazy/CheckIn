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

/** 本地素材与导入素材的公共形状（sprites.ts 的 SpriteDef 与 map_assets 归一后都满足） */
export interface SpriteSource {
  /** 稳定标识（存档存 id，不存路径） */
  id: string;
  /** 图片地址 */
  src: string;
  /** 地形语义多标签（决定进哪些配方） */
  terrains: readonly TerrainKind[];
  /** 配方内出现倾向，缺省 1 */
  weight?: number;
  /**
   * 点要素自带名池（城郭/港渡/遗迹）：生成器据此判定"谁该带地名"。
   * 缺省 = 纯地貌，批量起名时跳过。本地登记表与导入素材（S2 标注）都带。
   */
  names?: readonly string[];
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
}

/**
 * 按地形随机取材。
 *
 * 语义：**主地形优先、回退链补位**——先在 `terrains` 含 terrain 的素材里
 * 加权不放回抽取；不足 count 时按 `TERRAIN_META[terrain].fallbacks` 顺序
 * 逐级向前补位，直到凑满或全链耗尽（有多少给多少，不抛错）。
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

  const takeFrom = (kind: TerrainKind, need: number): void => {
    const candidates = remaining.filter(
      (s) => s.terrains.includes(kind) && !pickedIds.has(s.id),
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

  takeFrom(terrain, opts.count);
  if (picked.length < opts.count) {
    for (const fb of TERRAIN_META[terrain].fallbacks) {
      if (picked.length >= opts.count) break;
      takeFrom(fb, opts.count - picked.length);
    }
  }
  return picked;
}
