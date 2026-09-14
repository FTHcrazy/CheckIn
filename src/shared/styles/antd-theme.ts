import { theme } from "antd";
import zhCN from "antd/locale/zh_CN";

/** 各窗口 ConfigProvider 的统一配置，避免 theme/locale 在窗口间重复定义 */
export const antdProviderProps = {
  locale: zhCN,
  theme: {
    algorithm: theme.defaultAlgorithm,
    token: {
      colorPrimary: "#1677ff",
      borderRadius: 8,
    },
  },
} as const;
