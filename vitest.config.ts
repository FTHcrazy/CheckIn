import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * 单元测试专用配置。
 *
 * 独立于 vite.config.ts：测试环境不需要 Electron 主进程 / preload 构建，
 * 引入 vite-plugin-electron 反而会在 vitest 启动时触发多余构建。
 * resolve.alias 必须与 vite.config.ts / tsconfig.json 保持一致（@ → src）。
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    // jsdom 模拟浏览器环境（window/document/localStorage），供 React 组件与
    // 依赖 DOM 的工具函数测试使用；纯函数测试也在该环境下运行，保持配置统一。
    environment: "jsdom",
    // 测试文件与被测代码同目录，统一以 *.test.ts / *.test.tsx 命名（就近原则）。
    // electron/ 下仅纳入纯函数模块的测试（不 import electron 模块，jsdom 可运行）。
    include: ["src/**/*.test.{ts,tsx}", "electron/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
