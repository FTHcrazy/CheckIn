/**
 * 地图文档 store（模块级 zustand 单例）。
 *
 * 持有**文档本身**与撤销/重做栈，暴露全部会改变文档的编辑动作。
 *
 * ── 为什么从 useMapEditor 的 useState 迁到独立 store ──
 * 拆分前全部状态塞在一个 hook 里：doc / viewport / 选中态 / 撤销栈六七个
 * useState 平铺，任何一个变化都触发整棵树重渲染。拆开后：
 *   · 滚轮缩放只动 viewport store，不再惊动文档树；
 *   · 选中态只在选择/删除时变化，不再跟着每次缩放重渲染；
 *   · 文档编辑只动本 store，撤销/重做的账目与视图状态彻底解耦。
 *
 * 边界（对齐项目 useNovelEditorStore 范式）：
 *   · 本 store 不认识 viewport / selection store 以外的任何东西；
 *   · 跨 store 依赖用 getState() 现取现用，不闭包捕获（避免 React 闭包陷阱）；
 *   · 提供 resetMapDocStore() 供测试与「即关即销」窗口销毁时复位。
 */
import { create } from "zustand";
import {
  createElementId,
  createEmptyDocument,
  createLabelId,
  createPolylineId,
  docPolylines,
  ELEMENT_OPACITY_MAX,
  ELEMENT_OPACITY_MIN,
  ELEMENT_TINT_NONE,
  LABEL_ABOVE_ELEMENT,
  LABEL_DEFAULT_SIZE,
  type MapDocument,
  type MapElement,
  type MapLabel,
  type MapLabelSize,
  type MapLand,
  type MapPolyline,
  type MapStyle,
  type MapSubmap,
  type TerrainBandGrid,
} from "../types";
import type { MapRegion, RegionLevelDef } from "../regions";
import { applyMerge, planMerge } from "../regionEdit";
import { layerLockedOf, layerVisibleOf } from "../layerState";
import type { MapLayerId, MapLayerState } from "../layerState";

/** 撤销栈最大深度（PRD §4.8） */
const HISTORY_LIMIT = 50;

/**
 * 复制 / 粘贴的落位偏移（世界单位）。
 *
 * 【为什么不是 0】原地覆盖式粘贴会让"新的一份"与"旧的那份"完全重叠，
 * 用户看不见粘贴发生了（还以为没反应）；斜移 16 个世界单位让副本一眼可辨。
 * 【为什么是固定值而不是按粘贴次数累加】"连续粘贴摆森林"的真实节奏是
 * 粘贴 → 拖到位置 → 再粘贴；线性累加会在第五份时偏出半个屏幕，反而难找。
 */
export const ELEMENT_PASTE_OFFSET = 16;

/** 素材缩放的合法区间（属性面板滑杆也用同一份，见 ElementPanel） */
export const ELEMENT_SCALE_MIN = 0.4;
export const ELEMENT_SCALE_MAX = 3;

/**
 * 层级配置编辑的**合并键**（架构 §2.4.1）。
 *
 * 同一次「打开配置面板连续调参」里的每一次编辑都带这个键 ⇒ 只压一步快照；
 * 换动作（生成 / 任何无键 commit）、失焦断键、撤销 / 重做都会把它清空。
 */
export const REGION_SCHEMA_COMMIT_KEY = "regionSchema";

/**
 * 撤销栈条目 —— 一次编辑**之前**的文档快照。
 *
 * 只存会进历史的字段（素材 / 区块 / 陆地 / 标注 / 风格 / 分区开关 / 底图）：
 * version 是结构版本号，不可变，存进去只会让每步快照多占内存。
 *
 * 【底图为什么进了撤销栈（B3）】底图选择器落地后 `baseImageId` 可变，
 * 且它直接影响画面（成品图导出也带着它）——用户会期望"切错了能撤销"，
 * 与 `style` / `showRegions` 同一档。老快照形状不受影响：字段从本次起才写入。
 *
 * 【扩容几乎是零成本的】数组与对象是**引用共享**的：没被改动的字段在快照里
 * 只是同一个引用，不会复制一份。
 */
export interface DocSnapshot {
  elements: MapElement[];
  regions: MapDocument["regions"];
  land: MapLand | null;
  labels: MapLabel[];
  style: MapStyle;
  showRegions: boolean;
  baseImageId: string;
  /**
   * 层级定义（★ R-REG-01 新增）：schema 也进撤销栈。
   *
   * 【为什么必须进】PRD R-REG-01 验收④「撤销一次可回退 schema 修改」。
   * 它是文档内容（会持久化、会影响下次生成），不属于"视图状态"，
   * 与 `style` / `showRegions` 同一档。
   */
  regionSchema: MapDocument["regionSchema"];
  /**
   * 图层显隐 / 锁定（★ B4-1 新增）。
   *
   * 【为什么进撤销栈】PRD §3.4 明写"眼睛切换记一步"：关掉素材层是**看得见**的
   * 画面变化，切错了要能撤销 —— 与 `showRegions` 同一档。
   *
   * 【但它是唯一一个"UI 状态"进历史的字段】它不像对象那样参与成批快照
   * （没有"选中一批改属性"的语义），每次切换就是独立一步，因此不需要合并键。
   */
  layerState: MapDocument["layerState"];
  /**
   * 折线（★ B4-2 新增）。
   *
   * 【为什么必须进快照】PRD §6-B4-2 验收⑤明确要求"落线一步、拖节点一步、删线一步"：
   * 折线是**文档内容**（会落库、会导出），漏进快照就会出现"画了一条河，
   * Ctrl+Z 之后线还在、素材却回退了"这种半截撤销。
   *
   * 【与 `layerState` 的相同点】同样是可选字段：撤销可能回到"根本没有折线这一项"
   * 的老文档形状，写回时按 `undefined` 删键（见 `applySnapshot`）。
   */
  polylines: MapDocument["polylines"];
}

function snapshotOf(doc: MapDocument): DocSnapshot {
  return {
    elements: doc.elements,
    regions: doc.regions,
    land: doc.land,
    labels: doc.labels,
    style: doc.style,
    showRegions: doc.showRegions,
    baseImageId: doc.baseImageId,
    regionSchema: doc.regionSchema,
    layerState: doc.layerState,
    polylines: doc.polylines,
  };
}

/** 把快照写回文档（撤销 / 重做共用） */
function applySnapshot(doc: MapDocument, snap: DocSnapshot): MapDocument {
  const next: MapDocument = {
    ...doc,
    elements: snap.elements,
    regions: snap.regions,
    land: snap.land,
    labels: snap.labels,
    style: snap.style,
    showRegions: snap.showRegions,
    baseImageId: snap.baseImageId,
    // ⚠️ 撤销回"改前"意味着可能回到 `undefined`（老文档从未写过这个字段），
    // 不能用 `?? DEFAULT_REGION_SCHEMA` 兜底 —— 那会凭空造出一次"文档内容变更"。
    regionSchema: snap.regionSchema,
  };
  if (snap.layerState === undefined) {
    // 展开语法会把 `layerState: undefined` 写成**存在的键**。落库时 JSON 会把它
    // 丢掉，所以字节不变；但"有没有这个键"本身就是零写入判据，内存里也不该
    // 出现一个假的空字段（`Object.keys(doc)` 会因此多一项）。
    delete next.layerState;
  } else {
    next.layerState = snap.layerState;
  }
  // 折线同理：撤销回"从没画过线"的文档时，`polylines` 键必须整个消失（零写入）。
  if (snap.polylines === undefined) delete next.polylines;
  else next.polylines = snap.polylines;
  return next;
}

/**
 * 改一个逻辑层的状态，并**顺手清掉恢复默认的字段**。
 *
 * 【为什么要清】面板上"眼睛点两下"回到可见、"锁点两下"回到未锁，是用户眼里
 * 的"什么也没做"。若照写 `{visible: true}`，文档会凭空多出一个字段 ——
 * 一两次无所谓，成百次切换后每份存档都躺着一堆 `{visible: true}`。
 * 语义上 `visible` 缺省就是 `true`（见 `MapLayerState`），删掉与写 `true` 等价。
 *
 * 整份 `layerState` 空掉时连字段一起删：老文档形状与"从没碰过面板"保持一致。
 */
function withLayerState(
  doc: MapDocument,
  id: MapLayerId,
  patch: MapLayerState,
): MapDocument {
  const next: MapLayerState = { ...doc.layerState?.[id], ...patch };
  if (next.visible !== false) delete next.visible;
  if (next.locked !== true) delete next.locked;

  const map = { ...doc.layerState };
  if (next.visible === undefined && next.locked === undefined) delete map[id];
  else map[id] = next;

  const out: MapDocument = { ...doc, layerState: map };
  if (Object.keys(map).length === 0) delete out.layerState;
  return out;
}

interface MapDocState {
  doc: MapDocument;
  undoStack: DocSnapshot[];
  redoStack: DocSnapshot[];
  /**
   * 上一次 commit 用的合并键（`null` = 没有可合并的上下文）。
   *
   * 见 `commit` 的注释与架构 §2.4.1 / §6-8：**四处必须清空**（`undo` / `redo` /
   * `commitDragStart` / `resetMapDocStore`），漏一处的表现是"撤销之后改 schema
   * 不压快照"，且只在特定顺序下复现。
   */
  lastCommitKey: string | null;

  /**
   * 提交一次文档变更（自动入撤销栈）。所有会改变文档的操作都必须走这里。
   *
   * @param coalesceKey 与**上一次** commit 的键相同 ⇒ 不压新快照（第一次已经
   *   记了"改前"）。不传 = 压新快照并把键清空（异类动作天然断键）。
   */
  commit: (mutate: (doc: MapDocument) => MapDocument, coalesceKey?: string) => void;
  /**
   * 主动断掉合并键（失焦 / 关闭配置面板时调）。
   *
   * 【为什么需要它】合并键解决的是"一次连续调参只占一步撤销"，但"连续"的边界
   * 是**交互动作**而不是时间：改完名称、失焦去看画面，再回来改数量，应该是两步。
   * 断键把这件事写成一次显式调用，而不是靠计时器猜（架构 §2.4.1 备选 C 的反例）。
   */
  breakCommitKey: () => void;
  undo: () => void;
  redo: () => void;
  /** 拖拽结束：把起始位置压入撤销栈（拖拽全程只记一次） */
  commitDragStart: (doc: MapDocument) => void;

  placeSprite: (spriteId: string, world: { x: number; y: number }, currentLevel: number | null) => string;
  moveElementBy: (id: string, dxWorld: number, dyWorld: number) => void;
  removeSelected: (selectedId: string | null) => void;
  clearAll: () => void;

  /**
   * 改单个素材的属性（R-MAP-23 的唯一数据出口）。
   *
   * @param coalesceKey 属性面板滑杆连续拖动传同一个键（`el:{id}:{field}`），
   *   让"一次拖动"只占一步撤销；不传 = 每次都压新快照。
   *
   * 【为什么在这里 clamp 而不是只靠 UI】store 是文档的唯一守门人：任何调用方
   * （面板、键盘、将来的生成器）传进来的值都必须落到合法区间，否则渲染层
   * `elementOpacityOf` 的兜底会静默改写用户的输入。
   */
  updateElement: (
    id: string,
    patch: Partial<Pick<MapElement, "scale" | "rotation" | "opacity" | "tint" | "level">>,
    coalesceKey?: string,
  ) => void;
  /** 置顶 / 置底：调整素材在 `elements` 数组里的位置（渲染顺序 = 数组顺序） */
  reorderElement: (id: string, to: "front" | "back") => void;
  /** 复制一份素材（斜移落位），返回新素材 id；找不到原素材返回 null */
  duplicateElement: (id: string) => string | null;

  /**
   * 剪贴板（窗口会话级，不进撤销栈、不进文档）。
   *
   * 【为什么放 store 而不是系统剪贴板】系统剪贴板是全局共享的：在地图里 Ctrl+C
   * 一座山，去聊天框 Ctrl+V 出来的应该是山还是文字？系统语义是文字。
   * 应用内剪贴板只服务本窗口，也天然随窗口销毁。
   */
  clipboard: MapElement | MapPolyline | null;
  copyElement: (id: string) => void;
  /** 剪切 = 复制 + 删除（删除那一半自带快照，可撤销） */
  cutElement: (id: string) => void;
  /** 粘贴：落位斜移（见 `ELEMENT_PASTE_OFFSET`），返回新对象（素材或折线）的 id；剪贴板为空返回 null */
  pasteElement: () => string | null;
  /**
   * 方向键 / WASD 微移（R-MAP-25；B4-3 起折线同享）。
   *
   * 走 `moveElementBy`（联动地名一起动、不入快照）+ 合并键压撤销步：
   * 连按十次方向键应该是"一次移动"，Ctrl+Z 一步回到起点。
   */
  nudgeElement: (id: string, dxWorld: number, dyWorld: number) => void;

  regenerateHierarchy: (regions: MapDocument["regions"]) => void;

  /**
   * 一键成图（B3）：把生成器产物**一次性**写进文档 —— 陆地 / 素材 / 地名 /
   * 区块同属一次 commit，撤销一步全回来（review §5.3：生成是"一个动作"）。
   *
   * @param parts 各部件均为可选：五档局部重掷只传要替换的那部分，
   *   未传的保持原样（如「只换素材」不传 regions，区块纹丝不动）。
   */
  applyGenerated: (parts: {
    land?: MapLand;
    elements?: MapElement[];
    labels?: MapLabel[];
    regions?: MapDocument["regions"];
    /**
     * 地貌纹理带（2.43.0）。`undefined` = 保持原样（局部重掷没重算它）；
     * `null` = **显式清除**（骨架档 / 陆地未生成时，纹理不能留着旧陆地的带）。
     */
    bands?: TerrainBandGrid | null;
    /**
     * 自动水系折线（2.44.0）。`undefined` = 保持原样；数组 = **替换上一批自动线**，
     * 用户手画的线（`origin !== "generated"`）原样保留。
     */
    polylines?: MapPolyline[];
  }) => void;
  /**
   * 批量改写「生成素材」的联动地名（「只换地名」档）。
   *
   * 一次 commit 完成"删旧 + 建新"：先摘掉这批素材身上的旧联动标注
   * （手动标注与其余联动不动），再按素材当前坐标重建。空文本跳过。
   */
  relabelElements: (entries: readonly { elementId: string; text: string }[]) => void;
  /** 换底图（B3 底图选择器；进撤销栈，见 DocSnapshot.baseImageId） */
  setBaseImage: (id: string) => void;

  /**
   * 追加一个**已经构造好**的区块（手画落库，R-REG-03）。
   *
   * 【为什么 store 不自己构造】名字 / 取色 / 序号 / 质心全是确定性派生，
   * 且要读 `schema`、要跑几何校验 —— 那是编排层（`useMapEditor`）的职责。
   * store 只做"追加进文档 + 记一步快照"这一件纯数据的事。
   */
  addRegion: (region: MapRegion) => void;
  clearRegions: () => void;
  generateLand: (land: MapLand, regions: MapDocument["regions"], polylines?: MapPolyline[]) => void;
  clearLand: () => void;
  toggleRegions: () => void;
  /**
   * 设置某逻辑层的可见性。
   *
   * `region` **不写 `layerState`**，而是转成 `showRegions`（B4 PRD D4）：
   * 它已经是区块可见性的唯一事实源（工具栏开关、导出、老测试都认它），
   * 双写必然漂移 —— 表现为"面板眼睛是开的，画布上区块却不见了"。
   */
  setLayerVisible: (id: MapLayerId, visible: boolean) => void;
  /** 切换某逻辑层的可见性（面板眼睛的唯一出口） */
  toggleLayerVisible: (id: MapLayerId) => void;
  /**
   * 设置某逻辑层的锁定。
   *
   * 锁定**不改变渲染**（PRD §8-4）：它只让命中测试、框选、删除跳过该层。
   */
  setLayerLocked: (id: MapLayerId, locked: boolean) => void;

  /* ───────────── 折线（B4-2 / R-MAP-26）───────────── */

  /**
   * 追加一条折线。
   *
   * 【为什么 id 与几何都由调用方给定】与 `addRegion` 同一分工：构造（id、
   * 控制点、默认样式）是编排层的职责，store 只做"追加 + 记一步快照"。
   */
  addPolyline: (polyline: MapPolyline) => void;
  /**
   * 改折线的非几何属性（样式 / 语义 / 层级 / 标签 / 线宽倍数）。
   *
   * @param coalesceKey 属性面板连续拖动传同一个键，让"一次拖动"只占一步撤销。
   *   几何（`points` / `closed`）**不从这里改** —— 拖节点走 `movePolylinePoint`
   *   （高频、不入快照），增删点走下面两个专用动作（低频、各记一步）。
   */
  updatePolyline: (
    id: string,
    patch: Partial<Pick<MapPolyline, "styleId" | "kind" | "level" | "label" | "closed" | "widthScale">>,
    coalesceKey?: string,
  ) => void;
  removePolyline: (id: string) => void;
  /**
   * 移动一个控制点（拖拽中高频调用，**不入撤销栈**）。
   *
   * 快照在拖拽开始时由 `commitDragStart(doc)` 记一次 —— 与素材拖拽完全同款：
   * 若每个 pointermove 都压快照，一次拖动会吃掉 50 步撤销深度（栈上限）。
   */
  movePolylinePoint: (id: string, index: number, world: { x: number; y: number }) => void;
  /** 在 `index` 位置**插入**一个控制点（双击线段；一步撤销） */
  insertPolylinePoint: (id: string, index: number, point: { x: number; y: number }) => void;
  /**
   * 删除第 `index` 个控制点（双击节点；一步撤销）。
   *
   * 删到只剩 < 2 点时**整条线一起删**：一个点的"线"画不出来，留着它只会在
   * 面板计数里变成一个点不中、看不见的幽灵对象。
   */
  deletePolylinePoint: (id: string, index: number) => void;

  setStyle: (next: MapStyle) => void;
  addLabel: (input: {
    x: number;
    y: number;
    text: string;
    level: number | null;
    size?: MapLabelSize;
  }) => string | null;
  updateLabel: (
    id: string,
    patch: Partial<Pick<MapLabel, "text" | "x" | "y" | "size" | "level">>,
  ) => void;
  removeLabel: (id: string) => void;
  setElementLabel: (elementId: string, text: string, size?: MapLabelSize) => void;

  /**
   * 把一张子地图绑定到某个区块（路径 A：先生成小图再嵌入）。
   *
   * 子图内容由调用方构造好（来自外部地图 / 现场生成），这里只做「挂到区块」的
   * 纯数据操作 + 入撤销栈。`submap` 是独立坐标系 + 独立内容的完整小地图。
   * `enterScale` 可选：子图渐入阈值（缺省 = 调用方不写，渲染层按区块自动反推）。
   */
  embedSubmap: (regionId: string, submap: MapSubmap, enterScale?: number) => void;
  /**
   * 移除某个区块上的子图（恢复为普通区块）。`undefined` / 找不到区块时静默。
   */
  removeSubmap: (regionId: string) => void;

  /**
   * 合并子树：删 `rootId` 的**全部后代**，root 自身字段与引用不变（PRD §6-C）。
   *
   * @returns `removed` = 被删除的后代数（**不含 root**）；`withSubmap` = 其中带子图的数量。
   *   叶子 / id 不存在 ⇒ `{removed:0, withSubmap:0}` 且**不产生快照**（不能给用户
   *   留一步"按了撤销但画面没变"的空步）。
   */
  mergeSubtree: (rootId: string) => { removed: number; withSubmap: number };

  /**
   * 改写层级定义（R-REG-01）。走合并键：同一配置面板连续编辑只压一步快照。
   *
   * @param pruneLevelsAbove 可选：同时删除 `level >= pruneLevelsAbove` 的区块
   *   （"减少层数"的那条路径，PRD §4.1 边界④）。
   *   **必须与 schema 同一个 commit** —— 否则"删区块"与"改配置"各占一步撤销，
   *   用户按一次 Ctrl+Z 会看到"区块回来了但层级数还是新的"这种半截状态。
   */
  setRegionSchema: (
    schema: RegionLevelDef[],
    pruneLevelsAbove?: number,
  ) => void;
}

export const useMapDocStore = create<MapDocState>()((set, get) => ({
  doc: createEmptyDocument(),
  undoStack: [],
  redoStack: [],
  lastCommitKey: null,
  clipboard: null,

  commit: (mutate, coalesceKey) => {
    set((state) => {
      const prev = state.doc;
      // 键相同 = 同一次连续编辑的后续步骤：**只改文档，不再压快照**
      // （第一步已经记下了"这一串编辑之前"的状态）
      const coalesce = coalesceKey !== undefined && coalesceKey === state.lastCommitKey;
      const nextUndo = coalesce ? state.undoStack : [...state.undoStack, snapshotOf(prev)];
      return {
        doc: mutate(prev),
        undoStack: nextUndo.length > HISTORY_LIMIT ? nextUndo.slice(-HISTORY_LIMIT) : nextUndo,
        // 新编辑一律作废重做链（与既有行为一致）
        redoStack: [],
        lastCommitKey: coalesceKey ?? null,
      };
    });
  },

  breakCommitKey: () => {
    if (get().lastCommitKey === null) return;
    set({ lastCommitKey: null });
  },

  undo: () => {
    const { undoStack, doc } = get();
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    set({
      doc: applySnapshot(doc, prev),
      undoStack: undoStack.slice(0, -1),
      redoStack: [...get().redoStack, snapshotOf(doc)],
      // 架构 §6-8：撤销后必须断键，否则"撤销 + 接着改 schema"会被并进上一步
      lastCommitKey: null,
    });
  },

  redo: () => {
    const { redoStack, doc } = get();
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    const mergedUndo = [...get().undoStack, snapshotOf(doc)];
    set({
      doc: applySnapshot(doc, next),
      undoStack: mergedUndo.length > HISTORY_LIMIT ? mergedUndo.slice(-HISTORY_LIMIT) : mergedUndo,
      redoStack: redoStack.slice(0, -1),
      // 架构 §6-8：重做后断键（同 undo 的理由）
      lastCommitKey: null,
    });
  },

  commitDragStart: (doc) => {
    set((state) => {
      const next = [...state.undoStack, snapshotOf(doc)];
      return {
        undoStack: next.length > HISTORY_LIMIT ? next.slice(-HISTORY_LIMIT) : next,
        redoStack: [],
        // 架构 §6-8：拖拽开始是一次独立的编辑动作 ⇒ 断键
        lastCommitKey: null,
      };
    });
  },

  placeSprite: (spriteId, world, currentLevel) => {
    const element: MapElement = {
      id: createElementId(),
      spriteId,
      x: world.x,
      y: world.y,
      scale: 1,
      rotation: 0,
      level: currentLevel,
    };
    get().commit((d) => ({ ...d, elements: [...d.elements, element] }));
    return element.id;
  },

  moveElementBy: (id, dxWorld, dyWorld) => {
    set((state) => {
      const prev = state.doc;
      return {
        doc: {
          ...prev,
          elements: prev.elements.map((el) =>
            el.id === id ? { ...el, x: el.x + dxWorld, y: el.y + dyWorld } : el,
          ),
          labels:
            prev.labels.length === 0
              ? prev.labels
              : prev.labels.map((l) =>
                  l.elementId === id ? { ...l, x: l.x + dxWorld, y: l.y + dyWorld } : l,
                ),
        },
      };
    });
  },

  removeSelected: (selectedId) => {
    if (!selectedId) return;
    get().commit((d) => ({
      ...d,
      elements: d.elements.filter((el) => el.id !== selectedId),
      labels:
        d.labels.length === 0 ? d.labels : d.labels.filter((l) => l.elementId !== selectedId),
    }));
  },

  clearAll: () => {
    if (get().doc.elements.length === 0) return;
    get().commit((d) => ({
      ...d,
      elements: [],
      labels: d.labels.filter((l) => !l.elementId),
    }));
  },

  updateElement: (id, patch, coalesceKey) => {
    const target = get().doc.elements.find((el) => el.id === id);
    if (!target) return;
    // clamp 先算好：值没变就**不进 commit**，否则滑杆拖到端点时每次 onChange
    // 都会压一步"看起来什么都没变"的空撤销。
    const next: MapElement = { ...target };
    if (patch.scale !== undefined) {
      next.scale = Math.min(8, Math.max(0.1, patch.scale));
    }
    if (patch.rotation !== undefined) {
      next.rotation = ((patch.rotation % 360) + 360) % 360;
    }
    if (patch.opacity !== undefined) {
      next.opacity = Math.min(ELEMENT_OPACITY_MAX, Math.max(ELEMENT_OPACITY_MIN, patch.opacity));
    }
    if (patch.tint !== undefined) {
      next.tint = Math.min(360, Math.max(ELEMENT_TINT_NONE, patch.tint));
    }
    if (patch.level !== undefined) {
      const lv = patch.level;
      // 非法层级（负数 / 非整数）直接忽略：层级数组是按序号索引的，脏值会让
      // 渲染层的容器查找落到 undefined 上
      if (lv === null || (Number.isInteger(lv) && lv >= 0)) next.level = lv;
    }
    if (
      next.scale === target.scale &&
      next.rotation === target.rotation &&
      next.opacity === target.opacity &&
      next.tint === target.tint &&
      next.level === target.level
    ) {
      return;
    }
    get().commit(
      (d) => ({ ...d, elements: d.elements.map((el) => (el.id === id ? next : el)) }),
      coalesceKey,
    );
  },

  reorderElement: (id, to) => {
    const els = get().doc.elements;
    const idx = els.findIndex((el) => el.id === id);
    if (idx < 0) return;
    // 已经在端点上：不进 commit（同 updateElement 的"空步"防抖）
    if (to === "front" && idx === els.length - 1) return;
    if (to === "back" && idx === 0) return;
    const el = els[idx];
    const rest = els.filter((e) => e.id !== id);
    get().commit((d) => ({
      ...d,
      elements: to === "front" ? [...rest, el] : [el, ...rest],
    }));
  },

  duplicateElement: (id) => {
    // B4-3：折线与素材同一套「复制一份」（新 id + 斜移，进撤销栈一步）
    const srcLine = docPolylines(get().doc).find((p) => p.id === id);
    if (srcLine) {
      const copy: MapPolyline = {
        ...srcLine,
        id: createPolylineId(),
        points: srcLine.points.map((p) => ({ x: p.x + ELEMENT_PASTE_OFFSET, y: p.y + ELEMENT_PASTE_OFFSET })),
      };
      get().commit((d) => ({ ...d, polylines: [...docPolylines(d), copy] }));
      return copy.id;
    }
    const src = get().doc.elements.find((el) => el.id === id);
    if (!src) return null;
    const copy: MapElement = {
      ...src,
      id: createElementId(),
      x: src.x + ELEMENT_PASTE_OFFSET,
      y: src.y + ELEMENT_PASTE_OFFSET,
    };
    get().commit((d) => ({ ...d, elements: [...d.elements, copy] }));
    return copy.id;
  },

  copyElement: (id) => {
    // B4-3：素材优先（两套 id 空间不重叠，`pl_` 前缀折线不会撞上）
    const srcLine = docPolylines(get().doc).find((p) => p.id === id);
    if (srcLine) {
      // 点列要克隆：剪贴板必须与文档对象**解引用**，之后拖节点不能把剪贴板一起拖变形
      set({
        clipboard: { ...srcLine, points: srcLine.points.map((p) => ({ x: p.x, y: p.y })) },
      });
      return;
    }
    const src = get().doc.elements.find((el) => el.id === id);
    if (!src) return;
    // 浅拷贝足够：素材字段全是原始值，且文档里的元素本就不可变更新
    set({ clipboard: { ...src } });
  },

  cutElement: (id) => {
    get().copyElement(id);
    // 复制到了才删：剪贴板为空说明 id 两边都不是（切一半会留下一半的困惑）
    if (!get().clipboard) return;
    if (docPolylines(get().doc).some((p) => p.id === id)) {
      get().removePolyline(id);
      return;
    }
    get().removeSelected(id);
  },

  pasteElement: () => {
    const clip = get().clipboard;
    if (!clip) return null;
    if ("points" in clip) {
      const copy: MapPolyline = {
        ...clip,
        id: createPolylineId(),
        points: clip.points.map((p) => ({
          x: p.x + ELEMENT_PASTE_OFFSET,
          y: p.y + ELEMENT_PASTE_OFFSET,
        })),
      };
      get().commit((d) => ({ ...d, polylines: [...docPolylines(d), copy] }));
      return copy.id;
    }
    const copy: MapElement = {
      ...clip,
      id: createElementId(),
      x: clip.x + ELEMENT_PASTE_OFFSET,
      y: clip.y + ELEMENT_PASTE_OFFSET,
    };
    get().commit((d) => ({ ...d, elements: [...d.elements, copy] }));
    return copy.id;
  },

  nudgeElement: (id, dxWorld, dyWorld) => {
    // B4-3：折线整体平移 = 所有点一起动（没有"联动地名"一说 —— 折线没有联动标注）
    if (docPolylines(get().doc).some((p) => p.id === id)) {
      get().commit(
        (d) => ({
          ...d,
          polylines: docPolylines(d).map((p) =>
            p.id === id
              ? { ...p, points: p.points.map((pt) => ({ x: pt.x + dxWorld, y: pt.y + dyWorld })) }
              : p,
          ),
        }),
        `nudge:${id}`,
      );
      return;
    }
    get().commit((d) => {
      let touched = false;
      const elements = d.elements.map((el) => {
        if (el.id !== id) return el;
        touched = true;
        return { ...el, x: el.x + dxWorld, y: el.y + dyWorld };
      });
      if (!touched) return d;
      const labels =
        d.labels.length === 0
          ? d.labels
          : d.labels.map((l) =>
              l.elementId === id ? { ...l, x: l.x + dxWorld, y: l.y + dyWorld } : l,
            );
      return { ...d, elements, labels };
      // 合并键让"连按十次方向键"只占一步撤销（第一次已记下"移动前"）
    }, `nudge:${id}`);
  },

  regenerateHierarchy: (regions) => {
    if (regions.length === 0) return;
    get().commit((d) => ({ ...d, regions }));
  },

  clearRegions: () => {
    if (get().doc.regions.length === 0) return;
    get().commit((d) => ({ ...d, regions: [] }));
  },

  addRegion: (region) => {
    // 不带合并键：每次落笔都是**一次独立的编辑**。用合并键会把"连续画三块"
    // 压成一步撤销 —— 用户按 Ctrl+Z 会一口气退掉三块，与"我最后画的那块"心智不符。
    get().commit((d) => ({ ...d, regions: [...d.regions, region] }));
  },

  generateLand: (land, regions, polylines) => {
    get().commit((d) => ({
      ...d,
      land,
      regions,
      // 陆地换了，旧自动水系必须同步换（否则河留在海面上）；手画的线保留
      ...(polylines === undefined
        ? {}
        : {
            polylines: [...docPolylines(d).filter((l) => l.origin !== "generated"), ...polylines],
          }),
    }));
  },

  applyGenerated: (parts) => {
    get().commit((d) => ({
      ...d,
      ...(parts.land === undefined ? {} : { land: parts.land }),
      ...(parts.elements === undefined ? {} : { elements: parts.elements }),
      ...(parts.labels === undefined ? {} : { labels: parts.labels }),
      ...(parts.regions === undefined ? {} : { regions: parts.regions }),
      ...(parts.bands === undefined ? {} : { terrainBands: parts.bands ?? undefined }),
      // 只换自动水系：手画的线（没写 origin）与用户改过的线一律留下
      ...(parts.polylines === undefined
        ? {}
        : {
            polylines: [
              ...docPolylines(d).filter((l) => l.origin !== "generated"),
              ...parts.polylines,
            ],
          }),
    }));
  },

  relabelElements: (entries) => {
    if (entries.length === 0) return;
    get().commit((d) => {
      const ids = new Set(entries.map((e) => e.elementId));
      // 摘掉这批素材身上的旧联动标注；手动标注与其余联动原样保留
      const kept = d.labels.filter((l) => !l.elementId || !ids.has(l.elementId));
      const added: MapLabel[] = [];
      for (const e of entries) {
        const text = e.text.trim();
        if (!text) continue;
        const el = d.elements.find((el) => el.id === e.elementId);
        if (!el) continue;
        added.push({
          id: createLabelId(),
          text,
          x: el.x,
          y: el.y - LABEL_ABOVE_ELEMENT,
          size: LABEL_DEFAULT_SIZE,
          level: el.level,
          elementId: el.id,
        });
      }
      if (added.length === 0 && kept.length === d.labels.length) return d;
      return { ...d, labels: [...kept, ...added] };
    });
  },

  setBaseImage: (id) => {
    if (id === get().doc.baseImageId) return;
    get().commit((d) => ({ ...d, baseImageId: id }));
  },

  clearLand: () => {
    if (!get().doc.land) return;
    // 纹理带与水系都跟着陆地走：陆地没了，旧陆地的带栅格与自动河湖一并清掉
    // （同一步撤销快照）。手画的线保留 —— 那是用户的，不是陆地的派生物。
    get().commit((d) => ({
      ...d,
      land: null,
      terrainBands: undefined,
      polylines: docPolylines(d).filter((l) => l.origin !== "generated"),
    }));
  },

  toggleRegions: () => {
    get().commit((d) => ({ ...d, showRegions: !d.showRegions }));
  },

  setLayerVisible: (id, visible) => {
    const doc = get().doc;
    // 值没变就不进 commit：面板可能被"回车 + 点击"双触发，空步白占一格撤销栈
    if (layerVisibleOf(doc, id) === visible) return;
    if (id === "region") {
      get().commit((d) => ({ ...d, showRegions: visible }));
      return;
    }
    get().commit((d) => withLayerState(d, id, { visible }));
  },

  toggleLayerVisible: (id) => {
    get().setLayerVisible(id, !layerVisibleOf(get().doc, id));
  },

  setLayerLocked: (id, locked) => {
    if (layerLockedOf(get().doc, id) === locked) return;
    get().commit((d) => withLayerState(d, id, { locked }));
  },

  /* ───────────── 折线（B4-2）───────────── */

  addPolyline: (polyline) => {
    // 少于 2 点的"线"画不出来，也不该进文档（绘制态已拦一次，这里是最后一道）
    if (polyline.points.length < 2) return;
    get().commit((d) => ({ ...d, polylines: [...docPolylines(d), polyline] }));
  },

  updatePolyline: (id, patch, coalesceKey) => {
    if (!docPolylines(get().doc).some((p) => p.id === id)) return;
    get().commit((d) => ({
      ...d,
      polylines: docPolylines(d).map((p) => {
        if (p.id !== id) return p;
        const next = { ...p, ...patch };
        // 清标签 / 把线宽调回 1 倍 ⇒ **删键**而不是写空值（零写入原则的延伸）：
        // 否则每份存档都会带上 `label: undefined` 这类"用户其实没设过"的痕迹。
        if (next.label === undefined || next.label === "") delete next.label;
        if (next.widthScale === 1) delete next.widthScale;
        return next;
      }),
    }), coalesceKey);
  },

  removePolyline: (id) => {
    if (!docPolylines(get().doc).some((p) => p.id === id)) return;
    get().commit((d) => ({ ...d, polylines: docPolylines(d).filter((p) => p.id !== id) }));
  },

  movePolylinePoint: (id, index, world) => {
    set((state) => {
      const list = docPolylines(state.doc);
      if (!list.some((p) => p.id === id)) return {};
      return {
        doc: {
          ...state.doc,
          polylines: list.map((p) =>
            p.id === id
              ? { ...p, points: p.points.map((pt, i) => (i === index ? { x: world.x, y: world.y } : pt)) }
              : p,
          ),
        },
      };
    });
  },

  insertPolylinePoint: (id, index, point) => {
    if (!docPolylines(get().doc).some((p) => p.id === id)) return;
    get().commit((d) => ({
      ...d,
      polylines: docPolylines(d).map((p) => {
        if (p.id !== id) return p;
        // 钳到合法插入位（双击判定与采样换算之间可能差一格）
        const at = Math.min(Math.max(index, 1), p.points.length);
        const points = [...p.points.slice(0, at), { x: point.x, y: point.y }, ...p.points.slice(at)];
        return { ...p, points };
      }),
    }));
  },

  deletePolylinePoint: (id, index) => {
    const target = docPolylines(get().doc).find((p) => p.id === id);
    if (!target) return;
    const remain = target.points.filter((_, i) => i !== index);
    if (remain.length < 2) {
      get().commit((d) => ({ ...d, polylines: docPolylines(d).filter((p) => p.id !== id) }));
      return;
    }
    // 闭合线删到只剩 2 点：闭环退化成零面积的来回线，自动改回开链
    //（只在真发生变化时写键，不给本来就开着的线添 `closed:false` 的痕迹）
    const openIt = target.closed && remain.length < 3;
    get().commit((d) => ({
      ...d,
      polylines: docPolylines(d).map((p) =>
        p.id === id ? { ...p, points: remain, ...(openIt ? { closed: false } : {}) } : p,
      ),
    }));
  },

  setStyle: (next) => {
    if (next === get().doc.style) return;
    get().commit((d) => ({ ...d, style: next }));
  },

  addLabel: (input) => {
    const text = input.text.trim();
    if (!text) return null;
    const label: MapLabel = {
      id: createLabelId(),
      text,
      x: input.x,
      y: input.y,
      size: input.size ?? LABEL_DEFAULT_SIZE,
      level: input.level,
    };
    get().commit((d) => ({ ...d, labels: [...d.labels, label] }));
    return label.id;
  },

  updateLabel: (id, patch) => {
    get().commit((d) => {
      const target = d.labels.find((l) => l.id === id);
      if (!target) return d;
      const text = patch.text === undefined ? target.text : patch.text.trim();
      if (!text) return { ...d, labels: d.labels.filter((l) => l.id !== id) };
      return {
        ...d,
        labels: d.labels.map((l) => (l.id === id ? { ...l, ...patch, text } : l)),
      };
    });
  },

  removeLabel: (id) => {
    get().commit((d) => ({
      ...d,
      labels: d.labels.length === 0 ? d.labels : d.labels.filter((l) => l.id !== id),
    }));
  },

  setElementLabel: (elementId, text, size = LABEL_DEFAULT_SIZE) => {
    const next = text.trim();
    get().commit((d) => {
      const el = d.elements.find((e) => e.id === elementId);
      if (!el) return d;
      const existing = d.labels.find((l) => l.elementId === elementId);
      if (existing && existing.text === next) return d;
      if (!next) {
        return existing ? { ...d, labels: d.labels.filter((l) => l.id !== existing.id) } : d;
      }
      if (existing) {
        return {
          ...d,
          labels: d.labels.map((l) => (l.id === existing.id ? { ...l, text: next } : l)),
        };
      }
      const label: MapLabel = {
        id: createLabelId(),
        text: next,
        x: el.x,
        y: el.y - LABEL_ABOVE_ELEMENT,
        size,
        level: el.level,
        elementId,
      };
      return { ...d, labels: [...d.labels, label] };
    });
  },

  embedSubmap: (regionId, submap, enterScale) => {
    get().commit((d) => ({
      ...d,
      regions: d.regions.map((r) =>
        r.id === regionId
          ? {
              ...r,
              submap,
              ...(enterScale === undefined ? {} : { submapEnterScale: enterScale }),
            }
          : r,
      ),
    }));
  },

  removeSubmap: (regionId) => {
    get().commit((d) => {
      const target = d.regions.find((r) => r.id === regionId);
      if (!target || !target.submap) return d;
      return {
        ...d,
        // 剥掉 submap 与 submapEnterScale（恢复为普通区块），其余字段不变
        regions: d.regions.map((r) => {
          if (r.id !== regionId) return r;
          const rest: Omit<typeof r, "submap" | "submapEnterScale"> = {
            id: r.id,
            parentId: r.parentId,
            level: r.level,
            name: r.name,
            seed: r.seed,
            polygon: r.polygon,
            color: r.color,
          };
          return rest;
        }),
      };
    });
  },

  mergeSubtree: (rootId) => {
    // store 内部**自己再算一次**计划，不信任调用方传来的预览（架构 §3.4 最后一步）：
    // 预览与执行之间可能有别的编辑插进来（虽然是同一 tick，但便宜且不会错）。
    const plan = planMerge(get().doc.regions, rootId);
    if (!plan) return { removed: 0, withSubmap: 0 };
    get().commit((d) => ({ ...d, regions: applyMerge(d.regions, plan) }));
    return { removed: plan.descendantIds.length, withSubmap: plan.withSubmap.length };
  },

  setRegionSchema: (schema, pruneLevelsAbove) => {
    get().commit((d) => {
      const regions =
        pruneLevelsAbove === undefined
          ? d.regions
          : d.regions.filter((r) => r.level < pruneLevelsAbove);
      return { ...d, regionSchema: schema, regions };
    }, REGION_SCHEMA_COMMIT_KEY);
  },
}));

/** 复位文档 store（测试隔离 + 窗口即关即销时清空） */
export function resetMapDocStore(doc: MapDocument): void {
  useMapDocStore.setState({
    doc,
    undoStack: [],
    redoStack: [],
    // 架构 §6-8：复位也必须断键，否则跨用例/跨窗口的第一个 schema 编辑会被吞掉快照
    lastCommitKey: null,
    // 剪贴板是会话级状态：换一张图 / 换一个用例，"上一次复制的东西"不该还粘得上
    clipboard: null,
  });
}
