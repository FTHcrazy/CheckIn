/**
 * 题库 · JavaScript 与 TypeScript。
 *
 * JS 侧覆盖语言机制（作用域、原型、事件循环、内存），
 * TS 侧覆盖类型系统（收窄、条件类型、结构化类型）——都是二面起的深挖区。
 */
import type { InterviewQuestion } from "./interview-types";

export const SEED_JS_TS: readonly InterviewQuestion[] = [
  // ── JavaScript ─────────────────────────────────────────────
  {
    id: "js-types-coercion",
    title: "== 的转换规则与 0.1 + 0.2 问题",
    stem: "解释 null == undefined 为 true 而 null === 0 为 false，以及浮点精度问题的成因。",
    answer: `- \`==\` 在类型不同时会做转换：null 与 undefined **只与彼此宽松相等**（规范特例），所以 \`null == 0\` 是 false。
- 对象与原始值比较会先 \`ToPrimitive\`，因此 \`[] == 0\` 为 true；实际开发里一律用 \`===\`，唯一例外是 \`x == null\` 同时覆盖 null 与 undefined。
- \`0.1 + 0.2 !== 0.3\` 是 **IEEE 754 双精度二进制浮点**无法精确表示 0.1 导致的舍入误差，不是 JS 独有。
- 处理金额用**整数分**或 \`BigInt\`；展示用 \`toFixed\` 或 \`Intl.NumberFormat\`；比较用 \`Math.abs(a-b) < Number.EPSILON\`。`,
    track: "foundation",
    categoryId: "foundation-js",
    difficulty: "basic",
    tags: ["基础", "JavaScript", "高频"],
    topic: "JavaScript 类型与转换",
    reviewedAt: "2026-11",
    heat: 74,
    updatedAt: "2026-10-29",
  },
  {
    id: "js-scope-closure",
    title: "闭包的本质与常见陷阱",
    stem: "从作用域链解释闭包，并说明循环里用 var 绑定事件为什么都拿到最后一个值。",
    answer: `- 闭包 = **函数 + 它定义时所处的词法环境**。内层函数持有外层变量对象的引用，外层执行结束后变量仍不会被回收。
- 用途：私有状态（模块模式）、函数工厂、防抖节流的计时器、React Hooks 里的 \`state\` 快照。
- \`var\` 在循环里是**函数作用域 + 变量提升**，所有回调共享同一个变量；\`let\` 每轮迭代创建新的绑定（规范里的 per-iteration environment），所以能拿到当轮值。
- 闭包也是内存泄漏的常见来源：长生命周期的回调持有大对象时，要在清理函数里断开引用。`,
    track: "foundation",
    categoryId: "foundation-js",
    difficulty: "medium",
    tags: ["高频", "JavaScript", "原理"],
    topic: "JavaScript 作用域与闭包",
    reviewedAt: "2026-11",
    heat: 88,
    updatedAt: "2026-11-06",
  },
  {
    id: "js-prototype-chain",
    title: "原型、原型链与继承实现",
    stem: "说明 prototype 与 __proto__ 的区别，以及 class 与传统原型继承的关系。",
    answer: `- 每个函数有 \`prototype\`（给实例用的原型对象），每个对象有 \`[[Prototype]]\`（可用 \`Object.getPrototypeOf\` 读，\`__proto__\` 是历史访问器）。
- 属性查找沿原型链向上直到 \`null\`；\`instanceof\` 检查构造函数的 prototype 是否在链上，\`hasOwnProperty\` 只查自身。
- \`class\` 是原型继承的**语法糖但有实质差异**：不会提升（TDZ）、默认严格模式、方法不可枚举、必须用 \`new\` 调用、支持 \`super\`。
- 最优继承写法是 \`Object.create(parent.prototype)\` + 修正 \`constructor\`；现在一律用 \`class extends\`。
- 追问：\`Object.create(null)\` 得到无原型对象，可当纯字典用，避免 \`toString\` 之类键污染。`,
    track: "foundation",
    categoryId: "foundation-js",
    difficulty: "medium",
    tags: ["JavaScript", "原理", "高频"],
    topic: "JavaScript 原型与继承",
    reviewedAt: "2026-11",
    heat: 82,
    updatedAt: "2026-10-29",
  },
  {
    id: "js-this-rules",
    title: "this 的绑定规则与箭头函数的例外",
    stem: "列出 this 的五种绑定场景，并说明箭头函数为什么不能被 bind。",
    answer: `- 优先级从高到低：**new 绑定 > 显式绑定（call/apply/bind）> 隐式绑定（obj.fn()）> 默认绑定**（严格模式 undefined，非严格 window）。
- 箭头函数**没有自己的 this**，它在定义时捕获外层 this，因此 bind / call 无法改变它，也不能作为构造函数。
- 隐式绑定丢失是最常见的坑：\`const fn = obj.method; fn()\` 里的 this 不再是 obj（回调传参、\`setTimeout\` 都会丢）。
- 类组件里用箭头函数定义方法或构造函数里 bind，正是为了绕开这个丢失。`,
    track: "foundation",
    categoryId: "foundation-js",
    difficulty: "basic",
    tags: ["基础", "JavaScript", "高频"],
    topic: "JavaScript this 绑定",
    reviewedAt: "2026-11",
    heat: 80,
    updatedAt: "2026-10-23",
  },
  {
    id: "js-event-loop",
    title: "事件循环：宏任务、微任务与渲染时机",
    stem: "写出下面代码的输出顺序，并说明浏览器在什么时候执行渲染。",
    stemCodeLang: "js",
    stemCode: `console.log(1);
setTimeout(() => console.log(2));
Promise.resolve().then(() => console.log(3));
console.log(4);
Promise.resolve().then(() => {
  console.log(5);
  queueMicrotask(() => console.log(6));
});`,
    answer: `- 顺序：**1 → 4 → 3 → 5 → 6 → 2**。\`1\`、\`4\` 是 script 宏任务里的同步代码；同步栈清空后才进微任务队列。
- 微任务队列**边清空边追加**：\`3\` 之后执行 \`5\`，\`5\` 里新排的 \`queueMicrotask\` 仍在同一轮继续执行，所以 \`6\` 不会等到下一个宏任务。
- 一轮循环：执行一个**宏任务** → 清空**所有微任务队列** → 需要时渲染 → 取下一个宏任务；因此 Promise 永远早于 \`setTimeout\`，\`await\` 之后的代码也是微任务。
- 渲染发生在**微任务清空后**，且不保证每轮都渲染（浏览器按需合并）。大量同步/微任务会推迟渲染 —— 这就是长任务掉帧的根因，让出主线程用 \`setTimeout\` / \`scheduler.postTask\` / \`requestIdleCallback\`。
- Node.js 差异：多了 \`process.nextTick\`（优先于 Promise 微任务）与六个明确的阶段，但「每个阶段之间清空微任务」是一致的。`,
    track: "foundation",
    categoryId: "foundation-js",
    difficulty: "hard",
    tags: ["高频", "原理", "大厂"],
    topic: "JavaScript 事件循环",
    reviewedAt: "2026-11",
    heat: 95,
    updatedAt: "2026-11-13",
  },
  {
    id: "js-promise-async",
    title: "Promise 状态机与 async/await 的等价改写",
    stem: "说明 Promise 的三种状态与 thenable 的处理，并把一段 then 链改写成 async/await。",
    answer: `- 状态只有 **pending → fulfilled / rejected**，且不可逆；\`then\` 返回**新的 Promise**，因此可以链式。
- \`then\` 的回调抛错会让新 Promise 变 rejected；返回 Promise 会被**展开**（adopt），返回 thenable 也会被当作 Promise 处理。
- 未处理的 rejection 会触发 \`unhandledrejection\`，要在全局兜底或每个分支都 \`catch\`。
- \`async\` 函数返回 Promise，\`await\` 等价于在 \`then\` 里取值的语法糖；\`try/catch\` 只能捕获 \`await\` 到的错误。
- 串行用 \`for...of + await\`，并行务必用 \`Promise.all\`，否则 10 个请求会排队变成 10 倍耗时。`,
    track: "foundation",
    categoryId: "foundation-js",
    difficulty: "medium",
    tags: ["异步", "JavaScript", "高频"],
    topic: "Promise 与 async/await",
    reviewedAt: "2026-11",
    heat: 85,
    updatedAt: "2026-11-02",
  },
  {
    id: "js-event-delegation",
    title: "事件流、事件委托与 passive 监听",
    stem: "解释捕获/冒泡，说明事件委托的收益与边界，以及 passive 的作用。",
    answer: `- 事件流三段：**捕获（window → target）→ 目标 → 冒泡（target → window）**；\`addEventListener\` 第三个参数 \`capture: true\` 可改为捕获阶段。
- 委托 = 在父级监听、用 \`event.target\` 判断来源。收益是**减少监听器数量**、动态子节点自动生效；边界是 \`focus\`/\`blur\` 不冒泡（用 \`focusin\`）、\`stopPropagation\` 会打断、需要 \`closest\` 做精确匹配。
- \`{ passive: true }\` 告诉浏览器该监听器不会 \`preventDefault\`，滚动线程不必等主线程，大幅改善移动端滚动流畅度。
- 移除监听必须传同一个函数引用，否则无法解绑 —— 这也是组件卸载后回调仍触发的常见原因。`,
    track: "foundation",
    categoryId: "foundation-js",
    difficulty: "medium",
    tags: ["浏览器", "JavaScript", "高频"],
    topic: "DOM 事件模型",
    reviewedAt: "2026-11",
    heat: 76,
    updatedAt: "2026-10-24",
  },
  {
    id: "js-array-iteration",
    title: "map / forEach / reduce 的区别与中断",
    stem: "为什么 forEach 不能 break？需要提前退出时怎么写？",
    answer: `- \`forEach\` 的语义是「对每一项执行」，没有返回值也不支持中断；\`map\` 返回等长新数组；\`reduce\` 归约为单值，能力最强。
- 需要提前退出用 \`for...of\`（可 \`break\`）、\`some\`（任一命中即停）、\`every\`（任一不满足即停）、\`find\`（找到即停）。
- 稀疏数组：\`map\` 保留空洞、\`forEach\` 跳过空洞；\`Array.from\` 会填 undefined。
- 性能上链式调用会产生中间数组，大数据量用一次 \`reduce\` 或 \`for\` 循环替代。
- 易错点：\`map\` 里 \`return\` 忘记写会得到 undefined 数组；\`reduce\` 不给初始值时，空数组会抛 TypeError。`,
    track: "foundation",
    categoryId: "foundation-js",
    difficulty: "basic",
    tags: ["基础", "JavaScript"],
    topic: "JavaScript 数组方法",
    reviewedAt: "2026-11",
    heat: 58,
    updatedAt: "2026-11-03",
  },
  {
    id: "js-weakmap-usage",
    title: "Map / Set 与 WeakMap / WeakSet 的差别与用途",
    stem: "WeakMap 为什么不能遍历？它在框架里通常用来做什么？",
    answer: `- \`Map\` 的键可以是任意类型且强引用，可遍历；\`WeakMap\` 的键只能是对象，**弱引用、不可遍历、没有 size**。
- 弱引用的意义：键对象被回收时条目自动消失，不会造成泄漏。
- 典型用途：给 DOM / 组件实例挂私有数据（不污染对象）、缓存（如 unserialize 的对象图缓存）、依赖收集表（Vue 3 的 \`targetMap\`）、私有字段的早期实现。
- \`Set\` 用于去重与集合运算（并/交/差，ES2025 已内置 \`union/intersection/difference\`）；\`WeakSet\` 常用来标记「已处理过」的对象而不阻止回收。
- 追问：\`Map\` 与普通对象的区别还包括键顺序稳定、可用对象作键、\`size\` 属性 O(1)。`,
    track: "foundation",
    categoryId: "foundation-js",
    difficulty: "medium",
    tags: ["JavaScript", "原理"],
    topic: "JavaScript 集合类型",
    reviewedAt: "2026-11",
    heat: 68,
    updatedAt: "2026-11-16",
  },
  {
    id: "js-immutable",
    title: "浅拷贝、深拷贝与不可变数据",
    stem: "Object.assign 与展开运算符有什么区别？React 里为什么强调不可变更新？",
    answer: `- \`Object.assign\` 与展开都是**浅拷贝**：只复制第一层引用，嵌套对象仍然共享。
- 二者差异：\`Object.assign\` 会触发 setter 并且可以接收多个源对象；展开只复制**自有可枚举**属性，对 Symbol 键行为一致但更简洁。
- 不可变更新的意义在于**用引用相等判断变化**：React 的 \`memo\` / \`PureComponent\` / \`useMemo\` 都靠 \`Object.is\` 比较，原地修改会让 diff 失效，出现「数据变了视图不动」。
- 深层更新用结构共享库（immer）或逐层展开；数组更新用 \`map/filter/concat\` 而不是 \`push/splice\`。
- 注意 \`structuredClone\` 不支持函数与原型链，序列化拷贝（JSON）会丢 Date 与 undefined。`,
    track: "foundation",
    categoryId: "foundation-js",
    difficulty: "basic",
    tags: ["基础", "JavaScript", "React"],
    topic: "JavaScript 拷贝与不可变",
    reviewedAt: "2026-11",
    heat: 70,
    updatedAt: "2026-11-10",
  },
  {
    id: "js-esm-cjs",
    title: "CommonJS 与 ESM 的差异",
    stem: "从加载时机、值绑定、循环依赖、Tree Shaking 四方面比较两种模块系统。",
    answer: `- **加载时机**：CJS 运行时同步加载（\`require\` 是函数）；ESM 是编译期静态解析、异步加载，必须先声明再使用。
- **值绑定**：CJS 导出的是**值的拷贝**（\`module.exports\` 对象引用），重新赋值不会同步；ESM 导出的是**活绑定（live binding）**，导入方能看到变化。
- **循环依赖**：CJS 拿到的是未执行完的部分导出（可能是 undefined）；ESM 因为有提升与活绑定，多数情况能工作但仍有 TDZ 风险。
- **Tree Shaking**：只有 ESM 的静态结构能被静态分析摇掉；CJS 的动态 \`require\` 无法安全消除。
- 互操作：ESM 可以 \`import\` CJS（默认导出即 \`module.exports\`），CJS 只能 \`require\` ESM 的异步包装（Node 22 起支持 \`require(esm)\`）。`,
    track: "foundation",
    categoryId: "foundation-js",
    difficulty: "medium",
    tags: ["工程化", "JavaScript", "高频"],
    topic: "JavaScript 模块系统",
    reviewedAt: "2026-11",
    heat: 72,
    updatedAt: "2026-11-06",
  },
  {
    id: "js-proxy-reflect",
    title: "Proxy 能拦截什么？Reflect 为什么总跟它一起出现",
    stem: "举两个 Proxy 的真实用途，并说明为什么 get 里要用 Reflect.get。",
    answer: `- 可拦截的操作有 13 种，常用的是 \`get\` / \`set\` / \`has\` / \`deleteProperty\` / \`ownKeys\` / \`apply\` / \`construct\`。
- 真实用途：**响应式系统**（Vue 3 的依赖收集）、**不可变数据**（immer 的草稿）、**接口 Mock / 埋点代理**、**属性访问日志**、**默认值填充**。
- 必须配 \`Reflect\` 的原因：\`Reflect.get(target, key, receiver)\` 会把 \`receiver\` 透传下去，保证访问器属性（getter）内部 \`this\` 指向代理而不是原对象；直接 \`target[key]\` 会绕过 receiver，继承链上的 getter 行为就会错。
- Proxy 的局限：无法拦截 \`=== \` 与 \`Object.keys\` 之外的内部操作、对性能敏感的热点路径有额外开销、Proxy 不可被 \`structuredClone\`。`,
    track: "foundation",
    categoryId: "foundation-js",
    difficulty: "hard",
    tags: ["原理", "JavaScript", "Vue 3.5"],
    topic: "JavaScript 元编程",
    reviewedAt: "2026-11",
    heat: 74,
    updatedAt: "2026-11-14",
  },
  {
    id: "js-memory-leak",
    title: "前端内存泄漏的常见成因与排查",
    stem: "列出四种典型泄漏场景，并说明如何用工具定位。",
    answer: `- **未解绑的监听/定时器**：\`addEventListener\`、\`setInterval\`、WebSocket 未在卸载时清理。
- **游离 DOM 引用**：JS 变量缓存了已移除的节点，整个子树无法回收。
- **闭包持有大对象**：长生命周期回调捕获了大数组或组件实例。
- **全局缓存无上限**：以 id 为键的 Map 只增不减，需要 LRU 或定期清理。
- 排查：Chrome DevTools 的 **Memory → Heap snapshot** 做两次快照对比（Comparison 视图看 Detached nodes 与增长对象），Performance 面板看内存曲线是否阶梯上升；\`PerformanceObserver\` 可监控 long task。
- 框架层用 \`useEffect\` 的清理函数、\`AbortController\` 取消请求、\`WeakMap\` 挂私有数据，能从源头减少泄漏。`,
    track: "foundation",
    categoryId: "foundation-js",
    difficulty: "hard",
    tags: ["性能", "原理", "大厂"],
    topic: "JavaScript 内存管理",
    reviewedAt: "2026-11",
    heat: 78,
    updatedAt: "2026-11-13",
  },
  {
    id: "js-iterator-generator",
    title: "迭代器协议、生成器与异步迭代",
    stem: "手写一个可被 for...of 遍历的对象，并说明生成器在异步流程中的作用。",
    answer: `- 迭代器协议：对象实现 \`next()\` 返回 \`{ value, done }\`；可迭代协议：对象有 \`[Symbol.iterator]\` 方法返回迭代器。
- 生成器函数 \`function*\` 执行后不立即运行，调 \`next()\` 才推进到下一个 \`yield\`，天然适合**惰性序列**（无限数列、大文件分块读取）。
- \`yield*\` 可以委托另一个可迭代对象；生成器还支持 \`return()\` / \`throw()\` 双向通信。
- 异步迭代用 \`for await...of\` + \`Symbol.asyncIterator\`，适合流式响应、分页拉取。
\`\`\`ts
function* range(start: number, end: number): Generator<number> {
  for (let value = start; value < end; value += 1) yield value;
}
const iterable = { [Symbol.iterator]: () => range(0, 3) };
console.log([...iterable]); // [0, 1, 2]
\`\`\`
- 历史意义：\`async/await\` 之前，co 库就是用生成器 + 自动执行器模拟同步写法。`,
    track: "foundation",
    categoryId: "foundation-js",
    difficulty: "hard",
    tags: ["原理", "JavaScript"],
    topic: "JavaScript 迭代协议",
    reviewedAt: "2026-11",
    heat: 55,
    updatedAt: "2026-10-27",
  },

  // ── TypeScript ─────────────────────────────────────────────
  {
    id: "ts-any-unknown-never",
    title: "any、unknown、never 的区别与选择",
    stem: "三者各自的语义是什么？什么时候必须用 unknown 而不是 any？",
    answer: `- \`any\`：放弃类型检查，可读写任意属性，会**污染**下游类型；应尽量只在迁移期临时使用。
- \`unknown\`：安全版的任意值 —— 可以赋值进去，但用之前**必须收窄**（typeof / instanceof / 类型守卫），适合 \`catch\` 的 error、外部 JSON、第三方回调参数。
- \`never\`：不可能存在的值。用于**穷尽检查**（switch 的 default 里赋值给 never 会报错）、恒抛错的函数返回值、以及过滤联合类型。
- 实践：外部输入一律 \`unknown\` + 校验函数；\`noImplicitAny\` 与 lint 规则（no-explicit-any）应常开。
- 追问：\`any\` 会让条件类型失效（\`any\` 参与交叉得到 any），\`unknown\` 不会。`,
    track: "foundation",
    categoryId: "foundation-ts",
    difficulty: "basic",
    tags: ["TypeScript", "基础", "高频"],
    topic: "TypeScript 类型系统基础",
    reviewedAt: "2026-11",
    heat: 76,
    updatedAt: "2026-11-14",
  },
  {
    id: "ts-generics",
    title: "泛型约束、默认值与常见写法",
    stem: "实现一个 pick<T, K> 函数，要求 K 必须是 T 的键，并说明 extends 在这里的作用。",
    answer: `- \`K extends keyof T\` 把类型参数约束到「T 的键集合」，从而允许 \`T[K]\` 这类索引访问类型。
- 泛型默认值（\`<T = unknown>\`）用于让调用方可以省略参数，同时保持返回类型精确。
- 约束不是继承，只是**可赋值的上界**；用多个约束时写 \`T extends A & B\`。
\`\`\`ts
function pick<T extends object, K extends keyof T>(source: T, keys: K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const key of keys) out[key] = source[key];
  return out;
}
\`\`\`
- 常见坑：泛型推断失败时显式标注要比 \`as\` 断言好；\`keyof\` 只取公共属性；索引签名会让 \`keyof\` 变成 \`string | number\`。`,
    track: "foundation",
    categoryId: "foundation-ts",
    difficulty: "medium",
    tags: ["TypeScript", "泛型"],
    topic: "TypeScript 泛型",
    reviewedAt: "2026-11",
    heat: 72,
    updatedAt: "2026-10-25",
  },
  {
    id: "ts-conditional-infer",
    title: "条件类型与 infer 的用法",
    stem: "实现 ReturnType 与 Awaited 的类型版本，说明分发条件类型的行为。",
    answer: `- 语法：\`T extends U ? X : Y\`。当 \`T\` 是**裸类型参数**且传入联合类型时，会**分发**成每个成员分别判断再合并。
- 禁止分发用 \`[T] extends [U]\` 包一层元组。
- \`infer\` 在条件类型里声明待推断的类型变量，可以出现在参数位置、返回值位置、甚至数组元素位置。
\`\`\`ts
type MyReturn<T> = T extends (...args: never[]) => infer R ? R : never;
type MyAwaited<T> = T extends Promise<infer U> ? MyAwaited<U> : T;
type ElementOf<T> = T extends readonly (infer E)[] ? E : never;
\`\`\`
- 组合用途：从函数签名里抠参数（\`Parameters\`）、从联合里过滤（\`Exclude\`）、把对象的值类型提出来（\`T[keyof T]\`）。
- 注意递归深度限制（默认约 50 层），深层嵌套类型会报 "excessively deep"。`,
    track: "foundation",
    categoryId: "foundation-ts",
    difficulty: "hard",
    tags: ["TypeScript", "类型体操", "大厂"],
    topic: "TypeScript 条件类型",
    reviewedAt: "2026-11",
    heat: 70,
    updatedAt: "2026-11-07",
  },
  {
    id: "ts-mapped-utility",
    title: "映射类型与内置工具类型的实现",
    stem: "手写 Partial、Required、Readonly 与 Record，并说明修饰符的作用。",
    answer: `- 映射类型遍历键：\`{ [K in keyof T]: ... }\`；修饰符 \`-?\` 去掉可选、\`+?\` 加可选、\`-readonly\` 去只读。
- 键重映射用 \`as\` + 模板字面量类型，可以生成 \`onClick\` 这类事件名。
\`\`\`ts
type MyPartial<T> = { [K in keyof T]?: T[K] };
type MyRequired<T> = { [K in keyof T]-?: T[K] };
type MyReadonly<T> = { readonly [K in keyof T]: T[K] };
type MyRecord<K extends keyof never, V> = { [P in K]: V };
\`\`\`
- \`Partial\` 是浅层的，深层可选需要自定义递归版本（注意数组与函数要特判，否则会被拆成奇怪结构）。
- 内置常用组合：\`Pick\` + \`Omit\` 做 DTO 裁剪，\`ReturnType\` + \`Parameters\` 复用第三方函数签名，\`NonNullable\` 去空。`,
    track: "foundation",
    categoryId: "foundation-ts",
    difficulty: "medium",
    tags: ["TypeScript", "类型体操"],
    topic: "TypeScript 映射类型",
    reviewedAt: "2026-11",
    heat: 66,
    updatedAt: "2026-10-27",
  },
  {
    id: "ts-narrowing",
    title: "类型收窄与自定义类型守卫",
    stem: "有哪些收窄手段？如何写一个能把 unknown 收窄成具体结构的守卫函数？",
    answer: `- 内置收窄：\`typeof\`、\`instanceof\`、\`in\`、真值判断、相等比较、判别联合（discriminated union）的 \`switch\`、以及 \`Array.isArray\` 等类型谓词。
- 自定义守卫返回类型谓词 \`value is T\`；断言函数用 \`asserts value is T\`，失败即抛错。
\`\`\`ts
function isQuestion(value: unknown): value is { id: string; title: string } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.title === "string";
}
\`\`\`
- 判别联合比多字段可选更好维护：给每个成员加 \`kind\` 字面量字段，switch 后 TS 会自动收窄，并可用 \`never\` 做穷尽检查。
- 注意：守卫只影响**静态类型**，不会做运行时校验；来自接口的数据要配 zod 之类的运行时 schema。`,
    track: "foundation",
    categoryId: "foundation-ts",
    difficulty: "medium",
    tags: ["TypeScript", "高频"],
    topic: "TypeScript 类型收窄",
    reviewedAt: "2026-11",
    heat: 74,
    updatedAt: "2026-11-15",
  },
  {
    id: "ts-structural-typing",
    title: "结构化类型与函数参数的逆变问题",
    stem: "为什么把 (a: string) => void 赋给 (a: string | number) => void 会报错，反过来却可以？",
    answer: `- TypeScript 是**结构化类型**：只看形状，不看名义。多出的属性在变量赋值时会触发**多余属性检查**（对象字面量才有）。
- 函数参数默认按**双变（bivariant）**检查方法声明，箭头函数类型则按**逆变**的严格规则（\`strictFunctionTypes\`）。
- 报错的原因是安全性：若允许「只接受 string 的函数」冒充「能接受 string | number 的函数」，调用方传 number 时实现就会崩。
- 反过来赋值是安全的（参数更宽），所以 \`(a: string | number) => void\` 可以赋给 \`(a: string) => void\`。
- 常见绕法：用 \`as\` 或把回调声明成方法签名会失去严格检查 —— 一般是代码设计有问题，优先改签名而不是断言。`,
    track: "foundation",
    categoryId: "foundation-ts",
    difficulty: "hard",
    tags: ["TypeScript", "原理", "大厂"],
    topic: "TypeScript 类型兼容性",
    reviewedAt: "2026-11",
    heat: 62,
    updatedAt: "2026-10-26",
  },
  {
    id: "ts-declaration",
    title: "声明文件与模块扩充",
    stem: "如何给没有类型的第三方库补类型？如何给 window 增加自定义属性？",
    answer: `- 首选官方 \`@types/xxx\`；没有就自己写 \`.d.ts\`，用 \`declare module "xxx"\` 描述导出形状。
- 全局扩充：在 \`.d.ts\` 里 \`declare global { interface Window { myApi: MyApi } }\`，且文件必须**有 import 或 export**（否则会被当成全局脚本，写法不同）。
- 模块扩充：\`declare module "antd" { export interface ThemeConfig { ... } }\`，注意同名接口会合并。
- 更推荐的做法是把扩展集中在 \`src/shared/types/*.d.ts\` 并在 tsconfig 的 \`include\` 里覆盖到，避免散落。
- 注意 \`skipLibCheck\` 只跳过 \`.d.ts\` 内部检查，不会让你写错类型；\`declare\` 只声明不产出代码，别在里面写运行逻辑。`,
    track: "foundation",
    categoryId: "foundation-ts",
    difficulty: "basic",
    tags: ["TypeScript", "工程化"],
    topic: "TypeScript 声明与扩充",
    reviewedAt: "2026-11",
    heat: 54,
    updatedAt: "2026-11-08",
  },
];
