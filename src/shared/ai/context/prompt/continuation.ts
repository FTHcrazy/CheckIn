/**
 * 续写模板（R-AI-07 非流式版）
 *
 * 光标停在卡住的地方，让 AI 顺着「光标前文」往下写 2–3 个候选，作者挑一个改。
 * 定位是**跳板而非代笔**：默认只出较短候选（300–600 字），UI 文案强调「接着改」。
 *
 * 与润色 / 变换的边界：
 * - 润色 / 变换 = 改写**已有**文字（有明确的输入文本，输出替换选区）；
 * - 续写 = 生成**新的**文字（输入是「前文」，输出插到光标后，不覆盖任何原文）。
 *
 * 素材全部由调用方给（纯数据）：`before` 是光标前的一段正文（调用方已截断），
 * `characters` 是前文命中的人物卡，`outlineNode` 是当前大纲节点（可选增强）。
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

/** 续写输出契约：2–3 个候选，每个是一段正文（json-array，字段 `text`） */
export const CONTINUATION_OUTPUT_FORMAT: OutputFormat = {
  kind: "json-array",
  fields: [{ key: "text", type: "string", label: "续写片段" }],
};

/** 续写意图参数 */
export interface ContinuationIntent {
  /** 光标前的一段正文（调用方已截断到 ~1000 字） */
  before: string;
  /** 前文命中的人物卡（已由 collector.matchEntitiesInText 筛过） */
  characters?: CharacterRef[];
  /** 当前大纲节点标题（可选，用于锚定剧情走向） */
  outlineNode?: string;
}

const ROLE =
  "你是一名小说续写助手。请顺着用户给出的前文，接着往下写一段新的正文。要求：";

/**
 * 组装续写 Prompt。
 *
 * 前文用独立的【前文】段给（不是 collector 的 chapterSnippet——那个是从章头
 * 截断，续写要的是**光标前**的文本，语义不同，必须由调用方精确传入）。
 */
export function assembleContinuationSpec(
  context: AiBookContext,
  intent: ContinuationIntent,
): PromptSpec {
  const before = intent.before?.trim() ?? "";
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
      `【前文】\n${before || "（前文为空，请从当前已知设定开始续写）"}`,
      constraintBlock([
        "只续写前文之后的新内容，不要重复、复述或改写前文已有文字；",
        "保持前文的叙事视角、人称、语气与文风；",
        "单段候选控制在 300–600 字，不要过长；",
        "不要输出标题、分隔线、序号或任何解释性文字，只要正文；",
        "续写内容可自然收束在段落内，不必强行写完一个完整情节。",
      ]),
      outputBlock(CONTINUATION_OUTPUT_FORMAT),
    ),
    prompt: `请基于上述前文，写出 ${2} 到 ${3} 个不同的续写方向，每个方向一段。`,
    outputFormat: CONTINUATION_OUTPUT_FORMAT,
  };
}
