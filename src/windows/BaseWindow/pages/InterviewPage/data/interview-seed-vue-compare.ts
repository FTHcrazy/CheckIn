/**
 * 题库 · Vue 2 与 Vue 3 的对比与深入。
 *
 * 面试里 Vue 的问题集中在三条线：响应式实现（defineProperty → Proxy）、
 * API 组织方式（Options → Composition）、以及编译期优化（静态提升 / patchFlag）。
 * 这里把「2 和 3 到底差在哪」问透，而不是背 API。
 */
import type { InterviewQuestion } from "./interview-types";

export const SEED_VUE_COMPARE: readonly InterviewQuestion[] = [
  {
    id: "vue2-vs-vue3-reactivity",
    title: "Vue 2 的 defineProperty 与 Vue 3 的 Proxy 差在哪",
    stem: "从能力边界、性能、兼容性三方面对比两套响应式实现，并说明 Vue 2 为什么要用 $set。",
    answer: `- **Vue 2** 递归遍历 data，用 \`Object.defineProperty\` 把每个属性改成 getter/setter；只能拦截**已存在的属性读写**，所以新增/删除属性、数组索引赋值、\`length\` 修改都侦测不到 → 需要 \`Vue.set\` / \`$set\`，数组则重写了 7 个变更方法。
- **Vue 3** 用 \`Proxy\` 代理整个对象，配合 \`Reflect\` 转发：新增/删除（\`deleteProperty\`）、\`in\`、数组索引、\`Map/Set\` 都能拦截，不再需要 \`$set\`。
- 性能：Proxy **惰性**代理（访问到才递归，深层大对象更快），defineProperty 必须初始化时全量递归；但 Proxy 每次读写多一层陷阱调用，热点小对象上差距不大。
- 兼容性：Proxy 无法 polyfill，这是 Vue 3 不支持 IE11 的根本原因（Vue 2.7 是最后一个支持 IE 的版本）。
- 共同点：都无法侦测「替换整个对象」之外的原地操作（\`arr[0] = x\` 在 Vue 3 可以，但直接改 \`Object.freeze\` 的对象不行），也都不跟踪非响应式来源。`,
    track: "foundation",
    categoryId: "foundation-vue",
    difficulty: "medium",
    tags: ["Vue", "Vue2", "Vue3", "原理"],
    topic: "Vue 响应式原理 · 2 与 3 对比",
    reviewedAt: "2026-11",
    heat: 92,
    updatedAt: "2026-11-15",
  },
  {
    id: "vue2-vs-vue3-api",
    title: "Options API 与 Composition API 的组织差异",
    stem: "为什么 Vue 3 要引入 Composition API？mixins 到底有什么问题？",
    answer: `- Options API 按**选项类型**切分（data/methods/computed/watch），一个功能的代码散落在四处；组件超过 300 行后「改一个功能要跳四处」。
- Composition API 按**功能**聚合：一个 \`useXxx()\` 里包含状态、计算、副作用，可以整体移动、复用、测试。
- mixins 的四个问题：**来源不清**（this 上多了什么不知道）、**命名冲突**（后注册覆盖先注册）、**隐式依赖**（mixins 之间互相假设）、**复用不灵活**（无法传参）。Composition API 用函数参数与返回值显式化，全部解决。
- 代价：需要自己管理响应式边界（\`ref\`/\`reactive\`、\`toRefs\`），逻辑拆分过度会变成「一堆 composable 互相调用」的新复杂度。
- 选型建议：小页面 Options API 更直观；中大型项目、需要跨组件复用逻辑时用 Composition API；Vue 2.7 已内置 \`<script setup>\` 的同款能力，可作为迁移过渡。`,
    track: "foundation",
    categoryId: "foundation-vue",
    difficulty: "medium",
    tags: ["Vue", "Vue2", "Vue3", "架构"],
    topic: "Vue 组件设计 · API 风格",
    reviewedAt: "2026-11",
    heat: 85,
    updatedAt: "2026-11-14",
  },
  {
    id: "vue3-ref-reactive",
    title: "ref 与 reactive 怎么选，解构为什么会丢响应性",
    stem: "const { count } = reactive(state) 之后视图不更新，为什么？shallowRef 又用在哪？",
    answer: `- \`reactive\` 返回 Proxy，**解构取出来的是普通值**，与代理断开，后续修改不触发更新；需要 \`toRefs\` / \`toRef\` 包一层保持引用。
- \`ref\` 用 \`{ value }\` 包装，可以持有原始类型；模板里自动解包（\`count\` 而非 \`count.value\`），\`<script>\` 里必须写 \`.value\`。
- 选择：**原始类型、需要整体替换（\`list.value = newList\`）→ ref**；一组强关联字段且不需要替换整个对象 → reactive。
- \`shallowRef\` / \`shallowReactive\` 只代理第一层：适合大对象、第三方实例（图表、地图、编辑器）—— 深层递归代理既慢又可能污染库内部状态。
- 常见坑：\`ref\` 放进 \`reactive\` 会自动解包（\`state.r\` 就是值），但放进数组不会；\`props\` 解构同样丢响应性（Vue 3.5 起对 \`defineProps\` 的解构做了响应式支持）。`,
    track: "foundation",
    categoryId: "foundation-vue",
    difficulty: "medium",
    tags: ["Vue", "Vue3", "高频"],
    topic: "Vue 3 响应式 · ref 与 reactive",
    reviewedAt: "2026-11",
    heat: 88,
    updatedAt: "2026-11-13",
  },
  {
    id: "vue3-watch-flush",
    title: "watch 的 flush 三种时机与 DOM 更新顺序",
    stem: "watch 默认在什么时机执行？想在 DOM 更新后读新节点该怎么做？",
    answer: `- \`flush: 'pre'\`（默认）：**组件更新前**执行，此时 DOM 还是旧值；能避免多余渲染（在渲染前改数据会合并进同一次更新）。
- \`flush: 'post'\`：组件更新后执行，DOM 已是新值；等价于把回调放进 \`nextTick\`。
- \`flush: 'sync'\`：数据一变立刻同步执行，**不要用于会改状态的逻辑**（可能触发连锁更新、甚至死循环）。
- \`watchEffect\` 同样有 flush 选项；需要访问更新后的 DOM 一般写 \`await nextTick()\` 或直接 \`flush: 'post'\`。
- 与 \`updated\` 的区别：\`updated\` 是组件级、只要重渲染就触发；watch 是数据级、只有依赖变化才触发，粒度更细、更适合做副作用。`,
    track: "foundation",
    categoryId: "foundation-vue",
    difficulty: "medium",
    tags: ["Vue", "Vue3", "原理"],
    topic: "Vue 3 响应式副作用 · watch",
    reviewedAt: "2026-11",
    heat: 78,
    updatedAt: "2026-11-12",
  },
  {
    id: "vue3-lifecycle-order",
    title: "父子组件的生命周期执行顺序",
    stem: "从父 setup 到子 unmounted，完整说一遍挂载与卸载的调用顺序，并解释为什么是这个顺序。",
    answer: `- **挂载**：父 \`setup\` → 父 \`beforeMount\` → 子 \`setup\` → 子 \`beforeMount\` → 子 \`mounted\` → 父 \`mounted\`。
- 原因：父要等子组件 DOM 都插好才算「自己挂载完成」，所以 mounted 是**自下而上**；beforeMount 是「即将插入」所以自上而下。
- **更新**：父 \`beforeUpdate\` → 子 \`beforeUpdate\` → 子 \`updated\` → 父 \`updated\`。
- **卸载**：父 \`beforeUnmount\` → 子 \`beforeUnmount\` → 子 \`unmounted\` → 父 \`unmounted\`。
- Composition API 里 \`onMounted\` 等价于 mounted，但**在 setup 内同步注册**；异步（await 之后）注册的钩子不会生效，因为组件实例已结束初始化。
- 实务结论：需要子组件就绪后再测量/初始化第三方库，放父 \`onMounted\`；需要拿自身 DOM，放子 \`onMounted\` 或 \`nextTick\`。`,
    track: "foundation",
    categoryId: "foundation-vue",
    difficulty: "basic",
    tags: ["Vue", "Vue3", "基础", "高频"],
    topic: "Vue 生命周期",
    reviewedAt: "2026-11",
    heat: 82,
    updatedAt: "2026-11-11",
  },
  {
    id: "vue3-v-model-model",
    title: "v-model 在 Vue 3 里的实现变化与自定义组件",
    stem: "Vue 2 的 .sync 去哪了？如何在自定义组件上实现多个 v-model？",
    answer: `- Vue 2：\`v-model\` 在组件上等价于 \`:value\` + \`@input\`，一个组件只能有一个；多值用 \`.sync\` 修饰符（\`:foo.sync\` + \`update:foo\`）。
- Vue 3：统一成 \`modelValue\` + \`update:modelValue\`，\`.sync\` 被移除 —— 多值直接写 \`v-model:foo\`（等价 \`:foo\` + \`@update:foo\`），一个组件可以有任意多个 v-model。
- 自定义组件实现：声明 \`props: ['modelValue']\` + \`emits: ['update:modelValue']\`，子组件内部改值时 \`emit('update:modelValue', next)\`；不想手写可以用 \`defineModel()\`（3.4+ 稳定），它会自动生成 prop + emit。
- 修饰符：\`v-model.trim\` 会通过 \`modelModifiers\` prop 传给子组件，子组件自己处理；\`v-model:foo.upper\` 用 \`fooModifiers\`。
- 坑：子组件直接改 prop 会告警（单向数据流），必须 emit；\`defineModel\` 返回的是 ref，赋值即 emit。`,
    track: "foundation",
    categoryId: "foundation-vue",
    difficulty: "medium",
    tags: ["Vue", "Vue2", "Vue3", "组件"],
    topic: "Vue 组件通信 · v-model",
    reviewedAt: "2026-11",
    heat: 74,
    updatedAt: "2026-11-10",
  },
  {
    id: "vue3-keep-alive",
    title: "keep-alive 的缓存机制与 activated / deactivated",
    stem: "列表页 → 详情页 → 返回，如何保住列表的滚动位置与筛选条件？keep-alive 有哪些副作用？",
    answer: `- \`<keep-alive>\` 缓存组件实例（不是 DOM 字符串），切换时走 \`deactivated\` / \`activated\` 而不是 unmount / mount，因此状态、滚动容器、甚至第三方实例都保留。
- 控制缓存：\`include\`/\`exclude\`（匹配组件 \`name\`，\`<script setup>\` 需要 \`defineOptions({ name })\` 或文件名推断）、\`max\` 限制数量并 LRU 淘汰。
- 副作用：**内存不释放**（大列表缓存十个页面就很重）、缓存组件内的定时器/订阅仍在跑（要在 deactivated 里暂停）、数据不刷新（返回时看到旧数据，需在 activated 里按需重取）。
- 滚动位置：keep-alive 只保留 DOM，滚动容器若是页面级（body/外层 scroll）仍需手动记录 \`scrollTop\`，返回时恢复。
- 替代方案：路由层面用「状态提升到 store + 列表虚拟滚动」，或对详情页用弹层/抽屉，避免整页切换 —— 缓存不是唯一解。`,
    track: "foundation",
    categoryId: "foundation-vue",
    difficulty: "medium",
    tags: ["Vue", "Vue3", "实践"],
    topic: "Vue 组件缓存 · keep-alive",
    reviewedAt: "2026-11",
    heat: 76,
    updatedAt: "2026-11-09",
  },
  {
    id: "vue3-teleport-suspense",
    title: "Teleport 与 Suspense 解决什么问题",
    stem: "弹窗被父级 overflow: hidden 裁掉、z-index 压不过，怎么解？异步组件加载态怎么统一处理？",
    answer: `- \`<Teleport to="body">\` 把子树渲染到指定容器，**逻辑上仍在原组件树**（props、事件、provide/inject 都照旧），只是 DOM 位置变了 —— 解决弹窗被 \`overflow: hidden\`、\`transform\` 创建的层叠上下文裁切的问题。
- Teleport 的坑：目标容器必须已存在（\`to\` 支持选择器或元素）；样式隔离失效（scoped 样式仍带原组件的 data 属性，但祖先选择器不再命中）；SSR 需要保证服务端也能找到目标。
- \`<Suspense>\` 用于等待异步组件（\`defineAsyncComponent\`）或 \`setup\` 里的顶层 await：\`#default\` 是内容、\`#fallback\` 是加载态。
- Suspense 仍是实验性 API：错误处理要用 \`onErrorCaptured\`，多级 Suspense 的 fallback 顺序容易踩坑；生产里更常见的是自己用 \`loading\` 状态 + 骨架屏。
- 两者组合的典型场景：异步弹窗 = Teleport 到 body + Suspense 包内容 + 骨架屏。`,
    track: "foundation",
    categoryId: "foundation-vue",
    difficulty: "medium",
    tags: ["Vue", "Vue3", "组件"],
    topic: "Vue 内置组件 · Teleport / Suspense",
    reviewedAt: "2026-11",
    heat: 68,
    updatedAt: "2026-11-08",
  },
  {
    id: "vue3-ssr-hydration",
    title: "Vue SSR 的水合过程与常见不一致",
    stem: "Nuxt 项目首屏闪一下再变、控制台报 hydration mismatch，原因通常是什么？",
    answer: `- 流程：服务端把组件渲染成 HTML 字符串 + 序列化状态（\`window.__NUXT__\`）→ 浏览器先显示静态 HTML → 客户端加载 bundle、复用 DOM 并绑定事件，这一步叫 **hydration**。
- 不一致（mismatch）的常见来源：\`Date.now()\`/\`Math.random()\`、\`window\`/\`localStorage\` 判断、浏览器扩展改 DOM、\`<p>\` 里嵌块级元素被浏览器改写、服务端与客户端语言时区不同。
- 表现：Vue 会警告并**丢弃服务端 DOM 重新渲染**（首屏闪烁 + 白屏风险），严重时事件绑定错位。
- 解法：首次渲染保持确定性（固定初始值）；环境相关逻辑放 \`onMounted\`；用 \`useState\`/\`useAsyncData\` 让服务端取到的数据序列化给客户端复用，避免客户端再请求一遍。
- 选型补充：纯后台管理系统没必要上 SSR；SEO 或首屏指标敏感的场景才值得付出这套复杂度（也可考虑 SSG / 增量静态化）。`,
    track: "foundation",
    categoryId: "foundation-vue",
    difficulty: "hard",
    tags: ["Vue", "SSR", "Nuxt", "2026"],
    topic: "Vue SSR · 水合",
    reviewedAt: "2026-11",
    heat: 70,
    updatedAt: "2026-11-07",
  },
  {
    id: "vue2-eol-migration",
    title: "Vue 2 已停止维护，升级 Vue 3 要改哪些地方",
    stem: "一个 Vue 2 + Vuex + vue-router 3 的项目要迁到 Vue 3，列出破坏性变更与迁移顺序。",
    answer: `- 背景：Vue 2 已于 2023-12-31 停止维护（不再有安全更新）；Vue 2.7 是终点版本，内置了 Composition API 作为过渡。
- 破坏性变更清单：**过滤器 filters 移除**（改 computed 或方法）、\`$listeners\` 合并进 \`$attrs\`、\`v-bind.sync\` → \`v-model:xxx\`、\`v-model\` 的 \`.sync\`/\`value\` 语义改为 \`modelValue\`、\`$children\` 移除、\`functional\` 组件改为普通函数式写法、\`beforeDestroy\` → \`beforeUnmount\`、\`EventBus\`（$on/$off）移除（改用 mitt）。
- 生态升级：vue-router 4（\`new Router\` → \`createRouter\`、\`* \` 通配符 → \`:pathMatch(.*)*\`）、Vuex 4 或直接换 Pinia、UI 库（Element Plus / Ant Design Vue 3+）。
- 迁移顺序：先升到 2.7 用 Composition API 改写复杂组件 → 用 \`@vue/compat\` 兼容构建跑测试 → 逐个修警告 → 切到纯 Vue 3 构建。
- 风险点：第三方组件库无 Vue 3 版本时只能替换或重写；自研指令/插件要检查 \`bind/inserted\` → \`beforeMount/mounted\` 的钩子改名。`,
    track: "foundation",
    categoryId: "foundation-vue",
    difficulty: "hard",
    tags: ["Vue", "Vue2", "Vue3", "迁移"],
    topic: "Vue 版本迁移",
    reviewedAt: "2026-11",
    heat: 72,
    updatedAt: "2026-11-06",
  },
  {
    id: "vue-perf-shallow-virtual",
    title: "Vue 长列表卡顿怎么优化",
    stem: "一个 5000 行的表格滚动卡、筛选也卡，从响应式、渲染、编译三方面给方案。",
    answer: `- **响应式层**：大数组用 \`shallowRef\`（整体替换才触发），行数据不深层代理；只读配置用 \`markRaw\`；把「列表数据」和「筛选条件」拆成不同 ref，避免一处变动触发全量依赖。
- **渲染层**：虚拟滚动（\`vue-virtual-scroller\` / 自研定高方案）把 DOM 数量从 5000 降到几十；行组件 \`v-memo="[row.id, row.status]"\` 跳过未变化行的 patch；避免在模板里写复杂表达式（每次渲染都算）。
- **编译层**：\`v-for\` 的 key 用业务 id 而不是 index（index 会让复用错位）；\`v-if\` 与 \`v-for\` 不要同级；静态内容靠 Vue 3 的静态提升自动优化，但动态绑定过多仍会生成大量 patchFlag。
- **计算层**：筛选/排序用 \`computed\` 缓存，避免在 \`watch\` 里手写赋值；重计算丢给 Web Worker 或 \`requestIdleCallback\`。
- 量化：先开 Performance 面板确认瓶颈是「script」还是「render」，再决定优化哪一层 —— 大部分「Vue 慢」其实是数据量导致的 DOM 慢。`,
    track: "foundation",
    categoryId: "foundation-vue",
    difficulty: "hard",
    tags: ["Vue", "性能", "大厂"],
    topic: "Vue 性能优化 · 长列表",
    reviewedAt: "2026-11",
    heat: 74,
    updatedAt: "2026-11-05",
  },
];
