import React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, initThemeFromStorage } from "@/shared/theme";
import ErrorBoundary from "@/shared/components/ErrorBoundary";
import { installRendererLogger } from "@/shared/log/renderer-logger";
import { bootstrapShortcutSync } from "@/shared/shortcuts";
import "@/shared/styles/themes.scss";
import App from "./App";
import "./index.scss";

// 首帧同步落主题，避免暗色窗口先白闪一下
initThemeFromStorage();

// 全局错误捕获（未捕获错误 / 未处理的 Promise 拒绝 → 本地日志）
installRendererLogger("novel");

// 快捷键配置：拉一次 + 订阅跨窗口变更（设置窗口改键后本窗口立即生效）
bootstrapShortcutSync();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ErrorBoundary windowName="novel">
        <App />
      </ErrorBoundary>
    </ThemeProvider>
  </React.StrictMode>,
);
