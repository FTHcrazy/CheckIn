/**
 * 题库 · 手写代码题（第二轮扩充）。
 *
 * 这一批挑的是「面试官真的会让人白板写」的题：Promise 核心、call/apply/bind、
 * instanceof、compose、记忆化、数组扁平化、发布订阅、JSON.stringify。
 * 每题都给出可运行的最小实现 + 边界与陷阱，而不是伪代码。
 */
import type { InterviewQuestion } from "./interview-types";

export const SEED_WRITTEN_PLUS: readonly InterviewQuestion[] = [
  {
    id: "written-promise-core",
    title: "手写 Promise：状态机、then 链与微任务",
    stem: "实现一个符合 Promises/A+ 核心语义的 MyPromise（支持 then 链、值穿透、异常捕获），并说明三个必须遵守的约束。",
    diagramId: "dg-promise-state",
    answer: `- 三个约束：**状态只能落定一次**、**then 回调必须异步（微任务）执行**、**then 必须返回新 Promise**。少任何一条，链式顺序就会错。
- 注册时若还没落定，先把回调存进队列；落定后用 \`queueMicrotask\` 逐个派发 —— 这就是「回调注册晚于落定」的补发逻辑。
- then 里返回普通值让新 Promise fulfilled；返回 Promise（thenable）要等它落定；抛错则 rejected。
\`\`\`ts
type Resolver<T> = (value: T | PromiseLike<T>) => void;
class MyPromise<T> {
  private state: "pending" | "fulfilled" | "rejected" = "pending";
  private value: unknown;
  private queue: Array<() => void> = [];
  constructor(executor: (resolve: Resolver<T>, reject: (reason?: unknown) => void) => void) {
    const settle = (state: "fulfilled" | "rejected", value: unknown): void => {
      if (this.state !== "pending") return; // 只认第一次
      this.state = state;
      this.value = value;
      this.queue.splice(0).forEach((job) => queueMicrotask(job));
    };
    const resolve = (value: T | PromiseLike<T>): void => {
      if (value instanceof MyPromise) {
        value.then(resolve, (reason) => settle("rejected", reason));
        return;
      }
      settle("fulfilled", value);
    };
    try {
      executor(resolve, (reason) => settle("rejected", reason));
    } catch (error) {
      settle("rejected", error);
    }
  }
  then<A = T, B = never>(
    onFulfilled?: ((value: T) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): MyPromise<A | B> {
    return new MyPromise<A | B>((resolve, reject) => {
      const run = (): void => {
        const handler = this.state === "fulfilled" ? onFulfilled : onRejected;
        if (!handler) {
          // 值穿透：没给回调就把状态原样传下去
          this.state === "fulfilled" ? resolve(this.value as A) : reject(this.value);
          return;
        }
        try {
          resolve(handler(this.value as T));
        } catch (error) {
          reject(error);
        }
      };
      if (this.state === "pending") this.queue.push(run);
      else queueMicrotask(run);
    });
  }
  catch<B = never>(onRejected: (reason: unknown) => B | PromiseLike<B>): MyPromise<T | B> {
    return this.then(null, onRejected);
  }
}
\`\`\`
- 三个高频追问：\`Promise.resolve\` 一个 pending promise 为什么不会立刻 fulfilled（要等它落定）；\`then\` 返回自身为什么必须抛 TypeError（循环引用）；静态方法 \`all/allSettled/race\` 各自失败与顺序语义。`,
    track: "written",
    categoryId: "written-coding",
    difficulty: "hard",
    tags: ["手写", "异步", "高频"],
    topic: "异步编程 · Promise 手写",
    reviewedAt: "2026-11",
    heat: 97,
    updatedAt: "2026-11-16",
  },
  {
    id: "written-call-apply-bind",
    title: "手写 call / apply / bind，讲清 this 绑定的优先级",
    stem: "不用内置方法实现 call、apply、bind（bind 要支持分步传参），并说明 this 的绑定优先级。",
    answer: `- 原理是「把函数临时挂到目标对象上调用一次」：\`ctx.fn = this; ctx.fn(...args)\`，用完删掉，避免污染对象。
- 边界有三处：\`ctx\` 为 null/undefined 时回落到全局对象（严格模式下是 undefined）；原始值要装箱；**new 调用时 this 必须指向新对象**而不是绑定的 ctx。
- bind 的产物要能 \`new\`：判断 \`this instanceof Bound\` 就忽略绑定的 ctx，并把原型链接上。
\`\`\`ts
function myCall(fn: (...args: any[]) => unknown, ctx: unknown, ...args: unknown[]): unknown {
  const context = (ctx ?? globalThis) as Record<string, unknown>;
  const key = Symbol("fn");
  context[key] = fn;
  const result = (context[key] as (...items: unknown[]) => unknown)(...args);
  delete context[key];
  return result;
}
function myApply(fn: (...args: any[]) => unknown, ctx: unknown, args: unknown[] = []): unknown {
  return myCall(fn, ctx, ...args);
}
function myBind<T extends (...args: any[]) => unknown>(fn: T, ctx: unknown, ...preset: unknown[]): T {
  const bound = function (this: unknown, ...rest: unknown[]) {
    // 被 new 调用时，this 是新建的对象，忽略 ctx
    return fn.apply(this instanceof bound ? this : ctx, [...preset, ...rest]);
  } as unknown as T;
  bound.prototype = Object.create(fn.prototype ?? Object.prototype);
  return bound;
}
\`\`\`
- this 优先级：\`new\` > \`bind\` > 显式 call/apply > 隐式（obj.fn()）> 默认。箭头函数没有自己的 this，且不能被 bind 改变。`,
    track: "written",
    categoryId: "written-coding",
    difficulty: "medium",
    tags: ["手写", "this", "高频"],
    topic: "手写函数 · this 与原型",
    reviewedAt: "2026-11",
    heat: 89,
    updatedAt: "2026-11-13",
  },
  {
    id: "written-instanceof",
    title: "手写 instanceof，并解释它与 typeof 的分工",
    stem: "实现 myInstanceof(obj, Ctor)，说明为什么不能只比较一次原型。",
    answer: `- 语义是「沿 obj 的原型链向上找，看能否命中 \`Ctor.prototype\`」，所以要循环而不是比一次。
- 终止条件是原型链走到 \`null\`（\`Object.create(null)\` 的裸对象连一次都不会匹配）。
- 边界：右操作数必须是有 \`prototype\` 的函数，否则按规范抛 TypeError；原始值直接 false。
\`\`\`ts
function myInstanceof(value: unknown, ctor: { prototype?: object }): boolean {
  if (typeof ctor !== "function" || ctor.prototype === undefined) {
    throw new TypeError("Right-hand side of instanceof is not callable");
  }
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return false;
  }
  let proto = Object.getPrototypeOf(value);
  while (proto) {
    if (proto === ctor.prototype) return true;
    proto = Object.getPrototypeOf(proto);
  }
  return false;
}
\`\`\`
- 分工：\`typeof\` 判原始类型（注意 \`typeof null === "object"\`、函数返回 "function"）；instanceof 判「属于哪个构造器」，跨 iframe 会失效（两边的内建原型不是同一个对象）。
- 更稳的类型判断是 \`Object.prototype.toString.call(x)\`，返回 \`[object Map]\` 这类标签。`,
    track: "written",
    categoryId: "written-coding",
    difficulty: "basic",
    tags: ["手写", "基础", "原型"],
    topic: "手写函数 · 原型链",
    reviewedAt: "2026-11",
    heat: 74,
    updatedAt: "2026-11-10",
  },
  {
    id: "written-compose-pipe",
    title: "手写 compose / pipe：函数组合与执行顺序",
    stem: "实现 compose（右到左）与 pipe（左到右），支持任意个函数与初始多参数。",
    answer: `- \`compose(f, g, h)(x)\` 等于 \`f(g(h(x)))\`，即**从右往左**；pipe 只是把顺序反过来，实现可以复用同一个 reduce。
- 第一个执行的函数可以接多个参数，后续函数只接上一个的返回值 —— 这一点靠 \`reduce\` 的初始值区分。
- 空组合要返回恒等函数，而不是抛错，否则调用方每次都得判空。
\`\`\`ts
type Fn = (input: any) => any;
function pipe(...fns: Fn[]): (...args: unknown[]) => unknown {
  if (fns.length === 0) return (input) => input;
  return (...args: unknown[]) => fns.reduce((acc, fn, index) => (index === 0 ? fn(...args) : fn(acc)), undefined as unknown);
}
function compose(...fns: Fn[]): (...args: unknown[]) => unknown {
  return pipe(...fns.reverse());
}
\`\`\`
- 追问：compose 与柯里化的关系（都是把多元问题降成一元）；Redux 的 \`applyMiddleware\` 就是 compose 的典型应用 —— 中间件从右到左包裹 dispatch。`,
    track: "written",
    categoryId: "written-coding",
    difficulty: "basic",
    tags: ["手写", "基础", "函数式"],
    topic: "手写函数 · 组合",
    reviewedAt: "2026-11",
    heat: 68,
    updatedAt: "2026-11-09",
  },
  {
    id: "written-memoize",
    title: "手写记忆化：缓存键、失效与 LRU 淘汰",
    stem: "实现 memoize(fn, resolver)，说明缓存键怎么定、什么情况会失效、如何避免内存无限增长。",
    answer: `- 缓存键默认取第一个参数，但多参数函数必须用 resolver 显式拼 key，否则 \`f(1,2)\` 与 \`f(1,3)\` 会撞缓存。
- 用 \`Map\` 而不是普通对象：对象键会被转成字符串（\`[object Object]\` 全部撞在一起），Map 支持任意类型键且保留插入顺序。
- 缓存无上限就是内存泄漏；工程上要么加容量 + LRU 淘汰，要么给个 TTL。
- 异步函数要缓存 **Promise 本身**，否则并发调用会各自发起一次请求（缓存击穿）。
\`\`\`ts
function memoize<A extends unknown[], R>(
  fn: (...args: A) => R,
  resolver: (...args: A) => string = (...args) => JSON.stringify(args),
  capacity = 100,
): ((...args: A) => R) & { clear: () => void } {
  const cache = new Map<string, R>();
  const wrapped = (...args: A): R => {
    const key = resolver(...args);
    if (cache.has(key)) {
      const hit = cache.get(key) as R;
      cache.delete(key); // 命中后挪到末尾，维护 LRU 顺序
      cache.set(key, hit);
      return hit;
    }
    const value = fn(...args);
    if (cache.size >= capacity) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, value);
    return value;
  };
  wrapped.clear = () => cache.clear();
  return wrapped;
}
\`\`\`
- 追问：为什么不能用 WeakMap 做这个缓存（键是字符串时不能弱引用，且拿不到 size / 遍历）。`,
    track: "written",
    categoryId: "written-coding",
    difficulty: "medium",
    tags: ["手写", "性能", "缓存"],
    topic: "手写函数 · 记忆化",
    reviewedAt: "2026-11",
    heat: 71,
    updatedAt: "2026-11-12",
  },
  {
    id: "written-array-flatten",
    title: "手写数组扁平化：递归、迭代与栈",
    stem: "实现 flatten(arr, depth)，支持指定深度，并说明递归版在大数组上的问题。",
    answer: `- 递归版最直观，但深度大时会有调用栈风险；\`depth\` 用「剩余层数」递减，不要用全局计数。
- 迭代版用显式栈/队列：**栈是深度优先、队列是广度优先**，两者结果顺序不同，面试要说清用哪个。
- 不能用 \`JSON.stringify\` 拍平（会把 undefined/函数丢掉、把 Date 变字符串）。
\`\`\`ts
function flatten(input: unknown[], depth = Infinity): unknown[] {
  const out: unknown[] = [];
  for (const item of input) {
    if (Array.isArray(item) && depth > 0) {
      out.push(...flatten(item, depth - 1));
    } else {
      out.push(item);
    }
  }
  return out;
}
function flattenByStack(input: unknown[], depth = Infinity): unknown[] {
  const stack: Array<{ value: unknown; level: number }> = input
    .slice()
    .reverse()
    .map((value) => ({ value, level: 0 }));
  const out: unknown[] = [];
  while (stack.length > 0) {
    const { value, level } = stack.pop() as { value: unknown; level: number };
    if (Array.isArray(value) && level < depth) {
      for (let i = value.length - 1; i >= 0; i -= 1) {
        stack.push({ value: value[i], level: level + 1 });
      }
    } else {
      out.push(value);
    }
  }
  return out;
}
\`\`\`
- 原生 \`flat(Infinity)\` 已经够用；手写题真正的考点是「深度参数怎么传」「稀疏数组与类数组怎么办」。`,
    track: "written",
    categoryId: "written-coding",
    difficulty: "basic",
    tags: ["手写", "基础", "数组"],
    topic: "手写函数 · 数组处理",
    reviewedAt: "2026-11",
    heat: 66,
    updatedAt: "2026-11-08",
  },
  {
    id: "written-pubsub-observer",
    title: "手写发布订阅（on / once / off / emit），说明它与观察者的区别",
    stem: "实现事件总线：支持 on、once、off、emit，emit 过程中增删监听不能影响本次派发。",
    answer: `- 结构是 \`Map<event, Set<handler>>\`：Set 天然去重，且删除是 O(1)。
- **emit 前必须拷贝快照**：否则回调里 off 自己会改变遍历中的集合，导致漏派发或死循环。
- \`once\` 用包装函数实现，内部先解绑再执行（反过来会让回调里的重复 emit 触发两次）。
- off 要支持两种粒度：只传事件名清空全部，传事件名 + 回调只删一个。
\`\`\`ts
class EventBus {
  private map = new Map<string, Set<(...args: unknown[]) => void>>();
  on(event: string, handler: (...args: unknown[]) => void): () => void {
    const set = this.map.get(event) ?? new Set();
    set.add(handler);
    this.map.set(event, set);
    return () => this.off(event, handler);
  }
  once(event: string, handler: (...args: unknown[]) => void): () => void {
    const wrap = (...args: unknown[]): void => {
      this.off(event, wrap); // 先解绑，再执行
      handler(...args);
    };
    return this.on(event, wrap);
  }
  off(event: string, handler?: (...args: unknown[]) => void): void {
    if (!handler) {
      this.map.delete(event);
      return;
    }
    const set = this.map.get(event);
    set?.delete(handler);
    if (set && set.size === 0) this.map.delete(event);
  }
  emit(event: string, ...args: unknown[]): void {
    const set = this.map.get(event);
    if (!set) return;
    [...set].forEach((handler) => handler(...args)); // 快照，防遍历中被改
  }
}
\`\`\`
- 与观察者的区别：观察者模式里被观察者**直接持有**订阅者列表（耦合）；发布订阅中间隔了一个事件中心，发布者不知道谁在听。`,
    track: "written",
    categoryId: "written-coding",
    difficulty: "medium",
    tags: ["手写", "设计模式", "高频"],
    topic: "结构手写 · 事件与观察者",
    reviewedAt: "2026-11",
    heat: 80,
    updatedAt: "2026-11-14",
  },
  {
    id: "written-json-stringify",
    title: "手写 JSON.stringify：处理循环引用与特殊值",
    stem: "实现简化版 stringify，说明它和内置实现在 undefined、函数、循环引用、toJSON 上的差异。",
    answer: `- 规则比想象中细：对象里的 \`undefined\` / 函数 / Symbol 会被**整体丢弃**；数组里则变成 \`null\`。
- 循环引用必须用 \`WeakSet\` 记录「当前递归路径上的对象」，退出时删除 —— 记录全局会误判重复出现的合法共享对象。
- \`toJSON\` 优先（Date 就是靠它输出 ISO 字符串）；\`NaN\` / \`Infinity\` 统一变 \`null\`；字符串要转义引号与换行。
\`\`\`ts
function stringify(value: unknown, seen = new WeakSet<object>()): string | undefined {
  if (value === null) return "null";
  const type = typeof value;
  if (type === "number") return Number.isFinite(value as number) ? String(value) : "null";
  if (type === "boolean") return String(value);
  if (type === "string") return JSON.stringify(value as string);
  if (type === "bigint") throw new TypeError("Do not know how to serialize a BigInt");
  if (type === "undefined" || type === "function" || type === "symbol") return undefined;
  const object = value as Record<string, unknown> & { toJSON?: () => unknown };
  if (typeof object.toJSON === "function") return stringify(object.toJSON(), seen);
  if (seen.has(object)) throw new TypeError("Converting circular structure to JSON");
  seen.add(object);
  let result: string;
  if (Array.isArray(object)) {
    const items = object.map((item) => stringify(item, seen) ?? "null");
    result = \`[\${items.join(",")}]\`;
  } else {
    const entries: string[] = [];
    for (const [key, item] of Object.entries(object)) {
      const text = stringify(item, seen);
      if (text !== undefined) entries.push(\`\${JSON.stringify(key)}:\${text}\`);
    }
    result = \`{\${entries.join(",")}}\`;
  }
  seen.delete(object); // 只拦当前路径，兄弟节点可以引用同一对象
  return result;
}
\`\`\`
- 追问：\`JSON.parse(JSON.stringify(x))\` 做深拷贝会丢什么（undefined、函数、RegExp、Date 类型、原型链）。`,
    track: "written",
    categoryId: "written-coding",
    difficulty: "hard",
    tags: ["手写", "进阶", "序列化"],
    topic: "手写函数 · 序列化",
    reviewedAt: "2026-11",
    heat: 64,
    updatedAt: "2026-11-07",
  },
];
