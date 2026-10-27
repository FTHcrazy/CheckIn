/**
 * 文本变换模板（R-AI-06）
 *
 * 把「润色」从单个按钮升级成一组动词：扩写 / 精简 / 改写 / 换语气 / 转视角。
 * 五种变换与润色是**同一动作的不同意图**——共用同一段「选中 → 预览 → 确认」链路，
 * 差别只在 system prompt 的角色定位与约束清单。
 *
 * 承接润色模板（`polish.ts`）的全部结构：素材由调用方给，本层不 import novel、
 * 不感知「编辑器」「划词」等业务概念。
 *
 * ⚠️ 与润色的边界：润色 = 「只改措辞，不动长度 / 视角 / 语气」；变换 = 「有明确
 * 目标的改写」。两者约束不可互相吞并，否则润色会被当成「泛化改写」而失去其
 * 「无损微调」的承诺（润色的降级价值正在于此）。
 */
import type { AiBookContext } from "../collector";
import { TEXT_OUTPUT_FORMAT } from "../output-spec";
import {
  chapterBlock,
  characterBlock,
  composePrompt,
  constraintBlock,
  outputBlock,
  roleBlock,
  workBlock,
} from "./sections";
import type { CharacterRef, PromptSpec } from "./types";

/** 五种变换类型（对外身份用，与 `TransformKind` 一致） */
export type TransformKind = "expand" | "condense" | "rewrite" | "tone" | "pov";

/** 变换类型 → 中文标签（菜单 / 预览标题 / 埋点共用，唯一事实源） */
export const TRANSFORM_KIND_LABELS: Record<TransformKind, string> = {
  expand: "扩写",
  condense: "精简",
  rewrite: "改写",
  tone: "换语气",
  pov: "转视角",
};

/** 变换类型 → 意图子串（`ai_log.intent = transform:${sub}`，B2 判据第 3 条） */
export const TRANSFORM_INTENT_SUB: Record<TransformKind, string> = {
  expand: "expand",
  condense: "condense",
  rewrite: "rewrite",
  tone: "tone",
  pov: "pov",
};

/** 变换意图参数 */
export interface TransformIntent {
  /** 变换类型 */
  kind: TransformKind;
  /** 待变换原文 */
  text: string;
  /** 本段命中的人物卡（已由 collector.matchEntitiesInText 筛过） */
  characters?: CharacterRef[];
}

/** 各变换类型的角色定位（决定模型以什么身份作答） */
const ROLES: Record<TransformKind, string> = {
  expand:
    "你是一名小说写作助手。请对用户给出的文字进行扩写，在保持原意与情节不变的前提下丰富细节、场景与动作描写，让文字更饱满。",
  condense:
    "你是一名小说写作助手。请对用户给出的文字进行精简，删去冗余与重复，保留核心情节、信息与关键细节，让文字更凝练。",
  rewrite:
    "你是一名小说写作助手。请对用户给出的文字进行改写，换一种措辞与句式表达相同的意思，让文字更自然流畅、更符合文学审美。",
  tone:
    "你是一名小说写作助手。请对用户给出的文字进行语气调整，改变其语言风格基调（如更口语、更文雅、更热血、更冷峻），但不改变原意与情节。",
  pov: "你是一名小说写作助手。请对用户给出的文字进行视角转换，改变叙述人称与视角（如第三人称转第一人称），保持事件与信息不变。",
};

/** 各变换类型在通用约束之外的专属约束 */
const EXTRA_CONSTRAINTS: Record<TransformKind, string[]> = {
  expand: ["扩写后篇幅应明显长于原文，但不得新增情节、人物或信息；"],
  condense: [
    "精简后篇幅应明显短于原文，但不得丢失关键情节、信息与人物动作；",
    "不要逐句改写，可合并句子、删去修饰；",
  ],
  rewrite: ["改写应保持原意、篇幅与原文相当；"],
  tone: [
    "仅调整语气与风格基调，不改变原意、情节、视角与信息；",
    "篇幅应与原文相当；",
  ],
  pov: [
    "仅转换叙述人称与视角，不改变原意、事件、信息与情节顺序；",
    "篇幅应与原文相当；",
  ],
};

/** 组装文本变换 Prompt */
export function assembleTransformSpec(
  context: AiBookContext,
  intent: TransformIntent,
): PromptSpec {
  const label = TRANSFORM_KIND_LABELS[intent.kind];
  return {
    system: composePrompt(
      roleBlock(ROLES[intent.kind]),
      workBlock(context),
      characterBlock(
        intent.characters,
        `${label}时必须保持这些人物既有的说话习惯、身份称呼与性格，不得写出与其设定相悖的措辞。`,
      ),
      chapterBlock(context.chapterSnippet, "仅供理解上下文，不要变换、不要输出"),
      constraintBlock([
        ...EXTRA_CONSTRAINTS[intent.kind],
        // 段落分隔必须跟着原文（沿用润色 2.8.1 修复，整段回填时多出的空行只能作者手删）
        "严格沿用原文的换行与分段：原文段与段之间没有空行，输出也不得加空行；",
        "除原文已有的换行外，不要输出任何额外空行、分隔线或标题；",
      ]),
      outputBlock(TEXT_OUTPUT_FORMAT),
    ),
    prompt: intent.text,
    outputFormat: TEXT_OUTPUT_FORMAT,
  };
}
