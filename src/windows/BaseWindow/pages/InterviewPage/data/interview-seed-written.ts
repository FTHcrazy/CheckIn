/**
 * 题库 · 笔试题（按题型分四类）。
 *
 * 手写代码题 / 算法题 / 场景设计题 / 逻辑与开放题。
 * 答案一律「要点式 + 必要时代码块」，代码块控制在 15 行内，够说明思路即可。
 */
import type { InterviewQuestion } from "./interview-types";

export const SEED_WRITTEN: readonly InterviewQuestion[] = [
  // ── 手写代码题 ─────────────────────────────────────────────
  {
    id: "written-debounce-throttle",
    title: "手写防抖与节流，并说明各自的适用场景",
    diagramId: "dg-debounce-throttle",
    stem: "实现 debounce 与 throttle（都支持立即执行选项），并说明什么时候用哪个。",
    answer: `- **防抖**：每次触发都重置计时器，只有停止触发 wait 毫秒后才执行一次。适合搜索联想、窗口 resize 结束取值、表单校验。
- **节流**：固定时间窗口内最多执行一次，持续触发时按节奏匀速执行。适合滚动监听、拖拽、按钮防重复提交、埋点上报。
- 两者都要**保留最后一次调用的 this 与参数**，并返回可取消的句柄，否则组件卸载后仍可能触发一次。
\`\`\`ts
function debounce<A extends unknown[]>(fn: (...args: A) => void, wait: number) {
  let timer: number | undefined;
  return (...args: A) => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}
function throttle<A extends unknown[]>(fn: (...args: A) => void, wait: number) {
  let last = 0;
  return (...args: A) => {
    const now = Date.now();
    if (now - last >= wait) {
      last = now;
      fn(...args);
    }
  };
}
\`\`\`
- 追问通常落在**是否需要 trailing 调用**（最后一次必须执行）与 **组件卸载时 clearTimeout**。`,
    track: "written",
    categoryId: "written-coding",
    difficulty: "medium",
    tags: ["高频", "手写", "大厂"],
    topic: "手写函数 · 防抖节流",
    reviewedAt: "2026-11",
    heat: 96,
    updatedAt: "2026-11-04",
  },
  {
    id: "written-promise-all",
    title: "手写 Promise.all / allSettled / race",
    stem: "不使用内置方法，实现 Promise.all，并说明失败与顺序语义。",
    answer: `- **成功条件**：全部 resolve 才 resolve，结果**按入参顺序**而不是完成顺序排列。
- **失败条件**：任意一个 reject 立即 reject，但其余 promise 仍在跑（无法真正取消）。
- 必须用一个计数器判断「是否已全部完成」，不能靠 \`results.length\`，稀疏数组会误判。
\`\`\`ts
function all<T>(list: Array<T | Promise<T>>): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const out: T[] = new Array(list.length);
    let done = 0;
    if (list.length === 0) resolve(out);
    list.forEach((item, index) => {
      Promise.resolve(item).then((value) => {
        out[index] = value;
        done += 1;
        if (done === list.length) resolve(out);
      }, reject);
    });
  });
}
\`\`\`
- \`allSettled\` 把结果包成 \`{status, value|reason}\`，永不失败；\`race\` 取最先敲定的那个。`,
    track: "written",
    categoryId: "written-coding",
    difficulty: "medium",
    tags: ["高频", "手写", "异步"],
    topic: "异步编程 · Promise 手写",
    reviewedAt: "2026-11",
    heat: 93,
    updatedAt: "2026-11-15",
  },
  {
    id: "written-new-bind-call",
    title: "手写 new、call / apply 与 bind",
    stem: "手写 new 运算符与 Function.prototype.bind，说明原型链与构造函数的处理差异。",
    answer: `- **new 四步**：创建空对象 → 挂 \`__proto__\` 到构造函数的 prototype → 执行构造函数并把 this 指向新对象 → 返回值为对象**或函数**则用它，否则用新对象。
- **call**：把函数挂到目标对象上临时调用再删除，避免污染；现在更推荐用 \`Reflect.apply\` 或 \`fn.call\`。
- **bind** 返回的是**惰性调用**的新函数，要保留原函数的 prototype，且用 new 调用时绑定的 this 必须被忽略。
\`\`\`ts
function myNew<T extends object>(ctor: new (...args: never[]) => T, ...args: unknown[]): T {
  const obj = Object.create(ctor.prototype) as T;
  const result = (ctor as unknown as (...a: unknown[]) => unknown).apply(obj, args);
  // 规范里"对象"包含函数：构造函数返回函数时也要采用返回值
  const isObjectLike =
    (typeof result === "object" && result !== null) || typeof result === "function";
  return isObjectLike ? (result as T) : obj;
}
\`\`\`
- 追问点：bind 的 \`length\` / \`name\` 属性、箭头函数没有自己的 this 与 arguments。`,
    track: "written",
    categoryId: "written-coding",
    difficulty: "basic",
    tags: ["手写", "高频", "基础"],
    topic: "手写函数 · new 与 this 绑定",
    reviewedAt: "2026-11",
    heat: 85,
    updatedAt: "2026-11-09",
  },
  {
    id: "written-deep-clone",
    title: "手写深拷贝，要求支持循环引用与常见内置类型",
    stem: "实现 deepClone，处理循环引用、Date / RegExp / Map / Set 与 Symbol 键。",
    answer: `- 用 **WeakMap 记录已拷贝对象**，命中即返回，循环引用与共享引用都能正确处理（共享引用还能保持同一性）。
- 必须区分**不可拷贝类型**：函数直接返回原引用（或抛错）、DOM 节点、WeakMap / WeakSet 无法遍历。
- \`Map\` / \`Set\` 必须**先登记 \`seen\` 再递归键值**，否则自引用会无限递归；\`Date\` / \`RegExp\` 用构造器重建；数组走 \`[]\`、普通对象走 \`{}\`，按自有键逐个拷贝（稀疏数组的空洞因此保留）。
\`\`\`ts
function deepClone<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (typeof value !== "object" || value === null) return value;
  const cached = seen.get(value as object);
  if (cached) return cached as T;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (value instanceof RegExp) return new RegExp(value.source, value.flags) as T;
  if (value instanceof Map) {
    const out = new Map<unknown, unknown>();
    seen.set(value, out);
    value.forEach((item, key) => out.set(deepClone(key, seen), deepClone(item, seen)));
    return out as T;
  }
  if (value instanceof Set) {
    const out = new Set<unknown>();
    seen.set(value, out);
    value.forEach((item) => out.add(deepClone(item, seen)));
    return out as T;
  }
  const out: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
  seen.set(value as object, out);
  Reflect.ownKeys(value as object).forEach((key) => {
    (out as Record<string, unknown>)[key as string] = deepClone(
      (value as Record<string, unknown>)[key as string], seen);
  });
  return out as T;
}
\`\`\`
- 生产里更稳的是 \`structuredClone\`，但它不支持函数与原型，前端状态常见用 immer 的结构共享代替深拷贝。`,
    track: "written",
    categoryId: "written-coding",
    difficulty: "medium",
    tags: ["手写", "高频", "大厂"],
    topic: "手写函数 · 深拷贝",
    reviewedAt: "2026-11",
    heat: 90,
    updatedAt: "2026-11-14",
  },
  {
    id: "written-event-emitter",
    title: "手写事件总线（on / off / once / emit）",
    stem: "实现一个 EventEmitter，支持 once、重复监听与移除，说明内存泄漏风险。",
    answer: `- 内部用 \`Map<string, Set<handler>>\`：Set 天然去重，移除是 O(1)。
- **once** 照样用包装实现：触发时先 off 掉**包装函数**（不是原函数）再执行，避免重复触发的同时不让原函数残留在监听表里。
- \`emit\` 要**拷贝一份监听列表**再遍历，否则 handler 里调用 off 会改变迭代中的集合。
- 内存泄漏的主因是**订阅方忘了 off**：组件里必须在 \`useEffect\` 的清理函数或 \`beforeUnmount\` 里解绑。
\`\`\`ts
class Emitter {
  private map = new Map<string, Set<(...args: unknown[]) => void>>();
  on(event: string, fn: (...args: unknown[]) => void): void {
    const set = this.map.get(event) ?? new Set();
    set.add(fn);
    this.map.set(event, set);
  }
  once(event: string, fn: (...args: unknown[]) => void): void {
    const wrap = (...args: unknown[]): void => {
      this.off(event, wrap);
      fn(...args);
    };
    this.on(event, wrap);
  }
  off(event: string, fn: (...args: unknown[]) => void): void {
    this.map.get(event)?.delete(fn);
  }
  emit(event: string, ...args: unknown[]): void {
    [...(this.map.get(event) ?? [])].forEach((fn) => fn(...args));
  }
}
\`\`\``,
    track: "written",
    categoryId: "written-coding",
    difficulty: "basic",
    tags: ["手写", "基础", "架构"],
    topic: "手写函数 · 发布订阅",
    reviewedAt: "2026-11",
    heat: 78,
    updatedAt: "2026-11-11",
  },
  {
    id: "written-curry-compose",
    title: "手写柯里化与 compose 组合",
    stem: "实现 curry(fn) 与 compose(...fns)，并说明它们在函数式编程中的作用。",
    answer: `- **curry** 靠 \`fn.length\` 判断参数是否收齐；注意**默认参数与剩余参数会让 length 失真**，此时需要显式传入 arity。
- **compose** 是右到左，**pipe** 是左到右；执行顺序与书写顺序相反是最常见的笔误点。
- 组合的价值在于把「数据流」写成可读的管道，配合 \`tap\` / \`trace\` 可以在管道中插调试点。
\`\`\`ts
function curry<F extends (...args: never[]) => unknown>(fn: F, arity = fn.length) {
  return function curried(...args: unknown[]): unknown {
    if (args.length >= arity) return (fn as (...a: unknown[]) => unknown)(...args);
    return (...rest: unknown[]) => curried(...args, ...rest);
  };
}
const compose = <T>(...fns: Array<(input: T) => T>) => (input: T): T =>
  fns.reduceRight((acc, fn) => fn(acc), input);
\`\`\`
- 追问：curry 与 \`bind\` 的偏函数（partial）差别在于一次只收一个还是可以批量收。`,
    track: "written",
    categoryId: "written-coding",
    difficulty: "medium",
    tags: ["手写", "函数式"],
    topic: "手写函数 · 柯里化与组合",
    reviewedAt: "2026-11",
    heat: 72,
    updatedAt: "2026-10-29",
  },
  {
    id: "written-concurrency-pool",
    title: "手写并发请求池（限流 3 个，跑完 20 个任务）",
    stem: "实现 asyncPool(tasks, limit)，任意时刻最多 limit 个任务在执行，并按入参顺序返回结果。",
    answer: `- 核心是**维护 limit 个常驻 worker**，每个 worker 从共享游标取下一个任务，而不是分批 \`Promise.all\`（分批会让慢任务拖住整批）。
- 结果数组按 **下标** 写入，保证顺序与入参一致。
- 失败策略要明确：一失败即中断（保留已成功）还是**继续跑完**并把错误放进结果（\`allSettled\` 语义）——面试里必须问这一句。
\`\`\`ts
async function asyncPool<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, () => worker()),
  );
  return results;
}
\`\`\`
- 真实场景对应「上传队列」「图片批量处理」；若要支持取消，给每个任务传 \`AbortSignal\`。`,
    track: "written",
    categoryId: "written-coding",
    difficulty: "hard",
    tags: ["手写", "异步", "大厂"],
    topic: "异步编程 · 并发控制",
    reviewedAt: "2026-11",
    heat: 88,
    updatedAt: "2026-11-04",
  },
  {
    id: "written-reactive-proxy",
    title: "手写响应式：Proxy 依赖收集与派发更新",
    stem: "用 Proxy 实现 reactive 与 effect，说明依赖表结构与 Vue 3 的差异。",
    answer: `- 依赖表是 \`WeakMap<target, Map<key, Set<effect>>>\`：**target 用 WeakMap** 才能在对象被回收时一起释放。
- \`get\` 里 \`track(target, key)\` 收集当前正在执行的 effect；\`set\` 里 \`trigger\` 派发，值未变则直接返回。
- 要处理 **activeEffect 的保存与恢复**：effect 内部可以嵌套 effect（父子组件渲染），退出时不能把外层丢掉。
- 与 Vue 3 的差异：Vue 还做了 ref 的 \`value\` 包装、数组方法改写、\`effectScope\` 批量停止，以及调度器（scheduler）支持。
\`\`\`ts
const deps = new WeakMap<object, Map<string, Set<() => void>>>();
let active: (() => void) | null = null;
function reactive<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, key, receiver) {
      const map = deps.get(obj) ?? new Map();
      deps.set(obj, map);
      const set = map.get(key as string) ?? new Set();
      map.set(key as string, set);
      if (active) set.add(active);
      return Reflect.get(obj, key, receiver);
    },
    set(obj, key, value, receiver) {
      const ok = Reflect.set(obj, key, value, receiver);
      deps.get(obj)?.get(key as string)?.forEach((run) => run());
      return ok;
    },
  });
}
\`\`\``,
    track: "written",
    categoryId: "written-coding",
    difficulty: "hard",
    tags: ["手写", "原理", "Vue 3.5"],
    topic: "响应式原理 · Proxy 依赖收集",
    reviewedAt: "2026-11",
    heat: 82,
    updatedAt: "2026-11-08",
  },

  // ── 算法题 ─────────────────────────────────────────────────
  {
    id: "algo-two-sum",
    title: "两数之和与三数之和",
    stem: "给定数组与目标值，返回两数之和的下标；进阶：找出所有和为 0 的三元组。",
    answer: `- 两数之和用 **哈希表** 把查找降到 O(1)，一遍遍历即可，时间 O(n)、空间 O(n)。
- 三数之和要先**排序**再固定第一个数，剩下两个用双指针从两端收缩，整体 O(n²)。
- 三数之和的两个易错点：**跳过重复元素**（同一层循环里 \`nums[i] === nums[i-1]\` 就 continue）与**指针移动时机**（找到答案后左右都要跳过重复值，否则死循环）。
\`\`\`ts
function twoSum(nums: number[], target: number): number[] {
  const seen = new Map<number, number>();
  for (let i = 0; i < nums.length; i += 1) {
    const need = target - nums[i];
    if (seen.has(need)) return [seen.get(need) as number, i];
    seen.set(nums[i], i);
  }
  return [];
}
\`\`\`
- 追问：如果数组有序且要求 O(1) 空间，就退回双指针；如果要返回所有不重复组合，哈希法还需要额外排序去重。`,
    track: "written",
    categoryId: "written-algorithm",
    difficulty: "basic",
    tags: ["算法", "高频", "基础"],
    topic: "数组与哈希 · 双指针",
    reviewedAt: "2026-11",
    heat: 86,
    updatedAt: "2026-11-16",
  },
  {
    id: "algo-lru-cache",
    title: "实现 LRU 缓存（get / put 都是 O(1)）",
    diagramId: "dg-lru",
    stem: "设计一个容量为 capacity 的 LRU 缓存，get 与 put 都要 O(1)，写出核心结构。",
    answer: `- 结构是 **哈希表 + 双向链表**：哈希表定位节点，链表把「最近使用」排在头部、「最久未使用」排在尾部，淘汰就是删尾。
- 用**哨兵头尾节点**消除所有空指针判断，是这道题最省事的写法。
- 只用 JS \`Map\` 也能实现：\`Map\` 保持插入顺序，\`get\` 命中后先 \`delete\` 再 \`set\` 就把它挪到末尾，淘汰时删第一个键。
\`\`\`ts
class LRU<K, V> {
  private map = new Map<K, V>();
  constructor(private capacity: number) {}
  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key) as V;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }
  put(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
  }
}
\`\`\`
- 追问：LFU 怎么做（频次桶 + 双向链表）、如何加过期时间（惰性删除 + 定时清理）。`,
    track: "written",
    categoryId: "written-algorithm",
    difficulty: "hard",
    tags: ["算法", "大厂", "高频"],
    topic: "数据结构设计 · 哈希表与链表",
    reviewedAt: "2026-11",
    heat: 92,
    updatedAt: "2026-11-14",
  },
  {
    id: "algo-monotonic-stack",
    title: "用两个栈实现队列 + 单调栈求下一个更大元素",
    stem: "说明两个栈实现队列的均摊复杂度，并用单调栈求每个元素右侧第一个更大值。",
    answer: `- 两个栈 \`inStack\` / \`outStack\`：入队压 in，出队时若 out 为空就把 in 全部倒过去。**均摊 O(1)**，单个元素最多被搬两次。
- 单调栈的核心是**保持栈内单调递减**：遇到比栈顶大的元素，就不断弹出并给它们写入答案，再把当前元素入栈。
- 时间复杂度 O(n)，因为每个下标最多入栈出栈各一次；空间最坏 O(n)（数组本身降序）。
\`\`\`ts
function nextGreater(nums: number[]): number[] {
  const out: number[] = new Array(nums.length).fill(-1);
  const stack: number[] = [];
  nums.forEach((value, index) => {
    while (stack.length > 0 && nums[stack[stack.length - 1]] < value) {
      out[stack.pop() as number] = value;
    }
    stack.push(index);
  });
  return out;
}
\`\`\`
- 同模板还能解：接雨水、柱状图最大矩形、每日温度。`,
    track: "written",
    categoryId: "written-algorithm",
    difficulty: "medium",
    tags: ["算法", "高频"],
    topic: "栈与队列 · 单调栈",
    reviewedAt: "2026-11",
    heat: 74,
    updatedAt: "2026-10-20",
  },
  {
    id: "algo-tree-traverse",
    title: "二叉树的前中后序与层序遍历（递归 + 迭代）",
    stem: "写出三种遍历的迭代实现，并说明为什么后序迭代最难写。",
    answer: `- 前序迭代：栈弹出即访问，**先压右再压左**。
- 中序迭代：一路向左压栈，弹出访问后转向右子树，是实现「有序输出」的关键模板。
- 后序迭代：按「根右左」压栈得到逆序，再把结果反转；或记录 \`lastVisited\` 判断右子树是否已处理。
- 层序用队列（BFS），需要分层时在内层循环先记 \`size = queue.length\`。
\`\`\`ts
function levelOrder(root: { val: number; left: Node | null; right: Node | null } | null): number[][] {
  if (!root) return [];
  const out: number[][] = [];
  const queue = [root];
  while (queue.length > 0) {
    const size = queue.length;
    const level: number[] = [];
    for (let i = 0; i < size; i += 1) {
      const node = queue.shift() as NonNullable<typeof root>;
      level.push(node.val);
      if (node.left) queue.push(node.left);
      if (node.right) queue.push(node.right);
    }
    out.push(level);
  }
  return out;
}
\`\`\`
- 追问：Morris 遍历用线索指针把空间降到 O(1)，代价是临时改树结构。`,
    track: "written",
    categoryId: "written-algorithm",
    difficulty: "medium",
    tags: ["算法", "基础"],
    topic: "树与图 · 遍历模板",
    reviewedAt: "2026-11",
    heat: 70,
    updatedAt: "2026-11-09",
  },
  {
    id: "algo-dp-pattern",
    title: "动态规划：零钱兑换与最长递增子序列",
    stem: "写出零钱兑换的状态转移方程，并说明它与 LIS 的 O(n log n) 解法差别在哪。",
    answer: `- **零钱兑换**：\`dp[i] = min(dp[i - coin] + 1)\`，dp 长度是金额而不是硬币数；无解时保留 Infinity，最后判 \`dp[amount] === Infinity\`。
- 完全背包的内层循环**正序**（硬币可重复用），0-1 背包内层**倒序**（每件只能用一次）——这是最常被追问的一点。
- **LIS** 朴素解法是 O(n²) 的 \`dp[i] = max(dp[j]) + 1\`；优化解法维护一个**单调递增的 tails 数组**，用二分找插入位置，长度即答案。
\`\`\`ts
function coinChange(coins: number[], amount: number): number {
  const dp = new Array<number>(amount + 1).fill(Infinity);
  dp[0] = 0;
  for (let i = 1; i <= amount; i += 1) {
    for (const coin of coins) {
      if (coin <= i) dp[i] = Math.min(dp[i], dp[i - coin] + 1);
    }
  }
  return dp[amount] === Infinity ? -1 : dp[amount];
}
\`\`\`
- 面试里更该说清「状态定义 → 转移 → 边界 → 答案位置」四步，而不是背题。`,
    track: "written",
    categoryId: "written-algorithm",
    difficulty: "medium",
    tags: ["算法", "大厂", "2025"],
    topic: "动态规划 · 状态转移",
    reviewedAt: "2026-11",
    heat: 80,
    updatedAt: "2026-11-03",
  },
  {
    id: "algo-topk-heap",
    title: "TopK 问题：小顶堆与快速选择怎么选",
    stem: "从 n 个数里取最大的 k 个，比较小顶堆与快速选择两种方案。",
    answer: `- **小顶堆**：维护大小为 k 的堆，新元素比堆顶大就替换堆顶并下沉。时间 O(n log k)，空间 O(k)，**适合数据流**（边读边算）。
- **快速选择（quickselect）**：按基准分区后只递归包含第 k 个下标的那一侧，平均 O(n)、最坏 O(n²)（基准选得差）。
- 选择依据：数据在内存里且一次性给出 → 快速选择；数据持续到达或超大 → 小顶堆；k 接近 n 时直接排序反而最省事。
\`\`\`ts
function topK(nums: number[], k: number): number[] {
  const heap: number[] = [];
  const siftUp = (index: number): void => {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (heap[parent] <= heap[index]) break;
      [heap[parent], heap[index]] = [heap[index], heap[parent]];
      index = parent;
    }
  };
  for (const value of nums) {
    if (heap.length < k) {
      heap.push(value);
      siftUp(heap.length - 1);
    } else if (value > heap[0]) {
      heap[0] = value;
      // 省略下沉：把堆顶替换后向下调整到合法位置
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let min = index;
        if (left < k && heap[left] < heap[min]) min = left;
        if (right < k && heap[right] < heap[min]) min = right;
        if (min === index) break;
        [heap[min], heap[index]] = [heap[index], heap[min]];
        index = min;
      }
    }
  }
  return heap;
}
\`\`\`
- 追问：要求「TopK 且有序」时把最后的小顶堆做一次堆排序，O(k log k)。`,
    track: "written",
    categoryId: "written-algorithm",
    difficulty: "hard",
    tags: ["算法", "大厂"],
    topic: "堆与选择 · TopK",
    reviewedAt: "2026-11",
    heat: 76,
    updatedAt: "2026-11-15",
  },

  // ── 场景设计题 ─────────────────────────────────────────────
  {
    id: "design-infinite-feed",
    title: "设计信息流：无限滚动、列表复用与滚动位置恢复",
    stem: "一个 10 万条的信息流页面，要求滚动流畅、返回时恢复位置，说说你的方案。",
    answer: `- **虚拟列表**是底线：只渲染可视区 ± 缓冲区的行（\`react-virtuoso\` / 自研固定行高版本），DOM 数量与总量无关。
- 数据侧用**游标分页**而不是 offset：\`cursor + limit\`，避免新内容插入导致翻页重复/漏项；预取到可视区下方约 2 屏。
- 行组件要 \`React.memo\` + 稳定 key；图片走 \`loading="lazy"\` + 固定宽高比占位，防止滚动中重排。
- **位置恢复**：把滚动偏移与已加载游标写进路由状态或 \`sessionStorage\`，返回时先渲染骨架再 \`scrollTo\`，避免高度未定就滚动导致偏移。
- 变高列表用 \`ResizeObserver\` 测量并缓存行高，否则只能退化成估算 + 校正。`,
    track: "written",
    categoryId: "written-design",
    difficulty: "hard",
    tags: ["场景设计", "性能", "大厂"],
    topic: "场景设计 · 长列表与虚拟化",
    reviewedAt: "2026-11",
    heat: 84,
    updatedAt: "2026-11-08",
  },
  {
    id: "design-form-schema",
    title: "设计一个配置化表单引擎（JSON Schema → 表单）",
    stem: "后端下发 JSON 描述表单，前端动态渲染并支持联动、校验与自定义组件，怎么设计？",
    answer: `- 三层拆分：**Schema 层**（字段、类型、校验、默认值）、**渲染层**（字段组件注册表）、**状态层**（值、错误、联动规则）。
- 字段组件用**注册表 + 统一 props 契约**（\`value / onChange / disabled / error\`），自定义组件按类型注册，避免 \`switch\` 无限膨胀。
- 联动用**声明式依赖**（\`dependencies: ["type"]\` + \`when\` 条件）而不是在 onChange 里写命令式代码，否则规则会散落到各处。
- 校验复用同一份规则：前端即时校验 + 提交前整体校验，规则与后端共享同一份 JSON 定义最省维护成本。
- 状态管理优先用**非受控 + 订阅**（react-hook-form 思路），每次输入只重渲染对应字段，全量受控在大表单里会明显卡。`,
    track: "written",
    categoryId: "written-design",
    difficulty: "medium",
    tags: ["场景设计", "架构"],
    topic: "场景设计 · 配置化渲染",
    reviewedAt: "2026-11",
    heat: 71,
    updatedAt: "2026-11-13",
  },
  {
    id: "design-permission",
    title: "设计前端权限体系（路由、菜单、按钮、数据）",
    stem: "中后台系统要做权限控制，说说各层的落地方式与边界。",
    answer: `- **路由级**：登录后拉权限，动态生成路由表并用 \`<Route>\` 过滤；未授权路径落到 403 而不是空白页。
- **菜单级**：菜单由同一份权限数据派生，不要把菜单写死在组件里，否则与路由两处维护必然不一致。
- **按钮级**：封装 \`<Auth code="order:delete">\` 或 \`useAuth\`，无权限时不渲染（或 disabled + Tooltip 说明原因）。
- **数据级必须后端兜底**：前端隐藏按钮只是体验，接口必须校验；越权请求返回 403 并在拦截器里统一提示。
- 常见坑：刷新后权限丢失（要重新拉取并等待完成再渲染路由）、权限变更需要登出重进（可用版本号触发重新加载）。`,
    track: "written",
    categoryId: "written-design",
    difficulty: "medium",
    tags: ["场景设计", "中后台", "高频"],
    topic: "场景设计 · 权限体系",
    reviewedAt: "2026-11",
    heat: 79,
    updatedAt: "2026-10-29",
  },
  {
    id: "design-chunk-upload",
    title: "设计大文件分片上传与断点续传",
    stem: "上传 2GB 视频，要求断点续传、秒传与失败重试，说明关键步骤。",
    answer: `- **分片**：按固定大小切（如 5MB），先算文件哈希（大文件用「抽样哈希 + 大小」加速）向服务端查询已上传分片。
- **秒传**：服务端已有完整文件（哈希命中）直接返回，前端跳过上传。
- **断点续传**：只上传缺失分片，并发数限制在 3-5，配合失败重试与进度聚合。
- **合并**：所有分片完成后请求合并接口，服务端校验分片数与哈希再落库。
- 关键细节：并发控制、单片超时重试（指数退避）、页面关闭前用 \`beforeunload\` 提示、上传中取消要 \`AbortController\` 真正断开。`,
    track: "written",
    categoryId: "written-design",
    difficulty: "hard",
    tags: ["场景设计", "大厂", "网络"],
    topic: "场景设计 · 文件上传",
    reviewedAt: "2026-11",
    heat: 83,
    updatedAt: "2026-11-08",
  },
  {
    id: "design-realtime-message",
    title: "设计站内实时通知（十万在线）",
    stem: "要求秒级送达、支持多端同步与离线补偿，选长轮询、SSE 还是 WebSocket？",
    answer: `- **选型**：需要双向通信与低延迟选 WebSocket；只有服务端推送（通知、进度）选 SSE 更省事（自动重连、走 HTTP/2 多路复用）。
- **多端同步**：用一个用户维度的「消息序号」做游标，各端上报 lastSeq，重连后拉增量，天然支持离线补偿。
- **离线与可靠**：推送只是加速，**落库 + 拉取**才是兜底；未 ACK 的消息重连后重投，前端按 messageId 幂等去重。
- **扩容**：网关层无状态、按 userId 做粘性或广播（Redis Pub/Sub），连接数到单机瓶颈就加分片。
- 坑：移动端切后台会断连，需要 visibilitychange 时补拉；断线重连要指数退避避免雪崩。`,
    track: "written",
    categoryId: "written-design",
    difficulty: "hard",
    tags: ["场景设计", "架构", "2025"],
    topic: "场景设计 · 实时通信",
    reviewedAt: "2026-11",
    heat: 68,
    updatedAt: "2026-11-08",
  },

  // ── 逻辑与开放题 ───────────────────────────────────────────
  {
    id: "open-hundred-lamps",
    title: "100 盏灯，第 i 轮拨动 i 的倍数，最后几盏亮着？",
    stem: "编号 1-100 的灯初始全灭，第 i 轮拨动所有编号为 i 倍数的开关，100 轮后哪些灯亮？",
    answer: `- 每盏灯被拨动的次数等于它**约数的个数**：只有约数个数为奇数时，最终才是亮的。
- 约数成对出现（\`d\` 与 \`n/d\`），只有 \`n\` 是完全平方数时中间那一对重合，约数个数才是奇数。
- 所以亮着的是 1、4、9、16、25、36、49、64、81、100，共 10 盏。
- 这类题的解法套路是**把「操作次数」翻译成数论性质**，而不是逐轮模拟（模拟是 O(n log n)，虽然能出答案但说不清为什么）。`,
    track: "written",
    categoryId: "written-open",
    difficulty: "basic",
    tags: ["逻辑题", "数学"],
    topic: "逻辑题 · 数论性质",
    reviewedAt: "2026-11",
    heat: 55,
    updatedAt: "2026-10-26",
  },
  {
    id: "open-water-jug",
    title: "3L 与 5L 容器量出 4L 水",
    stem: "只有一个 3L 和一个 5L 的容器（无刻度），如何量出恰好 4L 水？写出步骤并说明可解性。",
    answer: `- 步骤：装满 5L → 倒入 3L（5L 里剩 2L）→ 倒空 3L → 把 2L 倒入 3L → 再装满 5L → 往 3L 里补满（只补 1L）→ 5L 里剩 4L。
- 也可反向：装满 3L 倒入 5L，重复两次，第二次 3L 里剩 1L，倒空 5L 后把 1L 倒入，再装满 3L 加入即 4L。
- 可解性：能倒出的水量一定是 \`gcd(3,5)=1\` 的倍数，4 是 1 的倍数故可解；若两容器为 4L 与 6L（gcd=2），就只能量出偶数升。
- 面试考的是**用不变量解释可行性**，而不是背步骤。`,
    track: "written",
    categoryId: "written-open",
    difficulty: "basic",
    tags: ["逻辑题", "数学"],
    topic: "逻辑题 · 最大公约数",
    reviewedAt: "2026-11",
    heat: 52,
    updatedAt: "2026-10-28",
  },
  {
    id: "open-tech-selection",
    title: "新项目选 React 还是 Vue？给出你的判断框架",
    stem: "一个 6 人团队要做中后台 + 移动端 H5，请给出技术选型结论与理由。",
    answer: `- 先看**约束**而不是偏好：团队现有技能（招聘与维护成本）、交付周期、是否需要 SSR、是否有跨端诉求。
- 中后台看**生态与组件库成熟度**：React 侧 antd / ProComponents，Vue 侧 Element Plus / Naive UI 都能覆盖；真正拉开差距的是团队熟悉度。
- H5 侧看**包体积与首屏**：Vue 3 运行时更小，React 19 + RSC 在内容型站点更有优势，但要评估构建与调试成本。
- 跨端诉求决定上层：需要一套代码跑小程序 + H5 就倾向 Taro / uni-app，此时框架选择要让位于跨端框架的支持度。
- 结论要给**可验证的落点**：先用一个真实业务切片做两周验证，比 PPT 上的对比矩阵可靠。`,
    track: "written",
    categoryId: "written-open",
    difficulty: "medium",
    tags: ["开放题", "架构", "大厂"],
    topic: "开放题 · 技术选型",
    reviewedAt: "2026-11",
    heat: 66,
    updatedAt: "2026-11-12",
  },
  {
    id: "open-ai-impact",
    title: "AI 编码助手会替代前端吗？说说你的判断",
    stem: "结合 2025-2026 的实际情况，谈谈 AI 辅助开发对前端岗位的影响与应对。",
    answer: `- 现状：AI 在**样板代码、样式还原、单测补全、报错定位**上已经是稳定生产力，在「跨模块架构决策、性能归因、需求取舍」上仍需人判断。
- 受影响最大的是**纯执行层**工作（切图、简单 CRUD、重复迁移），受影响最小的是**问题定义与验证**能力。
- 岗位不是消失而是**重心迁移**：Review 别人的（含 AI 的）代码、写清规格、设计可测结构，变得比手速更重要。
- 应对：把 AI 当结对者——让它先出草稿，自己负责边界、异常与验证；同时保留独立读源码与调试的能力，否则无法判断 AI 输出对不对。
- 面试里回答这题的关键是**给出具体场景与判断依据**，避免「取代 / 不取代」的二元表态。`,
    track: "written",
    categoryId: "written-open",
    difficulty: "medium",
    tags: ["开放题", "AI", "2026"],
    topic: "开放题 · AI 与职业发展",
    reviewedAt: "2026-11",
    heat: 74,
    updatedAt: "2026-11-08",
  },
];
