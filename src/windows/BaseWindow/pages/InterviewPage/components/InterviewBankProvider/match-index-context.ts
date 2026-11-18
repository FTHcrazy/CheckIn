import { createContext, useContext } from "react";
import type { GlossaryMatchIndex } from "../../persistence/glossary-matcher";
import { useInterviewBankContext } from "./context";

/**
 * 「带偏好的匹配器」覆盖层。
 *
 * 【为什么要多一层】
 * 合并视图的匹配器是在 `useInterviewBank` 里建的，那里看不到侧栏筛选（Provider
 * 在页面外层，`filter` 在 `useInterviewPage` 里）。但同名词条的主匹配**必须**
 * 跟着当前分类走：否则「节流」在 RxJS 分类下点开的是浏览器性能那条，用户只能
 * 在弹层里手动切。
 *
 * 页面按 `filter.categoryId / filter.track` 派生一份 `withPrefer()` 的实例塞进
 * 这个 context，`TermText` 优先取它、取不到再回落合并视图的默认实例。
 *
 * 【为什么可以不传】
 * 没有 Provider（jsdom 组件测试 / 没有本地通道）时值是 `null`，读取方回落到
 * 基线函数 —— 缺这一层是合法的降级形态，不是编码错误。
 */
export const GlossaryMatchIndexContext = createContext<GlossaryMatchIndex | null>(null);

/** 当前生效的匹配器（带偏好优先，其次合并视图，最后 `undefined` = 用基线常量） */
export function useGlossaryMatchIndex(): GlossaryMatchIndex | undefined {
  const preferred = useContext(GlossaryMatchIndexContext);
  const bank = useInterviewBankContext();
  return preferred ?? bank?.glossaryIndex;
}
