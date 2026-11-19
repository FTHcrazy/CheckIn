/**
 * 小说域（novel）的 Prompt 出口
 *
 * 一个域 = 一张「意图 → 组装函数」映射表 + 三张同键表（标签 / 版本 / 合法分级）。
 * 这里是小说域**唯一的登记处**：加一个小说意图 = 写一个 builder + 在本文件加一行。
 *
 * ⚠️ 所有 `Record<NovelPromptIntent, …>` 都是刻意收窄到域内的：写成全局
 * `PromptIntent` 会让「新增一个**别的**域」在本文件报「缺 N 个键」，
 * 于是加域永远要回来改小说文件（破坏 §8.3 判据 2「加域零侵入」）。
 */
import type { PromptDomainModule, PromptSpec } from "../../types";
import { assembleBranchSpec } from "./builders/branch";
import { assembleConsistencySpec } from "./builders/consistency";
import { assembleContinuationStreamSpec } from "./builders/continuation";
import { assembleExtractSpec } from "./builders/extract";
import { assembleLevelGenSpec } from "./builders/level-gen";
import { assembleNamingSpec } from "./builders/naming";
import { assemblePolishSpec } from "./builders/polish";
import { assembleRelationSpec } from "./builders/relation";
import { assembleSummarySpec } from "./builders/summary";
import { assembleTransformSpec } from "./builders/transform";
import type { AiBookContext, NovelPromptIntent, NovelPromptPayloadMap } from "./types";

/** 模板清单：意图 → 组装函数（类型上保证参数与该意图匹配；漏一个 = 编译错误） */
const NOVEL_BUILDERS: {
  [K in NovelPromptIntent]: (
    ctx: AiBookContext,
    payload: NovelPromptPayloadMap[K],
  ) => PromptSpec;
} = {
  naming: assembleNamingSpec,
  polish: assemblePolishSpec,
  transform: assembleTransformSpec,
  continuation: assembleContinuationStreamSpec,
  summary: assembleSummarySpec,
  extract: assembleExtractSpec,
  relation: assembleRelationSpec,
  levelGen: assembleLevelGenSpec,
  branch: assembleBranchSpec,
  consistency: assembleConsistencySpec,
};

/** 运行期遍历用（顺序 = 清单顺序，便于日志 / 调试图标） */
export const NOVEL_INTENTS = Object.keys(NOVEL_BUILDERS) as readonly NovelPromptIntent[];

/**
 * 意图 → 中文标签（看板 / 调用记录共用的单一产地，G7）。
 *
 * 为什么要有这张表而不是散在 UsagePanel / AILogSection：`NOVEL_BUILDERS` 有
 * 守卫强制登记，但消费侧的意图标签表没有——每加一个功能就漂移一次（review G7
 * 实证：2.10.0 的 summary 在 UsagePanel 上显示为原始英文）。
 * 与 `NOVEL_INTENTS` 同源，由 `prompt.test.ts` 断言覆盖全量。
 *
 * 注意：`transform` 在落库时带子类型（`transform:expand` 等），这里只给笼统
 * 标签；子类型的中文在 `TRANSFORM_KIND_LABELS`，消费侧自行展开。
 */
export const NOVEL_INTENT_LABELS: Record<NovelPromptIntent, string> = {
  naming: "起名",
  polish: "润色",
  transform: "文本变换",
  continuation: "续写",
  summary: "摘要",
  extract: "实体抽取",
  relation: "关系推断",
  levelGen: "等级生成",
  branch: "卡文救援",
  consistency: "一致性 AI 档",
};

/** 各意图的 prompt 模板版本（M7）。
 *
 * 落进 `ai_log.prompt_version` / `ai_event.prompt_ver`，让「改了 prompt 之后
 * 采纳率 / 效果变没变」可对照。**改任何一个模板时，必须同步 bump 对应版本号**，
 * 否则归因会把新旧 prompt 的效果混在一起。
 *
 * 版本规则：纯数字次版本，格式 `v<N>`；与 `package.json` 解耦（prompt 可以比
 * 应用更频繁地迭代）。新功能登记进 `NOVEL_BUILDERS` 时，同时在这里补一行。
 */
export const NOVEL_PROMPT_VERSIONS: Record<NovelPromptIntent, string> = {
  naming: "v1",
  polish: "v1",
  transform: "v1",
  // v2（2.10.3）：前文够短时注入【上一章摘要】（R-AI-09 摘要的第二消费方）
  continuation: "v2",
  // v2（2.10.1）：摘要支持 L3 授权范围——新增【前情】块与「只看选中段落」约束
  // v3（2.10.2）：摘要同一次产出【一句话】+【摘要】两段，一句话回填大纲梗概（大纲回流）
  summary: "v3",
  // v1（2.11.0）：R-AI-08 实体抽取首版（json-array，四字段）
  extract: "v1",
  // v1（2.14.0）：R-AI-15 关系推断首版（json-array，五字段 + 端点白名单）
  relation: "v1",
  // v1（2.15.0）：R-AI-18 等级体系生成 / 拓展首版（json-array，两字段 + 双模式）
  levelGen: "v1",
  // v1（2.72.0）：R-AI-11 卡文救援首版（json-array，三字段 + 四档风格旋钮）
  branch: "v1",
  // v1（2.72.0）：R-AI-10b 一致性 AI 档首版（json-array，四字段 + 三态判定 + 名字白名单）
  consistency: "v1",
};

/** 小说域模块（`domains/index.ts` 的登记单元） */
export const novelPromptDomain: PromptDomainModule<
  NovelPromptIntent,
  AiBookContext,
  NovelPromptPayloadMap
> = {
  domain: "novel",
  intents: NOVEL_INTENTS,
  build: (intent, ctx, payload) => NOVEL_BUILDERS[intent](ctx, payload),
  labels: NOVEL_INTENT_LABELS,
  versions: NOVEL_PROMPT_VERSIONS,
  // 小说域全档次可用：摘要走 L3 整章授权，其余 L1/L2
  allowedLevels: ["L1", "L2", "L3"],
};
