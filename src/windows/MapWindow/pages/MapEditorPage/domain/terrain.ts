/**
 * 地形语义层（R-MAP-22 S1，架构见 docs/prd/prd-map-render/map-asset-system-architecture.md §三）
 *
 * **地形不是一个「地形图」，而是一份「素材配方」**：沼泽 = 芦苇 + 水草 +
 * 浅滩 + 枯木交叉渲染。TerrainKind 是配方的钥匙——素材按 `terrains`
 * 多标签挂到配方上（见 sprites.ts），生成器按配方选材（见 terrain-assets.ts）。
 *
 * 本文件是纯枚举 + 元信息：**无 IO、无 React、无 PIXI**，vitest 直测。
 * 依赖方向铁律：本文件不得 import sprites.ts 或任何组件（sprites.ts 单向
 * import 本文件），否则守卫测试会炸。
 *
 * 新增地形准入条件（架构 §十 / §十二）：
 * 1. 至少 1 张素材挂上该 `terrains`（或回退链可达有素材的地形）；
 * 2. `fallbacks` 必须最终到达一个「有素材的地形」，且整图无环（守卫测试钉住）。
 */

/** 地形语义枚举（首版 20 项，覆盖常见地形） */
export type TerrainKind =
  // ── 陆地基本形 ──
  | "plain" // 平原
  | "grassland" // 草原
  | "hill" // 丘陵
  | "mountain" // 山地
  | "highland" // 高原
  | "valley" // 峡谷/谷地
  | "volcano" // 火山
  // ── 水系 ──
  | "river" // 河流
  | "lake" // 湖泊
  | "swamp" // 沼泽
  | "coast" // 海岸
  | "sea" // 海洋（群岛/航路）
  // ── 气候极端 ──
  | "desert" // 沙漠
  | "snowfield" // 雪原
  | "tundra" // 冻原
  | "jungle" // 丛林
  | "forest" // 森林（温带林）
  | "oasis" // 绿洲
  // ── 人文（点要素为主）──
  | "settlement" // 城郭/村落（聚落）
  | "landmark"; // 遗迹/关隘/地标

/** 单个地形的元信息 */
export interface TerrainMeta {
  /** 中文名（UI 展示用） */
  label: string;
  /**
   * 最近地形回退链（有序，不含自身）：该地形选材不足时按序向前补位。
   * 必须无环、且链尾可达一个有素材的地形（守卫测试钉住）。
   */
  fallbacks: TerrainKind[];
  /**
   * 默认地名池（热门地图与一键成图共用的批量起名底料）。
   * 优先级：预设 namePools > 素材自带 names > 本池 > 不命名。
   */
  namePool: string[];
}

/**
 * 地形元信息表。fallbacks 设计为**无环**：plain / mountain / desert / forest
 * 是四个「汇聚点」（素材最厚，无回退），其余地形沿链最终汇入其中之一。
 */
export const TERRAIN_META: Record<TerrainKind, TerrainMeta> = {
  plain: { label: "平原", fallbacks: [], namePool: ["沃野", "青野原", "安平川"] },
  grassland: { label: "草原", fallbacks: ["plain"], namePool: ["千里草场", "风草原", "白鹿原"] },
  hill: { label: "丘陵", fallbacks: ["mountain", "plain"], namePool: ["青丘", "缓坡岗", "乱石丘"] },
  mountain: { label: "山地", fallbacks: [], namePool: ["苍岭", "断云山", "黑石峰"] },
  highland: { label: "高原", fallbacks: ["mountain", "plain"], namePool: ["风塬", "荒原台地", "云顶高原"] },
  valley: { label: "峡谷", fallbacks: ["mountain", "hill"], namePool: ["幽谷", "断魂谷", "一线峡"] },
  volcano: { label: "火山", fallbacks: ["mountain"], namePool: ["赤炎山", "烬峰", "焚天岭"] },
  river: { label: "河流", fallbacks: ["lake", "plain"], namePool: ["澜江", "清川", "九曲河"] },
  lake: { label: "湖泊", fallbacks: ["plain"], namePool: ["镜湖", "碧波潭", "沉星湖"] },
  swamp: { label: "沼泽", fallbacks: ["lake", "jungle", "plain"], namePool: ["黑水泽", "瘴雾泽", "腐草淀"] },
  coast: { label: "海岸", fallbacks: ["sea", "plain"], namePool: ["白沙滩", "听涛岸", "碎礁滩"] },
  sea: { label: "海洋", fallbacks: ["plain"], namePool: ["沧溟海", "无边海", "千岛海域"] },
  desert: { label: "沙漠", fallbacks: [], namePool: ["黄沙海", "流沙漠", "死亡之海"] },
  snowfield: { label: "雪原", fallbacks: ["mountain", "plain"], namePool: ["白霜原", "冻雪原", "极北雪野"] },
  tundra: { label: "冻原", fallbacks: ["snowfield", "grassland", "plain"], namePool: ["寒苔原", "冻土荒原", "白风口"] },
  jungle: { label: "丛林", fallbacks: ["forest"], namePool: ["瘴雨林", "密林深处", "万蛇林"] },
  forest: { label: "森林", fallbacks: [], namePool: ["翠微林", "黑松林", "迷雾林"] },
  oasis: { label: "绿洲", fallbacks: ["lake", "desert"], namePool: ["月泉绿洲", "甘泉", "胡杨泽"] },
  settlement: { label: "聚落", fallbacks: ["plain"], namePool: ["荒村", "驿站", "新聚落"] },
  landmark: { label: "地标", fallbacks: ["settlement", "plain"], namePool: ["古战场", "无名遗迹", "旧邦故地"] },
};

/** 全部地形键（遍历用，顺序即枚举声明顺序） */
export const TERRAIN_KINDS = Object.keys(TERRAIN_META) as TerrainKind[];

/**
 * 判断 terrain 是否「类型收敛合法」（AI 返回值 / 外部输入的收敛口）。
 * 枚举外取值一律拒绝（架构 §八：防模型造词穿透类型系统）。
 */
export function isTerrainKind(value: unknown): value is TerrainKind {
  return typeof value === "string" && Object.hasOwn(TERRAIN_META, value);
}
