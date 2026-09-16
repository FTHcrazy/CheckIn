import { theme } from "antd";
import zhCN from "antd/locale/zh_CN";

/** 各窗口 ConfigProvider 的统一配置，避免 theme/locale 在窗口间重复定义 */
export const antdProviderProps = {
  locale: zhCN,
  theme: {
    algorithm: theme.defaultAlgorithm,
    // 开启 CSS 变量模式：antd 只生成一份样式表 + 变量覆盖，
    // 大幅减少运行时注入的 CSS 体积（开发模式下的样式重算开销明显下降）
    cssVar: { prefix: "ant" },
    // 开发模式关闭 CSS-in-JS 的 hash 类名拼接开销
    hashed: false,
    token: {
      colorPrimary: "#1677ff",
      borderRadius: 8,
    },
  },
} as const;
