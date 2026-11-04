/**
 * 地图域 IPC（map.db：存档 / 列表 / 版本 / 作品绑定）
 *
 * 全部通道读写都经 `map-db.ts` 的连接，SQL 只出现在本文件与 map-db.ts。
 * 渲染层唯一入口是 `preload.ts` 的 `map` 命名空间（白名单，不接受任意通道）。
 *
 * 三条不变量（改动前先读）：
 * 1. **列表不返回 `doc_json`**：一屏 20 张图就是几十 MB，列表只给元信息 + 缩略图
 *    data URL；正文只在 `map-doc-get` 里出。
 * 2. **写入一律过乐观锁**：`baseRev !== 当前 rev` 就拒绝并回传最新 rev，让渲染层
 *    在"载入最新 / 覆盖保存"之间选。唯一例外是 `map-doc-flush`（关窗，见函数注释）。
 * 3. **地图不级联依赖作品**：`work_id` 可空、解绑不删图、删作品不删图（跨库没有
 *    外键，只有应用层校验）。地图的制作成本远高于"重新绑定"。
 */
import { ipcMain } from "electron";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { log } from "../logger";
import {
  getMapAssetsDir,
  isMapDbReady,
  mapAll,
  mapGet,
  mapRun,
  mapTransaction,
} from "../map-db";
import { isNovelDbReady, novelAll, novelGet } from "../novel-db";
import {
  MAP_DOC_SCHEMA_VERSION,
  MAP_THUMB_MAX_BYTES,
  createMapDocId,
  isRevConflict,
  normalizeMapTitle,
  parseViewport,
  revisionsToDrop,
  serializeViewport,
  shouldSnapshotRevision,
  thumbToDataUrl,
  type MapBindResult,
  type MapSaveResult,
} from "../map-utils";

/** 列表项（不含 doc_json） */
interface MapDocRow {
  id: string;
  title: string;
  work_id: string | null;
  rev: number;
  thumb: Buffer | null;
  created_at: number;
  updated_at: number;
  opened_at: number | null;
  deleted_at?: number | null;
}

/** 列表摘要（渲染层可直接渲染） */
export interface MapDocSummary {
  id: string;
  title: string;
  workId: string | null;
  rev: number;
  /** PNG data URL；`null` = 还没有缩略图（列表用占位图） */
  thumb: string | null;
  createdAt: number;
  updatedAt: number;
  openedAt: number | null;
  /** 非空 = 在回收站（只有 `includeDeleted` 的查询才会带出这种行） */
  deletedAt: number | null;
}

function now(): number {
  return Date.now();
}

/** 未登录 / 未切换用户时静默降级：列表空、读不到、写失败，绝不抛到渲染层 */
function ready(): boolean {
  return isMapDbReady();
}

/** 读一行（含已删除？由调用方决定 SQL） */
function docRow(id: string, includeDeleted = false): MapDocRow | undefined {
  const row = mapGet(
    `SELECT id, title, work_id, rev, thumb, created_at, updated_at, opened_at
       FROM map_docs
      WHERE id = ?${includeDeleted ? "" : " AND deleted_at IS NULL"}`,
    [id],
  ) as MapDocRow | undefined;
  return row;
}

function toSummary(row: MapDocRow): MapDocSummary {
  return {
    id: row.id,
    title: row.title,
    workId: row.work_id,
    rev: row.rev,
    thumb: thumbToDataUrl(row.thumb),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    openedAt: row.opened_at,
    deletedAt: row.deleted_at ?? null,
  };
}

/**
 * 作品是否可绑定。
 *
 * 跨库校验（`map.db` 无权访问 `novel.db` 的外键），因此必须显式查一次：
 * 绑定到一个已进回收站 / 已不存在的作品，会让地图永远挂着一个打不开的入口。
 *
 * @returns `null` = 可以绑定；否则是拒绝原因（枚举，文案归渲染层）
 */
function workBindReject(workId: string): Exclude<MapBindResult, { ok: true }> | null {
  if (!isNovelDbReady()) return { ok: false, reason: "work_not_found" };
  const row = novelGet("SELECT id, deleted_at FROM novel_works WHERE id = ?", [workId]) as
    | { id: string; deleted_at: number | null }
    | undefined;
  if (!row) return { ok: false, reason: "work_not_found" };
  if (row.deleted_at !== null && row.deleted_at !== undefined) {
    return { ok: false, reason: "work_deleted" };
  }
  return null;
}

/**
 * 落一次文档（save 与 flush 共用）。
 *
 * @param force `true` = 忽略乐观锁直接覆盖（只给关窗 flush 用）。
 *
 * 【为什么 flush 允许强写】关窗路径没有"让用户选"的机会：要么写下去、要么丢掉
 * 刚才那几笔。窗口是单实例的，同一文档同时被两个窗口编辑本就不可能，所以
 * "最后关闭者胜"在这里是安全且可预期的；而弹一个"该地图已在别处修改"的确认框
 * 给一个正在关窗的用户，等于把人卡在窗口里。
 */
function writeDoc(params: {
  id: string;
  doc: unknown;
  baseRev: number;
  viewport?: unknown;
  force?: boolean;
}): MapSaveResult {
  if (!ready()) return { ok: false, conflict: false, reason: "not_found" };
  const row = docRow(params.id);
  if (!row) return { ok: false, conflict: false, reason: "not_found" };
  if (!params.force && isRevConflict(params.baseRev, row.rev)) {
    return { ok: false, conflict: true, rev: row.rev };
  }

  const nextRev = row.rev + 1;
  const updatedAt = now();
  const viewportJson = serializeViewport(params.viewport);
  let docJson: string;
  try {
    docJson = JSON.stringify(params.doc ?? {});
  } catch {
    // 循环引用 / 不可序列化：拒绝写入，但**不涨 rev**（否则渲染层的 baseRev 会飘）
    log("warn", "map", "map-db", "地图文档无法序列化，已跳过本次保存", { id: params.id });
    return { ok: false, conflict: false, reason: "unserializable" };
  }

  mapTransaction(() => {
    mapRun(
      `UPDATE map_docs
          SET doc_json = ?, rev = ?, updated_at = ?, schema_version = ?,
              last_viewport = COALESCE(?, last_viewport)
        WHERE id = ?`,
      [docJson, nextRev, updatedAt, MAP_DOC_SCHEMA_VERSION, viewportJson, params.id],
    );
    if (shouldSnapshotRevision(nextRev)) {
      // 历史版本在事务内追加：写一半崩掉会出现「rev 涨了但档案没留」的错位
      mapRun(
        "INSERT INTO map_revisions (doc_id, rev, doc_json, created_at) VALUES (?, ?, ?, ?)",
        [params.id, nextRev, docJson, updatedAt],
      );
      const revs = mapAll("SELECT rev FROM map_revisions WHERE doc_id = ?", [params.id]) as Array<{
        rev: number;
      }>;
      for (const drop of revisionsToDrop(revs.map((entry) => entry.rev))) {
        mapRun("DELETE FROM map_revisions WHERE doc_id = ? AND rev = ?", [params.id, drop]);
      }
    }
  });

  return { ok: true, rev: nextRev };
}

export function registerMapHandlers(): void {
  /** 列表：默认只给在架文档，按「最近打开 → 最近更新」倒序 */
  ipcMain.handle(
    "map-docs-list",
    (_event, payload?: { workId?: string | null; includeDeleted?: boolean }) => {
      if (!ready()) return [] as MapDocSummary[];
      const workId = payload?.workId;
      // 回收站复用同一条查询：`includeDeleted` 只影响 WHERE，不影响返回形状 ——
      // 两套通道会让"恢复后列表不刷新"这种错位多一个来源
      const filters: string[] = [];
      const params: unknown[] = [];
      if (payload?.includeDeleted !== true) filters.push("deleted_at IS NULL");
      if (typeof workId === "string" && workId.length > 0) {
        filters.push("work_id = ?");
        params.push(workId);
      }
      const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
      const rows = mapAll(
        `SELECT id, title, work_id, rev, thumb, created_at, updated_at, opened_at, deleted_at
           FROM map_docs
           ${where}
          ORDER BY COALESCE(opened_at, updated_at) DESC`,
        params,
      ) as MapDocRow[];
      return rows.map(toSummary);
    },
  );

  /**
   * 打开一张地图：返回完整文档 + 版本 + 视口，并把 `opened_at` 推到最前。
   *
   * 【`opened_at` 与 `updated_at` 分开】列表按"我上次在看哪张图"排序更符合直觉；
   * 更新了不等于打开了（比如以后做批量操作）。
   */
  ipcMain.handle("map-doc-get", (_event, payload: { id: string }) => {
    if (!ready()) return null;
    const row = mapGet(
      `SELECT id, title, work_id, doc_json, schema_version, rev, last_viewport
         FROM map_docs
        WHERE id = ? AND deleted_at IS NULL`,
      [payload.id],
    ) as
      | {
          id: string;
          title: string;
          work_id: string | null;
          doc_json: string;
          schema_version: number;
          rev: number;
          last_viewport: string | null;
        }
      | undefined;
    if (!row) return null;

    mapRun("UPDATE map_docs SET opened_at = ? WHERE id = ?", [now(), row.id]);

    let doc: unknown;
    let corrupt = false;
    try {
      doc = JSON.parse(row.doc_json);
    } catch {
      // 坏档不让上层炸：返回空文档 + corrupt 标记，渲染层按"新图"打开并提示
      corrupt = true;
      doc = {};
    }
    return {
      id: row.id,
      title: row.title,
      workId: row.work_id,
      doc,
      rev: row.rev,
      schemaVersion: row.schema_version,
      viewport: parseViewport(row.last_viewport),
      corrupt,
    };
  });

  /**
   * 新建一张地图。
   *
   * `doc` 可选：缺省写 `"{}"`，由渲染层的 `migrateDoc` 补齐成完整文档 ——
   * 空文档的默认值只有一份（渲染层 `createEmptyDocument`），主进程不复刻一遍，
   * 否则"两端各自维护默认值"迟早对不上（比如新增字段只加了一边）。
   */
  ipcMain.handle(
    "map-doc-create",
    (_event, payload?: { title?: string; workId?: string | null; doc?: unknown }) => {
      if (!ready()) return null;
      const workId =
        typeof payload?.workId === "string" && payload.workId.length > 0 ? payload.workId : null;
      if (workId) {
        const reject = workBindReject(workId);
        if (reject) return reject;
      }
      const id = createMapDocId(randomUUID());
      const timestamp = now();
      let docJson: string;
      try {
        docJson = JSON.stringify(payload?.doc ?? {});
      } catch {
        docJson = "{}";
      }
      mapRun(
        `INSERT INTO map_docs
           (id, title, work_id, doc_json, schema_version, rev, created_at, updated_at, opened_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [id, normalizeMapTitle(payload?.title), workId, docJson, MAP_DOC_SCHEMA_VERSION, timestamp, timestamp, timestamp],
      );
      log("info", "map", "map-db", "新建地图", { id, workId });
      return { id, rev: 0 };
    },
  );

  /** 保存（乐观锁）：冲突时回传最新 rev，不静默覆盖 */
  ipcMain.handle(
    "map-doc-save",
    (_event, payload: { id: string; doc: unknown; baseRev: number; viewport?: unknown }) =>
      writeDoc(payload),
  );

  /**
   * 关窗同步 flush：与 save 同一套写入，但**忽略乐观锁**（理由见 `writeDoc`）。
   *
   * 渲染层收到 `map-doc-request-snapshot` 后调用本通道，完成后回 `map-doc-flush-done`，
   * 主进程才真正关窗；1.5s 超时则强制关（宁可丢最后一次，也不能关不掉窗口）。
   */
  ipcMain.handle(
    "map-doc-flush",
    (_event, payload: { id: string; doc: unknown; baseRev: number; viewport?: unknown }) =>
      writeDoc({ ...payload, force: true }),
  );

  ipcMain.handle("map-doc-rename", (_event, payload: { id: string; title: string }) => {
    if (!ready()) return { ok: false };
    const title = normalizeMapTitle(payload?.title);
    const result = mapRun("UPDATE map_docs SET title = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL", [
      title,
      now(),
      payload?.id,
    ]);
    return { ok: result.changes > 0, title };
  });

  /** 软删（进回收站）：只打 `deleted_at`，文档本体与缩略图都留着，可恢复 */
  ipcMain.handle("map-doc-delete", (_event, payload: { id: string }) => {
    if (!ready()) return { ok: false };
    const result = mapRun("UPDATE map_docs SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL", [
      now(),
      payload?.id,
    ]);
    return { ok: result.changes > 0 };
  });

  ipcMain.handle("map-doc-restore", (_event, payload: { id: string }) => {
    if (!ready()) return { ok: false };
    const result = mapRun("UPDATE map_docs SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL", [
      payload?.id,
    ]);
    return { ok: result.changes > 0 };
  });

  /**
   * 彻底删除：文档行 + 历史版本 + 资源目录一起清。
   *
   * 【为什么连文件一起删】`map-assets/{docId}/` 里的底图与自定义符号只属于这张图，
   * 留下就是永远查不到的孤儿文件（库里已经没有指向它的行）。
   * 文件删除失败只记日志、不阻断 —— 库已经清了，再抛错只会让界面停在"删不掉"。
   */
  ipcMain.handle("map-doc-purge", (_event, payload: { id: string }) => {
    if (!ready()) return { ok: false };
    const id = payload?.id;
    if (typeof id !== "string" || id.length === 0) return { ok: false };
    mapTransaction(() => {
      mapRun("DELETE FROM map_revisions WHERE doc_id = ?", [id]);
      mapRun("DELETE FROM map_assets WHERE doc_id = ?", [id]);
      mapRun("DELETE FROM map_docs WHERE id = ?", [id]);
    });
    try {
      fs.rmSync(getMapAssetsDir(id), { recursive: true, force: true });
    } catch (error) {
      log("warn", "map", "map-db", "清理地图资源目录失败（库已清理，可忽略）", {
        id,
        error: String(error),
      });
    }
    return { ok: true };
  });

  /**
   * 绑定 / 解绑作品。`workId: null` = 解绑（不删图、不删内容）。
   *
   * 解绑是"变成独立地图"，不是"从作品里移除这张图" —— 后者才需要删数据，
   * 而地图的制作成本远高于重新绑定。
   */
  ipcMain.handle("map-doc-bind", (_event, payload: { id: string; workId: string | null }) => {
    if (!ready()) return { ok: false, reason: "doc_not_found" } as MapBindResult;
    const row = docRow(payload?.id);
    if (!row) return { ok: false, reason: "doc_not_found" } as MapBindResult;
    const workId = typeof payload?.workId === "string" && payload.workId.length > 0 ? payload.workId : null;
    if (workId) {
      const reject = workBindReject(workId);
      if (reject) return reject;
    }
    mapRun("UPDATE map_docs SET work_id = ?, updated_at = ? WHERE id = ?", [workId, now(), row.id]);
    return { ok: true } as MapBindResult;
  });

  /** 缩略图回传（渲染层 extract 小图后发字节；失败静默，列表用占位图） */
  ipcMain.handle("map-doc-thumb", (_event, payload: { id: string; png: ArrayBuffer }) => {
    if (!ready()) return { ok: false };
    const raw = payload?.png;
    if (!raw) return { ok: false };
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    if (buffer.length === 0) return { ok: false };
    if (buffer.length > MAP_THUMB_MAX_BYTES) {
      // 超限不写：一张缩略图撑到 1MB，列表一次拉 20 张就是 20MB
      log("warn", "map", "map-db", "缩略图超过上限，已忽略", { id: payload.id, bytes: buffer.length });
      return { ok: false };
    }
    const result = mapRun("UPDATE map_docs SET thumb = ? WHERE id = ? AND deleted_at IS NULL", [
      buffer,
      payload?.id,
    ]);
    return { ok: result.changes > 0 };
  });

  /** 历史版本列表（不含正文，避免一屏拉几十 MB） */
  ipcMain.handle("map-doc-revisions", (_event, payload: { id: string }) => {
    if (!ready()) return [];
    return (
      mapAll("SELECT rev, created_at FROM map_revisions WHERE doc_id = ? ORDER BY rev DESC", [
        payload?.id,
      ]) as Array<{ rev: number; created_at: number }>
    ).map((row) => ({ rev: row.rev, createdAt: row.created_at }));
  });

  /**
   * 回退到某一历史版本：**生成新 rev**，不覆盖历史（否则回退一次就把那段历史吃掉了）。
   */
  ipcMain.handle("map-doc-restore-rev", (_event, payload: { id: string; rev: number }) => {
    if (!ready()) return { ok: false };
    const row = docRow(payload?.id);
    if (!row) return { ok: false };
    const snapshot = mapGet("SELECT doc_json FROM map_revisions WHERE doc_id = ? AND rev = ?", [
      payload.id,
      payload.rev,
    ]) as { doc_json: string } | undefined;
    if (!snapshot) return { ok: false };
    const nextRev = row.rev + 1;
    mapRun("UPDATE map_docs SET doc_json = ?, rev = ?, updated_at = ? WHERE id = ?", [
      snapshot.doc_json,
      nextRev,
      now(),
      row.id,
    ]);
    return { ok: true, rev: nextRev };
  });

  /**
   * 作品下拉选项（绑定选择器用）。
   *
   * 【为什么新增一条通道，而不是复用 `novel-editor-load`】后者会把整本书的
   * 卷 / 章 / 要素 / 设定一起端过来（数百 KB），只为拿标题里那一个字符串；
   * 而这里只需要 `id + name` 两列。跨库读在应用层完成（同 `workBindReject`），
   * 不建外键、不写 `novel.db`。
   */
  ipcMain.handle("map-work-options", () => {
    if (!isNovelDbReady()) return [] as Array<{ id: string; name: string }>;
    return novelAll("SELECT id, name FROM novel_works WHERE deleted_at IS NULL ORDER BY name") as Array<{
      id: string;
      name: string;
    }>;
  });

  // 配置键值（当前地图 id 等）：与 novel_config 同范式，避免为了一个键单开表
  ipcMain.handle("map-config-get", (_event, key: string) => {
    if (!ready() || typeof key !== "string") return null;
    const row = mapGet("SELECT value FROM map_config WHERE key = ?", [key]) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  });

  ipcMain.handle("map-config-set", (_event, payload: { key: string; value: string }) => {
    if (!ready() || !payload?.key) return false;
    mapRun(
      `INSERT INTO map_config (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [payload.key, String(payload.value ?? ""), now()],
    );
    return true;
  });

  log("info", "map", "map-db", "地图 IPC 已注册");
}
