/**
 * 题库 · Vibe Coding / AI 协作开发。
 *
 * 2025-2026 的面试已经从「你会不会用 Copilot」转向「你怎么让 AI 在真实仓库里
 * 稳定产出可维护的代码」。这一组题全部围绕工程约束，不讲玄学 prompt 技巧。
 */
import type { InterviewQuestion } from "./interview-types";

export const SEED_VIBE_CODING: readonly InterviewQuestion[] = [
  {
    id: "vibe-context-engineering",
    title: "上下文工程为什么比 prompt 技巧更重要",
    stem: "同一个模型，别人让它改三个文件就能一次过，你的它总是改错地方 —— 差别在哪？",
    answer: `- 模型不知道你仓库的约定，**它只能看到你给的东西**。上下文工程 = 决定「给什么、按什么顺序、以什么形式给」。
- 四类必需上下文：**目标**（要改成什么行为）、**边界**（只动哪些文件/不要动哪些）、**约定**（框架版本、目录规范、禁用 API、代码风格）、**验收**（类型检查/测试/命令）。
- 落地形态：把约定写成仓库内文件（\`AGENTS.md\` / \`CLAUDE.md\` / \`.cursor/rules\`），让工具自动携带；一次只给相关文件，而不是整个仓库。
- 反模式：一句话大需求（「帮我做个后台」）、贴半屏报错却不给复现路径、同时改十个文件、让模型猜框架版本。
- 判断标准：**换个模型也能复现的成功率**。如果你的 prompt 依赖某个模型的「悟性」，那不是工程方法。`,
    track: "foundation",
    categoryId: "foundation-ai",
    difficulty: "medium",
    tags: ["AI", "Vibe Coding", "2026", "高频"],
    topic: "AI 协作 · 上下文工程",
    reviewedAt: "2026-11",
    heat: 90,
    updatedAt: "2026-11-15",
  },
  {
    id: "vibe-spec-driven",
    title: "Spec-first：先出方案再让 AI 写代码",
    stem: "直接让 AI 写一个功能，出来一堆「能跑但没法维护」的代码。怎么用流程避免？",
    answer: `- 三段式：**计划（Plan）→ 执行（Act）→ 验证（Verify）**。计划阶段只产出文件清单、改动点、风险与验收标准，人确认后再执行。
- 计划要具体到「哪个文件、哪个函数、加什么字段」，抽象的计划会得到抽象的代码；计划本身也是一次设计评审。
- 执行阶段控制粒度：一次一个可验证的小步（先加类型，再加逻辑，再接 UI），每步都能跑测试。
- 验证阶段必须有**机器可判定的标准**：类型检查通过、指定测试通过、命令输出符合预期；「看起来对」不算。
- 收益：返工率下降、review 成本下降；代价是前期慢一点 —— 但比事后重构便宜。`,
    track: "foundation",
    categoryId: "foundation-ai",
    difficulty: "medium",
    tags: ["AI", "Vibe Coding", "流程", "2026"],
    topic: "AI 协作 · 规范驱动开发",
    reviewedAt: "2026-11",
    heat: 85,
    updatedAt: "2026-11-14",
  },
  {
    id: "vibe-verify-loop",
    title: "怎么让 AI「自证」代码是对的",
    stem: "AI 说「已经修复」，你怎么在 30 秒内判断它是不是在胡说？",
    answer: `- 要求它给出**可执行的证据**：命令 + 真实输出（类型检查退出码、测试通过数、实际运行结果），而不是「已完成」。
- 给它闭环工具：能跑 \`tsc\` / \`eslint\` / \`vitest\` / 启动脚本，让它自己看到红→绿；不能执行的环境里，AI 的「已验证」基本都是编的。
- 让验证独立：改代码的和验代码的分成两个角色（两个会话/两个人），验证方只看需求与产物，不看实现思路。
- 关键路径要**人肉复跑**一次：AI 可能只跑了单个测试文件，漏掉全局守卫（主题 token、文档索引、打包配置这类跨模块约束）。
- 心态：把 AI 当「很快但会自信犯错的初级工程师」，验证流程按这个假设设计。`,
    track: "foundation",
    categoryId: "foundation-ai",
    difficulty: "medium",
    tags: ["AI", "Vibe Coding", "测试", "2026"],
    topic: "AI 协作 · 验证闭环",
    reviewedAt: "2026-11",
    heat: 82,
    updatedAt: "2026-11-13",
  },
  {
    id: "vibe-tdd-with-ai",
    title: "用测试驱动 AI 写代码（TDD + Agent）",
    stem: "为什么说「先写失败的测试」是约束 AI 最有效的手段？具体怎么操作？",
    answer: `- 测试是**可执行的需求**：把「应该输出 1 4 3 2」写成断言，AI 就没法用「差不多对」的表述糊过去。
- 流程：人写（或人审）失败用例 → 让 AI 实现到绿 → 人检查实现是否只是「为了让测试过」而硬编码 → 重构 → 再跑。
- 防作弊：断言要覆盖边界（空值、异常、并发），并在实现后**追加**新用例；只跑原有测试无法发现「特例硬编码」。
- 快反馈降低幻觉：AI 每次改动都能立刻看到哪条用例红，比自己推理语义可靠得多。
- 不适用场景：UI 视觉、交互手感、性能体感 —— 这些仍要人看；测试只能钉住可判定的部分。`,
    track: "foundation",
    categoryId: "foundation-ai",
    difficulty: "hard",
    tags: ["AI", "Vibe Coding", "测试", "2026"],
    topic: "AI 协作 · 测试驱动",
    reviewedAt: "2026-11",
    heat: 76,
    updatedAt: "2026-11-12",
  },
  {
    id: "vibe-repo-for-ai",
    title: "什么样的代码库对 AI 友好",
    stem: "同一个模型在不同项目里表现差异巨大，从代码库结构角度说说原因。",
    answer: `- **可发现性**：命名一致、目录按领域分、一个文件一件事；AI 靠检索找代码，命名混乱就等于让它瞎猜。
- **显式约定**：类型定义完整（DTO、枚举用联合类型而不是 string）、常量集中、禁止的写法写在 lint 规则里 —— 规则化比文档化更可靠。
- **文件大小**：500 行以内、单一职责，AI 才能一次读全；巨型组件会被截断，改哪里都靠猜。
- **可验证**：一条命令跑全部检查（\`pnpm check\`），AI 能自己闭环；没有测试的项目，AI 的改动无法被证伪。
- **文档即在仓库里**：\`AGENTS.md\` 写清命令、目录、禁区、提交规范；这比任何 prompt 模板都有效。`,
    track: "foundation",
    categoryId: "foundation-ai",
    difficulty: "medium",
    tags: ["AI", "Vibe Coding", "工程化", "2026"],
    topic: "AI 协作 · 代码库友好度",
    reviewedAt: "2026-11",
    heat: 74,
    updatedAt: "2026-11-11",
  },
  {
    id: "vibe-hallucination-api",
    title: "AI 幻觉在框架 API 上的表现与防御",
    stem: "AI 给你写了 `useEffectEvent` 说是 React 18 的 API、给了个不存在的 webpack 配置项，怎么系统防御？",
    answer: `- 高发区：**版本相关 API**（框架新特性、废弃 API）、**配置项名称**（构建工具、lint 规则）、**第三方库用法**（参数签名、返回结构）、**编造的数据/版本号**。
- 防御一：**锁版本 + 查官方文档**。让 AI 引用官方文档链接，或项目里放对应版本的文档摘要；凭记忆写的版本特性一律复核。
- 防御二：**让代码自己说话**。类型定义会立刻暴露不存在的 API；跑一次构建就能证伪配置项。
- 防御三：**限制修改面**。让它只改业务逻辑，不碰构建配置与依赖版本；这类改动必须人确认。
- 认知：幻觉不是「偶尔口误」，是模型在补全最可能的文本；越冷门的 API 越容易编，越常见的越可靠 —— 危险恰恰在于它说得很像真的。`,
    track: "foundation",
    categoryId: "foundation-ai",
    difficulty: "hard",
    tags: ["AI", "Vibe Coding", "风险", "2026"],
    topic: "AI 协作 · 幻觉防御",
    reviewedAt: "2026-11",
    heat: 78,
    updatedAt: "2026-11-10",
  },
  {
    id: "vibe-risk-boundary",
    title: "Vibe Coding 的工程风险清单",
    stem: "团队全量推行 AI 写代码，半年后可能出现哪些问题？你会提前定哪些红线？",
    answer: `- **可维护性**：AI 倾向重复造轮子、复制粘贴、过度抽象或过度扁平；同类逻辑在仓库里出现三份，改一处漏两处。
- **隐性复杂度**：能跑但没人理解的代码（复杂正则、魔法分支），出问题时无从下手；要求「非作者也能讲清」才能合并。
- **安全与合规**：密钥写进代码、拼接 SQL/命令、引入来源不明的依赖、许可证污染（GPL 代码进商业项目）、生成内容版权。
- **知识流失**：团队只会提需求不会设计，架构能力退化；核心模块必须有人能独立重写。
- **红线建议**：鉴权/支付/加密/数据迁移必须人工设计与 review；依赖与构建配置变更必须人工确认；AI 产出必须过类型、测试、lint 三道门；提交信息标注 AI 参与度便于回溯。
- 判断标准：**出故障时能不能在 30 分钟内定位到责任人理解的那部分代码**。`,
    track: "foundation",
    categoryId: "foundation-ai",
    difficulty: "hard",
    tags: ["AI", "Vibe Coding", "风险", "大厂"],
    topic: "AI 协作 · 风险与红线",
    reviewedAt: "2026-11",
    heat: 80,
    updatedAt: "2026-11-09",
  },
  {
    id: "vibe-team-workflow",
    title: "团队级 AI 协作规范怎么定",
    stem: "三个人用 AI 协作同一个仓库，怎么避免互相覆盖、review 失效？",
    answer: `- **提交粒度**：一次提交只做一件事（AI 很容易一口气改 20 个文件），便于 review 与 revert；大改动先拆任务单。
- **分支与锁**：AI 长时间任务用独立分支；避免两个会话同时改同一文件（并行编辑会丢更新）。
- **review 责任在人**：AI 不能批准自己的改动；reviewer 必须能解释每一处 diff 的意图，讲不清就退回。
- **共享约定**：把代码规范、命令、禁区写进仓库级 \`AGENTS.md\`，所有人和所有工具读同一份，减少「每人一套 prompt」。
- **度量**：跟踪 AI 产出的一次通过率、返工率、review 评论数；只统计「生成行数」会激励错误行为。
- 组织侧提醒：AI 提升的是**打字速度**，不是**决策质量**；需求拆解与架构判断仍要人来做。`,
    track: "foundation",
    categoryId: "foundation-ai",
    difficulty: "medium",
    tags: ["AI", "Vibe Coding", "协作", "2026"],
    topic: "AI 协作 · 团队规范",
    reviewedAt: "2026-11",
    heat: 72,
    updatedAt: "2026-11-08",
  },
];
