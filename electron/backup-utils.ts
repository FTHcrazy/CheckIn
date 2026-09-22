/**
 * 备份包纯函数（包结构 / 清单校验 / todo 父子重排 / 备忘文件名处理）
 *
 * 不依赖 electron / Node API，可在 vitest 中直接测试；
 * 实际文件读写、系统弹窗与 zip 编解码在 handlers/todo-handlers.ts 与
 * handlers/memo-handlers.ts 中（原「数据迁移」模块已并入两个业务页）。
 *
 * zip 包结构（与旧版数据迁移包完全兼容）：
 *   manifest.json   清单（应用标识 / 格式版本 / 导出范围 / 条数）
 *   todos.json      todo 全量行（驼峰字段，含父子关系）
 *   memos/*.md      备忘文件（一级目录，.md）
 *
 * 单范围导出：待办页只打 todos.json，备忘页只打 memos/，
 * manifest.scopes 声明包内实际包含的范围；导入端按 scope 过滤。
 */

/** 备份包格式版本：结构不兼容变更时 +1，导入端拒绝更高版本 */
export const BACKUP_FORMAT_VERSION = 1;

export const BACKUP_MANIFEST_FILE = "manifest.json";
export const BACKUP_TODOS_FILE = "todos.json";
export const BACKUP_MEMOS_DIR = "memos";
/** 备忘文件名最大长度（不含 .md 后缀） */
const MEMO_NAME_MAX_LENGTH = 80;
/** Windows/Unix 通用非法文件名字符（不含控制字符，控制字符按码点过滤） */
const FORBIDDEN_NAME_CHARS = '\\/:*?"<>|';

/** 备份包的数据范围：todo 待办 / memo 备忘 */
export type BackupScope = "todo" | "memo";

export interface BackupManifest {
  /** 应用标识，用于拒绝其它来源的 zip */
  app: "checkin";
  format: number;
  /** 导出时间（ISO 字符串） */
  exportedAt: string;
  /** 导出时的用户邮箱（可为空，仅作提示，不参与校验） */
  email?: string;
  /** 包内实际包含的范围（todo → memo 固定顺序） */
  scopes: BackupScope[];
  counts: { todo: number; memo: number };
}

/** zip 中的 todo 行（驼峰命名，与表结构解耦） */
export interface TodoBackupRow {
  id: number;
  parentId: number | null;
  content: string;
  done: number;
  note: string | null;
  important: number;
  workHour: number | null;
  createdAt: string;
  doneAt: string | null;
}

/** 一条待写入的 todo（已按父→子排序，父关系用来源 id 表达） */
export interface TodoBackupInsert {
  /** 来源包中的原始 id，用于建立「旧 id → 新 id」映射 */
  sourceId: number;
  /** 来源包中的原始父 id；null 表示顶层或父项缺失（导入端按顶层写入） */
  parentSourceId: number | null;
  content: string;
  done: number;
  note: string | null;
  important: number;
  workHour: number | null;
  createdAt: string;
  doneAt: string | null;
}

/** 清单校验结果 */
export type ParsedManifest =
  | { ok: true; manifest: BackupManifest }
  | { ok: false; error: string };

// ── 范围处理 ──

const SCOPE_SET: Record<BackupScope, true> = { todo: true, memo: true };

function isScope(value: unknown): value is BackupScope {
  return typeof value === "string" && value in SCOPE_SET;
}

/**
 * 归一化范围列表：过滤非法值、去重、按 todo → memo 固定顺序输出。
 * 传入非数组时返回空数组（调用方据此拒绝执行）。
 */
export function normalizeScopes(input: unknown): BackupScope[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<BackupScope>();
  for (const item of input) {
    if (isScope(item)) seen.add(item);
  }
  return (["todo", "memo"] as const).filter((scope) => seen.has(scope));
}

// ── 清单 ──

/** 构造单范围导出清单（counts 中另一项恒为 0，保持与旧包一致的字段结构） */
export function buildManifest(params: {
  scope: BackupScope;
  count: number;
  exportedAt: string;
  email?: string;
}): BackupManifest {
  const manifest: BackupManifest = {
    app: "checkin",
    format: BACKUP_FORMAT_VERSION,
    exportedAt: params.exportedAt,
    scopes: normalizeScopes([params.scope]),
    counts: {
      todo: params.scope === "todo" ? Math.max(0, Math.trunc(params.count) || 0) : 0,
      memo: params.scope === "memo" ? Math.max(0, Math.trunc(params.count) || 0) : 0,
    },
  };
  if (params.email) manifest.email = params.email;
  return manifest;
}

/** 解析并校验清单文本（zip 内 manifest.json） */
export function parseManifest(text: string): ParsedManifest {
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
    return { ok: false, error: "这不是 CheckIn 数据备份包" };
  }
  const format = typeof data.format === "number" ? data.format : 0;
  if (format < 1) {
    return { ok: false, error: "备份包缺少格式版本" };
  }
  if (format > BACKUP_FORMAT_VERSION) {
    return { ok: false, error: `备份包版本（${format}）高于当前应用支持的版本` };
  }
  const scopes = normalizeScopes(data.scopes);
  if (scopes.length === 0) {
    return { ok: false, error: "备份包未包含任何可导入的数据" };
  }
  const countsRaw = (
    typeof data.counts === "object" && data.counts !== null ? data.counts : {}
  ) as Record<string, unknown>;
  return {
    ok: true,
    manifest: {
      app: "checkin",
      format,
      exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : "",
      email: typeof data.email === "string" ? data.email : undefined,
      scopes,
      counts: {
        todo: Math.max(0, Math.trunc(Number(countsRaw.todo)) || 0),
        memo: Math.max(0, Math.trunc(Number(countsRaw.memo)) || 0),
      },
    },
  };
}

// ── todo ──

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toFlag(value: unknown): number {
  return toNumberOrNull(value) ? 1 : 0;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : value;
}

/** 单行 todo 归一化；内容为空或 id 非法时返回 null（跳过该行） */
export function normalizeTodoRow(input: unknown): TodoBackupRow | null {
  if (typeof input !== "object" || input === null) return null;
  const data = input as Record<string, unknown>;
  const content = typeof data.content === "string" ? data.content.trim() : "";
  if (content === "") return null;
  const id = toNumberOrNull(data.id);
  if (id === null) return null;
  const parentId = toNumberOrNull(data.parentId);
  return {
    id: Math.trunc(id),
    // 自引用视为顶层，避免插入时形成自环
    parentId: parentId === null || parentId === id ? null : Math.trunc(parentId),
    content,
    done: toFlag(data.done),
    note: toStringOrNull(data.note),
    important: toFlag(data.important),
    workHour: toNumberOrNull(data.workHour),
    createdAt:
      typeof data.createdAt === "string" && data.createdAt.trim() !== ""
        ? data.createdAt
        : new Date().toISOString(),
    doneAt: toStringOrNull(data.doneAt),
  };
}

/** 解析 todos.json 文本：兼容顶层数组与 { todos: [...] } 两种形态 */
export function parseTodoRows(text: string): TodoBackupRow[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const rawRecord = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
  const list = Array.isArray(raw)
    ? raw
    : rawRecord && Array.isArray(rawRecord.todos)
      ? (rawRecord.todos as unknown[])
      : [];
  const rows: TodoBackupRow[] = [];
  const seenIds = new Set<number>();
  for (const item of list) {
    const row = normalizeTodoRow(item);
    if (!row || seenIds.has(row.id)) continue;
    seenIds.add(row.id);
    rows.push(row);
  }
  return rows;
}

/**
 * 生成写入计划：父项先于子项，父子关系用来源 id 表达。
 *
 * 导入时重新分配自增 id，因此必须先落父项拿到新 id 再落子项；
 * 父项缺失或成环时退化为顶层项，保证数据不丢。
 */
export function planTodoInserts(rows: TodoBackupRow[]): TodoBackupInsert[] {
  const byId = new Map<number, TodoBackupRow>();
  for (const row of rows) byId.set(row.id, row);
  const emitted = new Set<number>();
  const visiting = new Set<number>();
  const plan: TodoBackupInsert[] = [];

  const emit = (row: TodoBackupRow): void => {
    if (emitted.has(row.id)) return;
    // 成环：断开父链，本行按顶层落地
    if (visiting.has(row.id)) {
      emitted.add(row.id);
      plan.push(toInsert(row, null));
      return;
    }
    visiting.add(row.id);
    const parent = row.parentId === null ? undefined : byId.get(row.parentId);
    if (parent) emit(parent);
    visiting.delete(row.id);
    // 递归过程中本行已因成环被提前输出，避免重复入列
    if (emitted.has(row.id)) return;
    emitted.add(row.id);
    plan.push(toInsert(row, row.parentId));
  };

  // 先输出顶层再输出其余，保证同一批数据的落地顺序稳定
  for (const row of rows) if (row.parentId === null) emit(row);
  for (const row of rows) emit(row);
  return plan;
}

function toInsert(row: TodoBackupRow, parentSourceId: number | null): TodoBackupInsert {
  return {
    sourceId: row.id,
    parentSourceId,
    content: row.content,
    done: row.done,
    note: row.note,
    important: row.important,
    workHour: row.workHour,
    createdAt: row.createdAt,
    doneAt: row.doneAt,
  };
}

// ── 备忘文件名 ──

/** 去掉控制字符与文件系统非法字符（逐码点过滤，避免源码出现裸控制字符） */
function stripInvalidChars(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20) continue;
    if (FORBIDDEN_NAME_CHARS.includes(ch)) continue;
    out += ch;
  }
  return out;
}

/**
 * 清洗备忘文件名：剥离目录前缀与非法字符，补全 .md 后缀。
 * 空结果回退为「未命名备忘.md」，杜绝路径穿越与空名写盘。
 */
export function sanitizeMemoName(raw: string): string {
  const segments = String(raw ?? "").split(/[\\/]+/);
  // 先压缩空白（换行/制表统一为单个空格），再去控制字符，避免空格被一并吃掉
  let name = stripInvalidChars((segments[segments.length - 1] ?? "").replace(/\s+/g, " "));
  name = name.trim();
  // Windows 不允许文件名以点或空格结尾
  name = name.replace(/[. ]+$/, "");
  // 已是 .md 结尾时保留原有大小写，避免 "NOTE.MD" 被改写成 "NOTE.md"
  const hasMdSuffix = /\.md$/i.test(name);
  const stem = (hasMdSuffix ? name.slice(0, name.length - 3) : name).slice(0, MEMO_NAME_MAX_LENGTH);
  const suffix = hasMdSuffix ? name.slice(name.length - 3) : ".md";
  return `${stem || "未命名备忘"}${suffix}`;
}

/** 重名去重：已存在则追加 " (1)"、" (2)" … */
export function dedupeMemoName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(name)) return name;
  const stem = name.replace(/\.md$/i, "");
  for (let i = 1; ; i += 1) {
    const candidate = `${stem} (${i}).md`;
    if (!used.has(candidate)) return candidate;
  }
}

/** 从 zip 条目列表中筛出 memos/ 下的一级 .md 文件 */
export function listMemoEntries(paths: string[]): string[] {
  const prefix = `${BACKUP_MEMOS_DIR}/`;
  return paths.filter((entry) => {
    if (typeof entry !== "string" || entry === "") return false;
    if (entry.endsWith("/")) return false;
    if (!entry.startsWith(prefix)) return false;
    const rest = entry.slice(prefix.length);
    return rest !== "" && !rest.includes("/") && /\.md$/i.test(rest);
  });
}

/** 生成导出文件名，如 checkin-todo-20260921-143205.zip / checkin-memo-… */
export function buildExportFilename(now: Date, scope: BackupScope): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `checkin-${scope}-${stamp}.zip`;
}
