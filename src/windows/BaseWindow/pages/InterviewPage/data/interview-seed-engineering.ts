/**
 * 题库 · 性能优化、工程化、操作系统与数据库。
 *
 * 四块内容偏向「工程素养」：性能要能量化，工程化要能取舍，
 * 系统与数据库要能解释「为什么慢」。
 */
import type { InterviewQuestion } from "./interview-types";

export const SEED_ENGINEERING: readonly InterviewQuestion[] = [
  // ── 性能优化 ───────────────────────────────────────────────
  {
    id: "perf-core-web-vitals",
    title: "Core Web Vitals 各项指标与优化方向",
    stem: "LCP、INP、CLS 分别衡量什么？各自的及格线是多少？",
    answer: `- **LCP（最大内容绘制）**：衡量加载体验，目标 ≤2.5s。优化资源优先级（\`preload\`、\`fetchpriority\`）、服务端 TTFB、阻塞渲染的 CSS/JS。
- **INP（交互到下一次绘制）**：衡量响应性，目标 ≤200ms（2024 年起取代 FID）。优化长任务、减少不必要的水合与重渲染。
- **CLS（累积布局偏移）**：衡量视觉稳定性，目标 ≤0.1。给图片/广告位预留尺寸、字体用 \`font-display: optional\` 或尺寸匹配的回退字体、避免在首屏插入动态内容。
- 采集：\`PerformanceObserver\` 监听 \`largest-contentful-paint\` / \`layout-shift\` / \`event\`，或用 web-vitals 库上报到 RUM。
- 注意：这些指标是**用户真实体验的分位数**（P75），不是实验室的 Lighthouse 分数，两者要分开看。`,
    track: "foundation",
    categoryId: "foundation-perf",
    difficulty: "medium",
    tags: ["性能", "2025", "高频"],
    topic: "性能指标 · Core Web Vitals",
    reviewedAt: "2026-11",
    heat: 86,
    updatedAt: "2026-10-29",
  },
  {
    id: "perf-lcp-critical-path",
    title: "首屏 LCP 慢怎么定位与优化",
    stem: "给出从 TTFB 到资源加载的排查顺序，以及每步的具体手段。",
    answer: `- 先拆四段：**TTFB**（DNS/TCP/TLS/服务端处理）、**资源加载延迟**、**资源加载时长**、**元素渲染延迟**（JS 阻塞主线程）。用 \`PerformanceObserver\` 的 \`element\`/\`renderTime\` 定位是哪一段。
- TTFB：CDN、服务端缓存、SSR 流式输出、减少重定向。
- 资源：首屏图 \`fetchpriority="high"\` + \`preload\`，避免被懒加载（\`loading="lazy"\` 用在首屏图上是常见错误）；字体用 \`preconnect\` + \`font-display: swap\`。
- 渲染阻塞：关键 CSS 内联、非关键 JS 用 \`defer\`/动态 \`import()\`、拆掉过大的同步模块。
- 验证：Lighthouse 看实验室数据，RUM 看 P75 真实分位数，两者都要有改善才算修好。`,
    track: "foundation",
    categoryId: "foundation-perf",
    difficulty: "hard",
    tags: ["性能", "首屏", "大厂"],
    topic: "性能优化 · LCP",
    reviewedAt: "2026-11",
    heat: 80,
    updatedAt: "2026-11-09",
  },
  {
    id: "perf-bundle-size",
    title: "包体积分析与削减",
    stem: "产物 8MB 想砍到 2MB 以内，说出完整的分析链路与手段。",
    answer: `- 先量化：\`rollup-plugin-visualizer\` / \`webpack-bundle-analyzer\` 出依赖树，按 gzip 后体积排序，先砍前三名。
- 常见大头：全量引入的组件库（\`import { Button } from 'antd'\` 已按需，但 \`import antd from 'antd'\` 会全量）、moment 语言包、lodash 全量、图表库。
- 手段：ESM 按需引入、用 \`dayjs\` 替 \`moment\`、\`lodash-es\` + 具名导入、路由级与组件级 \`import()\` 分割、把不常变的第三方依赖拆成 \`vendor\` chunk 长期缓存。
- 依赖替换：\`axios\` → \`fetch\`、\`classnames\` → 模板字符串、\`uuid\` → \`crypto.randomUUID\`。
- 别忘了副作用：\`sideEffects: false\` 与 \`type: "module"\` 是 Tree Shaking 生效的前提，缺了它摇不掉任何东西。`,
    track: "foundation",
    categoryId: "foundation-perf",
    difficulty: "medium",
    tags: ["性能", "工程化", "高频"],
    topic: "性能优化 · 包体积",
    reviewedAt: "2026-11",
    heat: 78,
    updatedAt: "2026-11-08",
  },
  {
    id: "perf-long-task",
    title: "长任务与主线程阻塞",
    stem: "页面卡顿但网络很快，怎么确认是主线程问题？有哪些拆解手段？",
    answer: `- 确认：Performance 面板看主线程火焰图，找 >50ms 的任务；\`PerformanceObserver\` 的 \`longtask\` 能采集到具体归因（会用 \`attribution\` 指向容器）。
- 拆解：把大循环切成小片（\`requestIdleCallback\` / \`scheduler.postTask\` / \`scheduler.yield\`），让浏览器有机会渲染与响应输入。
- 降优先级：非关键计算放到 \`Worker\`；大数据渲染用虚拟列表；重计算用 \`useMemo\` 或预计算缓存。
- 减少不必要的工作：避免在滚动/输入回调里做同步布局读写（批量读写分离）、用 \`IntersectionObserver\` 代替滚动监听。
- 指标化：改造前后对比 INP 与 TBT（总阻塞时间），不要只看「感觉变快了」。`,
    track: "foundation",
    categoryId: "foundation-perf",
    difficulty: "hard",
    tags: ["性能", "浏览器", "大厂"],
    topic: "性能优化 · 主线程",
    reviewedAt: "2026-11",
    heat: 74,
    updatedAt: "2026-10-25",
  },
  {
    id: "perf-image",
    title: "图片优化的完整方案",
    stem: "图片通常是最大的资源，从格式到加载策略说明你的做法。",
    answer: `- **格式**：AVIF/WebP 优先（同质量体积可降一半），用 \`<picture>\` 或 CDN 按 \`Accept\` 自动协商；图标与简单图形用 SVG。
- **尺寸**：按展示尺寸出图（1x/2x），用 CDN 图片处理参数动态裁剪压缩，避免「1920 图缩到 100px 显示」。
- **加载**：首屏图 \`preload\` + \`fetchpriority="high"\`，其余 \`loading="lazy"\` + \`decoding="async"\`；骨架图用 \`LQIP\`/模糊占位。
- **稳定布局**：显式写 \`width\`/\`height\` 或 \`aspect-ratio\`，防 CLS。
- **兜底**：\`onerror\` 降级到占位图，并上报失败率（源站被墙、图片服务 404 都很常见）。`,
    track: "foundation",
    categoryId: "foundation-perf",
    difficulty: "basic",
    tags: ["性能", "图片", "基础"],
    topic: "性能优化 · 图片",
    reviewedAt: "2026-11",
    heat: 68,
    updatedAt: "2026-10-28",
  },
  {
    id: "perf-monitoring",
    title: "前端监控体系怎么搭",
    stem: "性能、错误、行为三类数据分别怎么采集与上报？为什么要用 sendBeacon？",
    answer: `- **错误**：\`window.onerror\`（同步脚本）、\`unhandledrejection\`（Promise）、\`addEventListener('error', ..., true)\`（资源加载失败）、以及框架的 \`ErrorBoundary\` / \`errorHandler\`。
- **性能**：\`PerformanceObserver\` 采 LCP/INP/CLS/长任务，结合 \`navigation timing\` 出各阶段耗时。
- **行为**：路由变更、关键点击、白屏检测（\`document.body.children.length === 0\` 或采样点位）。
- **上报**：页面卸载时用 \`navigator.sendBeacon\`（不阻塞卸载、浏览器保证发送）；常规用 \`fetch(..., { keepalive: true })\`；批量合并 + 采样降低开销。
- 工程细节：sourcemap 上传到监控平台才能还原堆栈、采样率与去重（同一错误只报一次）、区分环境与版本号（否则修复无法验证）。`,
    track: "foundation",
    categoryId: "foundation-perf",
    difficulty: "medium",
    tags: ["性能", "监控", "工程化"],
    topic: "前端监控与埋点",
    reviewedAt: "2026-11",
    heat: 76,
    updatedAt: "2026-11-16",
  },
  {
    id: "perf-first-screen-checklist",
    title: "首屏优化的完整清单",
    stem: "一个新项目上线前，你会按什么顺序做首屏优化？",
    answer: `- 顺序是「先测后调」：先用 Lighthouse + RUM 建立基线，明确瓶颈在 TTFB、资源还是主线程。
- 加载层：CDN + 压缩（Brotli）+ HTTP/2/3、\`dns-prefetch\`/\`preconnect\`、关键 CSS 内联、字体子集化。
- 代码层：路由级代码分割、首屏只加载必要组件、第三方脚本延后（\`async\` 或交互后加载）。
- 渲染层：SSR/预渲染或骨架屏消除白屏、流式渲染尽早吐出首屏、避免首屏大图阻塞。
- 缓存层：静态资源长缓存 + hash、接口做 \`stale-while-revalidate\`、二次访问走 Service Worker 缓存。
- 验收：LCP ≤2.5s、CLS ≤0.1、首屏 JS 执行时间可控，并把这些指标接进日常监控防止回退。`,
    track: "foundation",
    categoryId: "foundation-perf",
    difficulty: "basic",
    tags: ["性能", "首屏", "基础"],
    topic: "性能优化 · 首屏清单",
    reviewedAt: "2026-11",
    heat: 72,
    updatedAt: "2026-10-25",
  },

  // ── 工程化与构建 ───────────────────────────────────────────
  {
    id: "eng-webpack-vite",
    title: "Webpack 与 Vite 的原理差异",
    diagramId: "dg-webpack-flow",
    stem: "为什么 Vite 冷启动快？生产构建为什么又用 Rollup？",
    answer: `- Webpack 是**打包式**：先递归解析依赖图，再用 loader/plugin 全量构建，模块越多启动越慢。
- Vite 开发期**不打包**：利用浏览器原生 ESM 按需请求，服务端只做单文件转译（esbuild），冷启动时间与模块数几乎无关。
- 依赖预构建：用 esbuild 把 CJS 依赖转成 ESM 并合并请求，减少大量小文件请求（\`optimizeDeps\`）。
- 生产构建 Vite 早期用 Rollup（tree-shaking 与产物质量成熟），并逐步引入 Rolldown（Rust 版）替代；Webpack 在复杂插件生态与老项目上仍占优。
- 取舍：新项目选 Vite 体验更好；需要极致自定义打包（特殊资源、老式多入口、Module Federation 深度定制）时 Webpack/Rspack 更稳。`,
    track: "foundation",
    categoryId: "foundation-engineering",
    difficulty: "hard",
    tags: ["工程化", "构建", "高频"],
    topic: "构建工具原理",
    reviewedAt: "2026-11",
    heat: 84,
    updatedAt: "2026-11-01",
  },
  {
    id: "eng-tree-shaking",
    title: "Tree Shaking 的生效条件",
    stem: "为什么有的包摇不掉？sideEffects 与 CommonJS 各自的影响是什么？",
    answer: `- 前提是 **ESM 静态结构**：\`import\`/\`export\` 可被静态分析；CJS 的 \`require\` 与动态属性访问无法安全消除。
- \`package.json\` 的 \`sideEffects: false\`（或数组列出有副作用的文件）告诉打包器「未用到的模块可以整块删除」；不写这项，import 了但没用也可能被保留（担心副作用）。
- 常见摇不掉的原因：\`import _ from 'lodash'\`（整体引入）、\`import 'xxx/dist/xxx.css'\`（副作用）、类与静态属性被当作有副作用、\`export default { a, b }\` 整体导出。
- 生产模式 + 压缩器（terser/esbuild）配合才能完成「标记 → 删除」两步，开发模式通常不做。
- 验证手段：bundle-analyzer 看具体模块是否还在产物里，别只看体积数字。`,
    track: "foundation",
    categoryId: "foundation-engineering",
    difficulty: "medium",
    tags: ["工程化", "构建", "高频"],
    topic: "Tree Shaking",
    reviewedAt: "2026-11",
    heat: 76,
    updatedAt: "2026-11-09",
  },
  {
    id: "eng-monorepo",
    title: "Monorepo 与 pnpm workspace",
    stem: "多包仓库怎么管理依赖与构建？pnpm 相比 npm/yarn 解决了什么？",
    answer: `- 收益：跨包改动能一次提交、共享配置与工具链、依赖版本统一；代价是构建编排与 CI 复杂度上升。
- **pnpm** 用内容寻址存储 + 硬链接，同一版本只存一份，并通过**严格符号链接结构**阻止「幽灵依赖」（只能 import 声明过的包）。
- workspace 用法：\`pnpm-workspace.yaml\` 声明包目录，包之间用 \`workspace:*\` 引用，天然本地链接、无需 \`npm link\`。
- 构建编排：用 Turborepo / Nx 做任务图与**远程缓存**，只重建受影响的包（按 git diff 计算影响范围），这是 monorepo 能在 CI 上跑得动的关键。
- 发版：changesets 管理版本与 changelog，避免手工改版本号导致依赖错配。`,
    track: "foundation",
    categoryId: "foundation-engineering",
    difficulty: "medium",
    tags: ["工程化", "Monorepo", "2025"],
    topic: "Monorepo 与包管理",
    reviewedAt: "2026-11",
    heat: 72,
    updatedAt: "2026-10-23",
  },
  {
    id: "eng-micro-frontend",
    title: "微前端与 Module Federation",
    stem: "微前端解决什么问题？Module Federation 的远程模块是怎么工作的？",
    answer: `- 适用场景：多团队并行开发、技术栈异构、老系统渐进式迁移。**不是**默认架构选择 —— 单团队中小项目引入微前端往往只是增加复杂度。
- 主流方案：iframe（隔离最好、体验最差）、qiankun/single-spa（JS 沙箱 + 样式隔离）、**Module Federation**（构建期/运行期共享模块）。
- MF 原理：\`ModuleFederationPlugin\` 暴露 \`remoteEntry.js\` 清单，宿主在运行时按需加载远程模块，并共享 \`react\` 等单例依赖避免重复加载。
- 关键难点：样式隔离、全局变量与路由冲突、共享依赖版本不一致（必须要 \`singleton: true\` + 版本约束）、子应用独立发布后的兼容性回归。
- 治理：明确子应用边界与通信契约（事件总线或 props），并准备降级方案（子应用加载失败时的兜底 UI）。`,
    track: "foundation",
    categoryId: "foundation-engineering",
    difficulty: "hard",
    tags: ["工程化", "架构", "大厂"],
    topic: "微前端",
    reviewedAt: "2026-11",
    heat: 74,
    updatedAt: "2026-11-06",
  },
  {
    id: "eng-ci-cd",
    title: "前端 CI/CD 流水线怎么设计",
    diagramId: "dg-cicd",
    stem: "从提交到上线，一条可靠的流水线包含哪些阶段？质量门禁放在哪？",
    answer: `- 阶段：**安装（锁文件 + 缓存）→ 静态检查（tsc/eslint）→ 单测 → 构建 → 产物校验（体积、gzip）→ 部署（预发 → 灰度 → 全量）**。
- 门禁：tsc 与 eslint 必须零错误、单测覆盖率不下降、包体积增量超阈值告警、\`npm audit\` 高危为 0。
- 缓存策略：按 lockfile 哈希缓存依赖；构建产物也可以缓存（monorepo 场景按包缓存）。
- 部署：静态资源上传对象存储 + CDN 刷新，HTML 与资源分离发布；灰度按用户/地域分流并盯错误率与核心指标。
- 回滚：产物与版本绑定、保留近 N 个版本可秒级切回，比「紧急修复提交」可靠得多。`,
    track: "foundation",
    categoryId: "foundation-engineering",
    difficulty: "medium",
    tags: ["工程化", "CI/CD", "发布"],
    topic: "CI/CD 与发布",
    reviewedAt: "2026-11",
    heat: 70,
    updatedAt: "2026-10-22",
  },
  {
    id: "eng-git-workflow",
    title: "Git 工作流与冲突处理",
    stem: "团队该用 Git Flow 还是 trunk-based？rebase 与 merge 怎么选？",
    answer: `- **trunk-based**（主干开发 + 短分支 + 特性开关）更适合持续交付；Git Flow 分支多、合并链长，适合有严格发布窗口的团队。
- \`merge\` 保留完整历史（有 merge commit），\`rebase\` 线性历史但会**重写提交**，所以只对「自己的未推送分支」rebase。
- 冲突处理：先 \`git fetch\` 再 rebase / merge，冲突时逐块解决并运行测试；不要用 \`-X ours\` 之类策略掩盖真实冲突。
- 高危操作：\`git reset --hard\`、\`push --force\`（用 \`--force-with-lease\` 代替）、\`git checkout -- .\` 都会不可逆丢改动。
- 规范：提交信息说明「做了什么」、一个 PR 只做一件事、\`git bisect\` 找回归提交、\`git revert\` 优于改写历史。`,
    track: "foundation",
    categoryId: "foundation-engineering",
    difficulty: "basic",
    tags: ["工程化", "Git", "基础"],
    topic: "Git 工作流",
    reviewedAt: "2026-11",
    heat: 62,
    updatedAt: "2026-11-15",
  },
  {
    id: "eng-toolchain-2026",
    title: "2026 年前端工具链的新选择",
    stem: "Rolldown、Biome、Bun、Oxc 各自想解决什么？引入时要注意什么？",
    answer: `- 共同趋势：**用 Rust/Zig 重写 JS 工具链**，把构建、lint、格式化的耗时压一个数量级。
- Rolldown：Rust 版打包器，目标是统一 Vite 开发与生产的构建器（替代 esbuild + Rollup 双引擎）；Oxc 提供解析与 lint 的基础设施。
- Biome：Rust 实现的 lint + format 二合一，兼容大部分 ESLint/Prettier 规则，配置更简单、速度快，但插件生态与自定义规则不如 ESLint 成熟。
- Bun：运行时 + 包管理 + 打包 + 测试一体化，兼容大部分 Node API 与 npm 生态，适合脚本与中小服务，生产关键路径要评估稳定性与原生模块兼容。
- 引入建议：先在**非关键链路**（本地开发、CI 的 lint 阶段）替换，保留回退方案；一条命令快 10 倍不值得换来半年排查工具链 bug。`,
    track: "foundation",
    categoryId: "foundation-engineering",
    difficulty: "basic",
    tags: ["工程化", "2026", "工具链"],
    topic: "前端工具链演进",
    reviewedAt: "2026-11",
    heat: 66,
    updatedAt: "2026-10-22",
  },
  {
    id: "eng-error-tracking",
    title: "线上错误如何定位到源码",
    stem: "压缩后的产物报错栈全是 a.b(c)，怎么还原？sourcemap 该不该公开？",
    answer: `- 构建时生成 sourcemap 并**上传到监控平台**（Sentry 等），产物里通过 \`//# sourceMappingURL\` 或平台注入的 release 关联；上报时带上 release 与 dist 版本才能正确映射。
- **不要把 sourcemap 部署到公网**：它包含完整源码，等于开源；应上传后从产物目录删除，或用带鉴权的私有路径。
- 错误上报要带上下文：\`release\`、\`environment\`、用户 id（脱敏）、路由、浏览器与版本、breadcrumb（操作序列）。
- 去重与聚合：同一错误按 stack 指纹聚合，否则一个循环错误会打爆配额。
- 还原后仍要能**复现**：结合用户会话回放或关键日志，很多错误是「数据异常 + 边界条件」共同导致的。`,
    track: "foundation",
    categoryId: "foundation-engineering",
    difficulty: "medium",
    tags: ["工程化", "监控", "排障"],
    topic: "错误监控与 sourcemap",
    reviewedAt: "2026-11",
    heat: 64,
    updatedAt: "2026-11-13",
  },

  // ── 操作系统与 Linux ───────────────────────────────────────
  {
    id: "os-process-thread-coroutine",
    title: "进程、线程与协程的区别",
    stem: "从资源隔离、切换成本与调度方式比较三者，并说明 JS 属于哪一种并发模型。",
    answer: `- **进程**：独立地址空间与资源，隔离性最好，切换要换页表（成本最高），进程间通信用管道/共享内存/socket。
- **线程**：同进程内共享内存，切换只保存寄存器与栈（成本低），需要锁来保护共享数据。
- **协程**：用户态调度，切换由程序自己控制（成本极低），不需要锁，但一个协程阻塞会阻塞整个线程。
- JS 是**单线程 + 事件循环**：本质是「回调/微任务」协作式并发，不是协程；真正的并行要 \`worker_threads\`。
- 追问：Go 的 goroutine 是 M:N 调度，Rust 的 async 是协程 + 运行时，理解差异有助于判断「什么时候该多线程、什么时候该异步」。`,
    track: "foundation",
    categoryId: "foundation-os",
    difficulty: "medium",
    tags: ["操作系统", "高频", "原理"],
    topic: "Linux 进程与线程",
    reviewedAt: "2026-11",
    heat: 78,
    updatedAt: "2026-11-04",
  },
  {
    id: "os-io-multiplexing",
    title: "select / poll / epoll 的区别",
    stem: "为什么 epoll 在高并发下更快？水平触发与边缘触发怎么选？",
    answer: `- \`select\`：fd 集合是位图，上限 1024，每次调用都要把集合从用户态拷到内核并线性扫描，O(n)。
- \`poll\`：改用数组去掉数量限制，但仍需全量拷贝与线性扫描。
- \`epoll\`：\`epoll_ctl\` 注册一次（红黑树维护），就绪的 fd 由内核放入**就绪链表**，\`epoll_wait\` 只返回就绪项，O(1) 感知，适合万级连接。
- **水平触发（LT）**：只要还有数据就持续通知，编程简单，容易漏读导致忙循环；**边缘触发（ET）**：只在状态变化时通知一次，必须配合非阻塞 fd + 循环读到 \`EAGAIN\`。
- Node.js 的 libuv 在 Linux 上就是用 epoll，这也是它适合 I/O 密集服务的原因。`,
    track: "foundation",
    categoryId: "foundation-os",
    difficulty: "hard",
    tags: ["操作系统", "Linux", "大厂"],
    topic: "Linux I/O 多路复用",
    reviewedAt: "2026-11",
    heat: 74,
    updatedAt: "2026-11-12",
  },
  {
    id: "os-virtual-memory",
    title: "虚拟内存与缺页中断",
    stem: "为什么需要虚拟内存？一次内存访问可能发生什么？",
    answer: `- 虚拟内存给每个进程独立的地址空间，实现**隔离**与**按需分配**，并让程序不必关心物理布局。
- 地址翻译靠页表（多级页表省空间）+ TLB（缓存翻译结果，命中就快）；缺页时触发**缺页中断**，由内核从磁盘/交换区换入，或直接分配零页。
- 页面置换算法常见 LRU 近似（clock / 二次机会），频繁换入换出就是「抖动（thrashing）」，表现为系统极慢而 CPU 不高。
- 相关概念：\`mmap\` 把文件映射进地址空间（零拷贝读大文件）、写时复制（fork 后的 COW）、内存映射的 \`RSS\` 与 \`VSZ\` 区别。
- 排查：\`free -h\`、\`vmstat\`、\`/proc/meminfo\` 看 swap 使用与缺页率。`,
    track: "foundation",
    categoryId: "foundation-os",
    difficulty: "hard",
    tags: ["操作系统", "原理", "大厂"],
    topic: "虚拟内存",
    reviewedAt: "2026-11",
    heat: 70,
    updatedAt: "2026-11-04",
  },
  {
    id: "os-linux-commands",
    title: "常用 Linux 排障命令",
    stem: "服务响应变慢，按顺序你会跑哪些命令？各自看什么？",
    answer: `- \`top\`/\`htop\`：看 CPU、内存、负载（\`load average\` 与核数对比）；\`ps aux --sort=-%cpu\` 找具体进程。
- \`free -h\`：内存与 swap；\`vmstat 1\`：上下文切换与 swap 活动；\`iostat -x 1\`：磁盘 IO 是否打满。
- \`ss -lntp\`（替代 netstat）：监听端口与连接状态，\`TIME_WAIT\`/\`CLOSE_WAIT\` 数量异常能指向连接泄漏。
- \`lsof -p <pid>\`：进程打开的文件与网络连接，排查句柄泄漏；\`df -h\` / \`du -sh *\`：磁盘是否写满。
- 日志侧：\`tail -f\`、\`grep -n "ERROR"\`、\`awk '{print $7}' | sort | uniq -c | sort -rn\` 做 TOP 统计、\`sed -n '100,200p'\` 取片段。`,
    track: "foundation",
    categoryId: "foundation-os",
    difficulty: "basic",
    tags: ["Linux", "运维", "基础"],
    topic: "Linux 常用命令",
    reviewedAt: "2026-11",
    heat: 76,
    updatedAt: "2026-10-29",
  },
  {
    id: "os-shell-pipeline",
    title: "shell 管道、重定向与退出码",
    stem: "统计日志里访问量前 10 的 IP 并输出到文件，写出命令并解释每一步。",
    answer: `\`\`\`bash
awk '{print $1}' access.log | sort | uniq -c | sort -rn | head -10 > top10.txt
\`\`\`
- \`awk '{print $1}'\`：取第一列（IP）；\`sort\` 让相同 IP 相邻；\`uniq -c\` 统计连续重复次数；\`sort -rn\` 按数字倒序；\`head -10\` 取前 10。
- \`>\` 覆盖写、\`>>\` 追加；\`2>\` 重定向错误输出，\`2>&1\` 把错误并入标准输出（顺序很重要：\`> file 2>&1\` 与 \`2>&1 > file\` 结果不同）。
- \`|\` 只传 stdout；\`tee\` 可以同时写文件与继续管道。
- 退出码：\`0\` 成功，非 0 失败；\`set -e\` 让脚本出错即停，\`$?\` 取上一条命令的退出码。
- 大文件注意：\`awk\` 逐行处理不占内存，别用 \`cat | grep\` 这种多余进程。`,
    track: "foundation",
    categoryId: "foundation-os",
    difficulty: "basic",
    tags: ["Linux", "Shell", "基础"],
    topic: "Shell 管道与重定向",
    reviewedAt: "2026-11",
    heat: 60,
    updatedAt: "2026-10-31",
  },
  {
    id: "os-deadlock",
    title: "死锁的四个必要条件与避免",
    stem: "如何检测与预防死锁？实际系统里通常怎么做？",
    answer: `- 四个必要条件：**互斥、占有且等待、不可抢占、循环等待**，缺一即可破死锁。
- 破法：资源有序分配（破坏循环等待）、一次性申请全部资源（破坏占有且等待）、超时释放（破坏不可抢占）、\`tryLock\` + 退避。
- 检测：\`jstack\`/\`gdb\` 看线程栈、数据库的 \`SHOW ENGINE INNODB STATUS\` 会列出最近一次死锁的两条事务；\`strace\` 看卡在哪个系统调用。
- 实践：统一加锁顺序、缩短持锁时间（只在临界区持锁）、用队列/单线程化替代锁、给锁设超时并记录。
- 分布式场景的「死锁」表现为互相等待 RPC，靠调用链超时 + 熔断打破，不能只依赖单机锁。`,
    track: "foundation",
    categoryId: "foundation-os",
    difficulty: "medium",
    tags: ["操作系统", "并发", "原理"],
    topic: "并发与死锁",
    reviewedAt: "2026-11",
    heat: 62,
    updatedAt: "2026-11-08",
  },
  {
    id: "os-context-switch",
    title: "用户态、内核态与上下文切换",
    stem: "什么时候会从用户态陷入内核态？上下文切换的代价体现在哪里？",
    answer: `- 用户态不能直接访问硬件与内核数据结构；通过**系统调用**（read/write/futex）、异常、中断进入内核态，处理完返回。
- 每次切换要保存/恢复寄存器、栈指针、页表信息（跨进程时），还会**污染 CPU 缓存与 TLB**，代价远高于普通函数调用。
- 高切换率的典型原因：大量短连接、频繁加锁竞争、线程数远超核数、频繁 \`sleep/wakeup\`。
- 观测：\`vmstat\` 的 \`cs\`（上下文切换次数）、\`pidstat -w\` 看自愿/非自愿切换；非自愿切换高说明 CPU 争抢严重。
- 优化方向：减少线程数、用 I/O 多路复用代替一连接一线程、批量处理、无锁数据结构。`,
    track: "foundation",
    categoryId: "foundation-os",
    difficulty: "medium",
    tags: ["操作系统", "性能", "原理"],
    topic: "上下文切换",
    reviewedAt: "2026-11",
    heat: 58,
    updatedAt: "2026-10-28",
  },
  {
    id: "os-file-descriptor",
    title: "文件描述符与句柄泄漏",
    stem: "服务报 Too many open files，怎么定位与根治？",
    answer: `- fd 是进程打开文件的整数索引，每个 socket、文件、管道都占用一个；上限由 \`ulimit -n\` 与 \`/proc/<pid>/limits\` 决定。
- 定位：\`lsof -p <pid> | wc -l\` 看总量，\`lsof -p <pid> | awk '{print $5}'\` 按类型聚合，\`ls /proc/<pid>/fd | wc -l\` 直接数。
- 常见泄漏源：请求未关闭连接（忘记 \`res.end()\` / \`conn.release()\`）、数据库连接池未归还、\`fs.createReadStream\` 出错未销毁、日志文件被反复打开。
- 根治靠**资源池 + 显式释放**：连接池上限、\`try/finally\` 释放、给所有句柄设超时。
- 应急可以临时调大 \`ulimit\`，但那只是把故障推迟，不是修复。`,
    track: "foundation",
    categoryId: "foundation-os",
    difficulty: "hard",
    tags: ["Linux", "运维", "排障"],
    topic: "文件描述符与资源泄漏",
    reviewedAt: "2026-11",
    heat: 64,
    updatedAt: "2026-10-20",
  },

  // ── 数据库基础 ─────────────────────────────────────────────
  {
    id: "db-index-btree",
    title: "为什么索引用 B+ 树而不是二叉树或哈希",
    diagramId: "dg-btree",
    stem: "从磁盘 IO、范围查询、树高三个角度解释 B+ 树的优势。",
    answer: `- 磁盘按**页**（4KB/16KB）读取，B+ 树的节点大小与页对齐，一次 IO 能读入几百个键，**树高低**（千万级数据约 3-4 层）意味着 3-4 次 IO。
- 非叶子节点只存键不存数据，同样大小的页能容纳更多分支 → 树更矮；叶子节点用链表相连，**范围查询与排序**可以顺序扫描。
- 哈希索引只适合等值查询，不支持范围与排序（Memory 引擎用哈希，Redis 也是哈希思路）。
- 二叉树在磁盘上每层一次 IO，树高退化时性能急剧下降；B 树把数据放在所有节点，范围扫描要回溯。
- 追问：聚簇索引（InnoDB 主键）叶子存整行，二级索引叶子存主键需**回表**；覆盖索引可避免回表。`,
    track: "foundation",
    categoryId: "foundation-database",
    difficulty: "medium",
    tags: ["数据库", "索引", "高频"],
    topic: "数据库索引原理",
    reviewedAt: "2026-11",
    heat: 84,
    updatedAt: "2026-11-14",
  },
  {
    id: "db-transaction-isolation",
    title: "事务 ACID 与隔离级别",
    stem: "四个隔离级别分别解决什么并发问题？MySQL 默认是哪一级？",
    answer: `- ACID：原子性（undo log）、一致性（约束与业务）、隔离性（锁 + MVCC）、持久性（redo log + 刷盘）。
- 并发问题：**脏读**（读到未提交）、**不可重复读**（两次读同一行不同）、**幻读**（两次读行数不同）。
- 隔离级别：读未提交（都不解决）→ 读已提交（解决脏读）→ 可重复读（解决不可重复读）→ 串行化（都解决，性能最差）。
- MySQL InnoDB 默认 **RR（可重复读）**，通过 MVCC + 间隙锁在很大程度上避免了幻读；PostgreSQL 默认 RC。
- 实践：大部分业务用 RC 就够（幻读影响小、锁更少），涉及「先查后写」的强一致场景才需要 RR 或显式加锁。`,
    track: "foundation",
    categoryId: "foundation-database",
    difficulty: "medium",
    tags: ["数据库", "事务", "高频"],
    topic: "数据库事务与隔离",
    reviewedAt: "2026-11",
    heat: 80,
    updatedAt: "2026-11-12",
  },
  {
    id: "db-mvcc",
    title: "MVCC 是怎么实现的",
    stem: "undo log、read view 与版本链如何配合实现「读不加锁」？",
    answer: `- 每行有隐藏的 \`trx_id\`（最近修改事务）与 \`roll_pointer\`（指向 undo log 中的旧版本），多个版本串成**版本链**。
- 快照读时创建 **ReadView**：记录当前活跃事务 id 列表、最小与最大事务 id 等；沿版本链找第一个「对本事务可见」的版本。
- 可见性判断：\`trx_id < min\` 可见；\`>= max\` 不可见；介于两者之间看是否在活跃列表里。
- **RC 与 RR 的差别就在 ReadView 的创建时机**：RC 每条语句新建，RR 只在事务首次快照读时创建一次 —— 这就是 RR 能「可重复读」的原因。
- 当前读（\`SELECT ... FOR UPDATE\`、增删改）不走 MVCC，而是加锁读最新版本；理解这一点才能解释「快照读看不到、更新却能改到」。`,
    track: "foundation",
    categoryId: "foundation-database",
    difficulty: "hard",
    tags: ["数据库", "原理", "大厂"],
    topic: "MVCC 多版本并发控制",
    reviewedAt: "2026-11",
    heat: 76,
    updatedAt: "2026-11-04",
  },
  {
    id: "db-slow-query",
    title: "慢查询排查流程",
    stem: "一条接口突然变慢，如何确认是数据库问题并定位到具体 SQL？",
    answer: `- 先分层：看监控里 SQL 耗时占比、连接池等待、CPU/IO；确认是「慢查询」还是「锁等待」或「连接池耗尽」。
- 慢查询日志（\`slow_query_log\` + \`long_query_time\`）捞出 Top SQL，用 \`EXPLAIN\` / \`EXPLAIN ANALYZE\` 看执行计划。
- 关注点：\`type\`（ALL 全表扫是最差）、\`key\` 是否命中索引、\`rows\` 预估行数、\`Extra\` 里的 \`Using filesort\` / \`Using temporary\`。
- 常见原因：**索引失效**（对字段做函数运算、隐式类型转换、\`LIKE '%x'\` 前置通配、联合索引未用最左列）、深分页 \`LIMIT 100000, 20\`、大事务持锁。
- 优化手段：加/改索引、覆盖索引避免回表、深分页改用游标（\`WHERE id > ?\`）、拆大查询、加缓存。`,
    track: "foundation",
    categoryId: "foundation-database",
    difficulty: "medium",
    tags: ["数据库", "排障", "高频"],
    topic: "数据库慢查询优化",
    reviewedAt: "2026-11",
    heat: 74,
    updatedAt: "2026-10-20",
  },
  {
    id: "db-cache-problems",
    title: "缓存穿透、击穿与雪崩",
    stem: "三个概念的区别是什么？各自的解法有哪些？",
    answer: `- **穿透**：查询不存在的数据，请求每次都打到数据库。解法：缓存空值（短 TTL）、布隆过滤器、参数合法性校验。
- **击穿**：某个热点 key 过期的瞬间大量并发穿透。解法：互斥锁/单飞（只允许一个请求回源）、逻辑过期 + 异步刷新、热点 key 永不过期。
- **雪崩**：大量 key 同时过期或缓存集群故障。解法：过期时间加随机抖动、多级缓存（本地 + Redis）、限流降级与熔断、缓存高可用。
- 共同前提是**缓存与数据库的一致性**：常用 Cache-Aside，更新时「先更库再删缓存」，并对删除失败做重试/延迟双删。
- 一致性要求高时用 binlog 订阅（Canal）异步刷新，比业务代码里双写更可靠。`,
    track: "foundation",
    categoryId: "foundation-database",
    difficulty: "hard",
    tags: ["数据库", "缓存", "高频"],
    topic: "缓存问题与一致性",
    reviewedAt: "2026-11",
    heat: 86,
    updatedAt: "2026-11-02",
  },
  {
    id: "db-redis-data-structures",
    title: "Redis 的数据结构与适用场景",
    stem: "String、Hash、List、Set、ZSet 分别适合什么业务？为什么单线程还快？",
    answer: `- String：缓存对象、计数器（\`INCR\`）、分布式锁（\`SET NX PX\`）；Hash：对象字段局部更新；List：队列/时间线（\`LPUSH + BRPOP\`）。
- Set：去重与交并差（共同关注）；ZSet：排行榜、延时队列（按 score 取）、滑动窗口限流。
- 单线程快的原因：**纯内存 + 高效数据结构 + I/O 多路复用 + 无锁无切换**；瓶颈通常在网络与序列化，而不是 CPU。
- 注意单条命令的复杂度：\`KEYS *\`、\`SMEMBERS\` 大集合、\`ZRANGE\` 大范围都会阻塞整个实例，生产禁用 \`KEYS\`，改用 \`SCAN\`。
- 持久化：RDB（快照，恢复快但可能丢数据）与 AOF（追加日志，更安全但更大），生产常用混合持久化。`,
    track: "foundation",
    categoryId: "foundation-database",
    difficulty: "basic",
    tags: ["数据库", "Redis", "基础"],
    topic: "Redis 数据结构",
    reviewedAt: "2026-11",
    heat: 72,
    updatedAt: "2026-11-10",
  },
  {
    id: "db-lock-strategy",
    title: "乐观锁、悲观锁与分布式锁",
    stem: "库存扣减场景怎么防止超卖？三种锁各自的问题是什么？",
    answer: `- **悲观锁**：\`SELECT ... FOR UPDATE\` 或 \`UPDATE stock = stock - 1 WHERE id = ? AND stock >= 1\`，靠数据库行锁保证；问题是持锁时间长、并发差。
- **乐观锁**：加 \`version\` 字段，更新时 \`WHERE version = ?\`，失败重试；适合冲突少的场景，冲突多时重试成本高。
- **分布式锁**（Redis \`SET key val NX PX\`）：值要唯一（防误删）、要有过期时间、续期用看门狗；Redlock 的可靠性有争议，强一致场景更适合 ZooKeeper/etcd。
- 关键认知：**能用数据库原子更新解决的，就不要引入分布式锁** —— \`stock >= 1\` 的条件更新是最简单可靠的方案。
- 高并发场景再加一层：Redis 预扣减 + 异步落库，配合对账补偿，而不是全靠锁。`,
    track: "foundation",
    categoryId: "foundation-database",
    difficulty: "hard",
    tags: ["数据库", "并发", "大厂"],
    topic: "并发控制与锁",
    reviewedAt: "2026-11",
    heat: 78,
    updatedAt: "2026-10-25",
  },
];
