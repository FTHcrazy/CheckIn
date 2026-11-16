/**
 * 题库 · 项目工程化（从「能跑」到「能交付、能协作、能回滚」）。
 *
 * 这一组题不考 API，考的是「一个团队怎么把前端当产品维护」：
 * 构建缓存、配置注入、质量门禁、依赖治理、发布与回滚、监控闭环。
 */
import type { InterviewQuestion } from "./interview-types";

export const SEED_ENGINEERING_PLUS: readonly InterviewQuestion[] = [
  {
    id: "eng-build-cache-layer",
    title: "构建缓存分几层，CI 上为什么还是慢",
    stem: "本地二次构建 3 秒、CI 上 6 分钟，说说构建缓存的分层与 CI 提速的真正抓手。",
    answer: `- 三层缓存：**依赖安装缓存**（\`node_modules\` / pnpm store）、**编译缓存**（webpack 持久化缓存、Vite 的 \`node_modules/.vite\`、babel/swc 缓存）、**产物缓存**（按源码 hash 命中，直接跳过构建）。
- 本地快是因为增量 + 持久化缓存命中；CI 慢通常是**缓存没跨流水线复用**（runner 每次全新）或**缓存键写错**（带上了时间戳/分支名导致永不命中）。
- 抓手一：锁文件 + store 缓存做 \`--frozen-lockfile\` 与依赖层缓存；抓手二：给编译缓存设置 \`cache.buildDependencies\`（配置文件变化才失效），并把缓存目录交给 CI 的 cache/artifact 机制。
- 抓手三：**任务级缓存**（Turborepo / Nx 的 remote cache），把「输入 hash → 产物」存到远端，多人/多 CI 共享；monorepo 收益最大。
- 注意正确性：缓存键必须包含「源码 + 依赖版本 + 环境变量 + 构建配置」，漏一项就会产出错误产物 —— 这类 bug 极难查，宁可保守。`,
    track: "foundation",
    categoryId: "foundation-engineering",
    difficulty: "hard",
    tags: ["工程化", "CI/CD", "性能", "2026"],
    topic: "构建缓存 · CI 提速",
    reviewedAt: "2026-11",
    heat: 82,
    updatedAt: "2026-11-15",
  },
  {
    id: "eng-env-config",
    title: "多环境配置：构建期注入还是运行时配置",
    stem: "开发/测试/预发/生产四套环境，配置怎么管？把密钥写进 VITE_ 变量有什么问题？",
    answer: `- **构建期注入**（\`import.meta.env.VITE_*\` / DefinePlugin）：值被**字面量替换进产物**，一次构建一套环境，简单但产物不可复用，且变量会出现在 JS 里。
- **运行时配置**：构建一次，部署时读 \`/config.json\` 或注入 \`window.__APP_CONFIG__\`；同一份产物可以在多环境流转（镜像化部署的前提）。
- 密钥红线：前端产物里的任何值都是**公开的**，\`VITE_\` 前缀只是约定不是保护；真正敏感的 key 必须留在服务端（BFF / 边缘函数）代理。
- 推荐形态：\`config.json\` 放非敏感运行时项（API 域名、开关、版本），密钥走服务端；本地开发用 \`.env.local\`（必须进 \`.gitignore\`）。
- 常见事故：构建时读不到变量导致 \`undefined\` 被拼进 URL；\`.env\` 被提交泄露测试库密码；不同环境用了同一个 CDN 路径导致缓存串味。`,
    track: "foundation",
    categoryId: "foundation-engineering",
    difficulty: "medium",
    tags: ["工程化", "安全", "发布"],
    topic: "多环境与配置管理",
    reviewedAt: "2026-11",
    heat: 74,
    updatedAt: "2026-11-14",
  },
  {
    id: "eng-quality-gate",
    title: "前端质量门禁怎么落地才不会被绕过",
    stem: "团队里 ESLint 警告一堆没人管、提交信息乱写，你会怎么设计门禁？",
    answer: `- 分三层：**本地即时反馈**（编辑器 ESLint/Prettier 插件 + \`lint-staged\` 只查改动文件，快）、**提交时**（\`husky\` + \`commitlint\` 校验 message 格式）、**CI 强校验**（\`tsc --noEmit\`、lint、test、build 全绿才可合并）。
- 关键原则：**本地能跳过（\`--no-verify\`），CI 不能**；门禁的权威在远端分支保护（required checks），本地只是提前暴露问题。
- 存量治理：不要一次性全量开 \`error\`，用「新增代码零告警 + 存量分批修」——把规则按目录/warn 分级，配合 \`--max-warnings\` 卡住增量。
- 类型检查独立成 CI 步骤：\`tsc --noEmit\` 与构建分开，避免构建工具（esbuild/swc）不做类型检查导致类型错误上线。
- 度量而不是口号：统计告警趋势、平均修复时长；门禁过严会催生「绕过文化」，宁可少而硬。`,
    track: "foundation",
    categoryId: "foundation-engineering",
    difficulty: "medium",
    tags: ["工程化", "规范", "CI/CD"],
    topic: "代码质量门禁",
    reviewedAt: "2026-11",
    heat: 72,
    updatedAt: "2026-11-13",
  },
  {
    id: "eng-dependency-governance",
    title: "依赖治理：重复打包、peerDependencies 与供应链安全",
    stem: "产物里发现 lodash 被打进三份、某个包升级后整个应用白屏，说说依赖该怎么管。",
    answer: `- **重复打包**：不同版本的同一包无法被去重，用 \`pnpm why <pkg>\` / \`npm ls\` 找出来源，靠 \`resolutions\`/\`overrides\` 统一版本；pnpm 的硬链接 + 严格 node_modules 能天然暴露「幽灵依赖」。
- **peerDependencies**：库声明「我需要宿主提供 React」，避免自己再装一份造成多实例（Hooks 报错、Context 失效的经典原因）；库开发者还应把 \`react\` 放进 \`peerDependencies\` 而不是 \`dependencies\`。
- **供应链安全**：锁文件必须提交、CI 用 \`--frozen-lockfile\`；\`pnpm audit\` / Dependabot 定期扫；新包看维护活跃度、下载量、是否有 postinstall 脚本（供应链攻击高发点）；内部包用私有 registry。
- 升级策略：小步快跑（每周一个 minor）比攒半年一次大升安全；breaking change 先读 changelog、跑测试、灰度。
- 反模式：为了一个工具函数引入 \`lodash\` 全量；\`^*\` 版本范围过宽；把 devDependencies 的东西打进运行时。`,
    track: "foundation",
    categoryId: "foundation-engineering",
    difficulty: "medium",
    tags: ["工程化", "依赖", "安全"],
    topic: "依赖治理",
    reviewedAt: "2026-11",
    heat: 70,
    updatedAt: "2026-11-12",
  },
  {
    id: "eng-release-strategy",
    title: "前端发布策略：灰度、回滚与版本语义",
    stem: "上线后 5% 用户白屏，怎么在 1 分钟内止损？前端能做灰度吗？",
    answer: `- **止损优先**：先回滚产物（CDN 指向上一个版本 / 切换 HTML 入口），再定位。前提是**每次发布产物不可变、带 hash、保留历史版本**，回滚只是改指针。
- 灰度形态：按用户 ID/地域分流（Nginx、边缘函数、微前端路由），或客户端读配置决定加载哪个 bundle 版本；SPA 要处理「旧页面 + 新 chunk」的不匹配（\`vite:preloadError\` / webpack 的 chunk 加载失败监听 → 提示刷新）。
- 版本语义：内部用 \`x.y.z\`（breaking / feature / fix），发布记录自动生成 CHANGELOG；与后端接口版本解耦，接口兼容期至少覆盖一个发布周期。
- 发布检查单：类型 + 测试 + 构建产物对比（体积变化阈值）+ 关键路径冒烟 + 监控告警已就绪。
- 组织侧：小批量高频发布比大批量低频发布风险更低；每次发布可回滚、可观测、可归因，才算真正「工程化」。`,
    track: "foundation",
    categoryId: "foundation-engineering",
    difficulty: "hard",
    tags: ["工程化", "发布", "大厂"],
    topic: "发布与回滚",
    reviewedAt: "2026-11",
    heat: 78,
    updatedAt: "2026-11-11",
  },
  {
    id: "eng-sourcemap-prod",
    title: "生产环境要不要上传 Source Map",
    stem: "线上报错堆栈全是 main.a1b2.js:1:23456，怎么还原？Source Map 直接部署到 CDN 有什么风险？",
    answer: `- 需要还原就必须有 map，但**不能公开暴露**：map 里含完整源码（含注释、内部接口路径），等于把源码送人；用 \`hidden-source-map\` 生成但不在产物里引用，单独上传到监控平台。
- 标准做法：构建产出 map → CI 上传到 Sentry/自建平台（带 release 版本号）→ 产物里删掉 \`.map\` 或加访问控制。
- 若必须留在 CDN：放到独立未公开路径 + 鉴权，或只在预发环境开放。
- 还原质量取决于 release 版本对应关系：每次发布必须用唯一 release 标记，否则 map 与代码错位，堆栈依旧看不懂。
- 加一层兜底：全局 \`window.onerror\` / \`unhandledrejection\` 上报时带上 \`release\`、\`userAgent\`、路由、用户操作序列，才能复现「只在某个机型出现」的问题。`,
    track: "foundation",
    categoryId: "foundation-engineering",
    difficulty: "medium",
    tags: ["工程化", "监控", "安全"],
    topic: "Source Map 与线上排错",
    reviewedAt: "2026-11",
    heat: 72,
    updatedAt: "2026-11-10",
  },
  {
    id: "eng-bundle-doctor",
    title: "产物变大 40%，怎么定位原因",
    stem: "一次需求后包体从 800KB 涨到 1.1MB，给出排查步骤与常见元凶。",
    answer: `- 第一步看**结构**：\`rollup-plugin-visualizer\` / \`webpack-bundle-analyzer\` 出 treemap，对比上个版本的产物快照（把 analyze 报告存进 CI artifact，才能 diff）。
- 常见元凶：整包引入 UI 库（\`import { Button } from 'antd'\` 在未配置按需时会带全量样式/组件）、引入 polyfill 全家桶、日期库全量 locale、图标库整包、被 \`moment\`/\`lodash\` 里的大模块拖累、source map 被算进产物统计。
- 第二步看**重复**：同一依赖多版本（\`pnpm why\`）、monorepo 里包互相引源码导致重复打包。
- 第三步看**压缩后**：gzip/brotli 后仍显著增长才是真问题；只涨未压缩体积往往只是注释/调试代码。
- 治理：体积预算（\`size-limit\`）进 CI，超阈值直接失败；按路由拆包；把大依赖换成轻量替代（dayjs、date-fns 按需、\`lodash-es\` + tree shaking）。`,
    track: "foundation",
    categoryId: "foundation-engineering",
    difficulty: "medium",
    tags: ["工程化", "性能", "构建"],
    topic: "产物分析",
    reviewedAt: "2026-11",
    heat: 76,
    updatedAt: "2026-11-09",
  },
  {
    id: "eng-ts-build-chain",
    title: "TypeScript 的编译链路：为什么构建不做类型检查",
    stem: "Vite 用 esbuild 转译 TS 很快，但它不检查类型 —— 那类型安全靠什么保证？",
    answer: `- esbuild/swc 只做**语法转译**（剥离类型），单文件处理、不做跨文件类型推导，所以快；这也意味着 \`const x: number = 'a'\` 这类错误不会让构建失败。
- 类型安全的落点是 **CI 里的 \`tsc --noEmit\`**（或 \`vue-tsc\` 处理 .vue）：它做完整类型检查，通常比构建慢，所以放在并行 job 或增量模式（\`--incremental\` + \`tsBuildInfoFile\`）。
- \`isolatedModules\`：开启后强制每个文件可独立转译（不能用 \`export = \`、const enum 跨文件等），这是与 esbuild 类工具协作的前提。
- 类型检查还能拦住的真实事故：可选字段未判空、联合类型漏分支（\`switch\` 穷尽性）、API DTO 与后端不一致。
- 面试加分：区分「类型系统」与「运行时校验」—— 类型在编译期消失，接口返回值仍需 zod 之类的运行时校验。`,
    track: "foundation",
    categoryId: "foundation-engineering",
    difficulty: "medium",
    tags: ["TypeScript", "工程化", "构建"],
    topic: "TS 编译链路",
    reviewedAt: "2026-11",
    heat: 74,
    updatedAt: "2026-11-08",
  },
  {
    id: "eng-feature-flag",
    title: "特性开关怎么用，怎么防止开关烂在代码里",
    stem: "新功能想按用户灰度、出问题快速关掉，你会怎么设计开关？半年后代码里 80 个 if 怎么办？",
    answer: `- 开关类型要分清：**发布开关**（短期，功能上线后删除）、**实验开关**（A/B，跑完就下线）、**运维开关**（长期，降级/限流，需要保留）。
- 落地形态：配置中心下发 JSON（带默认值与本地兜底），客户端启动时拉取 + 缓存；开关粒度到「功能模块」而非「一行代码」，避免逻辑碎片化。
- 快速止损：开关必须能**不发布就生效**（远程配置），且默认值取「安全侧」（异常时关闭新功能）。
- 治理：每个开关登记 owner、创建时间、计划清理时间；CI 里扫描「超过 N 天的发布开关」告警；开关上线后必须有一个删除它的任务单。
- 反模式：把开关当配置中心用（业务参数也塞进去）、嵌套开关（组合爆炸）、开关只在服务端判断导致前端包体仍包含未启用代码。`,
    track: "foundation",
    categoryId: "foundation-engineering",
    difficulty: "medium",
    tags: ["工程化", "发布", "实践"],
    topic: "特性开关治理",
    reviewedAt: "2026-11",
    heat: 68,
    updatedAt: "2026-11-07",
  },
  {
    id: "eng-observability",
    title: "前端可观测性：日志、指标、链路怎么落地",
    stem: "用户说「页面打不开」，你手上只有一张截图，需要哪些数据才能定位？",
    answer: `- 三条腿：**错误**（JS 异常、资源加载失败、接口失败、白屏）、**性能**（Core Web Vitals、路由级耗时、长任务）、**行为**（点击/路由/接口调用序列，用于复现路径）。
- 采集：\`window.onerror\` + \`unhandledrejection\` + \`addEventListener('error', ..., true)\` 捕资源错误；PerformanceObserver 采 LCP/INP/CLS 与长任务；接口层统一拦截记录耗时与状态码。
- 关联：所有事件带统一 \`traceId\` + \`release\` + \`userId\`（脱敏），前端到后端能串起来；否则只有孤立的报错。
- 白屏检测：关键节点打点（首屏容器是否渲染）、\`document.body\` 子节点数、路由切换超时兜底。
- 采样与成本：错误全量、性能与行为按比例采样；上报用 \`sendBeacon\` 保证页面关闭也能发出；要有本地队列与限流，避免监控自己打挂服务。`,
    track: "foundation",
    categoryId: "foundation-engineering",
    difficulty: "hard",
    tags: ["工程化", "监控", "大厂"],
    topic: "前端可观测性",
    reviewedAt: "2026-11",
    heat: 80,
    updatedAt: "2026-11-06",
  },
  {
    id: "eng-webpack-hooks",
    title: "webpack 的事件流：Tapable 钩子与插件到底怎么插进来",
    stem: "解释 webpack 的插件机制：钩子有哪几类、同步与异步怎么选，以及一个插件从注册到生效的完整链路。",
    diagramId: "dg-webpack-hooks",
    answer: `- webpack 把整个构建过程拆成一串**钩子**（Tapable 实例），插件不是「插进流程」，而是 \`tap\` 到某个钩子上；构建到那一步就会调用你注册的回调。
- 两条正交轴决定用哪个钩子：**同步/异步**（这一步要不要等 I/O）× **串行/并行**（多个插件之间有没有先后依赖）。选错会出现「拿不到异步结果」或「本该并行却串行」。
- 常用钩子：\`compiler.hooks.run/emit/done\`（进程级，启动/产出/结束）、\`compilation.hooks.optimize/processAssets\`（单次构建，改 chunk 与资源）。
- 插件必须带 \`apply(compiler)\` 方法，webpack 在初始化时统一调用一次；这也是为什么插件可以是类实例、也可以是函数返回对象。
\`\`\`js
class AddBannerPlugin {
  constructor(banner) { this.banner = banner; }
  apply(compiler) {
    // AsyncSeriesHook：等所有插件都改完产物再统一写
    compiler.hooks.emit.tapAsync("AddBanner", (compilation, callback) => {
      for (const name of Object.keys(compilation.assets)) {
        if (!name.endsWith(".js")) continue;
        const source = compilation.assets[name].source();
        compilation.assets[name] = {
          source: () => \`\${this.banner}\\n\${source}\`,
          size: () => source.length + this.banner.length,
        };
      }
      callback();
    });
  }
}
\`\`\`
- 与 loader 的分工：**loader 只做单文件内容转换**（输入字符串 → 输出字符串），**plugin 面向整个构建**（能读模块图、改 chunk、加资源）。把「改 chunk」写进 loader 是最常见的职责错位。
- 追问：HMR 也是这条链路 —— watch 触发重新 compile，在 emit 阶段把补丁通过 WebSocket 推给运行时，再由 HMR runtime 替换模块。`,
    track: "foundation",
    categoryId: "foundation-engineering",
    difficulty: "hard",
    tags: ["工程化", "webpack", "原理"],
    topic: "构建工具 · 插件机制",
    reviewedAt: "2026-11",
    heat: 73,
    updatedAt: "2026-11-16",
  },
];
