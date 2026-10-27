/**
 * 章节摘要模板（R-AI-09）
 *
 * 每章写完生成一段梗概，断更后回来读梗概就能恢复上下文，不必重读 3000 字。
 * 摘要是 **text 输出**（不是 json-array）：单段自由文本，这是它比实体抽取
 * （json-array + 候选确认）便宜的关键（架构复核 D4）。
 *
 * 上下文 = 单章全文（L3 级，需授权，M5）+ 已有大纲节点（用于对齐）。
 * 产出会被 R-AI-07（续写）复用为「上一章摘要」上下文，有跨功能复利。
 */
import type { AiBookContext } from "../collector";
import type { PromptSpec } from "./types";
import {
  composePrompt,
  constraintBlock,
  roleBlock,
  workBlock,
} from "./sections";
import { TEXT_OUTPUT_FORMAT } from "../output-spec";

/** 摘要意图参数 */
export interface SummaryIntent {
  /** 单章全文（调用方传入，本层不截断——摘要需要整章信息） */
  chapter: string;
  /** 章节标题（供摘要对齐，可空） */
  chapterTitle?: string;
  /** 已有大纲节点标题（可选，用于让摘要对齐大纲走向） */
  outlineNode?: string;
}

const ROLE =
  "你是一名小说章节梗概员。请把用户给出的章节全文压缩成一段结构化的梗概，方便作者断更后快速恢复上下文。要求：";

/**
 * 组装摘要 Prompt。
 *
 * 单章全文是 L3 级数据：调用方必须先在 M5 授权弹窗拿到同意，再带着
 * 授权通过后才调用本模板——本层不感知授权，只负责拼 prompt。
 */
export function assembleSummarySpec(
  context: AiBookContext,
  intent: SummaryIntent,
): PromptSpec {
  const chapter = intent.chapter?.trim() ?? "";
  const title = intent.chapterTitle?.trim();
  const outline = intent.outlineNode?.trim();

  return {
    system: composePrompt(
      roleBlock(ROLE),
      workBlock(context),
      title ? `【章节】${title}` : null,
      outline
        ? `【本章对应大纲节点】${outline}\n- 摘要应能看出本章推进了该节点的哪些内容，但不要照抄大纲。`
        : null,
      `【章节正文】\n${chapter || "（本章无正文内容）"}`,
      constraintBlock([
        "输出一段 150–300 字的梗概，覆盖：本章发生了什么、登场的关键人物、推进或埋下了什么伏笔；",
        "用平实的陈述句，不要评价、不要感叹、不要剧透后续；",
        "不要输出标题、编号、分隔线或任何解释性文字，只要梗概正文；",
        "若正文过短或为空，直接说明「本章暂无实质内容」，不要编造情节。",
      ]),
    ),
    prompt: "请为上述章节生成一段梗概。",
    outputFormat: TEXT_OUTPUT_FORMAT,
  };
}
