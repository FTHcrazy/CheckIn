/**
 * 划词解释模板（面试题库 · 意图 1）
 *
 * 用户在题目 / 词条里划一个词，浮层里出一段解释。定位是「当场能复述」而不是
 * 词典式罗列：第一行给一句能直接说出口的大白话，第二段给面试官会追问的展开。
 *
 * 为什么是 text 契约而不是 json-array：解释是**一段给人读的话**，拆成 JSON
 * 字段只会让模型把解释写成三段干巴巴的标签（summary 已踩过这个坑，选了
 * text + 标记行）。若调用方需要把第一行抽出来做气泡副标题，按
 * `parseSummaryReply` 的形状补一个 `parseExplainReply` 即可，**不需要改本契约**。
 *
 * 本意图只送「选区词 + 一句原文 + 可选题干」，属片段级数据（L1/L2），
 * 不涉及任何作品正文。
 */
import { composePrompt, constraintBlock, outputBlock, roleBlock } from "../../../kit";
import type { PromptSpec } from "../../../types";
import { TEXT_OUTPUT_FORMAT } from "../../../../output-spec";
import { categoryBlock, focusBlock } from "../sections";
import type { InterviewExplainPayload, InterviewPromptContext } from "../types";

const ROLE =
  "你是一名前端 / 计算机基础面试题的讲解者，擅长把术语讲到面试者当场能复述的程度。";

/** 两段式输出的标记：与 summary 的【一句话】/【摘要】同款套路（text 契约 + 标记行） */
export const EXPLAIN_ONE_LINER_HEAD = "【一句话】";
export const EXPLAIN_BODY_HEAD = "【解释】";

/** 组装划词解释 Prompt */
export function assembleExplainSpec(
  context: InterviewPromptContext,
  payload: InterviewExplainPayload,
): PromptSpec {
  const term = payload.term.trim();
  return {
    system: composePrompt(
      roleBlock(ROLE),
      focusBlock(term, payload.sentence, payload.stem),
      payload.existingShort
        ? `【词条库已有一句话定义（不要复述它，要讲得更透）】${payload.existingShort}`
        : null,
      categoryBlock(context.categories, context.activeCategoryId),
      constraintBlock([
        `第一行必须是 ${EXPLAIN_ONE_LINER_HEAD}，后面接一句不超过 40 字的大白话释义，不要用「是指…」绕圈；`,
        `空一行后必须是 ${EXPLAIN_BODY_HEAD}，接 2–5 句展开：它解决什么问题、在什么场景出现、面试官会怎么追问；`,
        "只解释【选区】里这一个词，不要顺势介绍它所在的整章 / 整篇；",
        "不要输出 Markdown 标题、代码块或列表符号；确切的 API 名 / 数字拿不准时如实说需要查文档，不要编；",
        ...(payload.stem
          ? ["解释要贴【所在题干（节选）】的语境：同一个词在不同题里侧重点可以不同；"]
          : []),
      ]),
      outputBlock(TEXT_OUTPUT_FORMAT),
    ),
    prompt: payload.sentence?.trim()
      ? `请解释「${term}」在这个语境里的意思，按约定的两段格式输出。`
      : `请解释「${term}」，按约定的两段格式输出。`,
    outputFormat: TEXT_OUTPUT_FORMAT,
  };
}
