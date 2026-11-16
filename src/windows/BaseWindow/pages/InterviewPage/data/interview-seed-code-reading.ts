/**
 * 题库 · 读代码说结果。
 *
 * 这一组题的共同点：**代码是题目本身**。所以代码全部放在 `stemCode` 字段，
 * 卡片上常显在题干下方，答案区只放推导过程与结论 —— 避免「先看到答案里的代码，
 * 再回头读题」把思考过程跳过。
 */
import type { InterviewQuestion } from "./interview-types";

export const SEED_CODE_READING: readonly InterviewQuestion[] = [
  {
    id: "code-var-let-loop",
    title: "var 与 let 在循环里的闭包差异",
    stem: "写出两段循环打印的结果，并解释为什么 var 与 let 表现不同。",
    stemCodeLang: "js",
    stemCode: `for (var i = 0; i < 3; i++) {
  setTimeout(() => console.log('var', i));
}

for (let j = 0; j < 3; j++) {
  setTimeout(() => console.log('let', j));
}`,
    answer: `- 输出：\`var 3\` ×3，然后 \`let 0\`、\`let 1\`、\`let 2\`（定时器按注册顺序执行）。
- \`var\` 是**函数作用域**，三轮循环共用同一个 \`i\`；循环结束时 \`i\` 已自增到 3（不满足条件才退出），三个闭包读到的都是同一个变量 → 全是 3。
- \`let\` 在 \`for\` 里会为**每次迭代创建新的绑定**（规范里的 per-iteration environment），每个闭包捕获各自的 \`j\`。
- 想在 \`var\` 时代解决，要靠 IIFE 把当前值当参数传进去造新作用域；\`let\` 之后不需要这个技巧。
- 追问：\`for...of\` / \`for...in\` 的 \`let\` 同样是每次迭代新绑定；\`while\` 里用 \`let\` 声明在循环体外则没有这个效果。`,
    track: "foundation",
    categoryId: "foundation-js",
    difficulty: "basic",
    tags: ["JavaScript", "闭包", "高频", "基础"],
    topic: "JavaScript 作用域 · 闭包",
    reviewedAt: "2026-11",
    heat: 88,
    updatedAt: "2026-11-14",
  },
  {
    id: "code-this-binding",
    title: "this 在方法、箭头函数与回调里的表现",
    stem: "写出三次打印的结果，并说明每一处的 this 指向。",
    stemCodeLang: "js",
    stemCode: `'use strict';

function run() {
  const obj = {
    name: 'obj',
    regular() { return this?.name; },
    arrow: () => this?.name,
    nested() {
      return [1].map(function () { return this?.name; });
    },
  };
  console.log(obj.regular(), obj.arrow(), obj.nested());
}

run();`,
    answer: `- 输出：\`obj undefined [ undefined ]\`。
- \`obj.regular()\` 是**隐式绑定**：调用时点号左边是 \`obj\`，this 指向它 → \`'obj'\`。
- \`arrow\` 没有自己的 this，取定义处外层的 this。这里外层是 \`run\`，而 \`run()\` 是普通调用，严格模式下 this 为 \`undefined\` → \`undefined\`。
- \`nested\` 里把普通函数交给 \`map\`，调用时已不是 \`obj.method()\` 形式，this 丢失（严格模式 undefined）；非严格模式会退化成 \`window\`，于是可能读到 \`window.name\` —— 这就是「隐式绑定丢失」的经典形态。
- 三种修法：\`map(v => this.name)\`（箭头继承外层）、\`map(fn.bind(this))\`、或提前 \`const self = this\`。
- 一句话总结：this 只看**调用方式**，不看定义位置；箭头函数是唯一例外（看定义位置的外层）。`,
    track: "foundation",
    categoryId: "foundation-js",
    difficulty: "medium",
    tags: ["JavaScript", "this", "高频"],
    topic: "JavaScript this 绑定",
    reviewedAt: "2026-11",
    heat: 84,
    updatedAt: "2026-11-13",
  },
  {
    id: "code-react-batch-count",
    title: "连续 setState 之后按钮显示几",
    stem: "点击一次按钮，界面上的数字是多少？控制台打印什么？为什么？",
    stemCodeLang: "tsx",
    stemCode: `function Counter() {
  const [count, setCount] = useState(0);

  const onClick = () => {
    setCount(count + 1);
    setCount(count + 1);
    setCount((c) => c + 1);
    console.log(count);
  };

  return <button onClick={onClick}>{count}</button>;
}`,
    answer: `- 按钮显示 **2**，控制台打印 **0**。
- React 把同一事件里的多次更新**批处理**成一次渲染，更新进入队列后依次计算：前两个 \`setCount(count + 1)\` 都用本次渲染的 \`count = 0\`，各自算出 1（后一个覆盖前一个，不累加）；第三个是函数式更新，基于队列中前一个结果 \`1\` 再加 1 → 2。
- \`console.log(count)\` 读到的是**本次渲染闭包里的旧值**（0）。state 是快照，不是可变变量；要打印新值只能在 \`useEffect\` 里监听或直接用计算结果。
- 想让三次都生效就全用函数式更新：\`setCount(c => c + 1)\` ×3 → 3。
- 补充：React 18 起 \`setTimeout\`、\`Promise\` 回调里的更新也会自动批处理（旧版本只批处理事件回调）；需要立刻拿到更新后的 DOM 用 \`flushSync\`（慎用，会放弃批处理）。`,
    track: "foundation",
    categoryId: "foundation-react",
    difficulty: "medium",
    tags: ["React", "Hooks", "高频", "原理"],
    topic: "React 状态更新 · 批处理",
    reviewedAt: "2026-11",
    heat: 92,
    updatedAt: "2026-11-15",
  },
  {
    id: "code-react-effect-order",
    title: "父子组件的 effect 执行顺序",
    stem: "首次挂载时控制台输出顺序是什么？卸载时呢？为什么开发环境会看到两轮？",
    stemCodeLang: "tsx",
    stemCode: `function Child() {
  useEffect(() => {
    console.log('child effect');
    return () => console.log('child cleanup');
  }, []);
  return <div>child</div>;
}

function Parent() {
  useEffect(() => {
    console.log('parent effect');
    return () => console.log('parent cleanup');
  }, []);
  return <Child />;
}`,
    answer: `- 挂载：\`child effect\` → \`parent effect\`。effect 在**整棵树提交之后**按**自下而上**执行（子组件先就绪，父组件才能安全地访问子节点）。
- 卸载：\`parent cleanup\` → \`child cleanup\`。销毁按**自上而下**，与挂载相反。
- 依赖变化时同理：先执行上一次的 cleanup（父→子），再执行新的 effect（子→父）；同一组件内多个 effect 按**书写顺序**执行。
- 开发环境 StrictMode 会把挂载流程跑两遍（effect → cleanup → effect），所以会看到两轮日志 —— 这是刻意设计，用来暴露「cleanup 不彻底」的 bug（定时器、订阅没清就会露馅）。
- 实务：需要读自身 DOM 用 \`useLayoutEffect\`（绘制前、DOM 已就绪）；需要发请求/订阅用 \`useEffect\`；cleanup 必须与 setup 严格对称。`,
    track: "foundation",
    categoryId: "foundation-react",
    difficulty: "hard",
    tags: ["React", "Hooks", "原理", "大厂"],
    topic: "React 副作用 · 执行顺序",
    reviewedAt: "2026-11",
    heat: 86,
    updatedAt: "2026-11-12",
  },
  {
    id: "code-vue-watch-flush",
    title: "watch 的 flush 与 DOM 更新时机",
    stem: "在 onMounted 里改一次 count，两个 watch 分别打印什么？为什么？",
    stemCodeLang: "vue",
    stemCode: `<script setup>
import { ref, watch, onMounted } from 'vue'

const count = ref(0)

watch(count, () => {
  console.log('pre', document.querySelector('#c').textContent)
})

watch(count, () => {
  console.log('post', document.querySelector('#c').textContent)
}, { flush: 'post' })

onMounted(() => {
  count.value = 1
})
</script>

<template>
  <div id="c">{{ count }}</div>
</template>`,
    answer: `- 输出：\`pre 0\` → \`post 1\`。
- 默认 \`flush: 'pre'\`：回调在**组件更新之前**执行，此时 DOM 还是旧值 \`0\`；优点是可以在渲染前改数据、把多次变更合并进同一次更新。
- \`flush: 'post'\`：回调在**组件更新之后**执行，DOM 已是 \`1\`；等价于在回调里 \`await nextTick()\`。
- \`flush: 'sync'\`：数据一变立刻同步执行，会打断批处理，容易触发连锁更新甚至死循环，只用于极少数同步读场景。
- 记住这条链路：改响应式数据 → 调度更新（微任务）→ 组件重新渲染 → 执行 post 回调。想在代码里等 DOM，一律 \`await nextTick()\`。`,
    track: "foundation",
    categoryId: "foundation-vue",
    difficulty: "medium",
    tags: ["Vue", "Vue3", "原理"],
    topic: "Vue 响应式副作用 · 时机",
    reviewedAt: "2026-11",
    heat: 78,
    updatedAt: "2026-11-11",
  },
  {
    id: "code-ts-widening",
    title: "对象字面量的类型拓宽与 as const / satisfies",
    stem: "为什么第一处调用会报类型错误，后两处不会？三个变量的类型分别是什么？",
    stemCodeLang: "ts",
    stemCode: `type Status = 'idle' | 'loading' | 'done'

function setStatus(status: Status): void {}

const a = { status: 'idle', retries: 3 }
setStatus(a.status)                        // 报错

const b = { status: 'idle' as const, retries: 3 }
setStatus(b.status)                        // 通过

const c = { status: 'idle', retries: 3 } satisfies { status: Status; retries: number }
setStatus(c.status)                        // 通过`,
    answer: `- \`a\` 的类型是 \`{ status: string; retries: number }\`：对象字面量的属性会被**拓宽**成 \`string\`（可变属性可以随时被改成别的字符串），所以 \`a.status\` 不能赋给 \`Status\`。
- \`b\` 用 \`as const\` → \`{ readonly status: "idle"; readonly retries: 3 }\`：字面量类型被保留、属性只读；代价是**所有**字段都变只读、数字也变字面量类型。
- \`c\` 用 \`satisfies\` → \`{ status: "idle"; retries: number }\`：既按 \`{ status: Status; retries: number }\` 校验结构，又**保留**推断出的窄类型（不像类型注解那样把 \`status\` 拓宽回 \`Status\`）。这也是它相对 \`const c: X = ...\` 的核心价值。
- 想要「校验 + 保留字面量」就 \`satisfies\`；想要「结构冻结 + 完全字面量」就 \`as const\`；两者可组合：\`{...} as const satisfies X\`。
- 补充：函数参数、返回值也会发生拓宽/收窄；\`let\` 声明同样拓宽，\`const\` 声明原始值不拓宽 —— 但 \`const\` 对象的属性仍然拓宽。`,
    track: "foundation",
    categoryId: "foundation-ts",
    difficulty: "medium",
    tags: ["TypeScript", "类型", "2026"],
    topic: "TypeScript 类型推断",
    reviewedAt: "2026-11",
    heat: 80,
    updatedAt: "2026-11-10",
  },
];
