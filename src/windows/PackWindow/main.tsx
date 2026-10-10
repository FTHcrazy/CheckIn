import React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, initThemeFromStorage } from "@/shared/theme";
import "@/shared/styles/themes.scss";
import App from "./App";
import "./index.scss";

// 首帧同步落主题，避免暗色窗口先白闪一下
initThemeFromStorage();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
