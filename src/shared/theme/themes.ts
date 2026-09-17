/** 主题标识：新增主题时同步扩展本文件与 styles/themes.scss */
export type ThemeId = "aurora" | "cream" | "mint" | "midnight";

/** 交给 antd 的色板（必须是具体色值：antd 要基于它们做派生色运算，不能传 var()） */
export interface ThemeAntdTokens {
  colorPrimary: string;
  colorBgLayout: string;
  colorBgContainer: string;
  colorBgElevated: string;
  colorText: string;
  colorTextSecondary: string;
  colorTextDisabled: string;
  colorBorderSecondary: string;
  /** 分割线（antd Divider / Table 内部线） */
  colorSplit: string;
  colorSuccess: string;
  colorWarning: string;
  colorError: string;
  colorInfo: string;
  /** 链接/文字按钮色，暗色主题下用提亮的主色 */
  colorLink: string;
}

export interface ThemeMeta {
  id: ThemeId;
  /** 切换器中展示的名称 */
  label: string;
  /** 一句话说明，用于切换器副标题 */
  hint: string;
  /** 切换器色块（取主色） */
  swatch: string;
  /** 暗色主题：antd 走 darkAlgorithm，弹层跟随反色 */
  isDark: boolean;
  antd: ThemeAntdTokens;
}

export const THEME_LIST: readonly ThemeMeta[] = [
  {
    id: "aurora",
    label: "柔雾紫蓝",
    hint: "清透蓝紫，默认主题",
    swatch: "#5b6cf9",
    isDark: false,
    antd: {
      colorPrimary: "#5b6cf9",
      colorBgLayout: "#f3f5fc",
      colorBgContainer: "#ffffff",
      colorBgElevated: "#ffffff",
      colorText: "#2b2f4a",
      colorTextSecondary: "#5a5f7a",
      colorTextDisabled: "#b6bbd0",
      colorBorderSecondary: "#e2e6f4",
      colorSplit: "#edf0fa",
      colorSuccess: "#34b37e",
      colorWarning: "#f5a623",
      colorError: "#e5484d",
      colorInfo: "#5b8def",
      colorLink: "#4a5ae0",
    },
  },
  {
    id: "cream",
    label: "奶油暖橘",
    hint: "暖阳奶油，柔和治愈",
    swatch: "#e8834a",
    isDark: false,
    antd: {
      colorPrimary: "#e8834a",
      colorBgLayout: "#faf6ef",
      colorBgContainer: "#ffffff",
      colorBgElevated: "#ffffff",
      colorText: "#3d3629",
      colorTextSecondary: "#6b6355",
      colorTextDisabled: "#c5bba8",
      colorBorderSecondary: "#efe5d6",
      colorSplit: "#f3ebdc",
      colorSuccess: "#7ba05b",
      colorWarning: "#d9a514",
      colorError: "#d95c5c",
      colorInfo: "#5b9bc9",
      colorLink: "#d06e38",
    },
  },
  {
    id: "mint",
    label: "薄荷清新",
    hint: "薄荷新绿，清爽提神",
    swatch: "#2fa57e",
    isDark: false,
    antd: {
      colorPrimary: "#2fa57e",
      colorBgLayout: "#f2f8f4",
      colorBgContainer: "#ffffff",
      colorBgElevated: "#ffffff",
      colorText: "#24352d",
      colorTextSecondary: "#4a5c52",
      colorTextDisabled: "#b7c7bd",
      colorBorderSecondary: "#dfeee5",
      colorSplit: "#e6f2eb",
      colorSuccess: "#2fa57e",
      colorWarning: "#d9a514",
      colorError: "#d95c5c",
      colorInfo: "#4a90c4",
      colorLink: "#218a67",
    },
  },
  {
    id: "midnight",
    label: "月夜暗色",
    hint: "低亮夜色，护眼专注",
    swatch: "#7b8cff",
    isDark: true,
    antd: {
      colorPrimary: "#7b8cff",
      colorBgLayout: "#15171f",
      colorBgContainer: "#1d2029",
      colorBgElevated: "#262b38",
      colorText: "#e8eaf2",
      colorTextSecondary: "#aeb4c4",
      colorTextDisabled: "#5c6273",
      colorBorderSecondary: "#2c313e",
      colorSplit: "#262b36",
      colorSuccess: "#4fc98d",
      colorWarning: "#e8b334",
      colorError: "#f26d6d",
      colorInfo: "#7fa6ff",
      colorLink: "#93a0ff",
    },
  },
] as const;

export const DEFAULT_THEME: ThemeId = "aurora";

/** localStorage 键：三个窗口同源（同一 Electron session），读到的就是当前主题 */
export const THEME_STORAGE_KEY = "checkin.theme";

/** 跨窗口同步主题的广播事件名 */
export const THEME_CHANGE_EVENT = "theme-changed";

export function isThemeId(value: unknown): value is ThemeId {
  return (
    typeof value === "string" &&
    THEME_LIST.some((item) => item.id === (value as ThemeId))
  );
}

export function getThemeMeta(id: ThemeId): ThemeMeta {
  return THEME_LIST.find((item) => item.id === id) ?? THEME_LIST[0];
}
