/**
 * 逻辑图层（文档层）：面板上的六行 + 它们的显隐 / 锁定状态。
 *
 * 【与 `components/MapCanvas/layers.ts` 的区别（别混）】
 *   · `MapCanvas/layers.ts` 的 `WORLD_LAYER_ORDER` 是**物理渲染栈**（z 序，8 层）：
 *     它回答"谁画在谁上面"，是渲染实现细节，用户看不见；
 *   · 本文件的 `MapLayerId` 是**逻辑内容层**（5 个可写 + 1 个只读底图）：它回答
 *     "这是什么内容、要不要看、能不能改"，是用户界面的一部分。
 *
 * 两者是**多对一**关系（例如 `region` 逻辑层对应 `regionLayer` 物理层，而
 * `base` 逻辑层对应 `staticLayer` + `coast` 两层），所以不能合并成一张表。
 * 一一对应的诱惑很大，但一旦合并，物理层增加（如 B4-2 的 `polylineLayer`）
 * 就会变成"用户面板里凭空多出一行"。
 *
 * 【为什么层集合是常量、不进文档】见 PRD D3：层的集合由**能力**决定，不是用户数据。
 * 结构进文档就要迁移，还要处理"文档里有而代码没有的层"。文档里只存**状态**
 * （`MapDocument.layerState`），且零写入（老文档不写值）。
 */

/**
 * 可写逻辑层的 id（**顺序即面板顺序**）。
 *
 * `base` 不在其中：它不可写（底图关不掉，只能换），面板上以只读行呈现。
 */
export const MAP_LAYER_IDS = ["region", "polyline", "element", "submap", "label"] as const;

/** 可写逻辑层 id */
export type MapLayerId = (typeof MAP_LAYER_IDS)[number];

/** 面板行 id（比可写层多一个只读的 `base`） */
export type MapLayerRowId = "base" | MapLayerId;

/**
 * 单个逻辑层的用户可改状态。
 *
 * **两个字段都可选**：缺省 = 可见且未锁。用"可选 + 缺省"而不是"必填布尔"，
 * 是为了让老文档与"只动过锁、没动过眼睛"的文档都只写自己真正改过的那一项
 * （零写入原则的延伸：写进去的每一项都必须是用户真的点过）。
 */
export interface MapLayerState {
  /** `false` = 隐藏。缺省（`undefined`）= 可见 */
  visible?: boolean;
  /** `true` = 锁定。缺省（`undefined`）= 未锁 */
  locked?: boolean;
}

/** 整份文档的图层状态（只含被改过的层） */
export type MapLayerStateMap = Partial<Record<MapLayerId, MapLayerState>>;

/**
 * 面板行定义（层集合的唯一出处）。
 *
 * `readonly: true` 的行（底图）只展示不可交互 —— PRD §3.2 的理由：
 * 面板如果只列 5 行，用户会以为"底图不在图层体系里"，而底图恰恰是
 * **关不掉的那一层**；明确画成一条灰行比不显示更诚实。
 */
export interface MapLayerRow {
  id: MapLayerRowId;
  /** 行名（面板上显示） */
  label: string;
  /** 悬停提示：这一层放什么 */
  hint: string;
  /** 计数的量词（`素材 42` 里的「素材」）；`null` = 该行不显示计数 */
  unit: string | null;
  /** `true` = 只读行（无眼睛、无锁） */
  readonly: boolean;
}

/** 面板行清单（从上到下 = 从底到顶） */
export const MAP_LAYER_ROWS: readonly MapLayerRow[] = [
  {
    id: "base",
    label: "底图与海面",
    hint: "纸张、海面与海岸线。只能换底图，不能隐藏。",
    unit: null,
    readonly: true,
  },
  {
    id: "region",
    label: "区块",
    hint: "分区填充与边界。显隐与工具栏的「显示分区」是同一个开关。",
    unit: "区块",
    readonly: false,
  },
  {
    id: "polyline",
    label: "折线",
    hint: "河流、道路、山脉脊线与边界线。",
    unit: "折线",
    readonly: false,
  },
  {
    id: "element",
    label: "素材",
    hint: "山脉、森林、城郭等地形贴图。",
    unit: "素材",
    readonly: false,
  },
  {
    id: "submap",
    label: "子图",
    hint: "区块内嵌的子地图。",
    unit: "子图",
    readonly: false,
  },
  {
    id: "label",
    label: "地名",
    hint: "地名标注文字。",
    unit: "地名",
    readonly: false,
  },
];

/**
 * 图层显隐的**唯一读点**。
 *
 * ⚠️ 组件里禁止直接读 `doc.layerState?.[id]?.visible ?? true`：
 * `region` 的可见性事实源是 `doc.showRegions`（PRD D4），散着写必然有人漏掉
 * 这个分支 —— 表现为"面板眼睛是开的，画布上区块却还在"，而且只在区块被关过
 * 一次的文档里复现。
 */
export function layerVisibleOf(doc: LayerStateHost, id: MapLayerId): boolean {
  // 区块层：`showRegions` 是唯一事实源（它同时影响导出与老测试），面板只做读写入口
  if (id === "region") return doc.showRegions !== false;
  return doc.layerState?.[id]?.visible !== false;
}

/** 图层锁定的唯一读点（缺省 = 未锁） */
export function layerLockedOf(doc: LayerStateHost, id: MapLayerId): boolean {
  return doc.layerState?.[id]?.locked === true;
}

/** 读点函数需要的最小文档形状（避免 `types.ts` ↔ 本文件循环 import） */
export interface LayerStateHost {
  showRegions?: boolean;
  layerState?: MapLayerStateMap;
}

/**
 * 归一化图层状态（`migrateDoc` 用）：**只删不加**，非法项静默剔除。
 *
 * 规则：
 *   1. 非对象 / 数组 → 整个字段判为非法（返回 `null`，调用方 `delete`）；
 *   2. 未知 key（代码里不存在的层）→ 丢弃；
 *   3. `visible` / `locked` 不是布尔 → 丢弃该项；
 *   4. **`region.visible` 一律丢弃**（D4：可见性归 `showRegions`，双源必然漂移）；
 *   5. 剔完什么都不剩的空对象 → 也判为非法（不写 `{}`，老文档形状才逐字节不变）。
 *
 * 【为什么不做"补默认值"】迁移函数不替用户重排数据：缺 `visible` 就是"没动过"，
 * 补成 `true` 会让"用户从未碰过图层面板"的文档凭空多出字段。
 */
export function normalizeLayerState(raw: unknown): MapLayerStateMap | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out: MapLayerStateMap = {};

  for (const id of MAP_LAYER_IDS) {
    const entry = src[id];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const next: MapLayerState = {};
    // 区块的可见性有独立宿主（showRegions），这里写进去就成了第二个事实源
    if (id !== "region" && typeof e.visible === "boolean") next.visible = e.visible;
    if (typeof e.locked === "boolean") next.locked = e.locked;
    if (next.visible === undefined && next.locked === undefined) continue;
    out[id] = next;
  }

  return Object.keys(out).length > 0 ? out : null;
}
