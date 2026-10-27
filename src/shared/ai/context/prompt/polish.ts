/**
 * 润色模板（R-AI-03 + 命中人物卡上下文）
 *
 * 承接的两处历史逻辑：
 * - 早期 `buildPolishPrompt` 的四条基本约束（不改原意 / 保持视角 / 直接出稿 / 不扩写）；
 * - 2.7.0 起的「命中人物卡 + 章节片段」注入。
 *
 * ⚠️ 素材全部由调用方给（纯数据），本层不知道「编辑器」「划词」这些业务概念。
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

/** 润色意图参数 */
export interface PolishIntent {
  /** 待润色原文 */
  text: string;
  /** 本段命中的人物卡（已由 collector.matchEntitiesInText 筛过） */
  characters?: CharacterRef[];
}

const ROLE = "你是一名小说文字润色助手。请对用户给出的文字进行润色，要求：";

/** 组装润色 Prompt */
export function assemblePolishSpec(context: AiBookContext, intent: PolishIntent): PromptSpec {
  return {
    system: composePrompt(
      roleBlock(ROLE),
      workBlock(context),
      characterBlock(
        intent.characters,
        "润色时必须保持这些人物既有的说话习惯、身份称呼与性格，不得写出与其设定相悖的措辞。",
      ),
      chapterBlock(context.chapterSnippet, "仅供理解上下文，不要润色、不要输出"),
      constraintBlock([
        "只润色措辞、句式和流畅度，不改变原意、不增删情节与信息；",
        "保持原有的叙事视角、人称与风格基调；",
        "输出长度应与原文相当，不要过度扩写；",
        // 段落分隔必须跟着原文：模型爱在段与段之间插空行，而这个结果要按选区
        // 整段回填，多出来的空行只能由作者一行行手删（2.8.1 修复）
        "严格沿用原文的换行与分段：原文段与段之间没有空行，输出也不得加空行；",
        "除原文已有的换行外，不要输出任何额外空行、分隔线或标题；",
      ]),
      outputBlock(TEXT_OUTPUT_FORMAT),
    ),
    prompt: intent.text,
    outputFormat: TEXT_OUTPUT_FORMAT,
  };
}
