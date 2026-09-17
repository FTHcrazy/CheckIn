import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ConfigProvider, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { ThemeContext } from "./theme-context";
import {
  THEME_CHANGE_EVENT,
  THEME_LIST,
  getThemeMeta,
  isThemeId,
  type ThemeId,
} from "./themes";
import {
  applyThemeToDocument,
  initThemeFromStorage,
  writeStoredTheme,
} from "./theme-storage";

/**
 * 全局主题提供者：三个窗口（BaseWindow / LoginWindow / WorkerWindow）共用。
 *
 * 职责：
 * 1. 在 <html data-theme> 上落主题，CSS 变量整体换肤
 * 2. 生成对应主题的 antd ConfigProvider 配置（暗色走 darkAlgorithm）
 * 3. 写入 localStorage 持久化，并通过 windowAPI 广播让其他窗口实时同步
 *
 * 内部已经包了 ConfigProvider，窗口入口不要再各自包一层。
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  // 入口在 createRoot 前已同步写过 <html data-theme>，这里直接复用，避免二次闪烁
  const [theme, setThemeState] = useState<ThemeId>(() => {
    const attr = document.documentElement.dataset.theme;
    return isThemeId(attr) ? attr : initThemeFromStorage();
  });

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  // 其他窗口切换了主题：跟随同步，保证「所有窗口同一套主题色」
  useEffect(() => {
    const api = window.electronAPI?.windowAPI;
    if (!api) return;

    const handler = (...args: unknown[]) => {
      const next = args[0];
      if (isThemeId(next)) setThemeState(next);
    };

    api.on(THEME_CHANGE_EVENT, handler);
    return () => api.off(THEME_CHANGE_EVENT, handler);
  }, []);

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    writeStoredTheme(next);
    // 广播失败不影响本窗口已生效的主题
    window.electronAPI?.windowAPI
      ?.broadcast(THEME_CHANGE_EVENT, next)
      .catch(() => undefined);
  }, []);

  const meta = useMemo(() => getThemeMeta(theme), [theme]);

  const antdProps = useMemo(
    () => ({
      locale: zhCN,
      theme: {
        algorithm: meta.isDark
          ? antdTheme.darkAlgorithm
          : antdTheme.defaultAlgorithm,
        // CSS 变量模式：只生成一份样式表，减少运行时注入体积
        cssVar: { prefix: "ant" },
        hashed: false,
        token: {
          colorPrimary: meta.antd.colorPrimary,
          colorBgLayout: meta.antd.colorBgLayout,
          colorBgContainer: meta.antd.colorBgContainer,
          colorBgElevated: meta.antd.colorBgElevated,
          colorText: meta.antd.colorText,
          colorTextSecondary: meta.antd.colorTextSecondary,
          colorTextDisabled: meta.antd.colorTextDisabled,
          colorBorderSecondary: meta.antd.colorBorderSecondary,
          colorSplit: meta.antd.colorSplit,
          colorSuccess: meta.antd.colorSuccess,
          colorWarning: meta.antd.colorWarning,
          colorError: meta.antd.colorError,
          colorInfo: meta.antd.colorInfo,
          colorLink: meta.antd.colorLink,
          borderRadius: 8,
        },
      },
    }),
    [meta],
  );

  const value = useMemo(
    () => ({ theme, meta, themes: THEME_LIST, setTheme }),
    [theme, meta, setTheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      <ConfigProvider {...antdProps}>{children}</ConfigProvider>
    </ThemeContext.Provider>
  );
}
