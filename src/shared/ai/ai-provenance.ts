/**
 * AI 产出来源标记与可撤销记录（M6）
 *
 * 承接 PRD §8.1「AI 产出必须沉淀且可溯源」：结构化 AI 产出（名字 / 要素卡 /
 * 摘要 / 关系边）在落地时带「来源 = ai + 模型 + 时间戳 + 批次」标记，让
 * 「AI 参与占比」有据可算、让「按批次撤销」有据可依。
 *
 * 本文件是**纯函数**：只构造 / 校验标记，不落库、不 import novel。
 * 摘要场景的落库载体是 `novel_chapters.ai_summary_model`（模型名）+ 
 * `ai_summary_at`（时间戳），即「来源标记」的数据库形态；这里提供统一
 * 的构造口径，避免每个功能各写一遍「怎么算 AI 生成」。
 */

/** 一条来源标记（M6） */
export interface AiProvenance {
  /** 来源类型：恒为 "ai"（区别于用户手工录入） */
  source: "ai";
  /** 来源模型名（如 "gpt-4o" / "llama3"） */
  model: string;
  /** 生成时间戳（毫秒） */
  at: number;
  /** 批次 id（同一次「生成 → 采纳」的产出共享，用于按批次撤销） */
  batchId: string;
}

/**
 * 构造一条 AI 来源标记。
 *
 * `model` 为空（如配置未填、或调用方不知模型）时返回 `null` —— 来源标记
 * 缺失模型名就没有审计价值，宁可没有标记也不落一条「来源不明」的假标记。
 */
export function makeAiProvenance(
  model: string | undefined | null,
  at: number,
  batchId: string,
): AiProvenance | null {
  const trimmedModel = model?.trim();
  if (!trimmedModel) return null;
  const trimmedBatch = batchId?.trim();
  if (!trimmedBatch) return null;
  return { source: "ai", model: trimmedModel, at, batchId: trimmedBatch };
}

/** 生成一个批次 id（纯随机，不与任何业务 id 耦合） */
export function newBatchId(): string {
  return `ai_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 判断一条来源标记是否为 AI 生成（source === "ai"） */
export function isAiGenerated(provenance: AiProvenance | null | undefined): boolean {
  return provenance?.source === "ai";
}

/**
 * 摘要列的「来源模型」取值：AI 生成传模型名，手工编辑传空串清空标记。
 * 这是 `novel_chapters.ai_summary_model` 与 M6 溯源之间的桥——上层不需要
 * 再手写「空串 = 手工」这条约定，统一走这里。
 */
export function summaryModelOf(provenance: AiProvenance | null): string {
  return provenance?.model ?? "";
}
