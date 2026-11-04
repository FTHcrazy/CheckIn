/**
 * 热门地图预设登记表（R-MAP-22 S1 骨架，架构见 map-asset-system-architecture.md §七）
 *
 * 一个预设 = 一张「地形配方」：只回答**铺什么地形、各占多少**；
 * 怎么摊到画布上是 B3 生成算法的事（复用 regionSchema + LOD 体系）。
 * 热门地图 ≠ 新代码路径：预设驱动的批量 pickTerrainSprites + 落位，
 * 与用户手点素材面板共用同一套 SpriteSource。
 *
 * 纯登记表：无 IO、无 React。新增预设 = 追加一条（share 合计必须 = 1，测试钉住）。
 */

import type { TerrainKind } from "./terrain";
import type { SpriteZone } from "./zones";

/** 单个热门地图预设 */
export interface MapPresetDef {
  /** 稳定 id（如 "shiwandashan"） */
  id: string;
  /** 展示名 */
  label: string;
  /** 地形配比（share 合计 = 1，浮点容差内） */
  terrainMix: { terrain: TerrainKind; share: number }[];
  /**
   * 气候带锁定（缺省 = 按纬度渐变）。
   *
   * 缺省时整张图分四带（北雪 / 主 / 草 / 南沙），一张图上读得出"南北有差别"；
   * 声明后全图只用这一带 —— 「万里雪原」不该在南缘长出沙丘。
   */
  climate?: SpriteZone;
  /** 覆盖 TERRAIN_META 默认地名池（缺省的地形用默认池） */
  namePools?: Partial<Record<TerrainKind, string[]>>;
}

/** 首版 3 个占位预设（数值是骨架占位，B3 落地时调优） */
export const MAP_PRESETS: MapPresetDef[] = [
  {
    id: "shiwandashan",
    label: "十万大山",
    terrainMix: [
      { terrain: "mountain", share: 0.55 },
      { terrain: "forest", share: 0.3 },
      { terrain: "river", share: 0.1 },
      { terrain: "landmark", share: 0.05 },
    ],
    namePools: {
      mountain: ["黑云岭", "千丈崖", "卧虎岭", "老君山"],
      river: ["怒澜江", "黑水河"],
    },
  },
  {
    id: "nanjiang-swamp",
    label: "南疆沼泽",
    terrainMix: [
      { terrain: "swamp", share: 0.5 },
      { terrain: "jungle", share: 0.3 },
      { terrain: "river", share: 0.15 },
      { terrain: "settlement", share: 0.05 },
    ],
    namePools: {
      swamp: ["瘴雾泽", "腐骨泽", "万蛙淀"],
      settlement: ["苗寨", "青竹寨", "泽边村"],
    },
  },
  {
    id: "wanli-snowfield",
    label: "万里雪原",
    // 全图锁雪带：南缘若按纬度渐变跑成沙带，雪原上会冒出沙丘
    climate: "snow",
    terrainMix: [
      { terrain: "snowfield", share: 0.6 },
      { terrain: "mountain", share: 0.25 },
      { terrain: "tundra", share: 0.15 },
    ],
    namePools: {
      snowfield: ["极北雪野", "白霜千里原"],
      mountain: ["冰冠岭", "雪障山脉"],
    },
  },
];

/**
 * 按预设配比展开成「地形请求序列」（B3 生成算法的输入形状）：
 * share × total 取整分配（最大余数法保证合计恰为 total）。
 * 预设只回答铺什么，此函数也只做配比 → 数量的纯换算，不碰画布。
 */
export function expandTerrainMix(
  preset: MapPresetDef,
  total: number,
): { terrain: TerrainKind; count: number }[] {
  const raw = preset.terrainMix.map((m) => ({
    terrain: m.terrain,
    exact: m.share * total,
    count: Math.floor(m.share * total),
  }));
  let assigned = raw.reduce((sum, m) => sum + m.count, 0);
  // 最大余数法：把余数个名额按小数部分从大到小补齐
  const order = [...raw].sort((a, b) => (b.exact - b.count) - (a.exact - a.count));
  let cursor = 0;
  while (assigned < total) {
    order[cursor % order.length].count += 1;
    assigned += 1;
    cursor += 1;
  }
  return raw.map((m) => ({ terrain: m.terrain, count: m.count })).filter((m) => m.count > 0);
}
