/**
 * 地图库的纯函数工具（无 IO、无 electron 依赖，可在 vitest 里直接跑）。
 *
 * 为什么单独一个文件：`map-db.ts` 与 `handlers/map-handlers.ts` 都要用到「标题归一」
 * 「乐观锁判据」「版本快照节奏」「缩略图转 data URL」这几条规则。分散写在两边，
 * 迟早出现「列表按 40 字截断、保存按 60 字截断」这种只在边界上才暴露的漂移。
 *
 * 边界：只放**计算**，不碰 sqlite / fs / ipc —— 那些属于 `map-db.ts` 与 handler。
 */

/** 地图名最大长度（列表卡片一行放得下，也不至于把弹窗撑爆） */
export const MAP_TITLE_MAX = 40;

/** 地图名兜底（新建 / 清空标题时用） */
export const MAP_TITLE_FALLBACK = "未命名地图";

/**
 * 历史版本保留份数。
 *
 * 单份 `doc_json` 按 1~3 MB 估，10 份 ≈ 10~30 MB —— 个人库可接受，
 * 再多就是拿磁盘换一个几乎不会用到的能力。
 */
export const MAP_REVISION_KEEP = 10;

/**
 * 每 N 个 rev 留一档历史。
 *
 * 不按"每次保存都留"：自动保存是 800ms 一次，连调十分钟参数就能吃光 10 个名额，
 * 真正的"改坏了"却是几十分钟前那一次。按 10 版留一档，等于每 8 秒一个锚点，
 * 覆盖"回头找个大概位置"的需求。
 */
export const MAP_REVISION_EVERY = 10;

/** 缩略图上限（超出的直接拒收，避免列表一次拉几十 MB 图片） */
export const MAP_THUMB_MAX_BYTES = 256 * 1024;

/** 地图文档结构版本（与渲染层 `MapDocument.version` 不同：后者是**内容模型**版本，
 *  这里是**存档格式**版本，只有 doc_json 的整体形状大改时才动） */
export const MAP_DOC_SCHEMA_VERSION = 1;

/**
 * 归一地图名：压掉换行与连续空格、去首尾空白、空则兜底、超长截断。
 *
 * 【为什么压空白】地图名会进列表卡片（单行）与窗口标题，带换行的名字会把卡片
 * 撑成两行且第二行永远看不到；连续空格在中文里通常是误触。
 */
export function normalizeMapTitle(raw: unknown): string {
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!text) return MAP_TITLE_FALLBACK;
  return text.length > MAP_TITLE_MAX ? text.slice(0, MAP_TITLE_MAX) : text;
}

/** 生成地图文档 id（`mp_` 前缀，与 `el_` / `lb_` / `sm_` 同一命名体系） */
export function createMapDocId(uuid: string): string {
  return `mp_${uuid}`;
}

/**
 * 乐观锁判据：调用方读到的版本与库里当前版本不一致 ⇒ 冲突。
 *
 * 【为什么要显式比较而不是直接写】自动保存是异步的，同一张图有可能被两条路径
 * 同时提交（防抖尾巴 + 关窗 flush）。冲突时**回传最新 rev** 而不是静默覆盖，
 * 渲染层才能给出"载入最新 / 覆盖保存"的选择，而不是无声地丢掉一份改动。
 */
export function isRevConflict(baseRev: number, currentRev: number): boolean {
  return Math.round(baseRev) !== Math.round(currentRev);
}

/**
 * 这一次保存之后要不要留一档历史（`rev` 为写入后的新版本号）。
 *
 * rev 从 1 开始计，第 10 / 20 / 30… 版留档 —— 第 0 版（空文档）没有留的价值。
 */
export function shouldSnapshotRevision(nextRev: number): boolean {
  return nextRev > 0 && nextRev % MAP_REVISION_EVERY === 0;
}

/** 视口快照（"回到上次编辑位置"） */
export interface MapViewport {
  x: number;
  y: number;
  scale: number;
}

/**
 * 解析库里的 `last_viewport`（JSON TEXT）。
 *
 * 【为什么非法一律 null 而不是兜底成 0,0,1】视口只影响"打开时看哪里"，坏数据
 * 兜底成一个"看着像正常但其实是错的"位置，比直接回落到"适应窗口"更糟 ——
 * 后者至少是用户熟悉的行为。
 */
export function parseViewport(raw: unknown): MapViewport | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { x, y, scale } = parsed as Record<string, unknown>;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(scale)) return null;
  const s = scale as number;
  if (s <= 0) return null;
  return { x: x as number, y: y as number, scale: s };
}

/** 序列化视口；非法输入返回 null（不写库，保留上次的位置） */
export function serializeViewport(raw: unknown): string | null {
  const viewport = parseViewport(
    typeof raw === "string" ? raw : raw === undefined || raw === null ? null : JSON.stringify(raw),
  );
  return viewport ? JSON.stringify(viewport) : null;
}

/**
 * 缩略图 BLOB → `data:image/png;base64,...`（列表直接塞进 `<img src>`）。
 *
 * 【为什么在主进程转 base64】渲染层拿到 Buffer 只能自己转；而列表一次要渲染
 * 十几个缩略图，每个都过一次 FileReader 等于给自己造一串异步竞态。
 * 转换成本在主进程做一次，IPC 传字符串，渲染层零转换。
 */
export function thumbToDataUrl(blob: unknown): string | null {
  if (!blob) return null;
  let buffer: Buffer;
  if (Buffer.isBuffer(blob)) buffer = blob;
  else if (blob instanceof Uint8Array) buffer = Buffer.from(blob);
  else return null;
  if (buffer.length === 0) return null;
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

/**
 * 版本历史裁剪：只保留最近 `keep` 条（按 rev 倒序取前 keep 条的 rev 作分界）。
 *
 * @param revs 该文档现有历史版本号（升序或乱序均可）
 * @returns 需要删除的版本号列表（空数组 = 无需裁剪）
 */
export function revisionsToDrop(revs: readonly number[], keep: number = MAP_REVISION_KEEP): number[] {
  const limit = Math.max(0, Math.trunc(keep));
  if (revs.length <= limit) return [];
  const sorted = [...revs].sort((a, b) => b - a);
  return sorted.slice(limit);
}

/** 保存结果：成功带新 rev；失败分「冲突」「文档不存在」「无法序列化」三类 */
export type MapSaveResult =
  | { ok: true; rev: number }
  | { ok: false; conflict: true; rev: number }
  | { ok: false; conflict: false; reason: "not_found" | "unserializable" };

/** 作品绑定结果：失败原因是**枚举**（文案归渲染层，主进程不产出句子） */
export type MapBindResult =
  | { ok: true }
  | { ok: false; reason: "work_not_found" | "work_deleted" | "doc_not_found" };
