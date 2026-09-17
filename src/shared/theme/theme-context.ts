import { createContext, useContext } from "react";
import type { ThemeId, ThemeMeta } from "./themes";

export interface ThemeContextValue {
  /** 当前主题 id */
  theme: ThemeId;
  /** 当前主题元数据（名称 / 是否暗色 / antd 色板） */
  meta: ThemeMeta;
  /** 全部可选主题，供切换器渲染 */
  themes: readonly ThemeMeta[];
  setTheme: (id: ThemeId) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * 读取主题上下文：切换主题、获取当前主题色板。
 * 必须在 ThemeProvider 内部使用（provider 已在三个窗口入口统一挂载）。
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme 必须在 ThemeProvider 内部使用");
  }
  return ctx;
}
