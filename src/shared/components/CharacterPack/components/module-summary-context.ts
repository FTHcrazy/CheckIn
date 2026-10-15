import { createContext, useContext } from "react";

/**
 * 模块外壳的展示通道（外壳 → 模块壳）。
 *
 * 为什么用 context 而不是塞进 `api`：这里的东西是**外壳根据窗口宽度 / 偏好
 * 算出来的展示量**，不属于行囊的数据模型，也不该让十个模块各自算一遍 ——
 * 那要求每个模块都知道「当前窗口多宽」。
 *
 * 模块壳读它，模块自己完全不必知情：绝大多数模块连 `?` 都不用碰。
 * 字段各自给默认值，缺省（不包 Provider）即为「不显示 / 不可钉选」。
 */
export interface PackModuleChrome {
  /**
   * 折叠行右侧的一句派生摘要（窄档下十个模块压成十行时用来回答「这栏是不是空的」）。
   * 宽 / 中档下为空串，不占位也不改版式。
   */
  summary: string;
  /** 该模块是否被钉选常驻（UI-04：钉选模块永不自动收起、头部出实心钉图标） */
  pinned: boolean;
  /**
   * 钉选 / 取消钉选。为 undefined 时不渲染钉选按钮（例如核心三块无需钉选）。
   */
  onTogglePin?: () => void;
}

const DEFAULT_CHROME: PackModuleChrome = {
  summary: "",
  pinned: false,
};

export const PackModuleSummaryContext = createContext<PackModuleChrome>(DEFAULT_CHROME);

/** 读取当前模块的外壳展示信息（无 Provider 时为缺省值） */
export function useModuleChrome(): PackModuleChrome {
  return useContext(PackModuleSummaryContext);
}

/** 读取当前模块的摘要（无 Provider 时为空串）—— 兼容旧调用点 */
export function useModuleSummary(): string {
  return useModuleChrome().summary;
}
