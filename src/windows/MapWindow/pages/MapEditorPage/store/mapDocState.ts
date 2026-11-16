/**
 * 地图文档 store 的状态契约（Data 层）。
 *
 * 与动作实现分离：实现见 useMapDocStore.ts，快照形状见 docSnapshot.ts。
 */
import type {
  MapDocument,
  MapElement,
  MapLabel,
  MapLabelSize,
  MapLand,
  MapPolyline,
  MapStyle,
  MapSubmap,
  TerrainBandGrid,
} from "../types";
import type { MapRegion, RegionLevelDef } from "../regions";
import type { MapLayerId } from "../layerState";
import type { DocSnapshot } from "./docSnapshot";
export interface MapDocState {
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
