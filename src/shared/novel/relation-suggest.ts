/**
 * 关系建议的候选构造（R-AI-15，纯函数）
 *
 * 模型从一章正文里读出「李玄 · 师徒 · 苏棠」，这一层把它变成**可勾选的候选**：
 * 端点必须能在要素库里解析到 id、关系名必须像关系名、已经存在的边不重复列。
 *
 * 三条硬口径（都来自 PRD 的风险表）：
 * 1. **只建新边，不改已有边**：与 R-AI-10a 的分工是「10a 报问题，15 建资产」，
 *    所以这里只产出 `addLinks`，永远不产出删除 / 改写。
 * 2. **端点必须已存在**：模型爱顺手编名字，把「李玄的师父」当成一个人物很正常。
 *    解析不到一律丢弃并计数，让上层能说清「有 3 条提到的人还没建卡」——
 *    静默丢弃会让作者以为模型漏读。
 * 3. **同一对端点 + 同一关系名 = 已存在**：`novel_links` 允许平行关系
 *    （既是师徒又是父子是合法的），所以去重键必须带关系名，不能只看端点对。
 *
 * 无向：库里 A→B 与 B→A 是同一对（画布上的边也是无向绘制的），去重时两边都查。
 *
 * 本文件不读库、不碰 store、不 import 任何窗口模块：可单测，也可被主窗口复用。
 */
import type { EntityType } from "./entity-model";

/** 关系名上限：与 `RelationCreateDialog` 的输入上限同一数字（一句话能写清的长度） */
export const RELATION_NAME_MAX = 24;

/** 单次最多列多少条候选（再多作者勾不过来，也会把画布塞爆） */
export const MAX_RELATION_CANDIDATES = 40;

/** 证据句上限：够定位到正文哪一段，又不至于把一屏都占满 */
const EVIDENCE_MAX = 60;

/** 置信度三档（低档默认不勾选，PRD 风险表「低置信默认不勾选」） */
export type RelationConfidence = "high" | "medium" | "low";

/** 置信度中文标签（面板与帮助手册共用） */
export const RELATION_CONFIDENCE_LABELS: Record<RelationConfidence, string> = {
  high: "高置信",
  medium: "中置信",
  low: "低置信",
};

/** 置信度排序权重（排序用：高置信在前，作者先看最可能对的） */
const CONFIDENCE_RANK: Record<RelationConfidence, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/** 一条待确认的关系候选 */
export interface RelationCandidate {
  /** 稳定键：fromId + toId（排序后）+ relation，勾选态按它索引 */
  key: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  relation: string;
  confidence: RelationConfidence;
  /** 原文依据（模型摘的句子，可能为空） */
  evidence: string;
  /** 默认勾选态：低置信不勾（「已有关系」不在这里出现，构造时已剔除） */
  selected: boolean;
}

/** 丢弃统计（如实告诉作者「模型的哪些产出没被采纳」） */
export interface RelationSuggestDropped {
  /** 端点在要素库里找不到（多半是还没建卡） */
  unknown: number;
  /** 自己连自己 */
  selfLoop: number;
  /** 关系名不像关系名（空 / 过长 / 整句话） */
  invalid: number;
  /** 本次列表内重复（同一对 + 同一关系出现两次） */
  duplicate: number;
}

export interface RelationSuggestResult {
  candidates: RelationCandidate[];
  dropped: RelationSuggestDropped;
}

/** 构造候选时需要的要素（只要解析端点用的字段） */
export interface RelationEntityInput {
  id: string;
  name: string;
  type: EntityType;
  aliases?: readonly string[];
}

/** 构造候选时需要的已有边（去重用） */
export interface RelationLinkInput {
  fromId: string;
  toId: string;
  relation: string;
}

/** 名字归一：去空白与模型爱加的引号 / 书名号；不做大小写折叠（中文名无大小写） */
export function normalizeEntityName(raw: string): string {
  return (raw ?? "")
    .trim()
    .replace(/^[《「『"'“”‘’（(【[]+/, "")
    .replace(/[》」』"'“”‘’）)】\]]+$/, "")
    .trim();
}

/**
 * 关系名归一：去空白、去包裹符号、折叠内部空格。
 *
 * 模型经常给「是 师徒 关系」「「师徒」」这类包装，直接写进库里会让同一件事
 * 出现三个关系名，画布上的边标签也就对不齐。整句（带标点）判为不合法。
 */
export function normalizeRelationName(raw: string): string {
  const text = (raw ?? "")
    .trim()
    .replace(/^[《「『"'“”‘’]+/, "")
    .replace(/[》」』"'“”‘’]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  // 带句读标点的一律不认：那是描述而不是关系名
  if (/[，。；！？,.;!?、…]/.test(text)) return "";
  return text.slice(0, RELATION_NAME_MAX);
}

const CONFIDENCE_ALIASES: Record<string, RelationConfidence> = {
  high: "high",
  strong: "high",
  高: "high",
  高置信: "high",
  确定: "high",
  明确: "high",
  medium: "medium",
  mid: "medium",
  normal: "medium",
  medium置信: "medium",
  中: "medium",
  中置信: "medium",
  中等: "medium",
  可能: "medium",
  low: "low",
  weak: "low",
  低: "low",
  低置信: "low",
  存疑: "low",
  不确定: "low",
};

/**
 * 置信度归一：接受 `high/中/0.8/likely` 等各种写法。
 *
 * 无法识别时按 `medium`：判成 low 会让这条默认不勾（作者可能就漏了），
 * 判成 high 又会把不确定的排到最前面 —— 中档是唯一不会误导的默认。
 */
export function normalizeConfidence(raw: unknown): RelationConfidence {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw >= 0.75) return "high";
    if (raw >= 0.45) return "medium";
    return "low";
  }
  if (typeof raw !== "string") return "medium";
  const text = raw.trim().toLowerCase();
  if (!text) return "medium";
  // 纯数字字符串（"0.8" / "80%"）按比例判
  const numeric = Number(text.replace(/%$/, ""));
  if (Number.isFinite(numeric) && /^[\d.]+%?$/.test(text)) {
    const ratio = numeric > 1 ? numeric / 100 : numeric;
    if (ratio >= 0.75) return "high";
    if (ratio >= 0.45) return "medium";
    return "low";
  }
  return CONFIDENCE_ALIASES[text] ?? "medium";
}

/** 无向端点对键：与端点顺序无关，A→B 与 B→A 得到同一个键 */
export function relationPairKey(fromId: string, toId: string): string {
  return fromId <= toId ? `${fromId}|${toId}` : `${toId}|${fromId}`;
}

/** 候选键：端点对 + 关系名（同一对可以有平行关系，所以关系名必须进键） */
export function relationCandidateKey(fromId: string, toId: string, relation: string): string {
  return `${relationPairKey(fromId, toId)}|${relation}`;
}

/** 名字 → 要素索引（含别名；同名以正名优先，别名不覆盖正名） */
function buildNameIndex(entities: readonly RelationEntityInput[]): Map<string, RelationEntityInput> {
  const index = new Map<string, RelationEntityInput>();
  for (const entity of entities) {
    const name = normalizeEntityName(entity.name);
    if (name && !index.has(name)) index.set(name, entity);
  }
  for (const entity of entities) {
    for (const alias of entity.aliases ?? []) {
      const name = normalizeEntityName(alias);
      // 别名撞上别人的正名时不覆盖：正名是更强的事实
      if (name && !index.has(name)) index.set(name, entity);
    }
  }
  return index;
}

/** 有效证据句：压空白、截断；模型偶尔把整段抄回来 */
function clampEvidence(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const text = raw.replace(/\s+/g, " ").trim();
  return text.length > EVIDENCE_MAX ? `${text.slice(0, EVIDENCE_MAX)}…` : text;
}

/** 读模型条目里的一个字段（容忍 from/fromName/source 等叫法） */
function pick(entry: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = entry[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

/**
 * 把模型产出变成候选列表。
 *
 * `limit` 只截候选条数，不截丢弃统计 —— 统计要让作者知道「模型其实给了 12 条」。
 */
export function buildRelationCandidates(
  entries: readonly unknown[],
  options: {
    entities: readonly RelationEntityInput[];
    links: readonly RelationLinkInput[];
    limit?: number;
  },
): RelationSuggestResult {
  const dropped: RelationSuggestDropped = { unknown: 0, selfLoop: 0, invalid: 0, duplicate: 0 };
  const nameIndex = buildNameIndex(options.entities);
  const existingKeys = new Set(
    options.links.map((link) => relationCandidateKey(link.fromId, link.toId, link.relation.trim())),
  );
  const limit = Math.min(MAX_RELATION_CANDIDATES, Math.max(1, Math.floor(options.limit ?? 20)));

  const seen = new Set<string>();
  const candidates: RelationCandidate[] = [];

  for (const raw of entries) {
    if (!raw || typeof raw !== "object") {
      dropped.invalid += 1;
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const fromName = normalizeEntityName(String(pick(entry, ["from", "fromName", "source", "a"]) ?? ""));
    const toName = normalizeEntityName(String(pick(entry, ["to", "toName", "target", "b"]) ?? ""));
    const relation = normalizeRelationName(
      String(pick(entry, ["relation", "label", "type", "name"]) ?? ""),
    );

    if (!fromName || !toName || !relation) {
      dropped.invalid += 1;
      continue;
    }

    const from = nameIndex.get(fromName);
    const to = nameIndex.get(toName);
    if (!from || !to) {
      dropped.unknown += 1;
      continue;
    }
    if (from.id === to.id) {
      dropped.selfLoop += 1;
      continue;
    }

    const key = relationCandidateKey(from.id, to.id, relation);
    if (seen.has(key) || existingKeys.has(key)) {
      // 已存在的边不列：列出来必然不可勾，只是噪音（与抽取面板「已存在」不同，
      // 那里保留了行是为了让作者知道「这张卡已经有了」；这里边已经画在画布上，
      // 作者回画布就能看见，不需要在候选里再确认一次）
      dropped.duplicate += 1;
      continue;
    }
    if (candidates.length >= limit) {
      dropped.duplicate += 1;
      continue;
    }
    seen.add(key);

    const confidence = normalizeConfidence(pick(entry, ["confidence", "certainty", "score"]));
    candidates.push({
      key,
      fromId: from.id,
      fromName: from.name,
      toId: to.id,
      toName: to.name,
      relation,
      confidence,
      evidence: clampEvidence(pick(entry, ["evidence", "quote", "sentence"])),
      // PRD 风险表：低置信默认不勾 —— 误判关系（仇人判成恋人）比漏掉一条更尴尬
      selected: confidence !== "low",
    });
  }

  // 高置信优先：作者从上往下勾，最可能对的必须在最前面
  candidates.sort((a, b) => CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence]);

  return { candidates, dropped };
}

/** 勾选条数（真正会写入的条数） */
export function countPicked(candidates: readonly RelationCandidate[]): number {
  return candidates.filter((item) => item.selected).length;
}
