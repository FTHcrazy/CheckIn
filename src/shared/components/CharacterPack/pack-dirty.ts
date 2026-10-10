/**
 * 未保存改动计数（「N 处改动未保存」）—— 纯函数层
 *
 * ## 为什么不是自增计数器
 *
 * 早期实现是每次 `mutate` 给一个计数器 +1（批量操作传条目数）。这在
 * **输入框**上是错的：`updateAttribute(id, { name })` 每次 `onChange` 都调一次，
 * 于是「破境丹」三个字算 3 处改动，再把字删回原样仍显示「改了 3 处」，
 * 而实际上一处都没变。
 *
 * 作者要看的是**净变化**：改名 + 删物品 - 移动排序 = 3 处，而不是敲了多少键。
 *
 * ## 计数口径
 *
 * 以「上次保存态」（`savedRef`，内存镜像）为基线，逐实体比较**最终值**：
 *
 * | 情形 | 计 1 处 |
 * |---|---|
 * | 新增实体 | 基线里没有这个 id |
 * | 删除实体 | 当前文档没有这个 id |
 * | 修改实体 | 同 id 但**有实质字段**变了（改几次、改回原样都算 0 或 1） |
 *
 * 「移动」是指排序变化（属性 / 部位 / 物品 / 技能 / 方案的位置），
 * 因此 `sort` / `sortOrder` 参与比较 —— 但**只比较位置，不比较位置造成的连锁字段**
 * （例如 `sortOrder` 重排后每一行的 `sortOrder` 都变；这里只认「相对顺序变了」）。
 *
 * ## 不比较什么
 *
 * `updatedAt` **不参与**：它是改动打点（REQ-028 本章变动角标），每次写都会变，
 * 拿它比较等于「碰过就算改」，与「净变化」的口径直接冲突。
 */

import type { PackDoc } from "./hooks/usePackData";

/** 一份可比较的文档切片（`PackDoc` 与草稿 payload 都满足） */
export type DirtyDoc = Pick<
  PackDoc,
  "character" | "attributes" | "slots" | "items" | "skills" | "modifiers" | "unitSystems" | "presets" | "realmLink"
>;

/** 逐类实体：id 提取 + 实质字段序列化 */
interface EntitySpec<T> {
  /** 从文档取出该类实体列表（缺失时给空数组） */
  list: (doc: DirtyDoc) => T[];
  /** 稳定 id */
  id: (item: T) => string;
  /** 用于比较的**实质内容**（排除 updatedAt 之类的打点字段） */
  signature: (item: T) => string;
}

/**
 * `updatedAt` 会随每次编辑变化，是「碰过」而非「变了」的信号，比较时必须剥掉。
 * 用浅拷贝 + 删键而不是解构：解构出的弃用变量会触发 `no-unused-vars`。
 */
function stripTouch<T extends { updatedAt?: number }>(item: T): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...item };
  delete copy.updatedAt;
  return copy;
}

/**
 * 实体清单。**每类都要在**：漏掉一类，它的改动就不计数
 * （表现为「改了但顶栏还写着已保存」，比多计一次危险得多）。
 */
const SPECS: Array<EntitySpec<never>> = [
  {
    list: (doc) => doc.attributes as never[],
    id: (item: never) => (item as { id: string }).id,
    signature: (item: never) => JSON.stringify(stripTouch(item as { updatedAt?: number })),
  },
  {
    list: (doc) => doc.slots as never[],
    id: (item: never) => (item as { id: string }).id,
    signature: (item: never) => JSON.stringify(item),
  },
  {
    list: (doc) => doc.items as never[],
    id: (item: never) => (item as { id: string }).id,
    signature: (item: never) => JSON.stringify(stripTouch(item as { updatedAt?: number })),
  },
  {
    list: (doc) => doc.skills as never[],
    id: (item: never) => (item as { id: string }).id,
    signature: (item: never) => JSON.stringify(stripTouch(item as { updatedAt?: number })),
  },
  {
    list: (doc) => doc.modifiers as never[],
    id: (item: never) => (item as { id: string }).id,
    signature: (item: never) => JSON.stringify(stripTouch(item as { updatedAt?: number })),
  },
  {
    list: (doc) => doc.unitSystems as never[],
    id: (item: never) => (item as { id: string }).id,
    signature: (item: never) => JSON.stringify(stripTouch(item as { updatedAt?: number })),
  },
  {
    list: (doc) => doc.presets as never[],
    id: (item: never) => (item as { id: string }).id,
    signature: (item: never) => JSON.stringify(stripTouch(item as { updatedAt?: number })),
  },
];

/** 排序字段：位置变了要算「移动」，但它自身的变化不重复计 */
const ORDER_KEYS = ["sortOrder", "sort", "order", "position"] as const;

/**
 * 位置签名：把同类实体的**相对顺序**编码成一段字符串。
 *
 * 只保留 `id → 排序值`，不与单条 `signature` 混算 —— 否则「上移一行」会因为
 * 两行的 `sortOrder` 都变了而被算成 2 处修改，而作者只做了一次拖动。
 *
 * ⚠️ 只在**两侧 id 集合完全相同**时才有意义（见 `countNetChanges` 里的用法）：
 * 增删条目本身就会让顺序整体位移，那种情况下顺序变化是增删的**副产物**，
 * 再算一次「移动」就是重复计数（删 2 行会凭空变成 3 处）。
 */
function orderSignature<T>(list: T[]): string {
  const rows = list.map((item) => {
    const record = item as Record<string, unknown>;
    const order: Record<string, unknown> = {};
    for (const key of ORDER_KEYS) {
      if (record[key] !== undefined) order[key] = record[key];
    }
    return { id: String(record.id ?? ""), order };
  });
  // 按 id 归一化排列，让签名只反映「id → 位置」的映射本身
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return JSON.stringify(rows);
}

/** 单条比较用的签名：剥掉排序字段（排序单独算，避免一处拖动计成两处） */
function contentSignature<T>(item: T, spec: EntitySpec<T>): string {
  const parsed = JSON.parse(spec.signature(item)) as Record<string, unknown>;
  for (const key of ORDER_KEYS) delete parsed[key];
  return JSON.stringify(parsed);
}

/**
 * 计算「未保存的净变化处数」。
 *
 * `saved` 为 null（还没装载完 / 没有基线）时返回 0 —— 宁可不报，
 * 也不要把整份文档当成「全是新增」。
 */
export function countNetChanges(saved: DirtyDoc | null, current: DirtyDoc | null): number {
  if (!saved || !current) return 0;
  let count = 0;

  for (const spec of SPECS) {
    const before = new Map<string, never>();
    for (const item of spec.list(saved)) before.set(spec.id(item), item);
    const after = new Map<string, never>();
    for (const item of spec.list(current)) after.set(spec.id(item), item);

    // 新增 / 删除：每个实体各算 1 处
    for (const id of after.keys()) if (!before.has(id)) count += 1;
    for (const id of before.keys()) if (!after.has(id)) count += 1;

    // 修改：同 id 且实质内容变了
    for (const [id, item] of after) {
      const prev = before.get(id);
      if (!prev) continue;
      if (contentSignature(prev, spec) !== contentSignature(item, spec)) count += 1;
    }

    // 移动：**只在 id 集合完全一致时**才比较顺序。有增删时顺序整体位移是
    // 增删的副产物（上一步已经各算过 1 处），再算一次就是重复计数。
    const sameMembers =
      before.size === after.size && [...before.keys()].every((id) => after.has(id));
    if (sameMembers && orderSignature(spec.list(saved)) !== orderSignature(spec.list(current))) {
      count += 1;
    }
  }

  // 境界（不属于上表：绑定状态由 character.entityId + realmLink 共同承载）
  if (realmSignature(saved) !== realmSignature(current)) count += 1;

  return count;
}

/**
 * 境界的实质内容：**只比关联行**（`toId` + `note.sub`）与未绑定时的自持值。
 *
 * ⚠️ **不比 `entityId`**：主角绑定是即时落库的那一格（`writeProtagonistBinding`），
 * 与行囊其它设定数据不同 —— 绑完就已经在库里了，把它算成「1 处未保存改动」
 * 会让顶栏常亮一个永远按不掉的角标，且「撤销全部」也撤不掉它。
 */
function realmSignature(doc: DirtyDoc): string {
  return JSON.stringify({
    realmAt: doc.character.realmAt ?? "",
    realmLink: doc.realmLink
      ? { toId: doc.realmLink.toId, note: doc.realmLink.note }
      : null,
  });
}
