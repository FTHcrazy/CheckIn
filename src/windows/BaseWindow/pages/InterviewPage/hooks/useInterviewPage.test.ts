import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `useInterviewPage` 数据源守卫（T06-A）。
 *
 * 这类断言只能读源码文本，因为「题目从哪来」在运行期是不可见的：
 * 包了 Provider 与没包 Provider 的渲染结果**内容相同**（基线），
 * 所以一旦有人把 `QUESTIONS` 改回 `QUESTION_BANK`，用例照样全绿，
 * 而线上表现是「用户自己加的题永远不出现」。
 *
 * 三条判据各挡一种回退：
 * ① 数据源必须是 `useInterviewBankContext()?.questions ?? QUESTION_BANK`（合并优先、基线兜底）；
 * ② 三处派生计算不许再直接喂 `QUESTION_BANK`；
 * ③ 三处 `useMemo` 的依赖里必须带 `QUESTIONS`（漏了依赖 → 库变了角标还是旧的）。
 */
const SOURCE = readFileSync(
  path.resolve(
    process.cwd(),
    "src/windows/BaseWindow/pages/InterviewPage/hooks/useInterviewPage.ts",
  ),
  "utf8",
);

describe("useInterviewPage 的题目来源", () => {
  it("优先取合并视图，没有 Provider 时才回落源码基线", () => {
    expect(SOURCE).toMatch(/useInterviewBankContext\(\)\?\.questions\s*\?\?\s*QUESTION_BANK/);
  });

  it("filterQuestions / countByCategory / collectTags 都吃合并后的题库", () => {
    for (const call of ["filterQuestions", "countByCategory", "collectTags"]) {
      expect(SOURCE).not.toMatch(new RegExp(`${call}\\(\\s*QUESTION_BANK`));
      expect(SOURCE).toMatch(new RegExp(`${call}\\(\\s*QUESTIONS`));
    }
  });

  it("三处 useMemo 的依赖数组都带上了 QUESTIONS", () => {
    expect(SOURCE.match(/\[\s*QUESTIONS/g) ?? []).toHaveLength(3);
  });
});
