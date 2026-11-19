/**
 * 卡文救援 · 剧情分支模板（R-AI-11）
 *
 * 作者写到一半卡住了（不知道接下来该发生什么），让 AI 基于**已有的正文处境**
 * 给出 3–5 条互不相同的后续走向，每条 = 标题 + 核心冲突 + 走向后果。
 * 作者勾选一条或几条，按勾选顺序拼进正文。
 *
 * 定位是**走向而非正文**：本模板刻意不产出可插入的成稿段落——
 * 一次性给出六七百字正文，作者要么整段照收（失去自己的语感），
 * 要么推翻重写（等于白花一次调用）。给三段式短卡片，作者挑一条自己写。
 *
 * 为什么必须是 `json-array`：一条走向是三字段结构（标题 / 冲突 / 后果），
 * 自由文本没法稳定拆回来；而且 R-AI-11 用**分段流式**（§3.4）——
 * 每识别出一个完整 `{...}` 就落一张卡，作者不必等全部生成完。
 *
 * 与「续写」（`continuation`）的边界：
 * - 续写 = 顺着前文**接着写正文**（text 契约，逐字流式）；
 * - 卡文救援 = **给几条可选走向**（json-array，逐条落卡），选完再由作者写。
 *
 * ⚠️ 正文是 L3 数据：调用方必须先过 M5 授权再调本模板，本层不感知授权。
 */
import type { AiBookContext } from "../types";
import type { OutputFormat } from "../../../../output-spec";
import type { PromptSpec } from "../../../types";
import { composePrompt, constraintBlock, outputBlock, roleBlock } from "../../../kit";
import { entityBlock, workBlock } from "../sections";
import { CONTINUATION_SUMMARY_MIN_BEFORE_CHARS } from "./continuation";

/**
 * 风格旋钮的四个档位。
 *
 * 四档而不是「随便来点」，是因为「换一批」如果不换**约束**，
 * 模型只会把同一批走向换个说法重排一遍，作者按三次也看不到新东西。
 */
export type RescueStyle = "default" | "darker" | "restrained" | "twist";

/** 运行期遍历用（`RescueStyleBar` 的 `Segmented` 选项顺序） */
export const RESCUE_STYLES = ["default", "darker", "restrained", "twist"] as const;

/** 风格 → 旋钮文案（UI 唯一产地，面板不另写字面量） */
export const RESCUE_STYLE_LABELS: Record<RescueStyle, string> = {
  default: "稳妥推进",
  darker: "更黑暗",
  restrained: "更克制",
  twist: "强烈反转",
};

/**
 * 风格 → 硬约束（进 prompt 的那一句）。
 *
 * 每一档都写了「**不要**做什么」：只说「更黑暗」，模型会直接加血浆与暴毙；
 * 明确排除掉廉价做法，出来的才是能用的走向。
 */
const STYLE_HINTS: Record<RescueStyle, string> = {
  default:
    "按当前文风稳妥推进：不引入新设定、不掉新道具，靠在场人物已有的动机把眼前这个局往前推一步；",
  darker:
    "加重代价与压迫感：让人物付出真实损失、暴露自己的阴暗面。但不要为黑而黑——不搞无铺垫的暴力与死亡，也不要让刚立住的人物突然变成反派；",
  restrained:
    "压低戏剧性：用留白、克制对白与小动作代替直白情绪，冲突藏在水面下。不要写成大爆发、大吵、大哭；",
  twist:
    "给一个读者没预料到、但回头能对上伏笔的转折：优先从已有设定与未收伏笔里找支点，不要凭空掉下一个新势力或新金手指；",
};

/** 风格值的类型守卫（外部字符串 → 单例联合，避免 `as` 断言） */
export function isRescueStyle(value: string | undefined): value is RescueStyle {
  return (
    value === "default" || value === "darker" || value === "restrained" || value === "twist"
  );
}

/** 从大纲触发时的节点入参（`OutlinePanel` 已持有这两个字段） */
export interface BranchOutlineNode {
  /** 节点标题（章节名 / 情节节点名） */
  title: string;
  /** 节点梗概：这一节要推进什么 */
  gist: string;
}

/** 卡文救援意图参数 */
export interface BranchIntent {
  /** L3 范围构造出的正文（chapter / selection / recent3 的 chapterText，调用方已裁剪） */
  chapter: string;
  /** 大纲节点入参（从大纲入口触发时给） */
  outlineNode?: BranchOutlineNode;
  /** 选中段落（selection 档必填；其它档可空，给了就一并当「卡住的位置」看） */
  selection?: string;
  /** R-AI-09 摘要：与前文同口径，仅前文短于 300 字时注入 */
  summary?: string;
  /**
   * 前情节选（仅 `recent3` 范围）。
   *
   * 架构 §2.1 的 `BranchIntent` 没写这一项，但 `recent3` 档的语义就是
   * 「本章 + 紧邻两章」：不给前情，模型看到的是一个没有前因的片段，走向会跑偏。
   * 与 `relation` / `extract` 同名字段同义：**只作背景**，不作为改写对象。
   */
  contextText?: string;
  /** 题材（`AiBookContext.work.genre` 缺失时的兜底） */
  genre?: string;
  /** 风格旋钮 */
  style: RescueStyle;
  /** 期望产出的条数，builder 内 clamp 到 [3,5] */
  count: number;
}

/** 输出契约：走向标题 / 核心冲突 / 走向后果 */
export const BRANCH_OUTPUT_FORMAT: OutputFormat = {
  kind: "json-array",
  fields: [
    { key: "title", type: "string", label: "走向标题" },
    { key: "conflict", type: "string", label: "核心冲突" },
    { key: "consequence", type: "string", label: "走向后果" },
  ],
};

/** 条数区间：少于 3 条不算「几个方向」，多于 5 条作者挑不动 */
export const BRANCH_COUNT_RANGE = { min: 3, max: 5 } as const;

/** 默认条数（面板初始值，与 clamp 口径同源） */
export const BRANCH_DEFAULT_COUNT = 4;

/**
 * 把条数夹进 [3,5]（纯函数，供面板与模板共用同一口径）。
 *
 * 面板上调过 `count` 之后必须用本函数再算一次展示值，
 * 否则「UI 显示 8 条、实际发 5 条」这种错位会一路错到作者脸上。
 */
export function clampBranchCount(count: number | undefined): number {
  if (!count || !Number.isFinite(count)) return BRANCH_DEFAULT_COUNT;
  return Math.min(BRANCH_COUNT_RANGE.max, Math.max(BRANCH_COUNT_RANGE.min, Math.floor(count)));
}

/** 摘要注入的字数上限（摘要模板要求 150–300 字，这里只防呆） */
const BRANCH_SUMMARY_MAX_CHARS = 400;

const ROLE =
  "你是一名网文剧情策划。作者在写作途中卡住了，请基于他给出的**已有正文与设定**，给出几条互不相同的后续走向，供他挑一条接着写。要求：";

/**
 * 决定「上一章摘要」要不要进 prompt。
 *
 * 阈值直接复用续写那条常量（300 字）：这是同一件事——前文够长时摘要纯属冗余，
 * 还会与紧邻的正文打架；只有光标停在新章开头这类「前文几乎是空的」场景才需要。
 * 两处各写一个 300 就是两个口径，迟早会漂。
 */
function pickSummary(chapter: string, summary: string | undefined): string | undefined {
  const text = summary?.trim();
  if (!text) return undefined;
  if (chapter.length >= CONTINUATION_SUMMARY_MIN_BEFORE_CHARS) return undefined;
  return text.length > BRANCH_SUMMARY_MAX_CHARS
    ? `${text.slice(0, BRANCH_SUMMARY_MAX_CHARS)}…`
    : text;
}

/**
 * 组装卡文救援 Prompt。
 *
 * 三入口（编辑器 / 大纲 / 灵感面板）共用本模板，入参差异只在
 * `outlineNode` / `selection` 的有无，**system 文本只有这一处产出**。
 */
export function assembleBranchSpec(
  context: AiBookContext,
  intent: BranchIntent,
): PromptSpec {
  const chapter = intent.chapter?.trim() ?? "";
  const selection = intent.selection?.trim();
  const count = clampBranchCount(intent.count);
  const style: RescueStyle = isRescueStyle(intent.style) ? intent.style : "default";
  const nodeTitle = intent.outlineNode?.title?.trim();
  const nodeGist = intent.outlineNode?.gist?.trim();
  const summary = pickSummary(chapter, intent.summary);
  const contextText = intent.contextText?.trim();
  // 题材优先取上下文（`workBlock` 里那一条），上下文没有才用 intent 的兜底值
  const fallbackGenre = context.work.genre ? undefined : intent.genre?.trim();

  // 正文块：选中段落档只发那一段（`chapter` 为空是刻意的——把整章塞上去
  // 等于绕过了用户选的「只发这一段」，那是超发）
  const bodyBlocks = selection
    ? [
        `【卡住的段落】\n${selection}`,
        chapter ? `【本章正文（只作背景，不要求改写它）】\n${chapter}` : null,
      ]
    : [`【正文（作者写到这里卡住了）】\n${chapter || "（本章暂无正文，请基于已有设定给开局走向）"}`];

  return {
    system: composePrompt(
      roleBlock(ROLE),
      workBlock(context),
      fallbackGenre ? `【题材】${fallbackGenre}` : null,
      // 人物白名单：走向可以让人物做出新选择，但不能凭空多出一个「有名有姓」的人——
      // 那样作者想采纳也得先停下建卡，救援就变成了负担
      entityBlock(
        context,
        "所有出场人物、地点、势力**必须**是上面这些名字之一；可以让他们的处境与选择发生变化，但不要凭空新增有名有姓的角色或势力。",
      ),
      nodeTitle
        ? `【当前剧情节点】${nodeTitle}${nodeGist ? `\n- 这一节点要推进的是：${nodeGist}` : ""}\n- 每条走向都必须让故事朝这个节点的目标前进，不要绕开它另起炉灶。`
        : null,
      summary
        ? `【上一章摘要】${summary}\n- 这是**已经发生**的剧情：走向不得与之矛盾（不得让已死的角色复活、不得推翻已揭示的结论）。`
        : null,
      contextText ? `【前情（只作背景，不要改写它）】\n${contextText}` : null,
      ...bodyBlocks,
      constraintBlock([
        `必须输出 ${count} 条，条与条之间**走向不同**：不能只是措辞不同、结局相同；`,
        `"title" 是 6–14 字的短标题（如「当场翻脸，撕破师徒名分」），不要写序号、不要写成问句、不要加书名号；`,
        `"conflict" 一句话（30–60 字）说清这条走向把人物推进了什么冲突：谁和谁、为了什么、卡在哪；`,
        `"consequence" 一句话（30–60 字）说清这条走向的代价或后效：会失去什么、会暴露什么、给后面埋下什么；`,
        STYLE_HINTS[style],
        "三条合起来要能让作者一眼判断「要不要这么走」；不要写成大纲要点清单，也不要直接写正文成稿；",
        "只依据【正文】与【已有要素】里已经成立的事实推进；需要新角色时用「一名…」「那人」概括，不要起名字；",
        "正文信息不足以判断人物处境时，宁可给更保守的走向，也不要编造前情与身世；",
      ]),
      outputBlock(BRANCH_OUTPUT_FORMAT),
    ),
    prompt: `请基于上述处境，给出 ${count} 条互不相同的后续走向（风格：${RESCUE_STYLE_LABELS[style]}），按约定输出 JSON 数组。`,
    outputFormat: BRANCH_OUTPUT_FORMAT,
  };
}
