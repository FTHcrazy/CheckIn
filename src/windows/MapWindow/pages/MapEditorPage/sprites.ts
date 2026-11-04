/**
 * 地形素材登记表（PNG 资源）
 *
 * 素材文件位于 `src/windows/MapWindow/assets/sprites/`（窗口自包含，
 * 遵循窗口隔离规范 AGENTS §2.2.0）。经 Vite 静态导入后自动带 hash 落盘，
 * 开发与打包期路径一致。
 *
 * 素材来源（B2 / 2.22.1 重制批 / 2.22.2 补缺批，R-MAP-22）：**52 张符号 + 4 张底图全部为 AI 生成**
 * （统一手绘水彩风格，详见同目录 `MANIFEST.json` 的逐张 prompt 与处理记录；
 * 原 6 张手绘素材已于 2.22.1 用 AI 重制替换，id 保持不变，老存档自动继承新图；
 * 2.22.2 补缺批新增沼泽/草原/雪原 8 张——地形 = 素材配方交叉渲染，
 * 扩展接入 SOP 见 docs/prd/prd-map-render/map-asset-system-architecture.md §十二）。
 * **红线：不得使用逆向目标的原始 PNG**（review §5.4）。
 *
 * 新增素材：把 PNG 放进 sprites/ 目录 → 在 SPRITES 里登记一条即可，
 * 面板会自动分组展示（按 category 归类）。
 */

import baseSeaTeal from "../../assets/sprites/base-sea-teal.webp";
import baseSeaBlue from "../../assets/sprites/base-sea-blue.webp";
import baseParchment from "../../assets/sprites/base-parchment.webp";
import baseNight from "../../assets/sprites/base-night.webp";
import forestGrove from "../../assets/sprites/forest-grove.png";
import forestLarge from "../../assets/sprites/forest-large.png";
import hillSmall from "../../assets/sprites/hill-small.png";
import mountainLarge from "../../assets/sprites/mountain-large.png";
import mountainMedium from "../../assets/sprites/mountain-medium.png";

import bridgeArch from "../../assets/sprites/bridge-arch.png";
import citadel from "../../assets/sprites/citadel.png";
import cityMajor from "../../assets/sprites/city-major.png";
import cityMid from "../../assets/sprites/city-mid.png";
import duneA from "../../assets/sprites/dune-a.png";
import duneB from "../../assets/sprites/dune-b.png";
import duneC from "../../assets/sprites/dune-c.png";
import forestDense from "../../assets/sprites/forest-dense.png";
import forestThin from "../../assets/sprites/forest-thin.png";
import gravelBarren from "../../assets/sprites/gravel-barren.png";
import greatGate from "../../assets/sprites/great-gate.png";
import hillRoundA from "../../assets/sprites/hill-round-a.png";
import hillRoundB from "../../assets/sprites/hill-round-b.png";
import hillTerraced from "../../assets/sprites/hill-terraced.png";
import lighthouse from "../../assets/sprites/lighthouse.png";
import militaryCamp from "../../assets/sprites/military-camp.png";
import mountainPass from "../../assets/sprites/mountain-pass.png";
import mountainPeak from "../../assets/sprites/mountain-peak.png";
import mountainRange from "../../assets/sprites/mountain-range.png";
import mountainStoneforest from "../../assets/sprites/mountain-stoneforest.png";
import mountainTwin from "../../assets/sprites/mountain-twin.png";
import mountainVolcano from "../../assets/sprites/mountain-volcano.png";
import oasis from "../../assets/sprites/oasis.png";
import portDock from "../../assets/sprites/port-dock.png";
import portHarbor from "../../assets/sprites/port-harbor.png";
import ruinsArch from "../../assets/sprites/ruins-arch.png";
import ruinsWall from "../../assets/sprites/ruins-wall.png";
import sailingShip from "../../assets/sprites/sailing-ship.png";
import snowPeakA from "../../assets/sprites/snow-peak-a.png";
import snowPeakB from "../../assets/sprites/snow-peak-b.png";
import snowRidge from "../../assets/sprites/snow-ridge.png";
import temple from "../../assets/sprites/temple.png";
import treeBroad from "../../assets/sprites/tree-broad.png";
import treePine from "../../assets/sprites/tree-pine.png";
import villageA from "../../assets/sprites/village-a.png";
import villageB from "../../assets/sprites/village-b.png";
import villageHut from "../../assets/sprites/village-hut.png";
import watchtower from "../../assets/sprites/watchtower.png";
import yardang from "../../assets/sprites/yardang.png";

import deadTree from "../../assets/sprites/dead-tree.png";
import grassTuft from "../../assets/sprites/grass-tuft.png";
import loneTree from "../../assets/sprites/lone-tree.png";
import reedsCluster from "../../assets/sprites/reeds-cluster.png";
import shoalPool from "../../assets/sprites/shoal-pool.png";
import snowMound from "../../assets/sprites/snow-mound.png";
import snowPine from "../../assets/sprites/snow-pine.png";
import waterWeeds from "../../assets/sprites/water-weeds.png";

import type { TerrainKind } from "./domain/terrain";
import type { SpriteZone } from "./domain/zones";

/** 素材分类（决定左侧面板分组） */
export type SpriteCategory =
  | "mountain"
  | "forest"
  | "desert"
  | "wetland"
  | "grassland"
  | "snow"
  | "settlement"
  | "harbor"
  | "ruin";

/** 单条素材定义 */
export interface SpriteDef {
  /** 稳定标识，持久化时存这个值（不存路径，避免换图后失效） */
  id: string;
  /** 展示名 */
  label: string;
  /** 分类 */
  category: SpriteCategory;
  /** 图片地址（Vite 处理后的 URL） */
  src: string;
  /**
   * 世界坐标下的基准尺寸（像素）。
   * 渲染时按此宽高 * 元素自身 scale 绘制。
   */
  baseWidth: number;
  baseHeight: number;
  /**
   * 点要素默认名池（R-MAP-22「与地名联动」）：落位即从池里挑一个
   * 未被占用的名字挂成地名，双击可改。缺省 = 纯地貌，不自动命名。
   */
  names?: string[];
  /**
   * 地形语义多标签（R-MAP-22 S1，架构 §二/§三）：决定该素材进哪些地形配方。
   * **必填且非空**——漏标注 = 进不了任何配方 = 生成器静默看不到它
   * （守卫测试钉住）。多标签是常态：雪峰 ∈ 山地 + 雪原。
   */
  terrains: TerrainKind[];
  /**
   * 地貌带多标签（第三轴，见 `domain/zones.ts` 与 review §6 P0-1）：
   * 同一地形在不同气候下用哪一族画风。**必填且非空**——缺省会让「雪原长
   * 阔叶树、沙漠长针叶林」重新出现（守卫测试钉住）。
   *
   * 标注口径：
   *   · 人文 / 港渡 / 遗迹 → 只标 `core`（任何气候都成立，core 即通用池）；
   *   · 沙丘 / 绿洲 / 风蚀岩 / 石林 → `desert`；
   *   · 雪峰 / 雪岭 / 雪松 / 雪丘 → `snow`；
   *   · 圆丘 / 梯田 / 阔叶 / 草丛 / 疏树 → `grass`；
   *   · 其余山地林木 → `core`（主池，全带首选）。
   */
  zones: SpriteZone[];
  /**
   * 在地形配方中的出现倾向（选材加权），缺省 1。仅当某素材应明显
   * 高频于同类时才标注，避免无依据的噪声权重。
   */
  weight?: number;
}

/** 分类展示元信息 */
export const SPRITE_CATEGORIES: { key: SpriteCategory; label: string }[] = [
  { key: "mountain", label: "山岳" },
  { key: "forest", label: "林木" },
  { key: "desert", label: "荒漠" },
  { key: "wetland", label: "沼泽" },
  { key: "grassland", label: "草原" },
  { key: "snow", label: "雪原" },
  { key: "settlement", label: "城郭" },
  { key: "harbor", label: "港渡" },
  { key: "ruin", label: "遗迹" },
];

/**
 * 素材总表（52 个符号，全部 AI 生成）。
 *
 * baseWidth/baseHeight 做了统一缩放：原始 PNG 尺寸不一，直接按原尺寸摆会
 * 出现严重比例失衡。这里按"视觉重量"手工归一：山 > 建筑 > 树 > 人造小品。
 */
export const SPRITES: SpriteDef[] = [
  // ── 山岳（14）──────────────────────────────────────────────
  { id: "mountain-19", label: "山（大）", category: "mountain", src: mountainLarge, baseWidth: 160, baseHeight: 93, terrains: ["mountain", "highland"], zones: ["core"] },
  { id: "mountain-20", label: "山（中）", category: "mountain", src: mountainMedium, baseWidth: 120, baseHeight: 70, terrains: ["mountain", "hill"], zones: ["core"] },
  { id: "hill-1", label: "小山", category: "mountain", src: hillSmall, baseWidth: 80, baseHeight: 35, terrains: ["hill", "valley"], zones: ["grass"] },
  { id: "mountain-peak", label: "尖峰", category: "mountain", src: mountainPeak, baseWidth: 140, baseHeight: 135, terrains: ["mountain", "highland"], zones: ["core"] },
  { id: "mountain-twin", label: "双峰", category: "mountain", src: mountainTwin, baseWidth: 150, baseHeight: 100, terrains: ["mountain"], zones: ["core"] },
  { id: "mountain-range", label: "连绵山岭", category: "mountain", src: mountainRange, baseWidth: 200, baseHeight: 127, terrains: ["mountain", "highland"], zones: ["core"], weight: 1.5 },
  { id: "mountain-volcano", label: "火山", category: "mountain", src: mountainVolcano, baseWidth: 150, baseHeight: 120, terrains: ["volcano", "mountain"], zones: ["core"] },
  { id: "mountain-stoneforest", label: "石林", category: "mountain", src: mountainStoneforest, baseWidth: 130, baseHeight: 127, terrains: ["valley", "mountain"], zones: ["desert"] },
  { id: "snow-peak-a", label: "雪峰（大）", category: "mountain", src: snowPeakA, baseWidth: 160, baseHeight: 125, terrains: ["mountain", "snowfield"], zones: ["snow"] },
  { id: "snow-peak-b", label: "雪峰（中）", category: "mountain", src: snowPeakB, baseWidth: 125, baseHeight: 83, terrains: ["mountain", "snowfield"], zones: ["snow"] },
  { id: "snow-ridge", label: "雪岭", category: "mountain", src: snowRidge, baseWidth: 190, baseHeight: 73, terrains: ["mountain", "snowfield"], zones: ["snow"] },
  { id: "hill-round-a", label: "圆丘（大）", category: "mountain", src: hillRoundA, baseWidth: 100, baseHeight: 61, terrains: ["hill"], zones: ["grass"] },
  { id: "hill-round-b", label: "圆丘（小）", category: "mountain", src: hillRoundB, baseWidth: 75, baseHeight: 34, terrains: ["hill"], zones: ["grass"] },
  { id: "hill-terraced", label: "梯田丘陵", category: "mountain", src: hillTerraced, baseWidth: 115, baseHeight: 82, terrains: ["hill", "plain"], zones: ["grass"] },

  // ── 林木（6）──────────────────────────────────────────────
  { id: "forest-1", label: "森林", category: "forest", src: forestGrove, baseWidth: 90, baseHeight: 90, terrains: ["forest", "grassland"], zones: ["core"] },
  { id: "forest-2", label: "森林（大）", category: "forest", src: forestLarge, baseWidth: 130, baseHeight: 130, terrains: ["forest", "jungle"], zones: ["core"] },
  { id: "forest-thin", label: "森林（稀疏）", category: "forest", src: forestThin, baseWidth: 190, baseHeight: 119, terrains: ["forest", "grassland"], zones: ["core"] },
  { id: "forest-dense", label: "森林（繁密）", category: "forest", src: forestDense, baseWidth: 170, baseHeight: 159, terrains: ["forest", "jungle"], zones: ["core"] },
  { id: "tree-pine", label: "松树", category: "forest", src: treePine, baseWidth: 42, baseHeight: 86, terrains: ["forest", "snowfield"], zones: ["core", "snow"] },
  { id: "tree-broad", label: "阔叶树", category: "forest", src: treeBroad, baseWidth: 48, baseHeight: 51, terrains: ["forest", "grassland", "jungle"], zones: ["grass"] },

  // ── 荒漠（6）──────────────────────────────────────────────
  { id: "dune-a", label: "沙丘（大）", category: "desert", src: duneA, baseWidth: 140, baseHeight: 115, terrains: ["desert"], zones: ["desert"], weight: 1.5 },
  { id: "dune-b", label: "沙丘（中）", category: "desert", src: duneB, baseWidth: 110, baseHeight: 61, terrains: ["desert"], zones: ["desert"] },
  { id: "dune-c", label: "新月沙丘", category: "desert", src: duneC, baseWidth: 90, baseHeight: 37, terrains: ["desert"], zones: ["desert"] },
  { id: "oasis", label: "绿洲", category: "desert", src: oasis, baseWidth: 130, baseHeight: 103, terrains: ["oasis", "desert"], zones: ["desert"] },
  { id: "yardang", label: "风蚀岩", category: "desert", src: yardang, baseWidth: 110, baseHeight: 97, terrains: ["desert"], zones: ["desert"] },
  { id: "gravel-barren", label: "碎石荒地", category: "desert", src: gravelBarren, baseWidth: 140, baseHeight: 72, terrains: ["desert", "tundra"], zones: ["desert", "snow"] },

  // ── 城郭（7，点要素：落位自带地名）─────────────────────────
  { id: "city-major", label: "大城", category: "settlement", src: cityMajor, baseWidth: 135, baseHeight: 130, names: ["临江城", "云中城", "青石城"], terrains: ["settlement", "plain"], zones: ["core"] },
  { id: "city-mid", label: "城镇", category: "settlement", src: cityMid, baseWidth: 105, baseHeight: 66, names: ["青石镇", "柳荫镇", "河口镇"], terrains: ["settlement", "plain"], zones: ["core"] },
  { id: "citadel", label: "要塞", category: "settlement", src: citadel, baseWidth: 115, baseHeight: 82, names: ["磐石要塞", "鹰堡"], terrains: ["settlement", "mountain"], zones: ["core"] },
  { id: "village-a", label: "村落（大）", category: "settlement", src: villageA, baseWidth: 85, baseHeight: 60, names: ["杏花村", "柳溪村"], terrains: ["settlement", "plain", "grassland"], zones: ["core"] },
  { id: "village-b", label: "村落（小）", category: "settlement", src: villageB, baseWidth: 65, baseHeight: 54, names: ["石桥村", "上河村"], terrains: ["settlement", "plain", "grassland"], zones: ["core"] },
  { id: "village-hut", label: "茅屋", category: "settlement", src: villageHut, baseWidth: 45, baseHeight: 45, names: ["野店", "山间小筑"], terrains: ["settlement", "grassland", "mountain"], zones: ["core"] },
  { id: "military-camp", label: "营地", category: "settlement", src: militaryCamp, baseWidth: 95, baseHeight: 52, names: ["驻马营", "南坪大营"], terrains: ["settlement", "grassland", "plain"], zones: ["core"] },

  // ── 港渡（5，点要素；帆船是纯物件不带名）────────────────────
  { id: "port-dock", label: "码头", category: "harbor", src: portDock, baseWidth: 120, baseHeight: 98, names: ["望潮港", "白沙港"], terrains: ["coast", "river", "settlement"], zones: ["core"] },
  { id: "port-harbor", label: "海港", category: "harbor", src: portHarbor, baseWidth: 140, baseHeight: 110, names: ["鱼盐港", "千帆港"], terrains: ["coast", "sea"], zones: ["core"] },
  { id: "lighthouse", label: "灯塔", category: "harbor", src: lighthouse, baseWidth: 45, baseHeight: 148, names: ["望灯塔", "孤灯崖"], terrains: ["coast", "sea"], zones: ["core"] },
  { id: "bridge-arch", label: "石桥", category: "harbor", src: bridgeArch, baseWidth: 95, baseHeight: 65, names: ["长虹桥", "落雁桥"], terrains: ["river", "settlement"], zones: ["core"] },
  { id: "sailing-ship", label: "帆船", category: "harbor", src: sailingShip, baseWidth: 95, baseHeight: 109, terrains: ["sea", "coast", "lake"], zones: ["core"] },

  // ── 遗迹（7，点要素）───────────────────────────────────────
  { id: "ruins-wall", label: "断壁残垣", category: "ruin", src: ruinsWall, baseWidth: 95, baseHeight: 69, names: ["无名废墟", "故城遗址"], terrains: ["landmark"], zones: ["core"] },
  { id: "ruins-arch", label: "荒废石门", category: "ruin", src: ruinsArch, baseWidth: 75, baseHeight: 72, names: ["荒废石门", "旧邦之门"], terrains: ["landmark"], zones: ["core"] },
  { id: "mountain-pass", label: "关隘", category: "ruin", src: mountainPass, baseWidth: 115, baseHeight: 125, names: ["雁回关", "寒风关"], terrains: ["landmark", "mountain"], zones: ["core"] },
  { id: "great-gate", label: "雄关", category: "ruin", src: greatGate, baseWidth: 135, baseHeight: 133, names: ["铁门关", "天险雄关"], terrains: ["landmark", "mountain"], zones: ["core"] },
  { id: "watchtower", label: "哨塔", category: "ruin", src: watchtower, baseWidth: 50, baseHeight: 77, names: ["戍北哨塔", "望北台"], terrains: ["landmark", "settlement", "mountain"], zones: ["core"] },
  { id: "temple", label: "山神庙", category: "ruin", src: temple, baseWidth: 80, baseHeight: 75, names: ["山神庙", "古刹"], terrains: ["landmark", "mountain", "settlement"], zones: ["core"] },

  // ── 2.22.2 补缺批：沼泽 / 草原 / 雪原（地形配方选材引擎的原料缺口，见
  // docs/prd/prd-map-render/map-asset-system-architecture.md §3）──
  { id: "reeds-cluster", label: "芦苇丛", category: "wetland", src: reedsCluster, baseWidth: 110, baseHeight: 115, terrains: ["swamp", "lake", "river"], zones: ["core"], weight: 1.3 },
  { id: "water-weeds", label: "水草滩", category: "wetland", src: waterWeeds, baseWidth: 150, baseHeight: 97, terrains: ["swamp", "lake"], zones: ["core"] },
  { id: "shoal-pool", label: "浅滩水洼", category: "wetland", src: shoalPool, baseWidth: 140, baseHeight: 116, terrains: ["swamp", "lake", "river"], zones: ["core"] },
  { id: "dead-tree", label: "沼泽枯木", category: "wetland", src: deadTree, baseWidth: 95, baseHeight: 105, terrains: ["swamp"], zones: ["core"] },
  { id: "grass-tuft", label: "草丛", category: "grassland", src: grassTuft, baseWidth: 90, baseHeight: 59, terrains: ["grassland", "plain", "tundra"], zones: ["grass"] },
  { id: "lone-tree", label: "疏树", category: "grassland", src: loneTree, baseWidth: 135, baseHeight: 87, terrains: ["grassland", "plain"], zones: ["grass"] },
  { id: "snow-pine", label: "雪松", category: "snow", src: snowPine, baseWidth: 85, baseHeight: 125, terrains: ["snowfield", "tundra"], zones: ["snow"] },
  { id: "snow-mound", label: "雪丘", category: "snow", src: snowMound, baseWidth: 130, baseHeight: 69, terrains: ["snowfield", "tundra"], zones: ["snow"] },
];

/** 单条底图定义 */
export interface BaseImageDef {
  /** 稳定标识（`base-1` 恒为默认海面；历史存档按隐式默认渲染，不存该值） */
  id: string;
  /** 展示名 */
  label: string;
  src: string;
}

/**
 * 底图家族（2.22.1 起全部 AI 生成）：同一手绘水彩波纹风格下的 4 种色调。
 * `base-1` 替换原基底1.jpg（深海青绿），id 不变 → 老存档不受影响。
 * 选择器 UI 随 B3 一并落地；当前默认恒用 `BASE_IMAGE`（= base-1）。
 */
export const BASE_IMAGES: BaseImageDef[] = [
  { id: "base-1", label: "深海青绿", src: baseSeaTeal },
  { id: "base-2", label: "蔚蓝晴海", src: baseSeaBlue },
  { id: "base-3", label: "古卷羊皮", src: baseParchment },
  { id: "base-4", label: "玄夜墨海", src: baseNight },
];

/** 底图（画布背景）：恒取家族默认档 */
export const BASE_IMAGE = {
  id: "base-1",
  label: "深海青绿",
  src: baseSeaTeal,
  /** 底图在世界坐标下的尺寸（1024×1024 原图，作为画布基准） */
  width: 1024,
  height: 1024,
} as const;

/** 按 id 快速查素材 */
export const SPRITE_MAP: Record<string, SpriteDef> = Object.fromEntries(
  SPRITES.map((s) => [s.id, s]),
);
