import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  isThemeId,
  type ThemeId,
} from "./themes";

/**
 * 读取已保存的主题；无记录 / 记录非法 / 存储不可用时返回 null（由调用方回退默认主题）。
 *
 * localStorage 在隐私模式、磁盘配额耗尽等场景会直接抛错，主题属于「锦上添花」的偏好，
 * 这里吞掉异常保证窗口照常启动。
 */
export function readStoredTheme(): ThemeId | null {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeId(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** 写入主题偏好，写入失败静默（下次启动回退默认主题） */
export function writeStoredTheme(id: ThemeId): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // 忽略：不可用时不阻断切换，仅本次会话有效
  }
}

/**
 * 把主题写到 <html data-theme>，CSS 变量随之整体切换。
 * 同时同步 color-scheme，让滚动条、原生下拉等系统控件跟随明暗。
 */
export function applyThemeToDocument(id: ThemeId): void {
  const root = document.documentElement;
  root.dataset.theme = id;
  root.style.colorScheme = id === "midnight" ? "dark" : "light";
}

/**
 * 入口在 createRoot 之前调用：首帧就带上正确主题，避免「先白后暗」闪烁。
 * 返回实际生效的主题，供 Provider 初始化 state。
 */
export function initThemeFromStorage(): ThemeId {
  const id = readStoredTheme() ?? DEFAULT_THEME;
  applyThemeToDocument(id);
  return id;
}
