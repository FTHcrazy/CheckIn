/**
 * 题库 · React 与 Vue。
 *
 * 两个框架都从「响应式 / 调度」这条主线问起：React 是可中断的调度 + 不可变快照，
 * Vue 是细粒度依赖追踪 + 编译期优化。答这类题的关键是讲清取舍，而不是背 API。
 */
import type { InterviewQuestion } from "./interview-types";

export const SEED_FRAMEWORK: readonly InterviewQuestion[] = [
  // ── React ──────────────────────────────────────────────────
  {
    id: "react-fiber-why",
    title: "React 为什么需要 Fiber？",
    stem: "从「递归不可中断」出发，说明 Fiber 架构解决了什么问题，以及它带来了什么代价。",
    answer: `- 旧架构用**递归调用栈**做协调，一旦开始就无法中断：组件树很深时一次协调会占满主线程，用户输入与动画只能排队。
- Fiber 把树改写成**链表化的可中断单元**（每个节点有 \`child / sibling / return\` 指针），配合时间切片（5ms 一片）让出主线程，实现**可中断、可恢复、可丢弃**的渲染。
- 由此带来优先级概念：交互更新（高）可以插队到列表渲染（低）之前，低优先级工作被更高优先级替换时直接丢弃重来。
- 代价是**双缓冲（两棵 Fiber 树）+ 复杂调度**：内存占用上升，且并发特性要求渲染阶段无副作用，否则中断重放会出问题。
- 追问：为什么 \`render\` 必须纯净（不能改 DOM / 发请求），正是为可中断服务的。`,
    track: "foundation",
    categoryId: "foundation-react",
    difficulty: "hard",
    tags: ["React", "原理", "大厂"],
    topic: "React 渲染原理 · Fiber",
    reviewedAt: "2026-11",
    heat: 92,
    updatedAt: "2026-11-11",
  },
  {
    id: "react-render-commit",
    title: "render 阶段与 commit 阶段的区别",
    diagramId: "dg-fiber",
    stem: "为什么只有 commit 阶段能操作 DOM？双缓冲在这个过程中怎么工作？",
    answer: `- **render 阶段（reconcile）**：从根开始构建 \`workInProgress\` 树，计算副作用（增删改、effect 依赖），**可被打断、可重来**，因此不能有可观测副作用。
- **commit 阶段**：同步、不可中断，分三个子阶段 —— \`beforeMutation\`（读快照、getSnapshotBeforeUpdate）、\`mutation\`（真正操作 DOM、执行 layout effect 的销毁）、\`layout\`（\`useLayoutEffect\`、\`ref\`、\`componentDidMount\` 等）。
- **双缓冲**：当前屏幕对应 \`current\` 树，render 在 \`workInProgress\` 树上进行；commit 完成后直接切换 \`root.current\` 指针，一次性替换，避免中间态闪烁。
- 副作用（\`useEffect\`）被推迟到**浏览器绘制之后**异步执行，所以它不能阻塞渲染，也不能在其中读布局。
- 追问：\`useLayoutEffect\` 在绘制前同步执行，用于测量布局并同步修改样式，避免闪烁。`,
    track: "foundation",
    categoryId: "foundation-react",
    difficulty: "hard",
    tags: ["React", "原理", "大厂"],
    topic: "React 渲染原理 · 阶段划分",
    reviewedAt: "2026-11",
    heat: 85,
    updatedAt: "2026-11-12",
  },
  {
    id: "react-hooks-linked-list",
    title: "Hooks 为什么不能写在条件语句里",
    stem: "从实现角度解释 Hooks 的存储结构与调用顺序约束。",
    answer: `- Hooks 状态挂在 **Fiber 节点的 \`memoizedState\` 链表**上，每次渲染按**调用顺序**逐个读取，索引即顺序。
- 条件调用会导致顺序变化：本次渲染少调一个 \`useState\`，后续所有 Hook 的读数就整体错位，state 会串到别的变量上。
- 因此 React 只能校验「数量与顺序一致」（开发环境报 "Rendered fewer hooks than expected"），无法知道你到底想跳过哪个。
- 自定义 Hook 本质上只是把这条链表的读取逻辑抽成函数复用，所以它同样受顺序约束。
- \`eslint-plugin-react-hooks\` 是唯一可靠的防线；需要条件逻辑时把 Hook 提到条件外层或用子组件拆分。`,
    track: "foundation",
    categoryId: "foundation-react",
    difficulty: "medium",
    tags: ["React", "原理", "高频"],
    topic: "React Hooks 原理",
    reviewedAt: "2026-11",
    heat: 90,
    updatedAt: "2026-11-09",
  },
  {
    id: "react-useeffect-deps",
    title: "useEffect 的依赖、清理与 StrictMode 双调用",
    stem: "空依赖数组真的只执行一次吗？为什么开发环境会执行两次？如何正确写清理逻辑？",
    answer: `- 依赖数组是**浅比较（Object.is 逐项）**；空数组表示「没有依赖」，只在挂载后执行一次、卸载时清理一次。
- StrictMode 下开发环境会**挂载 → 卸载 → 再挂载**，effect 执行两次，目的是逼你把副作用写成「可重复执行而无害」的形态（幂等 + 完整清理）。
- 清理函数必须**抵消**上一次副作用：取消订阅、\`clearTimeout\`、\`AbortController.abort()\`、断开连接。
- 常见错误：把对象/函数放进依赖却不做稳定化（每次新引用 → 无限循环）；用 \`ref\` 偷懒绕过依赖会让数据流不可追踪。
- 取数场景更推荐由框架或请求库（React Query / SWR）管理，而不是裸 \`useEffect + setState\`，后者要自己处理竞态与忽略过期响应。`,
    track: "foundation",
    categoryId: "foundation-react",
    difficulty: "medium",
    tags: ["React", "高频", "Hooks"],
    topic: "React Hooks 原理",
    reviewedAt: "2026-11",
    heat: 88,
    updatedAt: "2026-11-13",
  },
  {
    id: "react-reconciliation-key",
    title: "Reconciliation 与 key 的作用",
    diagramId: "dg-react-diff",
    stem: "React 的 diff 有哪些假设？为什么用索引当 key 会导致输入框错位？",
    answer: `- 三个假设把 O(n³) 降到 O(n)：**同层比较**（不跨层级移动）、**类型不同直接重建**、**同层用 key 匹配**。
- 同层多节点 diff 分三种情况：新 child 是单个节点、是数组、是文本；数组场景下 React 会建 \`Map<key, fiber>\` 做匹配，再决定移动还是删除。
- 用**索引当 key** 时，插入或删除会让后续元素的 key 全部变化，React 认为「同一个位置是同一个人」，于是复用旧 fiber 的 state —— 表现为输入框内容跟着错位、动画重放。
- 合适的 key 是**稳定且唯一**的业务 id；只在纯静态、永不重排的列表里用索引才安全。
- 追问：\`key\` 变了等于卸载重建（会触发 effect 清理），可用来强制重置子组件状态。`,
    track: "foundation",
    categoryId: "foundation-react",
    difficulty: "medium",
    tags: ["React", "原理", "高频"],
    topic: "React 渲染原理 · diff",
    reviewedAt: "2026-11",
    heat: 86,
    updatedAt: "2026-11-09",
  },
  {
    id: "react-state-batching",
    title: "状态批量更新与更新优先级",
    stem: "为什么连续两次 setState 只重渲染一次？自动批处理在什么情况下失效？",
    answer: `- React 18 起**所有更新自动批处理**（包括 setTimeout、Promise 回调、原生事件），把同一事件循环内的更新合并成一次渲染。
- 实现上每次更新会被打上 **lane 优先级**，调度器选择最高优先级的 lane 先渲染，其余留在队列里下次合并。
- 只有 \`flushSync\` 会强制同步刷新（会打破批处理，慎用）。
- \`setState(x => x + 1)\` 的函数式更新拿到的是**队列里最新的 state**，所以连续两次自增要写成函数式，直接传值只会加一次。
- 失效场景：在 React 事件之外通过 \`flushSync\` 或第三方库强制同步、以及老版本在异步回调里。`,
    track: "foundation",
    categoryId: "foundation-react",
    difficulty: "hard",
    tags: ["React", "原理", "大厂"],
    topic: "React 调度 · 优先级",
    reviewedAt: "2026-11",
    heat: 78,
    updatedAt: "2026-10-29",
  },
  {
    id: "react-memo-strategy",
    title: "memo / useMemo / useCallback 该不该到处加",
    stem: "说明三者的作用与成本，给出「什么时候值得加」的判断标准。",
    answer: `- \`React.memo\` 对 props 做浅比较跳过重渲染；\`useMemo\` 缓存**计算结果**；\`useCallback\` 缓存**函数引用**（本质是 \`useMemo\` 返回函数）。
- 成本是真实的：每次渲染都要比较依赖、缓存本身占内存，滥用反而更慢；且 \`useCallback\` 只对「被 memo 包裹的子组件」或「作为依赖传给 Hook」有意义。
- 值得加的场景：子组件树大或渲染贵、计算本身重（列表排序/过滤/复杂格式化）、函数要进依赖数组或 \`useEffect\` deps。
- 不值得：基础组件上的普通回调、依赖每次都变的计算（缓存永远失效）、单纯为了「看起来优化过」。
- 现代方向是 React Compiler：编译期自动做等价改写，人工加 memo 的需求会大幅减少。`,
    track: "foundation",
    categoryId: "foundation-react",
    difficulty: "medium",
    tags: ["React", "性能", "高频"],
    topic: "React 性能优化",
    reviewedAt: "2026-11",
    heat: 82,
    updatedAt: "2026-11-04",
  },
  {
    id: "react-context-rerender",
    title: "Context 更新为什么会全量重渲染",
    stem: "一个 Provider 里放了大对象，所有消费者都重渲染了，怎么优化？",
    answer: `- Context 的值变化会让**所有消费者**重渲染，且无法通过 \`memo\` 阻断（消费本身就是一个订阅关系）。
- 三大优化方向：**拆 Context**（按更新频率分组）、**降低值的变化频率**（\`useMemo\` 包 value、把频繁变的字段单独放一个 Provider）、**用外部 store 订阅**（zustand / jotai 的 selector 订阅能精确到字段）。
- 注意 \`value={{a, b}}\` 每次渲染都是新对象，等于每次都在通知消费者 —— 这是最常见的低级错误。
- 传函数作为 value 时用 \`useCallback\` 稳定引用，或改用 \`useState\` 的函数式更新避免依赖。
- 判断依据：Context 适合「低频变化的全局配置」（主题、用户、语言），不适合「高频变化的业务数据」。`,
    track: "foundation",
    categoryId: "foundation-react",
    difficulty: "medium",
    tags: ["React", "性能", "大厂"],
    topic: "React 状态传递 · Context",
    reviewedAt: "2026-11",
    heat: 76,
    updatedAt: "2026-11-03",
  },
  {
    id: "react19-actions",
    title: "React 19 的 use、Actions 与 useOptimistic",
    stem: "React 19 在数据变更与异步交互上做了哪些改动？解决了哪些旧痛点？",
    answer: `- \`use(promise)\` 允许在组件里**直接读取 Promise**（配合 Suspense 挂起），也可读取 Context，打破「Hook 不能条件调用」的部分限制。
- **Actions**：把 async 函数直接传给 \`<form action>\`，React 管理 pending、错误与表单重置，省掉手写 \`loading\` 三件套。
- \`useActionState\` 承载 action 的返回值与错误；\`useOptimistic\` 做乐观更新并在失败时自动回滚。
- \`useFormStatus\` 让子组件读取所在表单的提交状态，不必层层传 props。
- 底层配套是 \`ref\` 可作为普通 prop（不再需要 \`forwardRef\`）、文档元数据（\`<title>\`/\`<meta>\` 自动提升到 head）、以及更好的 hydration 错误提示。`,
    track: "foundation",
    categoryId: "foundation-react",
    difficulty: "medium",
    tags: ["React 19", "2025", "高频"],
    topic: "React 19 新特性",
    reviewedAt: "2026-11",
    heat: 84,
    updatedAt: "2026-11-13",
  },
  {
    id: "react-rsc",
    title: "服务端组件（RSC）与 SSR 的区别",
    stem: "两者都能在服务端产出 HTML，为什么还需要 RSC？",
    answer: `- **SSR 只是首屏渲染位置不同**：组件代码仍会打包进客户端 bundle 并 hydrate，交互逻辑全量下发。
- **RSC 的组件永远不进入客户端 bundle**：它在服务端执行、直接产出可序列化的 UI 描述，客户端只接收结果。因此可以直接读数据库、使用服务端密钥，客户端包体明显变小。
- 组合方式：服务端组件负责取数与结构，客户端组件（\`"use client"\`）负责交互，两者通过 **props 序列化边界**通信 —— props 必须可序列化，函数不能直接传（要用 Server Action）。
- SSR 解决「首屏白屏与 SEO」，RSC 解决「包体与数据就近访问」；两者可以叠加（Next.js App Router 就是 RSC + Streaming SSR）。
- 代价：心智模型变复杂，状态与副作用必须落在客户端组件里，调试链路跨进程。`,
    track: "foundation",
    categoryId: "foundation-react",
    difficulty: "hard",
    tags: ["React 19", "架构", "2025"],
    topic: "React 服务端组件",
    reviewedAt: "2026-11",
    heat: 80,
    updatedAt: "2026-11-08",
  },
  {
    id: "react-suspense-error",
    title: "Suspense 与错误边界怎么配合",
    stem: "说明 Suspense 的工作原理，以及为什么还需要 ErrorBoundary 兜底。",
    answer: `- Suspense 的机制是**抛异常**：子组件读取未就绪的资源时抛出 Promise，React 捕获后显示 fallback，Promise resolve 后重新渲染。
- 因此它天然与「支持挂起的取数方式」绑定（\`use()\`、React.lazy、支持 suspense 的请求库），普通 \`useEffect\` 取数不会挂起。
- \`React.lazy\` + Suspense 是最常见用法：路由级代码分割时负责加载态。
- 错误边界只能捕获**渲染期**错误（含子组件抛错），捕获不到事件回调与异步里的错误；SSR 场景需要在服务端单独处理。
- 二者要分层放置：路由级 Suspense + 局部的细粒度 Suspense，配合就近的 ErrorBoundary，避免一个模块失败拖垮整页。`,
    track: "foundation",
    categoryId: "foundation-react",
    difficulty: "basic",
    tags: ["React", "基础"],
    topic: "React 异步渲染",
    reviewedAt: "2026-11",
    heat: 62,
    updatedAt: "2026-11-05",
  },
  {
    id: "react-state-management",
    title: "React 状态管理选型：Context、Zustand、Redux Toolkit",
    stem: "一个中型中后台项目，你会怎么选状态方案？给出分层思路。",
    answer: `- 先分层：**服务端状态**（缓存、重试、失效）交给 React Query / SWR；**表单状态**交给 react-hook-form；剩下的才是「客户端全局状态」。
- 客户端状态量小时用 Context + \`useReducer\` 足够；需要**按字段订阅**避免全量重渲染时用 Zustand（selector 订阅、体积小）。
- Redux Toolkit 适合**事件流复杂、需要中间件与时间旅行调试**的大型团队项目，代价是样板代码更多。
- 判断依据：更新频率、订阅粒度、是否需要跨路由共享与持久化，而不是「哪个更流行」。
- 反模式：把所有状态塞进一个全局 store，导致任何改动都触发大面积重渲染，且状态来源无法追踪。`,
    track: "foundation",
    categoryId: "foundation-react",
    difficulty: "basic",
    tags: ["React", "架构", "基础"],
    topic: "React 状态管理",
    reviewedAt: "2026-11",
    heat: 70,
    updatedAt: "2026-10-30",
  },

  // ── Vue ────────────────────────────────────────────────────
  {
    id: "vue-reactivity",
    title: "Vue 3 响应式原理与 Vue 2 的差别",
    diagramId: "dg-vue-reactivity",
    stem: "Proxy 相比 Object.defineProperty 解决了哪些具体问题？",
    answer: `- Vue 2 用 \`Object.defineProperty\` 递归改写每个属性，Vue 3 用 \`Proxy\` 代理整个对象，**惰性**代理嵌套对象（访问时才包）。
- Proxy 解决的问题：**新增/删除属性可拦截**（不再需要 \`$set\`）、**数组索引与 length 可拦截**（不再改写数组方法）、支持 Map/Set、可拦截 \`in\` 与 \`delete\`。
- 依赖结构是 \`WeakMap<target, Map<key, Dep>>\`，\`effect\` 在 \`track\` 时收集、在 \`trigger\` 时派发；\`ref\` 用 \`{ value }\` 包一层以支持原始值。
- 3.4 起引入**双端 diff 前的依赖清理与位标记**，3.5 起重构了响应式系统（内存降约 56%），并让 \`ref\` 在模板中可直接解包。
- 追问：\`shallowRef\` / \`markRaw\` 用于「明确不需要深层响应」的大对象，是性能优化的常用手段。`,
    track: "foundation",
    categoryId: "foundation-vue",
    difficulty: "medium",
    tags: ["Vue 3.5", "原理", "高频"],
    topic: "Vue 响应式原理",
    reviewedAt: "2026-11",
    heat: 86,
    updatedAt: "2026-10-26",
  },
  {
    id: "vue-diff-lis",
    title: "Vue 3 的 diff 为什么用最长递增子序列",
    diagramId: "dg-vue3-diff",
    stem: "说明 patchKeyedChildren 的五步流程，以及 LIS 在其中的作用。",
    answer: `- 五步：**头部同步 → 尾部同步 → 处理新增 → 处理删除 → 中间乱序部分**。前三步覆盖了绝大多数「末尾追加/删除」的常见场景。
- 中间部分先建 \`key → index\` 映射做匹配，标记哪些需要移动、哪些需要卸载，再用**最长递增子序列**找出「本来就有序」的最大子集。
- LIS 的意义：这些元素**不需要移动**，其余元素按倒序插入即可。把移动次数从 O(n) 降到最少，同时保证 DOM 操作与真实顺序一致。
- 与 React 的差异：Vue 双端 + LIS 能处理更复杂的乱序，React 只做单向遍历 + 移动判断；Vue 依赖「编译期知道哪些是动态节点」进一步降低比较量。
- 追问：Vue 2 用的是双端比较（四个指针），Vue 3 用 LIS 大幅减少了「乱序时逐个 moveBefore」的抖动。`,
    track: "foundation",
    categoryId: "foundation-vue",
    difficulty: "hard",
    tags: ["Vue 3.5", "原理", "大厂"],
    topic: "Vue 渲染原理 · diff",
    reviewedAt: "2026-11",
    heat: 78,
    updatedAt: "2026-11-15",
  },
  {
    id: "vue-compiler-optimize",
    title: "Vue 3 编译期做了哪些优化",
    stem: "静态提升、patchFlag、Block Tree 分别省掉了什么开销？",
    answer: `- **静态提升（static hoisting）**：把不含动态绑定的节点提到 render 函数外创建一次，后续复用一个 vnode。
- **patchFlag**：给动态节点打标记（TEXT / CLASS / PROPS / STYLE…），patch 时**只比对标记的字段**，不再逐属性 diff。
- **Block Tree**：把模板切成 block，block 内只收集动态子节点成扁平数组（\`dynamicChildren\`），diff 时跳过整棵静态子树。
- **缓存事件处理器**（cacheHandler）避免每次渲染新建函数导致子组件 props 变化。
- 这些优化的前提是模板是**编译期可知的结构**；手写 \`h()\` / JSX 的 render 函数享受不到，所以 Vue 的模板在大多数场景比手写 render 更快。`,
    track: "foundation",
    categoryId: "foundation-vue",
    difficulty: "hard",
    tags: ["Vue 3.5", "原理", "编译"],
    topic: "Vue 编译期优化",
    reviewedAt: "2026-11",
    heat: 74,
    updatedAt: "2026-11-16",
  },
  {
    id: "vue-composition-api",
    title: "组合式 API 相比选项式解决了什么问题",
    stem: "一个功能涉及 props、状态、请求与生命周期，两种写法各有什么代价？",
    answer: `- 选项式 API 按**类型**组织（data / methods / computed / mounted），一个功能的代码散落在四五处，逻辑复用只能靠 mixin（来源不明、命名冲突）。
- 组合式 API 按**功能**组织，同一功能的响应式状态、计算、副作用写在一起，天然支持抽成 \`useXxx\` 函数复用。
- 组合式对 TypeScript 更友好：\`setup\` 里都是普通变量与函数，推导与泛型都自然；选项式需要 \`defineComponent\` 与 \`this\` 类型体操。
- 代价：需要自己管理响应式边界（\`ref\` 与 \`reactive\` 的选择、解构丢响应性），逻辑顺序自由也意味着更容易写出面条代码。
- 实践建议：新项目一律 \`<script setup>\`；旧项目迁移是增量的，两种写法可在同一组件内共存（\`setup()\` 返回的绑定在模板里优先）。`,
    track: "foundation",
    categoryId: "foundation-vue",
    difficulty: "medium",
    tags: ["Vue 3.5", "架构", "高频"],
    topic: "Vue 组合式 API",
    reviewedAt: "2026-11",
    heat: 76,
    updatedAt: "2026-10-27",
  },
  {
    id: "vue-computed-watch",
    title: "computed 与 watch 的区别与选择",
    stem: "computed 的缓存什么时候失效？什么时候必须用 watch 而不是 computed？",
    answer: `- \`computed\` 是**惰性求值 + 缓存**：只有依赖变化时才重新计算，读取时才求值；结果只读（可写 computed 需要 getter/setter）。
- \`watch\` 是**副作用**：依赖变化时执行回调，适合发请求、操作 DOM、写 localStorage、调用外部 API。
- 必须用 watch 的场景：需要「变化后做事」而不是「算出新值」，或需要拿到 \`oldValue\`，或需要 \`deep\` / \`immediate\` / \`flush: 'post'\` 这类时机控制。
- 常见错误：在 computed 里发请求（副作用 + 可能重复触发）；用 watch 去同步一个可以直接推导的值（应改 computed）。
- 性能注意：\`deep: true\` 会递归遍历大对象，能用具体路径就用 \`() => state.a.b\`；批量更新用 \`watchEffect\` 或 \`flush: 'post'\` 合并。`,
    track: "foundation",
    categoryId: "foundation-vue",
    difficulty: "basic",
    tags: ["Vue 3.5", "基础", "高频"],
    topic: "Vue 响应式 API",
    reviewedAt: "2026-11",
    heat: 72,
    updatedAt: "2026-11-14",
  },
  {
    id: "vue-lifecycle-nexttick",
    title: "生命周期顺序与 nextTick 的作用",
    stem: "父子组件的挂载顺序是什么？为什么改了数据立刻读 DOM 拿不到新值？",
    answer: `- 挂载：父 \`setup\` → 子 \`setup\` → 子 \`mounted\` → 父 \`mounted\`；卸载相反：父 \`beforeUnmount\` → 子 \`beforeUnmount\` → 子 \`unmounted\` → 父 \`unmounted\`。
- \`onMounted\` 里能拿到真实 DOM（子组件此时已挂载完成）；\`onUpdated\` 在 DOM 更新后触发，不要在里面对状态再赋值（会循环）。
- 修改响应式数据后 DOM 不会同步更新：Vue 把更新推进**微任务队列**批处理，\`await nextTick()\` 或 \`nextTick(cb)\` 才是「DOM 已更新」的时机。
- 需要「等渲染完成再测量」的场景（滚动到底、图表尺寸）必须用 nextTick，否则拿到旧尺寸。
- SSR 环境没有 \`onMounted\` 之前的 DOM，取数逻辑放 \`setup\` 顶层或 \`onServerPrefetch\`。`,
    track: "foundation",
    categoryId: "foundation-vue",
    difficulty: "basic",
    tags: ["Vue 3.5", "基础"],
    topic: "Vue 生命周期",
    reviewedAt: "2026-11",
    heat: 66,
    updatedAt: "2026-10-21",
  },
  {
    id: "vue-vapor",
    title: "Vue Vapor 与 3.5 之后的演进方向",
    stem: "Vapor 模式和现在的虚拟 DOM 渲染有什么区别？它解决了什么问题？",
    answer: `- Vapor 模式**去掉虚拟 DOM**：编译器把模板直接编译成「创建/更新真实 DOM 节点」的指令式代码，更新时精确改节点属性，不再生成与 diff vnode。
- 收益是内存与运行时开销下降（不必持有 vnode 树），首屏与大列表场景更明显，同时保留响应式与组合式 API 的写法。
- 代价是失去 vnode 带来的灵活性（手写 render 函数、动态组件结构、跨平台自定义渲染器需要额外适配），因此它是**可选的编译目标**而非默认。
- 3.5 的其它演进：响应式系统重构（内存优化）、\`useTemplateRef\`、\`defineModel\` 稳定、SSR 懒 hydration。
- 这类问题的答题要点是讲清「编译器能做的事越多，运行时要做的越少」这条主线，而不是罗列版本号。`,
    track: "foundation",
    categoryId: "foundation-vue",
    difficulty: "medium",
    tags: ["Vue 3.5", "2026", "原理"],
    topic: "Vue 演进 · Vapor",
    reviewedAt: "2026-11",
    heat: 60,
    updatedAt: "2026-10-22",
  },
  {
    id: "vue-pinia",
    title: "Pinia 与 Vuex 的差别，状态该怎么分层",
    stem: "为什么 Pinia 成为官方推荐？中后台项目的状态该怎么分层？",
    answer: `- Pinia 去掉了 mutation：直接改 state 或调 action，**TS 推导自然**（不再需要字符串常量与 \`commit\` 类型体操）；支持多 store 与按需注册。
- 模块化更彻底：每个 store 独立文件，可组合（一个 store 里 \`use\` 另一个 store），不再有 Vuex 的嵌套 modules 命名空间地狱。
- 分层建议：**服务端数据**用请求库缓存（不重复塞进 store）；**页面级状态**留在组件内；**跨页共享的少量状态**（用户、权限、主题、购物车）才进 store。
- 反模式：把所有接口数据都同步进 store，出现「两份事实源」，刷新与失效逻辑难以维护。
- 持久化用插件按需白名单，避免整个 store 无脑写 localStorage。`,
    track: "foundation",
    categoryId: "foundation-vue",
    difficulty: "medium",
    tags: ["Vue 3.5", "状态管理", "架构"],
    topic: "Vue 状态管理 · Pinia",
    reviewedAt: "2026-11",
    heat: 64,
    updatedAt: "2026-11-06",
  },
];
