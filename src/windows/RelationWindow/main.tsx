import React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, initThemeFromStorage } from "@/shared/theme";
import ErrorBoundary from "@/shared/components/ErrorBoundary";
import { installRendererLogger } from "@/shared/log/renderer-logger";
import "@/shared/styles/themes.scss";
import "@xyflow/react/dist/style.css";
import App from "./App";
import "./index.scss";

// 首帧同步落主题，避免暗色窗口先白闪一下（与其余独立窗口同口径）
initThemeFromStorage();

installRendererLogger("relation");

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ErrorBoundary windowName="relation">
        <App />
      </ErrorBoundary>
    </ThemeProvider>
  </React.StrictMode>,
);
