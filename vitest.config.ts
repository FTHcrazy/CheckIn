import os from "os";
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
  // 与 vite.config.ts 的 define 对齐：测试环境按"完整构建"（full 版、无窗口变体）处理
  define: { __CHECKIN_EDITION__: "'full'", __CHECKIN_NO_MAP__: "false" },
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

    /**
     * 用 worker 线程池，而不是默认的子进程池（vitest 默认 `forks`）。
     *
     * 【实测】`electron/` 那 43 个文件：forks 86s → threads 69s（-20%）。
     * 开销差在**每个测试文件都要新起一个 OS 进程**：316 个文件就是 316 次
     * 进程创建 + 重新装载 jsdom，而线程池复用进程、只重建环境。
     *
     * 更激进的两条路都试过、都没采用（数据留在这里，免得下次再走一遍）：
     * · `isolate: false`（同 worker 复用模块注册表）：全量 21min → **4.5min**，
     *   但同一 worker 里的文件共享模块注册表，凡是「模块级单例 + `vi.mock` 在
     *   import 时就绑定」的用例都会串味。两次跑分别红了 2 个 / 7 个文件，且
     *   红的是**谁**取决于文件排到哪个 worker 后面 —— 不确定的绿，不能当闸门。
     * · `pool: 'vmThreads'`：NovelWindow 子集 356s → 148s，但 vm 上下文里
     *   `globalThis.window = …`、`Object.defineProperty(window, 'location')`
     *   这类写法直接抛（`DataSafetyModal`、`import-service` 两组用例），
     *   且用例数对不上，得逐文件改写法才能用，暂不引入。
     */
    pool: "threads",

    /**
     * worker 数取**逻辑核数的一半**，不是全给。
     *
     * 【实测】NovelWindow 子集（91 文件）：默认 12 worker 356s，
     * 限 6 worker **322s**（-10%）。这台机器 12 逻辑核是带超线程的，
     * 12 个 worker 各自跑 jsdom + antd 的装载，物理核被超卖后整体更慢。
     * 留一半给系统与 vite 主进程，反而更快。
     */
    maxWorkers: Math.max(2, Math.floor(os.availableParallelism() / 2)),

    /**
     * 5000ms 默认值会把**整仓扫描型守卫**判成超时假红（实测
     * `docs-index-guard` ④ 在满负载并行时约 10s，独占跑约 2s）。
     * 这类守卫扫全仓文件、天然比单测慢一个量级，本来也不该用单测的时限去卡。
     * 放到 20s：不改变任何断言，只是不再把「机器忙」当成「代码错」。
     */
    testTimeout: 20000,

    // 测试文件与被测代码同目录，统一以 *.test.ts / *.test.tsx 命名（就近原则）。
    // electron/ 下只纳入不 import electron 运行时的测试：纯函数模块的单测，
    // 以及只读源码文本的契约守卫（两者在 jsdom 下都能跑）。
    include: ["src/**/*.test.{ts,tsx}", "electron/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    server: {
      deps: {
        /**
         * 把 `@testing-library/jest-dom` 标记为 external —— **保留它是划算的，
         * 但不要把它当成硬约束**。
         *
         * 【来历】这条是在排查一次"全仓收集到 0 个用例、每个文件都在 `initSuite`
         * 抛 `Cannot read properties of undefined (reading 'config')`"的故障时加的。
         * 当时的猜测是：它的 `/vitest` 入口（`vitest.setup.ts` 引用）会
         * `import { expect } from "vitest"`，被内联后可能出现第二份 `@vitest/runner`
         * 实例，于是模块级的 `runner` 从未被赋值。
         *
         * 【当前证据不足以支持那条因果】去掉本项后连跑多次（4/4）仍然全绿，
         * 独立复核也跑通了一次。所以**真正的原因很可能只是当时用了 `npx vitest run`**
         * （解析到错误的 root / 另一份 vitest），而不是模块内联。
         *
         * 【保留的理由】它仍有可观测的收益：少内联一个包、收集阶段更快，而且
         * 万一那条内联风险真的存在，这里已经挡住了。代价为零。
         *
         * 【以后又见到那个报错时，按这个顺序查】
         *   1. 先确认命令**不是** `npx vitest run`，而是 `pnpm exec vitest run`；
         *   2. 再确认 `vitest` 只有一份实例（`pnpm why vitest`）；
         *   3. 最后才怀疑配置。
         */
        external: ["@testing-library/jest-dom"],
      },
    },
  },
});
