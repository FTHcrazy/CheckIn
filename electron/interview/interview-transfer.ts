/**
 * 题库导出 / 导入的**纯逻辑**（无 IO、无 Electron API，可在 vitest 直接跑）
 *
 * 分三层：
 *   1. `buildExportDocument` —— 把库内增量（+ full 模式下的基线快照）拼成交付文件；
 *   2. `validateExportDocument` —— 整包闸门：`format` / `schemaVersion` 不对就整包拒绝；
 *   3. `planImport` —— 逐条分类（baseline / new / override）并算出「插哪些、更哪些、跳哪些」。
 *
 * 【为什么要单独一个文件】文件读写的 IO 在 handler 里，但「哪些条目该进、哪些该跳、
 * 哪些变孤儿」是纯函数。放在一起会让三方逻辑（格式校验 / 分类 / 冲突）绞在
 * `dialog.showOpenDialog` 的回调里，一条用例都测不了。
 *
 * 【三条硬约束（改动前先读）】
 * 1. **按 `action` 分流，不看 id 前缀**。`override` 行的 id 与基线 id 相同（不带 `u-`），
 *    用前缀判断会把用户的编辑整批误杀 —— 这是本文件存在的主要理由。
 * 2. **`id` 永不因导入而改**。id 是收藏（localStorage 的 `string[]`）、React key、
 *    词条 `related` / 图解 `diagramId` 的锚，改名等于制造悬空引用。孤儿也不改名，
 *    只上报给用户选「转存为新建」或「丢弃」。
 * 3. **`action: "baseline"` 是导出文件专有值**，库里 CHECK 不允许它。导入时一律
 *    skip（源码里已有），且**无条件**（连 `overwrite` 也不碰）。
 *
 * 规范：docs/spec/interview-db-ai-spec.md §6
 */
import {
  INTERVIEW_KINDS,
  QUESTION_TRACKS,
  validatePayloadShape,
  type InterviewKind,
} from "../../src/shared/interview/payload-shape";

/** 文件格式标记。认不出这个字符串 = 不是本应用导出的文件，整包拒绝 */
export const EXPORT_FORMAT = "checkin-interview";

/** 导出文件 schema 版本。改结构时 +1，旧版文件会被整包拒绝（不写兼容层） */
export const EXPORT_SCHEMA_VERSION = 1;

/** 导入时接受的库内状态（`deleted` 不收：回收站是本地概念，不该跟着文件走） */
const IMPORTABLE_STATUSES = ["draft", "adopted", "rejected", "hidden"] as const;

/** 导出 / 导入的条目（时间字段在文件里是 ISO 字符串，入库是毫秒整数） */
export interface TransferItem {
  id: string;
  kind: InterviewKind;
  action: "baseline" | "new" | "override";
  baseId: string | null;
  status: string;
  origin: string;
  baseStamp: string | null;
  baseHash: string | null;
  ackBaseHash: string | null;
  categoryId: string | null;
  track: string | null;
  /** 列表标题。墓碑（hidden）没有 payload，标题只能靠这一列带过来 */
  title: string;
  sourceIntent: string | null;
  reviewedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  payload: unknown;
}

export interface TransferTaxonomy {
  id: string;
  action: "new";
  status: string;
  origin: string;
  label: string;
  track: string;
  orderNo: number;
  note: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ExportDocument {
  schemaVersion: number;
  format: string;
  kind: "delta" | "full";
  exportedAt: string;
  source: { appVersion: string; edition: string; device: string };
  baseline: {
    version: string;
    questions: number;
    glossary: number;
    diagrams: number;
    categories: number;
  };
  counts: { questions: number; glossary: number; diagrams: number; taxonomy: number };
  items: {
    questions: TransferItem[];
    glossary: TransferItem[];
    diagrams: TransferItem[];
    taxonomy: TransferTaxonomy[];
  };
}

/** 库内行（只需导出用到的列），由 handler 从 SQL 结果映射过来 */
export interface ExportRow {
  id: string;
  kind: string;
  action: string;
  base_id: string | null;
  status: string;
  origin: string;
  category_id: string | null;
  track: string | null;
  title: string;
  payload_json: string | null;
  base_stamp: string | null;
  base_hash: string | null;
  ack_base_hash: string | null;
  source_intent: string | null;
  reviewed_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface ExportTaxonomyRow {
  id: string;
  label: string;
  track: string;
  order_no: number;
  status: string;
  origin: string;
  note: string | null;
  created_at: number;
  updated_at: number;
}

function toIso(ms: number | null | undefined): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function parseJsonOrNull(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** 分组键：库内 `kind` → 文件里的三个数组 */
const KIND_GROUP: Record<string, "questions" | "glossary" | "diagrams"> = {
  question: "questions",
  glossary: "glossary",
  diagram: "diagrams",
};

export interface BuildExportParams {
  kind: "delta" | "full";
  rows: ExportRow[];
  taxonomy: ExportTaxonomyRow[];
  /** full 模式的基线快照（渲染层序列化后传进来 —— 主进程读不到基线常量） */
  baselineItems?: {
    questions?: unknown[];
    glossary?: unknown[];
    diagrams?: unknown[];
  };
  baseline: ExportDocument["baseline"];
  filters?: { kinds?: string[]; categoryIds?: string[] };
  source: ExportDocument["source"];
  now: number;
}

/**
 * 拼导出文件。
 *
 * `full` 模式的基线快照以 `action: "baseline"` 追加在**每个数组的末尾**（增量在前）：
 * 导入端先处理增量、后跳过 baseline，顺序不影响结果，但人肉看文件时增量在最前面
 * 更容易核对。
 */
export function buildExportDocument(params: BuildExportParams): ExportDocument {
  const kinds = params.filters?.kinds?.length ? new Set(params.filters.kinds) : null;
  const categories = params.filters?.categoryIds?.length
    ? new Set(params.filters.categoryIds)
    : null;

  const items: {
    questions: TransferItem[];
    glossary: TransferItem[];
    diagrams: TransferItem[];
  } = {
    questions: [],
    glossary: [],
    diagrams: [],
  };

  for (const row of params.rows) {
    if (!INTERVIEW_KINDS.includes(row.kind as InterviewKind)) continue;
    if (kinds && !kinds.has(row.kind)) continue;
    if (categories && (!row.category_id || !categories.has(row.category_id))) continue;
    const group = KIND_GROUP[row.kind];
    items[group].push({
      id: row.id,
      kind: row.kind as InterviewKind,
      action: row.action === "override" ? "override" : "new",
      baseId: row.base_id,
      status: row.status,
      origin: row.origin,
      baseStamp: row.base_stamp,
      baseHash: row.base_hash,
      ackBaseHash: row.ack_base_hash,
      categoryId: row.category_id,
      track: row.track,
      title: row.title,
      sourceIntent: row.source_intent,
      reviewedAt: toIso(row.reviewed_at),
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
      payload: parseJsonOrNull(row.payload_json),
    });
  }

  // 基线快照只在 full 模式下追加，且不受 kinds 过滤影响之外的部分由调用方保证
  if (params.kind === "full" && params.baselineItems) {
    for (const [group, list] of Object.entries(params.baselineItems) as Array<
      ["questions" | "glossary" | "diagrams", unknown[] | undefined]
    >) {
      if (!list?.length) continue;
      const kindValue: InterviewKind =
        group === "questions" ? "question" : group === "glossary" ? "glossary" : "diagram";
      if (kinds && !kinds.has(kindValue)) continue;
      for (const payload of list) {
        const record = payload as { id?: unknown; categoryId?: unknown };
        const id = typeof record?.id === "string" ? record.id : "";
        if (!id) continue;
        const categoryId = typeof record.categoryId === "string" ? record.categoryId : null;
        if (categories && (!categoryId || !categories.has(categoryId))) continue;
        items[group].push({
          id,
          kind: kindValue,
          // 导出文件专有值：库里 CHECK 不允许，永远不会入库
          action: "baseline",
          baseId: null,
          status: "adopted",
          origin: "baseline",
          baseStamp: null,
          baseHash: null,
          ackBaseHash: null,
          categoryId,
          track: (payload as { track?: string }).track ?? null,
          title: typeof (payload as { title?: unknown }).title === "string"
            ? (payload as { title: string }).title
            : typeof (payload as { term?: unknown }).term === "string"
              ? (payload as { term: string }).term
              : id,
          sourceIntent: null,
          reviewedAt: null,
          createdAt: null,
          updatedAt: null,
          payload,
        });
      }
    }
  }

  const taxonomy = params.taxonomy.map((row) => ({
    id: row.id,
    action: "new" as const,
    status: row.status,
    origin: row.origin,
    label: row.label,
    track: row.track,
    orderNo: row.order_no,
    note: row.note,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }));

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    format: EXPORT_FORMAT,
    kind: params.kind,
    exportedAt: new Date(params.now).toISOString(),
    source: params.source,
    baseline: params.baseline,
    counts: {
      questions: items.questions.length,
      glossary: items.glossary.length,
      diagrams: items.diagrams.length,
      taxonomy: taxonomy.length,
    },
    items: { ...items, taxonomy },
  };
}

/** 整包闸门：只查「这是不是本应用导出的、版本认不认」，逐条内容由 planImport 查 */
export function validateExportDocument(
  raw: unknown,
): { ok: true; doc: ExportDocument } | { ok: false; errors: string[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["文件内容不是一个 JSON 对象"] };
  }
  const record = raw as Record<string, unknown>;
  if (record.format !== EXPORT_FORMAT) {
    return { ok: false, errors: ["这不是面试题库的导出文件（format 不匹配）"] };
  }
  if (record.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [
        `导出文件版本是 ${String(record.schemaVersion)}，当前只能读 ${EXPORT_SCHEMA_VERSION} 版`,
      ],
    };
  }
  const items = record.items as Record<string, unknown> | undefined;
  if (!items || typeof items !== "object") {
    return { ok: false, errors: ["文件缺少 items 段"] };
  }
  for (const group of ["questions", "glossary", "diagrams", "taxonomy"]) {
    if (!Array.isArray(items[group])) {
      return { ok: false, errors: [`items.${group} 必须是数组`] };
    }
  }
  return { ok: true, doc: raw as ExportDocument };
}

/** 导入后可从库里落地的行（时间已换回毫秒） */
export interface ImportRow {
  id: string;
  kind: string;
  action: "new" | "override";
  baseId: string | null;
  status: string;
  origin: string;
  categoryId: string | null;
  track: string | null;
  title: string;
  payloadJson: string | null;
  baseStamp: string | null;
  baseHash: string | null;
  ackBaseHash: string | null;
  sourceIntent: string | null;
  reviewedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ImportTaxonomyRow {
  id: string;
  label: string;
  track: string;
  orderNo: number;
  status: string;
  origin: string;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ImportPlan {
  /** 库里没有这个 id → INSERT */
  inserts: ImportRow[];
  /** 库里已有且冲突策略为 overwrite → UPDATE（保留库内 createdAt） */
  updates: ImportRow[];
  taxonomyInserts: ImportTaxonomyRow[];
  taxonomyUpdates: ImportTaxonomyRow[];
  /** 跳过条数（baseline / 已存在且策略为 skip / 回收站里的行） */
  skipped: number;
  /** 孤儿：override 指向的基线题在这台机器上不存在。入库但不参与渲染 */
  orphaned: Array<{ id: string; title: string; baseStamp: string | null }>;
  errors: string[];
}

export interface PlanImportContext {
  conflict: "skip" | "overwrite";
  /** 增量库已有的 id（含 hidden / deleted） */
  existingIds: Set<string>;
  /**
   * 已有行的 `action`。同一 id 在库里是 `new`、文件里是 `override`（或反之）时
   * 必须拒绝：`base_id = id` 与 `id LIKE 'u-%'` 两条 CHECK 会互相矛盾，
   * 硬写进去只会得到一句数据库错误。
   */
  existingActions?: Map<string, string>;
  /** 本机基线的 id 集合（渲染层传）—— 用来判孤儿 */
  baselineIds: Set<string>;
  /** 允许的分类：22 个基线 id + 本机已采纳的自定义分类 + 本包 taxonomy */
  knownCategories: Set<string>;
}

function isoToMs(value: unknown, fallback: number): number {
  if (typeof value !== "string") return fallback;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : fallback;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * 逐条分类 + 判冲突。
 *
 * 分流顺序很重要：先按 `action` 分（baseline / new / override），再判结构，
 * 再判分类白名单，最后判冲突。反过来的话「id 已存在」会掩盖「id 前缀不对」
 * 这类真错误 —— 用户只会看到 skipped++ 而不知道为什么。
 */
export function planImport(
  doc: ExportDocument,
  context: PlanImportContext,
  now: number,
): ImportPlan {
  const plan: ImportPlan = {
    inserts: [],
    updates: [],
    taxonomyInserts: [],
    taxonomyUpdates: [],
    skipped: 0,
    orphaned: [],
    errors: [],
  };

  // 本包自带的分类也算「已知」，否则「导出再导入到干净机器」时自己的分类会把题判死
  const knownCategories = new Set(context.knownCategories);
  for (const entry of doc.items.taxonomy) {
    if (typeof entry?.id === "string") knownCategories.add(entry.id);
  }

  const groups: Array<["questions" | "glossary" | "diagrams", InterviewKind]> = [
    ["questions", "question"],
    ["glossary", "glossary"],
    ["diagrams", "diagram"],
  ];

  for (const [group, kind] of groups) {
    for (const entry of doc.items[group]) {
      if (!entry || typeof entry !== "object") {
        plan.errors.push(`${group}：有一条不是对象，已跳过`);
        continue;
      }
      const id = text(entry.id);
      if (!id) {
        plan.errors.push(`${group}：有一条缺少 id，已跳过`);
        continue;
      }

      // ① 基线快照：源码里已有，无条件跳过（连 overwrite 也不碰）
      if (entry.action === "baseline") {
        plan.skipped += 1;
        continue;
      }
      if (entry.action !== "new" && entry.action !== "override") {
        plan.errors.push(`${id}：action 只能是 new / override，已跳过`);
        continue;
      }

      // ② id 与覆盖关系（不看前缀会误杀 override，只看前缀会放过错配）
      if (entry.action === "new" && !id.startsWith("u-")) {
        plan.errors.push(`${id}：标记为新建但 id 没有 u- 前缀，已跳过`);
        continue;
      }
      if (entry.action === "override" && entry.baseId !== id) {
        plan.errors.push(`${id}：覆盖条目的 baseId 必须与 id 相同，已跳过`);
        continue;
      }

      // ③ 状态：回收站不跟着文件走
      if (!(IMPORTABLE_STATUSES as readonly string[]).includes(entry.status)) {
        plan.skipped += 1;
        continue;
      }

      // ④ 结构校验（隐藏条目的 payload 必须为空，标题走 title 列）
      let payloadJson: string | null = null;
      let title: string;
      if (entry.status === "hidden") {
        title = text(entry.title) ?? id;
      } else {
        const checked = validatePayloadShape(kind, entry.payload);
        if (!checked.ok) {
          plan.errors.push(`${id}：${checked.errors[0]}`);
          continue;
        }
        payloadJson = JSON.stringify(checked.value);
        const value = checked.value as unknown as Record<string, unknown>;
        title = text(value.term) ?? text(value.title) ?? text(entry.title) ?? id;
      }

      // ⑤ 分类白名单：既不在基线、也不在本机自定义、也不在本包里 → 该条会悬空
      const categoryId = text(entry.categoryId);
      if (categoryId && !knownCategories.has(categoryId)) {
        plan.errors.push(`${id}：分类 ${categoryId} 在本机不存在，已跳过`);
        continue;
      }

      const row: ImportRow = {
        id,
        kind,
        action: entry.action,
        baseId: entry.action === "override" ? id : null,
        status: entry.status,
        origin: text(entry.origin) ?? "seed-import",
        categoryId,
        track: text(entry.track),
        title,
        payloadJson,
        baseStamp: text(entry.baseStamp),
        baseHash: text(entry.baseHash),
        ackBaseHash: text(entry.ackBaseHash),
        sourceIntent: text(entry.sourceIntent),
        reviewedAt: entry.reviewedAt ? isoToMs(entry.reviewedAt, now) : null,
        createdAt: isoToMs(entry.createdAt, now),
        updatedAt: isoToMs(entry.updatedAt, now),
      };

      // ⑥ 覆盖关系指向的基线题在这台机器上不存在 → 孤儿（入库，但不渲染）
      if (entry.action === "override" && !context.baselineIds.has(id)) {
        plan.orphaned.push({ id, title, baseStamp: row.baseStamp });
      }

      // ⑦ 冲突
      if (context.existingIds.has(id)) {
        const existingAction = context.existingActions?.get(id);
        // 覆盖关系不能靠 UPDATE 改出来：action 一变，base_id 与 id 前缀的 CHECK 必有一条不成立
        if (existingAction && existingAction !== entry.action) {
          plan.errors.push(`${id}：库里这条是「${existingAction === "new" ? "我的新建" : "覆盖基线"}」，与文件里的来源类型不同，已跳过`);
          continue;
        }
        if (context.conflict === "skip") {
          plan.skipped += 1;
          continue;
        }
        plan.updates.push(row);
        continue;
      }
      plan.inserts.push(row);
    }
  }

  for (const entry of doc.items.taxonomy) {
    if (!entry || typeof entry !== "object") continue;
    const id = text(entry.id);
    if (!id || !id.startsWith("u-c-")) {
      plan.errors.push(`${String(entry.id)}：分类 id 必须以 u-c- 开头，已跳过`);
      continue;
    }
    const label = text(entry.label);
    if (!label || label.length > 12) {
      plan.errors.push(`${id}：分类名称缺失或超过 12 字，已跳过`);
      continue;
    }
    const track = text(entry.track);
    if (!track || !(QUESTION_TRACKS as readonly string[]).includes(track)) {
      plan.errors.push(`${id}：轨道只能是 written / foundation，已跳过`);
      continue;
    }
    const row: ImportTaxonomyRow = {
      id,
      label,
      track,
      // 新增分类一律排在基线之后
      orderNo: typeof entry.orderNo === "number" && entry.orderNo >= 100 ? entry.orderNo : 100,
      status: entry.status === "adopted" ? "adopted" : "draft",
      origin: text(entry.origin) ?? "seed-import",
      note: text(entry.note),
      createdAt: isoToMs(entry.createdAt, now),
      updatedAt: isoToMs(entry.updatedAt, now),
    };
    if (context.existingIds.has(id)) {
      if (context.conflict === "skip") {
        plan.skipped += 1;
        continue;
      }
      plan.taxonomyUpdates.push(row);
      continue;
    }
    plan.taxonomyInserts.push(row);
  }

  return plan;
}
