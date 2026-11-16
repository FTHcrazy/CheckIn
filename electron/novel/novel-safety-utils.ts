/**
 * novel 域数据安全纯函数（P0：一键全量备份/恢复 + 回收站保留期）
 *
 * 不依赖 electron / Node API，可在 vitest 中直接测试；实际文件读写、系统弹窗
 * 与 zip 编解码在 `handlers/novel-safety-handlers.ts`（对标 todo/memo 的
 * `backup-utils.ts` + handler 分工）。
 *
 * 备份包结构：
 *   manifest.json  清单（应用标识 / 格式版本 / 类型 / 导出时间 / 数据规模摘要）
 *   novel.db       整库字节（含卷章正文 / 要素 / 设定 / 行囊 / 关系图 / 全局设定引用）
 *
 * 为什么整库字节而不是结构化 JSON：novel 域有 30+ 张表且外键靠 work_id /
 * chapter_id 字符串互指，逐表 JSON 化再还原等于重写一遍导入器，任一张表漏字段
 * 就是静默丢数据。整库复制是唯一「零字段映射」的方案，恢复后由
 * `switchNovelDb()` 重跑增量迁移把老库补齐到当前 schema。
 */

/** 备份包格式版本：结构不兼容变更时 +1，恢复端拒绝更高版本 */
export const NOVEL_BACKUP_FORMAT_VERSION = 1;

/** 包类型标识：与 todo/memo 包区分（同为 checkin 应用，靠 kind 分流） */
export const NOVEL_BACKUP_KIND = "novel-db";

export const NOVEL_BACKUP_MANIFEST_FILE = "manifest.json";
export const NOVEL_BACKUP_DB_FILE = "novel.db";

/** 回收站保留期：删除后 30 天内可恢复，过期由渲染层触发彻底删除 */
export const NOVEL_TRASH_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 备份规模摘要（导出时统计，恢复前展示给用户确认代价） */
export interface NovelBackupCounts {
  works: number;
  volumes: number;
  chapters: number;
  words: number;
  entities: number;
  settings: number;
  packCharacters: number;
}

export interface NovelBackupManifest {
  app: "checkin";
  kind: typeof NOVEL_BACKUP_KIND;
  format: number;
  /** 导出时间（ISO 字符串） */
  exportedAt: string;
  /** 导出时的用户邮箱（仅作提示，不参与校验：本应用数据本就按用户目录隔离） */
  email?: string;
  /** 导出时的应用版本（提示用） */
  appVersion?: string;
  counts: NovelBackupCounts;
}

export type ParsedNovelBackupManifest =
  | { ok: true; manifest: NovelBackupManifest }
  | { ok: false; error: string };

export function emptyNovelCounts(): NovelBackupCounts {
  return {
    works: 0,
    volumes: 0,
    chapters: 0,
    words: 0,
    entities: 0,
    settings: 0,
    packCharacters: 0,
  };
}

/** 计数归一化：非数字 / 负数 / NaN 一律归 0，避免清单里的脏值穿透到 UI */
export function normalizeNovelCounts(input: unknown): NovelBackupCounts {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<
    string,
    unknown
  >;
  const read = (key: keyof NovelBackupCounts): number => {
    const value = Number(raw[key]);
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
  };
  return {
    works: read("works"),
    volumes: read("volumes"),
    chapters: read("chapters"),
    words: read("words"),
    entities: read("entities"),
    settings: read("settings"),
    packCharacters: read("packCharacters"),
  };
}

export function buildNovelBackupManifest(params: {
  counts: NovelBackupCounts;
  exportedAt: string;
  email?: string;
  appVersion?: string;
}): NovelBackupManifest {
  const manifest: NovelBackupManifest = {
    app: "checkin",
    kind: NOVEL_BACKUP_KIND,
    format: NOVEL_BACKUP_FORMAT_VERSION,
    exportedAt: params.exportedAt,
    counts: normalizeNovelCounts(params.counts),
  };
  if (params.email) manifest.email = params.email;
  if (params.appVersion) manifest.appVersion = params.appVersion;
  return manifest;
}

/**
 * 解析并校验清单。
 *
 * 三道闸门缺一不可：`app` 挡别家应用、`kind` 挡「拿待办备份包来恢复小说」、
 * `format` 挡更新版本导出的包被旧版本读（结构可能已不兼容）。
 */
export function parseNovelBackupManifest(text: string): ParsedNovelBackupManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "清单文件不是合法 JSON" };
  }
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "清单文件内容为空" };
  }
  const data = raw as Record<string, unknown>;
  if (data.app !== "checkin") {
    return { ok: false, error: "这不是 CheckIn 的备份包" };
  }
  if (data.kind !== NOVEL_BACKUP_KIND) {
    return { ok: false, error: "这不是小说数据备份包（可能选成了待办 / 备忘的包）" };
  }
  const format = typeof data.format === "number" ? data.format : 0;
  if (format < 1) {
    return { ok: false, error: "备份包缺少格式版本" };
  }
  if (format > NOVEL_BACKUP_FORMAT_VERSION) {
    return { ok: false, error: `备份包版本（${format}）高于当前应用支持的版本` };
  }
  return {
    ok: true,
    manifest: {
      app: "checkin",
      kind: NOVEL_BACKUP_KIND,
      format,
      exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : "",
      email: typeof data.email === "string" ? data.email : undefined,
      appVersion: typeof data.appVersion === "string" ? data.appVersion : undefined,
      counts: normalizeNovelCounts(data.counts),
    },
  };
}

/** 导出文件名：checkin-novel-20261023-101500.zip */
export function buildNovelBackupFilename(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `checkin-novel-${stamp}.zip`;
}

/**
 * SQLite 文件头校验。
 *
 * 恢复是**覆盖整库**的高危动作，绝不能把「zip 里那个文件其实是空的 / 被截断的」
 * 写进用户的数据库路径 —— 那会把「恢复」变成「清空」。一个可用的 SQLite 库
 * 至少要有 100 字节的文件头（"SQLite format 3\0" + 页大小等元信息）。
 */
export function isLikelySqliteFile(bytes: Uint8Array): boolean {
  if (bytes.length < 100) return false;
  const header = "SQLite format 3";
  for (let i = 0; i < header.length; i += 1) {
    if (bytes[i] !== header.charCodeAt(i)) return false;
  }
  return true;
}

// ── 回收站保留期 ──

/** 删除时刻 → 过期时刻 */
export function novelTrashExpiresAt(deletedAt: number): number {
  return deletedAt + NOVEL_TRASH_RETENTION_DAYS * DAY_MS;
}

/**
 * 剩余可恢复天数（向上取整，最小 0）。
 *
 * 用「剩 0 天」表示不足 24 小时但尚未过期 —— 文案上要写成「今天内可恢复」，
 * 不能因为不足一天就说已过期。
 */
export function novelTrashDaysLeft(deletedAt: number, now: number): number {
  if (!Number.isFinite(deletedAt)) return 0;
  const left = novelTrashExpiresAt(deletedAt) - now;
  if (left <= 0) return 0;
  return Math.ceil(left / DAY_MS);
}

/** 是否已过保留期（可彻底清除） */
export function isNovelTrashExpired(deletedAt: number, now: number): boolean {
  if (!Number.isFinite(deletedAt)) return true;
  return now >= novelTrashExpiresAt(deletedAt);
}
