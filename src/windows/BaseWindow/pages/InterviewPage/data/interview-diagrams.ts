/**
 * 知识图解数据（单一样式源）。
 *
 * 题库里的答案已经能把一件事说清，但「执行顺序」「两套方案的差别」「分几层」
 * 这类信息用纯文字读起来最费劲。这里把这类信息抽成结构化的四类图：
 *
 * - `flow`：步骤链（谁先谁后、走到哪个分支）
 * - `timeline`：时序 / 时间轴（握手、数组每轮状态、流水线阶段）
 * - `compare`：左右对照（React vs Vue、Map 版 vs 链表版）
 * - `layers`：分层堆叠（进程架构、渲染层级、B+ 树高度）
 *
 * 刻意**不引入图表库**：图是数据驱动的布局，颜色全部走 `--app-*` token，
 * 主题切换与窄宽度换行都由 CSS 负责，组件只负责把节点摆对。
 * 新增图后必须被题库或知识体系引用一次，由 `interview-diagrams.test.ts` 守卫。
 */

/** 节点语义色：只影响底色与描边，不影响文字对比度 */
export type DiagramTone = "primary" | "success" | "warning" | "danger" | "muted";

export interface DiagramNode {
  label: string;
  /** 节点补充说明，一句话 */
  note?: string;
  tone?: DiagramTone;
}

export interface DiagramColumn {
  title: string;
  /** 这一栏的总述 */
  note?: string;
  items: readonly string[];
}

export interface DiagramLayer {
  label: string;
  note?: string;
  /** 该层的关键能力 / 关键词，渲染成小 chip */
  tags?: readonly string[];
}

export interface DiagramEvent {
  title: string;
  detail?: string;
  tone?: DiagramTone;
}

interface DiagramBase {
  id: string;
  title: string;
  /** 一句话说明「这张图在讲什么」，每个图都必须有 */
  caption: string;
  /** 图下的编号步骤，可空 */
  steps?: readonly string[];
  /** 最容易看错的一点，可空 */
  note?: string;
}

export interface FlowDiagram extends DiagramBase {
  kind: "flow";
  nodes: readonly DiagramNode[];
}

export interface TimelineDiagram extends DiagramBase {
  kind: "timeline";
  events: readonly DiagramEvent[];
}

export interface CompareDiagram extends DiagramBase {
  kind: "compare";
  left: DiagramColumn;
  right: DiagramColumn;
}

export interface LayersDiagram extends DiagramBase {
  kind: "layers";
  layers: readonly DiagramLayer[];
}

export type InterviewDiagram =
  | FlowDiagram
  | TimelineDiagram
  | CompareDiagram
  | LayersDiagram;

export const DIAGRAM_KIND_LABEL: Record<InterviewDiagram["kind"], string> = {
  flow: "流程图",
  timeline: "步骤图",
  compare: "对照图",
  layers: "架构图",
};

export const DIAGRAMS: readonly InterviewDiagram[] = [
  // ── 框架 ──────────────────────────────────────────────────────
  {
    id: "dg-react-diff",
    kind: "flow",
    title: "React Diff：三条策略把 O(n³) 压成 O(n)",
    caption:
      "只比同层、类型不同直接重建、同层按 key 配对 —— 跨层级移动一律当作「删除 + 新建」。",
    nodes: [
      { label: "新旧两棵 Fiber 树", note: "只在同一层级内比较", tone: "muted" },
      { label: "类型不同？", note: "卸载整棵子树重建", tone: "danger" },
      { label: "类型相同", note: "复用 DOM，只改变化了的属性", tone: "primary" },
      { label: "有 key", note: "建 key → 节点映射再配对", tone: "primary" },
      { label: "无 key", note: "按下标顺序就地复用", tone: "warning" },
      { label: "记录副作用", note: "插入 / 移动 / 删除", tone: "success" },
    ],
    steps: [
      "先看类型：div 换成 span 时 React 不复用节点，直接销毁重建 —— 这也是「别随手改列表项标签」的原因。",
      "再看 key：同层按 key 建映射，一遍扫描就能找到可复用节点；没有 key 就退化成按下标配对。",
      "差异不进 DOM，先记进副作用队列，commit 阶段一次性落地，避免多次重排。",
    ],
    note: "用下标当 key，头部插入会让所有节点错位复用，state 跟着串 —— 不是 diff 变慢，是复用错了对象。",
  },
  {
    id: "dg-fiber",
    kind: "compare",
    title: "Fiber 两阶段：可中断的 render + 不可中断的 commit",
    caption: "算「要改什么」可以随时暂停，写 DOM 必须一次做完。",
    left: {
      title: "render 阶段（可中断）",
      note: "产出新的 Fiber 树与副作用链表，全程不碰真实 DOM",
      items: [
        "beginWork 向下递、completeWork 向上归",
        "每个工作单元结束时检查是否该让出主线程",
        "高优先级更新能打断并丢弃当前进度",
        "StrictMode 下可能被重复执行",
      ],
    },
    right: {
      title: "commit 阶段（同步）",
      note: "三个子阶段一次做完，用户看不到半截 UI",
      items: [
        "BeforeMutation：读取 DOM 快照",
        "Mutation：插入 / 更新 / 删除真实节点",
        "Layout：useLayoutEffect 同步执行",
        "Passive：useEffect 异步执行，不挡绘制",
      ],
    },
    steps: [
      "两阶段分离的动机是「计算能重来、DOM 不能重来」：中途被打断只会丢弃内存里的树。",
      "useEffect 被排到绘制之后，正是为了不阻塞首屏；需要读布局就必须用 useLayoutEffect。",
    ],
    note: "render 阶段和浏览器渲染无关，它只是 React 内部的「计算新树」代号。",
  },
  {
    id: "dg-vue3-diff",
    kind: "flow",
    title: "Vue 3 有 key diff：预处理 → 建映射 → LIS 求最小移动",
    caption: "先掐头去尾剥掉能直接复用的节点，中段乱序部分再交给 key 映射与最长递增子序列。",
    nodes: [
      { label: "掐头", note: "首部相同节点直接复用", tone: "primary" },
      { label: "去尾", note: "尾部相同节点直接复用", tone: "primary" },
      { label: "旧节点耗尽", note: "剩余新节点全部挂载", tone: "success" },
      { label: "新节点耗尽", note: "剩余旧节点全部卸载", tone: "danger" },
      { label: "建 key → 新索引映射", note: "顺手记下是否需要移动", tone: "primary" },
      { label: "LIS 标记稳定序列", note: "这些节点原地不动", tone: "warning" },
      { label: "从后往前插入 / 移动", note: "锚点固定，下标不会漂移", tone: "success" },
    ],
    steps: [
      "掐头去尾覆盖了「纯追加 / 纯删除 / 只改中间一小段」这几类最常见场景，代价是 O(1)。",
      "剩下的乱序段建 key 映射，再求最长递增子序列：LIS 里的节点相对顺序已正确，一律不动。",
      "遍历新列表从后往前处理，插入位置用「下一个已处理节点」当锚点，前面怎么移动都不影响后面。",
    ],
    note: "LIS 求的是「可以不动的最长子集」，说成「最短移动路径」结论对但推理是反的。",
  },
  {
    id: "dg-vue-reactivity",
    kind: "flow",
    title: "Vue 3 响应式闭环：读时收集依赖，写时触发更新",
    caption: "一次 get 建一条依赖，一次 set 唤回那条依赖上的所有 effect。",
    nodes: [
      { label: "render effect 执行", tone: "muted" },
      { label: "读取 state.count", note: "进入 Proxy 的 get", tone: "primary" },
      { label: "track 登记", note: "WeakMap → Map → Set 三层", tone: "primary" },
      { label: "写入 state.count", note: "进入 Proxy 的 set", tone: "warning" },
      { label: "trigger 取依赖", note: "取出该 key 上的 effect 集合", tone: "warning" },
      { label: "调度执行 effect", note: "同一 tick 去重后按优先级刷新", tone: "success" },
    ],
    steps: [
      "依赖是「读出来」的，不是「声明出来」的：模板里没用到 count，改 count 就不会触发这次渲染。",
      "三层结构让「对象 → 属性 → 副作用」各自独立，删除某个属性时整块依赖可以直接回收。",
      "effect 嵌套时靠 effect 栈维护 activeEffect，内层执行完必须还原外层，否则依赖会挂错人。",
    ],
    note: "ref 用 .value 访问，本质是为了让「基础类型」也能被 get/set 拦截 —— 对象没这个约束。",
  },
  {
    id: "dg-vdom",
    kind: "flow",
    title: "从 JSX 到真实 DOM：虚拟 DOM 的完整链路",
    caption: "组件返回的是描述对象，真正改 DOM 只发生在最后一步。",
    nodes: [
      { label: "JSX / 模板", tone: "muted" },
      { label: "createElement / h()", note: "生成 vnode 对象", tone: "primary" },
      { label: "新旧 vnode 树对比", note: "diff 出最小变更集", tone: "primary" },
      { label: "补丁队列", note: "记录插入 / 移动 / 删除", tone: "warning" },
      { label: "批量提交", note: "一次性操作真实 DOM", tone: "success" },
    ],
    steps: [
      "虚拟 DOM 的价值不是「一定更快」，而是把「改哪里」从手写 DOM 操作变成声明式描述，并提供跨平台渲染能力。",
      "一次更新 = 建树 + 比较 + 提交；成本靠「同层比较 + key」压住，而不是靠 DOM 操作次数少。",
    ],
  },

  // ── 工程化 ────────────────────────────────────────────────────
  {
    id: "dg-webpack-flow",
    kind: "timeline",
    title: "webpack 构建主流程：一条 Tapable 钩子串起来的流水线",
    caption: "从 entry 出发递归解析，seal 阶段切 chunk，emit 阶段写产物；每个阶段都是可插拔的钩子。",
    events: [
      { title: "初始化参数", detail: "合并 CLI 与配置，创建 compiler 与内部插件" },
      { title: "run → compile", detail: "新建 compilation，清空上一次的构建状态" },
      { title: "make", detail: "从 entry 出发，按规则匹配 loader 把模块转成 JS" },
      { title: "buildModule / 递归", detail: "acorn 解析 import，继续 make，形成依赖图" },
      { title: "seal", detail: "按依赖图切 chunk，做 tree shaking、压缩与优化" },
      { title: "emit", detail: "把产物写入 output 目录（含 assets 钩子）" },
      { title: "done", detail: "输出 stats；watch 模式下等待下一次文件变更" },
    ],
    steps: [
      "loader 只负责「单个文件的内容转换」，plugin 负责「整个构建过程」—— 职责混了就会出现「在 loader 里改 chunk」这种错误设计。",
      "插件不是插进流程，而是 tap 到某个钩子上：拿到 compilation 就能读模块、加资源、改产物。",
      "HMR 不是另一条链路：watch 触发重新 compile，emit 阶段把补丁通过 WebSocket 推给运行时。",
    ],
    note: "make 是递归的，一个模块的 import 会再触发一次 make —— 所以「构建慢」通常慢在模块数量与 loader 链，而不是 seal。",
  },
  {
    id: "dg-webpack-hooks",
    kind: "compare",
    title: "Tapable 的两条正交轴：同步/异步 × 串行/并行",
    caption: "选错钩子类型，插件要么拿不到异步结果，要么把并行任务写成串行。",
    left: {
      title: "同步钩子（Sync*）",
      note: "回调里不能 await，适合纯计算与同步改写",
      items: [
        "SyncHook：依次执行，不关心返回值",
        "SyncBailHook：任一返回非 undefined 就中断",
        "SyncWaterfallHook：上一个的返回值传给下一个",
        "SyncLoopHook：返回 true 就重跑当前回调",
      ],
    },
    right: {
      title: "异步钩子（Async*）",
      note: "用 tapAsync（callback）或 tapPromise（返回 Promise）注册",
      items: [
        "AsyncSeriesHook：串行等待，前一个完成才走下一个",
        "AsyncParallelHook：并行发起，全部完成后汇总",
        "AsyncSeriesWaterfallHook：串行且值依次传递",
        "典型场景：压缩、上传产物、远程校验",
      ],
    },
    steps: [
      "判断方法很简单：这一步要不要等 I/O 结果？要就用 Async，不要就用 Sync。",
      "多个插件的同一钩子是否允许并发？允许就 Parallel，有先后依赖就 Series。",
    ],
  },
  {
    id: "dg-cicd",
    kind: "flow",
    title: "一条能挡住问题的流水线：从提交到可回滚的产物",
    caption: "门禁的意义是「不合规就走不下去」，而不是「跑一遍看起来很专业」。",
    nodes: [
      { label: "push / PR", tone: "muted" },
      { label: "装依赖", note: "锁文件 + 缓存命中", tone: "primary" },
      { label: "静态检查", note: "tsc --noEmit + lint", tone: "primary" },
      { label: "单测", note: "按改动面选范围", tone: "primary" },
      { label: "构建产物", note: "打包 + 体积对比", tone: "warning" },
      { label: "发布", note: "带版本号，可灰度", tone: "success" },
      { label: "回滚", note: "上一版产物必须还在", tone: "danger" },
    ],
    steps: [
      "顺序按「越便宜越靠前」排：类型检查几十秒，端到端测试十几分钟，别让快反馈排在慢任务后面。",
      "产物要带可追溯的版本号与 commit，否则「线上是哪个版本」永远说不清。",
    ],
    note: "流水线超过十分钟基本没人等，缓存依赖与并行任务比换更快的机器更有效。",
  },

  // ── 运行时与浏览器 ────────────────────────────────────────────
  {
    id: "dg-event-loop",
    kind: "flow",
    title: "事件循环：一轮里到底发生了什么",
    caption: "取一个宏任务 → 清空微任务 → 有机会渲染 → 下一轮。",
    nodes: [
      { label: "取一个宏任务", note: "setTimeout / I/O / 用户交互", tone: "primary" },
      { label: "执行到调用栈清空", tone: "primary" },
      { label: "清空微任务队列", note: "Promise.then / queueMicrotask", tone: "warning" },
      { label: "微任务又产生微任务", note: "仍在本轮排空", tone: "warning" },
      { label: "浏览器渲染", note: "样式 → 布局 → 绘制，不一定每轮都做", tone: "muted" },
      { label: "进入下一轮", tone: "success" },
    ],
    steps: [
      "「先微后宏」不是实现细节，而是规范定义的顺序，所以 Promise.then 永远早于 setTimeout(0)。",
      "微任务队列不清空就不会渲染：在微任务里无限排微任务，页面会直接卡死。",
      "await 之后的代码等价于 then 回调，同一个 async 函数里 await 下面全是微任务。",
    ],
    note: "setTimeout 的 0 不是「立刻」，最小也是 1ms，嵌套超过 4 层后强制 4ms。",
  },
  {
    id: "dg-node-loop",
    kind: "flow",
    title: "Node 事件循环的六个阶段",
    caption: "poll 阶段等 I/O，check 阶段跑 setImmediate，每个阶段切换前都要清空微任务。",
    nodes: [
      { label: "timers", note: "到期 setTimeout / setInterval 回调", tone: "primary" },
      { label: "pending callbacks", note: "上一轮延迟的系统回调", tone: "muted" },
      { label: "idle / prepare", note: "Node 内部使用", tone: "muted" },
      { label: "poll", note: "等 I/O，绝大多数回调在这里执行", tone: "primary" },
      { label: "check", note: "setImmediate 回调", tone: "warning" },
      { label: "close callbacks", note: "socket 关闭等", tone: "muted" },
    ],
    steps: [
      "process.nextTick 有独立队列，优先级高于 Promise 微任务，每阶段切换前两者都要清空。",
      "主模块里 setTimeout(0) 与 setImmediate 的先后不确定，取决于进入 timers 阶段时是否已过 1ms；在 I/O 回调里则 setImmediate 恒先。",
      "poll 阶段没有待处理 I/O 时会在这里等，等到有事件或下一个 timer 到期 —— 这就是 Node「不空转」的原因。",
    ],
  },
  {
    id: "dg-browser-render",
    kind: "flow",
    title: "浏览器渲染流水线：改动会触发到哪一步",
    caption: "改几何要重排，改颜色只重绘，改 transform / opacity 可以只走合成。",
    nodes: [
      { label: "HTML → DOM", tone: "muted" },
      { label: "CSS → CSSOM", tone: "muted" },
      { label: "Style 样式计算", note: "匹配选择器、算出层叠值", tone: "primary" },
      { label: "Layout 布局", note: "算位置与大小（重排起点）", tone: "warning" },
      { label: "Paint 绘制", note: "生成绘制指令（重绘起点）", tone: "warning" },
      { label: "Composite 合成", note: "GPU 分层合成，输出像素", tone: "success" },
    ],
    steps: [
      "按「跳过多少阶段」判断优化收益：几何 > 绘制 > 合成，所以动画优先用 transform 与 opacity。",
      "读写交替会强制同步布局：先读 offsetHeight 再写样式，浏览器必须立刻把布局算完才能回答你。",
      "合成层不是越多越好，层数暴涨会吃显存并拖慢首次合成。",
    ],
    note: "CSS 阻塞渲染、JS 阻塞解析 —— 这两件事发生在流水线之前，别和重排重绘混为一谈。",
  },

  // ── 网络与安全 ────────────────────────────────────────────────
  {
    id: "dg-http-cache",
    kind: "flow",
    title: "HTTP 缓存决策：先强缓存，再协商缓存",
    caption: "强缓存命中连请求都不发；协商缓存发请求但可能只回 304。",
    nodes: [
      { label: "发起请求", tone: "muted" },
      { label: "强缓存未过期？", note: "Cache-Control / Expires", tone: "primary" },
      { label: "读本地副本", note: "0 请求，最快", tone: "success" },
      { label: "已过期，带校验头", note: "If-None-Match / If-Modified-Since", tone: "warning" },
      { label: "304 未变更", note: "继续用副本，只省带宽", tone: "success" },
      { label: "200 有变更", note: "用新响应覆盖缓存", tone: "primary" },
    ],
    steps: [
      "Cache-Control: no-cache 不是「不缓存」，而是「每次都要协商」；no-store 才是真的不存。",
      "ETag 走内容指纹更精确，Last-Modified 只有秒级精度且可能误判，两者同时存在时 ETag 优先。",
      "入口 HTML 用 no-cache + 静态资源用 immutable，是「发版即生效且不浪费带宽」的组合。",
    ],
    note: "304 省的是响应体带宽，不省往返 —— 能强缓存就别只做协商缓存。",
  },
  {
    id: "dg-tcp-handshake",
    kind: "timeline",
    title: "TCP 三次握手：双方各确认一次收发能力",
    caption: "两次不够，四次多余 —— 三次刚好让双方都确认「我能发、你能收」并且同步序列号。",
    events: [
      { title: "① 客户端 → 服务端：SYN", detail: "seq=x，客户端进入 SYN_SENT" },
      { title: "② 服务端 → 客户端：SYN + ACK", detail: "seq=y, ack=x+1，服务端进入 SYN_RCVD" },
      { title: "③ 客户端 → 服务端：ACK", detail: "ack=y+1，双方进入 ESTABLISHED" },
      { title: "④ 开始传数据", detail: "此后每个包都带序列号，用于排序与重传" },
      { title: "断开要四次", detail: "全双工，两个方向各关一次；主动关闭方进 TIME_WAIT" },
    ],
    steps: [
      "为什么不是两次：只有两次时服务端无法确认「客户端能收到我的包」，历史连接的重传 SYN 会造成错误建连。",
      "TIME_WAIT 等 2MSL 是为了让对面重传的 FIN 还能被正确应答，同时让旧连接的残余包在网络里消散。",
      "SYN 队列与 accept 队列分开，SYN flood 打满的是前者，应用层看到的是「连上了但 accept 不到」。",
    ],
  },

  // ── 跨端 ──────────────────────────────────────────────────────
  {
    id: "dg-electron-arch",
    kind: "layers",
    title: "Electron 进程架构：能力越强的一层，暴露得越少",
    caption: "渲染进程只管画，preload 只挑几个接口挂出去，系统能力全部留在主进程。",
    layers: [
      {
        label: "渲染进程 × N（Chromium）",
        note: "一个窗口一个进程，跑页面、只负责 UI",
        tags: ["React / Vue", "无 Node 权限", "可崩溃隔离"],
      },
      {
        label: "preload（桥）",
        note: "唯一同时握有两侧能力的环境，只做「挂窄接口」这一件事",
        tags: ["contextBridge", "contextIsolation", "窄接口"],
      },
      {
        label: "IPC 通道",
        note: "invoke/handle 是请求响应，send/on 是单向广播；通道名即契约",
        tags: ["白名单", "序列化", "Promise"],
      },
      {
        label: "主进程（Node）",
        note: "窗口生命周期 + 所有系统能力，是整个应用唯一的「家长」",
        tags: ["文件", "shell", "原生模块"],
      },
    ],
    steps: [
      "安全基线三件套：sandbox + contextIsolation + 关闭 nodeIntegration；缺一项，页面脚本就能顺着原型链摸到 Node。",
      "通道名要在主进程、preload 白名单、渲染层类型声明三处一致，少一处就是「调用静默失败」。",
    ],
    note: "不要给页面暴露 ipcRenderer 本身，那等于把「能调任何通道」一起交出去。",
  },
  {
    id: "dg-miniprogram-thread",
    kind: "compare",
    title: "小程序双线程：逻辑层与渲染层靠 setData 通信",
    caption: "逻辑跑在 JSCore、视图跑在 WebView，两边不共享内存，所有同步都要序列化。",
    left: {
      title: "逻辑层（JSCore / V8）",
      note: "跑业务 JS，没有 DOM 与 BOM",
      items: [
        "不能直接操作 DOM，只能改数据",
        "setData 是异步的，回调才知道渲染完成",
        "一次 setData 数据量过大会明显卡顿",
        "生命周期与页面栈在这一侧管理",
      ],
    },
    right: {
      title: "渲染层（WebView）",
      note: "负责 WXML / WXSS 的实际绘制",
      items: [
        "只认 setData 推过来的数据",
        "事件先到逻辑层再处理，跨线程有延迟",
        "WXS 可以在视图层直接跑，绕开一次通信",
        "长列表要用自定义组件 + 分页渲染",
      ],
    },
    steps: [
      "双线程的收益是「逻辑卡住不直接卡死渲染」，代价是每次通信都要跨线程序列化。",
      "优化 setData 的三条：只传变化的字段（用路径写法）、合并调用、控制单次数据量。",
    ],
  },

  // ── 算法与手写 ────────────────────────────────────────────────
  {
    id: "dg-quicksort",
    kind: "timeline",
    title: "快速排序：选基准 → 分区 → 递归两段",
    caption: "每轮只做一件事：把基准放到它最终的位置上，左边全小、右边全大。",
    events: [
      { title: "选基准", detail: "取末位 6：[3,1,4,1,5,9,2,6]" },
      { title: "分区扫描", detail: "小于 6 的换到左侧：[3,1,4,1,5,2 | 6 | 9]" },
      { title: "基准归位", detail: "6 落到最终下标，左段全 ≤ 6、右段全 ≥ 6" },
      { title: "递归左段", detail: "[3,1,4,1,5,2] 重复选基准与分区" },
      { title: "递归右段", detail: "[9] 只剩一个元素，直接返回" },
      { title: "原地完成", detail: "全程不申请额外数组，只交换" },
    ],
    steps: [
      "分区用双指针：i 指向「已确认小于基准」的边界，j 从头扫，遇到小的就 swap(++i, j)，最后把基准换到 i+1。",
      "平均 O(n log n)（每次大致二分），最坏 O(n²)（已排序且固定取末位基准，每次只切掉一个）。",
      "工程上取「随机基准」或「三数取中」把最坏情况压回去；小数组（<10）切换插入排序更快。",
    ],
    note: "快排不稳定：分区时的远距离交换会打乱相等元素的相对顺序。",
  },
  {
    id: "dg-mergesort",
    kind: "timeline",
    title: "归并排序：一路拆到单元素，再两两合并",
    caption: "分治的教科书形态：拆分不费劲，真正的活全在合并。",
    events: [
      { title: "拆分", detail: "[5,2,8,1] → [5,2] [8,1]" },
      { title: "拆到单元素", detail: "[5] [2] [8] [1]" },
      { title: "两两合并", detail: "[2,5] 与 [1,8]，每次取两段头部较小的" },
      { title: "合并到底", detail: "[1,2,5,8]" },
      { title: "稳定性", detail: "相等时优先取左段，顺序天然保持" },
    ],
    steps: [
      "合并两个有序数组只需双指针 O(n)，整个算法复杂度由递归深度 log n 决定，共 O(n log n)。",
      "代价是 O(n) 辅助空间；链表排序反而更适合归并，因为合并不需要额外数组。",
      "「相等取左」这一行决定了它稳定，改成取右就不稳定了。",
    ],
    note: "归并的复杂度与数据初始顺序无关，快排最坏会退化 —— 需要稳定或可预测时选归并。",
  },
  {
    id: "dg-binary-search",
    kind: "timeline",
    title: "二分查找：每次砍掉一半，四步收敛",
    caption: "循环不变量是「答案一定在 [left, right] 里」，所有边界写法都围绕它。",
    events: [
      { title: "初始化", detail: "left = 0, right = n - 1（左闭右闭）" },
      { title: "取中点", detail: "mid = left + ((right - left) >> 1)，避免相加溢出" },
      { title: "命中", detail: "nums[mid] === target，直接返回 mid" },
      { title: "缩小范围", detail: "target 更大 → left = mid + 1；更小 → right = mid - 1" },
      { title: "结束", detail: "left > right 说明区间空了，返回 -1" },
    ],
    steps: [
      "左闭右闭配 `left <= right` 与 `mid ± 1`；左闭右开配 `left < right` 与 `right = mid`，两套不能混。",
      "求「第一个 ≥ target 的位置」时不要提前返回：命中后把 right 压到 mid，继续往左找。",
      "二分的本质是「答案具有单调性」，不限于有序数组 —— 「最小可行容量」这类题也是二分。",
    ],
    note: "(left + right) / 2 在超大下标下会溢出，写成 left + (right - left) / 2 是硬要求。",
  },
  {
    id: "dg-sliding-window",
    kind: "timeline",
    title: "滑动窗口：右端扩张、左端收缩，两个指针都不回头",
    caption: "窗口是一段连续区间，扩张负责「找可行解」，收缩负责「找最优解」。",
    events: [
      { title: "初始窗口", detail: "left = right = 0，窗口为空" },
      { title: "右端扩张", detail: "把 nums[right] 纳入窗口，更新统计量" },
      { title: "收缩条件", detail: "窗口不满足约束时，不断移出 nums[left] 直到重新满足" },
      { title: "更新答案", detail: "每次扩张（或收缩结束）后用当前窗口长度更新最优解" },
      { title: "结束", detail: "right 走到末尾，答案已覆盖所有可行窗口" },
    ],
    steps: [
      "模板固定为两层循环：外层移动 right，内层 while 移动 left，两个指针都只前进，所以总复杂度 O(n)。",
      "「不满足约束」要写成可判定的条件（计数、和、去重表大小），否则收缩时机说不清。",
      "只适用于连续子数组 / 子串；子序列类问题用不了窗口，得换 DP 或贪心。",
    ],
  },
  {
    id: "dg-lis",
    kind: "timeline",
    title: "最长递增子序列：贪心 + 二分维护 tails",
    caption: "tails[i] 表示「长度为 i+1 的递增子序列，最小可能的结尾值」。",
    events: [
      { title: "10", detail: "tails = [10]" },
      { title: "9", detail: "替换 10 → [9]（同样长度下结尾更小，更有前途）" },
      { title: "2", detail: "替换 9 → [2]" },
      { title: "5", detail: "比 2 大，追加 → [2,5]" },
      { title: "3", detail: "替换 5 → [2,3]" },
      { title: "7", detail: "追加 → [2,3,7]" },
      { title: "101 → 18", detail: "最终 tails = [2,3,7,18]，长度为 4" },
    ],
    steps: [
      "每来一个数 x，二分找 tails 中第一个 ≥ x 的位置并替换它；找不到就追加到末尾。",
      "替换而不是插入，是因为「结尾更小」在后续更容易接上更多元素 —— 贪心成立的关键。",
      "tails 的长度就是答案，但 tails 本身**不是**那个子序列；要还原具体下标还得额外记录前驱。",
    ],
    note: "Vue 3 用它标记「不用移动」的节点，用的是下标数组版本，同样 O(n log n)。",
  },
  {
    id: "dg-promise-state",
    kind: "flow",
    title: "手写 Promise：一个不可逆的状态机 + 一条 then 链",
    caption: "pending 只能单向走到 fulfilled / rejected，then 每次都返回一个新 Promise。",
    nodes: [
      { label: "pending", note: "初始态，回调先存进队列", tone: "muted" },
      { label: "resolve(value)", note: "落定，不可逆", tone: "success" },
      { label: "reject(reason)", note: "落定，不可逆", tone: "danger" },
      { label: "fulfilled", note: "把 value 交给 then 回调", tone: "success" },
      { label: "rejected", note: "找最近的 catch / 第二个回调", tone: "danger" },
      { label: "then 返回新 Promise", note: "值穿透、链式继续", tone: "primary" },
    ],
    steps: [
      "状态只能改一次：第二次调用 resolve / reject 必须被忽略，否则 then 会拿到两个结果。",
      "then 的回调要进微任务（queueMicrotask），不能同步执行 —— 这是 then 链顺序的根源。",
      "then 里返回普通值 → 新 Promise fulfilled；返回 Promise → 等它落定；抛错 → 新 Promise rejected。",
      "resolve 一个 thenable 要「等它落定」，所以 resolve(pendingPromise) 不会立刻 fulfilled。",
    ],
    note: "手写版最容易错的两处：忘了处理「回调注册晚于落定」的补发，以及循环引用（then 返回自己）没抛 TypeError。",
  },
  {
    id: "dg-lru",
    kind: "compare",
    title: "LRU 的两种实现：Map 版十行，链表版更可控",
    caption: "核心都是「命中即刷新为最新」，差别只在用什么结构维护顺序。",
    left: {
      title: "Map 版（推荐手写用）",
      note: "依赖 Map 的插入顺序语义，代码十行以内",
      items: [
        "get 命中后 delete + set，把它挪到末尾",
        "put 超容量时删掉 keys().next() 的第一个键",
        "O(1) 完成定位、刷新、淘汰",
        "局限：拿不到「倒数第二个」这类位置操作",
      ],
    },
    right: {
      title: "哈希 + 双向链表（教科书版）",
      note: "哈希定位节点，链表维护冷热顺序",
      items: [
        "头插：命中或新写入都插到头部",
        "淘汰：删尾节点（最久未使用）",
        "哨兵头尾消除所有空指针判断",
        "O(1) 完成，且能任意位置增删",
      ],
    },
    steps: [
      "先讲清「为什么需要 O(1)」：容量大时线性查找会让缓存本身成为瓶颈。",
      "Map 版的关键一句是「delete 再 set 才算刷新」，只 set 不会移动位置。",
    ],
    note: "put 已存在的 key 也必须刷新顺序，漏这一步会退化成 FIFO。",
  },
  {
    id: "dg-debounce-throttle",
    kind: "compare",
    title: "防抖 vs 节流：一个是「等停」，一个是「按拍」",
    caption: "同样连续触发 5 次，防抖只执行 1 次，节流按固定节奏执行多次。",
    left: {
      title: "防抖 Debounce",
      note: "停止触发 wait 毫秒后才执行",
      items: [
        "每次触发都清掉上一个计时器",
        "适合搜索联想、表单校验、resize 后重算",
        "immediate 版：首触发立即执行，随后静默",
        "必须提供 cancel，组件卸载时要清掉",
      ],
    },
    right: {
      title: "节流 Throttle",
      note: "每个时间窗口内最多执行一次",
      items: [
        "时间戳版：首触发立即执行，无尾调用",
        "定时器版：有尾调用，但首触发会延迟",
        "适合滚动监听、拖拽、埋点上报",
        "合并两版才能兼得首尾调用",
      ],
    },
    steps: [
      "判断用哪个：只关心「最终结果」用防抖，过程中也要有反馈用节流。",
      "两者都要保留最后一次调用的 this 与参数，否则事件对象被回收后会读到 undefined。",
    ],
  },
  {
    id: "dg-btree",
    kind: "layers",
    title: "B+ 树索引：三层就能装下千万级数据",
    caption: "非叶节点只存键、叶子节点存数据并串成链表 —— 高度低、范围查询快。",
    layers: [
      {
        label: "根节点（常驻内存）",
        note: "一次查询的起点，通常被缓冲池缓存，几乎不产生磁盘 I/O",
        tags: ["1 次内存读"],
      },
      {
        label: "中间节点",
        note: "只存键与子页指针，一页能放几百个键，所以扇出极大",
        tags: ["1 次磁盘 I/O"],
      },
      {
        label: "叶子节点",
        note: "存真实数据（聚簇索引）或主键（二级索引），页之间用双向链表相连",
        tags: ["1 次磁盘 I/O", "范围扫描"],
      },
    ],
    steps: [
      "扇出大 → 高度低 → I/O 少：三层 B+ 树可存千万行，而三层二叉树只有 7 个节点。",
      "叶子链表让 between / order by 可以直接顺序扫，不必回到根节点。",
      "区分度低的列建索引意义不大：回表次数和全表扫描差不多，还多了维护成本。",
    ],
    note: "二级索引查非索引列必须回表：先查二级索引拿主键，再按主键查聚簇索引。",
  },
];

/** id → 图，供题库与知识体系按 id 引用 */
export const DIAGRAM_BY_ID: Readonly<Record<string, InterviewDiagram>> = Object.freeze(
  Object.fromEntries(DIAGRAMS.map((diagram) => [diagram.id, diagram])),
);

/** 按 id 取图；找不到返回 undefined，调用方负责不渲染 */
export function diagramById(id: string): InterviewDiagram | undefined {
  return DIAGRAM_BY_ID[id];
}
