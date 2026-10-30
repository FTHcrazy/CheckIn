/**
 * 画布记忆（成员集合 + 坐标 + 视口），纯函数层
 *
 * 存储位置：`novel_config` 的**单键** `novel_rel_graph_v1:<workId>:<graphId>`
 * （需求增量 §2.4）。为什么一个作品一个键、而不是一个键装全部作品：
 * 一个键装全部 = 每次写都要「读 → 合并 → 写」，图窗口与主窗口同时写会互相覆盖；
 * 单键直写把竞争面缩到「同一本书」，跨作品互不影响。
 *
 * `members` 的 key 集就是「上图成员」，池 = 全部要素 − members。坐标与成员合一，
 * 不另存 `pool[]` —— 两份真相迟早漂移成「成员表说 A、坐标表没有 A」。
 *
 * 本文件不读库、不碰 DOM：解析 / 校验 / 增删 / 播种全部是纯函数，可单测。
 */

/** 键前缀（主进程删作品时按同一前缀级联，见 novel-handlers 的 novel-work-delete） */
export const REL_GRAPH_KEY_PREFIX = "novel_rel_graph_v1";

/** 本期只有一张图；多视图只需换 graphId（键结构已预留） */
export const DEFAULT_GRAPH_ID = "g1";

/** 结构版本：不匹配即整条丢弃（旧版 `nodes/k/tx/ty/tf` 一律不认） */
export const REL_GRAPH_DOC_VERSION = 2;

/** `[x, y, fixed]`：fixed=1 表示用户手工拖过，布局不再动它 */
export type MemberTuple = [number, number, 0 | 1];

export interface GraphViewport {
  k: number;
  tx: number;
  ty: number;
}

export interface RelGraphDoc {
  v: number;
  /** 调试用时间戳，不参与逻辑 */
  ts: number;
  view: GraphViewport;
  /** 成员集合 = 坐标表（单一真相） */
  members: Record<string, MemberTuple>;
  /** 每次成功写入自增，供跨窗口冲突检测 */
  rev: number;
  /** 首次自动铺开已完成（避免每次打开重跑播种 / 重写库） */
  autoSeeded: 0 | 1;
}

export interface GraphPoint {
  x: number;
  y: number;
}

/** config 键名。workId 为空时返回空串（调用方据此跳过读写） */
export function graphDocKey(workId: string, graphId: string = DEFAULT_GRAPH_ID): string {
  if (!workId) return "";
  return `${REL_GRAPH_KEY_PREFIX}:${workId}:${graphId}`;
}

export function createEmptyGraphDoc(): RelGraphDoc {
  return {
    v: REL_GRAPH_DOC_VERSION,
    ts: 0,
    view: { k: 1, tx: 0, ty: 0 },
    members: {},
    rev: 0,
    autoSeeded: 0,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseMember(value: unknown): MemberTuple | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [x, y, fixed] = value as unknown[];
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  return [x, y, fixed === 1 ? 1 : 0];
}

function parseViewport(value: unknown): GraphViewport {
  if (!value || typeof value !== "object") return { k: 1, tx: 0, ty: 0 };
  const raw = value as { k?: unknown; tx?: unknown; ty?: unknown };
  return {
    // k=0 会让画布不可见，按 1 兜底
    k: isFiniteNumber(raw.k) && raw.k > 0 ? raw.k : 1,
    tx: isFiniteNumber(raw.tx) ? raw.tx : 0,
    ty: isFiniteNumber(raw.ty) ? raw.ty : 0,
  };
}

/**
 * 解析一条记忆。`null` = 没有 / 不可用（调用方按「首次打开」处理）。
 *
 * 坏数据一律降级为空文档，**绝不抛错**：一条脏 config 不该让整窗白屏。
 */
export function parseGraphDoc(raw: string | null | undefined): RelGraphDoc | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const rawDoc = parsed as {
    v?: unknown;
    ts?: unknown;
    view?: unknown;
    members?: unknown;
    rev?: unknown;
    autoSeeded?: unknown;
  };
  // 版本不匹配＝结构已变（v1 的 nodes/k/tx/ty/tf 完全不同），整条丢弃重播种
  if (rawDoc.v !== REL_GRAPH_DOC_VERSION) return null;

  const members: Record<string, MemberTuple> = {};
  if (rawDoc.members && typeof rawDoc.members === "object") {
    for (const [id, value] of Object.entries(rawDoc.members as Record<string, unknown>)) {
      if (!id) continue;
      const tuple = parseMember(value);
      if (tuple) members[id] = tuple;
    }
  }

  return {
    v: REL_GRAPH_DOC_VERSION,
    ts: isFiniteNumber(rawDoc.ts) ? rawDoc.ts : 0,
    view: parseViewport(rawDoc.view),
    members,
    rev: isFiniteNumber(rawDoc.rev) && rawDoc.rev >= 0 ? Math.floor(rawDoc.rev) : 0,
    autoSeeded: rawDoc.autoSeeded === 1 ? 1 : 0,
  };
}

export function serializeGraphDoc(doc: RelGraphDoc): string {
  return JSON.stringify(doc);
}

/** 成员 id 列表（派生层用它判断「谁上图」） */
export function memberIds(doc: RelGraphDoc | null): string[] {
  return doc ? Object.keys(doc.members) : [];
}

/** 写库前的收口：剔除已不存在的要素，避免卡片删了坐标还留着无限增长 */
export function pruneMembers(
  doc: RelGraphDoc,
  validIds: ReadonlySet<string>,
): { doc: RelGraphDoc; removed: number } {
  const members: Record<string, MemberTuple> = {};
  let removed = 0;
  for (const [id, tuple] of Object.entries(doc.members)) {
    if (validIds.has(id)) members[id] = tuple;
    else removed += 1;
  }
  if (removed === 0) return { doc, removed: 0 };
  return { doc: { ...doc, members }, removed };
}

/** 上图：新成员固定在该落点（fixed=1，用户拖进来的位置就是他要的位置） */
export function withMember(
  doc: RelGraphDoc,
  id: string,
  point: GraphPoint,
  options: { fixed?: 0 | 1 } = {},
): RelGraphDoc {
  if (!id) return doc;
  const fixed = options.fixed ?? 1;
  return {
    ...doc,
    members: { ...doc.members, [id]: [Math.round(point.x), Math.round(point.y), fixed] },
  };
}

/** 移动已有成员（拖拽落手）；未上图的 id 不凭空加成成员 */
export function withMemberPosition(
  doc: RelGraphDoc,
  id: string,
  point: GraphPoint,
  fixed: 0 | 1 = 1,
): RelGraphDoc {
  if (!doc.members[id]) return doc;
  return {
    ...doc,
    members: {
      ...doc.members,
      [id]: [Math.round(point.x), Math.round(point.y), fixed],
    },
  };
}

/** 拖回池子：只移出画布，**不动关系数据**（关系仍在右栏） */
export function withoutMember(doc: RelGraphDoc, id: string): RelGraphDoc {
  if (!doc.members[id]) return doc;
  const members = { ...doc.members };
  delete members[id];
  return { ...doc, members };
}

export interface SeedMember {
  id: string;
  point: GraphPoint;
}

/**
 * 首次自动铺开：把「已有关系的要素」按布局坐标一次性写成成员。
 *
 * 已存在的成员**不覆盖**（用户拖过的位置优先）；只补缺、只播种一次。
 */
export function seedMembers(
  doc: RelGraphDoc,
  seeds: readonly SeedMember[],
): { doc: RelGraphDoc; added: number } {
  const members = { ...doc.members };
  let added = 0;
  for (const seed of seeds) {
    if (!seed.id || members[seed.id]) continue;
    members[seed.id] = [Math.round(seed.point.x), Math.round(seed.point.y), 0];
    added += 1;
  }
  return {
    doc: { ...doc, members, autoSeeded: 1 },
    added,
  };
}

/** 标记「已播种」，用于「这本书一条关联都没有」的场景（不必写空成员也算完成） */
export function markSeeded(doc: RelGraphDoc): RelGraphDoc {
  if (doc.autoSeeded === 1) return doc;
  return { ...doc, autoSeeded: 1 };
}

/** 落库前统一加 rev 与时间戳（rev 由调用方按写回结果维护，这里只负责推进） */
export function stampGraphDoc(doc: RelGraphDoc, now: number = Date.now()): RelGraphDoc {
  return { ...doc, ts: now, rev: doc.rev + 1 };
}

export function setViewport(doc: RelGraphDoc, view: GraphViewport): RelGraphDoc {
  if (doc.view.k === view.k && doc.view.tx === view.tx && doc.view.ty === view.ty) return doc;
  return { ...doc, view };
}
