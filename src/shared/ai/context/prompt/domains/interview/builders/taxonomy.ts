/**
 * 分类建议模板（面试题库 · 意图 4）
 *
 * 「AI 拓展」能出题，但前提是**先有一个分类可用**。真实痛点是：用户想补一块
 * 题库里没有的方向（比如「RSC 与服务端组件」），却要自己先想分类名、想这块考什么、
 * 再想三道题证明它值得存在。这个意图把这三件事一次做完，产出**建议**而不是结构。
 *
 * 【为什么只产建议，不直接建分类】（规范 §9 三层闸门 ①）
 * 分类是题库的骨架：一旦进侧栏，所有题目的路径、角标、筛选都跟着变。
 * 让模型直接改结构，等于让它决定用户的复习大纲。所以输出固定为
 * `label / track / note / sampleTitles`，写入 `interview_taxonomy.status='draft'`，
 * 用户点「采纳」才进侧栏。
 *
 * `sampleTitles` 不是装饰：没有示例题名的空分类，用户采纳完看到的是「0 道题」，
 * 会以为功能坏了。三条题名让「这个分类值不值得建」在采纳前就能判断。
 *
 * 规范：docs/spec/interview-db-ai-spec.md §9
 */
import {
  composePrompt,
  constraintBlock,
  jsonArrayFormat,
  outputBlock,
  requirementBlock,
  roleBlock,
} from "../../../kit";
import type { PromptSpec } from "../../../types";
import { categoryBlock, siblingTitlesBlock } from "../sections";
import type { InterviewPromptContext, InterviewTaxonomySuggestPayload } from "../types";

/** 分类名长度上限（与 `useInterviewTaxonomy.create` 的校验同一口径） */
export const TAXONOMY_LABEL_MAX = 12;

/** 一轮最多几条建议：再多用户审不动，而且侧栏也放不下 */
export const TAXONOMY_SUGGEST_MAX = 3;

export const TAXONOMY_OUTPUT_FORMAT = jsonArrayFormat([
  { key: "label", type: "string", label: `分类名（不超过 ${TAXONOMY_LABEL_MAX} 字，不带书名号与括号）` },
  { key: "track", type: "string", label: "归属轨道，只能取 written / foundation" },
  { key: "note", type: "string", label: "一句话说明这块考什么（不超过 60 字）" },
  { key: "sampleTitles", type: "string", label: "3 条示例题名，用顿号分隔，每条不超过 30 字" },
]);

const ROLE =
  "你是一名技术面试体系的课程设计者，负责在前端与计算机基础的题库里找出**还缺的那几块**，并给出可以直接落地的分类建议。";

/** 条数夹取：1~3；非法值回落到 2 */
export function clampTaxonomyCount(count: number | undefined): number {
  if (!count || !Number.isFinite(count)) return 2;
  return Math.min(TAXONOMY_SUGGEST_MAX, Math.max(1, Math.floor(count)));
}

/** 组装分类建议 Prompt */
export function assembleTaxonomySpec(
  context: InterviewPromptContext,
  payload: InterviewTaxonomySuggestPayload,
): PromptSpec {
  const count = clampTaxonomyCount(payload.count);
  const requirements: string[] = [];
  if (payload.seed?.trim()) requirements.push(`围绕这个方向展开：${payload.seed.trim()}`);
  if (payload.track) {
    requirements.push(`轨道：${payload.track === "written" ? "手写题" : "基础知识库"}`);
  }

  return {
    system: composePrompt(
      roleBlock(ROLE),
      // 现有分类是**封闭词表**：新分类不许与之重复，也不许换个说法重出一遍
      categoryBlock(context.categories),
      siblingTitlesBlock(context.questionTitles),
      requirementBlock(requirements),
      constraintBlock([
        `只输出 ${count} 条，宁可少也不要凑数；`,
        `label 不超过 ${TAXONOMY_LABEL_MAX} 字，必须是能直接当侧栏一行显示的短语，不要带「分类」二字；`,
        "label 不得与【可选分类】里任何一条重复或近义（「React 进阶」与「React 深入」是同一条）；",
        "track 只能取 written / foundation：手写题放 written，概念与原理放 foundation；",
        "note 写一句「这块考什么」，要具体到知识点边界，不要写「进阶内容」这类空话；",
        "sampleTitles 必须给 3 条，顿号分隔，每条是一道**能直接作答**的面试题名（不要「请简述」前缀）；",
        "这三条示例题名要能证明这个分类是独立的：如果它们都能塞进现有分类，说明这个分类不该新建；",
      ]),
      outputBlock(TAXONOMY_OUTPUT_FORMAT),
    ),
    prompt: payload.seed?.trim()
      ? `请围绕「${payload.seed.trim()}」给出 ${count} 条分类建议，按约定输出 JSON 数组。`
      : `请找出题库目前最缺的 ${count} 块方向，按约定输出 JSON 数组。`,
    outputFormat: TAXONOMY_OUTPUT_FORMAT,
    count,
  };
}
