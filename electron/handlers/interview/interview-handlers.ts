/**
 * 面试题库 IPC（interview.db：产物 / 分类 / 元信息）
 *
 * 全部读写的 SQL 只出现在本文件与 `interview-db.ts`。渲染层唯一入口是
 * `preload.ts` 的 `interview` 命名空间（白名单，不接受任意通道）。
 *
 * 【本文件只做「结构校验 + 状态机」，不做领域校验】
 * 分类白名单、图解 id 引用、词条键唯一都依赖渲染层的基线常量，主进程从不
 * import 渲染层。所以这里只跑 `src/shared/interview/payload-shape.ts` 的结构层
 * （挡手构造的非法 payload、挡导入的脏文件）；领域层错误由渲染层自己算好，
 * 通过 `errors` 字段带进来落进 `errors_json`，用于草稿箱里的红字展示。
 *
 * 【四条不变量（改动前先读）】
 * 1. **id 不许改**。覆盖基线题时 `id` 必须等于基线 id —— 收藏存在 localStorage
 *    的 `string[]` 里按 id 比对，换 id 等于用户收藏全丢。所以 save 只做 upsert
 *    同一 id，任何「改 id」的请求都会被 CHECK 约束拒掉。
 * 2. **`action` 落库后不可变**。已存在的行只能按原 action 继续写；把 new 改成
 *    override（或反之）会让 `base_id = id` / `id LIKE 'u-%'` 这两条 CHECK 互相矛盾。
 * 3. **墓碑（hidden）不带 payload**。删除基线题时 payload 必须清空，否则库里会
 *    同时存在「已删除」和一份可被误读的内容副本。
 * 4. **回收站只收用户自建**。override 行的删除是「还原默认」（删行），不是进
 *    回收站；purge 的 SQL 必带 `action='new'`，否则删掉墓碑后升级会让题复活。
 *
 * 规范：docs/spec/interview-db-ai-spec.md §4 / §5 / §11
 */
import { BrowserWindow, dialog, ipcMain } from "electron";
import { app } from "electron";
import fs from "node:fs";
import { log } from "../../core/logger";
import {
  INTERVIEW_META_KEYS,
  interviewAll,
  interviewGet,
  interviewRun,
  interviewTransaction,
  isInterviewDbReady,
  readInterviewMeta,
  setInterviewMeta,
} from "../../interview/interview-db";
import {
  buildExportDocument,
  planImport,
  validateExportDocument,
  type ExportRow,
  type ExportTaxonomyRow,
  type ImportRow,
  type ImportTaxonomyRow,
} from "../../interview/interview-transfer";
import {
  INTERVIEW_KINDS,
  QUESTION_TRACKS,
  isValidDiagramShape,
  isValidGlossaryShape,
  isValidQuestionShape,
  validatePayloadShape,
  type InterviewKind,
} from "../../../src/shared/interview/payload-shape";

/** 未登录 / 换用户中：所有读通道返回空，写通道返回失败，调用方按「暂无数据」处理 */
const NOT_READY = { ok: false as const, code: "not_ready" as const, errors: ["题库数据尚未就绪"] };

interface ItemRow {
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
  errors_json: string | null;
  source_intent: string | null;
  ai_log_id: number | null;
  reviewed_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

/** 列表项：**不含 payload**（一屏几十道题的答案加起来就是几百 KB） */
export interface InterviewItemSummary {
  id: string;
  kind: string;
  action: string;
  baseId: string | null;
  status: string;
  origin: string;
  categoryId: string | null;
  track: string | null;
  title: string;
  errors: string[];
  updatedAt: number;
}

/** 单条详情：payload 已解析为对象，正文只从这里出 */
export interface InterviewItemDetail extends InterviewItemSummary {
  payload: unknown;
  sourceIntent: string | null;
  aiLogId: number | null;
  baseStamp: string | null;
  baseHash: string | null;
  ackBaseHash: string | null;
  reviewedAt: number | null;
  createdAt: number;
  deletedAt: number | null;
}

export interface InterviewTaxonomyRow {
  id: string;
  label: string;
  track: string;
  orderNo: number;
  status: string;
  origin: string;
  note: string | null;
  updatedAt: number;
}

const ITEM_COLUMNS = `id, kind, action, base_id, status, origin, category_id, track, title,
  payload_json, base_stamp, base_hash, ack_base_hash, errors_json, source_intent,
  ai_log_id, reviewed_at, created_at, updated_at, deleted_at`;

/** JSON 解析兜底：库里是 TEXT，坏一条不该让整页炸 */
function parseJson<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function toSummary(row: ItemRow): InterviewItemSummary {
  return {
    id: row.id,
    kind: row.kind,
    action: row.action,
    baseId: row.base_id,
    status: row.status,
    origin: row.origin,
    categoryId: row.category_id,
    track: row.track,
    title: row.title,
    errors: parseJson<string[]>(row.errors_json, []),
    updatedAt: row.updated_at,
  };
}

function toDetail(row: ItemRow): InterviewItemDetail {
  return {
    ...toSummary(row),
    payload: parseJson<unknown>(row.payload_json, null),
    sourceIntent: row.source_intent,
    aiLogId: row.ai_log_id,
    baseStamp: row.base_stamp,
    baseHash: row.base_hash,
    ackBaseHash: row.ack_base_hash,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}

function isInterviewKind(value: unknown): value is InterviewKind {
  return typeof value === "string" && (INTERVIEW_KINDS as readonly string[]).includes(value);
}

/**
 * 从 payload 里取列表标题。
 *
 * 为什么不信客户端传的 `title`：列表、去重、搜索都用这一列，一旦与 payload 里的
 * 标题不一致，「列表显示 A、点开是 B」，而且没有任何地方会报错。所以能从 payload
 * 拿到就以 payload 为准，只有墓碑（payload 已清空）才回落到入参。
 */
function titleOfPayload(kind: InterviewKind, payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const candidate =
    kind === "question" ? record.title : kind === "glossary" ? record.term : record.title;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

/** 词条改动后 +1，渲染层据此判断行内高亮的关键词表要不要重建 */
function bumpGlossaryVersion(): number {
  const current = Number(readInterviewMeta(INTERVIEW_META_KEYS.glossaryVersion) ?? "0");
  const next = (Number.isFinite(current) ? current : 0) + 1;
  setInterviewMeta(INTERVIEW_META_KEYS.glossaryVersion, String(next));
  return next;
}

/** 结构层复检（restore / set-status 这些「不重新传 payload」的通道也要过一遍） */
function payloadStillValid(kind: InterviewKind, payload: unknown): boolean {
  if (kind === "question") return isValidQuestionShape(payload).ok;
  if (kind === "glossary") return isValidGlossaryShape(payload).ok;
  return isValidDiagramShape(payload).ok;
}

interface SavePayload {
  id: string;
  kind: InterviewKind;
  action: "new" | "override";
  baseId?: string | null;
  payload?: unknown;
  status: string;
  categoryId?: string | null;
  track?: string | null;
  title?: string;
  errors?: string[];
  sourceIntent?: string | null;
  aiLogId?: number | null;
  baseStamp?: string | null;
  baseHash?: string | null;
}

const SAVE_STATUSES = ["draft", "adopted", "rejected", "hidden"] as const;

export function registerInterviewHandlers(): void {
  // ── 列表 ──
  /**
   * 列表通道。
   *
   * `withPayload` 只在**合并视图**上开：渲染层要把「基线 ∪ 增量」合成一份，
   * 需要全量 payload，逐条 `interview-item-get` 会打几十次 IPC。
   * **一屏列表不要开** —— 几十道题的答案加起来就是几百 KB 的载荷，
   * 而列表只需要标题 / 分类 / 状态这些几列。
   */
  ipcMain.handle(
    "interview-items-list",
    (
      _event,
      query?: {
        kind?: string;
        status?: string;
        categoryId?: string;
        includeDeleted?: boolean;
        withPayload?: boolean;
      },
    ): InterviewItemSummary[] | InterviewItemDetail[] => {
      if (!isInterviewDbReady()) return [];
      const where: string[] = [];
      const params: unknown[] = [];
      if (query?.kind && query.kind !== "all") {
        if (!isInterviewKind(query.kind)) return [];
        where.push("kind = ?");
        params.push(query.kind);
      }
      if (query?.status && query.status !== "all") {
        where.push("status = ?");
        params.push(query.status);
      } else {
        // 默认不返回回收站：deleted 行只在 includeDeleted 时出
        if (!query?.includeDeleted) where.push("status <> 'deleted'");
      }
      if (query?.categoryId) {
        where.push("category_id = ?");
        params.push(query.categoryId);
      }
      const sql = `SELECT ${ITEM_COLUMNS} FROM interview_item${
        where.length ? ` WHERE ${where.join(" AND ")}` : ""
      } ORDER BY updated_at DESC`;
      const rows = interviewAll(sql, params) as ItemRow[];
      return query?.withPayload ? rows.map(toDetail) : rows.map(toSummary);
    },
  );

  // ── 单条详情（payload 只在这里出）──
  ipcMain.handle("interview-item-get", (_event, payload?: { id?: string }) => {
    if (!isInterviewDbReady()) return null;
    if (!payload?.id) return null;
    const row = interviewGet(`SELECT ${ITEM_COLUMNS} FROM interview_item WHERE id = ?`, [
      payload.id,
    ]) as ItemRow | undefined;
    return row ? toDetail(row) : null;
  });

  // ── 保存（新建 / 覆盖 / 墓碑）──
  ipcMain.handle("interview-item-save", (_event, payload?: SavePayload) => {
    if (!isInterviewDbReady()) return NOT_READY;
    if (!payload?.id || !isInterviewKind(payload.kind)) {
      return { ok: false, errors: ["缺少题目类型或 id"] };
    }
    const kind = payload.kind;
    if (payload.action !== "new" && payload.action !== "override") {
      return { ok: false, errors: ["action 只能是 new 或 override"] };
    }
    if (!(SAVE_STATUSES as readonly string[]).includes(payload.status)) {
      return { ok: false, errors: [`状态只能是 ${SAVE_STATUSES.join(" / ")} 之一`] };
    }

    // 不变量 1 & 2：id 与 action 的关系在写入前先判一次，给出人话错误；
    // SQL 的 CHECK 是最后一道闸（防的是绕过本函数的写入）
    const existing = interviewGet(
      "SELECT action, title, payload_json, origin FROM interview_item WHERE id = ?",
      [payload.id],
    ) as Pick<ItemRow, "action" | "title" | "payload_json" | "origin"> | undefined;
    if (existing && existing.action !== payload.action) {
      return { ok: false, errors: ["已存在的记录不能改变来源类型（新建 / 覆盖）"] };
    }
    if (payload.action === "new" && !payload.id.startsWith("u-")) {
      return { ok: false, errors: ["用户新建的 id 必须以 u- 开头"] };
    }
    if (payload.action === "override" && payload.baseId !== payload.id) {
      return { ok: false, errors: ["覆盖基线题时 baseId 必须与 id 相同"] };
    }

    const isHidden = payload.status === "hidden";
    let payloadJson: string | null = null;
    let title: string;

    if (isHidden) {
      // 墓碑：payload 必须清空，标题沿用基线（入参或库里已有的）
      const inherited = (payload.title ?? existing?.title ?? "").trim();
      if (!inherited) return { ok: false, errors: ["隐藏基线题需要提供标题"] };
      title = inherited;
    } else {
      const checked = validatePayloadShape(kind, payload.payload);
      if (!checked.ok) return { ok: false, errors: checked.errors };
      payloadJson = JSON.stringify(checked.value);
      title = titleOfPayload(kind, checked.value) ?? (payload.title ?? "").trim();
      if (!title) return { ok: false, errors: ["标题不能为空"] };
    }

    const now = Date.now();
    const errors = Array.isArray(payload.errors) ? payload.errors.slice(0, 20) : [];
    // categoryId / track 以 payload 里的为准（客户端单独传的那两个字段只在
    // payload 没有时才采纳），否则列表按分类筛选会出现「分类对不上内容」的题
    const shape = payloadJson ? parseJson<Record<string, unknown>>(payloadJson, {}) : {};
    const categoryId =
      (shape.categoryId as string | undefined) ?? payload.categoryId ?? null;
    const track = kind === "question" ? ((shape.track as string | undefined) ?? payload.track ?? null) : null;

    try {
      interviewRun(
        `INSERT INTO interview_item (
           id, kind, action, base_id, status, origin, category_id, track, title,
           payload_json, base_stamp, base_hash, errors_json, source_intent, ai_log_id,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           category_id = excluded.category_id,
           track = excluded.track,
           title = excluded.title,
           payload_json = excluded.payload_json,
           base_stamp = COALESCE(excluded.base_stamp, interview_item.base_stamp),
           base_hash = COALESCE(excluded.base_hash, interview_item.base_hash),
           errors_json = excluded.errors_json,
           source_intent = excluded.source_intent,
           ai_log_id = COALESCE(excluded.ai_log_id, interview_item.ai_log_id),
           reviewed_at = CASE WHEN excluded.status = 'adopted' THEN ? ELSE interview_item.reviewed_at END,
           updated_at = excluded.updated_at`,
        [
          payload.id,
          kind,
          payload.action,
          payload.action === "override" ? payload.id : null,
          payload.status,
          payload.sourceIntent ? "ai" : existing?.origin ?? "manual",
          categoryId,
          track,
          title,
          payloadJson,
          payload.baseStamp ?? null,
          payload.baseHash ?? null,
          errors.length ? JSON.stringify(errors) : null,
          payload.sourceIntent ?? null,
          payload.aiLogId ?? null,
          now,
          now,
          now,
        ],
      );
    } catch (error) {
      // CHECK 约束失败 / 唯一冲突：把原因原样带回，别让 UI 只剩「保存失败」
      log("warn", "interview", "interview-handlers", "保存被数据库拒绝", {
        id: payload.id,
        error: String(error),
      });
      return { ok: false, errors: [`保存被拒绝：${String(error)}`] };
    }

    const glossaryVersion = kind === "glossary" ? bumpGlossaryVersion() : undefined;
    return { ok: true, id: payload.id, ...(glossaryVersion ? { glossaryVersion } : {}) };
  });

  // ── 改状态（草稿 / 采纳 / 驳回）──
  ipcMain.handle(
    "interview-item-set-status",
    (_event, payload?: { id?: string; status?: string }) => {
      if (!isInterviewDbReady()) return NOT_READY;
      const status = payload?.status;
      if (!payload?.id || !status) return { ok: false, errors: ["缺少 id 或状态"] };
      if (!["draft", "adopted", "rejected"].includes(status)) {
        return { ok: false, errors: ["只能改为 草稿 / 已采纳 / 已驳回"] };
      }
      const row = interviewGet(
        "SELECT kind, action, status, payload_json FROM interview_item WHERE id = ?",
        [payload.id],
      ) as Pick<ItemRow, "kind" | "action" | "status" | "payload_json"> | undefined;
      if (!row) return { ok: false, errors: ["这条内容不存在"] };
      if (row.status === "hidden" || row.status === "deleted") {
        return { ok: false, errors: ["已隐藏或已删除的内容不能改状态"] };
      }
      // 采纳前必须再验一次结构：草稿可能是旧版本模板产出的，规则变过
      if (status === "adopted" && isInterviewKind(row.kind)) {
        if (!payloadStillValid(row.kind, parseJson<unknown>(row.payload_json, null))) {
          return { ok: false, errors: ["内容结构不合法，不能采纳"] };
        }
      }
      const now = Date.now();
      interviewRun(
        `UPDATE interview_item SET status = ?, updated_at = ?,
           reviewed_at = CASE WHEN ? = 'adopted' THEN ? ELSE reviewed_at END
         WHERE id = ?`,
        [status, now, status, now, payload.id],
      );
      const glossaryVersion =
        status === "adopted" && row.kind === "glossary" ? bumpGlossaryVersion() : undefined;
      return { ok: true, ...(glossaryVersion ? { glossaryVersion } : {}) };
    },
  );

  // ── 软删（只收用户自建；override 的删除是「还原默认」）──
  ipcMain.handle("interview-item-delete", (_event, payload?: { id?: string }) => {
    if (!isInterviewDbReady()) return NOT_READY;
    if (!payload?.id) return { ok: false, errors: ["缺少 id"] };
    const row = interviewGet("SELECT action FROM interview_item WHERE id = ?", [payload.id]) as
      | { action: string }
      | undefined;
    if (!row) return { ok: false, code: "not_found", errors: ["这条内容不存在"] };
    if (row.action !== "new") {
      return { ok: false, code: "use_revert", errors: ["基线题请用「还原默认」"] };
    }
    const now = Date.now();
    interviewRun(
      "UPDATE interview_item SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ? AND action = 'new'",
      [now, now, payload.id],
    );
    return { ok: true };
  });

  // ── 从回收站恢复 ──
  ipcMain.handle("interview-item-restore", (_event, payload?: { id?: string }) => {
    if (!isInterviewDbReady()) return NOT_READY;
    if (!payload?.id) return { ok: false, errors: ["缺少 id"] };
    const row = interviewGet(
      "SELECT kind, action, status, payload_json FROM interview_item WHERE id = ?",
      [payload.id],
    ) as Pick<ItemRow, "kind" | "action" | "status" | "payload_json"> | undefined;
    if (!row) return { ok: false, code: "not_found", errors: ["这条内容不存在"] };
    if (row.status !== "deleted") return { ok: false, code: "not_deleted", errors: ["这条内容不在回收站"] };
    // 恢复后回到「已采纳」；若结构已被规则变更判为不合法，退成草稿让人重新过一遍，
    // 而不是把非法内容直接放回列表
    const valid = isInterviewKind(row.kind)
      ? payloadStillValid(row.kind, parseJson<unknown>(row.payload_json, null))
      : false;
    const now = Date.now();
    interviewRun(
      "UPDATE interview_item SET status = ?, deleted_at = NULL, updated_at = ? WHERE id = ?",
      [valid ? "adopted" : "draft", now, payload.id],
    );
    return { ok: true };
  });

  // ── 彻底删除（不变量 4：SQL 必带 action='new'）──
  ipcMain.handle("interview-item-purge", (_event, payload?: { id?: string }) => {
    if (!isInterviewDbReady()) return NOT_READY;
    if (!payload?.id) return { ok: false, errors: ["缺少 id"] };
    const result = interviewRun("DELETE FROM interview_item WHERE id = ? AND action = 'new'", [
      payload.id,
    ]);
    if (result.changes === 0) {
      const row = interviewGet("SELECT action FROM interview_item WHERE id = ?", [payload.id]) as
        | { action: string }
        | undefined;
      // 打到 override 行：那是用户对基线题的编辑，只能「还原默认」
      if (row) return { ok: false, code: "use_restore", errors: ["基线题只能还原默认，不能彻底删除"] };
      return { ok: false, code: "not_found", errors: ["这条内容不存在"] };
    }
    return { ok: true };
  });

  // ── 还原默认（删 override 行，合并时自然回落基线）──
  ipcMain.handle("interview-item-revert-default", (_event, payload?: { id?: string }) => {
    if (!isInterviewDbReady()) return NOT_READY;
    if (!payload?.id) return { ok: false, errors: ["缺少 id"] };
    const result = interviewRun("DELETE FROM interview_item WHERE id = ? AND action = 'override'", [
      payload.id,
    ]);
    if (result.changes === 0) {
      return { ok: false, code: "not_overridden", errors: ["这道题没有被你改过，无需还原"] };
    }
    return { ok: true };
  });

  // ── 确认「基线已更新，沿用我的」（只记指纹，内容不动）──
  ipcMain.handle("interview-item-ack-base", (_event, payload?: { id?: string; baseHash?: string }) => {
    if (!isInterviewDbReady()) return NOT_READY;
    if (!payload?.id || !payload.baseHash) return { ok: false, errors: ["缺少 id 或基线指纹"] };
    const result = interviewRun(
      "UPDATE interview_item SET ack_base_hash = ?, updated_at = ? WHERE id = ? AND action = 'override'",
      [payload.baseHash, Date.now(), payload.id],
    );
    if (result.changes === 0) {
      return { ok: false, code: "not_overridden", errors: ["这道题没有被你改过"] };
    }
    return { ok: true };
  });

  // ── 分类 ──
  ipcMain.handle(
    "interview-taxonomy-list",
    (_event, query?: { track?: string; status?: string }): InterviewTaxonomyRow[] => {
      if (!isInterviewDbReady()) return [];
      const where = ["deleted_at IS NULL"];
      const params: unknown[] = [];
      if (query?.track) {
        where.push("track = ?");
        params.push(query.track);
      }
      if (query?.status) {
        where.push("status = ?");
        params.push(query.status);
      }
      const rows = interviewAll(
        `SELECT id, label, track, order_no, status, origin, note, updated_at
           FROM interview_taxonomy WHERE ${where.join(" AND ")} ORDER BY order_no ASC`,
        params,
      ) as Array<{
        id: string;
        label: string;
        track: string;
        order_no: number;
        status: string;
        origin: string;
        note: string | null;
        updated_at: number;
      }>;
      return rows.map((row) => ({
        id: row.id,
        label: row.label,
        track: row.track,
        orderNo: row.order_no,
        status: row.status,
        origin: row.origin,
        note: row.note,
        updatedAt: row.updated_at,
      }));
    },
  );

  ipcMain.handle(
    "interview-taxonomy-save",
    (
      _event,
      payload?: {
        id?: string;
        label?: string;
        track?: string;
        orderNo?: number;
        status?: string;
        note?: string | null;
      },
    ) => {
      if (!isInterviewDbReady()) return NOT_READY;
      const id = payload?.id?.trim();
      const label = payload?.label?.trim();
      if (!id || !id.startsWith("u-c-")) {
        return { ok: false, errors: ["新增分类的 id 必须以 u-c- 开头"] };
      }
      if (!label) return { ok: false, errors: ["分类名称不能为空"] };
      if (label.length > 12) return { ok: false, errors: ["分类名称最多 12 字（侧栏一行放不下）"] };
      const track = payload?.track;
      if (!track || !(QUESTION_TRACKS as readonly string[]).includes(track)) {
        return { ok: false, errors: [`轨道只能是 ${QUESTION_TRACKS.join(" / ")}`] };
      }
      const status = payload?.status ?? "draft";
      if (!["draft", "adopted"].includes(status)) {
        return { ok: false, errors: ["分类状态只能是 草稿 / 已采纳"] };
      }
      // 新增分类一律排在基线之后（order_no >= 100），否则侧栏顺序会插进既有分组
      const orderNo =
        typeof payload?.orderNo === "number" && payload.orderNo >= 100 ? payload.orderNo : 100;
      const now = Date.now();
      try {
        interviewRun(
          `INSERT INTO interview_taxonomy (id, label, track, order_no, status, origin, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             label = excluded.label,
             track = excluded.track,
             order_no = excluded.order_no,
             status = excluded.status,
             note = excluded.note,
             updated_at = excluded.updated_at`,
          [id, label, track, orderNo, status, payload?.note ?? null, now, now],
        );
      } catch (error) {
        log("warn", "interview", "interview-handlers", "分类保存被数据库拒绝", {
          id,
          error: String(error),
        });
        return { ok: false, errors: [`保存被拒绝：${String(error)}`] };
      }
      return { ok: true, id };
    },
  );

  // ── 导出（内部弹保存框；文件读写走 fs，不新增依赖）──
  ipcMain.handle(
    "interview-export",
    async (
      event,
      payload?: {
        mode?: "delta" | "full";
        kinds?: string[];
        categoryIds?: string[];
        baseline?: {
          version: string;
          questions: number;
          glossary: number;
          diagrams: number;
          categories: number;
        };
        baselineItems?: {
          questions?: unknown[];
          glossary?: unknown[];
          diagrams?: unknown[];
        };
      },
    ) => {
      if (!isInterviewDbReady()) return null;
      const mode = payload?.mode === "full" ? "full" : "delta";

      const rows = interviewAll(
        `SELECT id, kind, action, base_id, status, origin, category_id, track, title,
                payload_json, base_stamp, base_hash, ack_base_hash, source_intent,
                reviewed_at, created_at, updated_at
           FROM interview_item WHERE status <> 'deleted' ORDER BY updated_at ASC`,
      ) as ExportRow[];
      const taxonomyRows = interviewAll(
        `SELECT id, label, track, order_no, status, origin, note, created_at, updated_at
           FROM interview_taxonomy WHERE deleted_at IS NULL ORDER BY order_no ASC`,
      ) as ExportTaxonomyRow[];

      const now = Date.now();
      const doc = buildExportDocument({
        kind: mode,
        rows,
        taxonomy: taxonomyRows,
        baselineItems: mode === "full" ? payload?.baselineItems : undefined,
        baseline: payload?.baseline ?? {
          version: readInterviewMeta(INTERVIEW_META_KEYS.baselineVersion) ?? "",
          questions: 0,
          glossary: 0,
          diagrams: 0,
          categories: 0,
        },
        filters: { kinds: payload?.kinds, categoryIds: payload?.categoryIds },
        source: {
          appVersion: app.getVersion(),
          edition: __CHECKIN_EDITION__,
          device: process.platform,
        },
        now,
      });

      const win = BrowserWindow.fromWebContents(event.sender);
      const stamp = new Date(now).toISOString().slice(0, 10);
      const options = {
        defaultPath: `面试题库-${mode === "full" ? "完整" : "增量"}-${stamp}.json`,
        filters: [{ name: "题库备份", extensions: ["json"] }],
      };
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return null;

      let target = result.filePath;
      if (!target.toLowerCase().endsWith(".json")) target += ".json";
      fs.writeFileSync(target, JSON.stringify(doc, null, 2), "utf-8");
      setInterviewMeta(INTERVIEW_META_KEYS.lastExportAt, String(now));
      return { ok: true as const, path: target, counts: doc.counts };
    },
  );

  // ── 导入（三分流 + 冲突策略 + 孤儿上报）──
  ipcMain.handle(
    "interview-import",
    async (
      event,
      payload?: {
        path?: string;
        mode?: "merge" | "replace";
        conflict?: "skip" | "overwrite";
        /** 本机基线的 id（渲染层传 —— 主进程读不到基线常量） */
        baselineIds?: string[];
        /** 本机已知分类（22 个基线 id + 已采纳的自定义分类） */
        knownCategoryIds?: string[];
      },
    ) => {
      if (!isInterviewDbReady()) return null;
      let sourcePath = payload?.path;
      if (!sourcePath) {
        const win = BrowserWindow.fromWebContents(event.sender);
        const options = {
          properties: ["openFile"] as Array<"openFile">,
          filters: [{ name: "题库备份", extensions: ["json"] }],
        };
        const picked = win
          ? await dialog.showOpenDialog(win, options)
          : await dialog.showOpenDialog(options);
        if (picked.canceled || picked.filePaths.length === 0) return null;
        sourcePath = picked.filePaths[0];
      }

      let raw: unknown;
      try {
        raw = JSON.parse(fs.readFileSync(sourcePath, "utf-8")) as unknown;
      } catch (error) {
        log("warn", "interview", "interview-handlers", "导入文件读取失败", {
          path: sourcePath,
          error: String(error),
        });
        return { ok: false as const, errors: ["文件读不出来，可能不是 JSON 或不完整"] };
      }

      const checked = validateExportDocument(raw);
      if (!checked.ok) return { ok: false as const, errors: checked.errors };
      const doc = checked.doc;

      const mode = payload?.mode === "replace" ? "replace" : "merge";
      const conflict = payload?.conflict === "overwrite" ? "overwrite" : "skip";
      const now = Date.now();

      const existing = interviewAll(
        "SELECT id, action FROM interview_item",
      ) as Array<{ id: string; action: string }>;
      const existingActions = new Map(existing.map((row) => [row.id, row.action]));
      const taxonomyExisting = interviewAll("SELECT id FROM interview_taxonomy") as Array<{
        id: string;
      }>;
      const existingIds = new Set<string>([
        ...existing.map((row) => row.id),
        ...taxonomyExisting.map((row) => row.id),
      ]);

      const baselineIds = new Set(payload?.baselineIds ?? []);
      const knownCategories = new Set(payload?.knownCategoryIds ?? []);

      // replace：先软删「我新增的」，override / hidden 一行不动 —— 那是用户对
      // 基线题的编辑，不属于「导入的内容」。被软删的 id 之后按 UPDATE 复活，
      // 否则同一份文件导入两次就会出现「第二次全是 skipped、内容却不见了」。
      const wipedIds = new Set<string>();
      if (mode === "replace") {
        for (const row of existing) {
          if (row.action === "new") wipedIds.add(row.id);
        }
      }
      // replace 时「我新增的」在库里只剩墓碑，不该再参与冲突判定
      for (const id of wipedIds) existingIds.delete(id);

      const plan = planImport(doc, { conflict, existingIds, existingActions, baselineIds, knownCategories }, now);
      // 被本轮软删的 id 走 UPDATE 复活，避免主键冲突
      const revived: ImportRow[] = [];
      const stillInserts: ImportRow[] = [];
      for (const row of plan.inserts) {
        if (wipedIds.has(row.id)) revived.push(row);
        else stillInserts.push(row);
      }

      const applyRow = (row: ImportRow): void => {
        interviewRun(
          `INSERT INTO interview_item (
             id, kind, action, base_id, status, origin, category_id, track, title,
             payload_json, base_stamp, base_hash, ack_base_hash, source_intent,
             reviewed_at, created_at, updated_at, deleted_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
           ON CONFLICT(id) DO UPDATE SET
             status = excluded.status,
             origin = excluded.origin,
             category_id = excluded.category_id,
             track = excluded.track,
             title = excluded.title,
             payload_json = excluded.payload_json,
             base_stamp = excluded.base_stamp,
             base_hash = excluded.base_hash,
             ack_base_hash = excluded.ack_base_hash,
             source_intent = excluded.source_intent,
             reviewed_at = excluded.reviewed_at,
             updated_at = excluded.updated_at,
             deleted_at = NULL`,
          [
            row.id,
            row.kind,
            row.action,
            row.baseId,
            row.status,
            row.origin,
            row.categoryId,
            row.track,
            row.title,
            row.payloadJson,
            row.baseStamp,
            row.baseHash,
            row.ackBaseHash,
            row.sourceIntent,
            row.reviewedAt,
            row.createdAt,
            row.updatedAt,
          ],
        );
      };

      const applyTaxonomy = (row: ImportTaxonomyRow): void => {
        interviewRun(
          `INSERT INTO interview_taxonomy (id, label, track, order_no, status, origin, note, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
           ON CONFLICT(id) DO UPDATE SET
             label = excluded.label,
             track = excluded.track,
             order_no = excluded.order_no,
             status = excluded.status,
             origin = excluded.origin,
             note = excluded.note,
             updated_at = excluded.updated_at,
             deleted_at = NULL`,
          [
            row.id,
            row.label,
            row.track,
            row.orderNo,
            row.status,
            row.origin,
            row.note,
            row.createdAt,
            row.updatedAt,
          ],
        );
      };

      try {
        interviewTransaction(() => {
          if (mode === "replace" && wipedIds.size > 0) {
            interviewRun(
              "UPDATE interview_item SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE action = 'new'",
              [now, now],
            );
          }
          for (const row of [...stillInserts, ...plan.updates, ...revived]) applyRow(row);
          for (const row of plan.taxonomyInserts) applyTaxonomy(row);
          for (const row of plan.taxonomyUpdates) applyTaxonomy(row);
        });
      } catch (error) {
        // 事务已回滚：把原因带回去，别让 UI 只剩「导入失败」
        log("warn", "interview", "interview-handlers", "导入事务失败已回滚", {
          error: String(error),
        });
        return { ok: false as const, errors: [`导入失败（已回滚）：${String(error)}`] };
      }

      setInterviewMeta(INTERVIEW_META_KEYS.lastImportAt, String(now));
      if (plan.inserts.length > 0 || plan.updates.length > 0) bumpGlossaryVersion();

      return {
        ok: true as const,
        added: stillInserts.length + revived.length,
        updated: plan.updates.length + plan.taxonomyUpdates.length,
        skipped: plan.skipped,
        orphaned: plan.orphaned,
        errors: plan.errors,
      };
    },
  );

  // ── 元信息（导出/导入要标注的版本口径）──
  ipcMain.handle("interview-meta-get", () => {
    if (!isInterviewDbReady()) return null;
    const toNumber = (key: string): number | null => {
      const raw = readInterviewMeta(key);
      const num = raw === null ? Number.NaN : Number(raw);
      return Number.isFinite(num) ? num : null;
    };
    return {
      schemaVersion: toNumber(INTERVIEW_META_KEYS.schemaVersion),
      baselineVersion: readInterviewMeta(INTERVIEW_META_KEYS.baselineVersion),
      glossaryVersion: toNumber(INTERVIEW_META_KEYS.glossaryVersion) ?? 0,
      lastImportAt: toNumber(INTERVIEW_META_KEYS.lastImportAt),
      lastExportAt: toNumber(INTERVIEW_META_KEYS.lastExportAt),
    };
  });
}
