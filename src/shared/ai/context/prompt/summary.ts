/**
 * 章节摘要模板（R-AI-09）
 *
 * 每章写完生成一段梗概，断更后回来读梗概就能恢复上下文，不必重读 3000 字。
 * 输出是 **text 契约**（不是 json-array）：一次调用给两段带标记的自由文本
 * （`【一句话】` + `【摘要】`），由 `parseSummaryReply` 拆分——这是它比实体抽取
 * （json-array + 候选确认）便宜的关键（架构复核 D4）。
 *
 * 为什么同一次要产出「一句话」：大纲板的 `outline_note`（作者手写的一句话梗概）
 * 与本摘要是同一个信息位。分成两次会要么让作者重复劳动、要么让大纲板永远是空白虚线框。
 * 一句话回填大纲，长摘要留在浮层，两个粒度各归其位。
 *
 * 上下文 = 单章全文（L3 级，需授权，M5）+ 已有大纲节点（用于对齐）。
 * 授权范围（`scope`）会改变「模型实际看到的内容」：仅本章 / 选中段落 / 最近 3 章，
 * 因此范围必须进 prompt（见 `SummaryIntent.scope` 的说明），不能只当埋点字段。
 */
import type { AiBookContext } from "../collector";
import type { L3Scope } from "../../ai-consent";
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
  /**
   * 本次 L3 授权范围（M5）。
   *
   * 它不只是埋点字段：范围决定了「模型看到的是整章还是一段」，
   * 所以必须进 prompt 让模型知道边界——否则拿到片段的模型会照常写
   * 「本章」的梗概，补出它没看到的情节（编造）。
   */
  scope?: L3Scope;
  /**
   * 前情节选（仅 recent3）：更早章节的节选，按故事时间正序（远的在前）。
   * 作用是「让模型知道本章从哪接上来」，不参与摘要主体。
   */
  contextText?: string;
}

const ROLE =
  "你是一名小说章节梗概员。请把用户给出的章节全文压缩成「一句话梗概 + 一段结构化梗概」，方便作者断更后快速恢复上下文。要求：";

/** 输出分段的标记：一句话梗概在前，长摘要在后 */
export const SUMMARY_ONE_LINER_HEAD = "【一句话】";
export const SUMMARY_BODY_HEAD = "【摘要】";

/** 一句话梗概的硬上限（字符）：大纲板每章只留一行，超了会把结构撑散 */
const ONE_LINER_MAX = 60;

/** 模型回复拆分结果 */
export interface SummaryReply {
  /** 一句话梗概（回填大纲 `outline_note`）；空 = 本次没产出，不要动大纲 */
  oneLiner: string;
  /** 长摘要正文（落 `ai_summary`） */
  summary: string;
}

/** 压成单行并截断：一句话只允许「第一行」存活 */
function clipOneLiner(line: string): string {
  const first =
    line
      .split("\n")
      .map((item) => item.trim())
      .find((item) => item.length > 0) ?? "";
  const clean = first.replace(/^[-*·、\s]+/, "").trim();
  return clean.length > ONE_LINER_MAX ? `${clean.slice(0, ONE_LINER_MAX)}…` : clean;
}

/**
 * 拆分摘要回复为「一句话 + 长摘要」。
 *
 * 刻意做成**有标记才拆**：模型不按格式返回时整段当摘要、一句话留空。
 * 猜一句话的代价比不填高得多——猜错会直接污染作者手写的大纲板，
 * 而大纲板是「扫一眼看整卷走向」的地方，错一行比空一行更糟。
 */
export function parseSummaryReply(raw: string): SummaryReply {
  const text = (raw ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) return { oneLiner: "", summary: "" };

  const oneAt = text.indexOf(SUMMARY_ONE_LINER_HEAD);
  const bodyAt = text.indexOf(SUMMARY_BODY_HEAD);

  // 两个标记都没有：整段就是摘要，一句话留空（降级，不猜）
  if (oneAt < 0 && bodyAt < 0) return { oneLiner: "", summary: text };

  const oneRaw =
    oneAt < 0
      ? ""
      : text
          .slice(
            oneAt + SUMMARY_ONE_LINER_HEAD.length,
            bodyAt > oneAt ? bodyAt : undefined,
          )
          .trim();

  let summary = bodyAt < 0 ? "" : text.slice(bodyAt + SUMMARY_BODY_HEAD.length).trim();

  // 只给了【一句话】没给【摘要】：把标记之外的文字当摘要兜底，
  // 不让「少一段」把整次生成作废（否则用户花了 token 却什么都没落下）
  if (!summary) {
    summary = (bodyAt < 0 ? text : text.slice(0, bodyAt))
      .split(SUMMARY_ONE_LINER_HEAD)
      .filter((part, index) => index === 0 || !oneRaw || !part.includes(oneRaw))
      .join("")
      .trim();
  }
  if (!summary) summary = oneRaw;

  return { oneLiner: clipOneLiner(oneRaw), summary };
}

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
  const contextText = intent.contextText?.trim();
  const isSelection = intent.scope === "selection";
  const isRecent3 = intent.scope === "recent3";

  return {
    system: composePrompt(
      roleBlock(ROLE),
      workBlock(context),
      title ? `【章节】${title}` : null,
      outline
        ? `【本章对应大纲节点】${outline}\n- 摘要应能看出本章推进了该节点的哪些内容，但不要照抄大纲。`
        : null,
      isRecent3 && contextText
        ? `【前情（更早章节的节选，仅供衔接）】\n${contextText}\n- 这只用于理解本章从哪接上来，不要把其中情节写成「本章发生的事」。`
        : null,
      isSelection
        ? `【选中段落】\n${chapter || "（未选中任何内容）"}`
        : `【章节正文】\n${chapter || "（本章无正文内容）"}`,
      constraintBlock([
        `严格按两段输出，顺序与标记都不能变：先一行 \`${SUMMARY_ONE_LINER_HEAD}…\`，再一段 \`${SUMMARY_BODY_HEAD}…\`；`,
        `${SUMMARY_ONE_LINER_HEAD} 不超过 30 字，说清本章最核心的一件事（谁做了什么、结果如何），供大纲板一行展示；`,
        `${SUMMARY_BODY_HEAD} 写 150–300 字，覆盖：本章发生了什么、登场的关键人物、推进或埋下了什么伏笔；`,
        "两段都用平实的陈述句，不要评价、不要感叹、不要剧透后续；",
        `除 ${SUMMARY_ONE_LINER_HEAD} / ${SUMMARY_BODY_HEAD} 两个标记外，不要输出其它标题、编号或分隔线，也不要任何解释性文字；`,
        "若正文过短或为空，直接说明「本章暂无实质内容」，不要编造情节。",
        ...(isSelection
          ? [
              "本次只有作者选中的这一段：只就这段内容做梗概，不要描述本章其余部分，也不要补写你没看到的情节。",
            ]
          : []),
        ...(isRecent3 ? ["摘要主体只写【章节正文】里的内容，前情不作为摘要内容。"] : []),
      ]),
    ),
    prompt: `请为上述章节生成梗概，严格按 ${SUMMARY_ONE_LINER_HEAD} 与 ${SUMMARY_BODY_HEAD} 两段输出。`,
    outputFormat: TEXT_OUTPUT_FORMAT,
  };
}
