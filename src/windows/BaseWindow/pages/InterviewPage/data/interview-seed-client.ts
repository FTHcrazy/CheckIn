/**
 * 题库 · 移动端与跨端、小程序、浏览器原理。
 *
 * 三块内容共享一条主线：**运行环境的约束决定方案**（屏幕/手势、双线程、渲染管线）。
 */
import type { InterviewQuestion } from "./interview-types";

export const SEED_CLIENT: readonly InterviewQuestion[] = [
  // ── 移动端与跨端 ───────────────────────────────────────────
  {
    id: "mobile-viewport-adapt",
    title: "H5 适配方案：viewport、rem 与 vw",
    stem: "设计稿 750px 宽，如何在 320-430px 的各种机型上等比还原？",
    answer: `- 三件套：\`<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\`，禁止用 \`user-scalable=no\`（可访问性问题）。
- **vw 方案**（当前主流）：\`1vw = 视口宽度 1%\`，配合 postcss 把设计稿 px 自动折算成 vw，无需 JS 运行时。
- **rem 方案**：动态设置根字号（\`html { font-size: vw 换算 }\` 或 flexible.js），优点是能保留「字号可调」的能力。
- 关键细节：字号要设下限（正文不小于 12px，用 \`clamp\` 或媒体查询兜住），避免小屏上等比缩小到不可读；\`100vh\` 换 \`100dvh\`；刘海屏用 \`env(safe-area-inset-*)\`。
- 大屏「两端留白」问题：等比放大到 iPad 会糊，通常配 \`max-width\` + 居中容器。`,
    track: "foundation",
    categoryId: "foundation-mobile",
    difficulty: "medium",
    tags: ["移动端", "适配", "高频"],
    topic: "移动端适配方案",
    reviewedAt: "2026-11",
    heat: 82,
    updatedAt: "2026-11-06",
  },
  {
    id: "mobile-1px-border",
    title: "高清屏 1px 边框为什么要特殊处理",
    stem: "DPR=3 的机型上 border: 1px 为什么会变粗？有哪些实现方式？",
    answer: `- CSS 的 \`1px\` 是**逻辑像素**，在 DPR=3 的设备上会渲染成 3 个物理像素，视觉上比设计稿粗。
- 方案一：\`transform: scaleY(0.5)\` 伪元素（\`::after\` 画 1px 线再缩放），兼容性好，注意 \`transform-origin\`。
- 方案二：\`box-shadow: 0 0 0 0.5px\` 或 \`outline\`，实现简单但圆角表现一般。
- 方案三：直接写 \`0.5px\`，现代浏览器在 DPR≥2 的设备上支持，但不保证在所有 Android 上生效。
- 现代趋势：移动端设计已大量改用「1px 线 + 浅色」表达分隔，或用 \`border-bottom\` 的 1 物理像素替代，减少这类 hack。`,
    track: "foundation",
    categoryId: "foundation-mobile",
    difficulty: "basic",
    tags: ["移动端", "CSS", "基础"],
    topic: "移动端高清屏适配",
    reviewedAt: "2026-11",
    heat: 70,
    updatedAt: "2026-10-24",
  },
  {
    id: "mobile-touch-events",
    title: "移动端事件：300ms 延迟、点击穿透与手势",
    stem: "为什么要用 fastclick？点击穿透是怎么产生的？如何做拖拽与滑动判定？",
    answer: `- 300ms 延迟源自早期「双击缩放」判断；设置 \`width=device-width\` 的 viewport 后现代浏览器已基本移除，历史方案是 FastClick 或 \`touch-action: manipulation\`。
- **点击穿透**：上层遮罩用 \`touchstart\` 关闭后，同一次触摸的 \`click\` 落到下层元素上。解法是关闭时机改用 \`touchend\` 并 \`preventDefault\`，或延迟 300ms 再隐藏。
- 手势判定：记录 \`touchstart\` 的坐标与时间，\`touchmove\` 里算位移与方向，配合阈值（如 10px）区分点击与滑动，避免误触。
- \`touchmove\` 里 \`preventDefault\` 会阻止滚动，需在监听时声明 \`{ passive: false }\`；能用 \`touch-action\` 交给浏览器就别拦。
- 现在更推荐 Pointer Events（\`pointerdown/move/up\`），一套代码同时覆盖鼠标、触摸与手写笔。`,
    track: "foundation",
    categoryId: "foundation-mobile",
    difficulty: "medium",
    tags: ["移动端", "事件", "高频"],
    topic: "移动端交互与事件",
    reviewedAt: "2026-11",
    heat: 74,
    updatedAt: "2026-11-06",
  },
  {
    id: "mobile-hybrid-jsbridge",
    title: "Hybrid 与 JSBridge 的通信实现",
    stem: "H5 页面如何调用原生能力？双向通信怎么保证不丢消息？",
    answer: `- 原生 → H5：\`evaluateJavascript\` / \`WKWebView\` 的 \`evaluateJavaScript\` 直接注入调用。
- H5 → 原生：两种主流方式 —— **注入对象**（Android \`addJavascriptInterface\`、iOS \`WKScriptMessageHandler\`）与 **URL Scheme 拦截**（\`iframe.src = "app://action?params"\`，兼容老 WebView 但有长度限制与并发问题）。
- 回调配对：每次调用生成唯一 \`callbackId\`，把 resolve/reject 存进 Map，原生回传时带上 id 找到对应回调。
- 可靠性：一次性的 \`iframe\` 在低端机上会丢，需要队列 + 超时重试；页面切换时要清理未完成的回调避免泄漏。
- 安全：只允许白名单方法名，参数做类型校验，绝不允许 H5 直接调用任意原生方法。`,
    track: "foundation",
    categoryId: "foundation-mobile",
    difficulty: "medium",
    tags: ["Hybrid", "移动端", "架构"],
    topic: "Hybrid 与 JSBridge",
    reviewedAt: "2026-11",
    heat: 68,
    updatedAt: "2026-11-12",
  },
  {
    id: "mobile-rn-architecture",
    title: "React Native 的新架构解决了什么",
    stem: "旧架构的 Bridge 有什么瓶颈？JSI、Fabric、TurboModules 各自解决什么？",
    answer: `- 旧架构所有 JS 与原生通信都要**序列化成 JSON 走异步 Bridge**：批量排队、无法同步调用、大列表滚动时通信量爆炸导致掉帧。
- **JSI**：让 JS 直接持有 C++ HostObject 并同步调用，去掉 JSON 序列化；这是新架构的地基。
- **TurboModules**：原生模块按需懒加载（旧架构启动时全量初始化），配合代码生成保证类型一致。
- **Fabric**：新渲染器，支持**同步测量与并发渲染**，与 React 18 的并发特性对齐，减少白屏与布局跳变。
- 结果：启动更快、滚动更稳、支持同步读取原生能力（如尺寸测量），代价是原生侧改造成本与第三方库兼容性迁移。`,
    track: "foundation",
    categoryId: "foundation-mobile",
    difficulty: "hard",
    tags: ["React Native", "跨端", "原理"],
    topic: "React Native 架构演进",
    reviewedAt: "2026-11",
    heat: 66,
    updatedAt: "2026-10-26",
  },
  {
    id: "mobile-flutter-vs-rn",
    title: "Flutter 与 React Native 的渲染差异",
    stem: "为什么 Flutter 的 UI 一致性更好？代价是什么？",
    answer: `- Flutter **自己实现渲染**：Skia/Impeller 直接画到 Surface，不依赖平台原生控件，因此三端像素级一致，也绕过了原生控件的版本差异。
- RN 最终**映射到原生控件**（View/Text），一致性依赖平台，但天然获得原生手感与可访问性。
- 代价：Flutter 包体更大（引擎约数 MB）、与原生控件混排成本高、Dart 生态与前端团队技能栈不同；RN 则受原生能力与桥接限制。
- 选择依据：设计强一致 + 复杂自绘动画 → Flutter；需要深度复用原生能力、团队是前端栈 → RN。
- 追问：两者都支持 JS/Dart 侧热更新受限（App Store 政策），动态化需求仍要靠 H5 或自研方案。`,
    track: "foundation",
    categoryId: "foundation-mobile",
    difficulty: "hard",
    tags: ["跨端", "Flutter", "架构"],
    topic: "跨端框架对比",
    reviewedAt: "2026-11",
    heat: 62,
    updatedAt: "2026-10-31",
  },
  {
    id: "mobile-cross-platform-choice",
    title: "跨端方案怎么选：Taro、uni-app、Flutter",
    stem: "需求是一套代码同时上微信小程序、H5 和 App，说明评估维度与结论。",
    answer: `- 先看**渠道权重**：小程序为主 → Taro / uni-app（能编译到小程序）；App 体验为主 → RN / Flutter；三者都要且预算有限 → 小程序 + H5 用同一套，App 用 WebView 容器起步。
- 关键评估项：目标平台覆盖度、组件生态成熟度、性能上限（列表与动画）、调试体验、团队技能、长期维护活跃度。
- 混合策略往往更现实：核心交互用原生/RN，运营页用 H5 动态下发，兼顾体验与迭代速度。
- 风险点：跨端框架对平台新特性（如小程序 Skyline、鸿蒙 ArkTS）支持有滞后，关键业务要预留降级方案。
- 鸿蒙原生（ArkTS）是 2025 之后新增的现实约束，评估时必须确认框架是否已支持。`,
    track: "foundation",
    categoryId: "foundation-mobile",
    difficulty: "medium",
    tags: ["跨端", "架构", "2025"],
    topic: "跨端方案选型",
    reviewedAt: "2026-11",
    heat: 64,
    updatedAt: "2026-10-28",
  },

  // ── 小程序 ─────────────────────────────────────────────────
  {
    id: "mp-dual-thread",
    title: "小程序的双线程模型",
    stem: "逻辑层与渲染层如何分工？为什么 setData 是性能瓶颈？",
    answer: `- **逻辑层（JSCore/AppService）** 跑 JS 与业务逻辑，**渲染层（WebView）** 负责渲染；两层通过**消息通道**通信，不能直接操作 DOM。
- 因此每次 \`setData\` 都是「序列化 + 跨线程传输 + 渲染层 diff」三步，数据量越大越慢，1MB 以上会明显卡顿（官方限制单次 1MB）。
- 这也解释了为什么小程序里没有 DOM API、\`document\` 不存在，以及为什么频繁 setData 会造成掉帧。
- Skyline 引擎改变了这一点：它用自定义渲染器替代 WebView，逻辑与渲染仍分离但帧同步更高效。
- 追问：\`setData\` 的回调在渲染完成后触发，可用于测量，但不要在其中继续 setData。`,
    track: "foundation",
    categoryId: "foundation-miniprogram",
    difficulty: "medium",
    tags: ["小程序", "原理", "高频"],
    topic: "小程序双线程模型",
    reviewedAt: "2026-11",
    heat: 84,
    updatedAt: "2026-10-22",
  },
  {
    id: "mp-setdata-optimize",
    title: "setData 的性能优化手段",
    stem: "长列表滚动卡顿，列出至少四种 setData 优化方式。",
    answer: `- **减少数据量**：只传变化的字段，用路径写法 \`setData({ 'list[3].title': x })\` 而不是整个 \`list\`。
- **合并调用**：同步代码块里的多次 setData 会合并，但跨异步回调不会 —— 把同帧内的更新手动收拢。
- **避免无变更**：值没变就别 setData（框架仍会走一遍传输）；派生数据用 \`wxs\`/计算属性在渲染层算。
- **分页与虚拟列表**：只渲染可视区，配合 \`recycle-view\` / \`scroll-view\` 的 \`lazyCodeLoading\`。
- **图片与节点**：长列表图片用 \`lazy-load\` + 固定尺寸占位，避免高度抖动触发布局重算；减少嵌套自定义组件层级。`,
    track: "foundation",
    categoryId: "foundation-miniprogram",
    difficulty: "medium",
    tags: ["小程序", "性能", "高频"],
    topic: "小程序 setData 优化",
    reviewedAt: "2026-11",
    heat: 80,
    updatedAt: "2026-11-08",
  },
  {
    id: "mp-subpackage",
    title: "小程序分包与加载策略",
    stem: "主包 2MB 限制怎么绕？分包、独立分包与分包预下载分别适合什么场景？",
    answer: `- 主包只放 tabBar 页面与公共资源，其余按业务拆**分包**（单个分包上限 2MB，总包 20MB）。
- **独立分包**不依赖主包即可运行（适合广告页、分享落地页），但不能引用主包资源。
- **分包预下载**（\`preloadRule\`）在进入某页面时提前拉取下一个包，用网络时间换跳转体验，注意只在 Wi-Fi 或按需开启。
- 公共库与组件要**下沉到主包或抽独立分包**，否则多个分包重复打包会让总体积翻倍。
- 其它手段：\`lazyCodeLoading: requiredComponents\` 按需注入、图片走 CDN 而不是打进包内、大 JSON 拆分为接口下发。`,
    track: "foundation",
    categoryId: "foundation-miniprogram",
    difficulty: "medium",
    tags: ["小程序", "性能", "工程化"],
    topic: "小程序分包",
    reviewedAt: "2026-11",
    heat: 72,
    updatedAt: "2026-11-16",
  },
  {
    id: "mp-login-flow",
    title: "小程序登录流程",
    stem: "从 wx.login 到拿到业务 token，完整链路是什么？为什么不能只用 code？",
    answer: `- 前端 \`wx.login()\` 拿到临时 **code**（5 分钟有效、一次性），连同业务参数发给自己的服务端。
- 服务端用 \`code + appid + secret\` 调 \`code2Session\` 换 \`openid\` / \`unionid\` / \`session_key\`，**secret 绝不能出现在前端**。
- 服务端签发自己的 token（JWT 或 session）返回前端，后续请求带 token；不要直接把 \`session_key\` 给前端。
- 需要手机号时用 \`getPhoneNumber\` 的加密数据在服务端解密；需要用户信息用 \`button open-type="chooseAvatar"\` 新接口。
- 注意：\`code\` 只能用一次，重复使用会失败；token 过期要静默重登（\`checkSession\` 或直接重新 login）。`,
    track: "foundation",
    categoryId: "foundation-miniprogram",
    difficulty: "basic",
    tags: ["小程序", "登录", "高频"],
    topic: "小程序登录鉴权",
    reviewedAt: "2026-11",
    heat: 78,
    updatedAt: "2026-11-08",
  },
  {
    id: "mp-lifecycle",
    title: "小程序生命周期与页面栈",
    stem: "应用级、页面级、组件级生命周期分别有哪些？页面栈深度限制是多少？",
    answer: `- **应用级**：\`onLaunch\` → \`onShow\` → \`onHide\`；\`onLaunch\` 里拿不到页面实例，取数要放 \`onShow\` 或做就绪等待。
- **页面级**：\`onLoad\`（只一次，取参）→ \`onShow\` → \`onReady\`（首次渲染完成，可操作节点）→ \`onHide\` → \`onUnload\`。
- **组件级**：\`created\` / \`attached\` / \`ready\` / \`detached\`（对应 Vue 的 created/mounted/unmounted 心智）。
- 页面栈上限 **10 层**，超出后 \`navigateTo\` 会失败，因此深层跳转要用 \`redirectTo\` 或 \`reLaunch\`，返回用 \`navigateBack\`。
- 常见坑：\`onShow\` 里重复请求导致列表翻倍刷新；\`onUnload\` 忘记清理定时器；\`onReady\` 之前 \`createSelectorQuery\` 拿不到节点。`,
    track: "foundation",
    categoryId: "foundation-miniprogram",
    difficulty: "basic",
    tags: ["小程序", "基础"],
    topic: "小程序生命周期",
    reviewedAt: "2026-11",
    heat: 66,
    updatedAt: "2026-10-31",
  },
  {
    id: "mp-skyline",
    title: "Skyline 渲染引擎与 WebView 的差别",
    stem: "Skyline 解决了什么老问题？迁移时要注意什么？",
    answer: `- 旧的 WebView 渲染受限于浏览器排版与两层通信，长列表与复杂动画容易出现掉帧与滚动不同步。
- **Skyline** 是自研渲染引擎：直接与逻辑层做帧同步，工作线程渲染、支持更细粒度的节点更新，滚动与动画流畅度显著提升。
- 能力边界不同：部分 WXSS 特性与旧组件在 Skyline 下不支持（如某些 \`position: fixed\` 行为、web-view 场景受限），需要按官方兼容清单排查。
- 迁移方式：按页面开启（\`renderer: "skyline"\`），不要一次全量切换；重点回归滚动容器、吸顶、动画与自定义组件。
- 判断依据：长列表/强交互页面收益最大，展示型静态页收益有限但改造风险同样存在。`,
    track: "foundation",
    categoryId: "foundation-miniprogram",
    difficulty: "hard",
    tags: ["小程序", "2025", "原理"],
    topic: "小程序 Skyline 渲染",
    reviewedAt: "2026-11",
    heat: 58,
    updatedAt: "2026-11-13",
  },
  {
    id: "mp-payment-flow",
    title: "小程序支付流程与常见失败原因",
    stem: "描述下单到支付成功的完整链路，以及支付回调为什么必须幂等。",
    answer: `- 前端调服务端「下单」→ 服务端调统一下单拿到 \`prepay_id\` → 签名后返回前端 → \`wx.requestPayment\` 唤起支付。
- 支付结果以**服务端收到的支付回调**为准，前端 \`success\` 只能用于即时 UI 反馈，不能作为发货依据。
- 回调必须**幂等**：微信会重复推送同一条通知，按订单号 + 状态判断，处理成功必须返回 200 且格式正确，否则会持续重试。
- 常见失败：签名错误（参数排序/编码）、\`prepay_id\` 过期（2 小时）、金额单位用错（分 vs 元）、openid 与 appid 不匹配。
- 兜底：前端支付后主动轮询订单状态，避免回调延迟导致用户看到「已付款但未开通」。`,
    track: "foundation",
    categoryId: "foundation-miniprogram",
    difficulty: "medium",
    tags: ["小程序", "支付", "服务端"],
    topic: "小程序支付",
    reviewedAt: "2026-11",
    heat: 70,
    updatedAt: "2026-11-01",
  },

  // ── 浏览器原理 ─────────────────────────────────────────────
  {
    id: "browser-render-pipeline",
    title: "浏览器的渲染管线",
    stem: "从 HTML 字节流到屏幕上的一帧，经历了哪些阶段？哪些阶段可以并行？",
    answer: `- 关键路径：**解析 HTML → 构建 DOM → 样式计算（CSSOM）→ 布局（layout）→ 绘制（paint）→ 分层 → 合成（composite）**。
- 主线程负责 JS、样式、布局；**绘制与合成可以下放到合成线程 / GPU**（分块光栅化、瓦片上传），因此滚动与 transform 动画能在主线程繁忙时仍然流畅。
- 阻塞点：\`<script>\` 同步执行会阻塞解析（用 defer/async 规避）、CSS 会阻塞渲染但不阻塞解析、字体加载会触发 FOIT/FOUT。
- 帧预算：60fps 下每帧只有 **16.7ms**，其中留给 JS 的时间更少，长任务（>50ms）就会掉帧。
- 追问：\`content-visibility: auto\` 可以跳过屏幕外内容的渲染，是长页面的有效优化。`,
    track: "foundation",
    categoryId: "foundation-browser",
    difficulty: "hard",
    tags: ["浏览器", "原理", "大厂"],
    topic: "浏览器渲染管线",
    reviewedAt: "2026-11",
    heat: 88,
    updatedAt: "2026-11-12",
  },
  {
    id: "browser-reflow-repaint",
    title: "重排与重绘：哪些操作代价最高",
    stem: "列出会触发重排的属性，并说明如何避免「读写交替」造成的布局抖动。",
    answer: `- **重排（layout）**：改几何属性（\`width/height/padding/margin/top/left/font-size\`）、增删 DOM、读取 \`offsetTop\`/\`getBoundingClientRect\` 等触发强制同步布局。
- **重绘（paint）**：只改外观（\`color/background/visibility\`）时不必重排，代价次之。
- **布局抖动（layout thrashing）**：循环里「读 → 写 → 读」会强制每次写后重新布局，帧耗时成倍上升。
- 解法：批量读（先收集所有测量值）再批量写；用 \`requestAnimationFrame\` 集中更新；用 \`FastDOM\` 之类调度器。
- 终极手段：把动画交给 \`transform/opacity\`（只走合成），或用 \`position: absolute\` / \`contain\` 隔离影响范围。`,
    track: "foundation",
    categoryId: "foundation-browser",
    difficulty: "medium",
    tags: ["浏览器", "性能", "高频"],
    topic: "浏览器渲染性能",
    reviewedAt: "2026-11",
    heat: 84,
    updatedAt: "2026-10-31",
  },
  {
    id: "browser-v8-gc",
    title: "V8 的垃圾回收与内存分代",
    stem: "新生代与老生代分别用什么算法？什么是增量标记与三色标记？",
    answer: `- 分代假设：绝大多数对象**朝生夕死**。新生代（\`Scavenge\`）用两个 semispace 复制存活对象，代价与存活量成正比；对象晋升到老生代后改用**标记-清除 / 标记-压缩**。
- **三色标记**：白（未访问）、灰（自身已标记、子节点待处理）、黑（已完成）；写屏障记录新增引用，避免漏标。
- **增量标记 / 并发标记**把一次长暂停切成小段，减少卡顿；老生代压缩会移动对象，需要更新引用。
- 内存限制（64 位约 4GB 堆）来自 GC 停顿与内存占用的权衡，可通过 \`--max-old-space-size\` 调整。
- 前端实践：减少长生命周期缓存、及时解绑引用、避免创建大量短命闭包，能显著降低 GC 压力。`,
    track: "foundation",
    categoryId: "foundation-browser",
    difficulty: "hard",
    tags: ["浏览器", "原理", "V8"],
    topic: "V8 垃圾回收",
    reviewedAt: "2026-11",
    heat: 72,
    updatedAt: "2026-11-10",
  },
  {
    id: "browser-input-to-paint",
    title: "从点击到下一帧：输入事件的完整路径",
    stem: "点击事件为什么可能延迟一帧？passive 监听与合成线程有什么关系？",
    answer: `- 触摸/滚动先在**合成线程**命中测试并可能直接产生滚动，不必等主线程；但滚动监听若未声明 \`passive\`，浏览器必须等主线程确认是否 \`preventDefault\`，于是滚动被拖慢。
- 点击类事件（\`click\`/\`pointerdown\`）要等主线程空闲才能派发，所以主线程有长任务时会「点不动」。
- 一次交互到下一帧的顺序大致是：输入事件 → 事件回调（可能触发样式/布局）→ rAF 回调 → 样式/布局 → 绘制 → 合成提交。
- 优化：交互回调只做最小状态更新，重活拆到 rAF 或 \`scheduler.postTask\`；\`isInputPending\` / \`scheduler.yield\` 可以主动让出主线程。
- 追问：INP（Interaction to Next Paint）已取代 FID 成为 Core Web Vitals 的响应性指标，衡量的正是这条路径。`,
    track: "foundation",
    categoryId: "foundation-browser",
    difficulty: "hard",
    tags: ["浏览器", "性能", "2025"],
    topic: "浏览器输入与帧调度",
    reviewedAt: "2026-11",
    heat: 70,
    updatedAt: "2026-10-23",
  },
  {
    id: "browser-cache",
    title: "浏览器缓存：强缓存与协商缓存",
    stem: "Cache-Control 与 ETag 分别怎么配合？为什么入口 HTML 不能长缓存？",
    answer: `- **强缓存**：\`Cache-Control: max-age\` / \`immutable\`，命中则不请求服务器（\`from disk/memory cache\`）。
- **协商缓存**：\`ETag/If-None-Match\` 或 \`Last-Modified/If-Modified-Since\`，请求到服务器但可返回 304 省流量。
- 组合策略：**文件名带 hash 的静态资源**用 \`max-age=31536000, immutable\`；**HTML 入口**用 \`no-cache\`（可缓存但每次校验），否则发版后用户拿到旧入口指向已删除的资源。
- \`no-store\` 才是完全不缓存，常用于含敏感信息的接口；\`must-revalidate\` 表示过期后必须校验。
- 刷新语义差异：普通刷新会带条件请求（走协商），强制刷新（Ctrl+F5）跳过缓存。`,
    track: "foundation",
    categoryId: "foundation-browser",
    difficulty: "medium",
    tags: ["浏览器", "缓存", "高频"],
    topic: "浏览器缓存策略",
    reviewedAt: "2026-11",
    heat: 86,
    updatedAt: "2026-11-07",
  },
  {
    id: "browser-same-origin",
    title: "同源策略与跨域方案",
    stem: "同源策略限制了什么？CORS 预检在什么情况下触发？",
    answer: `- 同源 = 协议 + 域名 + 端口三者一致；限制的是**读取响应**（不是发送请求），所以简单请求能发出去但结果读不到。
- **CORS**：服务端返回 \`Access-Control-Allow-Origin\` 等头；非简单请求（自定义头、PUT/DELETE、\`application/json\`）会先发 \`OPTIONS\` 预检。
- 带 Cookie 的请求需要 \`credentials: 'include'\` + 服务端 \`Allow-Credentials: true\`，且 \`Allow-Origin\` **不能用 \`*\`**。
- 其它方案：开发期用代理（vite \`server.proxy\`）、生产用同域反向代理、\`postMessage\` 做跨窗口通信；\`document.domain\` 已废弃。
- 理解要点：跨域是**浏览器**的安全机制，服务端之间调用不受限，所以「后端转发」永远是最稳的方案。`,
    track: "foundation",
    categoryId: "foundation-browser",
    difficulty: "medium",
    tags: ["浏览器", "跨域", "高频"],
    topic: "同源策略与跨域",
    reviewedAt: "2026-11",
    heat: 85,
    updatedAt: "2026-10-23",
  },
  {
    id: "browser-worker",
    title: "Web Worker 的能力边界",
    stem: "Worker 里能做什么、不能做什么？如何与主线程高效通信？",
    answer: `- 能做：纯计算、大 JSON 解析、加解密、图像处理、\`fetch\`、IndexedDB；**不能**访问 DOM、\`window\`、\`localStorage\`。
- 通信用 \`postMessage\` + \`onmessage\`，数据走**结构化克隆**（大对象有拷贝成本）；用 \`Transferable\`（如 ArrayBuffer）可零拷贝转移所有权。
- \`SharedArrayBuffer\` 支持真正共享内存，但需要 COOP/COEP 响应头开启跨源隔离。
- 并行计算要建 **Worker 池**，每个 Worker 常驻复用；频繁创建销毁的启动成本比计算本身还高。
- 与主线程的关系是「异步 + 独立事件循环」：Worker 卡住不会冻结 UI，但也拿不到实时 DOM 尺寸。`,
    track: "foundation",
    categoryId: "foundation-browser",
    difficulty: "basic",
    tags: ["浏览器", "基础", "并发"],
    topic: "Web Worker",
    reviewedAt: "2026-11",
    heat: 64,
    updatedAt: "2026-11-09",
  },
  {
    id: "browser-storage-quota",
    title: "浏览器存储配额与清理策略",
    stem: "localStorage 满了会怎样？如何申请持久化存储？",
    answer: `- \`localStorage\` 通常 5MB 左右，超出时 \`setItem\` 抛 \`QuotaExceededError\`，必须 try/catch 并降级（改存内存或提示用户清理）。
- \`IndexedDB\` 走「源配额」体系，容量按磁盘与浏览器策略浮动（常见为可用磁盘的一定比例），\`navigator.storage.estimate()\` 可查询。
- 浏览器在磁盘紧张时会按「最近最少使用」清理整个源的存储，重要数据应调用 \`navigator.storage.persist()\` 申请持久化（可能被拒绝）。
- \`Cache API\` 与 Service Worker 缓存也计入同一配额，离线资源要能在版本升级时主动清理旧缓存。
- 实践：本地只存可再生数据 + 一个「待同步队列」，真正的持久化交给服务端。`,
    track: "foundation",
    categoryId: "foundation-browser",
    difficulty: "basic",
    tags: ["浏览器", "存储", "基础"],
    topic: "浏览器存储配额",
    reviewedAt: "2026-11",
    heat: 56,
    updatedAt: "2026-10-26",
  },
];
