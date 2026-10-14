/**
 * 渲染层编译常量声明（值由 vite.config.ts 的 define 注入）：
 *
 * __CHECKIN_EDITION__ —— 构建版本（环境变量 CHECKIN_EDITION，缺省 full）：
 * 决定打包哪些窗口入口与业务模块。业务代码经 src/shared/edition.ts
 * 的派生布尔使用，不要直接引用本常量。
 */
declare const __CHECKIN_EDITION__: "full" | "lite" | "novel";

/**
 * Vite 的 `?raw` 导入（图标 SVG 内联用）：iconfont 导出的 SVG 带
 * `fill="currentColor"`，按 raw 字符串内联进 DOM 才能跟随文字色
 * （`<img>` 引用做不到）。资产清单见 `src/assets/novel/`。
 */
declare module "*.svg?raw" {
  const content: string;
  export default content;
}
