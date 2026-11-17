import type { ReactNode } from "react";
import { useInterviewBank } from "../../hooks/useInterviewBank";
import { InterviewBankContext } from "./context";

/**
 * 题库合并视图 Provider。
 *
 * 【只承载数据，不渲染 DOM】
 * `children` 原样透出（Context.Provider 不产生任何节点），因此套在页面根上
 * 不会改动布局，也不会让 CSS 选择器（`.interview-page > *`）错位。
 *
 * 【为什么放在页面根而不是各组件各自订阅】
 * 合并视图要读 243 题 + 100 词条 + 24 图解的 payload：一次挂载只能拉一次。
 * 放在根上，`useInterviewPage` / `TermText` / `QuestionCard` / `KnowledgeDrawer`
 * 共用同一份结果；各自 `useInterviewBank()` 就是四次 IPC、四份合并。
 */
export default function InterviewBankProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const bank = useInterviewBank();
  return <InterviewBankContext.Provider value={bank}>{children}</InterviewBankContext.Provider>;
}
