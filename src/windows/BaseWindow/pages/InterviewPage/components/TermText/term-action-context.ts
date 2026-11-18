import { createContext, useContext } from "react";
import type { GlossaryTerm } from "../../data/interview-glossary";

/**
 * 名词 chip 的维护动作（右键菜单用）。
 *
 * 【为什么用 context 而不是 props】
 * `TermText` 出现在题干、标题、答案、知识体系抽屉、图解说明……十几个位置，
 * 逐层透传两个回调会让每层都多两个与自己无关的参数。context 只在**没有
 * Provider 时返回 `null`**，chip 据此把右键菜单整块隐藏（jsdom 组件测试与
 * 没有本地通道的场景都走这条降级路径，不需要 mock）。
 *
 * 与 `InterviewBankProvider/context.ts` 同风格：非组件导出单独放 `.ts`，
 * 避免 `react-refresh/only-export-components` 让整页热重挂。
 */
export interface TermActionApi {
  /**
   * 解除某一处的绑定（「这里不是这个词」）。
   *
   * 传原文与区间而不是算好的窗口：窗口规则（左右各 6 字）必须与匹配器
   * **同一份实现**（`muteContextOf`），在这里再算一遍等于复制规则。
   */
  unbind: (params: {
    term: GlossaryTerm;
    key: string;
    text: string;
    start: number;
    end: number;
  }) => void;
  /** 删掉词条上的某条别名（全库生效） */
  removeAlias: (term: GlossaryTerm, alias: string) => void;
  /**
   * 打开词条编辑（改词名 / 领域 / 分类 / 定义 / 细节 / 别名）。
   *
   * 可选：没接线的场景（组件测试、只读渲染）不显示入口，而不是给一个点了
   * 没反应的按钮。
   */
  editTerm?: (term: GlossaryTerm) => void;
  /** 有写请求在进行中（菜单项置灰，防连点） */
  busy: boolean;
}

export const TermActionContext = createContext<TermActionApi | null>(null);

export function useTermAction(): TermActionApi | null {
  return useContext(TermActionContext);
}
