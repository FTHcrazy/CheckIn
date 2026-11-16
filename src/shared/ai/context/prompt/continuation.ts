/**
 * 续写模板（R-AI-07，B5 流式版）
 *
 * 光标停在卡住的地方，让 AI 顺着「光标前文」往下写一段（逐字流式输出），
 * 作者随时可中断保留已生成部分，确认后再插入。定位是**跳板而非代笔**：
 * 一次出 2–4 段（约 300–600 字），UI 文案强调「接着改」。
 *
 * 分段口径与正文一致（R-AI-11）：**单换行分段、不空行、不手动缩进**。
 * 模型这两点默认都会做错，模板里明确禁止，调用方还会再过一遍
 * `normalizeContinuationText` 兜底。
 *
 * 与润色 / 变换的边界：
 * - 润色 / 变换 = 改写**已有**文字（有明确的输入文本，输出替换选区）；
 * - 续写 = 生成**新的**文字（输入是「前文」，输出插到光标后，不覆盖任何原文）。
 *
 * 素材全部由调用方给（纯数据）：`before` 是光标前的一段正文（调用方已截断），
 * `characters` 是前文命中的人物卡，`outlineNode` 是当前大纲节点，`previousSummary`
 * 是上一章 AI 摘要（前文够短时才注入，见 `CONTINUATION_SUMMARY_MIN_BEFORE_CHARS`）。
 * 本层不 import novel、不感知「编辑器」「光标」等业务概念。
 */
import type { AiBookContext } from "../collector";
import type { CharacterRef, PromptSpec } from "./types";
import {
  characterBlock,
  composePrompt,
  constraintBlock,
  outputBlock,
  roleBlock,
  workBlock,
} from "./sections";
import type { OutputFormat } from "../output-spec";

/**
 * 续写流式输出契约（B5）：单段正文，纯 text 输出。
 *
 * 流式续写与「2–3 候选」的本质差异：逐字输出时没有「候选」概念，模型
 * 顺前文直接往下写一段（打字机），作者随时可中断保留已生成部分。故流式
 * 版改用 text 契约（非 json-array），与润色同款。
 */
export const CONTINUATION_STREAM_OUTPUT_FORMAT: OutputFormat = {
  kind: "text",
};

/** 续写意图参数 */
export interface ContinuationIntent {
  /** 光标前的一段正文（调用方已截断到 ~1000 字） */
  before: string;
  /** 前文命中的人物卡（已由 collector.matchEntitiesInText 筛过） */
  characters?: CharacterRef[];
  /** 当前大纲节点标题（可选，用于锚定剧情走向） */
  outlineNode?: string;
  /**
   * 上一章的 AI 摘要（R-AI-09 产物的第二消费方，跨功能复利）。
   *
   * **是否真正注入由本层判断**，见 `CONTINUATION_SUMMARY_MIN_BEFORE_CHARS`：
   * 调用方只管「有就传」，不要各自实现一遍阈值——那样每个入口都能配出不同口径。
   */
  previousSummary?: string;
}

/**
 * 前文短于该字数时才注入上一章摘要。
 *
 * 连续写作时光标前面就是上一段的剧情，摘要不但冗余，还会和紧邻的前文打架
 * （模型可能把摘要里已经写完的事再讲一遍）。真正需要它的只有一种场景：
 * **断更回来 / 光标停在新章开头**，此时前文几乎是空的，模型不知道上一章
 * 发生了什么，会把已死的角色写活、把刚揭穿的秘密再当悬念讲一遍。
 */
export const CONTINUATION_SUMMARY_MIN_BEFORE_CHARS = 300;

/** 摘要注入的字数上限（摘要模板要求 150–300 字，这里只防呆） */
const PREVIOUS_SUMMARY_MAX_CHARS = 400;

/**
 * 决定这一段「上一章摘要」要不要进 prompt。
 *
 * 三个条件缺一不可：摘要有内容、前文够短、且不超过上限。返回 `undefined`
 * 时 `composePrompt` 会直接丢掉该段（不会留一个空的【上一章摘要】）。
 */
function pickPreviousSummary(
  before: string,
  summary: string | undefined,
): string | undefined {
  const text = summary?.trim();
  if (!text) return undefined;
  if (before.length >= CONTINUATION_SUMMARY_MIN_BEFORE_CHARS) return undefined;
  return text.length > PREVIOUS_SUMMARY_MAX_CHARS
    ? `${text.slice(0, PREVIOUS_SUMMARY_MAX_CHARS)}…`
    : text;
}

const ROLE =
  "你是一名小说续写助手。请顺着用户给出的前文，接着往下写一段新的正文。要求：";

/**
 * 组装「流式续写」Prompt（B5）。
 *
 * 光标前的一段正文（调用方已截断到 ~1000 字）作为【前文】，AI 顺着往下写
 * 一段正文（text 契约，逐字流式输出，没有「2–3 候选」）。作者随时可中断
 * 保留已生成部分，确认后再插入。
 *
 * 另有两条可选增强：`outlineNode`（这章要往哪走）与 `previousSummary`
 * （上一章已经发生了什么，仅前文过短时注入）。
 */
export function assembleContinuationStreamSpec(
  context: AiBookContext,
  intent: ContinuationIntent,
): PromptSpec {
  const before = intent.before?.trim() ?? "";
  const previousSummary = pickPreviousSummary(before, intent.previousSummary);
  return {
    system: composePrompt(
      roleBlock(ROLE),
      workBlock(context),
      characterBlock(
        intent.characters,
        "续写时必须保持这些人物既有的说话习惯、身份称呼与性格，不得写出与其设定相悖的措辞。",
      ),
      intent.outlineNode
        ? `【当前剧情节点】${intent.outlineNode.trim()}\n- 续写内容应贴合该节点走向，不要另起与它无关的情节。`
        : null,
      previousSummary
        ? `【上一章摘要】${previousSummary}\n- 这是**已经发生**的剧情：续写不得与之矛盾（不得让已死的角色复活、不得推翻已揭示的结论、不得让已经反目的人亲密如初）；也不要复述摘要内容，只承接它造成的后果。`
        : null,
      `【前文】\n${before || "（前文为空，请从当前已知设定开始续写）"}`,
      constraintBlock([
        "直接顺着前文往下写正文，不要重复、复述或改写前文已有文字；",
        "保持前文的叙事视角、人称、语气与文风；",
        "分成 2–4 个自然段，每段 80–200 字；段与段之间用**一个换行**分隔，不要空行；",
        "每段开头不要手动缩进（不要打空格或全角空格），首行缩进由编辑器统一处理；",
        "不要输出标题、分隔线、序号或任何解释性文字，只要正文；",
        "续写内容可自然收束在段落里，不必强行写完一个完整情节。",
      ]),
      outputBlock(CONTINUATION_STREAM_OUTPUT_FORMAT),
    ),
    prompt: "请基于上述前文，接着往下写正文（多段，段间单个换行，不要空行）。",
    outputFormat: CONTINUATION_STREAM_OUTPUT_FORMAT,
  };
}
