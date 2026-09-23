import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initThemeFromStorage } from "@/shared/theme";
import "@/shared/styles/themes.scss";
import "@/shared/styles/window-shell.scss";
import "./index.scss";
import App from "./App";

// 首帧同步落主题：必须在 createRoot 之前，避免「先亮后暗」闪一下
initThemeFromStorage();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
