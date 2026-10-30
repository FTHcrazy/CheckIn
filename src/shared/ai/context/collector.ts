/**
 * AI 上下文采集器（渲染进程侧，纯函数）
 *
 * 职责：把「页面层取好的本书数据快照」归一成 `AiBookContext`，并按 intent
 * **最小化 + 截断**——只给该功能真正需要的字段，避免把整本书塞进 prompt
 * 撑爆 `contextLen`。另提供 `buildChapterScopePayload`：按 L3 授权范围
 * （仅本章 / 选中段落 / 最近 3 章）决定**实际发送哪段正文**。
 *
 * 边界（AGENTS.md §2.2.2.1）：本层不 import novel 任何模块，也不读 store /
 * IPC；`BookSnapshot` 由调用方（`useNovelPage`）组装好传进来。
 *
 * ⚠️ 意图联合类型**只有一个产地**：`prompt/registry.ts` 的 `PromptIntentMap`
 * 的键（`PromptIntent`）。这里只 `import type`，运行期无循环依赖——少一个产地
 * 就少一处「加了功能忘了改」的静默失效（review 第 12 项）。
 */
import type { L3Scope } from "../ai-consent";
import type { PromptIntent } from "./prompt/registry";

/** 本书原始快照（页面层组装，允许字段缺失） */
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
  /**
   * 当前章节片段（润色 / 变换用，本层只做防呆截断）。
   *
   * ⚠️ **片段位置由调用方决定**（2.10.1）：以前页面层传整章、本层前向截断，
   * 结果润色章末段落时送上去的是**章首** 800 字 —— 标注写着「本段所在章节」
   * 却与选区毫无关系。现在由调用方按选区/光标居中切片后传进来。
   */
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

/** 单个意图的采集上限 */
interface CollectLimits {
  entities: number;
  realmLevels: number;
  exclude: number;
  summaryChars: number;
}

/**
 * 各 intent 的采集上限：数字按「塞进 prompt 后不失控」倒推，不是拍脑袋的默认值。
 *
 * `Record<PromptIntent, …>` 而非 `as const` 字面量是刻意的：新增意图时会**编译失败**，
 * 而不是到运行期 `LIMITS[intent]` 取到 `undefined` 再炸采集（review 第 12 项）
 * ——「漏改」必须由类型系统兜，不能靠记性。
 */
const LIMITS: Record<PromptIntent, CollectLimits> = {
  naming: { entities: 40, realmLevels: 12, exclude: 40, summaryChars: 0 },
  polish: { entities: 20, realmLevels: 0, exclude: 0, summaryChars: 120 },
  transform: { entities: 20, realmLevels: 0, exclude: 0, summaryChars: 120 },
  continuation: { entities: 30, realmLevels: 8, exclude: 20, summaryChars: 160 },
  // 摘要只靠「单章全文 + 作品背景」就能写，要素卡是噪音（梗概不需要逐个人物卡）
  summary: { entities: 0, realmLevels: 0, exclude: 0, summaryChars: 0 },
  // 抽取：要素清单只用来**去重**（类型 + 名字足够），所以带上限放宽到 60 张；
  // 正文由调用方按 L3 授权范围传入，不走 chapterSnippet
  extract: { entities: 60, realmLevels: 0, exclude: 0, summaryChars: 0 },
  // 关系推断：要素清单是**端点白名单**（不是背景），必须尽量全；
  // 关系边由调用方另传 `existingEdges` 做去重，不在采集层
  relation: { entities: 80, realmLevels: 0, exclude: 0, summaryChars: 0 },
  // 等级体系生成：只需作品名 + 题材（workBlock），已有阶梯由 intent 传入。
  // 要素卡对「排一条阶梯」是纯噪音，一个都不送 —— 这是全表最省的意图之一。
  levelGen: { entities: 0, realmLevels: 0, exclude: 0, summaryChars: 0 },
};

/** 章节片段的安全上限（字）。**位置由调用方决定**，本层只防呆截断。 */
const CHAPTER_SNIPPET_CHARS = 4000;

/** 需要 `chapterSnippet` 的意图（白名单，见下方采集处的论证） */
const SNIPPET_INTENTS: ReadonlySet<PromptIntent> = new Set<PromptIntent>([
  "polish",
  "transform",
  "continuation",
]);

/** 截断加省略号；空值原样返回 */
export function clipText(text: string | undefined, maxChars: number): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (maxChars <= 0) return undefined;
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}…` : trimmed;
}

/**
 * 送模型的输入字数预算：`contextLen`（token）→ 中文字数。
 *
 * 中文按 2 token/字保守估，并留余量给模型输出（×0.4）。用户配的
 * 「上下文长度」此前是个纯装饰配置（只读写、无消费点），这里是它唯一的
 * 消费入口 —— 配小了就应该真的少送，否则设置项在骗人。
 */
export function inputCharBudget(contextLen: number | undefined, fallbackTokens = 32000): number {
  const tokens = contextLen && contextLen > 0 ? contextLen : fallbackTokens;
  return Math.max(800, Math.floor(tokens * 0.4));
}

/** 上下文片段预算：总预算扣掉正文本身，夹在 [400, 2000] 字 */
export function snippetBudget(contextLen: number | undefined, textChars = 0): number {
  const remaining = inputCharBudget(contextLen) - Math.max(0, textChars);
  return Math.min(2000, Math.max(400, remaining));
}

/**
 * 整章裁剪（摘要专用）：超预算时保留首 60% + 尾 40%，中间标注省略。
 *
 * 摘要是 L3 级调用，送的是**整章**。导入的书单章可能几十万字，直接塞进
 * prompt 会撞上下文上限并静默失败（模型报错 / 截断）。首尾拼接比纯前向
 * 截断更贴近「读完全章」：开头交代场景，结尾交代落点。
 */
export function clipChapterForPrompt(content: string, maxChars: number): string {
  const body = content.trim();
  if (maxChars <= 0 || body.length <= maxChars) return body;
  const head = Math.floor(maxChars * 0.6);
  const tail = Math.max(0, maxChars - head - 40);
  return `${body.slice(0, head)}\n……（中间省略约 ${body.length - maxChars} 字）……\n${body.slice(-tail)}`;
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
export function collectBookContext(snapshot: BookSnapshot, intent: PromptIntent): AiBookContext {
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

  // 正文经 `chapterSnippet` 采集的意图：polish / transform 要「本段所在章节」做风格锚点，
  // continuation 要前文接续。其余（naming / summary / extract / relation）的正文都由
  // 调用方经 intent 参数传入（不受片段截断），这里再塞一份只会重复占用 prompt。
  // 用白名单而不是黑名单：新增意图默认不采集片段，避免「加一个功能悄悄把 prompt 翻倍」。
  if (SNIPPET_INTENTS.has(intent)) {
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

/** 一章正文（L3 范围选择的输入单元；调用方传标题 + 正文即可） */
export interface ScopeChapterInput {
  title: string;
  content: string;
}

/**
 * 按 L3 授权范围算出的「实际要发送的正文」。
 *
 * `ok: false` 只能来自「范围选了选中段落，但正文里没有选中任何内容」——
 * 这种情况**必须拒绝发送**，不能偷偷退回整章：用户选「选中段落」表达的是
 * 「只发这一段」的隐私意图，退回整章等于超发（review G4 的核心指控）。
 */
export type ChapterScopePayload =
  | {
      ok: true;
      /** 主正文：chapter / recent3 为整章，selection 为选中段落 */
      chapterText: string;
      /** 前情节选（仅 recent3）：更早章节的节选，按故事时间正序（远的在前） */
      contextText?: string;
      /** 实际送出的正文字数（弹窗估算与 ai_event.char_count 的口径） */
      chars: number;
    }
  | { ok: false; reason: "no-selection" };

/** recent3 的预算分配：本章 60% / 前一章 25% / 前二章 15%（越近留得越多） */
const RECENT3_BUDGET_SHARES = [0.6, 0.25, 0.15] as const;

/**
 * 按 L3 授权范围挑出要发送的正文（纯函数，`useNovelPage` 与单测共用）。
 *
 * 三档语义（PRD §5.3，`ai-consent.ts` 的 `L3Scope`）：
 * - `chapter`：只发本章——默认档，也是唯一「无需额外条件」的档；
 * - `selection`：只发选中段落；没有选区就**不发**（返回 no-selection）；
 * - `recent3`：本章 + 紧邻的前两章（拿不到两章就有几章发几章），
 *   预算按 60/25/15 分摊——摘要要的是「本章发生了什么」，
 *   更早的章只是让模型知道从哪接上来，给足摘要主体才是重点。
 *
 * 预算来自 `inputCharBudget(contextLen)`，与其余 intent 同源：用户把上下文
 * 长度配小，这里就真的少发，不留「设置项看着生效、实际全量发送」的口子。
 */
export function buildChapterScopePayload(params: {
  scope: L3Scope;
  /** 目标章（摘要的那一章） */
  chapter: ScopeChapterInput;
  /** 前序章节（正序，末尾为紧邻的上一章）；仅 recent3 使用，最多取 2 章 */
  previousChapters?: ScopeChapterInput[];
  /** 选区文本（selection 档必填） */
  selection?: string;
  /** 正文总字数预算 */
  budget: number;
}): ChapterScopePayload {
  const { scope, chapter, budget } = params;

  if (scope === "selection") {
    const selected = params.selection?.trim();
    if (!selected) return { ok: false, reason: "no-selection" };
    const chapterText = clipChapterForPrompt(selected, budget);
    return { ok: true, chapterText, chars: chapterText.length };
  }

  if (scope === "recent3") {
    const previous = (params.previousChapters ?? []).filter((item) => item.content?.trim());
    // 先按「离本章的距离」取预算份额（本章 60%、前一章 25%、前二章 15%）
    const picked = previous.slice(-2).reverse(); // [前一章, 前二章]
    const chapterText = clipChapterForPrompt(
      chapter.content,
      Math.floor(budget * RECENT3_BUDGET_SHARES[0]),
    );
    const contextParts = picked.map((item, index) => {
      const share = RECENT3_BUDGET_SHARES[index + 1] ?? 0;
      const text = clipChapterForPrompt(item.content, Math.floor(budget * share));
      return `【${item.title.trim() || "未命名章节"}】\n${text}`;
    });
    // 送进 prompt 时按故事时间正序（远的在前），读起来才像「前情」
    const contextText = contextParts.length > 0 ? [...contextParts].reverse().join("\n\n") : undefined;
    return {
      ok: true,
      chapterText,
      ...(contextText ? { contextText } : {}),
      chars: chapterText.length + (contextText?.length ?? 0),
    };
  }

  const chapterText = clipChapterForPrompt(chapter.content, budget);
  return { ok: true, chapterText, chars: chapterText.length };
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
