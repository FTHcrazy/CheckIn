/**
 * 题库 · React 进阶（2025-2026 面试高频的第二层问题）。
 *
 * 与 `interview-seed-framework.ts` 里的 React 基础题分开：那一组回答「是什么」，
 * 这一组回答「为什么这样设计、什么时候会踩坑、上线后怎么定位」。
 */
import type { InterviewQuestion } from "./interview-types";

export const SEED_REACT_PLUS: readonly InterviewQuestion[] = [
  {
    id: "react-lanes-priority",
    title: "React 的优先级模型：Lane 与「饥饿」是怎么处理的",
    stem: "并发模式下多个更新同时进来，React 靠什么决定先渲染谁？低优先级更新会不会永远排不上？",
    answer: `- 优先级用 \`Lane\` 表示：31 位 bitmask（每个 bit 是一条车道），一次更新占一个或多个 lane，多个更新可以合并成 \`lanes\` 一次性渲染。
- 同步更新（离散事件、\`flushSync\`）走 \`SyncLane\`，连续输入与 transition 走更低的 lane；render 时按 lane 从高到低挑任务。
- **防饥饿**靠过期时间：每个 lane 有 \`expirationTime\`，等待超过阈值就被提升为同步优先级强制执行，不会因为一直有更高优先级插队而饿死。
- 代价是**可能重复渲染**：低优先级任务被高优先级打断后要重新开始（render 阶段必须无副作用才安全）。
- 业务上别滥用 \`useTransition\`：把输入框的受控更新也包进 transition 会让输入卡顿（受控值必须同步），transition 只包「由输入派生的重渲染」。`,
    track: "foundation",
    categoryId: "foundation-react",
    difficulty: "hard",
    tags: ["React", "原理", "并发", "2026"],
    topic: "React 并发渲染 · 优先级调度",
    reviewedAt: "2026-11",
    heat: 86,
    updatedAt: "2026-11-14",
  },
  {
    id: "react-stale-closure",
    title: "Hooks 里的闭包陷阱：为什么定时器一直读到旧值",
    stem: "在 useEffect 里启动 setInterval 读 state，为什么永远拿到初始值？给出三种正确解法并比较取舍。",
    answer: `- 每次渲染都会创建**新的函数作用域**，effect 捕获的是**那一次渲染的 state**；空依赖数组让 effect 只跑一次，闭包就永久定格在首次渲染的值。
- **解法一：补依赖**。把 state 放进依赖数组，effect 重跑并重建定时器；缺点是有重建成本，必须在 cleanup 里 clearInterval。
- **解法二：函数式更新**。\`setCount((previous) => previous + 1)\` 不读闭包里的值，天然免疫。
- **解法三：ref 镜像**。\`const latest = useRef(count); latest.current = count;\` 定时器读 \`latest.current\`；适合「不想重建副作用、又要读最新值」的场景（如埋点、长连接回调）。
- React 19.2 起可用 \`useEffectEvent\`：把「读最新值但不作为依赖」的逻辑单独抽出，官方语义上比 ref 镜像更清晰。
- 判断标准：**值要触发副作用重建** → 进依赖；**只要最新值** → ref / 函数式更新。`,
    track: "foundation",
    categoryId: "foundation-react",
    difficulty: "hard",
    tags: ["React", "Hooks", "高频"],
    topic: "React Hooks · 闭包与依赖",
    reviewedAt: "2026-11",
    heat: 90,
    updatedAt: "2026-11-13",
  },
  {
    id: "react-virtual-list",
    title: "虚拟列表的实现原理，动态高度怎么处理",
    stem: "一万条数据的列表要在 React 里流畅滚动，说说你会怎么做，以及动态行高带来的难点。",
    answer: `- 核心是三件事：**可视区计算**（\`scrollTop\` + 容器高度 → 起始/结束索引）、**只渲染可视区 + overscan**、**用撑高的占位元素**保证滚动条长度正确（\`transform: translateY\` 或 padding 顶部偏移）。
- 定高最简单：\`index * itemHeight\` 直接映射位置，二分查找起点即可。
- 动态高度需要**测量 + 位置缓存**：先用估算值渲染，\`ResizeObserver\` 量到真实高度后写入缓存并修正后续偏移；已滚过的区域高度变化会导致跳动，要按「锚点行」补偿 scrollTop。
- 性能细节：滚动事件用 \`requestAnimationFrame\` 节流、\`will-change: transform\`、避免在滚动中触发 React 全量 diff（把行做成 \`memo\`，列表项 key 必须稳定）。
- 不要自己造轮子做通用组件：\`@tanstack/react-virtual\` 已经处理了动态测量与锚点修正，自研只在行高固定或结构极简时划算。`,
    track: "foundation",
    categoryId: "foundation-react",
    difficulty: "medium",
    tags: ["React", "性能", "大厂"],
    topic: "长列表渲染 · 虚拟滚动",
    reviewedAt: "2026-11",
    heat: 84,
    updatedAt: "2026-11-12",
  },
  {
    id: "react-scheduler-slice",
    title: "时间切片为什么用 MessageChannel 而不是 setTimeout",
    stem: "React 的 Scheduler 怎么把长任务切开？它为什么不用 setTimeout 或 requestIdleCallback 调度？",
    answer: `- 切片 = 把协调工作拆成 5ms 左右的小任务，每片结束检查是否该让出主线程（\`shouldYield\`：是否超时、是否有更高优先级）。
- **不用 setTimeout**：嵌套超过 5 层后浏览器会强制最小 4ms 延迟，切片粒度被拖到 4ms 以上，调度精度不够。
- **不用 requestIdleCallback**：触发时机不可控（空闲才执行），低优先级任务可能长时间不执行，且 Safari 支持晚；React 需要自己掌握节奏。
- **用 MessageChannel**：宏任务、无最小延迟、能在下一轮事件循环立刻继续，是最稳定的让出手段；不支持时回退 \`setTimeout\`。
- 由此带来一个业务可见的结论：并发渲染**不会缩短总耗时**，只是把长任务打散、让高优先级更新先出结果；CPU 密集的计算该丢给 Worker。`,
    track: "foundation",
    categoryId: "foundation-react",
    difficulty: "hard",
    tags: ["React", "原理", "性能"],
    topic: "React 调度器 · 时间切片",
    reviewedAt: "2026-11",
    heat: 76,
    updatedAt: "2026-11-11",
  },
  {
    id: "react-use-promise",
    title: "React 19 的 use(promise) 与 Suspense 取数",
    stem: "use 和普通 Hook 有什么不同？为什么不能在 render 里每次都新建 Promise？",
    answer: `- \`use\` 是**条件可调用**的：它读的是「已存在的资源」（Promise 或 Context），内部靠 Suspense 抛异常实现挂起，所以可以写在 if 里 —— 这是它与其它 Hook 最大的区别。
- 挂起时 React 会显示最近的 \`<Suspense fallback>\`，promise resolve 后**从挂起处重新渲染**；配合 \`startTransition\` 可以避免已显示内容闪回 fallback。
- **不能在 render 里新建 Promise**：每次渲染都是新 promise → 立即再次挂起 → 死循环。要么在服务端/上层创建后传下来，要么用请求库的缓存（\`useSWR\` / TanStack Query / RSC 里的 fetch 去重）。
- \`use\` 只解决「读」，不解决缓存、重试、失效、并发去重 —— 这些仍然交给请求库或框架（Next.js 的 fetch memoization）。
- 典型瀑布坑：父组件 await 完才渲染子组件，子组件再 await。解法是提前并行发起请求，或在服务端一次取齐。`,
    track: "foundation",
    categoryId: "foundation-react",
    difficulty: "hard",
    tags: ["React", "React 19", "2026", "原理"],
    topic: "React 19 · use 与 Suspense",
    reviewedAt: "2026-11",
    heat: 88,
    updatedAt: "2026-11-15",
  },
  {
    id: "react-server-action",
    title: "Server Actions 与 API Route 的区别，安全性怎么保证",
    stem: "有了 'use server'，还需要自己写接口吗？它为什么会成为新的攻击面？",
    answer: `- Server Action 是一个**带编译标记的异步函数**，客户端调用时被序列化成 POST 请求打到当前路由；省掉了手写 route、fetch、类型定义。
- 与 API Route 的差别：Action 与组件同文件、类型直通、天然支持表单渐进增强（无 JS 也能提交）；但它**不是 RPC 框架**，不适合给第三方或移动端复用（此时仍要 REST/GraphQL）。
- **安全边界**：Action 等于一个公开端点，任何人都能构造请求调用它。必须在函数内部自己做**鉴权、参数校验（zod）、限流**，不能依赖「UI 上没渲染这个按钮」。
- 不要在 Action 里做长耗时任务（请求有超时、会阻塞用户操作），应投递到队列后台执行。
- 序列化限制：参数与返回值必须可序列化（不能传函数、类实例、Date 之外的复杂对象），大文件走 FormData。`,
    track: "foundation",
    categoryId: "foundation-react",
    difficulty: "hard",
    tags: ["React", "React 19", "安全", "2026"],
    topic: "React 19 · Server Actions",
    reviewedAt: "2026-11",
    heat: 80,
    updatedAt: "2026-11-10",
  },
  {
    id: "react-synthetic-event",
    title: "合成事件与 React 17 的事件委托变化",
    stem: "React 为什么自己实现一套事件系统？17 之后委托到 root 带来了什么行为差异？",
    answer: `- 目的是**跨浏览器一致**与**统一调度**：抹平差异、把事件回调纳入同一套优先级与批处理，同时减少监听器数量（一个容器上挂一套）。
- React 17 起监听器从 \`document\` 移到 **root 容器**：微前端/多版本 React 共存时事件不再互相干扰，也不会再出现「\`e.stopPropagation()\` 拦不住 document 上的原生监听」。
- 执行顺序：原生事件在 root 上触发 → React 按**组件树**收集并派发合成事件。所以元素上同时有原生与 React 监听时，顺序取决于挂载层级而不是直觉。
- \`e.persist()\` 已移除（17 起事件对象不再池化），异步里可以直接读 \`e.target\`。
- 与原生混用的坑：React 的 \`onChange\` 实际是 \`input\` 事件；\`stopPropagation\` 会同时阻断 React 与后续原生传播，只想拦 React 用 \`e.isPropagationStopped()\` 判断或改用状态控制。`,
    track: "foundation",
    categoryId: "foundation-react",
    difficulty: "medium",
    tags: ["React", "原理", "DOM"],
    topic: "React 事件系统",
    reviewedAt: "2026-11",
    heat: 72,
    updatedAt: "2026-11-09",
  },
  {
    id: "react-hydration-mismatch",
    title: "Hydration 不匹配是怎么产生的，如何定位",
    stem: "线上出现「Text content does not match server-rendered HTML」，列出可能原因和排查手段。",
    answer: `- 本质：服务端产出的 HTML 与客户端首次渲染结果不一致。React 只能复用 DOM，一旦结构不同就会丢弃该子树重新渲染（18 会警告，19 对 mismatch 更严格并回退为客户端渲染）。
- 常见来源：**时间/随机数/自增 id**、\`Date.now()\`、\`localStorage\`/\`window\` 判断（服务端没有）、\`toLocaleString\` 的语言时区差异、非法 DOM 嵌套（\`<p><div></p>\` 会被浏览器改写）、浏览器扩展注入节点。
- 定位：看错误信息给出的组件栈与 diff 片段；把可疑子树用 \`<Suspense>\` / 动态导入排除，或用二分法逐层注释。
- 解法：**首次渲染保持确定性**（固定初始值），需要客户端数据时在 \`useEffect\` 后切换（\`mounted\` 标记）；外部可变数据用 \`useSyncExternalStore\` 并提供 \`getServerSnapshot\`。
- 记住一条：任何「渲染期读环境」的写法都是 hydration 隐患，环境判断只能放在 effect 或服务端分支里。`,
    track: "foundation",
    categoryId: "foundation-react",
    difficulty: "medium",
    tags: ["React", "SSR", "排错"],
    topic: "SSR · 水合一致性",
    reviewedAt: "2026-11",
    heat: 74,
    updatedAt: "2026-11-08",
  },
  {
    id: "react-form-performance",
    title: "大表单的性能：受控与非受控怎么选",
    stem: "50 个字段的表单每次输入都卡，你会怎么改？受控组件一定更好吗？",
    answer: `- 受控组件每次输入都会 \`setState\` → 父组件重渲染 → 整棵表单重新 diff。字段多、层级深时这是主要开销。
- 三条改造路径：
  1. **拆组件 + 局部状态**：把 state 下沉到字段自身，或用 \`useReducer\` + \`Context\` 配合选择器，避免整表重渲染。
  2. **非受控 + ref**：值只在提交时读取，输入过程零渲染；代价是实时校验/联动难做。
  3. **表单库**：react-hook-form 用 ref 收集值 + 订阅式更新（\`useWatch\` 只订阅需要的字段），兼顾非受控性能与受控能力。
- React 19 的 \`<form action>\` + \`useActionState\` 把提交、pending、错误收敛到框架层，减少手写 loading 状态，但不改变「输入期重渲染」的本质。
- 结论：**输入频繁且互不联动 → 非受控/表单库；需要实时联动 → 受控 + 局部化**。`,
    track: "foundation",
    categoryId: "foundation-react",
    difficulty: "medium",
    tags: ["React", "性能", "表单"],
    topic: "React 表单 · 受控与非受控",
    reviewedAt: "2026-11",
    heat: 70,
    updatedAt: "2026-11-07",
  },
  {
    id: "react-memory-leak",
    title: "React 应用的内存泄漏怎么排查",
    stem: "SPA 用久了内存持续上涨，说说常见泄漏点与定位方法。",
    answer: `- 常见泄漏：**未清理的定时器/订阅/事件监听**、WebSocket 与 \`IntersectionObserver\` 未断开、闭包长期持有大对象或 DOM 引用、全局 Map/数组缓存无上限、\`window\` 上挂的自定义数据。
- React 层面：\`useEffect\` 的 cleanup 必须与 setup 对称（订阅/退订、add/removeEventListener、abort 请求）；异步回调里 \`setState\` 虽在 18 后不再警告，但仍会持有闭包。
- 定位方法：DevTools Memory → **Heap snapshot 对比**（操作前后各拍一次，看 Detached HTMLElement 与持续增长的构造函数）；Performance Monitor 看 JS heap 曲线是否呈锯齿上升；\`Chrome DevTools > Memory > Allocation instrumentation\` 看分配栈。
- 预防：把「注册/注销」写成一个自定义 Hook 成对出现；缓存统一走带 LRU 上限的实现；大对象用完主动置空引用。
- 面试加分：区分「内存没释放」与「扩容后不回收」—— V8 的 heap 涨到阈值才 GC，看趋势而不是单点数值。`,
    track: "foundation",
    categoryId: "foundation-react",
    difficulty: "hard",
    tags: ["React", "性能", "排错"],
    topic: "前端内存治理",
    reviewedAt: "2026-11",
    heat: 68,
    updatedAt: "2026-11-06",
  },
  {
    id: "react-testing-strategy",
    title: "React 组件测试的取舍：测什么、不测什么",
    stem: "团队要求组件测试覆盖率 80%，你会怎么设计测试，避免写出一堆「改样式就红」的用例？",
    answer: `- 原则：**测行为不测实现**。断言用户能看到/能操作的东西（文本、角色、可访问名），不断言内部 state、组件名、DOM 结构。
- RTL 查询优先级：\`getByRole\` > \`getByLabelText\` > \`getByText\` > \`getByTestId\`（最后手段）。按 role 查询能顺带验证可访问性。
- 分层：纯逻辑抽成函数直接单测（最划算）；组件测「交互 → 可见结果」；跨页流程用 Playwright 端到端，不要用单测模拟整套路由。
- 网络在**边界**mock（msw 拦 fetch），不要 mock 自己的 Hook —— 否则测试与实现强耦合，重构即红。
- 必测分支：loading、空数据、错误、权限不足；异步用 \`findBy*\` 而不是包 \`act\` 硬等。
- 覆盖率是**下限指标**不是目标：核心链路的 60% 比全仓的 90% 更有价值。`,
    track: "foundation",
    categoryId: "foundation-react",
    difficulty: "medium",
    tags: ["React", "测试", "工程化"],
    topic: "前端测试策略",
    reviewedAt: "2026-11",
    heat: 66,
    updatedAt: "2026-11-05",
  },
  {
    id: "react-compiler",
    title: "React Compiler 会不会让 memo 失去意义",
    stem: "编译器自动做记忆化之后，还需要手写 useMemo / useCallback 吗？它的边界在哪？",
    answer: `- 编译器在构建期做**数据流分析**，自动为组件与表达式插入缓存，等价于「自动 useMemo/useCallback/memo」，前提是代码遵守 Hooks 规则且遵循不可变约定。
- 仍然需要人做的事：**架构级优化**（拆组件、虚拟列表、把计算移出渲染）、外部资源缓存（请求层）、以及编译器无法推断的副作用边界。
- 它不会修好违反规则的代码：渲染期改外部变量、直接 mutate props/state 会让缓存失效甚至产生 bug —— 编译器会跳过「不安全」的组件而不是硬修。
- 现实收益：减少无谓重渲染的心智负担，让「为了性能而写的 useMemo」不再是默认动作；但热点仍要靠 Profiler 实测，不要凭感觉。
- 面试口径：编译器优化的是**重复计算**，不优化**算法复杂度**与**渲染量**，后者才是大数据列表的真正瓶颈。`,
    track: "foundation",
    categoryId: "foundation-react",
    difficulty: "hard",
    tags: ["React", "性能", "2026"],
    topic: "React Compiler",
    reviewedAt: "2026-11",
    heat: 78,
    updatedAt: "2026-11-04",
  },
];
