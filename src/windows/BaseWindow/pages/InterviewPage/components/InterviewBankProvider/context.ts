import { createContext, useContext } from "react";
import type { InterviewBankState } from "../../hooks/useInterviewBank";

/**
 * 题库合并视图上下文（T06-A 接线用）。
 *
 * 【为什么住在 `.ts` 而不是 `index.tsx`】
 * 仓库开了 `react-refresh/only-export-components`（error 级）：组件文件里
 * 只要再导出一个非组件（hook / context），热更新就会整页重挂。
 * 所以「Provider 组件」与「context + 读取 hook」分成两个文件 ——
 * 与 `pages/NovelPage/hooks/entity-types-context.ts` 的做法一致。
 *
 * 【为什么默认值是 `null` 而不是基线】
 * 「没有 Provider」必须能被区分出来：`TermText` / `QuestionCard` /
 * `KnowledgeDrawer` 在没有 Provider 时要回落**原来的模块级基线函数**
 * （`splitByGlossary` / `diagramById`），这样既有的组件测试（大多不包 Provider）
 * 一行都不用改。若这里给一个兜底对象，「有没有 Provider」就分不清了。
 */
export const InterviewBankContext = createContext<InterviewBankState | null>(null);

/**
 * 读取合并视图。
 *
 * **没有 Provider 时返回 `null`，不抛错** —— 消费方一律写成
 * `bank?.questions ?? 基线`。缺 Provider 是合法的降级形态，不是编码错误。
 */
export function useInterviewBankContext(): InterviewBankState | null {
  return useContext(InterviewBankContext);
}
