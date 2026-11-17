/**
 * 面试题名词词典。
 *
 * 题库里大量名词是「内行不言自明、外行看不懂」的黑话（结构化克隆、receiver、
 * Lane 模型、队头阻塞……），直接堆在答案里只会制造阅读断点。这里把名词抽成
 * 独立词条，题干与答案渲染时自动识别，点一下弹层给出一句话定义 + 细节。
 *
 * 三条维护约定：
 * 1. **只收「需要解释」的名词**，2-3 个字符的通用词（map / key / diff）一律不收 ——
 *    它们会在正文里到处误命中，把整段文字刷成蓝色反而更难读；
 * 2. `term` / `aliases` 是**字面匹配键**，中英文各算一个键，键之间大小写不敏感且必须全局唯一；
 * 3. `related` 只能指向本文件的 id，由 `interview-glossary.test.ts` 守卫。
 */
import type { InterviewCategoryId } from "./interview-types";

/** 词条领域：决定弹层上的标签文字，也用于按域排查缺口 */
export type GlossaryDomain =
  | "javascript"
  | "react"
  | "vue"
  | "browser"
  | "network"
  | "security"
  | "engineering"
  | "electron"
  | "node"
  | "algorithm"
  | "database"
  | "os"
  | "ai";

export const GLOSSARY_DOMAIN_LABEL: Record<GlossaryDomain, string> = {
  javascript: "JavaScript",
  react: "React",
  vue: "Vue",
  browser: "浏览器",
  network: "网络",
  security: "安全",
  engineering: "工程化",
  electron: "Electron",
  node: "Node.js",
  algorithm: "算法",
  database: "数据库",
  os: "操作系统",
  ai: "AI 辅助开发",
};

export interface GlossaryTerm {
  id: string;
  /** 展示名，同时是首选匹配词 */
  term: string;
  /** 英文全称，作为第二个匹配词，也在弹层里展示 */
  en?: string;
  /** 其他说法（缩写、别名），只参与匹配、不在弹层里展示 */
  aliases?: string[];
  domain: GlossaryDomain;
  /** 一句话定义，控制在 40 字内 */
  short: string;
  /** 展开细节，2-4 条，每条一句话 */
  detail: readonly string[];
  /** 相关词条 id，弹层尾部展示 */
  related?: readonly string[];
  /** 该词主要出现在哪个分类下，便于后续按分类补词（可空；自定义分类为 `u-c-*`） */
  categoryId?: InterviewCategoryId;
}

/**
 * 词典数据。
 *
 * 排序按领域聚簇，方便维护时成组补词；匹配不依赖数组顺序（内部按长度排序）。
 */
export const GLOSSARY_TERMS: readonly GlossaryTerm[] = [
  // ── JavaScript ────────────────────────────────────────────────
  {
    id: "closure",
    term: "闭包",
    en: "Closure",
    domain: "javascript",
    short: "函数记住并访问了定义时所在作用域里的变量，即使那个作用域已经执行完。",
    detail: [
      "闭包是词法作用域的副产物，不是语法特性：只要内层函数引用了外层变量，引擎就必须保住那层作用域不被回收。",
      "典型用途是数据私有化（模块模式）、函数工厂、记忆化缓存；代价是被引用的变量常驻内存，误留大对象就是内存泄漏。",
    ],
    related: ["scope-chain", "gc", "memory-leak"],
    categoryId: "foundation-js",
  },
  {
    id: "scope-chain",
    term: "作用域链",
    en: "Scope Chain",
    domain: "javascript",
    short: "变量查找时由内向外逐层爬的那条链：当前作用域 → 外层 → … → 全局。",
    detail: [
      "查找是单向的：内层能看外层，外层看不到内层，所以「在外层拿不到内层变量」不是实现限制，而是链的方向决定的。",
      "with 与 eval 会延长作用域链、破坏静态分析，严格模式下 eval 也不再往上层泄漏变量。",
    ],
    related: ["closure", "execution-context"],
    categoryId: "foundation-js",
  },
  {
    id: "tdz",
    term: "暂时性死区",
    en: "TDZ, Temporal Dead Zone",
    aliases: ["TDZ"],
    domain: "javascript",
    short: "let / const 声明前的那段区域，变量已存在但访问会直接抛 ReferenceError。",
    detail: [
      "和 var 的 undefined 不同：var 是「声明提升 + 初始化为 undefined」，let 只提升声明、不初始化，所以访问是抛错而不是拿到空值。",
      "typeof 也不再安全：对死区里的 let 变量做 typeof 同样抛错，这是它和未声明变量的关键区别。",
    ],
    related: ["hoisting", "execution-context"],
    categoryId: "foundation-js",
  },
  {
    id: "hoisting",
    term: "变量提升",
    en: "Hoisting",
    domain: "javascript",
    short: "声明被提到作用域顶部：函数声明整体提升，var 只提升声明、赋值留在原地。",
    detail: [
      "「提升」是编译阶段登记标识符的副产物，物理上并没有把代码搬走；函数声明优先于变量声明登记。",
      "同名时后面的函数声明会覆盖前面的，但 var 的赋值仍按源码顺序生效，这也是「函数声明 + 同名 var」容易出 bug 的原因。",
    ],
    related: ["tdz", "execution-context"],
    categoryId: "foundation-js",
  },
  {
    id: "prototype-chain",
    term: "原型链",
    en: "Prototype Chain",
    domain: "javascript",
    short: "对象读不到属性时，沿着 [[Prototype]] 一路向上找，直到 null 为止。",
    detail: [
      "instanceof 就是沿原型链找构造函数的 prototype，所以改原型会让 instanceof 的结果一起变。",
      "链条终点是 Object.prototype，再往上就是 null；把某个对象的原型设为 null 就得到没有原型链的「裸对象」。",
    ],
    related: ["closure", "proxy"],
    categoryId: "foundation-js",
  },
  {
    id: "event-loop",
    term: "事件循环",
    en: "Event Loop",
    domain: "javascript",
    short: "JS 单线程的调度机制：清空调用栈后先排空微任务，再取下一个宏任务。",
    detail: [
      "每轮循环顺序固定：取一个宏任务执行 → 清空微任务队列 → 视情况渲染 → 进入下一轮；微任务里再产生微任务仍在本轮排空。",
      "所以 Promise.then 一定早于 setTimeout，哪怕 setTimeout 写在前、延时为 0。",
    ],
    related: ["macrotask", "microtask", "call-stack"],
    categoryId: "foundation-js",
  },
  {
    id: "macrotask",
    term: "宏任务",
    en: "Macrotask",
    domain: "javascript",
    short: "事件循环每轮只取一个的任务：setTimeout、I/O、用户交互回调等。",
    detail: [
      "宏任务之间浏览器有机会渲染和响应输入，所以长宏任务会卡住交互。",
      "setTimeout 的最短延时受嵌套层级限制（≥4 层后强制 4ms），并不是精确计时器。",
    ],
    related: ["microtask", "event-loop"],
    categoryId: "foundation-js",
  },
  {
    id: "microtask",
    term: "微任务",
    en: "Microtask",
    domain: "javascript",
    short: "当前宏任务结束后立刻排空的高优先级队列：Promise.then、queueMicrotask、MutationObserver。",
    detail: [
      "微任务队列必须清空才轮到渲染，所以「微任务里再排微任务」会让页面一直无法绘制。",
      "await 之后的代码等价于 then 回调：同一个 async 函数里，await 后面的语句都进微任务。",
    ],
    related: ["macrotask", "event-loop"],
    categoryId: "foundation-js",
  },
  {
    id: "call-stack",
    term: "调用栈",
    en: "Call Stack",
    domain: "javascript",
    short: "记录函数调用现场的后进先出栈，栈溢出就是它被撑爆了。",
    detail: [
      "栈里每一项是一个执行上下文（变量环境 + 词法环境 + this），出栈即销毁。",
      "递归转迭代、尾调用优化、把大任务切片，本质都是在控制调用栈的深度。",
    ],
    related: ["execution-context", "event-loop"],
    categoryId: "foundation-js",
  },
  {
    id: "execution-context",
    term: "执行上下文",
    en: "Execution Context",
    domain: "javascript",
    short: "函数被调用时创建的运行环境：变量环境、词法环境、this 绑定、外层引用。",
    detail: [
      "创建阶段先登记声明（这就是提升），执行阶段才逐行赋値；两者分离是很多「看起来反直觉」输出的根源。",
      "箭头函数没有自己的 this / arguments / new.target，它的 this 在创建时就固定为外层上下文的。",
    ],
    related: ["call-stack", "hoisting"],
    categoryId: "foundation-js",
  },
  {
    id: "debounce",
    term: "防抖",
    en: "Debounce",
    domain: "javascript",
    short: "每次触发都重置计时器，停止触发一段时间后才执行一次。",
    detail: [
      "语义是「等你彻底停下来再做」，适合搜索联想、表单校验、窗口 resize 后重新计算。",
      "必须支持 cancel，否则组件卸载后仍可能触发一次，对着已卸载的 DOM 操作。",
    ],
    related: ["throttle"],
    categoryId: "written-coding",
  },
  {
    id: "throttle",
    term: "节流",
    en: "Throttle",
    domain: "javascript",
    short: "固定时间窗口内最多执行一次，持续触发时按节奏匀速执行。",
    detail: [
      "语义是「别太频繁，但要有反馈」，适合滚动监听、拖拽、埋点上报。",
      "时间戳版首触发立即执行、无尾调用；定时器版有尾调用但首触发延迟，工程上常两者合并。",
    ],
    related: ["debounce"],
    categoryId: "written-coding",
  },
  {
    id: "currying",
    term: "柯里化",
    en: "Currying",
    domain: "javascript",
    short: "把多个参数的函数改造成「一次一个参数、返回下一个函数」的形式。",
    detail: [
      "靠 fn.length 判断还需要几个参数，收满才真正执行；默认参数与 rest 参数会让 length 失真。",
      "价值在于参数复用与延迟求值（如日志、校验器的预设配置）。",
    ],
    related: ["higher-order-fn"],
    categoryId: "written-coding",
  },
  {
    id: "higher-order-fn",
    term: "高阶函数",
    en: "Higher-Order Function",
    domain: "javascript",
    short: "参数是函数、或返回值是函数的函数。",
    detail: [
      "map / filter / reduce 属于「入参有函数」，防抖 / 柯里化属于「返回函数」，两者都是高阶。",
      "它是组合式代码的基本单元：把变化的部分抽成回调，把流程固定下来。",
    ],
    related: ["currying", "closure"],
    categoryId: "foundation-js",
  },
  {
    id: "iterator-protocol",
    term: "迭代器协议",
    en: "Iterator Protocol",
    domain: "javascript",
    short: "对象实现 next() 并返回 { value, done } 即可被 for...of 消费的约定。",
    detail: [
      "可迭代对象还要实现 Symbol.iterator，返回迭代器本身；数组、Map、Set、字符串都内置了。",
      "手写一个迭代器就能让自定义结构直接用 for...of、扩展运算符与解构。",
    ],
    related: ["generator"],
    categoryId: "foundation-js",
  },
  {
    id: "generator",
    term: "生成器",
    en: "Generator",
    domain: "javascript",
    short: "带 function* 的函数，执行到 yield 暂停、调用 next() 恢复，天然实现迭代器。",
    detail: [
      "暂停时整个执行上下文被保留，所以能写出「看起来同步、实际分段执行」的流程。",
      "redux-saga 与 co 这类库都是拿生成器当协程调度器用的。",
    ],
    related: ["iterator-protocol"],
    categoryId: "foundation-js",
  },
  {
    id: "proxy",
    term: "Proxy",
    en: "Proxy",
    domain: "javascript",
    short: "在目标对象外包一层拦截器，读写、判断、调用都能改写默认行为。",
    detail: [
      "能拦 13 种操作：get / set / has / deleteProperty / ownKeys / apply / construct 等，Vue 3 响应式的地基。",
      "无法拦截 ===、Object.keys 之外的内部操作，也无法被结构化克隆，性能敏感的热点路径有额外开销。",
    ],
    related: ["reflect", "receiver", "reactivity"],
    categoryId: "foundation-js",
  },
  {
    id: "reflect",
    term: "Reflect",
    en: "Reflect",
    domain: "javascript",
    short: "把对象内部操作（get / set / ownKeys / construct）暴露成函数的工具对象。",
    detail: [
      "在 Proxy 里必须用 Reflect.get(target, key, receiver) 而不是直接 target[key]，才能把 receiver 继续传下去。",
      "它的返回值语义比操作符干净：defineProperty 返回布尔值而不是抛错，适合在拦截器里做整体转发。",
    ],
    related: ["proxy", "receiver"],
    categoryId: "foundation-js",
  },
  {
    id: "receiver",
    term: "receiver",
    domain: "javascript",
    short: "Proxy 拦截器里的「实际访问者」，通常是代理对象本身，用来保证 getter 里的 this 正确。",
    detail: [
      "Reflect.get(target, key, receiver) 会把 receiver 作为 getter 内部的 this，让访问属性时仍然指向代理而非原对象。",
      "直接写 target[key] 会绕过 receiver，继承链上的 getter 行为就错了 —— 响应式失效的经典成因。",
    ],
    related: ["proxy", "reflect", "reactivity"],
    categoryId: "foundation-js",
  },
  {
    id: "structured-clone",
    term: "结构化克隆",
    en: "Structured Clone",
    aliases: ["structuredClone"],
    domain: "javascript",
    short: "浏览器内置的深拷贝算法，postMessage、structuredClone、IndexedDB 都用它。",
    detail: [
      "支持 Date、RegExp、Map、Set、ArrayBuffer、Blob，能正确处理循环引用。",
      "不支持函数、DOM 节点、Symbol、原型链（拷出来是普通对象），也不走 getter。",
    ],
    related: ["deep-clone", "circular-ref"],
    categoryId: "foundation-js",
  },
  {
    id: "weakmap",
    term: "WeakMap",
    en: "WeakMap",
    domain: "javascript",
    short: "键必须为对象、且对键持弱引用的映射，键被回收时条目自动消失。",
    detail: [
      "不可枚举、没有 size，因为弱引用随时可能被 GC 清掉，遍历结果无法稳定。",
      "Vue 3 用它挂响应式依赖与组件实例这些「跟着对象活」的附带数据，天然不会泄漏。",
    ],
    related: ["gc", "reactivity"],
    categoryId: "foundation-js",
  },
  {
    id: "boxing",
    term: "装箱",
    en: "Boxing",
    domain: "javascript",
    short: "对原始值取属性时，引擎临时包一层包装对象，用完即弃。",
    detail: [
      "所以 'abc'.length 能跑，但给字符串挂属性会静默丢失（严格模式下抛错）。",
      "Symbol.toPrimitive / valueOf / toString 决定了拆箱时用哪个值参与运算。",
    ],
    related: ["prototype-chain"],
    categoryId: "foundation-js",
  },
  {
    id: "deep-clone",
    term: "深拷贝",
    en: "Deep Clone",
    domain: "javascript",
    short: "递归复制引用类型，使副本与原对象完全不共享内存。",
    detail: [
      "JSON 方案会丢 undefined / 函数 / Symbol、把 Date 变字符串、遇循环引用直接抛错，只能用于纯数据。",
      "手写要点是 WeakMap 记已拷贝对象（处理循环引用）、区分 Map/Set、保留原型与不可枚举描述符。",
    ],
    related: ["structured-clone", "circular-ref"],
    categoryId: "written-coding",
  },
  {
    id: "circular-ref",
    term: "循环引用",
    en: "Circular Reference",
    domain: "javascript",
    short: "对象之间互相持有，形成环；深拷贝与序列化都必须专门处理它。",
    detail: [
      "拷贝时用 WeakMap 存「原对象 → 副本」，再次遇到同一个源对象就直接返回已有副本，避免无限递归。",
      "现代 GC 用可达性分析，单纯的循环引用不会泄漏；泄漏来自被全局变量意外持有。",
    ],
    related: ["deep-clone", "gc", "memory-leak"],
    categoryId: "foundation-js",
  },
  {
    id: "gc",
    term: "垃圾回收",
    en: "Garbage Collection",
    domain: "javascript",
    short: "引擎自动回收「不可达」对象；主流程是标记清除 + 分代回收。",
    detail: [
      "从根（全局对象、调用栈、闭包环境）出发做可达性遍历，没被标记到的就是垃圾 —— 引用计数解决不了循环引用。",
      "分代假设「大多数对象朝生夕死」：新生代用 Scavenge 复制，老生代用标记-整理，减少全堆扫描。",
    ],
    related: ["memory-leak", "weakmap", "closure"],
    categoryId: "foundation-js",
  },
  {
    id: "memory-leak",
    term: "内存泄漏",
    en: "Memory Leak",
    domain: "javascript",
    short: "本该释放的对象仍被引用，堆占用只涨不落。",
    detail: [
      "常见来源：未解绑的事件监听与定时器、全局缓存无上限、闭包长期持有大对象、脱离 DOM 后仍被 JS 引用。",
      "排查手段是 DevTools 内存面板做三次快照对比，看「分离 DOM」与持续增长的构造器。",
    ],
    related: ["gc", "weakmap"],
    categoryId: "foundation-perf",
  },
  {
    id: "tail-call",
    term: "尾调用优化",
    en: "Tail Call Optimization",
    domain: "javascript",
    short: "函数最后一步只返回另一个函数的调用时，复用当前栈帧，不再增长调用栈。",
    detail: [
      "规范里写了 PTC，但 V8 因调试栈与性能原因没有实现，所以 JS 里递归深度依然受栈大小限制。",
      "工程上的替代是手动改写成循环、或用 trampoline 把递归摊平。",
    ],
    related: ["call-stack"],
    categoryId: "foundation-js",
  },

  // ── React ─────────────────────────────────────────────────────
  {
    id: "vdom",
    term: "虚拟 DOM",
    en: "Virtual DOM",
    domain: "react",
    short: "用普通 JS 对象描述 UI 结构，先在内存里算出差异，再批量落到真实 DOM。",
    detail: [
      "它的价值不是「比原生快」，而是把「改哪里」从手写 DOM 操作变成声明式描述，并提供跨平台渲染能力。",
      "一次更新 = 生成新树 + diff 出补丁 + 提交补丁，diff 的成本要靠「同层比较 + key」压住。",
    ],
    related: ["diff-algorithm", "fiber", "reconciliation"],
    categoryId: "foundation-react",
  },
  {
    id: "fiber",
    term: "Fiber",
    en: "Fiber",
    domain: "react",
    short: "React 16 起的可中断渲染架构：把渲染拆成一个个可暂停、可恢复的工作单元。",
    detail: [
      "每个 Fiber 节点保存组件类型、state、副作用链表与优先级，本质是一条可以用指针遍历的链表树。",
      "render 阶段可被打断（时间切片 + 优先级），commit 阶段必须同步一次做完，否则用户会看到半截 UI。",
    ],
    related: ["time-slicing", "lane-model", "reconciliation"],
    categoryId: "foundation-react",
  },
  {
    id: "reconciliation",
    term: "协调",
    en: "Reconciliation",
    domain: "react",
    short: "React 对比新旧两棵 Fiber 树、决定复用还是重建节点的过程。",
    detail: [
      "三个假设撑起 O(n) 复杂度：只比同层、类型不同直接重建、同层用 key 匹配。",
      "协调只产出「要做什么」，真正的 DOM 操作发生在 commit 阶段。",
    ],
    related: ["diff-algorithm", "fiber"],
    categoryId: "foundation-react",
  },
  {
    id: "diff-algorithm",
    term: "Diff 算法",
    en: "Diff Algorithm",
    domain: "react",
    short: "把「两棵树的最小编辑距离」这个 O(n³) 问题降到 O(n) 的启发式比较策略。",
    detail: [
      "React 走「同层 + 类型 + key」三策略；Vue 3 在「有 key」时再加一步最长递增子序列，把移动次数压到最少。",
      "key 用下标是经典陷阱：列表插入会让后续节点全部错位复用，state 与 DOM 状态跟着串。",
    ],
    related: ["vdom", "lis", "reconciliation"],
    categoryId: "foundation-react",
  },
  {
    id: "time-slicing",
    term: "时间切片",
    en: "Time Slicing",
    domain: "react",
    short: "把长渲染任务切成 5ms 左右的小片，每片之间让出主线程给浏览器响应输入。",
    detail: [
      "实现靠 Scheduler 的宏任务调度（MessageChannel），而不是 requestIdleCallback —— 后者触发时机不可控。",
      "用户看到的「输入不卡」来自这里：高优先级更新可以打断正在进行的低优先级渲染。",
    ],
    related: ["fiber", "lane-model"],
    categoryId: "foundation-react",
  },
  {
    id: "lane-model",
    term: "Lane 模型",
    en: "Lane Model",
    domain: "react",
    short: "React 18 用 31 位二进制位表示更新优先级，位运算做合并与判断。",
    detail: [
      "不同 lane 代表不同紧急度（同步、输入、默认、过渡、空闲），一个 Fiber 可以同时挂着多个 lane。",
      "位运算让「这次更新包含哪些优先级」变成一次按位与，比早期 expirationTime 的数字比较更省。",
    ],
    related: ["fiber", "time-slicing"],
    categoryId: "foundation-react",
  },
  {
    id: "synthetic-event",
    term: "合成事件",
    en: "SyntheticEvent",
    domain: "react",
    short: "React 自己实现的一套事件对象，抹平浏览器差异并统一挂到根容器上做委托。",
    detail: [
      "React 17 起挂到根容器而不是 document，多版本 React 共存时不会互相抢事件。",
      "事件对象是池化的（旧版本），异步里访问属性要先把值取出来；新版已不再池化。",
    ],
    related: ["event-delegation"],
    categoryId: "foundation-react",
  },
  {
    id: "controlled-component",
    term: "受控组件",
    en: "Controlled Component",
    domain: "react",
    short: "表单值由 state 驱动，用户输入必须先经过 onChange 再回到 value。",
    detail: [
      "好处是值随时可知、可校验、可联动；代价是每次输入都触发一次渲染。",
      "非受控则用 ref 直接读 DOM，适合文件上传、超长表单或迁移老代码。",
    ],
    related: ["stale-closure"],
    categoryId: "foundation-react",
  },
  {
    id: "stale-closure",
    term: "闭包陷阱",
    en: "Stale Closure",
    domain: "react",
    short: "回调捕获的是渲染那一刻的变量，后续更新不会同步进去，读到的是旧值。",
    detail: [
      "典型场景：定时器 / 事件监听里的 state 永远停在首次渲染的值。",
      "修法是把依赖补全、用函数式 setState，或把最新值放进 ref 再读。",
    ],
    related: ["closure", "hooks-rules"],
    categoryId: "foundation-react",
  },
  {
    id: "hooks-rules",
    term: "Hooks 规则",
    en: "Rules of Hooks",
    domain: "react",
    short: "只能在顶层调用、不能在条件或循环里调用 —— 因为 Hooks 靠调用顺序对号入座。",
    detail: [
      "每个组件挂一条 hooks 链表，第 n 次调用对应第 n 个节点；顺序一变，state 就串到别的 Hook 上。",
      "自定义 Hook 本质是「把一段 hooks 链表逻辑复用」，不是共享状态。",
    ],
    related: ["stale-closure", "fiber"],
    categoryId: "foundation-react",
  },
  {
    id: "hydration",
    term: "水合",
    en: "Hydration",
    domain: "react",
    short: "服务端渲染出的 HTML 到浏览器后，React 复用这份 DOM 并补上事件与状态的挂载过程。",
    detail: [
      "水合阶段不能有「服务端与客户端渲染结果不一致」的节点，否则会整段丢弃重渲染并报警。",
      "所以时间、随机数、浏览器专有 API 都要放到 effect 里，不能在首屏渲染时直接读。",
    ],
    related: ["ssr", "vdom"],
    categoryId: "foundation-react",
  },
  {
    id: "memoization",
    term: "记忆化",
    en: "Memoization",
    domain: "react",
    short: "把入参作为 key 缓存计算结果，命中即复用，用空间换时间。",
    detail: [
      "React 的 useMemo / memo 都是浅比较依赖；依赖里塞新对象等于每次都失效。",
      "滥用比不用更贵：每个缓存都要存一份旧值与做一次比较，只对「重计算」或「稳定引用」有意义。",
    ],
    related: ["vdom"],
    categoryId: "foundation-react",
  },
  {
    id: "ssr",
    term: "服务端渲染",
    en: "SSR, Server-Side Rendering",
    aliases: ["SSR"],
    domain: "react",
    short: "在服务端把组件渲染成 HTML 直出，首屏可见更早，之后再由客户端水合接管。",
    detail: [
      "收益是首屏与 SEO；代价是服务端要承担渲染压力，且必须保证两端渲染一致。",
      "同族还有 SSG（构建时生成）、ISR（增量再生）、CSR（纯客户端），选型看内容更新频率与首屏要求。",
    ],
    related: ["hydration"],
    categoryId: "foundation-react",
  },
  {
    id: "rsc",
    term: "服务端组件",
    en: "RSC, React Server Components",
    aliases: ["RSC"],
    domain: "react",
    short: "只在服务端执行、产物是序列化 UI 描述的组件，自身不进入客户端 bundle。",
    detail: [
      "没有 state 与生命周期，可以直接读数据库；交互部分要显式标 「use client」。",
      "它和 SSR 不是一回事：SSR 是「渲染时机」，RSC 是「组件运行位置」，两者可以叠加。",
    ],
    related: ["ssr", "hydration"],
    categoryId: "foundation-react",
  },

  // ── Vue ───────────────────────────────────────────────────────
  {
    id: "reactivity",
    term: "响应式",
    en: "Reactivity",
    domain: "vue",
    short: "数据变化能自动触发依赖它的视图更新，靠「读时收集、写时通知」实现。",
    detail: [
      "Vue 2 用 defineProperty 递归劫持属性，新增/删除属性检测不到，需要 $set；Vue 3 换 Proxy，从对象级别拦截。",
      "完整闭环是：get 时 track 收集当前 effect，set 时 trigger 取出依赖集合逐个执行。",
    ],
    related: ["proxy", "track", "trigger", "effect"],
    categoryId: "foundation-vue",
  },
  {
    id: "track",
    term: "依赖收集",
    en: "Track",
    domain: "vue",
    short: "读取响应式数据时，把「当前正在执行的 effect」登记到该属性的依赖集合里。",
    detail: [
      "依赖关系存在 WeakMap<target, Map<key, Set<effect>>> 里，按对象 → 属性 → 副作用三层组织。",
      "收集时机会被 activeEffect 控制：只有存在当前副作用时才登记，否则读数据不该建立关系。",
    ],
    related: ["trigger", "effect", "reactivity"],
    categoryId: "foundation-vue",
  },
  {
    id: "trigger",
    term: "派发更新",
    en: "Trigger",
    domain: "vue",
    short: "写入响应式数据时，取出该属性收集到的 effect 集合，逐个调度执行。",
    detail: [
      "同一轮里多次修改会先去重再批量执行，避免一次改动触发多次渲染。",
      "调度器还会区分组件更新的优先级，父子组件在同一 tick 内按层级顺序刷新。",
    ],
    related: ["track", "effect"],
    categoryId: "foundation-vue",
  },
  {
    id: "effect",
    term: "副作用函数",
    en: "Effect",
    domain: "vue",
    short: "被响应式系统追踪的函数：执行时收集依赖，依赖变化时被重新执行。",
    detail: [
      "组件的 render 就是一个 effect；watch / watchEffect / computed 也都是 effect 的不同包装。",
      "嵌套 effect 靠 effect 栈维护父子关系，保证内层执行完能把 activeEffect 还原成外层。",
    ],
    related: ["track", "trigger", "reactivity"],
    categoryId: "foundation-vue",
  },
  {
    id: "computed-prop",
    term: "计算属性",
    en: "Computed",
    domain: "vue",
    short: "带缓存的派生值：依赖不变就不重算，依赖变了才标脏。",
    detail: [
      "实现是「惰性 effect + dirty 标记」：读取时若 dirty 才求值，求值后把 dirty 置回 false。",
      "和 methods 的区别就在缓存；和 watch 的区别在于它返回结果，不产生副作用。",
    ],
    related: ["effect", "memoization"],
    categoryId: "foundation-vue",
  },
  {
    id: "patch-flag",
    term: "PatchFlag",
    en: "PatchFlag",
    domain: "vue",
    short: "编译期给动态节点打的位标记，运行时据此只比对真正会变的部分。",
    detail: [
      "比如只绑定了 class 的节点标 CLASS，diff 时就不必比较 children 与 style。",
      "这是 Vue 3「编译时优化 + 运行时轻量」的核心：把能静态确定的工作全部前移。",
    ],
    related: ["static-hoist", "compiler", "diff-algorithm"],
    categoryId: "foundation-vue",
  },
  {
    id: "static-hoist",
    term: "静态提升",
    en: "Static Hoisting",
    domain: "vue",
    short: "把不含动态绑定的节点提到 render 函数外，只创建一次，后续复用同一份 vnode。",
    detail: [
      "配合 PatchFlag 与 Block Tree，diff 时可以直接跳过整棵静态子树。",
      "纯静态节点还会被字符串化（hoistStatic + stringifyStatic），进一步省掉创建 vnode 的开销。",
    ],
    related: ["patch-flag", "compiler"],
    categoryId: "foundation-vue",
  },
  {
    id: "lis",
    term: "最长递增子序列",
    en: "LIS, Longest Increasing Subsequence",
    aliases: ["LIS"],
    domain: "vue",
    short: "在乱序的索引序列里找出最长的递增子序列，Vue 3 diff 用它决定「哪些节点不用动」。",
    detail: [
      "求法：贪心 + 二分维护 tails 数组，O(n log n)；要还原具体下标还需记录前驱。",
      "Vue 用它标记出「相对顺序已正确」的节点，只对剩下的节点做插入/移动，移动次数最少。",
    ],
    related: ["diff-algorithm", "dual-ends-diff"],
    categoryId: "written-algorithm",
  },
  {
    id: "dual-ends-diff",
    term: "双端对比",
    en: "Dual-Ends Diff",
    domain: "vue",
    short: "新旧列表各取首尾四个指针同时向中间收缩，先剥掉能直接复用的头尾节点。",
    detail: [
      "Vue 2 的 updateChildren 就是这套：首首、尾尾、首尾、尾首四种比较，命中即复用并移动指针。",
      "Vue 3 保留预处理阶段（掐头去尾），中段再改用「key → 新索引」映射 + LIS 求最小移动集。",
    ],
    related: ["lis", "diff-algorithm"],
    categoryId: "foundation-vue",
  },
  {
    id: "compiler",
    term: "模板编译",
    en: "Template Compiler",
    domain: "vue",
    short: "把模板字符串解析成 AST，转换并生成可执行的 render 函数。",
    detail: [
      "三段式：parse → transform（此时打 PatchFlag、做静态提升）→ generate。",
      "编译期知道的信息越多，运行时就活得越轻 —— 这是 Vue 与 React 在优化路径上的根本分歧。",
    ],
    related: ["patch-flag", "static-hoist"],
    categoryId: "foundation-vue",
  },
  {
    id: "composition-api",
    term: "组合式 API",
    en: "Composition API",
    domain: "vue",
    short: "按「逻辑关注点」而不是「选项类型」组织代码，用 setup 把相关状态与方法放一起。",
    detail: [
      "解决的是选项式 API 在复杂组件里「同一功能被拆到 data / methods / watch 三处」的问题。",
      "逻辑复用从 mixin 的黑盒合并，变成显式调用一个组合函数，来源与冲突都看得见。",
    ],
    related: ["sfc"],
    categoryId: "foundation-vue",
  },
  {
    id: "sfc",
    term: "单文件组件",
    en: "SFC, Single-File Component",
    domain: "vue",
    short: "把 template / script / style 三块写在同一个 .vue 文件里，由构建工具拆开编译。",
    detail: [
      "style 上的 scoped 通过给元素加 data-v-* 属性 + 属性选择器实现样式隔离。",
      "Vite 用 @vitejs/plugin-vue 编译，webpack 用 vue-loader，两者都对三块分别套不同的 loader 链。",
    ],
    related: ["compiler"],
    categoryId: "foundation-vue",
  },
  {
    id: "teleport",
    term: "Teleport",
    en: "Teleport",
    domain: "vue",
    short: "把组件的一部分 DOM 渲染到别处（通常是 body），但保留在组件树里的逻辑关系。",
    detail: [
      "弹窗、下拉、全屏遮罩用它躲开父级的 overflow: hidden 与 z-index 层叠上下文。",
      "逻辑上它仍是当前组件的子节点，props / 事件 / 依赖注入都照常工作，只有 DOM 位置变了。",
    ],
    related: ["sfc"],
    categoryId: "foundation-vue",
  },

  // ── 浏览器 ────────────────────────────────────────────────────
  {
    id: "render-pipeline",
    term: "渲染流水线",
    en: "Rendering Pipeline",
    domain: "browser",
    short: "浏览器把 DOM 变成像素的固定流水线：样式计算 → 布局 → 绘制 → 合成。",
    detail: [
      "改几何属性触发 Layout 及之后全部阶段；只改颜色触发 Paint；改 transform / opacity 可以只走 Composite。",
      "理解这条流水线，才知道「为什么动画要用 transform」「为什么读 offsetHeight 会强制同步布局」。",
    ],
    related: ["reflow", "repaint", "composite-layer"],
    categoryId: "foundation-browser",
  },
  {
    id: "reflow",
    term: "重排",
    en: "Reflow / Layout",
    domain: "browser",
    short: "几何信息变化后重新计算每个盒子的位置与大小，代价最高。",
    detail: [
      "改宽高、字体、display、增删节点都会触发；读写交替（先写样式再读 offsetTop）会强制同步重排。",
      "优化方向是批量读写（先读后写）、用 transform 代替 top/left、把频繁变化的元素移出文档流。",
    ],
    related: ["repaint", "render-pipeline"],
    categoryId: "foundation-perf",
  },
  {
    id: "repaint",
    term: "重绘",
    en: "Repaint",
    domain: "browser",
    short: "布局不变、只重新画像素（颜色、阴影、背景）。",
    detail: [
      "重绘省掉了布局计算，但仍要重新栅格化，因此比合成贵、比重排便宜。",
      "把重绘区域限制在独立的合成层里，可以避免整屏重绘。",
    ],
    related: ["reflow", "composite-layer"],
    categoryId: "foundation-perf",
  },
  {
    id: "composite-layer",
    term: "合成层",
    en: "Compositing Layer",
    domain: "browser",
    short: "被单独栅格化、由 GPU 合成的图层，变换与透明度变化不需要重绘。",
    detail: [
      "will-change / transform: translateZ(0) 能提升为合成层，但层数多了会吃显存并增加合成开销。",
      "层爆炸会拖慢首次渲染，所以「提升合成层」是有代价的优化手段，不是越多越好。",
    ],
    related: ["repaint", "render-pipeline"],
    categoryId: "foundation-perf",
  },
  {
    id: "critical-path",
    term: "关键渲染路径",
    en: "Critical Rendering Path",
    domain: "browser",
    short: "从收到 HTML 到首屏可见必须走完的那条最短链路。",
    detail: [
      "HTML → DOM、CSS → CSSOM，两者合成渲染树后才能布局绘制；CSS 阻塞渲染，JS 还阻塞解析。",
      "优化手段是减小首屏关键资源体积、内联关键 CSS、给非关键脚本加 defer / async。",
    ],
    related: ["render-pipeline", "blocking"],
    categoryId: "foundation-perf",
  },
  {
    id: "blocking",
    term: "阻塞渲染",
    en: "Render Blocking",
    domain: "browser",
    short: "CSS 与同步脚本会挡住首屏渲染：前者等 CSSOM，后者还要等下载与执行。",
    detail: [
      "script 默认阻塞 DOM 解析；defer 延到解析完成后按序执行，async 下载完就执行、不保证顺序。",
      "媒体查询不匹配的 CSS 不会阻塞渲染，用 link 的 media 属性可以拆开关键与非关键样式。",
    ],
    related: ["critical-path"],
    categoryId: "foundation-perf",
  },
  {
    id: "same-origin",
    term: "同源策略",
    en: "Same-Origin Policy",
    domain: "browser",
    short: "协议 + 域名 + 端口三者完全相同才算同源，否则脚本读不到对方的响应内容。",
    detail: [
      "它限制的是「读取」，不是「发送」：跨域请求照样会发出去，只是响应被浏览器拦下不给 JS。",
      "iframe / postMessage、CORS、代理转发是三条正路，JSONP 属于历史遗留。",
    ],
    related: ["cors"],
    categoryId: "foundation-security",
  },
  {
    id: "cors",
    term: "跨域资源共享",
    en: "CORS",
    domain: "security",
    short: "服务端用一组 Access-Control-* 响应头声明「哪些源可以读我的响应」。",
    detail: [
      "简单请求直接发，浏览器检查响应头；非简单请求（自定义头、PUT、JSON）先发 OPTIONS 预检。",
      "带 cookie 时必须同时满足 Access-Control-Allow-Credentials 与具体的 Origin（不能用 *）。",
    ],
    related: ["same-origin", "preflight"],
    categoryId: "foundation-security",
  },
  {
    id: "preflight",
    term: "预检请求",
    en: "Preflight",
    domain: "security",
    short: "正式请求前先发的 OPTIONS 探测，问服务端「我能不能这样发」。",
    detail: [
      "触发条件：非简单方法、自定义请求头、Content-Type 不是表单三类之一。",
      "用 Access-Control-Max-Age 缓存预检结果，可以减少一次往返。",
    ],
    related: ["cors"],
    categoryId: "foundation-security",
  },
  {
    id: "event-delegation",
    term: "事件委托",
    en: "Event Delegation",
    domain: "browser",
    short: "把监听挂到父级，利用冒泡统一处理子元素事件。",
    detail: [
      "好处是动态新增的子节点自动生效、只挂一个监听更省内存。",
      "不冒泡的事件（focus / blur / scroll）与 stopPropagation 会让委托失效，需改用捕获阶段或直接绑定。",
    ],
    related: ["synthetic-event"],
    categoryId: "foundation-browser",
  },
  {
    id: "service-worker",
    term: "Service Worker",
    en: "Service Worker",
    domain: "browser",
    short: "独立于页面的后台脚本，做请求拦截、离线缓存与推送。",
    detail: [
      "生命周期是 install → activate → fetch，完全事件驱动、可被随时终止，所以不能存页面级状态。",
      "它只能在 HTTPS（或 localhost）下注册，且缓存策略写错会长期驻留，更新时要配合 skipWaiting 与版本清理。",
    ],
    related: ["strong-cache"],
    categoryId: "foundation-browser",
  },
  {
    id: "web-worker",
    term: "Web Worker",
    en: "Web Worker",
    domain: "browser",
    short: "真正并行的后台线程，通过 postMessage 与主线程通信，不能碰 DOM。",
    detail: [
      "适合纯计算：大数组处理、编解码、复杂 diff；通信本身有结构化克隆开销。",
      "SharedArrayBuffer + Atomics 才能共享内存，普通 Worker 只能传副本或转移 ArrayBuffer。",
    ],
    related: ["structured-clone"],
    categoryId: "foundation-browser",
  },
  {
    id: "raf",
    term: "requestAnimationFrame",
    en: "requestAnimationFrame",
    domain: "browser",
    short: "在下一帧绘制前回调，由浏览器统一节流到屏幕刷新率。",
    detail: [
      "页面隐藏时会自动暂停，比 setTimeout 更省电、也更容易对齐帧。",
      "动画逻辑放这里、状态计算放前面，才能避免「读改写」引发强制同步布局。",
    ],
    related: ["render-pipeline"],
    categoryId: "foundation-perf",
  },
  {
    id: "cls",
    term: "布局偏移",
    en: "CLS, Cumulative Layout Shift",
    aliases: ["CLS"],
    domain: "browser",
    short: "页面加载中元素位置意外跳动，是三大核心体验指标之一。",
    detail: [
      "主因是图片/广告位没有预留尺寸、字体切换、动态插入内容把下方顶走。",
      "修法是给媒体元素写死宽高比、字体用 font-display: optional、插入内容时预留占位。",
    ],
    related: ["lcp"],
    categoryId: "foundation-perf",
  },
  {
    id: "lcp",
    term: "最大内容绘制",
    en: "LCP, Largest Contentful Paint",
    aliases: ["LCP"],
    domain: "browser",
    short: "视口内最大元素完成渲染的时间，衡量「首屏看起来好了没」。",
    detail: [
      "通常是首屏大图或大块标题文字；优化重点是压缩首图、预加载关键资源、减少阻塞渲染的请求。",
      "与 FCP（首次绘制）、INP（交互响应）一起构成 Core Web Vitals。",
    ],
    related: ["cls", "critical-path"],
    categoryId: "foundation-perf",
  },

  // ── 网络 ──────────────────────────────────────────────────────
  {
    id: "tcp-handshake",
    term: "三次握手",
    en: "TCP Three-Way Handshake",
    domain: "network",
    short: "建连三步：SYN → SYN+ACK → ACK，双方各确认一次自己的收发能力。",
    detail: [
      "三次是为了同步双方的初始序列号并确认「你听得到我、我听得到你」，两次做不到双工确认。",
      "SYN 队列与 accept 队列分开，SYN flood 攻击就是打满前者。",
    ],
    related: ["tcp-wave"],
    categoryId: "foundation-network",
  },
  {
    id: "tcp-wave",
    term: "四次挥手",
    en: "TCP Four-Way Teardown",
    domain: "network",
    short: "断开要四步，因为 TCP 是全双工：两个方向要各自关一次。",
    detail: [
      "主动关闭方最后进入 TIME_WAIT，等 2MSL 是为了让对面的重传 FIN 还能被正确应答。",
      "CLOSE_WAIT 堆积通常意味着应用层忘了 close()，是连接泄漏的典型信号。",
    ],
    related: ["tcp-handshake"],
    categoryId: "foundation-network",
  },
  {
    id: "multiplexing",
    term: "多路复用",
    en: "Multiplexing",
    domain: "network",
    short: "一条连接上并发跑多个请求，用流 ID 区分归属。",
    detail: [
      "HTTP/2 靠二进制分帧实现，解决了 HTTP/1.1 的「同域 6 连接 + 队头阻塞」。",
      "但 TCP 层仍有队头阻塞：一个包丢了，整条连接上的所有流都要等，这是 HTTP/3 换 QUIC 的动因。",
    ],
    related: ["hol-blocking", "quic"],
    categoryId: "foundation-network",
  },
  {
    id: "hol-blocking",
    term: "队头阻塞",
    en: "HOL Blocking, Head-of-Line Blocking",
    aliases: ["HOL"],
    domain: "network",
    short: "前一个请求/包卡住，后面排队的全部被迫等待。",
    detail: [
      "HTTP/1.1 是应用层队头阻塞（同连接串行）；HTTP/2 解决了它，但 TCP 重传仍会造成传输层队头阻塞。",
      "QUIC 把流做成独立单位，丢包只影响那一条流，从协议层消除这个问题。",
    ],
    related: ["multiplexing", "quic"],
    categoryId: "foundation-network",
  },
  {
    id: "quic",
    term: "QUIC",
    en: "QUIC",
    domain: "network",
    short: "跑在 UDP 上的传输协议，把 TLS 1.3 与多路复用做进协议本身，是 HTTP/3 的底座。",
    detail: [
      "连接迁移靠 Connection ID：手机从 Wi-Fi 切 4G 不用重新握手。",
      "握手 1-RTT（复用连接时 0-RTT），但 UDP 在部分企业网络里会被限速或拦截。",
    ],
    related: ["multiplexing", "tls-handshake"],
    categoryId: "foundation-network",
  },
  {
    id: "tls-handshake",
    term: "TLS 握手",
    en: "TLS Handshake",
    domain: "network",
    short: "协商版本与密码套件、验证证书、交换密钥，完成后才传 HTTP 数据。",
    detail: [
      "TLS 1.2 要 2-RTT，TLS 1.3 压到 1-RTT 并砍掉不安全套件，还支持 0-RTT 恢复。",
      "证书链验证 + 域名匹配 + 有效期是三个独立检查，任何一项失败浏览器都会拦。",
    ],
    related: ["quic", "mitm"],
    categoryId: "foundation-security",
  },
  {
    id: "strong-cache",
    term: "强缓存",
    en: "Strong Cache",
    domain: "network",
    short: "命中后直接用本地副本，连请求都不发，由 Cache-Control / Expires 决定。",
    detail: [
      "Cache-Control: max-age 优先于 Expires；no-cache 不是不缓存，而是每次都要协商。",
      "immutable 表示「这段时间内绝不会变」，配合带内容指纹的文件名可以放心设一年。",
    ],
    related: ["negotiate-cache", "etag"],
    categoryId: "foundation-security",
  },
  {
    id: "negotiate-cache",
    term: "协商缓存",
    en: "Negotiation Cache",
    domain: "network",
    short: "强制过期后带校验字段问服务端「我这份还能用吗」，未变则回 304。",
    detail: [
      "ETag / If-None-Match 走内容指纹，精确但要多算一次；Last-Modified 走时间，秒级精度且可能误判。",
      "304 不传响应体，省的是带宽而不是往返 —— 所以强缓存永远优于协商缓存。",
    ],
    related: ["strong-cache", "etag"],
    categoryId: "foundation-security",
  },
  {
    id: "etag",
    term: "ETag",
    en: "ETag",
    domain: "network",
    short: "服务端给资源算的内容指纹，用于协商缓存与并发控制。",
    detail: [
      "强 ETag 逐字节比对，弱 ETag（W/ 前缀）只保证语义等价。",
      "集群下 ETag 必须用内容算而不是机器相关值，否则同一文件在不同节点上校验会来回失效。",
    ],
    related: ["negotiate-cache"],
    categoryId: "foundation-security",
  },
  {
    id: "cdn",
    term: "CDN",
    en: "CDN, Content Delivery Network",
    domain: "network",
    short: "把静态资源分发到离用户最近的边缘节点，缩短物理链路。",
    detail: [
      "回源策略与缓存键设计决定了命中率；缓存键带上多余参数会让命中率断崖下跌。",
      "发布新版本靠「文件名带 hash + 刷新 HTML」，而不是全网刷 CDN 缓存。",
    ],
    related: ["strong-cache", "dns"],
    categoryId: "foundation-network",
  },
  {
    id: "dns",
    term: "DNS 解析",
    en: "DNS Resolution",
    domain: "network",
    short: "域名到 IP 的查询过程：浏览器缓存 → 系统 → 递归服务器 → 根/顶级/权威。",
    detail: [
      "每层都有缓存，TTL 决定生效速度；换 IP 后老 TTL 内的用户仍打到旧地址。",
      "dns-prefetch 与 preconnect 能提前把这条链路走完，减少首屏等待。",
    ],
    related: ["cdn"],
    categoryId: "foundation-network",
  },

  // ── 安全 ──────────────────────────────────────────────────────
  {
    id: "xss",
    term: "XSS",
    en: "Cross-Site Scripting",
    domain: "security",
    short: "把攻击者的脚本注入页面执行，从而窃取 cookie、冒充用户操作。",
    detail: [
      "分存储型、反射型、DOM 型三类，区别只在恶意脚本从哪来、在哪执行。",
      "防御靠「输出编码 + 上下文感知转义 + CSP」，前端框架默认转义能挡住大部分拼接场景。",
    ],
    related: ["csrf", "csp"],
    categoryId: "foundation-security",
  },
  {
    id: "csrf",
    term: "CSRF",
    en: "Cross-Site Request Forgery",
    domain: "security",
    short: "借用户已登录的身份，在第三方站点悄悄发起请求。",
    detail: [
      "浏览器会自动带上目标域的 cookie，所以「请求确实来自用户浏览器」但「用户并不知情」。",
      "防御：SameSite cookie、校验 Origin / Referer、一次性 token、关键操作二次确认。",
    ],
    related: ["xss", "csp"],
    categoryId: "foundation-security",
  },
  {
    id: "csp",
    term: "CSP",
    en: "Content Security Policy",
    domain: "security",
    short: "用响应头声明「只允许从哪些源加载脚本/样式/图片」，从源头掐掉注入执行。",
    detail: [
      "nonce / hash 方案比域名白名单更细，能精确到具体内联脚本。",
      "上线先用 Content-Security-Policy-Report-Only 观察误报，再切强制模式。",
    ],
    related: ["xss"],
    categoryId: "foundation-security",
  },
  {
    id: "mitm",
    term: "中间人攻击",
    en: "MITM, Man-in-the-Middle",
    aliases: ["MITM"],
    domain: "security",
    short: "攻击者插在通信双方之间，既能窃听也能篡改。",
    detail: [
      "HTTPS 靠证书链 + 域名校验挡住它；企业代理装根证书就是「合法的中间人」。",
      "HSTS 强制浏览器只走 HTTPS，防止首次明文请求被劫持降级。",
    ],
    related: ["tls-handshake"],
    categoryId: "foundation-security",
  },
  {
    id: "idempotent",
    term: "幂等性",
    en: "Idempotency",
    domain: "security",
    short: "同一操作执行一次和多次的结果一致，是重试与去重的前提。",
    detail: [
      "GET / PUT / DELETE 语义上幂等，POST 不幂等；网络超时后能不能重试就看这条。",
      "工程实现靠唯一请求号（idempotency key）+ 服务端去重表，把「重复到达」变成「返回上次结果」。",
    ],
    related: ["strong-cache"],
    categoryId: "foundation-network",
  },

  // ── 工程化 ────────────────────────────────────────────────────
  {
    id: "tree-shaking",
    term: "Tree Shaking",
    en: "Tree Shaking",
    domain: "engineering",
    short: "基于 ESM 静态结构，把没有被引用的导出在打包时删掉。",
    detail: [
      "前提是「静态可分析」：CommonJS 的动态 require、改写导出对象都会让它失效。",
      "package.json 的 sideEffects 告诉打包器哪些文件有副作用，写错会误删样式或 polyfill。",
    ],
    related: ["side-effects", "dependency-graph"],
    categoryId: "foundation-engineering",
  },
  {
    id: "side-effects",
    term: "副作用标记",
    en: "sideEffects",
    domain: "engineering",
    short: "package.json 里的字段，声明哪些模块「被 import 就会产生副作用」，不可删除。",
    detail: [
      "写成 false 表示全包无副作用，未使用的模块可以整块摇掉；CSS 与 polyfill 必须列进数组。",
      "标错的表现是「样式莫名消失」或「polyfill 没进包」，且构建不报任何错。",
    ],
    related: ["tree-shaking"],
    categoryId: "foundation-engineering",
  },
  {
    id: "code-splitting",
    term: "代码分割",
    en: "Code Splitting",
    domain: "engineering",
    short: "把一个大 bundle 拆成多块，按路由或交互时机按需加载。",
    detail: [
      "动态 import() 是唯一入口，webpack / Vite 都会据此生成独立 chunk。",
      "拆分粒度以「首屏不需要 + 用户大概率会用到」为准，拆得过碎会让请求数反弹。",
    ],
    related: ["tree-shaking", "hmr"],
    categoryId: "foundation-perf",
  },
  {
    id: "hmr",
    term: "热更新",
    en: "HMR, Hot Module Replacement",
    domain: "engineering",
    short: "改代码后只替换变化的模块并保留页面状态，不整页刷新。",
    detail: [
      "链路是：文件变更 → 编译产出补丁 → 通过 WebSocket 推给浏览器 → 运行时替换模块并向上冒泡到可接受边界。",
      "模块没写 accept 处理时会退化成整页刷新；React Fast Refresh 与 Vue HMR 都是在框架层接管这一步。",
    ],
    related: ["code-splitting"],
    categoryId: "foundation-engineering",
  },
  {
    id: "tapable",
    term: "Tapable",
    en: "Tapable",
    domain: "engineering",
    short: "webpack 内部的事件流库，用钩子把编译流程拆成可注册、可插拔的节点。",
    detail: [
      "钩子分同步/异步、串行/并行，还有 Bail（任一返回非 undefined 就中断）与 Waterfall（值依次传递）。",
      "插件本质是 tap 到某个钩子上：拿到 compilation 就能读模块、改产物、加资源。",
    ],
    related: ["dependency-graph", "hmr"],
    categoryId: "foundation-engineering",
  },
  {
    id: "dependency-graph",
    term: "依赖图",
    en: "Dependency Graph",
    domain: "engineering",
    short: "从入口出发递归解析 import，得到「模块 → 依赖」的有向图。",
    detail: [
      "构建器沿图做拓扑排序，决定 chunk 切分与执行顺序；循环依赖会在这里被记录并给出警告。",
      "增量构建的缓存键、tree shaking 的可达性分析，都以这张图为输入。",
    ],
    related: ["tree-shaking", "tapable"],
    categoryId: "foundation-engineering",
  },
  {
    id: "source-map",
    term: "Source Map",
    en: "Source Map",
    domain: "engineering",
    short: "把压缩后的代码位置映射回源码，调试与错误上报都靠它。",
    detail: [
      "mappings 字段是 VLQ 编码的行列映射；sourcesContent 内联源码就不需要额外请求源文件。",
      "生产环境应上传到错误监控平台而不是公开暴露，否则等于把源码送人。",
    ],
    related: ["code-splitting"],
    categoryId: "foundation-engineering",
  },
  {
    id: "monorepo",
    term: "Monorepo",
    en: "Monorepo",
    domain: "engineering",
    short: "多个包放同一个仓库，统一依赖与构建，靠工作区协议互相引用。",
    detail: [
      "pnpm workspace / Turborepo / Nx 负责「只构建受影响的包」，否则一次改动全量重跑会很慢。",
      "代价是权限与发布流程要更严格，且版本对齐需要工具约束。",
    ],
    related: ["dependency-graph"],
    categoryId: "foundation-engineering",
  },
  {
    id: "contenthash",
    term: "产物指纹",
    en: "Content Hash",
    domain: "engineering",
    short: "文件名里带内容哈希，内容变则名字变，从而放心用长期强缓存。",
    detail: [
      "chunkhash 按入口算、contenthash 按内容算；改一个模块导致整包 hash 变化说明拆分粒度不够。",
      "运行时代码单独抽成 manifest chunk，可以避免「改业务代码把 vendor 的 hash 也带崩」。",
    ],
    related: ["strong-cache", "code-splitting"],
    categoryId: "foundation-engineering",
  },
  {
    id: "cicd",
    term: "CI/CD",
    en: "CI/CD",
    domain: "engineering",
    short: "持续集成把「提交 → 装依赖 → 检查 → 构建 → 测试」自动化，持续交付再把发布接上。",
    detail: [
      "关键不是流水线长得漂亮，而是门禁有效：类型检查、单测、构建产物校验缺一不可。",
      "缓存依赖与并行任务决定反馈时长；超过十分钟的流水线基本没人等。",
    ],
    related: ["contenthash"],
    categoryId: "foundation-engineering",
  },

  // ── Electron ──────────────────────────────────────────────────
  {
    id: "main-process",
    term: "主进程",
    en: "Main Process",
    domain: "electron",
    short: "Electron 的 Node 侧进程，创建窗口、管理生命周期、访问系统能力。",
    detail: [
      "整个应用只有一个主进程，它是所有渲染进程的「家长」，窗口关闭事件由它统一处理。",
      "所有危险能力（文件、shell、原生模块）都应该留在主进程，通过 IPC 暴露最小接口。",
    ],
    related: ["renderer-process", "ipc"],
    categoryId: "foundation-electron",
  },
  {
    id: "renderer-process",
    term: "渲染进程",
    en: "Renderer Process",
    domain: "electron",
    short: "跑 Chromium 页面的一侧，一个窗口一个进程，负责 UI。",
    detail: [
      "默认不信任：nodeIntegration 关闭后它连 require 都没有，只能通过 preload 暴露的 API 做事。",
      "多个窗口 = 多个渲染进程，彼此内存隔离，跨窗口通信要经主进程中转。",
    ],
    related: ["main-process", "preload"],
    categoryId: "foundation-electron",
  },
  {
    id: "preload",
    term: "预加载脚本",
    en: "Preload Script",
    domain: "electron",
    short: "在渲染进程加载页面前执行、同时能访问 Node 与页面 window 的桥接脚本。",
    detail: [
      "它是唯一同时握有两侧能力的执行环境，因此只应做「挑选少量接口挂到 window」这一件事。",
      "必须配合 contextIsolation，否则页面脚本能顺着原型链摸到 preload 的内部对象。",
    ],
    related: ["context-bridge", "context-isolation"],
    categoryId: "foundation-electron",
  },
  {
    id: "context-isolation",
    term: "上下文隔离",
    en: "contextIsolation",
    domain: "electron",
    short: "让 preload 与页面脚本运行在彼此隔离的 JS 上下文里，共享 DOM 但不共享全局对象。",
    detail: [
      "默认开启，是 Electron 安全基线的核心项；关掉它等于把 preload 的全部能力交给页面。",
      "隔离后只能通过 contextBridge 传递「可克隆的值 + 函数」，原型链暴露的漏洞被堵住。",
    ],
    related: ["preload", "context-bridge", "sandbox"],
    categoryId: "foundation-electron",
  },
  {
    id: "context-bridge",
    term: "contextBridge",
    en: "contextBridge",
    domain: "electron",
    short: "在隔离的上下文之间安全暴露 API 的官方通道。",
    detail: [
      "只支持函数与可结构化克隆的值，暴露对象里的原型与 getter 不会被带过去。",
      "正确做法是暴露「窄接口」（如 saveFile(path)），而不是把 ipcRenderer 整个扔给页面。",
    ],
    related: ["context-isolation", "ipc"],
    categoryId: "foundation-electron",
  },
  {
    id: "ipc",
    term: "IPC",
    en: "IPC, Inter-Process Communication",
    domain: "electron",
    short: "进程间通信：渲染进程 invoke/send，主进程 handle/on，数据经序列化传递。",
    detail: [
      "invoke/handle 是请求-响应式（返回 Promise），send/on 是单向广播，别用 send 做需要回执的事。",
      "通道名是唯一契约：主进程、preload 白名单、渲染层类型声明三处必须一致，否则调用静默失败。",
    ],
    related: ["main-process", "context-bridge"],
    categoryId: "foundation-electron",
  },
  {
    id: "sandbox",
    term: "沙箱",
    en: "Sandbox",
    domain: "electron",
    short: "把渲染进程关进操作系统级受限环境，禁止直接访问文件与系统调用。",
    detail: [
      "开启后 preload 只能用一部分 Node API（require 受限），重活必须转给主进程。",
      "沙箱 + 上下文隔离 + 关闭 nodeIntegration，是 Electron 官方三件套安全基线。",
    ],
    related: ["context-isolation"],
    categoryId: "foundation-electron",
  },
  {
    id: "asar",
    term: "asar 归档",
    en: "asar",
    domain: "electron",
    short: "把源码目录打成一个归档文件，减少文件数、加快启动，但不是加密。",
    detail: [
      "asar 内容可被直接解包读取，敏感逻辑不能靠它保护；真要保护得用字节码或加密方案。",
      "原生模块（.node）必须解包到 asarUnpack，否则运行时无法 dlopen。",
    ],
    related: ["main-process"],
    categoryId: "foundation-electron",
  },

  // ── Node.js ───────────────────────────────────────────────────
  {
    id: "nonblocking-io",
    term: "非阻塞 I/O",
    en: "Non-blocking I/O",
    domain: "node",
    short: "发起 I/O 后立刻返回，等操作系统通知结果，主线程继续处理别的请求。",
    detail: [
      "Node 的「单线程」指的是 JS 执行线程，底层 I/O 由 libuv 的线程池与事件通知机制完成。",
      "CPU 密集任务照样会堵住事件循环，要么拆片、要么丢给 worker_threads / 子进程。",
    ],
    related: ["libuv", "event-loop"],
    categoryId: "foundation-node",
  },
  {
    id: "libuv",
    term: "libuv",
    en: "libuv",
    domain: "node",
    short: "Node 的跨平台异步 I/O 库，提供事件循环、线程池与文件/网络能力。",
    detail: [
      "默认线程池 4 个线程（UV_THREADPOOL_SIZE 可调），文件读写、DNS 查询都跑在这上面。",
      "它把不同操作系统的 epoll / kqueue / IOCP 抹平成同一套事件循环阶段。",
    ],
    related: ["nonblocking-io", "io-multiplexing"],
    categoryId: "foundation-node",
  },
  {
    id: "backpressure",
    term: "背压",
    en: "Backpressure",
    domain: "node",
    short: "下游处理不过来时，上游要减速或暂停，避免内存被堆积的数据撑爆。",
    detail: [
      "Stream 的 write() 返回 false 就是背压信号，应暂停写入并等 drain 事件。",
      "pipe 会自动处理背压，手写 data 事件监听则要自己做，否则大文件直接把内存吃满。",
    ],
    related: ["stream"],
    categoryId: "foundation-node",
  },
  {
    id: "stream",
    term: "数据流",
    en: "Stream",
    domain: "node",
    short: "分块处理数据、边读边写的抽象，四种类型：可读、可写、双工、转换。",
    detail: [
      "核心价值是内存恒定：处理 10GB 文件不需要 10GB 内存。",
      "默认是 Buffer 模式（二进制），设 objectMode 可以传任意对象，管道化处理更自然。",
    ],
    related: ["backpressure"],
    categoryId: "foundation-node",
  },
  {
    id: "middleware",
    term: "中间件",
    en: "Middleware",
    domain: "node",
    short: "请求与响应之间的一串处理函数，各自决定「继续」还是「就此返回」。",
    detail: [
      "Express 靠 next() 传递控制权，顺序即优先级，注册晚了就轮不到。",
      "Koa 用 async/await 做成洋葱模型，同一个中间件可以在 await next() 前后各做一段。",
    ],
    related: ["nonblocking-io"],
    categoryId: "foundation-node",
  },

  // ── 算法 ──────────────────────────────────────────────────────
  {
    id: "divide-conquer",
    term: "分治",
    en: "Divide and Conquer",
    domain: "algorithm",
    short: "把问题拆成同类子问题，分别求解后合并，归并排序与快排都是这个骨架。",
    detail: [
      "三步固定：分解 → 递归求解 → 合并；复杂度由递归式决定（如 T(n)=2T(n/2)+O(n) → O(n log n)）。",
      "分治要求子问题独立；有重叠子问题时要换成动态规划，否则会重复计算。",
    ],
    related: ["dp", "backtracking"],
    categoryId: "written-algorithm",
  },
  {
    id: "two-pointers",
    term: "双指针",
    en: "Two Pointers",
    domain: "algorithm",
    short: "用两个下标按规则移动，把 O(n²) 的枚举压成 O(n)。",
    detail: [
      "常见形态：有序数组左右夹逼（两数之和）、快慢指针（判环、找中点）、同向滑动（去重）。",
      "成立的前提是「单调性」：移动哪一侧必须能确定地排除一批不可能的解。",
    ],
    related: ["sliding-window"],
    categoryId: "written-algorithm",
  },
  {
    id: "sliding-window",
    term: "滑动窗口",
    en: "Sliding Window",
    domain: "algorithm",
    short: "维护一个满足条件的连续区间，右端扩张、左端收缩，全程不回退。",
    detail: [
      "模板是两段循环：外层右移扩大窗口，内层 while 不满足条件时左移收缩，同时更新答案。",
      "只适用于「连续子数组/子串」类问题；子序列类问题用不了。",
    ],
    related: ["two-pointers", "monotonic-stack"],
    categoryId: "written-algorithm",
  },
  {
    id: "monotonic-stack",
    term: "单调栈",
    en: "Monotonic Stack",
    domain: "algorithm",
    short: "栈内元素保持单调，遇到破坏单调性的元素就弹出并结算它，O(n) 解决「下一个更大」类问题。",
    detail: [
      "每个下标最多入栈出栈各一次，所以是线性复杂度；空间最坏 O(n)。",
      "同模板可解：每日温度、接雨水、柱状图最大矩形、去除重复字母。",
    ],
    related: ["two-pointers"],
    categoryId: "written-algorithm",
  },
  {
    id: "dp",
    term: "动态规划",
    en: "Dynamic Programming",
    domain: "algorithm",
    short: "把问题拆成有重叠的子问题，记录子问题答案避免重复计算。",
    detail: [
      "三要素：状态定义、转移方程、边界与遍历顺序；状态定义错了后面全错。",
      "记忆化搜索（自顶向下）与递推（自底向上）是同一套东西的两种写法，前者更好写、后者更省空间。",
    ],
    related: ["state-transition", "divide-conquer", "memoization"],
    categoryId: "written-algorithm",
  },
  {
    id: "state-transition",
    term: "状态转移方程",
    en: "State Transition",
    domain: "algorithm",
    short: "描述「当前状态由哪些旧状态推出」的递推式，是 DP 的核心。",
    detail: [
      "写方程前先明确状态含义（dp[i] 到底指什么），再确定每一步有几种选择。",
      "能用滚动数组降维的前提是：当前状态只依赖固定几个前驱。",
    ],
    related: ["dp"],
    categoryId: "written-algorithm",
  },
  {
    id: "greedy",
    term: "贪心",
    en: "Greedy",
    domain: "algorithm",
    short: "每步都取当前最优，且不回头；能用它解题需要证明「局部最优可推全局最优」。",
    detail: [
      "适用条件是贪心选择性质 + 最优子结构；证明通常用交换论证（把最优解换成贪心解不变差）。",
      "区间调度、找零（特定币值）、霍夫曼编码是经典可贪心问题；0-1 背包不能贪心。",
    ],
    related: ["dp"],
    categoryId: "written-algorithm",
  },
  {
    id: "backtracking",
    term: "回溯",
    en: "Backtracking",
    domain: "algorithm",
    short: "深度优先枚举所有选择，走不通就撤销这一步再试下一种。",
    detail: [
      "模板三段：选择 → 递归 → 撤销选择（对称操作，漏了撤销就是经典 bug）。",
      "剪枝（排序后跳过重复、提前判断可行性）决定它能不能过时限。",
    ],
    related: ["divide-conquer"],
    categoryId: "written-algorithm",
  },
  {
    id: "bfs",
    term: "BFS",
    en: "Breadth-First Search",
    domain: "algorithm",
    short: "广度优先：用队列一层层推进，天然求出无权图的最短路径。",
    detail: [
      "必须入队即标记访问，否则同一节点会被重复入队，队列膨胀甚至死循环。",
      "需要分层信息时在内层先取 queue.length 作为本层数量。",
    ],
    related: ["dfs"],
    categoryId: "written-algorithm",
  },
  {
    id: "dfs",
    term: "DFS",
    en: "Depth-First Search",
    domain: "algorithm",
    short: "深度优先：沿一条路走到底再回头，递归或显式栈实现。",
    detail: [
      "递归版最直观，但深度大时会栈溢出，需要改显式栈或加大栈空间。",
      "网格题记得四向/八向方向数组与「访问标记」，否则会来回走。",
    ],
    related: ["bfs", "backtracking"],
    categoryId: "written-algorithm",
  },
  {
    id: "union-find",
    term: "并查集",
    en: "Union-Find / DSU",
    aliases: ["DSU"],
    domain: "algorithm",
    short: "维护元素分组的数据结构，支持「合并两组」与「查是否同组」，近 O(1)。",
    detail: [
      "两个优化缺一不可：路径压缩（查完把沿途节点直接挂到根上）+ 按秩/按大小合并。",
      "典型场景：连通分量、岛屿数量、冗余连接、Kruskal 最小生成树。",
    ],
    related: ["bfs"],
    categoryId: "written-algorithm",
  },
  {
    id: "heap",
    term: "二叉堆",
    en: "Heap",
    aliases: ["堆排序"],
    domain: "algorithm",
    short: "完全二叉树形态的优先队列实现，堆顶恒为最值，插入与弹出 O(log n)。",
    detail: [
      "用数组存：父 i → 子 2i+1 / 2i+2，建堆是 O(n)（自底向上下沉），不是 O(n log n)。",
      "求 TopK 用「大小为 K 的小顶堆」，比全排序 O(n log n) 更省。",
    ],
    related: ["priority-queue"],
    categoryId: "written-algorithm",
  },
  {
    id: "priority-queue",
    term: "优先队列",
    en: "Priority Queue",
    domain: "algorithm",
    short: "出队顺序由优先级决定而不是入队顺序，通常用堆实现。",
    detail: [
      "Dijkstra、A*、合并 K 条有序链表都靠它每次取出当前最小。",
      "面试里手写一个小顶堆 + push/pop 就够用，不必实现完整的优先队列接口。",
    ],
    related: ["heap"],
    categoryId: "written-algorithm",
  },
  {
    id: "complexity",
    term: "时间复杂度",
    en: "Time Complexity",
    domain: "algorithm",
    short: "输入规模增长时运算次数的增长量级，用大 O 表示上界。",
    detail: [
      "常见量级：O(1) < O(log n) < O(n) < O(n log n) < O(n²) < O(2ⁿ)。",
      "面试里要能对每一行代码说出它在哪个量级，并说明最坏与平均的区别。",
    ],
    related: ["amortized"],
    categoryId: "written-algorithm",
  },
  {
    id: "amortized",
    term: "摊还分析",
    en: "Amortized Analysis",
    domain: "algorithm",
    short: "把偶发的高代价操作平摊到一系列操作上，得到「平均每次」的复杂度。",
    detail: [
      "动态数组扩容单次 O(n)，但连续 n 次 push 总代价 O(n)，所以摊还是 O(1)。",
      "两个栈实现队列也是这个结论：每个元素最多被搬两次。",
    ],
    related: ["complexity"],
    categoryId: "written-algorithm",
  },
  {
    id: "stable-sort",
    term: "稳定排序",
    en: "Stable Sort",
    domain: "algorithm",
    short: "相等元素的相对顺序在排序后保持不变。",
    detail: [
      "归并、插入、冒泡稳定；快排、堆排、选择排序不稳定（可用「值+原下标」配对强行稳定）。",
      "多关键字排序时靠它做「先按次要关键字排，再按主要关键字排」的链式处理。",
    ],
    related: ["divide-conquer"],
    categoryId: "written-algorithm",
  },

  // ── 数据库 ────────────────────────────────────────────────────
  {
    id: "db-index",
    term: "索引",
    en: "Index",
    domain: "database",
    short: "为加速查询额外维护的有序数据结构，代价是写入变慢、占用空间。",
    detail: [
      "本质是把「全表扫描」换成「按序定位」；区分度低的列（性别、状态）建索引收益极小。",
      "联合索引遵循最左前缀，范围查询之后的列无法再走索引定位。",
    ],
    related: ["btree", "leftmost-prefix", "table-lookup"],
    categoryId: "foundation-database",
  },
  {
    id: "btree",
    term: "B+ 树",
    en: "B+ Tree",
    domain: "database",
    short: "多路平衡查找树，非叶节点只存键、叶节点存数据并用链表相连，适合磁盘。",
    detail: [
      "三层的 B+ 树能存千万级数据，一次查询只需 2-3 次磁盘 I/O —— 这是它胜过二叉树的根本原因。",
      "叶节点链表让范围查询与排序可以直接顺序扫描，不必回到根节点。",
    ],
    related: ["db-index", "clustered-index"],
    categoryId: "foundation-database",
  },
  {
    id: "clustered-index",
    term: "聚簇索引",
    en: "Clustered Index",
    domain: "database",
    short: "索引与数据存在一起、按索引顺序组织表数据，InnoDB 的主键索引就是它。",
    detail: [
      "一张表只能有一个聚簇索引；没有主键时 InnoDB 会隐式生成 row_id。",
      "主键建议用自增：随机主键会让插入不断在中间页分裂，产生大量碎片。",
    ],
    related: ["btree", "table-lookup"],
    categoryId: "foundation-database",
  },
  {
    id: "table-lookup",
    term: "回表",
    en: "Table Lookup",
    domain: "database",
    short: "二级索引只存索引列与主键，要拿其他列还得按主键再查一次聚簇索引。",
    detail: [
      "一次查询两次 B+ 树查找，是二级索引查询慢的直接原因。",
      "用覆盖索引（把要查的列都放进索引）可以避免回表，是最高频的 SQL 优化手段。",
    ],
    related: ["db-index", "clustered-index"],
    categoryId: "foundation-database",
  },
  {
    id: "leftmost-prefix",
    term: "最左前缀",
    en: "Leftmost Prefix",
    domain: "database",
    short: "联合索引 (a,b,c) 只能被「从 a 开始连续使用」的条件命中。",
    detail: [
      "where b=1 用不上这个索引；where a=1 and c=2 只用到 a 这一段。",
      "范围查询（>、<、between、like 'x%'）会让后续列失去索引定位能力，但可以用上索引下推做过滤。",
    ],
    related: ["db-index"],
    categoryId: "foundation-database",
  },
  {
    id: "acid",
    term: "ACID",
    en: "ACID",
    domain: "database",
    short: "事务四特性：原子性、一致性、隔离性、持久性。",
    detail: [
      "原子性靠 undo log 回滚，持久性靠 redo log 落盘，隔离性靠锁与 MVCC。",
      "「一致性」是目的，其余三个是手段 —— 这条常被答反。",
    ],
    related: ["isolation-level", "mvcc"],
    categoryId: "foundation-database",
  },
  {
    id: "isolation-level",
    term: "隔离级别",
    en: "Isolation Level",
    domain: "database",
    short: "读未提交 / 读已提交 / 可重复读 / 串行化，逐级用性能换一致性。",
    detail: [
      "读未提交会脏读；读已提交会不可重复读；可重复读在 MySQL 里靠 MVCC + 间隙锁基本解决幻读。",
      "级别越高并发越差，多数业务用「读已提交」或「可重复读」。",
    ],
    related: ["acid", "mvcc", "phantom-read"],
    categoryId: "foundation-database",
  },
  {
    id: "mvcc",
    term: "MVCC",
    en: "MVCC, Multi-Version Concurrency Control",
    domain: "database",
    short: "多版本并发控制：读操作读历史快照，不加锁也不阻塞写。",
    detail: [
      "每行带隐藏的事务版本号，配合 undo log 版本链与 ReadView 判断「这个版本对我可见吗」。",
      "它是「读不加锁」的基础，也是可重复读能成立的原因。",
    ],
    related: ["isolation-level", "acid"],
    categoryId: "foundation-database",
  },
  {
    id: "phantom-read",
    term: "幻读",
    en: "Phantom Read",
    domain: "database",
    short: "同一事务内两次同样的范围查询，第二次多出了别的事务插入的行。",
    detail: [
      "不可重复读针对「同一行的值变了」，幻读针对「行数变了」，解决手段不同。",
      "InnoDB 用间隙锁（Next-Key Lock）锁住范围，阻止范围内插入。",
    ],
    related: ["isolation-level", "mvcc"],
    categoryId: "foundation-database",
  },

  // ── 操作系统 ──────────────────────────────────────────────────
  {
    id: "context-switch",
    term: "上下文切换",
    en: "Context Switch",
    domain: "os",
    short: "CPU 从执行一个任务切到另一个，需要保存并恢复寄存器与栈。",
    detail: [
      "切换本身不干活，纯开销（微秒级），所以线程数远超核数时性能会明显下降。",
      "协程切换在用户态完成，不需要陷入内核，因此比线程切换便宜一个量级。",
    ],
    related: ["call-stack"],
    categoryId: "foundation-os",
  },
  {
    id: "virtual-memory",
    term: "虚拟内存",
    en: "Virtual Memory",
    domain: "os",
    short: "给每个进程一套独立地址空间，由页表映射到物理内存，隔离且可超额分配。",
    detail: [
      "缺页中断时才真正分配物理页，所以「申请 1GB」不等于立刻占用 1GB。",
      "换页（swap）把不常用页写到磁盘，频繁换页就是系统卡顿的常见原因。",
    ],
    related: ["context-switch"],
    categoryId: "foundation-os",
  },
  {
    id: "zero-copy",
    term: "零拷贝",
    en: "Zero-Copy",
    domain: "os",
    short: "省掉数据在内核缓冲区与用户缓冲区之间的来回拷贝。",
    detail: [
      "传统 read + write 要 4 次拷贝 4 次态切换；sendfile 把路径压到 2 次拷贝。",
      "Kafka、Nginx 静态文件分发都靠它拿到高吞吐。",
    ],
    related: ["io-multiplexing"],
    categoryId: "foundation-os",
  },
  {
    id: "io-multiplexing",
    term: "I/O 多路复用",
    en: "I/O Multiplexing",
    domain: "os",
    short: "一个线程用 select / poll / epoll 同时盯住大量文件描述符，谁就绪就处理谁。",
    detail: [
      "epoll 用红黑树管理 fd、就绪链表回调通知，只返回就绪的 fd，避免每次全量轮询。",
      "这是 Node、Nginx、Redis 单线程高并发的底层支撑。",
    ],
    related: ["libuv", "zero-copy"],
    categoryId: "foundation-os",
  },
  {
    id: "deadlock",
    term: "死锁",
    en: "Deadlock",
    domain: "os",
    short: "多个线程互相持有对方需要的锁，谁都不肯先放，全部卡死。",
    detail: [
      "四个必要条件：互斥、占有且等待、不可抢占、循环等待；破坏任意一条即可预防。",
      "工程上最有效的是「统一加锁顺序」，从根上消除循环等待。",
    ],
    related: ["context-switch"],
    categoryId: "foundation-os",
  },

  // ── AI 辅助开发 ───────────────────────────────────────────────
  {
    id: "prompt",
    term: "Prompt",
    en: "Prompt",
    domain: "ai",
    short: "给模型的输入指令，包含角色、任务、约束与示例四类信息。",
    detail: [
      "结构化写法（明确目标 + 输出格式 + 边界条件）比「请帮我写个函数」稳定得多。",
      "少样本示例（few-shot）对格式类任务效果最直接，但示例要覆盖边界而不是只有正常路径。",
    ],
    related: ["context-window", "hallucination"],
    categoryId: "foundation-ai",
  },
  {
    id: "rag",
    term: "RAG",
    en: "RAG, Retrieval-Augmented Generation",
    domain: "ai",
    short: "先检索相关资料再让模型基于资料回答，缓解幻觉与知识过期。",
    detail: [
      "链路是：切块 → 向量化 → 存库 → 按问题召回 → 拼进 prompt → 生成并附引用。",
      "效果瓶颈通常在检索而不是生成：召回不准，模型再强也只能编。",
    ],
    related: ["embedding", "hallucination"],
    categoryId: "foundation-ai",
  },
  {
    id: "embedding",
    term: "Embedding",
    en: "Embedding",
    domain: "ai",
    short: "把文本映射成向量，语义相近的向量距离也相近，用于检索与聚类。",
    detail: [
      "相似度一般用余弦距离；不同模型产出的向量不可混用，换模型必须重建索引。",
      "中文场景要选中文语料训练过的模型，直接用英文模型召回会明显变差。",
    ],
    related: ["rag"],
    categoryId: "foundation-ai",
  },
  {
    id: "hallucination",
    term: "幻觉",
    en: "Hallucination",
    domain: "ai",
    short: "模型给出看似合理但与事实不符的内容，且语气通常同样自信。",
    detail: [
      "成因是「按概率续写」而非「查证事实」，越少见的实体越容易编。",
      "缓解手段：给上下文资料、要求引用出处、让模型标注不确定、关键结论人工复核。",
    ],
    related: ["rag", "prompt"],
    categoryId: "foundation-ai",
  },
  {
    id: "context-window",
    term: "上下文窗口",
    en: "Context Window",
    domain: "ai",
    short: "模型单次能读入的 token 上限，输入与输出共享这个预算。",
    detail: [
      "超长上下文并不等于「都能记住」，中间部分的信息利用率明显低于首尾。",
      "工程上靠分块、摘要、检索来压缩，而不是硬塞满窗口。",
    ],
    related: ["prompt", "rag"],
    categoryId: "foundation-ai",
  },
  {
    id: "function-calling",
    term: "Function Calling",
    en: "Function Calling",
    domain: "ai",
    short: "模型按约定格式输出「要调用哪个函数、参数是什么」，由你的代码真正执行。",
    detail: [
      "模型只负责出参数，不负责执行；执行结果再回灌给模型做下一步推理。",
      "参数校验必须在自己的代码里做，模型给的参数不可信。",
    ],
    related: ["agent"],
    categoryId: "foundation-ai",
  },
  {
    id: "agent",
    term: "Agent",
    en: "Agent",
    domain: "ai",
    short: "让模型在「思考 → 调工具 → 看结果」的循环里自主推进任务。",
    detail: [
      "核心是循环 + 工具 + 终止条件；没有终止条件与预算上限的 Agent 会无限调工具烧钱。",
      "可靠性来自「每步可观测 + 关键节点人工确认」，而不是把整条链路全交给模型。",
    ],
    related: ["function-calling", "prompt"],
    categoryId: "foundation-ai",
  },
];

/** 词条 id → 词条，供「相关词条」按 id 反查 */
export const GLOSSARY_BY_ID: Readonly<Record<string, GlossaryTerm>> = Object.freeze(
  Object.fromEntries(GLOSSARY_TERMS.map((term) => [term.id, term])),
);

/**
 * 匹配键 → 词条。
 *
 * 一个词条可以有多个键（`term` / `en` / `aliases`），键统一转小写做大小写不敏感匹配。
 * 键重复由 `interview-glossary.test.ts` 挡住 —— 否则命中哪个词条取决于数组顺序。
 */
const KEY_TO_TERM = (() => {
  const map = new Map<string, GlossaryTerm>();
  for (const term of GLOSSARY_TERMS) {
    for (const key of [term.term, term.en, ...(term.aliases ?? [])]) {
      if (!key) continue;
      map.set(key.toLowerCase(), term);
    }
  }
  return map;
})();

/** ASCII 字母/数字/下划线：这类键两侧必须断开，否则 Fiber 会命中 FiberNode */
const ASCII_EDGE = /[A-Za-z0-9_$]/;

/**
 * Aho–Corasick 自动机。
 *
 * 匹配发生在每次渲染的每一段文本上（一屏 12 张卡片 × 标题 / 题干 / 答案），
 * 「把几百个键拼成一条正则」在长文本上会退化成「每个位置试几百个分支」。
 * AC 把扫描压成一次线性遍历：走到哪个节点就产出哪些键，与词典规模无关。
 */
interface TermTrieNode {
  next: Map<string, number>;
  fail: number;
  /** 以该节点结尾的匹配键（含通过 fail 链继承来的后缀键） */
  keys: string[];
}

const TERM_TRIE = (() => {
  const nodes: TermTrieNode[] = [{ next: new Map(), fail: 0, keys: [] }];
  for (const key of KEY_TO_TERM.keys()) {
    let cursor = 0;
    for (let index = 0; index < key.length; index += 1) {
      const ch = key[index];
      let child = nodes[cursor].next.get(ch);
      if (child === undefined) {
        nodes.push({ next: new Map(), fail: 0, keys: [] });
        child = nodes.length - 1;
        nodes[cursor].next.set(ch, child);
      }
      cursor = child;
    }
    nodes[cursor].keys.push(key);
  }

  // BFS 建失败指针，并把 fail 链上的键并进来 —— 否则「后缀本身也是词条」时会漏
  const queue: number[] = [];
  for (const child of nodes[0].next.values()) {
    nodes[child].fail = 0;
    queue.push(child);
  }
  while (queue.length > 0) {
    const current = queue.shift() as number;
    for (const [ch, child] of nodes[current].next) {
      let fallback = nodes[current].fail;
      while (fallback !== 0 && !nodes[fallback].next.has(ch)) {
        fallback = nodes[fallback].fail;
      }
      const target = nodes[fallback].next.get(ch);
      nodes[child].fail = target !== undefined && target !== child ? target : 0;
      nodes[child].keys.push(...nodes[nodes[child].fail].keys);
      queue.push(child);
    }
  }
  return nodes;
})();

interface RawTermMatch {
  start: number;
  /** 命中区间的右端点（不含） */
  end: number;
  key: string;
}

/**
 * 扫一遍文本收集所有命中（允许重叠，交给调用方挑最长）。
 *
 * 逐字符小写而不是整串 `toLowerCase()`：后者在极少数字符上会改变长度，
 * 让下标与原文错位；逐字符转换最多是「这个字符不匹配」，不会串位。
 */
function collectTermMatches(text: string): RawTermMatch[] {
  const matches: RawTermMatch[] = [];
  let node = 0;

  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index].toLowerCase();
    while (node !== 0 && !TERM_TRIE[node].next.has(ch)) node = TERM_TRIE[node].fail;
    node = TERM_TRIE[node].next.get(ch) ?? 0;
    if (node === 0) continue;

    for (const key of TERM_TRIE[node].keys) {
      const start = index - key.length + 1;
      if (start < 0) continue;
      // 英文键两侧必须断开：FiberNode 里的 Fiber 不算命中
      if (ASCII_EDGE.test(key[0]) && start > 0 && ASCII_EDGE.test(text[start - 1])) continue;
      const last = key[key.length - 1];
      if (ASCII_EDGE.test(last) && index + 1 < text.length && ASCII_EDGE.test(text[index + 1])) {
        continue;
      }
      matches.push({ start, end: index + 1, key });
    }
  }

  return matches;
}

/** 文本切段：`term` 有值表示这段是可点击的名词 */
export interface GlossarySegment {
  text: string;
  term?: GlossaryTerm;
  /**
   * 命中区间在**原文**里的起点（含）。
   *
   * 只有 `persistence/glossary-matcher.ts` 建出的匹配器会填这两个字段；
   * 本文件的 `splitByGlossary` 不填（现有 30+ 调用点按「无偏移」工作，保持向后兼容）。
   * 用途是划词：`TermText` 把文本切成多个节点，光靠 `getSelection().toString()`
   * 在跨高亮词的选区上会错位，必须用「节点偏移 + range 偏移」反算原文区间。
   */
  start?: number;
  /** 命中区间在原文里的终点（不含） */
  end?: number;
}

/**
 * 把一段纯文本按词典切成「普通文字 / 名词」交替的片段。
 *
 * 取「最左 + 最长」：先按起点升序、同起点按长度降序排，再贪心跳过重叠命中。
 * 所以「最长递增子序列」不会被切成「最长」+「递增子序列」。
 */
export function splitByGlossary(text: string): GlossarySegment[] {
  if (text.length === 0) return [];
  const matches = collectTermMatches(text).sort(
    (left, right) => left.start - right.start || right.key.length - left.key.length,
  );

  const segments: GlossarySegment[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue;
    const term = KEY_TO_TERM.get(match.key);
    if (!term) continue;
    if (match.start > cursor) segments.push({ text: text.slice(cursor, match.start) });
    segments.push({ text: text.slice(match.start, match.end), term });
    cursor = match.end;
  }

  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}

/** 词条查询：找不到返回 undefined，调用方负责兜底渲染 */
export function glossaryById(id: string): GlossaryTerm | undefined {
  return GLOSSARY_BY_ID[id];
}

/**
 * 整段精确匹配。
 *
 * 行内代码（`` `structuredClone` ``）里通常就是术语本身，用不着切段；
 * 但必须是**整段相等**才算命中 —— 否则 `Array.from(new Set(arr))` 这种
 * 长代码片段会因为含有关键词而被整体替换成名词按钮。
 */
export function glossaryExact(text: string): GlossaryTerm | undefined {
  return KEY_TO_TERM.get(text.trim().toLowerCase());
}

/** 文本里命中的**去重**词条，用于统计与自检 */
export function glossaryTermsIn(text: string): GlossaryTerm[] {
  const seen = new Set<string>();
  const hits: GlossaryTerm[] = [];
  for (const segment of splitByGlossary(text)) {
    if (!segment.term || seen.has(segment.term.id)) continue;
    seen.add(segment.term.id);
    hits.push(segment.term);
  }
  return hits;
}
