/**
 * 分类知识体系。
 *
 * 题库回答「这一题怎么答」，知识体系回答「这一块该按什么顺序学、往上下游看什么」。
 * 结构刻意做成「分类 → 主题 → 要点 + 延伸阅读」：
 * - `upstream` / `downstream` 写清前置与后续，避免只收藏不落地；
 * - `links` 只放官方文档或长期稳定的权威站点，不放二手博客（链接会烂）。
 *
 * 新增分类时**必须同时补这一组数据** —— 由 `interview-knowledge.test.ts` 守卫。
 */
import type { CategoryId } from "./interview-types";

/** 学习阶段：决定在同一分类内的推荐顺序 */
export type KnowledgeStage = "入门" | "进阶" | "深入";

export interface KnowledgeLink {
  label: string;
  url: string;
}

export interface KnowledgeTopic {
  id: string;
  categoryId: CategoryId;
  title: string;
  stage: KnowledgeStage;
  /** 一句话说清这个主题解决什么问题 */
  summary: string;
  /** 学习要点 */
  points: string[];
  /**
   * 该主题配套的图（见 `interview-diagrams.ts`）。
   *
   * 只挂在「有明确顺序 / 分层 / 两方案对比」的主题上：这类内容用文字讲
   * 最费劲，图能一屏说清。没有合适图的主题留空，不要为了填而硬塞。
   */
  diagramId?: string;
  /** 学它之前应该先掌握什么 */
  upstream?: string;
  /** 学完之后可以接着看什么 */
  downstream?: string;
  links: readonly KnowledgeLink[];
}

export const KNOWLEDGE_TOPICS: readonly KnowledgeTopic[] = [
  // ── 笔试题 ────────────────────────────────────────────────
  {
    id: "kc-written-coding",
    categoryId: "written-coding",
    title: "手写题的能力地图：闭包、this、异步、原型四条主线",
    stage: "入门",
    summary:
      "手写题看似零散，其实只在考四件事：能不能操控作用域、能不能操控 this、能不能编排异步、能不能玩转原型与对象。",
    points: [
      "闭包线：防抖节流、柯里化、compose、once、缓存 memo",
      "this 线：new、call/apply/bind、继承、instanceof",
      "异步线：Promise 全家桶、并发池、重试与超时、async 串并行",
      "对象线：深拷贝、EventEmitter、观察者、简易响应式",
      "答题格式：先讲语义与边界，再写实现，最后补复杂度与陷阱",
    ],
    downstream: "写完基础实现后，去看「异步控制流」与「LRU / 观察者」这类结构题",
    links: [
      { label: "MDN · Promise", url: "https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Promise" },
      { label: "现代 JavaScript 教程", url: "https://zh.javascript.info/" },
    ],
  },
  {
    id: "kc-written-async-control",
    categoryId: "written-coding",
    title: "异步控制流：并发池、重试、超时、可取消",
    stage: "进阶",
    summary:
      "真实项目里 90% 的异步代码不是 Promise.all，而是「限并发 + 失败重试 + 超时中断」的组合。",
    points: [
      "并发池：维护 running 计数，完成后取下一个，注意错误也要释放槽位",
      "重试：指数退避 + 最大次数 + 只对幂等操作重试",
      "超时：Promise.race 只是放弃等待，真正取消要 AbortController",
      "顺序语义：结果按入参顺序返回，而不是完成顺序",
    ],
    upstream: "Promise 状态机与 then 链",
    downstream: "Node 侧看 stream 背压与 graceful shutdown",
    links: [
      { label: "MDN · AbortController", url: "https://developer.mozilla.org/zh-CN/docs/Web/API/AbortController" },
      { label: "javascript.info · Promises, async/await", url: "https://zh.javascript.info/async" },
    ],
  },
  {
    id: "kc-written-structure",
    categoryId: "written-coding",
    title: "结构型手写：LRU、EventEmitter、观察者与响应式",
    stage: "深入",
    summary:
      "这类题考的是「用最合适的数据结构表达约束」——LRU 靠 Map 的顺序性，事件总线靠 Map + 数组，响应式靠 Proxy 拦截。",
    points: [
      "LRU：Map 的插入顺序即访问顺序，命中后 delete 再 set 即可把热点移到末尾",
      "EventEmitter：once 用包装函数 + 先解绑再执行，emit 遍历前拷贝一份快照",
      "观察者 vs 发布订阅：前者直接持有订阅者引用，后者靠事件中心解耦",
      "响应式：Proxy 拦截 get 收集依赖、set 触发更新，注意递归与循环依赖",
    ],
    upstream: "Map/Set 与 WeakMap 的语义",
    downstream: "对照 Vue 3 的 reactivity 实现读源码",
    links: [
      { label: "MDN · Map", url: "https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Map" },
    ],
  },

  {
    id: "kc-algorithm-pattern",
    categoryId: "written-algorithm",
    title: "先建立模式库：双指针、滑动窗口、哈希、二分",
    stage: "入门",
    summary:
      "面试算法不是题库量，而是把题目映射到少数几个模式上；能识别模式，才有稳定输出。",
    points: [
      "双指针：有序数组两端收缩、快慢指针判环",
      "滑动窗口：连续子数组/子串的极值，窗口扩张与收缩条件要写成两段循环",
      "哈希：用空间换时间，注意「存什么」比「用什么」更关键",
      "二分：不只用于有序数组，也用于「答案单调」的判定问题",
      "先写暴力解说明复杂度，再优化 —— 面试官看的是推导过程",
    ],
    downstream: "链表与二叉树是这些模式的主要载体，接着刷这两类",
    links: [
      { label: "LeetCode 中国站", url: "https://leetcode.cn/" },
      { label: "VisuAlgo 算法可视化", url: "https://visualgo.net/zh" },
    ],
  },
  {
    id: "kc-algorithm-structure",
    categoryId: "written-algorithm",
    title: "必背结构：链表、二叉树、堆、并查集",
    stage: "进阶",
    summary:
      "这四类结构覆盖了前端面试 80% 的算法题；每个都要能手写基本操作，而不是只会调用 API。",
    points: [
      "链表：dummy 头节点解决边界，反转/合并/环检测是母题",
      "二叉树：前中后序 + 层序，递归写法先想「单层做什么」",
      "堆：TopK 与优先队列，JS 需自己实现或记住数组堆化",
      "并查集：路径压缩 + 按秩合并，用于连通性与分组问题",
    ],
    upstream: "递归与栈、队列的基本操作",
    downstream: "图论（BFS/DFS/拓扑排序）与动态规划",
    links: [
      { label: "javascript.info · 数据结构", url: "https://zh.javascript.info/data-structures" },
    ],
  },
  {
    id: "kc-algorithm-sort",
    categoryId: "written-algorithm",
    title: "排序与查找：三种把规模折半的固定手法",
    stage: "进阶",
    summary:
      "排序题考的不是背代码，而是「分区 / 合并 / 折半」这三种缩小问题规模的套路，以及各自的复杂度与代价。",
    points: [
      "快排：选基准 → 分区 → 递归两段；平均 O(n log n)，最坏 O(n²)，原地但不稳定",
      "归并：一路拆到单元素再两两合并；恒 O(n log n)，稳定，但需要 O(n) 辅助空间",
      "二分：前提是答案单调；左闭右闭与左闭右开两套写法不能混用",
      "答题顺序：先给暴力解与复杂度，再说优化点，最后补稳定性与最坏情况",
    ],
    diagramId: "dg-quicksort",
    upstream: "递归、双指针与复杂度分析",
    downstream: "把同一套思路迁到快选（TopK）与「二分答案」类问题",
    links: [
      { label: "VisuAlgo · 排序可视化", url: "https://visualgo.net/zh/sorting" },
      { label: "MDN · Array.prototype.sort", url: "https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Array/sort" },
    ],
  },
  {
    id: "kc-algorithm-dp",
    categoryId: "written-algorithm",
    title: "动态规划：状态定义比转移方程更难",
    stage: "深入",
    summary:
      "DP 的难点是「用什么状态描述子问题」；状态一旦定对，转移方程和遍历顺序几乎自动出现。",
    points: [
      "四步法：状态定义 → 转移方程 → 初始值 → 遍历顺序（保证依赖先算）",
      "一维/二维/区间/背包四类模板足够应付面试",
      "空间优化：只依赖上一行时用滚动数组",
      "识别信号：最优子结构、重叠子问题、求方案数/最值",
    ],
    upstream: "递归与记忆化搜索（自顶向下先写出来，再改自底向上）",
    links: [
      { label: "LeetCode · 动态规划专题", url: "https://leetcode.cn/tag/dynamic-programming/" },
    ],
  },

  {
    id: "kc-design-scope",
    categoryId: "written-design",
    title: "场景设计题：先拆需求，再谈技术",
    stage: "入门",
    summary:
      "设计题考的是「在信息不全时如何收敛方案」，一上来就说用某个库通常是最低分答案。",
    points: [
      "先问清边界：用户角色、数据量级、并发、是否离线、兼容范围",
      "拆成模块：入口 → 数据流 → 状态 → 渲染 → 错误处理",
      "给出取舍：为什么选 A 不选 B，代价是什么",
      "最后补非功能需求：性能预算、可访问性、埋点、灰度",
    ],
    downstream: "把方案落到组件边界与接口定义上，就是架构设计题",
    links: [
      { label: "react.dev · Thinking in React", url: "https://react.dev/learn/thinking-in-react" },
      { label: "System Design Primer", url: "https://github.com/donnemartin/system-design-primer" },
    ],
  },
  {
    id: "kc-design-state",
    categoryId: "written-design",
    title: "状态设计：单一事实源与派生数据",
    stage: "进阶",
    summary:
      "大部分「数据不同步」的 bug 源于同一份信息被存了两份；状态设计的第一原则是能推导就不要存。",
    points: [
      "分类：服务端状态、客户端 UI 状态、URL 状态，三者生命周期不同，不要混在一个 store",
      "派生优先：能由现有状态算出来的，一律用计算属性/useMemo",
      "状态提升 vs 下沉：只有跨组件共享才提升，否则就近",
      "用 URL 承载可分享的筛选条件（刷新/分享不丢）",
    ],
    upstream: "组件通信与单向数据流",
    downstream: "状态管理选型（Redux/Pinia/Zustand）与持久化",
    links: [
      { label: "react.dev · Managing State", url: "https://react.dev/learn/managing-state" },
      { label: "vuejs.org · State Management", url: "https://vuejs.org/guide/scaling-up/state-management.html" },
    ],
  },
  {
    id: "kc-design-nonfunctional",
    categoryId: "written-design",
    title: "非功能需求：性能、错误、权限、可访问性",
    stage: "深入",
    summary:
      "能跑通只是及格线；真正的工程方案要在「慢、错、没权限、键盘操作」四种状态下依然可用。",
    points: [
      "性能：给出预算（首屏 JS、LCP、长任务），并说明度量方式",
      "错误：网络失败、部分失败、超时、重试与降级 UI",
      "权限：前端只做展示控制，真正校验必须在服务端",
      "可访问性：语义化标签、焦点管理、键盘可达、对比度",
    ],
    upstream: "性能优化与安全基础",
    links: [
      { label: "WAI-ARIA 实践指南", url: "https://www.w3.org/WAI/ARIA/apg/" },
      { label: "web.dev · Learn Performance", url: "https://web.dev/learn/performance" },
    ],
  },

  {
    id: "kc-open-communicate",
    categoryId: "written-open",
    title: "技术表达：背景—方案—权衡—风险",
    stage: "入门",
    summary:
      "开放题没有标准答案，评的是结构：你能不能在三分钟内让人听懂问题、选择和代价。",
    points: [
      "先给结论，再展开理由（面试官时间有限）",
      "用数字锚定：QPS、数据量、包体、耗时，避免「很快」「很大」",
      "主动说风险与不选的理由，比只讲优点更可信",
      "留一个「如果时间更多会怎么改」的余地",
    ],
    links: [
      { label: "MDN · 学习 Web 开发", url: "https://developer.mozilla.org/zh-CN/docs/Learn" },
    ],
  },
  {
    id: "kc-open-review",
    categoryId: "written-open",
    title: "项目复盘：把经历讲成可验证的能力",
    stage: "进阶",
    summary:
      "「你最有成就感的项目」考的是复盘深度：背景、你的决策、结果数据、事后反思，缺一项都会显得像流水账。",
    points: [
      "用 STAR 但重点放在 A（Action）里的**决策点**，不是任务清单",
      "准备两个失败案例：说清误判原因与后续改进机制",
      "数据兜底：没有精确指标就用「从几秒到几秒」「错误率降了多少」",
      "能被追问三层：为什么这么做、有没有别的方案、重来会怎么改",
    ],
    upstream: "先梳理清项目的时间线与你的职责边界",
    links: [
      { label: "System Design Primer · 复盘与面试", url: "https://github.com/donnemartin/system-design-primer#how-to-approach-a-system-design-interview-question" },
    ],
  },

  // ── 基础知识库 ────────────────────────────────────────────
  {
    id: "kc-html-semantic",
    categoryId: "foundation-html",
    title: "语义化与可访问性：HTML 是结构不是样式",
    stage: "入门",
    summary:
      "语义化不是为了「规范好看」，而是让屏幕阅读器、搜索引擎、键盘操作都能正确理解页面。",
    points: [
      "用 button 而不是 div 做按钮：自带键盘、焦点、role",
      "标题层级 h1-h6 不跳级；一页一个 h1",
      "表单用 label 关联，错误提示用 aria-describedby 连接",
      "图片 alt 分两类：信息型描述内容，装饰型留空",
    ],
    downstream: "接着看 WAI-ARIA 的角色与状态，以及键盘焦点管理",
    links: [
      { label: "MDN · HTML 元素参考", url: "https://developer.mozilla.org/zh-CN/docs/Web/HTML/Element" },
      { label: "web.dev · Learn HTML", url: "https://web.dev/learn/html" },
    ],
  },
  {
    id: "kc-html-loading",
    categoryId: "foundation-html",
    title: "资源加载：async、defer、preload、prefetch 的区别",
    stage: "进阶",
    summary:
      "脚本放哪里、用什么属性，直接决定首屏是不是白屏；这四个属性经常被混用。",
    points: [
      "普通 script：阻塞解析，下载完立刻执行",
      "defer：并行下载，DOM 解析完后按顺序执行（推荐放在 head）",
      "async：并行下载，下载完立刻执行，顺序不保证（适合独立统计脚本）",
      "preload 是「本页马上要用」，prefetch 是「下个页面可能用」，别互相替代",
      "module 脚本默认带 defer 语义",
    ],
    upstream: "浏览器渲染管线（解析 → 构建 DOM）",
    links: [
      { label: "MDN · script 元素", url: "https://developer.mozilla.org/zh-CN/docs/Web/HTML/Element/script" },
      { label: "web.dev · 资源优先级", url: "https://web.dev/articles/fetch-priority" },
    ],
  },
  {
    id: "kc-html-form",
    categoryId: "foundation-html",
    title: "原生表单能力：校验、输入类型与移动键盘",
    stage: "进阶",
    summary:
      "很多团队用 JS 重造了浏览器已经提供的能力；原生表单在移动端能唤起正确的键盘、支持自动填充。",
    points: [
      "input type 决定移动端键盘（tel/email/number/url）",
      "required / pattern / minlength 提供零 JS 的约束校验",
      "autocomplete 让密码管理器正常工作，登录转化率相关",
      "自定义校验用 setCustomValidity，配合 :invalid 样式",
    ],
    upstream: "语义化标签与 label 关联",
    links: [
      { label: "MDN · 表单指南", url: "https://developer.mozilla.org/zh-CN/docs/Learn/Forms" },
    ],
  },

  {
    id: "kc-css-layout",
    categoryId: "foundation-css",
    title: "布局主干：正常流、Flex、Grid 各自解决什么",
    stage: "入门",
    summary:
      "布局题的核心不是背属性，而是判断「这个结构该用哪个模型」：一维排列用 Flex，二维对齐用 Grid，文字流用正常流。",
    points: [
      "Flex：主轴/交叉轴、flex-grow/shrink/basis 三者共同决定尺寸",
      "Grid：显式网格 + 隐式网格、minmax 与 auto-fit 做自适应列",
      "定高容器里的子项要 min-height: 0，否则无法收缩",
      "居中方案按场景选：flex 居中、grid place-items、margin auto",
    ],
    downstream: "接着看层叠上下文与包含块，理解为什么定位会「跑出父级」",
    links: [
      { label: "web.dev · Learn CSS", url: "https://web.dev/learn/css" },
      { label: "CSS-Tricks · Grid 完全指南", url: "https://css-tricks.com/snippets/css/complete-guide-grid/" },
    ],
  },
  {
    id: "kc-css-cascade",
    categoryId: "foundation-css",
    title: "层叠、优先级与层叠上下文",
    stage: "进阶",
    summary:
      "「样式不生效」九成是优先级或层叠上下文问题；搞清这两件事，就不用到处写 !important。",
    points: [
      "优先级是四元组（内联、id、class/属性/伪类、元素/伪元素），不是简单计数",
      "同优先级看源码顺序，后写的赢",
      "transform / filter / opacity < 1 / position+z-index 会创建层叠上下文，z-index 只在同一上下文内比较",
      "BFC 解决外边距塌陷与浮动包围；现代布局优先用 flex/grid 规避",
    ],
    upstream: "盒模型与正常流",
    links: [
      { label: "MDN · 层叠与继承", url: "https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_cascade" },
    ],
  },
  {
    id: "kc-css-responsive",
    categoryId: "foundation-css",
    title: "响应式：媒体查询、容器查询与流体尺寸",
    stage: "深入",
    summary:
      "响应式从「按屏幕宽度断点」进化到「按容器宽度自适应」，组件化项目里容器查询更合适。",
    points: [
      "媒体查询看视口，容器查询看父容器（@container），后者更适合复用组件",
      "流体尺寸：clamp(min, 百分比/视口单位, max) 减少断点数量",
      "移动端安全区 env(safe-area-inset-*) 处理刘海屏",
      "图片用 srcset + sizes 让浏览器按 DPR 与布局宽度选图",
    ],
    upstream: "Flex/Grid 与相对单位",
    links: [
      { label: "web.dev · 容器查询", url: "https://web.dev/articles/cq-stable" },
      { label: "MDN · 响应式设计", url: "https://developer.mozilla.org/zh-CN/docs/Learn/CSS/CSS_layout/Responsive_Design" },
    ],
  },

  {
    id: "kc-js-scope",
    categoryId: "foundation-js",
    title: "执行上下文、作用域链与闭包",
    stage: "入门",
    summary:
      "闭包不是语法特性，而是「函数记住了它出生时的词法环境」这一事实的副产品；理解它才能解释内存与循环变量的问题。",
    points: [
      "每次函数调用创建执行上下文：变量环境、词法环境、this",
      "作用域在**定义时**确定（词法作用域），与调用位置无关",
      "闭包持有外层变量引用，可能导致本该回收的对象无法回收",
      "var 是函数作用域且提升为 undefined，let/const 是块级作用域且有暂时性死区",
    ],
    downstream: "接着看 this 绑定与原型链，这两块共同构成「对象与调用」模型",
    links: [
      { label: "MDN · 闭包", url: "https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Closures" },
      { label: "zh.javascript.info · 闭包", url: "https://zh.javascript.info/closure" },
    ],
  },
  {
    id: "kc-js-object-model",
    categoryId: "foundation-js",
    title: "原型链、this 与继承",
    stage: "进阶",
    summary:
      "JS 的对象模型只有两条规则：属性查找沿原型链向上，this 由调用方式决定。绝大多数「诡异行为」都是这两条的推论。",
    points: [
      "prototype 是函数上的对象，__proto__（[[Prototype]]）是实例的查找链",
      "new 四步：建对象 → 连原型 → 执行构造函数 → 返回值判定（对象或函数则采用）",
      "class 是语法糖，但 super 与字段初始化语义有差异",
      "Object.create(null) 创建无原型对象，适合做纯字典",
    ],
    upstream: "作用域与函数调用",
    downstream: "读框架源码时的继承结构（Component、Vue 实例）会一目了然",
    links: [
      { label: "MDN · 继承与原型链", url: "https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Inheritance_and_the_prototype_chain" },
    ],
  },
  {
    id: "kc-js-async",
    categoryId: "foundation-js",
    title: "事件循环：宏任务、微任务与渲染",
    stage: "深入",
    summary:
      "「为什么 Promise 比 setTimeout 先执行」只是入口，真正要掌握的是：一轮循环里谁先谁后、渲染插在哪里、长任务为什么会掉帧。",
    points: [
      "一轮：一个宏任务 → 清空所有微任务 → 需要时渲染 → 下一个宏任务",
      "微任务队列在清空过程中可以继续追加（then 里再 then 不会等到下一轮）",
      "await 之后是微任务；async 函数同步执行到第一个 await",
      "渲染不是每轮都发生，浏览器按需合并；长任务会推迟渲染",
      "Node 侧另有六个阶段与 process.nextTick（优先于 Promise）",
    ],
    diagramId: "dg-event-loop",
    upstream: "调用栈与任务队列的基本概念",
    downstream: "性能侧的「长任务拆分」与「让出主线程」",
    links: [
      { label: "MDN · 事件循环", url: "https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Event_loop" },
      { label: "Node.js · 事件循环", url: "https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick" },
    ],
  },
  {
    id: "kc-js-modern",
    categoryId: "foundation-js",
    title: "现代语法与语言演进",
    stage: "进阶",
    summary:
      "每年新增的语法不必全用，但要知道它们解决什么问题（可选链、空值合并、迭代器、顶层 await、结构化克隆）。",
    points: [
      "TC39 五阶段流程：Stage 3 才适合在产品里用（需转译）",
      "Iterable/Iterator 协议是 for...of、展开、解构、生成器的共同基础",
      "Proxy/Reflect 是框架响应式的基石",
      "structuredClone 支持循环引用，但不支持函数与原型",
    ],
    upstream: "对象与原型模型",
    links: [
      { label: "TC39 提案列表", url: "https://github.com/tc39/proposals" },
      { label: "MDN · JavaScript 参考", url: "https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference" },
    ],
  },

  {
    id: "kc-ts-types",
    categoryId: "foundation-ts",
    title: "类型系统：结构类型、收窄与泛型",
    stage: "入门",
    summary:
      "TS 是结构化类型系统：只要形状满足就兼容；理解收窄（narrowing）比记工具类型更有用。",
    points: [
      "类型兼容看结构不看名字；多余属性检查只在字面量赋值时触发",
      "收窄手段：typeof、instanceof、in、字面量判别、类型谓词 is",
      "unknown 比 any 安全：使用前必须收窄",
      "泛型是「类型参数」，约束用 extends，默认值用 =",
    ],
    downstream: "接着看条件类型、映射类型与模板字面量类型",
    links: [
      { label: "TS 手册 · 日常类型", url: "https://www.typescriptlang.org/docs/handbook/2/everyday-types.html" },
      { label: "TS 手册 · 类型收窄", url: "https://www.typescriptlang.org/docs/handbook/2/narrowing.html" },
    ],
  },
  {
    id: "kc-ts-advanced",
    categoryId: "foundation-ts",
    title: "类型编程：条件、映射与模板字面量",
    stage: "深入",
    summary:
      "类型体操的价值在于「让约束替你做 review」：把运行时约定提升到编译期，错误在写代码时就暴露。",
    points: [
      "条件类型 + infer 做类型解构（ReturnType、Parameters 都是这么实现的）",
      "映射类型 + keyof 做批量变换；+/- readonly、? 控制可选",
      "模板字面量类型做事件名、路由参数、CSS 属性名的强类型",
      "分布式条件类型与 never 过滤是「类型集合运算」的两个关键",
    ],
    upstream: "泛型与联合类型",
    links: [
      { label: "type-challenges（类型体操题库）", url: "https://github.com/type-challenges/type-challenges" },
      { label: "TS 手册 · 类型操作", url: "https://www.typescriptlang.org/docs/handbook/2/types-from-types.html" },
    ],
  },
  {
    id: "kc-ts-engineering",
    categoryId: "foundation-ts",
    title: "工程配置：strict、声明文件与类型边界",
    stage: "进阶",
    summary:
      "类型安全的上限由 tsconfig 决定；strict 全开 + 明确的边界类型，比写更多类型注解更有效。",
    points: [
      "strict 家族：strictNullChecks、noImplicitAny、strictFunctionTypes 各自拦什么",
      "外部数据（接口响应、localStorage）必须视为 unknown 再做运行时校验",
      "声明文件：为无类型的库补 .d.ts，或写 declare module 兜底",
      "构建工具只转译不做类型检查，CI 里必须单独跑 tsc --noEmit",
    ],
    upstream: "类型收窄与泛型",
    links: [
      { label: "TSConfig 参考", url: "https://www.typescriptlang.org/tsconfig" },
    ],
  },

  {
    id: "kc-react-vdom",
    categoryId: "foundation-react",
    title: "虚拟 DOM：这一层到底解决了什么",
    stage: "入门",
    summary:
      "虚拟 DOM 不是「比原生快」，而是把 UI 变成可比较的数据结构：先在内存里算出差异，再批量落到真实 DOM。",
    points: [
      "组件返回的是描述对象（vnode），一次更新 = 建树 → 比较 → 提交三步",
      "真正的成本在比较：靠「同层 + 类型 + key」把 O(n³) 的树编辑距离压到 O(n)",
      "手写 DOM 也能很快，但状态一多就难以保证「每次更新只改该改的」，这才是声明式的价值",
      "跨平台能力也来自这一层：同一份 vnode 可以渲染到 Canvas、Native 或终端",
    ],
    diagramId: "dg-vdom",
    downstream: "Fiber 的可中断渲染与两阶段提交",
    links: [
      { label: "react.dev · 渲染与提交", url: "https://react.dev/learn/render-and-commit" },
      { label: "react.dev · 保持组件纯粹", url: "https://react.dev/learn/keeping-components-pure" },
    ],
  },
  {
    id: "kc-react-model",
    categoryId: "foundation-react",
    title: "渲染模型：Fiber、协调与提交",
    stage: "进阶",
    summary:
      "React 的心智模型是「UI = f(state)」：渲染是计算，提交才是副作用；所有最佳实践都从这条分界推出来。",
    points: [
      "render 阶段可中断、必须纯净；commit 阶段同步、才允许操作 DOM",
      "协调（reconciliation）靠 type + key 判断复用",
      "双缓冲：current 与 workInProgress 两棵树，提交时切指针",
      "并发特性的前提是渲染无副作用，否则中断重放会出问题",
    ],
    diagramId: "dg-fiber",
    upstream: "组件、props 与状态的基本用法",
    downstream: "接着看 Hooks 的实现（链表）与调度器（Lane）",
    links: [
      { label: "react.dev · 学习 React", url: "https://react.dev/learn" },
      { label: "react.dev · 参考手册", url: "https://react.dev/reference/react" },
    ],
  },
  {
    id: "kc-react-diff",
    categoryId: "foundation-react",
    title: "Diff：同层比较、类型判断与 key 复用",
    stage: "深入",
    summary:
      "两棵树的最小编辑距离是 O(n³)，React 用三个假设把它降成 O(n)：只比同层、类型不同就重建、同层按 key 配对。",
    points: [
      "跨层级移动一律拆成「删除旧的 + 新建新的」，所以别为了「结构更清晰」频繁改 DOM 层级",
      "类型不同直接销毁整棵子树：div ↔ span 的切换会丢 state，也会丢输入框焦点",
      "key 只在同一层内生效且必须稳定；用下标当 key 在头部插入时会让所有节点错位复用",
      "diff 只产出副作用队列，真正改 DOM 在 commit 阶段一次做完",
    ],
    diagramId: "dg-react-diff",
    upstream: "虚拟 DOM 与 Fiber 的两阶段模型",
    downstream: "对比 Vue 3 的预处理 + LIS 方案，理解两套 diff 的取舍",
    links: [
      { label: "react.dev · 渲染与提交", url: "https://react.dev/learn/render-and-commit" },
      { label: "react.dev · key 的作用", url: "https://react.dev/learn/rendering-lists" },
    ],
  },
  {
    id: "kc-react-hooks",
    categoryId: "foundation-react",
    title: "Hooks 心智模型：快照、依赖与副作用",
    stage: "深入",
    summary:
      "每个 state 都是那一次渲染的快照；effect 是「把外部系统同步到当前快照」，而不是「监听某个变量」。",
    points: [
      "state 不可变、按调用顺序存链表；条件调用会让顺序错位",
      "依赖数组是「这次渲染用到的外部值」，漏了就是闭包陷阱",
      "effect 用于同步外部系统（订阅、DOM、请求），派生状态用渲染期计算",
      "清理函数必须与 setup 对称；StrictMode 双执行是为了暴露不彻底的清理",
      "需要「读最新值但不重建副作用」用 ref 镜像或 useEffectEvent",
    ],
    upstream: "渲染模型与状态快照",
    downstream: "数据获取（Suspense/use）与性能（memo/Compiler）",
    links: [
      { label: "react.dev · 副作用", url: "https://react.dev/learn/synchronizing-with-effects" },
      { label: "react.dev · 你可能不需要 Effect", url: "https://react.dev/learn/you-might-not-need-an-effect" },
    ],
  },
  {
    id: "kc-react-data",
    categoryId: "foundation-react",
    title: "数据获取：Suspense、RSC 与请求库的分工",
    stage: "深入",
    summary:
      "React 19 之后「在哪取数」有了三种答案：客户端请求库、Suspense + use、服务端组件；选错会导致瀑布或重复请求。",
    points: [
      "客户端：请求库负责缓存、去重、失效、重试（SWR/TanStack Query）",
      "Suspense + use：只解决「读已存在的 promise」，不解决缓存",
      "RSC：在服务端执行、产出可序列化 payload，组件不进客户端 bundle",
      "瀑布消除：并行发起请求、预加载、服务端一次取齐",
    ],
    upstream: "Hooks 与状态快照",
    links: [
      { label: "react.dev · use", url: "https://react.dev/reference/react/use" },
      { label: "react.dev · Server Components", url: "https://react.dev/reference/rsc/server-components" },
    ],
  },
  {
    id: "kc-react-perf",
    categoryId: "foundation-react",
    title: "React 性能：先量化再优化",
    stage: "深入",
    summary:
      "大部分「React 卡」不是 React 的问题，而是渲染量或计算量太大；Profiler 之前不要写 useMemo。",
    points: [
      "用 Profiler 找「为什么渲染」：props 变化、context 变化、父组件重渲染",
      "memo 只在 props 引用稳定时有效；每次新建对象会让它失效",
      "长列表用虚拟滚动，比任何 memo 都有效",
      "React Compiler 自动缓存重复计算，但不改变渲染量",
    ],
    upstream: "渲染模型与 Hooks",
    links: [
      { label: "react.dev · 性能", url: "https://react.dev/learn/render-and-commit" },
      { label: "React DevTools Profiler", url: "https://react.dev/learn/react-developer-tools" },
    ],
  },

  {
    id: "kc-vue-reactivity",
    categoryId: "foundation-vue",
    title: "响应式原理：Proxy、依赖收集与触发",
    stage: "进阶",
    summary:
      "Vue 3 的响应式是「读时收集、写时触发」：effect 里读到谁就订阅谁，改谁就重跑依赖它的 effect。",
    points: [
      "targetMap: target → key → Set<effect>，WeakMap 避免内存泄漏",
      "track 在 get 里收集，trigger 在 set 里派发；Reflect 保证 receiver 正确",
      "computed 是惰性 effect，带 dirty 标记；watch 是主动 effect，可配置 flush",
      "ref 用 getter/setter 包装 value，reactive 用 Proxy 代理对象",
    ],
    diagramId: "dg-vue-reactivity",
    upstream: "JS 的 Proxy/Reflect 与闭包",
    downstream: "组件更新与调度（微任务批处理、nextTick）",
    links: [
      { label: "vuejs.org · 响应式深入", url: "https://cn.vuejs.org/guide/extras/reactivity-in-depth.html" },
      { label: "vuejs.org · 响应式基础", url: "https://cn.vuejs.org/guide/essentials/reactivity-fundamentals.html" },
    ],
  },
  {
    id: "kc-vue-diff",
    categoryId: "foundation-vue",
    title: "Diff：掐头去尾、key 映射与 LIS 最小移动",
    stage: "深入",
    summary:
      "Vue 3 的更新策略是「能直接复用的先剥掉，剩下的用最长递增子序列算出可以不动的那批」，移动次数最少。",
    points: [
      "无 key 时按下标逐位 patch，不做移动，等价于「就地复用」，只适合纯静态列表",
      "有 key 先掐头去尾：纯追加 / 纯删除 / 只改中间这几种常见场景的预处理都是 O(1)",
      "中段建 key → 新索引映射，遍历时从后往前插入，锚点是「下一个已处理节点」",
      "LIS 标出相对顺序已经正确的节点，只移动剩下的，把 DOM 移动次数压到最小",
    ],
    diagramId: "dg-vue3-diff",
    upstream: "响应式与虚拟 DOM",
    downstream: "读 runtime-core 的 patchKeyedChildren，理解 LIS 返回的到底是下标还是值",
    links: [
      { label: "vuejs.org · 渲染机制", url: "https://cn.vuejs.org/guide/extras/rendering-mechanism.html" },
      { label: "Vue 3 源码 · renderer.ts", url: "https://github.com/vuejs/core/blob/main/packages/runtime-core/src/renderer.ts" },
    ],
  },
  {
    id: "kc-vue-component",
    categoryId: "foundation-vue",
    title: "组件与组合式 API：逻辑复用怎么做",
    stage: "入门",
    summary:
      "Composition API 的核心价值是「按功能聚合 + 可传参复用」；把逻辑写成 useXxx 是 Vue 3 项目的基本功。",
    points: [
      "props 单向数据流，子改父必须 emit",
      "composable 命名 useXxx，返回值显式列出（便于阅读与 tree-shaking）",
      "生命周期在 setup 内同步注册；异步注册无效",
      "provide/inject 做跨层注入，但要给默认值与 Symbol key",
    ],
    downstream: "状态管理（Pinia）与路由（Vue Router 4）",
    links: [
      { label: "vuejs.org · 组合式 API", url: "https://cn.vuejs.org/guide/reusability/composables.html" },
    ],
  },
  {
    id: "kc-vue-compiler",
    categoryId: "foundation-vue",
    title: "编译优化：静态提升、patchFlag 与 Block Tree",
    stage: "深入",
    summary:
      "Vue 3 的快来自编译期：模板编译时就知道哪些节点是静态的、哪些绑定会变，运行时只 diff 动态部分。",
    points: [
      "静态节点提升到 render 外，只创建一次",
      "patchFlag 标记「这个节点的哪部分是动态的」（文本/class/props）",
      "Block Tree 把动态节点收集成扁平数组，diff 时跳过静态结构",
      "v-if 会创建 block；v-for 需要 key 才能正确复用",
    ],
    upstream: "模板语法与虚拟 DOM 概念",
    links: [
      { label: "vuejs.org · 渲染机制", url: "https://cn.vuejs.org/guide/extras/rendering-mechanism.html" },
    ],
  },
  {
    id: "kc-vue-ecosystem",
    categoryId: "foundation-vue",
    title: "生态与工程：Router、Pinia、Nuxt",
    stage: "进阶",
    summary:
      "Vue 项目的复杂度主要在生态选型：路由模式、状态边界、SSR 与否，决定了目录结构与部署方式。",
    points: [
      "Vue Router 4：createRouter、history 模式需要服务端 fallback",
      "Pinia：setup store 写法，getters 即 computed，别把服务端数据与 UI 状态混放",
      "Nuxt：约定式路由 + SSR/SSG，注意 hydration 一致性与服务端无 window",
      "按需引入与自动导入（unplugin-auto-import）能减少样板，但要控制隐式依赖",
    ],
    upstream: "组件与组合式 API",
    links: [
      { label: "Pinia 文档", url: "https://pinia.vuejs.org/zh/" },
      { label: "Vue Router 文档", url: "https://router.vuejs.org/zh/" },
      { label: "Nuxt 文档", url: "https://nuxt.com/docs" },
    ],
  },

  {
    id: "kc-electron-process",
    categoryId: "foundation-electron",
    title: "进程模型与 IPC：谁是唯一事实源",
    stage: "入门",
    summary:
      "Electron 的架构问题几乎都能归结为一句话：渲染进程不可信、主进程是唯一能碰系统资源的地方。",
    points: [
      "主进程：窗口、菜单、文件、数据库；渲染进程：只负责 UI",
      "invoke/handle 是请求响应，send/on 是单向；成对注册与清理",
      "preload 是桥，用 contextBridge 暴露白名单方法，不暴露 ipcRenderer 本体",
      "状态放主进程（单一事实源），多窗口通过广播同步",
    ],
    diagramId: "dg-electron-arch",
    downstream: "安全基线（contextIsolation、sandbox、CSP）",
    links: [
      { label: "Electron · 进程模型", url: "https://www.electronjs.org/docs/latest/tutorial/process-model" },
      { label: "Electron · IPC", url: "https://www.electronjs.org/docs/latest/tutorial/ipc" },
    ],
  },
  {
    id: "kc-electron-security",
    categoryId: "foundation-electron",
    title: "安全基线：三件套 + CSP + 导航拦截",
    stage: "深入",
    summary:
      "Electron 的安全清单是硬要求：一项没配，等于把 Node 交给页面里的任意脚本。",
    points: [
      "contextIsolation: true、nodeIntegration: false、sandbox: true 三件套",
      "禁止 remote 模块；所有能力经 preload 白名单暴露",
      "CSP 限制脚本来源；拦截 will-navigate 与 window.open，外链交给 shell.openExternal",
      "加载远程内容必须校验协议与域名，绝不加载不可信页面",
    ],
    upstream: "进程模型与 IPC",
    links: [
      { label: "Electron · 安全检查清单", url: "https://www.electronjs.org/docs/latest/tutorial/security" },
    ],
  },
  {
    id: "kc-electron-delivery",
    categoryId: "foundation-electron",
    title: "打包、签名与更新",
    stage: "进阶",
    summary:
      "桌面端交付比 Web 复杂一个数量级：安装包、签名、自动更新、崩溃率，每一项都是上线门槛。",
    points: [
      "electron-builder / electron-forge 二选一，产物按平台分别配置",
      "asar 打包源码，原生模块与需要读的资源排除在外",
      "代码签名是自动更新的前置条件（Windows/macOS 都拦未签名应用）",
      "electron-updater：差分下载、灰度渠道、失败回滚",
    ],
    upstream: "进程模型与资源路径（app.getAppPath）",
    links: [
      { label: "electron-builder 文档", url: "https://www.electron.build/" },
      { label: "Electron · 代码签名", url: "https://www.electronjs.org/docs/latest/tutorial/code-signing" },
    ],
  },
  {
    id: "kc-electron-runtime",
    categoryId: "foundation-electron",
    title: "性能与稳定性：启动、内存、崩溃",
    stage: "深入",
    summary:
      "桌面应用的体验基准比 Web 高：冷启动超过 3 秒、内存 800MB、偶尔白屏，用户就会卸载。",
    points: [
      "启动：延迟创建窗口、避免主进程同步 IO、开 V8 code cache",
      "内存：窗口关闭要 destroy、大 Buffer 不要走 IPC 复制、图片用缩略图",
      "崩溃：render-process-gone / unresponsive 事件 + crashReporter",
      "CPU 密集任务放 utilityProcess，别占主进程",
    ],
    upstream: "进程模型与 IPC 序列化成本",
    links: [
      { label: "Electron · 性能", url: "https://www.electronjs.org/docs/latest/tutorial/performance" },
    ],
  },

  {
    id: "kc-node-loop",
    categoryId: "foundation-node",
    title: "Node 的事件循环与异步 IO",
    stage: "入门",
    summary:
      "Node 的单线程指的是 JS 执行线程；IO 由 libuv 线程池与事件循环驱动，理解阶段顺序才能解释「为什么回调顺序是这样」。",
    points: [
      "六个阶段：timers → pending → poll → check → close，之间清空微任务",
      "process.nextTick 优先于 Promise 微任务",
      "poll 阶段阻塞等待 IO，是「空闲」发生的地方",
      "setImmediate 与 setTimeout(0) 的顺序取决于调用位置",
    ],
    diagramId: "dg-node-loop",
    downstream: "流与背压、Worker 与 cluster",
    links: [
      { label: "Node.js · 事件循环指南", url: "https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick" },
    ],
  },
  {
    id: "kc-node-stream",
    categoryId: "foundation-node",
    title: "流与背压：大文件为什么不能一次读完",
    stage: "进阶",
    summary:
      "流解决的是内存与速率先配问题：生产快于消费时必须能暂停，这就是背压。",
    points: [
      "四种流：Readable / Writable / Duplex / Transform",
      "pipe 自动处理背压；手写 write 返回 false 时必须等 drain",
      "pipeline 能在出错时销毁整条链路，优于裸 pipe",
      "对象模式与 highWaterMark 决定缓冲策略",
    ],
    upstream: "事件循环与 Buffer",
    links: [
      { label: "Node.js · Stream 文档", url: "https://nodejs.org/api/stream.html" },
    ],
  },
  {
    id: "kc-node-concurrency",
    categoryId: "foundation-node",
    title: "并发模型：cluster、worker_threads 与优雅退出",
    stage: "深入",
    summary:
      "Node 不适合 CPU 密集任务；多进程扩吞吐、多线程跑计算，两者解决的问题不同。",
    points: [
      "cluster：多进程共享端口，适合 Web 服务扩 CPU 核数",
      "worker_threads：同进程多线程，适合加解密、图片处理、大 JSON 解析",
      "优雅退出：监听 SIGTERM，停止接收新请求、等现有任务完成、关连接池",
      "内存与句柄排查：--inspect + heap snapshot、process.report",
    ],
    upstream: "事件循环与流",
    links: [
      { label: "Node.js · worker_threads", url: "https://nodejs.org/api/worker_threads.html" },
      { label: "Node.js · cluster", url: "https://nodejs.org/api/cluster.html" },
    ],
  },

  {
    id: "kc-mobile-viewport",
    categoryId: "foundation-mobile",
    title: "视口与适配：从 viewport 到安全区",
    stage: "入门",
    summary:
      "移动端适配的本质是「让 CSS 像素与设备像素解耦」，viewport meta、vw、rem 都只是手段。",
    points: [
      "必须写 viewport meta，否则 980px 布局视口会被缩放",
      "DPR 决定 1px 边框问题，用 transform scale 或 0.5px + 媒体查询",
      "vw/vh 在移动端有地址栏高度问题，优先 dvh/svh",
      "安全区 env(safe-area-inset-*) 配合 viewport-fit=cover",
    ],
    downstream: "触摸事件、滚动性能与跨端方案",
    links: [
      { label: "web.dev · 视口", url: "https://web.dev/articles/viewport" },
      { label: "MDN · env()", url: "https://developer.mozilla.org/zh-CN/docs/Web/CSS/env" },
    ],
  },
  {
    id: "kc-mobile-interaction",
    categoryId: "foundation-mobile",
    title: "触摸与滚动：300ms、passive 与惯性滚动",
    stage: "进阶",
    summary:
      "移动端交互的坑集中在滚动与点击：谁在等谁、谁阻止了谁，决定了「跟不跟手」。",
    points: [
      "现代浏览器已移除 300ms 延迟，但 touch 与 click 仍可能双触发",
      "滚动监听加 { passive: true } 避免阻塞滚动线程",
      "overflow 滚动与 body 滚动要区分，弹层打开时锁 body 会导致位置跳动",
      "-webkit-overflow-scrolling 已废弃，用 overscroll-behavior 控制链式滚动",
    ],
    upstream: "视口与 CSS 布局",
    links: [
      { label: "MDN · 触摸事件", url: "https://developer.mozilla.org/zh-CN/docs/Web/API/Touch_events" },
      { label: "web.dev · 滚动与被动监听", url: "https://web.dev/articles/using-passive-scroll-listeners" },
    ],
  },
  {
    id: "kc-mobile-crossplatform",
    categoryId: "foundation-mobile",
    title: "跨端选型：H5、Hybrid、RN、Flutter",
    stage: "深入",
    summary:
      "跨端没有银弹：一致性、性能、生态、包体四者互相牵制，选型要看团队与场景而不是潮流。",
    points: [
      "H5：最灵活、可热更，性能与体验受 WebView 限制",
      "Hybrid：WebView + 原生桥，适合内容型 + 少量原生能力",
      "React Native：原生渲染、JS 逻辑，生态成熟但版本升级痛",
      "Flutter：自绘引擎、一致性最好，包体与 Dart 学习成本是代价",
      "决策维度：交互复杂度、团队技能、是否需要热更、包体预算",
    ],
    upstream: "移动端渲染与交互基础",
    links: [
      { label: "React Native 文档", url: "https://reactnative.dev/docs/getting-started" },
      { label: "Flutter 文档", url: "https://docs.flutter.dev/" },
    ],
  },

  {
    id: "kc-mp-architecture",
    categoryId: "foundation-miniprogram",
    title: "双线程模型与 setData 成本",
    stage: "入门",
    summary:
      "小程序把逻辑层与渲染层分到两个线程，靠桥通信；setData 是唯一的数据通道，所以它最贵。",
    points: [
      "逻辑层（JSCore）与渲染层（WebView）隔离，无法直接操作 DOM",
      "setData 要序列化 + 跨线程传输，数据量越大越慢",
      "只 set 变化的字段（用路径写法），避免整个对象重传",
      "频繁更新合并到一次 setData；列表用 key 复用",
    ],
    diagramId: "dg-miniprogram-thread",
    downstream: "分包加载与性能优化",
    links: [
      { label: "微信小程序 · 框架", url: "https://developers.weixin.qq.com/miniprogram/dev/framework/" },
      { label: "微信小程序 · 性能优化", url: "https://developers.weixin.qq.com/miniprogram/dev/framework/performance/tips.html" },
    ],
  },
  {
    id: "kc-mp-package",
    categoryId: "foundation-miniprogram",
    title: "分包与首屏：主包体积是硬约束",
    stage: "进阶",
    summary:
      "小程序主包有体积上限，分包不是优化项而是必需项；先把首屏不需要的都挪出去。",
    points: [
      "主包只放 TabBar 页面与公共依赖，其余按业务分包",
      "分包预下载（preloadRule）改善跳转体验",
      "独立分包可脱离主包运行，适合活动页",
      "图片与静态资源上 CDN，别塞进包内",
    ],
    upstream: "双线程模型",
    links: [
      { label: "微信小程序 · 分包加载", url: "https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages/basic.html" },
    ],
  },
  {
    id: "kc-mp-capability",
    categoryId: "foundation-miniprogram",
    title: "登录、授权与开放能力",
    stage: "深入",
    summary:
      "小程序登录不是「拿到 code 就完事」：code 只能换 openid，会话必须由自己的服务端签发。",
    points: [
      "wx.login 拿 code → 后端 code2session 换 openid/session_key → 自建 token",
      "手机号需要用户主动点击授权（button open-type）",
      "订阅消息要用户逐次授权，不能静默推送",
      "审核合规：类目、隐私协议、内容安全接口",
    ],
    upstream: "双线程模型与网络请求限制",
    links: [
      { label: "微信小程序 · 登录", url: "https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/login.html" },
    ],
  },

  {
    id: "kc-browser-pipeline",
    categoryId: "foundation-browser",
    title: "渲染管线：从 HTML 到像素",
    stage: "入门",
    summary:
      "解析 → 样式 → 布局 → 绘制 → 合成；知道每一步做什么，才知道改哪个属性会触发重排、哪个只触发合成。",
    points: [
      "DOM + CSSOM → Render Tree → Layout（几何）→ Paint（绘制指令）→ Composite（合成层）",
      "改 width/height/top 触发 layout；改 color 触发 paint；改 transform/opacity 只走合成",
      "will-change 与 transform 能提升为独立合成层，但滥用会吃显存",
      "requestAnimationFrame 在渲染前执行，适合做动画",
    ],
    diagramId: "dg-browser-render",
    downstream: "性能优化与 Core Web Vitals",
    links: [
      { label: "web.dev · 渲染性能", url: "https://web.dev/articles/rendering-performance" },
      { label: "Chrome DevTools · Performance", url: "https://developer.chrome.com/docs/devtools/performance" },
    ],
  },
  {
    id: "kc-browser-storage",
    categoryId: "foundation-browser",
    title: "存储选型：Cookie、Storage、IndexedDB、Cache",
    stage: "进阶",
    summary:
      "四种存储的差异不只是容量：同步阻塞、是否随请求发送、能否被 Worker 访问，决定了用哪个。",
    points: [
      "Cookie：4KB、每次请求自动携带、可设 HttpOnly/SameSite",
      "localStorage：5MB、同步阻塞主线程、永久（需手动清）",
      "sessionStorage：标签页级隔离，刷新保留、新标签不共享",
      "IndexedDB：异步、大容量、支持索引与事务，适合离线数据",
      "Cache API 配合 Service Worker 做资源缓存",
    ],
    upstream: "同源策略与安全模型",
    links: [
      { label: "MDN · IndexedDB", url: "https://developer.mozilla.org/zh-CN/docs/Web/API/IndexedDB_API" },
      { label: "MDN · Storage API", url: "https://developer.mozilla.org/zh-CN/docs/Web/API/Storage" },
    ],
  },
  {
    id: "kc-browser-thread",
    categoryId: "foundation-browser",
    title: "浏览器进程与线程模型",
    stage: "深入",
    summary:
      "浏览器是多进程架构：主线程负责 JS 与渲染，阻塞它就是阻塞一切；耗时任务必须挪到 Worker。",
    points: [
      "浏览器进程、渲染进程（每个站点一个）、GPU 进程、网络进程",
      "渲染进程内：主线程（JS/样式/布局）、合成线程、光栅线程",
      "主线程被长任务占用 → 输入延迟、掉帧、INP 变差",
      "Web Worker 不能操作 DOM；SharedArrayBuffer 需要跨源隔离头",
    ],
    upstream: "事件循环与渲染管线",
    links: [
      { label: "Chrome · 多进程架构", url: "https://www.chromium.org/developers/design-documents/multi-process-architecture/" },
      { label: "web.dev · 长任务", url: "https://web.dev/articles/long-tasks-devtools" },
    ],
  },

  {
    id: "kc-net-http",
    categoryId: "foundation-network",
    title: "HTTP 版本演进：1.1 → 2 → 3",
    stage: "入门",
    summary:
      "三代协议解决的是同一个问题：如何在一条连接上更高效地传更多东西；理解演进动机比背特性有用。",
    points: [
      "HTTP/1.1：文本协议、队头阻塞、浏览器 6 并发、Keep-Alive",
      "HTTP/2：二进制分帧、多路复用、HPACK 头压缩；仍受 TCP 层队头阻塞",
      "HTTP/3：基于 QUIC（UDP），解决 TCP 层阻塞，连接迁移与 0-RTT",
      "缓存语义（Cache-Control/ETag）三代通用，与版本无关",
    ],
    downstream: "TLS 握手、DNS 与 CDN",
    links: [
      { label: "MDN · HTTP 指南", url: "https://developer.mozilla.org/zh-CN/docs/Web/HTTP" },
      { label: "RFC 9114 · HTTP/3", url: "https://www.rfc-editor.org/rfc/rfc9114.html" },
    ],
  },
  {
    id: "kc-net-cache",
    categoryId: "foundation-network",
    title: "缓存语义：强缓存、协商缓存与失效策略",
    stage: "进阶",
    summary:
      "缓存题只考两件事：什么时候不发请求、什么时候发请求但不传数据；答清这两条再谈工程策略。",
    points: [
      "强缓存命中完全不发请求，由 Cache-Control: max-age / immutable 决定（Expires 是它的老写法）",
      "协商缓存发请求带 If-None-Match / If-Modified-Since，未变更返回 304，只省带宽不省往返",
      "no-cache 是「每次都要协商」，no-store 才是「完全不缓存」，这两个词最容易被答反",
      "工程组合：入口 HTML 用 no-cache，带内容指纹的静态资源用 immutable + 一年",
    ],
    diagramId: "dg-http-cache",
    upstream: "HTTP 报文与状态码",
    downstream: "CDN 缓存键与刷新策略",
    links: [
      { label: "MDN · HTTP 缓存", url: "https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Caching" },
      { label: "web.dev · HTTP 缓存", url: "https://web.dev/articles/http-cache" },
    ],
  },
  {
    id: "kc-net-tls",
    categoryId: "foundation-network",
    title: "TCP 与 TLS：握手到底发生了什么",
    stage: "深入",
    summary:
      "HTTPS 的耗时主要在握手；理解 TCP 三次握手 + TLS 1.3 的 1-RTT，才能解释「为什么首屏要建连这么快」。",
    points: [
      "TCP 三次握手确认双向可达，四次挥手因为半关闭",
      "TLS 1.3 把握手压到 1-RTT，支持 0-RTT 恢复（有重放风险）",
      "证书链校验 + SNI + ALPN 协商 HTTP 版本",
      "队头阻塞：TCP 丢包会阻塞整条连接上的所有流",
    ],
    diagramId: "dg-tcp-handshake",
    upstream: "HTTP 版本演进",
    links: [
      { label: "Cloudflare · TLS 学习中心", url: "https://www.cloudflare.com/learning/ssl/what-is-ssl/" },
      { label: "MDN · TLS", url: "https://developer.mozilla.org/zh-CN/docs/Web/Security/Transport_Layer_Security" },
    ],
  },
  {
    id: "kc-net-dns-cdn",
    categoryId: "foundation-network",
    title: "DNS 解析与 CDN 调度",
    stage: "进阶",
    summary:
      "「打开网页」的第一步不是 HTTP，而是 DNS；CDN 的价值一半在就近接入，一半在缓存命中率。",
    points: [
      "解析链路：浏览器缓存 → 系统 hosts → 递归 DNS → 根/顶级/权威",
      "DNS 预解析 dns-prefetch 能省一次 RTT",
      "CDN 调度靠 DNS 或 Anycast，命中率取决于缓存键与 TTL",
      "刷新策略：URL 带 hash 是前端最可靠的缓存失效手段",
    ],
    upstream: "HTTP 与缓存语义",
    links: [
      { label: "Cloudflare · 什么是 DNS", url: "https://www.cloudflare.com/learning/dns/what-is-dns/" },
    ],
  },
  {
    id: "kc-net-debug",
    categoryId: "foundation-network",
    title: "抓包与排错：从现象到根因",
    stage: "进阶",
    summary:
      "接口慢还是页面慢、是服务端耗时还是网络耗时，必须用工具分开测量，靠猜会浪费大量时间。",
    points: [
      "DevTools Network：看 TTFB、Content Download、排队与连接复用",
      "curl -w 输出各阶段耗时，排除浏览器因素",
      "抓包用 Charles / Wireshark；HTTP/2 与 HTTPS 需要解密配置",
      "区分 DNS、TCP、TLS、等待响应四段耗时才能定位责任方",
    ],
    upstream: "HTTP 版本与握手流程",
    links: [
      { label: "Chrome DevTools · Network", url: "https://developer.chrome.com/docs/devtools/network" },
    ],
  },

  {
    id: "kc-sec-sameorigin",
    categoryId: "foundation-security",
    title: "同源策略与 CORS",
    stage: "入门",
    summary:
      "同源策略限制的是「读取」而不是「发送」；CORS 是服务端授权浏览器放宽读取限制的机制。",
    points: [
      "同源 = 协议 + 域名 + 端口完全一致",
      "简单请求直接发；非简单请求先发 OPTIONS 预检",
      "凭证请求要求 Access-Control-Allow-Origin 不能为 *，且需 Allow-Credentials",
      "CORS 是浏览器行为，服务端到服务端调用不受限",
    ],
    downstream: "CSRF、XSS 与内容安全策略",
    links: [
      { label: "MDN · CORS", url: "https://developer.mozilla.org/zh-CN/docs/Web/HTTP/CORS" },
    ],
  },
  {
    id: "kc-sec-attack",
    categoryId: "foundation-security",
    title: "XSS、CSRF 与 CSP",
    stage: "进阶",
    summary:
      "XSS 是「你的页面执行了别人的脚本」，CSRF 是「别人的页面借你的身份发了请求」；防法完全不同。",
    points: [
      "XSS：输出编码 + 避免 innerHTML + CSP 兜底；富文本要白名单过滤",
      "CSRF：SameSite Cookie + CSRF Token + 校验 Origin/Referer",
      "CSP：限制 script-src、禁止内联（nonce/hash），report-uri 收集违规",
      "存储型 XSS 最危险，服务端入库前也要过滤",
    ],
    upstream: "同源策略与 Cookie 机制",
    links: [
      { label: "OWASP Top 10", url: "https://owasp.org/www-project-top-ten/" },
      { label: "MDN · CSP", url: "https://developer.mozilla.org/zh-CN/docs/Web/HTTP/CSP" },
    ],
  },
  {
    id: "kc-sec-auth",
    categoryId: "foundation-security",
    title: "认证与授权：Cookie Session、JWT、OAuth",
    stage: "深入",
    summary:
      "认证是「你是谁」，授权是「你能做什么」；前端能做的只有安全地存凭证与正确地携带，判定必须在服务端。",
    points: [
      "Session Cookie：HttpOnly + Secure + SameSite，服务端可主动失效",
      "JWT：无状态、不可撤销，适合短有效期 + Refresh Token",
      "OAuth 2.0 / OIDC：授权码 + PKCE 是前端最安全的流程",
      "不要把 token 放 localStorage（XSS 可直接读）；敏感操作二次校验",
    ],
    upstream: "同源策略与 HTTPS",
    links: [
      { label: "OAuth 2.0 安全最佳实践", url: "https://datatracker.ietf.org/doc/html/draft-ietf-oauth-security-topics" },
      { label: "MDN · HTTP 认证", url: "https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Authentication" },
    ],
  },

  {
    id: "kc-perf-metrics",
    categoryId: "foundation-perf",
    title: "度量先行：Core Web Vitals 怎么读",
    stage: "入门",
    summary:
      "性能优化第一步是建立度量：LCP 看加载、INP 看交互、CLS 看稳定；没有基线的优化都是猜。",
    points: [
      "LCP 目标 2.5s 内，关注最大元素（图片/标题）的加载链路",
      "INP 目标 200ms 内，关注长任务与事件处理耗时",
      "CLS 目标 0.1 内，关注图片尺寸、字体切换、动态插入",
      "实验室数据（Lighthouse）与真实用户数据（RUM）要一起看",
    ],
    downstream: "加载优化与运行时优化",
    links: [
      { label: "web.dev · Core Web Vitals", url: "https://web.dev/articles/vitals" },
      { label: "Lighthouse 文档", url: "https://developer.chrome.com/docs/lighthouse/overview" },
    ],
  },
  {
    id: "kc-perf-loading",
    categoryId: "foundation-perf",
    title: "加载优化：关键路径与资源优先级",
    stage: "进阶",
    summary:
      "首屏优化本质是「让关键资源更早开始下载、更少阻塞解析」；拆包与预加载是主要杠杆。",
    points: [
      "关键 CSS 内联、非关键脚本 defer/async",
      "preconnect / preload 关键资源，dns-prefetch 次要域名",
      "按路由拆包 + 预取下一页 chunk",
      "图片：合适的尺寸与格式（AVIF/WebP）、lazy loading、避免 CLS",
    ],
    upstream: "浏览器渲染管线",
    links: [
      { label: "web.dev · 关键渲染路径", url: "https://web.dev/articles/critical-rendering-path" },
    ],
  },
  {
    id: "kc-perf-runtime",
    categoryId: "foundation-perf",
    title: "运行时优化：长任务、渲染与内存",
    stage: "深入",
    summary:
      "页面打开快不代表用得顺；交互卡顿来自主线程长任务与过大的渲染量。",
    points: [
      "拆分长任务：让出主线程（setTimeout / scheduler.postTask / Worker）",
      "减少重排：批量读写 DOM、用 transform 做动画",
      "虚拟列表降低渲染量；memo 降低重算",
      "内存：及时解绑监听与定时器，缓存设上限",
    ],
    upstream: "事件循环与渲染管线",
    links: [
      { label: "web.dev · 优化长任务", url: "https://web.dev/articles/optimize-long-tasks" },
    ],
  },

  {
    id: "kc-eng-build",
    categoryId: "foundation-engineering",
    title: "构建工具：Vite 与 Webpack 的取舍",
    stage: "入门",
    summary:
      "Webpack 是「先打包再服务」，Vite 是「开发期用原生 ESM 按需编译、生产期用 Rollup 打包」；理解这一点就理解了两者的性能差异。",
    points: [
      "Vite 冷启动快：依赖预构建（esbuild）+ 源码按需转换",
      "Webpack 生态成熟：loader/plugin 体系、复杂定制能力强",
      "生产构建都要做：压缩、拆包、hash、tree shaking",
      "Rolldown / Rspack 是「Rust 化的 Webpack 兼容层」，正在成为新选项",
    ],
    diagramId: "dg-webpack-flow",
    downstream: "monorepo、CI/CD 与产物分析",
    links: [
      { label: "Vite · 为什么选 Vite", url: "https://cn.vite.dev/guide/why.html" },
      { label: "webpack · 核心概念", url: "https://webpack.js.org/concepts/" },
    ],
  },
  {
    id: "kc-eng-monorepo",
    categoryId: "foundation-engineering",
    title: "Monorepo：工作区、依赖与任务编排",
    stage: "进阶",
    summary:
      "Monorepo 解决「多包协作」，代价是依赖提升与构建编排；pnpm workspace + 任务缓存是当前主流组合。",
    points: [
      "workspace 协议（workspace:*）让包之间直接引用源码",
      "pnpm 的严格 node_modules 能暴露幽灵依赖",
      "任务编排用 Turborepo/Nx，按依赖图并行 + 远端缓存",
      "发布用 changesets 管理版本与 changelog",
    ],
    upstream: "包管理与语义化版本",
    links: [
      { label: "pnpm · Workspace", url: "https://pnpm.io/workspaces" },
      { label: "Turborepo 文档", url: "https://turborepo.com/docs" },
    ],
  },
  {
    id: "kc-eng-cicd",
    categoryId: "foundation-engineering",
    title: "CI/CD：流水线、缓存与发布",
    stage: "进阶",
    summary:
      "流水线的价值是「让每次合并都可发布」：类型、测试、构建、制品、部署五步缺一不可。",
    points: [
      "并行 job 缩短反馈时间；缓存依赖与构建产物",
      "制品不可变：每次构建产出唯一版本，部署只换指针",
      "环境分级：预览环境（PR）→ 预发 → 生产，逐级验证",
      "回滚能力是发布方案的一部分，不是事后补救",
    ],
    diagramId: "dg-cicd",
    upstream: "构建工具与测试策略",
    links: [
      { label: "GitHub Actions 文档", url: "https://docs.github.com/zh/actions" },
    ],
  },
  {
    id: "kc-eng-quality",
    categoryId: "foundation-engineering",
    title: "质量门禁与可观测性",
    stage: "深入",
    summary:
      "工程化的终点是「可观测」：出错能定位、变慢能归因、发布能回滚，才算把前端当服务在运营。",
    points: [
      "门禁：lint + 类型 + 测试 + 体积预算，全部在 CI 强校验",
      "错误监控：Source Map 上传、release 关联、用户操作序列",
      "性能监控：RUM 采 Core Web Vitals，按路由/机型分组",
      "告警要有阈值与责任人，否则监控等于没做",
    ],
    upstream: "CI/CD 与发布策略",
    links: [
      { label: "web.dev · 监控", url: "https://web.dev/articles/vitals-measurement-getting-started" },
    ],
  },

  {
    id: "kc-os-process",
    categoryId: "foundation-os",
    title: "进程、线程与协程",
    stage: "入门",
    summary:
      "进程是资源分配单位，线程是调度单位，协程是用户态切换；理解这三层，才能解释 Node/Python 的并发模型。",
    points: [
      "进程间内存隔离，通信靠管道/共享内存/socket",
      "线程共享地址空间，需要锁；上下文切换有成本",
      "协程（goroutine/async）在用户态调度，切换便宜但不能自动并行",
      "「单线程」通常指 JS 执行线程，IO 仍可由内核并行",
    ],
    downstream: "IO 多路复用与内存管理",
    links: [
      { label: "MIT · Missing Semester", url: "https://missing-semester-cn.github.io/" },
    ],
  },
  {
    id: "kc-os-io",
    categoryId: "foundation-os",
    title: "IO 多路复用：select / poll / epoll",
    stage: "深入",
    summary:
      "epoll 是 Node 与 Nginx 高并发的底层原因：把「轮询所有 fd」变成「内核通知就绪的 fd」。",
    points: [
      "select 有 1024 fd 上限且每次全量拷贝；poll 去掉上限但仍需遍历",
      "epoll 用红黑树管理 fd、就绪链表返回，复杂度 O(1) 级别",
      "LT 水平触发（未处理会反复通知）vs ET 边缘触发（必须读到 EAGAIN）",
      "阻塞/非阻塞、同步/异步是两组正交概念，别混着说",
    ],
    upstream: "进程与文件描述符",
    links: [
      { label: "man7 · epoll", url: "https://man7.org/linux/man-pages/man7/epoll.7.html" },
    ],
  },
  {
    id: "kc-os-linux",
    categoryId: "foundation-os",
    title: "排障命令：从 top 到 lsof",
    stage: "进阶",
    summary:
      "线上排障靠的是「看得见」：CPU、内存、IO、网络、句柄，五类指标各有对应命令。",
    points: [
      "CPU/内存：top、htop、free -h、vmstat",
      "磁盘/IO：df -h、du -sh、iostat",
      "网络：ss -lntp、netstat、curl -v、tcpdump",
      "进程与句柄：ps aux、lsof -p、strace",
      "日志：tail -f、grep -C、awk 统计、journalctl",
    ],
    upstream: "进程与文件描述符",
    links: [
      { label: "Linux man pages", url: "https://man7.org/linux/man-pages/" },
      { label: "MIT · Missing Semester（中文）", url: "https://missing-semester-cn.github.io/" },
    ],
  },

  {
    id: "kc-db-index",
    categoryId: "foundation-database",
    title: "索引与 B+ 树：为什么能快",
    stage: "入门",
    summary:
      "索引的本质是「用有序结构减少扫描行数」；B+ 树把树高压到 3-4 层，一次查询只需几次页读取。",
    points: [
      "B+ 树非叶节点只存键，扇出大 → 树矮 → 磁盘 IO 少",
      "聚簇索引（InnoDB 主键）叶子存整行；二级索引存主键，需要回表",
      "覆盖索引避免回表；最左前缀原则决定联合索引能否命中",
      "索引不是越多越好：写入要维护、占用空间、优化器可能选错",
    ],
    diagramId: "dg-btree",
    downstream: "事务、隔离级别与慢查询优化",
    links: [
      { label: "MySQL 8.4 · 优化与索引", url: "https://dev.mysql.com/doc/refman/8.4/en/optimization.html" },
    ],
  },
  {
    id: "kc-db-transaction",
    categoryId: "foundation-database",
    title: "事务、隔离级别与 MVCC",
    stage: "深入",
    summary:
      "隔离级别是用「并发性能」换「一致性」的旋钮；MVCC 让读不加锁，靠版本链与 Read View 实现。",
    points: [
      "ACID 四条各自的实现手段（redo/undo/锁/约束）",
      "四种隔离级别与三类异常（脏读、不可重复读、幻读）",
      "MVCC：undo 版本链 + Read View 判断可见性；RC 每次快照、RR 首次快照",
      "间隙锁解决 RR 下的幻读，代价是更多锁冲突",
    ],
    upstream: "索引与存储引擎",
    links: [
      { label: "PostgreSQL · 并发控制", url: "https://www.postgresql.org/docs/current/mvcc.html" },
      { label: "MySQL · InnoDB 锁", url: "https://dev.mysql.com/doc/refman/8.4/en/innodb-locking.html" },
    ],
  },
  {
    id: "kc-db-cache",
    categoryId: "foundation-database",
    title: "缓存：穿透、击穿、雪崩与一致性",
    stage: "进阶",
    summary:
      "缓存问题的命名很像，成因完全不同：穿透是查不存在的数据，击穿是热点失效，雪崩是大面积同时失效。",
    points: [
      "穿透：布隆过滤器或空值缓存",
      "击穿：互斥锁/逻辑过期，避免热点 key 失效瞬间打爆 DB",
      "雪崩：过期时间加随机、多级缓存、限流降级",
      "一致性：先更新库再删缓存（Cache Aside），配合延迟双删或订阅 binlog",
    ],
    upstream: "索引与查询性能",
    links: [
      { label: "Redis 文档", url: "https://redis.io/docs/latest/" },
    ],
  },

  {
    id: "kc-ai-llm",
    categoryId: "foundation-ai",
    title: "LLM 基础：token、上下文与采样",
    stage: "入门",
    summary:
      "把模型当「按概率续写文本的函数」：上下文决定它能看见什么，采样参数决定它有多发散。",
    points: [
      "token 是计费与上下文长度的单位，中英文 token 数差异大",
      "上下文窗口有限：超长会截断或遗忘中间内容",
      "temperature / top_p 控制随机性，代码生成建议低温度",
      "模型不知道你的仓库，除非你把它放进上下文",
    ],
    downstream: "RAG、Agent 与编码助手工作流",
    links: [
      { label: "OpenAI · 平台文档", url: "https://platform.openai.com/docs" },
    ],
  },
  {
    id: "kc-ai-rag",
    categoryId: "foundation-ai",
    title: "RAG：检索增强的四个环节",
    stage: "进阶",
    summary:
      "RAG 的瓶颈通常在检索而不是生成：切分、embedding、召回、重排，任何一环差都会让答案跑偏。",
    points: [
      "切分：按语义/标题分块，保留元数据（来源、时间）",
      "embedding：同一模型编码查询与文档，必要时做混合检索（关键词 + 向量）",
      "重排（rerank）：先粗召回再精排，显著提升相关性",
      "权限过滤必须在检索阶段做，不能靠提示词",
    ],
    upstream: "LLM 基础与向量检索",
    links: [
      { label: "Anthropic · 构建有效 Agent", url: "https://www.anthropic.com/engineering/building-effective-agents" },
    ],
  },
  {
    id: "kc-ai-agent",
    categoryId: "foundation-ai",
    title: "Agent 与工具调用：MCP 解决什么",
    stage: "深入",
    summary:
      "Agent = 模型 + 工具 + 循环；MCP 把「工具怎么接」标准化，让同一套上下文能接多个模型与编辑器。",
    points: [
      "工具调用：模型输出结构化调用意图，宿主执行并把结果回灌",
      "循环控制：最大步数、超时、失败重试与人工确认点",
      "MCP：把资源（文件/数据库）与工具用统一协议暴露，避免为每个 IDE 写适配",
      "风险：越权操作、提示注入、工具返回内容被当作指令",
    ],
    upstream: "LLM 基础与 RAG",
    links: [
      { label: "Model Context Protocol", url: "https://modelcontextprotocol.io/introduction" },
    ],
  },
  {
    id: "kc-ai-coding",
    categoryId: "foundation-ai",
    title: "编码助手工作流：上下文、验证与审查",
    stage: "进阶",
    summary:
      "AI 编码的产出质量取决于三件事：给对上下文、能自我验证、有人审查；缺一项就会变成技术债工厂。",
    points: [
      "上下文：仓库约定文件、相关文件范围、验收标准",
      "验证：类型检查 + 测试 + 实际运行，不能让模型「自称已验证」",
      "审查：AI 不能批准自己的改动，关键路径必须人工 review",
      "红线：鉴权、支付、加密、构建配置、依赖升级不交给模型自行决定",
    ],
    upstream: "LLM 基础与工具调用",
    links: [
      { label: "Anthropic · 工程博客", url: "https://www.anthropic.com/engineering" },
    ],
  },
];

/** 阶段权重：只用于排序，不代表难度分值 */
export const KNOWLEDGE_STAGE_WEIGHT: Record<KnowledgeStage, number> = {
  入门: 0,
  进阶: 1,
  深入: 2,
};

/**
 * 某个分类下的知识主题，按「入门 → 进阶 → 深入」稳定排序。
 *
 * 在派生处排序而不是依赖手写顺序：新增主题时插入位置自由，
 * 界面上永远是先入门后深入（同阶段保持书写顺序）。
 */
export function knowledgeOfCategory(
  categoryId: CategoryId,
): readonly KnowledgeTopic[] {
  return KNOWLEDGE_TOPICS.filter(
    (topic) => topic.categoryId === categoryId,
  ).sort(
    (left, right) =>
      KNOWLEDGE_STAGE_WEIGHT[left.stage] - KNOWLEDGE_STAGE_WEIGHT[right.stage],
  );
}

/** 全部分类下共有多少知识主题 */
export const KNOWLEDGE_TOPIC_COUNT = KNOWLEDGE_TOPICS.length;
