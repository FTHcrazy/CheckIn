/**
 * 题库 · AI 辅助开发与新趋势。
 *
 * 这一块的答案要避免空泛表态：讲清「具体场景 + 判断依据 + 风险」，
 * 并且对 2025-2026 的新概念（RAG / Agent / MCP）给出工程视角的解释。
 */
import type { InterviewQuestion } from "./interview-types";

export const SEED_AI: readonly InterviewQuestion[] = [
  {
    id: "ai-coding-assistant",
    title: "如何正确使用 AI 编码助手",
    stem: "Copilot / Cursor 这类工具在你的工作流里应该承担什么角色？风险在哪？",
    answer: `- 稳定的收益场景：样板代码与 CRUD、脚手架与配置文件、样式还原、单测补全、看懂陌生代码、报错信息的第一轮解释。
- 不适合直接采信的场景：跨模块架构决策、性能归因、涉及数据一致性与权限的逻辑、以及任何「看起来对但没有验证」的代码。
- 使用纪律：**小步生成 + 立刻验证**（跑类型检查与测试）、把约束写进上下文（约定、类型、既有工具函数）、不把密钥与生产数据贴进对话。
- 风险：训练数据带来的过时 API（旧版本写法）、看似合理但不存在的库/参数、许可证不清晰的代码片段、以及长期不用脑导致的调试能力退化。
- 团队层面：把 AI 生成的代码纳入同样的 review 与测试标准，而不是「AI 写的就宽松一点」。`,
    track: "foundation",
    categoryId: "foundation-ai",
    difficulty: "medium",
    tags: ["AI", "2026", "工作流"],
    topic: "AI 辅助开发 · 编码助手",
    reviewedAt: "2026-11",
    heat: 80,
    updatedAt: "2026-10-31",
  },
  {
    id: "ai-rag",
    title: "RAG 的原理与落地要点",
    stem: "如果要在产品里做一个「基于文档的问答」，RAG 的关键环节有哪些？前端要做什么？",
    answer: `- 链路：**文档切分（chunk）→ 向量化（embedding）→ 存储（向量库）→ 检索（相似度 + 关键词混合）→ 重排 → 拼 prompt → 生成**。
- 效果瓶颈通常在**检索质量**而不是模型：切分粒度（语义完整 vs 长度）、元数据过滤、混合检索（BM25 + 向量）、以及 rerank。
- 前端要做的事：流式输出（SSE/fetch stream）、引用来源展示（可点击定位原文）、加载与失败态、长对话的上下文裁剪、以及反馈入口。
- 关键工程问题：文档更新的增量索引、权限过滤（不同用户检索范围不同）、以及**幻觉兜底**（无检索命中就明确说不知道）。
- 评估：不要只看「回答像不像」，要建小规模标注集衡量召回率与答案正确率。`,
    track: "foundation",
    categoryId: "foundation-ai",
    difficulty: "medium",
    tags: ["AI", "RAG", "2025"],
    topic: "AI 应用 · RAG",
    reviewedAt: "2026-11",
    heat: 74,
    updatedAt: "2026-10-28",
  },
  {
    id: "ai-agent-mcp",
    title: "Agent 与 MCP 是什么",
    stem: "解释 Agent 的工作循环，以及 MCP 想解决什么问题。",
    answer: `- Agent = **LLM + 工具 + 循环**：模型根据目标规划步骤、调用工具（搜索、读写文件、执行命令）、观察结果、再决定下一步，直到完成或达到停止条件。
- 与「一次问答」的差别在于**多轮决策与外部副作用**，因此工程上必须解决：工具权限最小化、执行沙箱、步数/成本上限、失败重试与人工确认。
- **MCP（Model Context Protocol）** 是模型与外部工具/数据源之间的标准化协议：把「每个 AI 应用各写一套插件」变成「工具提供方实现一次 MCP Server，所有客户端复用」。
- 对前端的意义：AI 应用开始需要管理连接、权限与工具调用状态的 UI（工具调用进度、确认对话框、失败重试），这是一块新的界面复杂度。
- 风险点：提示注入（工具返回内容里藏指令）、越权操作、以及难以复现的调试成本。`,
    track: "foundation",
    categoryId: "foundation-ai",
    difficulty: "hard",
    tags: ["AI", "Agent", "MCP"],
    topic: "AI 应用 · Agent 与 MCP",
    reviewedAt: "2026-11",
    heat: 72,
    updatedAt: "2026-11-03",
  },
  {
    id: "ai-prompt-engineering",
    title: "Prompt 工程的实用要点",
    stem: "让模型稳定输出结构化结果，你会怎么写 prompt？",
    answer: `- 结构：**角色与目标 → 输入 → 约束（格式、长度、禁止项）→ 示例 → 输出格式**；把最重要的约束放前面和最后，中间容易「被遗忘」。
- 结构化输出优先用 **JSON Schema / 函数调用**等机制约束，而不是靠 prompt 里写「请返回 JSON」，后者失败率高。
- 提供 1-2 个示例（few-shot）比长篇描述更有效；few-shot 的示例要覆盖边界情况。
- 稳定性手段：温度调低、明确「不知道就说不知道」、把长任务拆成多步、对输出做程序化校验并重试。
- 可维护性：prompt 也是代码 —— 纳入版本管理、有回归用例（输入 → 期望输出要点），否则改一个词就可能全盘变差。`,
    track: "foundation",
    categoryId: "foundation-ai",
    difficulty: "basic",
    tags: ["AI", "Prompt", "基础"],
    topic: "AI 应用 · Prompt 工程",
    reviewedAt: "2026-11",
    heat: 68,
    updatedAt: "2026-10-28",
  },
  {
    id: "ai-code-review-boundary",
    title: "AI 代码审查能替代人工 Review 吗",
    stem: "把 AI 加进 code review 流程，它能挡住什么、挡不住什么？",
    answer: `- 能挡住：明显的空指针/未处理异常、命名与重复代码、缺失的边界判断、风格与规范偏差、以及「这段逻辑与注释不符」这类机械比对。
- 挡不住：**需求是否被正确理解**、架构取舍、跨模块的隐性耦合、性能与数据一致性的深层问题、以及「这段代码该不该存在」。
- 用法建议：让 AI 做第一轮（把低级问题清掉），人工专注设计与风险；把团队的规范写成可复用的 review 规则，减少重复提示。
- 风险：AI 可能「为了显得有用」而提出错误建议，因此每条建议都要能被验证（写个测试或查文档），不能盲从。
- 组织层面：review 的责任仍在人 —— 出了问题不能说「AI 通过了」。`,
    track: "foundation",
    categoryId: "foundation-ai",
    difficulty: "medium",
    tags: ["AI", "Code Review", "2026"],
    topic: "AI 辅助开发 · 代码审查",
    reviewedAt: "2026-11",
    heat: 66,
    updatedAt: "2026-10-27",
  },
  {
    id: "ai-frontend-trend-2026",
    title: "2026 年前端的技术趋势",
    stem: "除了框架版本号，你认为哪些变化会真实影响日常开发？",
    answer: `- **构建与工具链 Rust 化**：Rolldown / Oxc / Biome 把构建与 lint 提速一个数量级，Vite 的开发与生产构建器逐步统一。
- **运行时多元化**：Bun / Deno 在脚本与边缘函数场景替代部分 Node 用法，Node 自身也在补齐 ESM 与权限模型。
- **渲染模式融合**：RSC、Streaming SSR、Islands 与 CSR 在同一项目里按路由选择，前端开始承担「数据获取位置」的决策。
- **AI 成为默认协作方**：接口按「便于模型消费」设计（结构化输出、明确错误码），MCP 类协议让工具生态标准化。
- **跨端与新平台**：鸿蒙 ArkTS 带来新的目标平台，小程序 Skyline 提升性能上限；这些都会反过来影响组件库与工程模板的设计。
- 判断趋势的方法：看「是否降低了某类重复劳动的边际成本」，而不是看 star 数。`,
    track: "foundation",
    categoryId: "foundation-ai",
    difficulty: "basic",
    tags: ["趋势", "2026", "工程化"],
    topic: "前端技术趋势",
    reviewedAt: "2026-11",
    heat: 70,
    updatedAt: "2026-10-31",
  },
];
