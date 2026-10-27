/**
 * L1 / L2 / L3 数据分级与 L3 授权范围（M5）
 *
 * 承接 PRD §五「数据出境与用户授权」的统一门槛：所有 L3 功能（章节摘要 /
 * 实体抽取 / 一致性校对 / 关系推断 / 全书问答）在把正文发给模型前，必须走
 * 统一的授权弹窗 + 范围选择，禁止各功能散出多份不一致的授权文案。
 *
 * 本文件是**纯常量与类型**，不读 store / 不发 IPC / 不 import novel，
 * 供 `useAiConsent`、`AiConsentDialog` 与各 L3 编排共用同一套口径。
 */

/** 数据分级：决定「要不要授权」以及授权的严苛程度 */
export type AiDataLevel = "L1" | "L2" | "L3";

/** 各分级的中文说明（弹窗与设置页共用，保证文案唯一） */
export const DATA_LEVEL_LABELS: Record<AiDataLevel, string> = {
  L1: "字段级（名字 / 题材 / 风格等元数据）",
  L2: "片段级（选中文本 + 前后文窗口）",
  L3: "整章 / 全书级（章节全文）",
};

/**
 * L3 授权范围（PRD §5.3）。
 *
 * 刻意**不提供「全书」档**（Q4 拍板结论：成本与隐私都不可控）；
 * `recent3`（最近 3 章）作为折中档保留，`selection`（选中段落）留给
 * 支持划词的功能（一致性校对、全书问答本就走本地召回只送片段）。
 */
export type L3Scope = "chapter" | "selection" | "recent3";

/** 范围 → 中文标签（选择器与弹窗共用） */
export const L3_SCOPE_LABELS: Record<L3Scope, string> = {
  chapter: "仅本章",
  selection: "选中段落",
  recent3: "最近 3 章",
};

/** 范围选择器的展示顺序（默认保守：仅本章 / 选中段落在前） */
export const L3_SCOPE_ORDER: readonly L3Scope[] = ["chapter", "selection", "recent3"];

/** 默认范围：PRD §5.3「默认范围应保守」，默认「仅本章」 */
export const DEFAULT_L3_SCOPE: L3Scope = "chapter";

/** 是否属于 L3 级（需要授权弹窗） */
export function isL3(level: AiDataLevel): boolean {
  return level === "L3";
}

/**
 * 合规提示位（PRD §5.5）：配置层与每个 L3 功能首次使用时必须展示。
 * 文案唯一产地，弹窗 / 设置页都引这里，避免各写一遍漂移。
 */
export const COMPLIANCE_NOTICE =
  "你将自行向第三方模型服务商发送数据，CheckIn 不中转、不存储你的作品内容。";
