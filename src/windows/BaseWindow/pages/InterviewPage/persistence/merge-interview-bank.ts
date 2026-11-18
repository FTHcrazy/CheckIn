/**
 * 合并视图：`基线常量 ∪ interview.db 增量`。
 *
 * 【为什么必须合并】
 * 题库本体（243 题 / ~100 词条 / 24 图解 / 22 分类）继续留在源码作**只读基线**，
 * `interview.db` 只存用户增量。所以渲染层看到的永远是「叠加层」的结果：
 * 未动过的题跟随版本更新，动过的题保持用户版本，删掉的题不被升级复活。
 *
 * 【COW 的两个方向，别写反】
 * - 基线是**默认值**，`override` 优先（不是「基线优先、增量丢弃」）——
 *   否则用户对基线题的任何修改都无处存放，等于题库永远不可编辑；
 * - 但 `id` 永远以基线为准：覆盖行的 payload 即便被导入文件改过 id，这里也要
 *   **强制改回来**，因为收藏（`localStorage` 里的 `string[]`）、React `key`、
 *   `expandedId` 全按 id 认人。
 *
 * 【单条的坏数据不许打掉整页】
 * 库里可能躺着导入的脏 payload。这里一律「校验 → 丢弃该条 → 记 warning」，
 * 既不抛异常也不静默：用户能在维护面板看到「这条没显示，为什么」。
 *
 * 规范：docs/spec/interview-db-ai-spec.md §5.2（合并算法七步）/ §5.3 / §5.4
 */
import type { InterviewCategoryId, InterviewQuestion } from "../data/interview-types";
import type { GlossaryDomain, GlossaryTerm } from "../data/interview-glossary";
import type { InterviewDiagram } from "../data/interview-diagrams";
import type { CategoryNode } from "../data/interview-taxonomy";
import {
  isValidDiagramShape,
  isValidGlossaryShape,
  isValidQuestionShape,
  type DiagramShape,
  type GlossaryShape,
  type QuestionShape,
} from "@/shared/interview/payload-shape";

/** 产物类型（`interview_item.kind`），与结构校验层的集合一致 */
type RowKind = "question" | "glossary" | "diagram";

/**
 * 库内一行（`interview_item` 的渲染层投影）。
 *
 * `payload` 已经是**对象**（列表通道 / `itemGet` 都 JSON.parse 过），
 * 但导入的坏数据可能是字符串，`coercePayload` 会再试一次。
 */
export interface MergeRow {
  id: string;
  kind: string;
  action: "new" | "override";
  baseId: string | null;
  status: string;
  title: string;
  payload: unknown;
  baseStamp: string | null;
  baseHash: string | null;
  ackBaseHash: string | null;
  updatedAt: number;
}

/**
 * 基线（源码常量）。
 *
 * `categories` 由调用方**给全**：22 个基线分类 + `adopted` 的自定义分类。
 * 合并函数拿不到 `interview_taxonomy`（那是另一张表、另一个通道），
 * 自己再拼一次只会拼出第二份真相。
 */
export interface MergeBaseline {
  questions: readonly InterviewQuestion[];
  glossary: readonly GlossaryTerm[];
  diagrams: readonly InterviewDiagram[];
  categories: readonly CategoryNode[];
}

export interface MergeResult {
  questions: InterviewQuestion[];
  glossary: GlossaryTerm[];
  diagrams: InterviewDiagram[];
  categories: CategoryNode[];
  /** 被用户隐藏的基线题 id（UI 的「已隐藏的默认题」分区要用） */
  hiddenIds: string[];
  /** 覆盖关系指向的基线题在本版本已不存在（升级删了题）：不渲染、保留在库、上报 */
  orphaned: Array<{ id: string; title: string; baseStamp: string | null }>;
  /** 改过、且基线已更新（baseHash 对不上且没点过「沿用我的」）的条目 */
  staleBase: Array<{ id: string; baseStamp: string | null }>;
  warnings: string[];
  /**
   * 每条**真正进了结果**的条目来自哪里：`baseline`（源码常量）/
   * `override`（用户的覆盖行）/ `new`（用户新增的行）。
   *
   * UI 靠它决定这道题显示哪些维护动作（默认题给「删除 = 隐藏」、覆盖过的题给
   * 「还原默认」、自建的题给「删除」）。与 `hiddenIds` / 不变式**同源**：
   * 被 hidden 挡掉的、被不变式丢弃的条目都不在这里 —— 它们不在渲染结果里，
   * 给一个看不见的卡片留动作按钮没有意义。
   */
  originById: Record<string, Origin>;
}

/** 结果的来源标记：决定不变式怎么判（`new` 行 id 必须 `u-` 前缀） */
type Origin = "baseline" | "override" | "new";

interface Produced<T> {
  value: T;
  origin: Origin;
}

/**
 * payload 归一。
 *
 * 库里存 TEXT：正常路径已经 `JSON.parse` 过，但导入的坏数据可能仍是字符串
 * （甚至是没解析干净的残片）。是字符串就再试一次 parse，失败原样返回，
 * 交给结构校验判非法 —— 这里不抛。
 */
function coercePayload(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const text = raw.trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return raw;
  }
}

/**
 * 取某条基线对应的覆盖行。
 *
 * kind 不匹配（比如 id 恰好和别的产物重名）时忽略并记 warning：
 * 用错类型的 payload 去构造题目只会造出一条「字段全缺」的空题。
 */
function takeLinked(
  linked: ReadonlyMap<string, MergeRow>,
  id: string,
  kind: RowKind,
  warnings: string[],
): MergeRow | null {
  const row = linked.get(id);
  if (!row) return null;
  if (row.kind !== kind) {
    warnings.push(`条目 ${id} 的覆盖行类型是 ${row.kind}，与基线不符，已忽略这次覆盖`);
    return null;
  }
  return row;
}

/** 新增行按 `updatedAt` 倒序：最新加的排在最后一段的最前面 */
function addedRows(rows: readonly MergeRow[], kind: RowKind): MergeRow[] {
  return rows
    .filter((row) => row.kind === kind)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

/** 通过结构校验的题目 payload → 题目（`id` 由调用方指定，绝不信 payload 里的 id） */
function adoptQuestion(
  shape: QuestionShape,
  id: string,
  categoryId: string,
): InterviewQuestion {
  return { ...shape, id, categoryId: categoryId as InterviewCategoryId };
}

/**
 * 通过结构校验的词条 payload → 词条。
 *
 * 字段逐个搬而不是 `{...shape}`：`GlossaryShape.domain` 是 `string`
 * （结构层不认领域枚举），而 `GlossaryTerm.domain` 是字面量联合 ——
 * 逐个搬能把「哪几个字段做了断言」摆在明面上。
 */
function adoptGlossary(shape: GlossaryShape, id: string): GlossaryTerm {
  return {
    // 词条 id 被别的词条的 `related` 引用，覆盖时同样不许换 id
    id,
    term: shape.term,
    domain: shape.domain as GlossaryDomain,
    short: shape.short,
    detail: shape.detail,
    ...(shape.en ? { en: shape.en } : {}),
    ...(shape.aliases?.length ? { aliases: shape.aliases } : {}),
    ...(shape.related?.length ? { related: shape.related } : {}),
    ...(shape.categoryId ? { categoryId: shape.categoryId as InterviewCategoryId } : {}),
  };
}

/**
 * 通过结构校验的图解 payload → 图解。
 *
 * `DiagramShape.kind` 是 4 个字面量的联合，TypeScript 无法把它收窄到某个成员，
 * 而结构校验已经**按 kind 分别查过必填分支**（flow→nodes / timeline→events /
 * compare→left+right / layers→layers）。所以这里是把「已按分支校验过的结果」
 * 还原成联合类型，不是绕过校验。
 */
function adoptDiagram(shape: DiagramShape, id: string): InterviewDiagram {
  const diagram = shape as unknown as InterviewDiagram;
  return { ...diagram, id } as InterviewDiagram;
}

/**
 * 出结果前的三条不变式（§5.2 步骤 7）。
 *
 * 违反时**丢弃该条并记 warning**，绝不抛异常 —— 一个 id 冲突不该让整个题库页白屏。
 * 三条分别对应三种「安静的数据错」：id 撞了 React `key` 会串、hidden 复活等于
 * 用户删了个寂寞、`new` 行没前缀说明导入端换了 id（收藏会全丢）。
 *
 * `origins` 是**出参**：只登记真正留下来的条目（被 hidden 挡掉、被丢弃的重复项、
 * 没前缀的 `new` 行一律不记）。UI 判「查不到来源就不显示动作」，正好与这里对齐。
 */
function finalize<T extends { id: string }>(
  items: readonly Produced<T>[],
  hidden: ReadonlySet<string>,
  label: string,
  warnings: string[],
  origins: Record<string, Origin>,
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const { id } = item.value;
    if (hidden.has(id)) {
      warnings.push(`${label} ${id} 已被隐藏却进入了结果，已丢弃`);
      continue;
    }
    if (seen.has(id)) {
      warnings.push(`${label} ${id} 出现重复，已丢弃后一条`);
      continue;
    }
    if (item.origin === "new" && !id.startsWith("u-")) {
      warnings.push(`${label} ${id} 是用户新建但没有 u- 前缀，已丢弃`);
      continue;
    }
    seen.add(id);
    origins[id] = item.origin;
    result.push(item.value);
  }
  return result;
}

/** 步骤 1：覆盖行索引。仅 `action='override'` 且 `status ∈ {adopted, hidden}` 参与 */
interface LinkedIndex {
  linked: Map<string, MergeRow>;
  added: MergeRow[];
}

function buildIndex(rows: readonly MergeRow[], warnings: string[]): LinkedIndex {
  const linked = new Map<string, MergeRow>();
  const added: MergeRow[] = [];

  for (const row of rows) {
    // 库里的 action 是 TEXT：`full` 导出文件里的 `baseline` 值混进来时要能挡住
    const action: string = row.action;
    if (action === "new") {
      // 草稿 / 已驳回 / 回收站都不进题库页，它们只活在草稿箱与回收站
      if (row.status === "adopted") added.push(row);
      continue;
    }
    if (action !== "override") {
      warnings.push(`条目 ${row.id} 的 action=${action} 无法识别，已跳过`);
      continue;
    }
    if (row.status !== "adopted" && row.status !== "hidden") continue;

    const baseId = row.baseId ?? row.id;
    const previous = linked.get(baseId);
    if (!previous) {
      linked.set(baseId, row);
      continue;
    }
    // 同一道基线题出现多行覆盖 = 脏数据（正常写入是按主键 upsert 的同一行）。
    // 取 `updatedAt` 最大的一条，另一行不渲染、也不删库 —— 删了才是真的丢内容。
    warnings.push(
      `基线 ${baseId} 有重复的覆盖记录（${previous.id} / ${row.id}），已取最近更新的一条`,
    );
    if (row.updatedAt > previous.updatedAt) linked.set(baseId, row);
  }

  return { linked, added };
}

/**
 * 合并基线常量与库内增量。
 *
 * 纯函数、同步、不碰 IO：题库页的设备差异全在调用方（取哪些 row、基线是什么）。
 */
export function mergeInterviewBank(
  baseline: MergeBaseline,
  rows: readonly MergeRow[],
  hashOf: (payload: unknown) => string,
): MergeResult {
  const warnings: string[] = [];
  const hiddenIds: string[] = [];
  const orphaned: MergeResult["orphaned"] = [];
  const staleBase: MergeResult["staleBase"] = [];

  // 步骤 1
  const { linked, added } = buildIndex(rows, warnings);

  // 步骤 5：分类白名单 = 调用方给全的 categories（22 基线 + 已采纳的自定义分类）
  const categoryWhitelist = new Set<string>(baseline.categories.map((category) => category.id));

  /** §5.4：改过 + 基线已更新 + 没点过「沿用我的」 */
  const recordStale = (row: MergeRow, currentHash: string, label: string): void => {
    // 合并算法**不自动挑边**：内容仍用用户版，只把「新版也改了」这件事显式报上去
    if (row.baseHash === currentHash || row.ackBaseHash === currentHash) return;
    staleBase.push({ id: row.baseId ?? row.id, baseStamp: row.baseStamp });
    warnings.push(`${label}在新版已修订（你改的版本基于 ${row.baseStamp ?? "未知版本"}）`);
  };

  // ── 步骤 2 & 3：题目 ──
  const questionItems: Produced<InterviewQuestion>[] = [];
  const hiddenQuestionIds = new Set<string>();

  for (const base of baseline.questions) {
    const row = takeLinked(linked, base.id, "question", warnings);
    if (!row) {
      // 未命中：用基线原对象（连引用都不换，方便上层做 `===` 短路）
      questionItems.push({ value: base, origin: "baseline" });
      continue;
    }
    if (row.status === "hidden") {
      // 墓碑：不出现，且升级不复活。收进 hiddenIds 供「已隐藏的默认题」分区
      hiddenIds.push(base.id);
      hiddenQuestionIds.add(base.id);
      continue;
    }

    const checked = isValidQuestionShape(coercePayload(row.payload));
    if (!checked.ok) {
      warnings.push(
        `「${base.title}」你的版本内容不合法（${checked.errors[0]}），本次显示默认内容`,
      );
      questionItems.push({ value: base, origin: "baseline" });
      continue;
    }

    const shape = checked.value;
    const categoryAvailable = categoryWhitelist.has(shape.categoryId);
    if (!categoryAvailable) {
      warnings.push(
        `「${base.title}」的分类 ${shape.categoryId} 已不存在，已回落到默认分类 ${base.categoryId}`,
      );
    }
    questionItems.push({
      value: adoptQuestion(shape, base.id, categoryAvailable ? shape.categoryId : base.categoryId),
      origin: "override",
    });
    recordStale(row, hashOf(base), `「${base.title}」`);
  }

  for (const row of addedRows(added, "question")) {
    // 解析一次就够：id 比对与结构校验都用这一个归一后的值。
    // 直接读 `row.payload` 会漏掉导入路径（payload 是 JSON **字符串**）的 id 改动
    const payload = coercePayload(row.payload);
    const checked = isValidQuestionShape(payload);
    if (!checked.ok) {
      warnings.push(`用户新增的题 ${row.id} 内容不合法（${checked.errors[0]}），已丢弃`);
      continue;
    }
    if (payload && typeof payload === "object" && "id" in payload) {
      const payloadId = (payload as { id?: unknown }).id;
      if (typeof payloadId === "string" && payloadId !== row.id) {
        warnings.push(`用户新增的题 ${row.id} 的 payload id 被改成了 ${payloadId}，已按主键回落`);
      }
    }
    const shape = checked.value;
    if (!categoryWhitelist.has(shape.categoryId)) {
      // 新增题没有「基线分类」可回落（§13-3：删分类后题目悬空 → 按未分类处理）
      warnings.push(`用户新增的题 ${row.id} 的分类 ${shape.categoryId} 不在可用分类里，按未分类处理`);
    }
    questionItems.push({
      value: adoptQuestion(shape, row.id, shape.categoryId),
      origin: "new",
    });
  }

  // ── 步骤 4：词条（同 id 覆盖是「替换」不是「键冲突」，这里不报 warning）──
  const glossaryItems: Produced<GlossaryTerm>[] = [];
  const hiddenGlossaryIds = new Set<string>();

  for (const base of baseline.glossary) {
    const row = takeLinked(linked, base.id, "glossary", warnings);
    if (!row) {
      glossaryItems.push({ value: base, origin: "baseline" });
      continue;
    }
    if (row.status === "hidden") {
      // hidden 词条从 matcher 键表里剔除：正文里不再变蓝
      hiddenGlossaryIds.add(base.id);
      continue;
    }

    const checked = isValidGlossaryShape(coercePayload(row.payload));
    if (!checked.ok) {
      warnings.push(`词条「${base.term}」你的版本内容不合法（${checked.errors[0]}），本次显示默认内容`);
      glossaryItems.push({ value: base, origin: "baseline" });
      continue;
    }
    glossaryItems.push({ value: adoptGlossary(checked.value, base.id), origin: "override" });
    recordStale(row, hashOf(base), `词条「${base.term}」`);
  }

  for (const row of addedRows(added, "glossary")) {
    const checked = isValidGlossaryShape(coercePayload(row.payload));
    if (!checked.ok) {
      warnings.push(`用户新增的词条 ${row.id} 内容不合法（${checked.errors[0]}），已丢弃`);
      continue;
    }
    glossaryItems.push({ value: adoptGlossary(checked.value, row.id), origin: "new" });
  }

  // ── 步骤 4（图解同构）──
  const diagramItems: Produced<InterviewDiagram>[] = [];
  const hiddenDiagramIds = new Set<string>();

  for (const base of baseline.diagrams) {
    const row = takeLinked(linked, base.id, "diagram", warnings);
    if (!row) {
      diagramItems.push({ value: base, origin: "baseline" });
      continue;
    }
    if (row.status === "hidden") {
      hiddenDiagramIds.add(base.id);
      continue;
    }

    const checked = isValidDiagramShape(coercePayload(row.payload));
    if (!checked.ok) {
      warnings.push(`图解「${base.title}」你的版本内容不合法（${checked.errors[0]}），本次显示默认内容`);
      diagramItems.push({ value: base, origin: "baseline" });
      continue;
    }
    diagramItems.push({ value: adoptDiagram(checked.value, base.id), origin: "override" });
    recordStale(row, hashOf(base), `图解「${base.title}」`);
  }

  for (const row of addedRows(added, "diagram")) {
    const checked = isValidDiagramShape(coercePayload(row.payload));
    if (!checked.ok) {
      warnings.push(`用户新增的图解 ${row.id} 内容不合法（${checked.errors[0]}），已丢弃`);
      continue;
    }
    diagramItems.push({ value: adoptDiagram(checked.value, row.id), origin: "new" });
  }

  // ── 步骤 6：孤儿覆盖（基线在新版本删了这条）──
  // 不参与渲染、不占 id，但**保留在库**：转存为我的新建题要用户点 —— 改 id 会重置
  // 该题在收藏里的语义，静默迁移等于悄悄丢用户收藏
  const baselineIds = new Set<string>([
    ...baseline.questions.map((item) => item.id),
    ...baseline.glossary.map((item) => item.id),
    ...baseline.diagrams.map((item) => item.id),
  ]);
  for (const [baseId, row] of linked) {
    if (baselineIds.has(baseId)) continue;
    orphaned.push({ id: row.id, title: row.title, baseStamp: row.baseStamp });
    warnings.push(`「${row.title}」覆盖的默认条目在当前版本已不存在，本次不显示（内容仍在库里）`);
  }

  // ── 步骤 7：不变式 ──
  // 来源登记表与三条不变式同一次遍历产出：题目 / 词条 / 图解共用一个 id 空间
  // （三条 CHECK 约束都按主键认人），所以合并成一份，UI 查一次就够。
  const originById: Record<string, Origin> = {};
  const questions = finalize(questionItems, hiddenQuestionIds, "题目", warnings, originById);
  const glossary = finalize(glossaryItems, hiddenGlossaryIds, "词条", warnings, originById);
  const diagrams = finalize(diagramItems, hiddenDiagramIds, "图解", warnings, originById);

  return {
    questions,
    glossary,
    diagrams,
    categories: [...baseline.categories],
    hiddenIds,
    orphaned,
    staleBase,
    warnings,
    originById,
  };
}
