/**
 * 题库 · HTML 与 CSS。
 *
 * 两块的共同点是「看起来基础、追问很深」：语义化、层叠上下文、
 * 合成层与动画性能都是高频高级题。
 */
import type { InterviewQuestion } from "./interview-types";

export const SEED_HTML_CSS: readonly InterviewQuestion[] = [
  // ── HTML ───────────────────────────────────────────────────
  {
    id: "html-semantic",
    title: "语义化标签解决了什么问题？",
    stem: "说说 header / nav / main / article / section 各自的使用场景，以及语义化带来的实际收益。",
    answer: `- 收益是三方面的：**可访问性**（读屏软件按地标导航）、**SEO**（爬虫能识别正文与导航）、**可维护性**（结构自解释，减少 class 命名）。
- 使用要点：\`main\` 每页只能有一个；\`article\` 表示可独立分发的内容；\`section\` 需带标题，纯粹为了布局的容器用 \`div\`。
- 不要为了语义而语义：\`div\` 在无更合适元素时是正确选择，反例是给布局包裹层硬套 \`section\`。
- 常见追问：\`<b>\` 与 \`<strong>\`（样式 vs 强调）、\`<i>\` 与 \`<em>\`、\`<figure>/<figcaption>\` 的配对关系。`,
    track: "foundation",
    categoryId: "foundation-html",
    difficulty: "basic",
    tags: ["基础", "HTML", "可访问性"],
    topic: "HTML 语义化",
    reviewedAt: "2026-11",
    heat: 62,
    updatedAt: "2026-10-31",
  },
  {
    id: "html-doctype",
    title: "DOCTYPE 的作用与怪异模式",
    stem: "为什么第一行必须写 <!DOCTYPE html>？缺失时浏览器会发生什么？",
    answer: `- DOCTYPE 声明文档类型，让浏览器以**标准模式（standards mode）**渲染；缺失或写错会进入**怪异模式（quirks mode）**。
- 怪异模式的差异主要在**盒模型**（width 含 padding 与 border）、行高计算、百分比高度解析、以及部分元素的行内块默认样式。
- HTML5 只保留 \`<!DOCTYPE html>\` 这一种写法，长度已不是问题，写全是为了不触发兼容分支。
- 排查技巧：\`document.compatMode\` 返回 \`CSS1Compat\`（标准）或 \`BackCompat\`（怪异）。`,
    track: "foundation",
    categoryId: "foundation-html",
    difficulty: "basic",
    tags: ["基础", "HTML", "浏览器"],
    topic: "HTML 文档模式",
    reviewedAt: "2026-11",
    heat: 50,
    updatedAt: "2026-11-16",
  },
  {
    id: "html-script-loading",
    title: "script 的 async、defer 与 type=module 有何区别",
    stem: "三种脚本加载方式分别什么时候下载、什么时候执行、是否保证顺序？",
    answer: `- **普通脚本**：下载与执行都阻塞 HTML 解析，放在 body 末尾是最原始的优化。
- **defer**：并行下载，**解析完成后、DOMContentLoaded 之前**按顺序执行，适合有依赖关系的业务脚本。
- **async**：并行下载，**下载完立刻执行**，顺序不保证，适合独立统计脚本。
- **type="module"** 默认就是 defer 语义，且作用域独立、自动严格模式、需要 CORS。
- 追问：\`DOMContentLoaded\` 等 defer 脚本全部执行完才触发；\`load\` 还要等图片等资源。`,
    track: "foundation",
    categoryId: "foundation-html",
    difficulty: "medium",
    tags: ["高频", "浏览器", "HTML"],
    topic: "HTML 资源加载",
    reviewedAt: "2026-11",
    heat: 84,
    updatedAt: "2026-11-12",
  },
  {
    id: "html-img-srcset",
    title: "响应式图片：srcset、sizes 与 picture 怎么配合",
    stem: "如何让同一张图在 1x/2x 屏与不同宽度下都取到合适的资源？",
    answer: `- **分辨率切换**：\`srcset="a.png 1x, a@2x.png 2x"\`，浏览器按 DPR 选；配合 \`sizes\` 描述布局宽度可进一步降低下载量。
- **艺术方向**（不同裁切/不同图）：用 \`<picture>\` + \`<source media="...">\`，最后的 \`<img>\` 是必需的兜底与可访问性来源。
- 新格式优先：\`<source type="image/avif">\` → \`webp\` → \`img\` 的降级链，浏览器会自动选第一个支持的。
- 配合 \`loading="lazy"\`（首屏图不要加）、\`decoding="async"\`、以及显式 \`width/height\` 防布局抖动（CLS）。`,
    track: "foundation",
    categoryId: "foundation-html",
    difficulty: "medium",
    tags: ["性能", "HTML"],
    topic: "HTML 响应式图片",
    reviewedAt: "2026-11",
    heat: 64,
    updatedAt: "2026-10-25",
  },
  {
    id: "html-form-a11y",
    title: "表单可访问性要注意什么",
    stem: "label、aria-*、错误提示与键盘操作，分别怎么做才不算「只是看起来能用」？",
    answer: `- **每个控件都要有可访问名称**：\`<label for>\` 优于 \`placeholder\`（占位符输入后消失，读屏也不稳定）；无可见标签时用 \`aria-label\`。
- **错误要与字段关联**：\`aria-invalid\` + \`aria-describedby\` 指向错误文本节点，否则读屏用户不知道哪一项错了。
- **分组用 fieldset/legend**，单选组用 \`role="radiogroup"\`，避免一堆孤立 input。
- **键盘**：Tab 顺序与视觉顺序一致，自定义控件补 \`role\`、\`tabindex="0"\`、Enter/Space 事件；\`:focus-visible\` 不能被 reset 掉。
- 用组件库（antd）时这些大多已内置，但自定义浮层控件仍需自己补。`,
    track: "foundation",
    categoryId: "foundation-html",
    difficulty: "medium",
    tags: ["可访问性", "HTML"],
    topic: "HTML 表单与 ARIA",
    reviewedAt: "2026-11",
    heat: 58,
    updatedAt: "2026-11-09",
  },
  {
    id: "html-storage-compare",
    title: "Cookie、localStorage、sessionStorage、IndexedDB 怎么选",
    stem: "从容量、生命周期、作用域与是否随请求发送四个维度比较。",
    answer: `- **Cookie**：约 4KB，可设过期时间，同源共享且**每次请求自动携带**（HTTP-only 可防 XSS 读取），适合存会话标识。
- **localStorage**：约 5MB，永久（同源同浏览器），同步 API 会阻塞主线程，适合存非敏感偏好与缓存的 JSON。
- **sessionStorage**：同上但仅当前标签页，刷新保留、关闭即清，适合表单草稿与单次流程状态。
- **IndexedDB**：容量按磁盘配额（数百 MB 起），异步、支持索引与事务，适合离线数据、大文件二进制。
- 选择口诀：**要发送给服务端 → Cookie；大而结构化 → IndexedDB；其余按生命周期选 local / session**。`,
    track: "foundation",
    categoryId: "foundation-html",
    difficulty: "medium",
    tags: ["高频", "浏览器", "存储"],
    topic: "浏览器存储",
    reviewedAt: "2026-11",
    heat: 80,
    updatedAt: "2026-10-26",
  },

  // ── CSS ────────────────────────────────────────────────────
  {
    id: "css-box-model",
    title: "标准盒模型与 IE 盒模型",
    stem: "box-sizing 的两个取值分别如何计算宽高？为什么现代项目通常全局设为 border-box？",
    answer: `- **content-box**（默认）：\`width\` 只含内容区，实际占位 = width + padding + border。
- **border-box**：\`width\` 含 padding 与 border，内容区被反向压缩；布局时设 \`width: 100%\` 不会因为 padding 而溢出。
- 全局 \`*, *::before, *::after { box-sizing: border-box }\` 已是事实标准，代价是写「精确内容宽度」时要自己减掉 padding。
- 追问：\`margin\` 从不计入宽度；\`outline\` 不占布局（所以焦点环不影响排版）；替换元素（img）的 content 区由内容决定。`,
    track: "foundation",
    categoryId: "foundation-css",
    difficulty: "basic",
    tags: ["基础", "CSS", "高频"],
    topic: "CSS 盒模型",
    reviewedAt: "2026-11",
    heat: 78,
    updatedAt: "2026-11-11",
  },
  {
    id: "css-bfc",
    title: "BFC 是什么？能解决哪些实际问题",
    stem: "说明 BFC 的触发条件，以及它在高度塌陷、外边距折叠、浮动环绕中的应用。",
    answer: `- BFC（块级格式化上下文）是一块**独立布局的区域**，内部元素不会影响外部，外部也不会影响内部。
- 触发方式：\`overflow\` 非 visible、\`display: flow-root\`（推荐，无副作用）、\`float\`、绝对定位、\`contain: layout\`、flex/grid 子项等。
- 三个典型用途：**清除浮动导致的高度塌陷**、**阻止父子 / 兄弟 margin 折叠**、**阻止浮动元素文字环绕**（两栏自适应布局）。
- 优先用 \`display: flow-root\` 而不是 \`overflow: hidden\`——后者会裁掉溢出内容并可能产生滚动条。
- 相邻兄弟的外边距折叠取较大值而非相加，这是排版时「间距总比预期小」的常见原因。`,
    track: "foundation",
    categoryId: "foundation-css",
    difficulty: "medium",
    tags: ["高频", "CSS", "布局"],
    topic: "CSS 格式化上下文",
    reviewedAt: "2026-11",
    heat: 86,
    updatedAt: "2026-10-30",
  },
  {
    id: "css-flex-vs-grid",
    title: "Flex 与 Grid 各自适合什么场景",
    stem: "举两栏自适应、卡片网格、垂直居中三个例子，说明选型依据。",
    answer: `- **Flex 是一维**（一行或一列）内容驱动的布局，主轴对齐与伸缩能力强；**Grid 是二维**（行列同时定义），容器驱动的布局。
- 两栏自适应：Flex 更顺手，\`flex: 1\` 自动吃满剩余宽度，侧栏 \`flex: 0 0 240px\`。
- 卡片网格：Grid 更合适，\`grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))\` 一行搞定响应式列数。
- 垂直居中：两者都能做，Flex 的 \`align-items: center\` 更常见。
- 经验法则：**排列顺序与伸缩 → Flex；行列对齐与区域划分 → Grid**；混用很常见（Grid 定页面骨架，Flex 排内部元素）。`,
    track: "foundation",
    categoryId: "foundation-css",
    difficulty: "medium",
    tags: ["布局", "CSS", "高频"],
    topic: "CSS 布局",
    reviewedAt: "2026-11",
    heat: 75,
    updatedAt: "2026-11-08",
  },
  {
    id: "css-stacking-context",
    title: "层叠上下文与 z-index 失效的原因",
    stem: "为什么给子元素设了很大的 z-index 仍然被隔壁元素盖住？",
    answer: `- \`z-index\` 只在**同一层叠上下文内**比较；父级创建了新层叠上下文时，子元素的 z-index 再大也跳不出父级这一层。
- 创建层叠上下文的常见方式：根元素、\`position\` 非 static 且 z-index 非 auto、\`opacity < 1\`、\`transform\` / \`filter\` / \`will-change\` 非 none、\`isolation: isolate\`、flex/grid 子项且 z-index 非 auto。
- 排查顺序：从目标元素往上找第一个「创建了层叠上下文的祖先」，问题通常在那里。
- 也别忘了同层叠上下文内的比较顺序：**定位元素按 z-index，未定位元素在下方**，同值时按 DOM 顺序后者在上。`,
    track: "foundation",
    categoryId: "foundation-css",
    difficulty: "hard",
    tags: ["CSS", "原理", "大厂"],
    topic: "CSS 层叠与定位",
    reviewedAt: "2026-11",
    heat: 82,
    updatedAt: "2026-10-25",
  },
  {
    id: "css-specificity",
    title: "CSS 优先级计算与 @layer 的作用",
    stem: "说明优先级权重规则，以及 @layer 如何解决「优先级越写越高」的问题。",
    answer: `- 权重四元组：**行内样式 (1,0,0,0) > id (0,1,0,0) > class/属性/伪类 (0,0,1,0) > 元素/伪元素 (0,0,0,1)**；\`!important\` 单独一档。
- 通用选择器 \`*\` 与继承来的样式权重为 0；\`:not()\` 内的选择器参与计算。
- \`@layer\` 让**层与层之间的顺序由声明顺序决定**，层内再按常规优先级：先声明的层优先级更低。于是工具类 / reset 可以放低层，业务样式放高层，不需要靠堆选择器取胜。
- 现代项目更彻底的方案是 CSS Modules / CSS-in-JS 的作用域隔离，配合少量 \`:where()\`（权重恒为 0）做覆盖。`,
    track: "foundation",
    categoryId: "foundation-css",
    difficulty: "medium",
    tags: ["CSS", "工程化"],
    topic: "CSS 优先级与层",
    reviewedAt: "2026-11",
    heat: 66,
    updatedAt: "2026-10-21",
  },
  {
    id: "css-centering",
    title: "水平垂直居中的几种写法与取舍",
    stem: "列出至少四种居中方案，说明各自对宽高是否已知的要求。",
    answer: `- **Flex**：\`display:flex; align-items:center; justify-content:center\`，无需知道尺寸，最通用。
- **Grid**：\`display:grid; place-items:center\`，一行搞定，同样是尺寸无关。
- **绝对定位 + transform**：\`top:50%; left:50%; transform:translate(-50%,-50%)\`，尺寸无关但会脱离文档流。
- **绝对定位 + inset + margin auto**：\`inset:0; margin:auto\` 要求元素有确定宽高。
- **line-height / table-cell** 属于历史方案，只在单行文本等窄场景才用。
- 追问点：\`translate(-50%)\` 不会触发重排，但会让文字渲染在半像素上，注意 \`transform\` 子像素模糊。`,
    track: "foundation",
    categoryId: "foundation-css",
    difficulty: "basic",
    tags: ["基础", "CSS", "布局"],
    topic: "CSS 布局 · 居中",
    reviewedAt: "2026-11",
    heat: 60,
    updatedAt: "2026-11-05",
  },
  {
    id: "css-units",
    title: "px、em、rem、vw/vh、dvh 与 clamp 怎么选",
    stem: "移动端适配时单位如何搭配？dvh 解决了什么问题？",
    answer: `- \`em\` 相对**父元素字号**，嵌套会累积放大；\`rem\` 相对根字号，可控性更好，适合整体缩放。
- \`vw/vh\` 相对视口；\`vh\` 在移动端浏览器地址栏收起/展开时会导致抖动，**\`dvh\` 动态视口高度**才是全屏布局的正确选择。
- \`clamp(min, preferred, max)\` 一行实现流体排版，比写一堆媒体查询更好维护：\`font-size: clamp(14px, 1.2vw + 12px, 20px)\`。
- 移动端适配主流方案已从 rem + flexible 转向 **vw + postcss 单位转换**，或直接用 \`clamp\`；\`1px\` 细线用 \`transform: scaleY(0.5)\` 或 \`box-shadow\` 技巧处理。
- 字号下限仍建议守住 12px：小于它的正文在低分屏上不可读。`,
    track: "foundation",
    categoryId: "foundation-css",
    difficulty: "medium",
    tags: ["CSS", "移动端", "布局"],
    topic: "CSS 单位与适配",
    reviewedAt: "2026-11",
    heat: 72,
    updatedAt: "2026-11-03",
  },
  {
    id: "css-animation-compositor",
    title: "哪些属性做动画不卡？为什么",
    stem: "transform / opacity 动画为什么比 width / top 更流畅？will-change 该怎么用？",
    answer: `- 渲染管线分 **layout → paint → composite** 三段。改 \`width/height/top/left\` 触发 layout（重排），改 \`background/box-shadow\` 触发 paint，只有 \`transform\` / \`opacity\` / \`filter\` 能只在合成阶段完成。
- 合成阶段的操作在 GPU 上执行，不占主线程，所以 60fps 更容易保住；\`will-change: transform\` 会**提前提升为独立图层**，但滥用会撑爆显存并增加图层合并成本。
- 用 \`requestAnimationFrame\` 驱动或直接交给 CSS 过渡，避免在 \`setInterval\` 里改样式造成掉帧。
- \`will-change\` 应在动画开始前加上、结束后移除，不要常驻。
- 移动端还要注意 \`translate3d\` 的图层爆炸问题，以及大量 \`box-shadow\` 动画带来的绘制压力。`,
    track: "foundation",
    categoryId: "foundation-css",
    difficulty: "hard",
    tags: ["性能", "CSS", "大厂"],
    topic: "CSS 动画与合成层",
    reviewedAt: "2026-11",
    heat: 79,
    updatedAt: "2026-11-08",
  },
];
