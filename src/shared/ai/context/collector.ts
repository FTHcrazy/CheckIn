/**
 * AI 上下文采集器（渲染进程侧，纯函数）
 *
 * 职责：把「页面层取好的本书数据快照」归一成 `AiBookContext`，并按 intent
 * **最小化 + 截断**——只给该功能真正需要的字段，避免把整本书塞进 prompt
 * 撑爆 `contextLen`。
 *
 * 边界（AGENTS.md §2.2.2.1）：本层不 import novel 任何模块，也不读 store /
 * IPC；`BookSnapshot` 由调用方（`useNovelPage`）组装好传进来。
 */

/** AI 功能意图：决定采集哪些上下文、截断多长 */
export type AiIntent = "naming" | "polish" | "transform" | "continuation" | "summary";

/** 调用方传入的本书原始快照（页面层组装，允许字段缺失） */
export interface BookSnapshot {
  /** 作品名 */
  workName: string;
  /** 题材（如「仙侠」）；未设置时为空，由调用方按书名/要素做弱兜底 */
  workGenre?: string;
  /** 要素卡（人物 / 地点 / 势力 / 物品 …） */
  entities: Array<{
    type: string;
    name: string;
    aliases?: string[];
    summary?: string;
  }>;
  /** 境界体系各级名称（可空） */
  realmLevels?: string[];
  /** 当前章节片段（润色 / 续写用，本层负责截断） */
  chapterSnippet?: string;
  /** 需避开的已用名；不传则由 entities 的 name + aliases 派生 */
  excludeNames?: string[];
}

/** 归一后的上下文（assembler 的输入） */
export interface AiBookContext {
  work: {
    name: string;
    genre?: string;
  };
  /** 要素摘要（naming 只带 type+name；polish 额外带 summary） */
  entities: Array<{
    type: string;
    name: string;
    summary?: string;
  }>;
  /** 境界名（仅 naming 采集） */
  realmLevels?: string[];
  /** 章节片段（仅 polish / continuation 采集，已截断） */
  chapterSnippet?: string;
  /** 需避开的已用名（仅 naming 采集） */
  excludeNames?: string[];
}

/** 内置类型 → 中文标签；自建类型原样返回（其展示名由 EntityTypeContext 负责，本层不查） */
const BUILTIN_TYPE_LABELS: Record<string, string> = {
  character: "人物",
  location: "地点",
  faction: "势力",
  item: "物品",
  level_system: "境界体系",
  custom: "其他",
};

/** 要素类型的中文标签（供提示词可读性用） */
export function entityTypeLabel(type: string): string {
  return BUILTIN_TYPE_LABELS[type] ?? type;
}

/** 各 intent 的采集上限：数字按「塞进 prompt 后不失控」倒推，不是拍脑袋的默认值 */
const LIMITS = {
  naming: { entities: 40, realmLevels: 12, exclude: 40, summaryChars: 0 },
  polish: { entities: 20, realmLevels: 0, exclude: 0, summaryChars: 120 },
  transform: { entities: 20, realmLevels: 0, exclude: 0, summaryChars: 120 },
  continuation: { entities: 30, realmLevels: 8, exclude: 20, summaryChars: 160 },
  // 摘要只靠「单章全文 + 作品背景」就能写，要素卡是噪音（梗概不需要逐个人物卡）
  summary: { entities: 0, realmLevels: 0, exclude: 0, summaryChars: 0 },
} as const;

/** 章节片段截断上限（字） */
const CHAPTER_SNIPPET_CHARS = 800;

/** 截断加省略号；空值原样返回 */
export function clipText(text: string | undefined, maxChars: number): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (maxChars <= 0) return undefined;
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}…` : trimmed;
}

/** 从要素派生已用名（name + aliases 去重） */
export function deriveExcludeNames(entities: BookSnapshot["entities"]): string[] {
  const set = new Set<string>();
  for (const entity of entities) {
    const name = entity.name?.trim();
    if (name) set.add(name);
    for (const alias of entity.aliases ?? []) {
      const trimmed = alias?.trim();
      if (trimmed) set.add(trimmed);
    }
  }
  return Array.from(set);
}

/**
 * 采集本书上下文。
 *
 * naming：要素只留 type+name（起名只需避重 + 风格锚点），带已用名与境界；
 * polish / transform：要素带 summary（理解人设），带章节片段（理解上下文）；不带已用名。
 */
export function collectBookContext(snapshot: BookSnapshot, intent: AiIntent): AiBookContext {
  const limits = LIMITS[intent];
  const context: AiBookContext = {
    work: {
      name: snapshot.workName?.trim() || "未命名作品",
      genre: snapshot.workGenre?.trim() || undefined,
    },
    entities: [],
  };

  const entities = snapshot.entities ?? [];
  for (const entity of entities.slice(0, limits.entities)) {
    const name = entity.name?.trim();
    if (!name) continue;
    const summary = limits.summaryChars > 0 ? clipText(entity.summary, limits.summaryChars) : undefined;
    context.entities.push({
      type: entityTypeLabel(entity.type),
      name,
      ...(summary ? { summary } : {}),
    });
  }

  if (limits.realmLevels > 0 && snapshot.realmLevels?.length) {
    const levels = snapshot.realmLevels.map((l) => l.trim()).filter(Boolean);
    if (levels.length > 0) context.realmLevels = levels.slice(0, limits.realmLevels);
  }

  if (intent !== "naming" && intent !== "summary") {
    context.chapterSnippet = clipText(snapshot.chapterSnippet, CHAPTER_SNIPPET_CHARS);
  }

  if (limits.exclude > 0) {
    const exclude = snapshot.excludeNames?.length
      ? snapshot.excludeNames
      : deriveExcludeNames(entities);
    const cleaned = Array.from(new Set(exclude.map((n) => n.trim()).filter(Boolean)));
    if (cleaned.length > 0) context.excludeNames = cleaned.slice(0, limits.exclude);
  }

  return context;
}

/** 命中的要素（附带命中位置，便于排查「为什么会带这张卡」） */
export interface MatchedEntity {
  type: string;
  name: string;
  summary?: string;
  /** 命中的字面（可能是别名） */
  matchedText: string;
}

/**
 * 反向匹配：找出「名字/别名出现在这段文字里」的要素卡。
 *
 * 这是润色能识别「这段话里出现了谁」的关键——划词往往是一整句，
 * 正向 `text === entity.name` 命中率极低，必须拿卡去文字里找。
 *
 * 规则：
 * - 只匹配长度 ≥ 2 的名字（单字名在正文里误命中率过高，宁可漏也不错带）；
 * - 人物优先，其余按名字长度降序（长名更具体，避免「李白」吃掉「李白衣」）；
 * - 去重 + 上限 `limit`，避免一次塞十几张卡把 prompt 撑爆。
 */
export function matchEntitiesInText(
  text: string,
  entities: BookSnapshot["entities"],
  options: { limit?: number } = {},
): MatchedEntity[] {
  const body = text ?? "";
  if (!body.trim()) return [];
  const limit = options.limit && options.limit > 0 ? options.limit : 6;

  const hits: Array<MatchedEntity & { priority: number; weightedLength: number }> = [];
  const seen = new Set<string>();

  for (const entity of entities) {
    const name = entity.name?.trim();
    if (!name) continue;
    const candidates = [name, ...(entity.aliases ?? []).map((a) => a?.trim()).filter(Boolean)];
    const matchedText = candidates.find(
      (candidate) => candidate.length >= 2 && body.includes(candidate),
    );
    if (!matchedText) continue;

    const key = name;
    if (seen.has(key)) continue;
    seen.add(key);

    hits.push({
      type: entityTypeLabel(entity.type),
      name,
      ...(entity.summary?.trim() ? { summary: clipText(entity.summary, 120) } : {}),
      matchedText,
      priority: entity.type === "character" ? 0 : 1,
      weightedLength: matchedText.length,
    });
  }

  hits.sort((a, b) => a.priority - b.priority || b.weightedLength - a.weightedLength);
  return hits.slice(0, limit).map((hit) => ({
    type: hit.type,
    name: hit.name,
    ...(hit.summary ? { summary: hit.summary } : {}),
    matchedText: hit.matchedText,
  }));
}
