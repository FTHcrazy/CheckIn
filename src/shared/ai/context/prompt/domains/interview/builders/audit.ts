/**
 * 已有题目质检模板（面试题库 · 意图 3）
 *
 * 把题库里已有的题一批送上去，让模型挑出**答案错误 / 不完整 / 分类难度不匹配 /
 * 与已有题重复**的问题，产出候选清单给作者逐条改。
 *
 * 为什么必须是 json-array：一屏几十条问题要逐条核对（改哪题、什么严重程度、
 * 改成什么），自由文本没法稳定拆回来。
 *
 * ⚠️ 本意图只读**题目资产**（题干 / 答案 / 分类 / 难度 / 标签），不发送任何
 * 小说正文，属 L1/L2。
 */
import {
  composePrompt,
  constraintBlock,
  jsonArrayFormat,
  outputBlock,
  roleBlock,
} from "../../../kit";
import type { PromptSpec } from "../../../types";
import { INTERVIEW_LIMITS } from "../collector";
import { categoryBlock, questionListBlock } from "../sections";
import type { InterviewAuditPayload, InterviewPromptContext } from "../types";

/** 严重程度档位（唯一产地：UI 排序 / 徽标色 / 落库都取这里） */
export const AUDIT_SEVERITIES = ["high", "medium", "low"] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

/** 严重程度中文（UI 排序 / 徽标色共用） */
export const AUDIT_SEVERITY_LABELS: Record<AuditSeverity, string> = {
  high: "必改（答案错了 / 会误导人）",
  medium: "该改（不严谨 / 有歧义）",
  low: "可选（措辞 / 补充例子）",
};

/**
 * 输出契约。
 *
 * ⚠️ 首个字段是 `id`，这不是随手排的：`parseOutput` 的 `dedupeEntries` 按
 * **第一个字段**去重。质检必须「一题一条」（把该题的所有问题塞进 `issues` 的
 * 多行文本），否则同一题的第 2、3 条问题会被静默丢掉。
 *
 * ⚠️ 字段不能为空串：`parseOutput` 会把「有空字段」的条目整条丢弃 —— 这正好是
 * 要的语义（没问题的题不该出现在清单里），但调用方不要以为「返回条数 < 题数」是 bug。
 */
export const AUDIT_OUTPUT_FORMAT = jsonArrayFormat([
  { key: "id", type: "string", label: "被检题目 id（逐字照抄【待检题目 xxx】里的 id）" },
  { key: "severity", type: "string", label: "严重程度，只能取 high / medium / low" },
  { key: "issues", type: "string", label: "问题清单，每条一行（换行写成 \\n）；没问题时不要输出这一条" },
  { key: "suggestion", type: "string", label: "一句话修改建议（具体到改成什么）" },
]);

const ROLE =
  "你是一名面试题库的审校员，负责逐条核对已有题目的答案正确性、完整性与分类准确性，产出可执行的修改建议。";

/** 组装题目质检 Prompt */
export function assembleAuditSpec(
  context: InterviewPromptContext,
  payload: InterviewAuditPayload,
): PromptSpec {
  const targets = payload.targets.slice(0, INTERVIEW_LIMITS.auditTargets);
  return {
    system: composePrompt(
      roleBlock(ROLE),
      categoryBlock(context.categories, context.activeCategoryId),
      questionListBlock(targets),
      constraintBlock([
        "只评审【待检题目】里出现的题目，不要新增题目、不要重写整份答案；",
        "**一题一条**：同一道题发现多个问题时合并到同一条的 issues 里，用换行分隔；",
        `问题的严重程度只允许 ${AUDIT_SEVERITIES.join(" / ")} 三档，判定口径：${AUDIT_SEVERITIES.map(
          (severity) => `${severity} = ${AUDIT_SEVERITY_LABELS[severity]}`,
        ).join("；")}；全覆盖不遗漏；`,
        "重点看四类：答案正确性（技术细节是否真的对）、完整性（面试官期望的关键点有没有漏）、分类与难度是否匹配、题目是否与已有题目重复；",
        "suggestion 要具体到「改成什么」，不要写「建议完善」这类空话；",
        "**完全没问题的题目不要输出**（宁可少报，不要凑数）；",
      ]),
      outputBlock(AUDIT_OUTPUT_FORMAT),
    ),
    prompt: `请按约定逐条评审这 ${targets.length} 道题，只输出有问题的那些，按约定输出 JSON 数组。`,
    outputFormat: AUDIT_OUTPUT_FORMAT,
    count: targets.length,
  };
}
