/**
 * 关系图提交（R27 / S3）：**单事务**写入「新建关系 + 备注 + 画布文档」
 *
 * 为什么必须是一条独立通道，而不是复用现成的两条：
 * - `novel-link-add` 一次只写一行、没有事务、没有去重、没有 rev：图窗口一次
 *   确认要写 N 条边 + M 条备注 + 画布坐标，分次提交会在中途失败时留下
 *   「边建了一半、坐标没存」的半成品，而失败态正是最伤信任的形态；
 * - `novel-link-set`（`novel-pack-handlers.ts` 的 `upsertRealmLinkRow`）语义是
 *   「按四元组先 DELETE 再 INSERT」——**同端点 + 同关系名**时会把已有行删掉。
 *   图上连线恰恰最容易出现同端点同关系名（用户重复画一条就触发），走那条路
 *   就是静默丢边，而且它是「境界绑定」专用语义（`to_type='level'`），不该复用。
 *
 * 事务内的顺序是硬约束（见 ADR-27-03 §4.4）：
 * ① 端点归属校验（`novel_links` 没有 work_id，只能在这里挡跨书边）
 * ② 四元组去重 SELECT（归入 merged，不新增；替代唯一约束，零 schema 变更）
 * ③ INSERT … ON CONFLICT(id) DO NOTHING（重试安全：同 id 重复提交 = 无操作）
 * ④ UPDATE note（changes===0 → rejected；expectedNote 不一致 → 保留库里的较新值）
 * ⑤ rev 比对后 upsert 画布文档（不一致 → stale，整体回滚）
 *
 * 成功后由本文件广播 `novel-links-changed`（delta 来自事务返回值，不是渲染层
 * 自己记的账 —— 这样「写进去了但没通知」不可能发生）。
 */
import { ipcMain } from "electron";
import {
  novelAll as dbAll,
  novelGet as dbGet,
  novelRun as dbRun,
  getNovelDb as getDb,
  isNovelDbReady,
} from "../novel-db";
import { broadcastLinksChanged } from "../novel-links-events";

/** 画布文档键前缀：与渲染层 `utils/graph-doc.ts` 的 REL_GRAPH_KEY_PREFIX 同值 */
const REL_GRAPH_KEY_PREFIX = "novel_rel_graph_v1";
const DEFAULT_GRAPH_ID = "g1";

interface CommitLinkInput {
  id: string;
  fromType: string;
  fromId: string;
  toType: string;
  toId: string;
  relation: string;
}

interface CommitNoteInput {
  id: string;
  note: string | null;
  expectedNote?: string | null;
}

interface CommitRequest {
  workId: string;
  expectedRev: number;
  doc?: string | null;
  addLinks?: CommitLinkInput[];
  noteUpdates?: CommitNoteInput[];
}

interface CommitOk {
  ok: true;
  rev: number;
  created: Array<{
    id: string;
    fromType: string;
    fromId: string;
    toType: string;
    toId: string;
    relation: string;
    note?: string;
  }>;
  merged: string[];
  notes: Array<{ id: string; note: string | null }>;
  rejected: Array<{ id: string; reason: "missing" | "note-changed"; note?: string | null }>;
}

type CommitFailure = {
  ok: false;
  code: "stale" | "invalid-target" | "invalid-link" | "db";
  message?: string;
  invalid?: string[];
  rev?: number;
};

/** 关系名长度上限：与渲染层 `RELATION_NAME_MAX`（RelationCreateDialog）同值 */
const RELATION_NAME_MAX = 24;

/** 事务内主动中止用：better-sqlite3 的 transaction 在回调抛错时整体回滚 */
class CommitAbort extends Error {
  readonly failure: CommitFailure;

  constructor(failure: CommitFailure) {
    super(failure.message ?? failure.code);
    this.failure = failure;
  }
}

function graphDocKey(workId: string, graphId: string = DEFAULT_GRAPH_ID): string {
  return `${REL_GRAPH_KEY_PREFIX}:${workId}:${graphId}`;
}

/** 端点必须都属于这本书：拉一次本书实体 id 集，避免逐条查库 */
function loadWorkEntityIds(workId: string): Set<string> {
  const rows = dbAll("SELECT id FROM novel_entities WHERE work_id = ?", [workId]) as Array<{
    id: string;
  }>;
  return new Set(rows.map((row) => row.id));
}

/** 画布文档里记录的 rev（解析失败按 -1：等同于「库里那份不可用」） */
function readStoredRev(key: string): number | null {
  const row = dbGet("SELECT value FROM novel_config WHERE key = ?", [key]) as
    | { value?: string }
    | undefined;
  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as { rev?: unknown };
    return typeof parsed.rev === "number" && Number.isFinite(parsed.rev)
      ? Math.floor(parsed.rev)
      : null;
  } catch {
    return null;
  }
}

/**
 * 提交实现。返回 CommitOk 或抛出 CommitAbort（由调用方转成 ok:false）。
 *
 * 注意：`doc` 由主进程接管 rev —— 渲染层传的是本地快照，rev 在这里统一 +1，
 * 避免「渲染层算一次、主进程再算一次」两处真相。
 */
function applyCommit(request: CommitRequest): CommitOk {
  const { workId, expectedRev } = request;
  if (!workId) throw new CommitAbort({ ok: false, code: "db", message: "缺少作品上下文" });

  const addLinks = (request.addLinks ?? []).filter((link) => link && link.id);
  const noteUpdates = (request.noteUpdates ?? []).filter((item) => item && item.id);
  const docKey = graphDocKey(workId);

  const db = getDb();
  const run = db.transaction((): CommitOk => {
    // ① 端点归属校验：先做，别让任何一条写入落在错误的作品上。
    //    自环与空关系名同属「写入路径守卫」（delta §2.1 N-4）：渲染层的
    //    `checkDraft()` 只是提前提示，绕过它（重放、脚本、旧版本）也必须被挡。
    if (addLinks.length > 0) {
      const valid = loadWorkEntityIds(workId);
      const invalid: string[] = [];
      for (const link of addLinks) {
        const fromId = typeof link.fromId === "string" ? link.fromId : "";
        const toId = typeof link.toId === "string" ? link.toId : "";
        const relation = typeof link.relation === "string" ? link.relation.trim() : "";
        if (!fromId || !toId || fromId === toId) {
          throw new CommitAbort({
            ok: false,
            code: "invalid-link",
            message: fromId === toId ? "不能与自己建立关系" : "关系的两端不完整",
          });
        }
        if (!relation) {
          throw new CommitAbort({ ok: false, code: "invalid-link", message: "关系名不能为空" });
        }
        if (relation.length > RELATION_NAME_MAX) {
          throw new CommitAbort({
            ok: false,
            code: "invalid-link",
            message: `关系名不能超过 ${RELATION_NAME_MAX} 个字`,
          });
        }
        // 入库用清洗后的名字：与渲染层 normalizeRelation 同口径（去首尾空格）
        link.relation = relation;
        if (!valid.has(link.fromId)) invalid.push(link.fromId);
        if (!valid.has(link.toId)) invalid.push(link.toId);
      }
      if (invalid.length > 0) {
        throw new CommitAbort({
          ok: false,
          code: "invalid-target",
          message: "有要素已被删除或不属于这本书",
          invalid: [...new Set(invalid)],
        });
      }
    }

    // ② ~ ③ 去重 + 幂等插入
    const created: CommitOk["created"] = [];
    const merged: string[] = [];
    for (const link of addLinks) {
      const existing = dbGet(
        // 无向判定：图上一条边没有方向语义，A→B「师徒」与 B→A「师徒」是同一对。
        // 只查单向会让「渲染层说合并、库里新插一行」两套口径漂移（弹层显示 +1，
        // 之后右栏却多出一条重复关系）。
        `SELECT id FROM novel_links
          WHERE from_type = 'entity' AND to_type = 'entity' AND relation = ?
            AND ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))`,
        [link.relation, link.fromId, link.toId, link.toId, link.fromId],
      ) as { id?: string } | undefined;
      if (existing?.id) {
        // 平行边在数据模型里合法，但「同向同关系名」是重复：合并语义提交
        merged.push(existing.id);
        continue;
      }
      const result = dbRun(
        `INSERT INTO novel_links (id, from_type, from_id, to_type, to_id, relation, note)
         VALUES (?, 'entity', ?, 'entity', ?, ?, NULL)
         ON CONFLICT(id) DO NOTHING`,
        [link.id, link.fromId, link.toId, link.relation],
      );
      if (result.changes === 0) {
        // 同 id 已存在 = 上一次提交成功了但回执丢了（IPC 重试 / 连点）→ 幂等
        merged.push(link.id);
        continue;
      }
      created.push({
        id: link.id,
        fromType: link.fromType,
        fromId: link.fromId,
        toType: link.toType,
        toId: link.toId,
        relation: link.relation,
        note: undefined,
      });
    }

    // ④ 备注：唯一写 note 的语句。expectedNote 不一致时保留库里较新的值
    const notes: CommitOk["notes"] = [];
    const rejected: CommitOk["rejected"] = [];
    for (const item of noteUpdates) {
      const row = dbGet("SELECT note FROM novel_links WHERE id = ?", [item.id]) as
        | { note?: string | null }
        | undefined;
      if (!row) {
        rejected.push({ id: item.id, reason: "missing" });
        continue;
      }
      if (item.expectedNote !== undefined && (row.note ?? null) !== (item.expectedNote ?? null)) {
        rejected.push({ id: item.id, reason: "note-changed", note: row.note ?? null });
        continue;
      }
      const value = item.note && item.note.trim() ? item.note.trim().slice(0, 200) : null;
      const result = dbRun("UPDATE novel_links SET note = ? WHERE id = ?", [value, item.id]);
      if (result.changes === 0) {
        rejected.push({ id: item.id, reason: "missing" });
        continue;
      }
      notes.push({ id: item.id, note: value });
    }

    // ⑤ 画布文档：rev 是乐观锁。库里没有行 = 首次写入；有行且 rev 不等 = 别处改过
    let rev = expectedRev;
    if (request.doc) {
      const storedRev = readStoredRev(docKey);
      if (storedRev !== null && storedRev !== expectedRev) {
        throw new CommitAbort({
          ok: false,
          code: "stale",
          message: "这本书的画布已在别处改过",
          rev: storedRev,
        });
      }
      rev = expectedRev + 1;
      let next: Record<string, unknown>;
      try {
        next = JSON.parse(request.doc) as Record<string, unknown>;
      } catch {
        throw new CommitAbort({ ok: false, code: "db", message: "画布文档格式错误" });
      }
      const value = JSON.stringify({ ...next, rev, ts: Date.now() });
      dbRun(
        `INSERT INTO novel_config (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value,
           updated_at = datetime('now', 'localtime')`,
        [docKey, value],
      );
    }

    return { ok: true, rev, created, merged, notes, rejected };
  });

  return run();
}

export function registerNovelGraphHandlers(): void {
  ipcMain.handle("novel-graph-commit", (event, request: CommitRequest) => {
    if (!isNovelDbReady()) {
      return { ok: false, code: "db", message: "数据库未就绪（未登录或正在退出）" } satisfies CommitFailure;
    }
    let result: CommitOk;
    try {
      result = applyCommit(request);
    } catch (error) {
      if (error instanceof CommitAbort) return error.failure;
      console.error("[novel-graph-commit] 提交失败：", error);
      return {
        ok: false,
        code: "db",
        message: error instanceof Error ? error.message : String(error),
      } satisfies CommitFailure;
    }

    // 事务已提交：广播 delta（排除发送者，图窗口按返回值自己合并）
    broadcastLinksChanged(event.sender, {
      workId: request.workId,
      rev: result.rev,
      created: result.created,
      merged: result.merged,
      notes: result.notes,
    });

    return result;
  });
}
