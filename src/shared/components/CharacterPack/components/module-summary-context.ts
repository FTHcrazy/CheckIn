import { createContext, useContext } from "react";

/**
 * 模块摘要的传递通道（外壳 → 模块壳）。
 *
 * 为什么用 context 而不是塞进 `api`：摘要是**外壳根据窗口宽度算出来的展示量**
 * （窄档折叠行右边那句「12 种 · 共 46 件」），它不属于行囊的数据模型，
 * 也不该让九个模块各自算一遍 —— 那要求每个模块都知道「当前窗口多宽」。
 *
 * 模块壳读它，模块自己完全不必知情：绝大多数模块连 `?` 都不用碰。
 * 空串（默认值）表示「不显示摘要」，宽档与中档就是这条路径。
 */
export const PackModuleSummaryContext = createContext<string>("");

/** 读取当前模块的摘要（无 Provider 时为空串） */
export function useModuleSummary(): string {
  return useContext(PackModuleSummaryContext);
}
