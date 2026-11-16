/**
 * 地图文档快照（Data 层纯函数）。
 *
 * 只依赖类型契约与图层状态，不认识 zustand；撤销栈的形状、
 * 快照读写与图层状态合并规则全部收在这里，供 useMapDocStore.ts 调用。
 */
import type { MapDocument, MapElement, MapLabel, MapLand, MapStyle } from "../types";
import type { MapLayerId, MapLayerState } from "../layerState";
/** 撤销栈最大深度（PRD §4.8） */
export const HISTORY_LIMIT = 50;

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

export function snapshotOf(doc: MapDocument): DocSnapshot {
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
export function applySnapshot(doc: MapDocument, snap: DocSnapshot): MapDocument {
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
export function withLayerState(
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
