/**
 * 标注层渲染同步（B3 / PRD §6.3.2）
 *
 * 【为什么单独成文件】标注层与素材层是**同一套结构**（按层级分容器、容器 alpha
 * 跟权重走、按 id 增量增删）。把这套逻辑写进 `MapCanvas/index.tsx` 会让那个文件
 * 从 900 行涨到 1100 行，且"每帧重建"与"视口只改 scale"这两条纪律会被埋在
 * effect 堆里再也看不见。抽出来之后 `MapCanvas` 只负责"挂容器 + 跑 effect"。
 *
 * 【三条纪律（与素材层完全一致）】
 *   1. **增量**：按 id 建/改/删 `Text`，绝不每帧重建 300 个文字对象；
 *   2. **视口变化只改 scale**：`scale = 1/viewportScale` 让字号在屏幕上恒定，
 *      一个标量赋值即可。把 labelLayer 挪到 world 之外、每次滚轮改写 300 个
 *      position 会更贵，而且要用 `worldToScreen` 逐个换算 —— 换算是坐标模块的事；
 *   3. **层级权重落在容器 alpha 上**：与区块、素材共用**同一份** `levelAlphas`，
 *      于是三者"同呼吸"；若把权重乘进 `TextStyle.alpha`，滚轮每格都要重建样式。
 *
 * 【状态为什么挂在 root 上（WeakMap）而不是由调用方持有一个 state 对象】
 * 层级容器（`Map<key, Container>`）与句柄表（`Map<id, LabelHandle>`）是**渲染层的
 * 私有簿记**，不该泄漏进组件的 ref 列表里让人逐个清理（素材层当年就是这么写的，
 * 卸载时要记得 `elementLayersRef.current.clear()`，漏一行就是内存泄漏）。
 * 用 `WeakMap<Container, State>`：root 被 `destroy` 后键自然消失，生命周期与场景图
 * 同生共死，调用方签名也保持 `syncLabels(root, labels, levelCount)` 三个参数。
 */
import { Container, Text, TextStyle } from "pixi.js";
import { ELEMENT_PICK_MIN_WEIGHT, resolveElementLevel } from "../../lod";
import type { MapLabel, MapLabelSize } from "../../types";

/** 宋体优先：古地图的地名靠衬线笔画撑住，无衬线会显得像 UI 文案 */
export const LABEL_FONT_FAMILY = '"Songti SC","Noto Serif SC",serif';

// 【字号档与默认值不在这里定义】它们已经搬去 `types.ts`（`LABEL_SIZES` /
// `LABEL_DEFAULT_SIZE`）。这里是渲染层，而字号档是**文档字段的取值域**：
// 工具栏的下拉、`useMapEditor` 的默认值、渲染层的 `TextStyle.fontSize` 必须
// 引用同一个数组，否则会出现"下拉里能选 16、画出来还是 12"这类只在点一次才
// 暴露的错位。曾经这里也各写了一份 `LABEL_DEFAULT_SIZE = 12`，全仓零调用方，
// 属于纯重复。

/** 字色：深墨绿（与区块边界同色系，压在纸面上不跳） */
export const LABEL_FILL = 0x1b1f1c;

/**
 * 白描边、无底框（PRD §6.3.2 原值）。
 *
 * 3 px 描边是"无底框还能读"的唯一手段：地图底色深浅不一（海面、陆地、山体），
 * 只靠字色总有一段读不清；加底框又会把下面的地形整块遮掉。
 */
export const LABEL_STROKE = { color: 0xf6f0e0, width: 2 } as const;

/**
 * 标注数量上限。
 *
 * 300 条是 PRD §9 的性能口径（600 区块 + 300 素材 + 300 标注 ≥ 50fps）里的
 * 那一份配额。超出的**不渲染**（文档里仍保留）：静默丢弃数据比"不显示"更糟，
 * 而渲染 500 条会让 Text 的排版测量成为滚轮时的最大开销。
 */
export const LABEL_MAX = 300;

/**
 * "层级无关"的容器哨兵键（与素材层的 `LOOSE_LEVEL_KEY` 同域、同值）。
 *
 * 生成区块之前创建的标注没有层级可言（`level: null`），放在这个容器里、alpha 恒 1，
 * 任何缩放下都可见。它排在所有层级容器之后，因此永远画在最上层。
 */
export const LOOSE_LABEL_KEY = -1;

/** 同层级避让的步长（世界单位） */
export const LABEL_AVOID_STEP = 6;

/** 同层级避让最多让几次（再让就离原来的位置太远了，不如重叠） */
export const LABEL_AVOID_MAX = 3;

/**
 * 行高系数 / 单字宽系数 —— 只用于**避让的包围盒估计**，不参与真实排版。
 *
 * 【为什么不用 `Text.getBounds()`】两个理由：
 *   · 它给的是**屏幕**包围盒（已经过世界矩阵与 `1/scale` 缩放），随缩放变化，
 *     于是避让结果会在滚轮时不停抖动，文字会"跳来跳去"；
 *   · 300 条标注每次同步都求一遍世界矩阵，成本比排版本身还高。
 * 用 `字数 × 字号` 估一个稳定的世界包围盒：避让本来只是"别叠在一起"的粗排，
 * 宁可估宽一点（`CJK_WIDTH_RATIO` 取 1.0 = 全角），也不要让文字叠住。
 */
const LABEL_LINE_HEIGHT = 1.2;
const CJK_WIDTH_RATIO = 1;

/** 标注文字的屏幕分辨率上限：与设备像素比同步，但封顶 2（4K 屏上不必再高） */
const LABEL_RESOLUTION_MAX = 2;

/** 一个标注的渲染句柄 —— 增量同步的全部状态都在这里 */
export interface LabelHandle {
  /** 文档里的标注 id */
  id: string;
  /** Pixi 文字对象 */
  node: Text;
  /** 当前挂在哪个层级容器（键见 `LOOSE_LABEL_KEY`） */
  key: number;
  /** 文档里的原始世界坐标（避让前的锚点） */
  baseX: number;
  baseY: number;
  /** 本次同步算出的避让位移（世界单位，恒 ≤ 0，即只往上让） */
  avoidY: number;
  /** 当前字号档（与 `size` 不同才重建样式） */
  size: MapLabelSize;
  /** 当前文本（与 `label.text` 不同才写 `node.text`） */
  text: string;
}

/** 一个 root 上的私有簿记 */
interface LabelSyncState {
  /** 层级容器（含 `LOOSE_LABEL_KEY`），键与句柄的 `key` 同域 */
  layers: Map<number, Container>;
  /** id → 渲染句柄 */
  handles: Map<string, LabelHandle>;
}

const stateByRoot = new WeakMap<Container, LabelSyncState>();

function stateOf(root: Container): LabelSyncState {
  const existing = stateByRoot.get(root);
  if (existing) return existing;
  const created: LabelSyncState = { layers: new Map(), handles: new Map() };
  stateByRoot.set(root, created);
  return created;
}

/** 目标层级容器键：越界并入最细一级，`null` 归哨兵（与素材同一套规则） */
function keyOf(level: number | null | undefined, levelCount: number): number {
  const resolved = resolveElementLevel(level, levelCount);
  return resolved === null ? LOOSE_LABEL_KEY : resolved;
}

/** 按字号档造样式。只在"新建"与"换档"时调用，不在同步主循环里 */
function styleFor(size: MapLabelSize): TextStyle {
  return new TextStyle({
    fontFamily: LABEL_FONT_FAMILY,
    fontSize: size,
    fill: LABEL_FILL,
    stroke: { color: LABEL_STROKE.color, width: LABEL_STROKE.width },
    align: "center",
  });
}

/** 文字对象的屏幕分辨率：跟随设备像素比、封顶 2 */
function labelResolution(): number {
  return Math.min(window.devicePixelRatio || 1, LABEL_RESOLUTION_MAX);
}

/** 世界包围盒（避让与命中测试共用同一口径；`y` 是**当前**位置，避让时试算多个候选） */
function boxAt(text: string, size: MapLabelSize, x: number, y: number) {
  const w = Math.max(1, text.length) * size * CJK_WIDTH_RATIO;
  const h = Math.max(1, size) * LABEL_LINE_HEIGHT;
  return { left: x - w / 2, right: x + w / 2, top: y - h / 2, bottom: y + h / 2 };
}

function boxOf(handle: LabelHandle, y: number) {
  return boxAt(handle.text, handle.size, handle.baseX, y);
}

type Box = ReturnType<typeof boxOf>;

function overlaps(a: Box, b: Box): boolean {
  // 相邻不算重叠：留一点缝读起来才不挤
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * 同层级内贪心避让：**只改渲染句柄的 y**。
 *
 * 【绝不写回 `doc.labels`】渲染层改业务状态会造出循环依赖（改了 doc → 触发重渲染
 * → 又算一次避让 → 又改 doc），撤销栈也会被渲染细节污染。因此避让结果只活在
 * `LabelHandle.avoidY` 上，`doc.labels[].offsetY` 留给未来"手动微调"。
 *
 * 【贪心即可】300 条文字的最优排布是 NP 问题；"先放下的优先占位、后来的每次往上
 * 让 6 个单位、最多让 3 次"已经能把绝大多数叠字推开，而代价是 O(n²) 的包围盒
 * 比较（300² = 9 万次纯数值比较，约 1ms，只在标注变化时跑一次）。
 *
 * 【按层级分组】不同层级不会同时以高权重出现（Σα ≡ 1），跨层级让位没有意义，
 * 还会让"缩放到别级时文字位置突然变了"。
 */
export function applyAvoidance(handles: readonly LabelHandle[]): void {
  const byKey = new Map<number, LabelHandle[]>();
  for (const handle of handles) {
    const group = byKey.get(handle.key);
    if (group) group.push(handle);
    else byKey.set(handle.key, [handle]);
  }

  for (const group of byKey.values()) {
    // `placed` 保持文档顺序 —— "后放置的让位"这条规则就落在这个遍历顺序上
    const placed: LabelHandle[] = [];
    for (const handle of group) {
      const collides = (shift: number) =>
        placed.some((p) => overlaps(boxOf(handle, handle.baseY + shift), boxOf(p, p.baseY + p.avoidY)));

      let shift = 0;
      let hit = collides(shift);
      for (let n = 0; hit && n < LABEL_AVOID_MAX; n += 1) {
        shift -= LABEL_AVOID_STEP;
        hit = collides(shift);
      }

      handle.avoidY = shift;
      handle.node.position.set(handle.baseX, handle.baseY + shift);
      placed.push(handle);
    }
  }
}

/**
 * 增量同步：按层级建/拆容器，按 id 建/改/删 `Text`。
 *
 * @param root       `labelLayer`（场景图里那个空容器）
 * @param labels     文档里的标注（顺序即"放置顺序"，避让按它排队）
 * @param levelCount 当前层级数（= `levelAlphas.length`）
 * @returns id → 句柄（给视口 effect 用；引用稳定，内容每次同步后原地更新）
 */
export function syncLabels(
  root: Container,
  labels: readonly MapLabel[],
  levelCount: number,
): Map<string, LabelHandle> {
  const state = stateOf(root);
  const depth = Math.max(0, Math.trunc(levelCount));
  const keys: number[] = [];
  for (let i = 0; i < depth; i += 1) keys.push(i);
  keys.push(LOOSE_LABEL_KEY);

  // ── 1) 先补建新层级容器（此时先不拆旧的：下面还要把句柄从旧容器里搬出来）──
  for (const key of keys) {
    if (!state.layers.has(key)) state.layers.set(key, new Container());
  }

  // ── 2) 按 id 增量同步文字 ──
  const seen = new Set<string>();
  // 超量护栏：超出上限的**不渲染**，但文档保留（静默丢数据比不显示更糟）
  const visible = labels.length > LABEL_MAX ? labels.slice(0, LABEL_MAX) : labels;

  for (const label of visible) {
    // 空文本不该建节点：正在编辑中的草稿永远不进文档，这里是防御性判断
    if (!label || typeof label.id !== "string" || !label.text) continue;
    seen.add(label.id);

    const key = keyOf(label.level, depth);
    const target = state.layers.get(key) ?? root;
    // `offsetY` 只留给"未来手动微调"；避让产生的偏移不写回文档（见 applyAvoidance）
    const baseY = label.y + (label.offsetY ?? 0);

    let handle = state.handles.get(label.id);
    if (!handle) {
      const node = new Text({ text: label.text, style: styleFor(label.size) });
      // 锚点居中：`x` 是文字的水平中心、`y` 是垂直中心，避让往上让才对称
      node.anchor.set(0.5, 0.5);
      node.resolution = labelResolution();
      target.addChild(node);
      handle = {
        id: label.id,
        node,
        key,
        baseX: label.x,
        baseY,
        avoidY: 0,
        size: label.size,
        text: label.text,
      };
      state.handles.set(label.id, handle);
    } else {
      // 层级归属变了（改了层级数、或撤销重做到了另一次放置）：换容器而不是重建节点
      if (handle.key !== key) {
        state.layers.get(handle.key)?.removeChild(handle.node);
        target.addChild(handle.node);
        handle.key = key;
      }
      if (handle.text !== label.text) {
        handle.node.text = label.text;
        handle.text = label.text;
      }
      // 换字号档才重建样式：`style` 赋值会触发一次文字重新排版
      if (handle.size !== label.size) {
        handle.node.style = styleFor(label.size);
        handle.size = label.size;
      }
      handle.baseX = label.x;
      handle.baseY = baseY;
    }
  }

  // ── 3) 删除文档里已经没有的标注 ──
  for (const [id, handle] of state.handles) {
    if (seen.has(id)) continue;
    handle.node.parent?.removeChild(handle.node);
    handle.node.destroy();
    state.handles.delete(id);
  }

  // ── 4) 拆掉多余的层级容器（此刻它们已经空了：句柄在上一步要么搬走、要么销毁）──
  //
  // ⚠️ 必须先从 root 上摘掉再 destroy：`destroy()` **不会**把自己从父容器里摘掉，
  // 只销毁自身的显示对象。漏掉 removeChild 的话，这些容器会一直挂在 labelLayer 的
  // 显示列表里（虽然画不出东西，但每帧仍在遍历），改来改去层级数就会越积越多。
  for (const [key, container] of state.layers) {
    if (keys.includes(key)) continue;
    root.removeChild(container);
    container.destroy({ children: true });
    state.layers.delete(key);
  }

  // ── 5) 重排挂载顺序 ──
  // 层级数可以调，新容器若直接 append 会跑到「层级无关」之上 —— 顺序就乱了。
  // 素材层当年踩过这个坑，这里每轮无条件重排（成本是 n 次 removeChild + addChild）。
  for (const container of state.layers.values()) root.removeChild(container);
  for (const key of keys) {
    const container = state.layers.get(key);
    if (container) root.addChild(container);
  }

  // ── 6) 避让 + 落位 ──
  applyAvoidance([...state.handles.values()]);

  return state.handles;
}

/**
 * 各层级容器的 alpha = 该层级权重（与区块、素材共用同一份 `levelAlphas`）。
 *
 * 之所以要单独一个导出：权重是**高频**输入（滚轮每格都变），必须走在"只改 alpha"
 * 这条零成本路径上；若把它塞进 `syncLabels`，同步与权重就被绑成同一个 effect，
 * 滚轮每格都要跑一遍全量同步。
 *
 * 【调用方的依赖数组里必须有 `app`】首次挂载时 `app` 为 null、容器还没建，本函数会
 * 空跑；而 `levelAlphas` 由上层 `useMemo` 而来、引用常年不变，少写 `app` 就再也没
 * 机会把权重写进去 —— 结果是所有层级都停在容器默认的 alpha 1 上，
 * 也就是"所有层级的地名同时可见"，层级归属形同虚设（素材层踩过同一个坑）。
 */
export function applyLabelWeights(root: Container, levelAlphas: readonly number[]): void {
  const state = stateByRoot.get(root);
  if (!state) return;
  for (const [key, container] of state.layers) {
    // 层级无关的标注恒为不透明；其余按所属层级的权重淡入淡出
    container.alpha = key === LOOSE_LABEL_KEY ? 1 : levelAlphas[key] ?? 0;
  }
}

/**
 * 视口变化：只改每个 `Text` 的 scale（`1/scale` ⇒ 屏幕上字号恒定）。
 *
 * 入参收 `Iterable` 是为了让调用方直接传 `Map.values()`，省掉一次数组分配 ——
 * 这个函数在滚轮里会被调 N 次，虽然 N 很小，但没有理由每格造一个 300 元素的数组。
 */
export function setLabelScale(handles: Iterable<LabelHandle>, viewportScale: number): void {
  const inv = 1 / Math.max(1e-6, viewportScale);
  for (const handle of handles) handle.node.scale.set(inv);
}

/**
 * 命中测试：返回世界坐标落点处**最上层**的标注（后创建者在上）。
 *
 * 与 `pickElement` 同一条可见性门槛（`ELEMENT_PICK_MIN_WEIGHT`）：正在淡出的
 * 标注只有一层几乎看不见的影子，若还能双击进去编辑，用户会在"看着什么都没有"
 * 的地方打开一个输入框。两处共用同一个常量，才不会出现"能选中但点不进去"。
 */
export function labelAt(
  labels: readonly MapLabel[],
  levelAlphas: readonly number[],
  world: { x: number; y: number },
): MapLabel | null {
  for (let i = labels.length - 1; i >= 0; i -= 1) {
    const label = labels[i];
    if (!label || !label.text) continue;
    const resolved = resolveElementLevel(label.level, levelAlphas.length);
    const weight = resolved === null ? 1 : levelAlphas[resolved] ?? 0;
    if (weight < ELEMENT_PICK_MIN_WEIGHT) continue;

    // 复用避让那套包围盒估计，保证"看起来在哪"与"点得中哪里"是同一个口径
    const y = label.y + (label.offsetY ?? 0);
    const box = boxAt(label.text, label.size, label.x, y);
    if (
      world.x >= box.left &&
      world.x <= box.right &&
      world.y >= box.top &&
      world.y <= box.bottom
    ) {
      return label;
    }
  }
  return null;
}
