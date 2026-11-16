/**
 * 题库 · Electron 与 Node.js。
 *
 * Electron 侧的题几乎都落在「进程边界与安全」上，Node 侧落在
 * 「事件循环、流、并发模型」上 —— 这两块是桌面端岗位的核心考察点。
 */
import type { InterviewQuestion } from "./interview-types";

export const SEED_RUNTIME: readonly InterviewQuestion[] = [
  // ── Electron ───────────────────────────────────────────────
  {
    id: "electron-process-model",
    title: "Electron 的进程模型",
    diagramId: "dg-electron-arch",
    stem: "主进程、渲染进程、utility 进程各负责什么？为什么渲染进程不能直接读数据库？",
    answer: `- **主进程**：唯一，负责窗口与生命周期管理、系统 API（菜单、托盘、通知、文件对话框）、以及所有需要 Node 能力的业务。
- **渲染进程**：每个窗口一个，跑 Chromium，默认**没有 Node 能力**（\`nodeIntegration: false\`），只负责 UI。
- **utility / GPU / 网络等子进程**：Chromium 自带，Electron 也支持起 \`utilityProcess\` 承载重计算。
- 渲染进程不直接读数据库的原因：一旦渲染进程能执行任意 Node 代码，XSS 就升级成**远程代码执行**（RCE，打入即可读写用户文件）。
- 正确做法是把数据访问收敛在主进程，通过 IPC 暴露**最小粒度**的接口（不是「执行任意 SQL」这种通用通道）。`,
    track: "foundation",
    categoryId: "foundation-electron",
    difficulty: "basic",
    tags: ["Electron", "基础", "架构"],
    topic: "Electron 进程模型",
    reviewedAt: "2026-11",
    heat: 78,
    updatedAt: "2026-11-08",
  },
  {
    id: "electron-ipc-invoke",
    title: "IPC：invoke/handle 与 send/on 怎么选",
    stem: "两种 IPC 模式的语义差异是什么？主进程主动推消息给渲染进程怎么做？",
    answer: `- \`ipcRenderer.invoke\` + \`ipcMain.handle\` 是**请求-响应**模式，返回 Promise，能拿到结果与异常，是首选写法（等价于 RPC）。
- \`send\` / \`on\` 是**单向**发送，不返回结果；\`sendSync\` 已不推荐（阻塞渲染进程）。
- 主进程 → 渲染进程推送用 \`webContents.send\` + 渲染侧 \`ipcRenderer.on\`；多窗口广播要遍历 \`BrowserWindow.getAllWindows()\` 或维护窗口注册表。
- 三个必须注意的点：**通道名集中定义**（别在两端手写字符串）、**参数做运行时校验**（渲染进程的输入不可信）、**监听要能取消**（\`removeListener\`，否则热更新会叠加）。
- 大数据传输要评估序列化成本：结构化克隆对超大 Buffer 有开销，必要时传文件路径或走 MessagePort。`,
    track: "foundation",
    categoryId: "foundation-electron",
    difficulty: "medium",
    tags: ["Electron", "IPC", "高频"],
    topic: "Electron IPC 通信",
    reviewedAt: "2026-11",
    heat: 88,
    updatedAt: "2026-11-12",
  },
  {
    id: "electron-context-bridge",
    title: "contextBridge 与 preload 的作用",
    stem: "为什么不能直接把 ipcRenderer 暴露到 window 上？contextBridge 做了哪些限制？",
    answer: `- \`contextIsolation: true\` 让 preload 与页面运行在**不同 JS 上下文**，页面拿不到 preload 的变量，只能通过 \`contextBridge.exposeInMainWorld\` 显式暴露。
- 直接暴露 \`ipcRenderer\` 等于把「任意通道发送」的能力交给页面，XSS 后可调用所有 IPC 通道；正确做法是暴露**白名单化的业务函数**（\`saveNote(data)\` 而不是 \`invoke(channel, args)\`）。
- contextBridge 只能传递可序列化值与函数（会做代理与限制），不能传类实例、原型链、Symbol。
- preload 里同样不要 \`require\` 任意模块或做业务逻辑，它只是极薄的适配层。
- 追问：\`sandbox: true\` 时 preload 只能用有限的 Node API（默认已开启沙箱）。`,
    track: "foundation",
    categoryId: "foundation-electron",
    difficulty: "medium",
    tags: ["Electron", "安全", "高频"],
    topic: "Electron 安全 · contextBridge",
    reviewedAt: "2026-11",
    heat: 86,
    updatedAt: "2026-10-25",
  },
  {
    id: "electron-security-baseline",
    title: "Electron 应用的安全基线",
    stem: "列出至少五条必做的安全配置，并说明各自防的是什么攻击。",
    answer: `- \`contextIsolation: true\`：防止页面脚本篡改 preload 上下文（默认已开）。
- \`nodeIntegration: false\` + \`sandbox: true\`：阻止页面直接拿到 Node 能力，避免 XSS 升级为 RCE。
- **CSP**：限制脚本与资源来源，缓解注入与远程加载；生产环境禁止 \`unsafe-eval\`。
- \`webSecurity: true\` 且不开 \`allowRunningInsecureContent\`：避免降级到 http 内容。
- 拦截导航与新窗口：\`will-navigate\` / \`setWindowOpenHandler\` 一律拒绝外部跳转，外链交给 \`shell.openExternal\` 并校验协议白名单。
- 依赖与更新：锁定 Electron 大版本并及时升级（Chromium 漏洞跟着走），代码签名 + 公证防止被替换。`,
    track: "foundation",
    categoryId: "foundation-electron",
    difficulty: "hard",
    tags: ["Electron", "安全", "大厂"],
    topic: "Electron 安全基线",
    reviewedAt: "2026-11",
    heat: 82,
    updatedAt: "2026-11-09",
  },
  {
    id: "electron-auto-update",
    title: "Electron 自动更新的完整流程",
    stem: "从打包产物到用户机器更新成功，中间有哪些环节与坑？",
    answer: `- 产物侧：生成**增量包 / 全量包** + 版本清单（latest.yml），上传到静态托管或对象存储，并保留旧版本以支持回滚。
- 客户端侧：启动后延迟检查更新 → 下载（显示进度）→ 校验签名/哈希 → 退出时静默安装（\`autoUpdater.quitAndInstall\`）。
- 平台差异：Windows 用 NSIS/Squirrel，macOS 必须**签名 + 公证**才能更新，Linux 走包管理器或 AppImage。
- 常见坑：**未签名导致 macOS 更新被拦**、更新包与当前架构不匹配（arm64/x64）、企业代理下载失败、灰度时把坏版本推全量。
- 工程实践：灰度分批（按 userID 哈希）、失败率监控、可远程关闭更新开关（服务端下发 kill switch）。`,
    track: "foundation",
    categoryId: "foundation-electron",
    difficulty: "medium",
    tags: ["Electron", "发布", "工程化"],
    topic: "Electron 自动更新",
    reviewedAt: "2026-11",
    heat: 70,
    updatedAt: "2026-11-04",
  },
  {
    id: "electron-packaging",
    title: "打包与体积优化（asar、external、按平台裁剪）",
    stem: "为什么要把代码打进 asar？哪些依赖必须留在 asar 外？",
    answer: `- asar 把文件打成一个归档，减少小文件 IO、加快启动，也能避免用户直接翻看源码（只是封装，不是加密）。
- **原生模块（.node）不能放进 asar**：需要 \`asarUnpack\`（如 \`better-sqlite3\`），因为动态库要真实路径才能 dlopen。
- 打包器（electron-builder / electron-forge）要正确区分 \`dependencies\` 与 \`devDependencies\`：运行期需要的必须进 dependencies，否则打出来的包启动即 \`Cannot find module\`。
- 主进程打包时把 Node 内置模块与原生的重型依赖设为 **external**，交给运行期 require，避免被打包器递归卷进来导致构建失败。
- 体积优化：按平台/架构分别构建、剔除 sourcemap 与测试文件、压缩图片与字体、Electron 本身按需裁剪（只用官方发行版就够）。`,
    track: "foundation",
    categoryId: "foundation-electron",
    difficulty: "medium",
    tags: ["Electron", "工程化", "打包"],
    topic: "Electron 打包",
    reviewedAt: "2026-11",
    heat: 68,
    updatedAt: "2026-11-08",
  },
  {
    id: "electron-startup-perf",
    title: "Electron 启动慢怎么优化",
    stem: "从进程启动到窗口可交互，哪些环节可以压缩？",
    answer: `- 先量化：用 \`performance.mark\` + 主进程日志把「进程启动 / 窗口创建 / 首帧 / 可交互」四段打点，别凭感觉优化。
- **窗口先出再加载**：\`show: false\` + \`ready-to-show\` 显示，或用 \`backgroundColor\` 与骨架避免白屏错觉；\`paintWhenInitiallyHidden\` 保持默认。
- 主进程瘦身：\`app.whenReady\` 里的同步工作（读大配置、注册大量 handler）延后或并行化；避免在启动路径上 require 重型模块（改成懒加载）。
- 渲染侧：路由级代码分割、预加载下一屏、把首屏不必要的字体与图标延后。
- 系统层面：单实例锁避免重复启动、禁用不必要的 Chromium 特性开关、Windows 上注意杀毒软件扫描带来的额外延迟。`,
    track: "foundation",
    categoryId: "foundation-electron",
    difficulty: "hard",
    tags: ["Electron", "性能", "大厂"],
    topic: "Electron 启动性能",
    reviewedAt: "2026-11",
    heat: 72,
    updatedAt: "2026-10-23",
  },
  {
    id: "electron-native-module",
    title: "原生模块（better-sqlite3）为什么容易踩坑",
    stem: "安装成功但运行报 NODE_MODULE_VERSION 不匹配，原因是什么？怎么避免？",
    answer: `- 原生模块是针对**特定 ABI 版本**编译的；Electron 的 Node ABI 与系统 Node 不同，npm 装出来的是给系统 Node 用的二进制。
- 解决路径：用 \`electron-rebuild\`（或 \`@electron/rebuild\`）针对 Electron 版本重编译，或在 CI 里按目标平台/架构分别构建。
- 打包时必须 \`asarUnpack\` 并确保 \`.node\` 文件随包分发；跨平台构建（如 macOS 出 Windows 包）需要交叉编译工具链或分平台 CI。
- 版本对齐：Electron 主版本决定了 Node 与 Chromium 版本，升级 Electron 后必须重编译所有原生依赖。
- 备选方案：能纯 JS 实现（如 \`sql.js\`）或改用子进程隔离原生依赖，可以显著降低打包复杂度。`,
    track: "foundation",
    categoryId: "foundation-electron",
    difficulty: "hard",
    tags: ["Electron", "工程化", "踩坑"],
    topic: "Electron 原生模块",
    reviewedAt: "2026-11",
    heat: 64,
    updatedAt: "2026-11-13",
  },
  {
    id: "electron-multi-window",
    title: "多窗口管理与状态同步",
    stem: "两个窗口要共享同一份数据并保持一致，你会怎么设计？",
    answer: `- **单一事实源放在主进程**：数据读写都走 IPC，主进程负责落库与版本号，窗口只是视图。
- 变更广播：主进程在数据变更后 \`webContents.send\` 给所有窗口；窗口侧只订阅、不自行合并，避免双向同步打架。
- 用**版本号 / 递增序号**做冲突检测：窗口提交时带上它读到的版本，主进程发现过期就拒绝并让前端刷新。
- 单实例与窗口复用：\`app.requestSingleInstanceLock()\` + \`second-instance\` 事件把已有窗口聚焦，而不是再开一个。
- 生命周期要注意：窗口关闭必须解绑它的 IPC 监听与定时器，否则主进程会持有已销毁的 \`webContents\`（调用即抛错）。`,
    track: "foundation",
    categoryId: "foundation-electron",
    difficulty: "basic",
    tags: ["Electron", "架构", "基础"],
    topic: "Electron 多窗口",
    reviewedAt: "2026-11",
    heat: 60,
    updatedAt: "2026-10-28",
  },

  // ── Node.js ────────────────────────────────────────────────
  {
    id: "node-event-loop-phases",
    title: "Node 事件循环的六个阶段",
    diagramId: "dg-node-loop",
    stem: "说明各阶段职责，以及 process.nextTick 与 Promise 微任务在哪个时机执行。",
    answer: `- 阶段顺序：**timers**（setTimeout/setInterval）→ **pending callbacks** → **idle/prepare** → **poll**（I/O 回调，会在此阻塞等待）→ **check**（setImmediate）→ **close callbacks**。
- 每两个阶段之间（以及每个宏任务回调之后）都会清空**微任务队列**：先 \`process.nextTick\` 队列，再 Promise 微任务队列。
- \`setImmediate\` 在 check 阶段执行，\`setTimeout(fn, 0)\` 在 timers 阶段执行；在主模块里两者顺序不确定，在 I/O 回调里 \`setImmediate\` 恒定先于 \`setTimeout\`。
- \`poll\` 阶段没有就绪 I/O 时会看是否有 \`setImmediate\`：有就去 check，没有就阻塞等待。
- 实际影响：大量同步计算会阻塞整个进程（不只是某个请求），CPU 密集任务必须交给 \`worker_threads\` 或子进程。`,
    track: "foundation",
    categoryId: "foundation-node",
    difficulty: "hard",
    tags: ["Node 22", "原理", "高频"],
    topic: "Node.js 事件循环",
    reviewedAt: "2026-11",
    heat: 88,
    updatedAt: "2026-11-01",
  },
  {
    id: "node-stream-backpressure",
    title: "流与背压（backpressure）",
    stem: "读写速度不匹配时会发生什么？pipe 如何自动处理背压？",
    answer: `- 可读流 \`push()\` 返回 \`false\` 表示内部缓冲已达 \`highWaterMark\`，此时必须**暂停生产**，等 \`drain\` 事件再继续。
- 可写流 \`write()\` 返回 \`false\` 同理，要继续写必须监听 \`drain\`；忽略返回值就会让内存持续上涨直到 OOM。
- \`pipe\` / \`pipeline\` 会自动处理暂停与恢复，并用 \`pipeline\` 才能正确传递错误与销毁所有流（\`pipe\` 的错误不会自动传播）。
- 四种流：Readable / Writable / Duplex / Transform；\`objectMode\` 允许传对象而非 Buffer。
- 典型用途：大文件读写、HTTP 请求体、日志采集、压缩与加密链（\`createGzip\` → \`createCipheriv\`）。`,
    track: "foundation",
    categoryId: "foundation-node",
    difficulty: "medium",
    tags: ["Node 22", "IO", "高频"],
    topic: "Node.js 流与背压",
    reviewedAt: "2026-11",
    heat: 76,
    updatedAt: "2026-11-14",
  },
  {
    id: "node-buffer",
    title: "Buffer 与 TypedArray 的关系",
    stem: "Buffer 是什么？为什么 Buffer 拼接要小心编码问题？",
    answer: `- \`Buffer\` 是 \`Uint8Array\` 的子类，底层是 **Node 管理的堆外内存**，分配在 V8 堆之外，因此不受 \`--max-old-space-size\` 限制但受系统内存约束。
- \`Buffer.from(str, 'utf8')\` 得到字节序列；\`toString('utf8')\` 反向解码。**多字节字符被切断**时会出现乱码（替代符 \`\\uFFFD\`），所以按块读取文本必须用 \`StringDecoder\` 或 stream 的 \`setEncoding\`。
- \`Buffer.concat\` 复制并合并；频繁拼接应改用数组收集后一次 concat，避免 O(n²)。
- \`Buffer.allocUnsafe\` 不擦除内存，性能更好但**可能泄露旧数据**，必须自己完整覆写；安全场景用 \`alloc\`。
- 大 Buffer 会长期占内存，处理完显式置空引用，避免被闭包持有。`,
    track: "foundation",
    categoryId: "foundation-node",
    difficulty: "basic",
    tags: ["Node 22", "基础", "IO"],
    topic: "Node.js Buffer 与内存",
    reviewedAt: "2026-11",
    heat: 62,
    updatedAt: "2026-11-09",
  },
  {
    id: "node-cluster-worker",
    title: "Cluster 与 worker_threads 怎么选",
    stem: "要压满多核 CPU，两种方案各自的代价是什么？",
    answer: `- **cluster**：起多个**进程**，各自有独立内存与事件循环，通过 IPC 或共享端口分发连接（round-robin），适合「横向扩 HTTP 服务」。
- **worker_threads**：同一进程内的**线程**，共享内存可用 \`SharedArrayBuffer\`，传消息用结构化克隆或 \`MessagePort\`，适合「单请求内的 CPU 密集计算」。
- 进程隔离带来稳定性（一个崩了不影响其他）但内存开销大（每个 worker 一份 V8 堆）；线程更轻但有共享状态风险。
- 实践：Web 服务用 cluster / PM2 / 容器副本；图像处理、加解密、大 JSON 解析用 worker_threads 池。
- 反例：把 \`JSON.parse\` 大文件丢给 cluster 反而更慢（进程间传输成本高于并行收益）。`,
    track: "foundation",
    categoryId: "foundation-node",
    difficulty: "medium",
    tags: ["Node 22", "并发", "架构"],
    topic: "Node.js 并发模型",
    reviewedAt: "2026-11",
    heat: 74,
    updatedAt: "2026-11-04",
  },
  {
    id: "node-fs-path",
    title: "fs/promises 与路径处理的常见坑",
    stem: "读取目录下所有文件并统计大小，怎么写更稳？path.join 与 path.resolve 有何区别？",
    answer: `- 一律用 \`node:fs/promises\`：\`await readdir(dir, { withFileTypes: true })\` 拿 \`Dirent\` 判断类型，避免再 \`stat\` 一次。
- \`path.join\` 只拼接并规范化；\`path.resolve\` 会**从右往左拼到绝对路径**（遇到绝对路径段就从那里开始）。跨平台用 \`path.sep\` 或干脆都用 \`join\`。
- 网络盘与大目录要控制并发：串行 \`for await\` 慢，\`Promise.all\` 全并行会打爆文件句柄，用并发池限 8-16。
- 错误处理区分 \`ENOENT\`（不存在，通常可忽略）与 \`EACCES\`（权限，必须报）；写文件用 \`{ flag: 'wx' }\` 防止意外覆盖。
- 大文件不要 \`readFile\` 全量读入，用 \`createReadStream\` 流式处理。`,
    track: "foundation",
    categoryId: "foundation-node",
    difficulty: "basic",
    tags: ["Node 22", "基础", "IO"],
    topic: "Node.js 文件系统",
    reviewedAt: "2026-11",
    heat: 56,
    updatedAt: "2026-11-02",
  },
  {
    id: "node-memory-diagnose",
    title: "Node 内存泄漏怎么定位",
    stem: "线上服务 RSS 持续上涨但堆快照看起来正常，可能是什么原因？",
    answer: `- 先分清**堆内**与**堆外**：\`process.memoryUsage()\` 的 \`heapUsed\` 反映 V8 堆，\`external\` / \`arrayBuffers\` 反映 Buffer 等堆外内存。RSS 涨而堆稳定，通常是大 Buffer 未释放或原生模块泄漏。
- 堆内泄漏常见源：全局 Map 只增不减、未移除的 EventEmitter 监听（\`setMaxListeners\` 警告就是信号）、闭包持有大对象、定时器未清理。
- 工具：\`--inspect\` + Chrome DevTools 的 heap snapshot 对比三次快照看增长；\`node --heap-prof\`；\`clinic\` / \`0x\` 看火焰图。
- 排查套路：先确认增长斜率是否与流量相关（缓存正常增长）还是与请求次数线性相关（泄漏）。
- 修复后要有回归监控：每 5 分钟采样内存并告警，避免同类问题复发。`,
    track: "foundation",
    categoryId: "foundation-node",
    difficulty: "hard",
    tags: ["Node 22", "性能", "线上问题"],
    topic: "Node.js 内存诊断",
    reviewedAt: "2026-11",
    heat: 70,
    updatedAt: "2026-11-13",
  },
  {
    id: "node-middleware",
    title: "Koa 洋葱模型与 Express 中间件差异",
    stem: "为什么 Koa 的中间件能「先进后出」？Express 能实现吗？",
    answer: `- Koa 的中间件是 **async 函数组合**：\`compose\` 把数组折成一个函数，\`await next()\` 之后的代码在响应阶段执行，形成洋葱圈。
- Express 的中间件靠 \`next\` 回调推进，没有「回来」的概念 —— 只能靠注册 \`res.on('finish')\` 之类的钩子近似实现，顺序与错误处理都更绕。
- 洋葱模型的价值：可以在进入时记录开始时间、退出时统一打日志/改响应头，天然的环绕逻辑。
- 错误处理差异：Koa 里 \`try { await next() } catch\` 能捕获下游所有异常；Express 必须写四参数错误中间件。
- 工程注意：中间件顺序即执行顺序（体解析 → 鉴权 → 路由 → 错误处理放最后），挂错位置是排查耗时最久的一类 bug。`,
    track: "foundation",
    categoryId: "foundation-node",
    difficulty: "medium",
    tags: ["Node 22", "服务端", "架构"],
    topic: "Node.js 中间件模型",
    reviewedAt: "2026-11",
    heat: 66,
    updatedAt: "2026-11-07",
  },
  {
    id: "node-service-security",
    title: "Node 服务的安全要点",
    stem: "一个对外暴露的 Node 接口服务，你会做哪些防护？",
    answer: `- **输入校验**：所有入参走 schema 校验（zod/joi），不信任任何客户端数据；SQL 用参数化查询防注入。
- **认证与授权**：JWT 注意签名算法固定与过期时间，敏感操作二次校验；接口级鉴权别只做前端隐藏。
- **限流与防刷**：按 IP + 用户维度限流（令牌桶），登录接口单独加严并防暴力破解。
- **依赖安全**：\`npm audit\` / Dependabot 常态化，锁文件入库，禁止安装来路不明的包（供应链投毒是当前主要风险）。
- **运行时收敛**：不把 \`error.stack\` 返回给客户端、生产关掉 \`NODE_OPTIONS=--inspect\`、设置 \`helmet\` 类响应头、超时与请求体大小上限。
- 日志脱敏：手机号、token 一律打码，避免日志成为泄漏源。`,
    track: "foundation",
    categoryId: "foundation-node",
    difficulty: "medium",
    tags: ["Node 22", "安全", "服务端"],
    topic: "Node.js 服务安全",
    reviewedAt: "2026-11",
    heat: 64,
    updatedAt: "2026-11-01",
  },
  {
    id: "node-cli-tooling",
    title: "写一个 Node CLI 要注意什么",
    stem: "从 bin 配置到参数解析、退出码与流式输出，说明一个健壮 CLI 的结构。",
    answer: `- \`package.json\` 的 \`bin\` 字段指向带 shebang（\`#!/usr/bin/env node\`）的入口，并确保文件有可执行权限。
- 参数解析用 \`node:util\` 的 \`parseArgs\`（Node 18+ 内置）或 commander，别手写 \`process.argv\` 切分。
- **输出分层**：正常结果走 \`stdout\`（可被管道消费），日志与错误走 \`stderr\`；需要机器可读时提供 \`--json\`。
- **退出码**：成功 0，失败非 0，并 \`process.exitCode\` 而不是直接 \`process.exit\`（后者会截断未刷新的输出）。
- 交互与信号：监听 \`SIGINT\` 做清理；进度条之类用 TTY 判断，非 TTY 环境退化为逐行输出。`,
    track: "foundation",
    categoryId: "foundation-node",
    difficulty: "basic",
    tags: ["Node 22", "工具链", "基础"],
    topic: "Node.js 命令行工具",
    reviewedAt: "2026-11",
    heat: 52,
    updatedAt: "2026-11-02",
  },
  {
    id: "node-graceful-shutdown",
    title: "优雅停机与超时控制",
    stem: "发布时如何保证不丢请求？长连接与 keep-alive 怎么处理？",
    answer: `- 收到 \`SIGTERM\` 后：**先停止接受新连接**（\`server.close()\`），再等存量请求完成，超过宽限期强制退出。
- \`server.close()\` 不会关闭 keep-alive 的空闲连接，需要 \`server.closeIdleConnections()\`（Node 18.2+）或自己记录 socket 并 \`destroy\`。
- 反向代理层配合：K8s 的 \`preStop\` + \`terminationGracePeriodSeconds\`，或 Nginx 先把该实例摘出上游，再发信号。
- 超时链要逐层设置：客户端超时 > 网关超时 > 服务处理超时，否则会出现「上游以为成功、下游还在跑」。
- 关闭顺序：停止接流 → 等待在途请求 → 关闭数据库/Redis 连接 → 刷新日志与监控，任一步骤缺失都会表现为发布期间的零星 502。`,
    track: "foundation",
    categoryId: "foundation-node",
    difficulty: "hard",
    tags: ["Node 22", "运维", "线上问题"],
    topic: "Node.js 优雅停机",
    reviewedAt: "2026-11",
    heat: 68,
    updatedAt: "2026-11-01",
  },
];
