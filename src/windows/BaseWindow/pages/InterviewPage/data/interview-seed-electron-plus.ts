/**
 * 题库 · Electron 深度实践。
 *
 * 与 `interview-seed-runtime.ts` 里的 Electron 基础题错位：那一组讲进程模型、
 * IPC、打包这些「必须知道」的东西，这一组讲上线之后才会疼的问题 ——
 * 沙箱、崩溃、协议、窗口状态、更新策略与端到端测试。
 */
import type { InterviewQuestion } from "./interview-types";

export const SEED_ELECTRON_PLUS: readonly InterviewQuestion[] = [
  {
    id: "electron-preload-sandbox",
    title: "sandbox: true 之后 preload 能做什么",
    stem: "开了 sandbox 的渲染进程里，preload 里还能 require('fs') 吗？不能的话文件操作用什么替代？",
    answer: `- 开启 \`sandbox: true\` 后渲染进程运行在 Chromium 沙箱中，preload **只能用有限的 polyfill**（\`electron\` 的 renderer 模块、\`events\`、\`timers\`、\`url\`），不能用 \`require('fs')\`/\`path\`/\`child_process\`。
- 所以 preload 必须变成**纯粹的桥**：只做参数转发与最小校验，真正的文件/网络/数据库操作全部走主进程 \`ipcMain.handle\`。
- 这恰好是正确形态：\`contextIsolation: true\` + \`sandbox: true\` + \`nodeIntegration: false\` 三件套，加上 \`contextBridge\` 暴露白名单 API，渲染层拿不到 Node。
- 常见踩坑：旧代码在 preload 里直接读文件（升级 Electron 20+ 默认开启 sandbox 后崩），或把整个 \`ipcRenderer\` 暴露给页面（等于把 IPC 全权限交给任意脚本）。
- 取舍：需要在 preload 做复杂逻辑时，应把它搬进主进程；preload 越薄，攻击面越小、升级越顺。`,
    track: "foundation",
    categoryId: "foundation-electron",
    difficulty: "hard",
    tags: ["Electron", "安全", "原理", "2026"],
    topic: "Electron 安全 · 沙箱与 preload",
    reviewedAt: "2026-11",
    heat: 86,
    updatedAt: "2026-11-15",
  },
  {
    id: "electron-crash-recovery",
    title: "渲染进程崩了怎么兜底",
    stem: "用户反馈「窗口白屏但程序没退」，怎么捕获、怎么恢复、怎么上报？",
    answer: `- 监听 \`webContents.on('render-process-gone', (event, details) => ...)\`：\`details.reason\` 区分 \`crashed\` / \`oom\` / \`killed\`；此时 \`webContents\` 无法再用，需要 \`reload()\` 或重建窗口。
- 处理顺序：先判断是否还在启动阶段（频繁崩溃要计数，避免无限重启死循环）→ 提示用户并给「重新加载」入口 → 恢复关键状态（从主进程持久化的数据重建，不要指望渲染层内存）。
- \`unresponsive\` 事件对应「主线程卡死」（长任务/死循环），可提示用户等待或强制重载；\`oom\` 说明渲染进程内存超限，通常是大数据列表或图片未释放。
- 上报：\`crashReporter.start()\` 收集崩溃转储，配合自己的日志（崩溃前的操作序列、版本、内存占用）才能定位。
- 设计层面：核心数据（编辑内容）要**增量落盘到主进程**，崩溃后能恢复；纯前端内存态在崩溃时必然丢失。`,
    track: "foundation",
    categoryId: "foundation-electron",
    difficulty: "hard",
    tags: ["Electron", "稳定性", "排错"],
    topic: "Electron 稳定性 · 崩溃处理",
    reviewedAt: "2026-11",
    heat: 78,
    updatedAt: "2026-11-14",
  },
  {
    id: "electron-app-protocol",
    title: "为什么用自定义 app:// 协议而不是 file://",
    stem: "打包后用 file:// 加载页面会遇到哪些问题？自定义协议解决了什么？",
    answer: `- \`file://\` 的问题：**同源策略特殊**（不同路径可能被视为不同源）、无法使用 Service Worker、History 路由刷新 404、\`fetch\` 相对路径与 CORS 行为不一致、部分 API（crypto.subtle、某些媒体能力）在非安全上下文不可用。
- 自定义协议（\`protocol.registerSchemesAsPrivileged\` + \`protocol.handle\`）可以声明 \`standard: true\`（获得正常 URL 解析）、\`secure: true\`（视为安全上下文）、\`supportFetchAPI\`、\`corsEnabled\`、\`codeCache: true\`，让渲染层拿到接近 https 的能力。
- 实现要点：必须做**路径穿越防护**（拒绝 \`..\`）、限定根目录、给正确的 MIME Type，否则等于开放任意文件读取。
- 收益：SPA 路由刷新正常、可开 CSP、可缓存、V8 code cache 生效（启动更快）。
- 与 \`loadFile\` 的关系：小工具用 \`loadFile\` 够用；有前端路由、Service Worker、严格 CSP 需求时应上自定义协议。`,
    track: "foundation",
    categoryId: "foundation-electron",
    difficulty: "hard",
    tags: ["Electron", "原理", "安全"],
    topic: "Electron 资源加载 · 自定义协议",
    reviewedAt: "2026-11",
    heat: 74,
    updatedAt: "2026-11-13",
  },
  {
    id: "electron-window-state",
    title: "窗口位置与大小怎么持久化",
    stem: "用户把窗口拖到副屏、放大到全屏，下次打开要还原 —— 直接存 bounds 有什么坑？",
    answer: `- 基础做法：\`resize\`/\`move\` 事件（节流）后把 \`getBounds()\` + \`isMaximized()\` 写进配置，启动时读出来传给 \`BrowserWindow\`。
- 坑一：**显示器变了**。上次在副屏的坐标可能落在已拔掉的屏幕上，启动后窗口在屏幕外；要用 \`screen.getAllDisplays()\` 校验矩形是否与任一 \`workArea\` 相交，否则回落到主屏居中。
- 坑二：**DPI 缩放**。跨不同缩放的显示器时坐标会偏移，最好记录 \`displayId\` 或按 scaleFactor 归一。
- 坑三：最大化的窗口存的是「最大化后的 bounds」，还原时先设普通尺寸再 \`maximize()\`，否则取消最大化会变成怪尺寸。
- 坑四：写配置太频繁（每次 move 都写盘）。用 300ms 防抖 + 关闭前再落一次；配置损坏要能回落到默认值而不是崩溃。`,
    track: "foundation",
    categoryId: "foundation-electron",
    difficulty: "medium",
    tags: ["Electron", "实践", "桌面端"],
    topic: "Electron 窗口管理",
    reviewedAt: "2026-11",
    heat: 70,
    updatedAt: "2026-11-12",
  },
  {
    id: "electron-file-io",
    title: "文件读写与拖拽：路径从哪来",
    stem: "渲染层要「拖一个文件进来读取」，为什么拿不到真实路径？正确做法是什么？",
    answer: `- Chromium 出于安全隐藏真实路径，\`File.path\` 在 Electron 32+ 已移除；正确做法是用 \`webUtils.getPathForFile(file)\`（preload 中通过 \`contextBridge\` 暴露一个函数）拿到绝对路径。
- 不要试图在渲染层读文件：渲染层没有 fs 权限，应该把路径发给主进程，由主进程校验后读取，再把内容（或解析结果）返回。
- 打开/保存对话框：\`dialog.showOpenDialog\` / \`showSaveDialog\` 都必须在主进程调用；返回值里带 \`canceled\`，必须判空。
- 大文件：不要一次性 \`readFile\` 再 \`send\`（IPC 会复制整个 buffer，主进程卡住）；用流 + 分块事件，或让主进程直接处理完只回结果。
- 安全：主进程收到渲染层给的路径必须**校验来源**（是否在允许目录内），否则等于给了任意文件读写能力。`,
    track: "foundation",
    categoryId: "foundation-electron",
    difficulty: "medium",
    tags: ["Electron", "文件", "实践"],
    topic: "Electron 文件操作",
    reviewedAt: "2026-11",
    heat: 72,
    updatedAt: "2026-11-11",
  },
  {
    id: "electron-update-strategy",
    title: "桌面应用的更新策略怎么设计",
    stem: "electron-updater 能自动更新就够了吗？灰度、强制更新、回滚怎么做？",
    answer: `- 三种模式：**静默下载 + 重启生效**（后台更新，适合桌面工具）、**提示更新**（用户决定，适合有未保存内容的编辑器）、**强制更新**（安全漏洞或协议不兼容时）。
- 灰度：更新源按渠道（stable/beta）或按用户 hash 分流到不同 \`latest.yml\`；出问题只影响小部分用户，且必须能**把版本号回退**（重新发布一个更高版本号的旧代码，因为客户端不会降级）。
- 差分包：electron-updater 支持 blockmap 差分下载，能显著降低流量；但要求历史包都保留在更新服务器上，否则退化为全量。
- 前置条件：**代码签名**（否则 Windows SmartScreen / macOS Gatekeeper 拦截）、版本号单调递增、更新服务器与 CDN 可用性。
- 必须处理的边界：下载中断恢复、磁盘空间不足、更新后首次启动迁移（数据库 schema 变更要幂等）、更新失败回滚到旧版本仍可运行。`,
    track: "foundation",
    categoryId: "foundation-electron",
    difficulty: "hard",
    tags: ["Electron", "发布", "大厂"],
    topic: "Electron 更新策略",
    reviewedAt: "2026-11",
    heat: 76,
    updatedAt: "2026-11-10",
  },
  {
    id: "electron-vs-tauri",
    title: "Electron 与 Tauri 怎么选",
    stem: "新项目要做桌面端，团队在 Electron 和 Tauri 之间纠结，给出决策维度。",
    answer: `- **运行时**：Electron 自带 Chromium + Node，行为在各平台完全一致；Tauri 用系统 WebView（Windows WebView2、macOS WKWebView、Linux WebKitGTK），安装包小（几 MB vs 上百 MB），但**渲染一致性要自己兜**。
- **能力**：Electron 主进程就是 Node，生态与原生模块成熟；Tauri 后端是 Rust，文件/系统能力通过命令桥接，性能好但学习成本高、插件生态较新。
- **一致性风险**：Tauri 在不同系统 WebView 版本上可能表现不同（CSS/JS 特性差异），需要更宽的兼容测试矩阵；WebView2 在旧 Windows 上可能缺失，要引导安装。
- **内存**：Electron 常驻内存高（每个窗口一个渲染进程 + 共享浏览器进程）；Tauri 省内存，但复杂页面仍吃 WebView 的量。
- 结论口径：**要绝对一致、依赖 Node 生态、团队是前端 → Electron**；**追求包体与内存、团队能写 Rust、目标平台较新 → Tauri**。别只看安装包大小做决定。`,
    track: "foundation",
    categoryId: "foundation-electron",
    difficulty: "medium",
    tags: ["Electron", "选型", "2026"],
    topic: "桌面端技术选型",
    reviewedAt: "2026-11",
    heat: 74,
    updatedAt: "2026-11-09",
  },
  {
    id: "electron-renderer-perf",
    title: "Electron 应用的性能优化从哪里下手",
    stem: "一个 Electron 应用启动 8 秒、滚动卡顿、内存 800MB，分别怎么优化？",
    answer: `- **启动**：主进程避免同步 IO（\`readFileSync\` 大文件、同步建库）；窗口 \`show: false\` + \`ready-to-show\` 再显示；延迟加载非首屏窗口；开启 V8 code cache（自定义协议 \`codeCache: true\` + 渲染侧 \`v8CacheOptions\`）；preload 保持轻薄。
- **滚动卡顿**：本质与浏览器一致（长任务、重排、大 DOM），用 DevTools Performance 定位；区别是桌面端可以关掉不需要的特效、减少 \`backdrop-filter\`（透明窗口 + 模糊很吃 GPU），并检查是否误关了硬件加速。
- **内存**：多窗口各自一个渲染进程，关窗要真正 \`destroy\`；图片用缩略图而不是原图；避免把大 Buffer 通过 IPC 反复复制（用共享内存/流）。
- **进程策略**：CPU 密集任务放 \`utilityProcess\` 或 Worker，别占主进程（主进程卡住 = 所有窗口无响应）。
- 度量优先：先量 \`performance.mark\` 的关键节点与 \`process.getProcessMemoryInfo()\`，再决定优化项，别凭感觉调参数。`,
    track: "foundation",
    categoryId: "foundation-electron",
    difficulty: "hard",
    tags: ["Electron", "性能", "排错"],
    topic: "Electron 性能优化",
    reviewedAt: "2026-11",
    heat: 80,
    updatedAt: "2026-11-08",
  },
  {
    id: "electron-e2e-test",
    title: "Electron 应用怎么做端到端测试",
    stem: "Spectron 已废弃，现在怎么测「点开窗口 → 导入文件 → 数据落库」这条链路？",
    answer: `- 方案：**Playwright 的 Electron 支持**（\`_electron.launch({ args: ['.'] })\`）拿 \`app\` 与 \`window\`，之后按普通页面操作；支持多窗口、主进程求值（\`electronApp.evaluate\`）。
- 测试隔离：每次用临时 \`userData\` 目录（\`--user-data-dir\`），避免污染真实数据库；结束后清理。
- 能测什么：窗口创建、菜单/快捷键、IPC 往返、文件导入导出、崩溃后重载；**不要**用 E2E 测纯逻辑（那属于单测）。
- 稳定性技巧：等「可见状态」而不是 \`sleep\`；CI 里跑无头（Linux 用 xvfb）；对时间敏感的断言放宽或用轮询。
- 分层建议：单元测试（数据/纯函数）+ 组件测试（jsdom）+ 少量关键路径 E2E；E2E 覆盖率不必高，但要覆盖「用户第一次打开到完成核心任务」。`,
    track: "foundation",
    categoryId: "foundation-electron",
    difficulty: "medium",
    tags: ["Electron", "测试", "工程化"],
    topic: "Electron 测试",
    reviewedAt: "2026-11",
    heat: 66,
    updatedAt: "2026-11-07",
  },
];
