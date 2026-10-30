/**
 * 实体 / 设定抽取模板（R-AI-08）
 *
 * 写完一章，把里面出现的人物、地点、势力、物品、境界扒成候选卡，作者勾选后入库。
 * 它是**供给方**：没有要素卡，一致性校对（10a）与关系建议（15）都是空壳。
 *
 * 为什么是 `json-array` 而不是 text：一屏十几条候选，每条都要带类型与出处句，
 * 自由文本没法稳定解析（M3 的输出契约正是为这种场景准备的，三层保险已就绪）。
 *
 * 上下文 = 单章正文（L3 级，需授权 M5）+ 已有要素清单（**去重**用）。
 * ⚠️ 已有要素不是「上下文背景」而是**硬约束**：模型必须跳过已建卡的名字，
 * 否则作者每次抽取都会看到一半是老面孔，勾选成本立刻翻倍。
 */
import type { AiBookContext } from "../collector";
import type { L3Scope } from "../../ai-consent";
import type { OutputFormat } from "../output-spec";
import type { PromptSpec } from "./types";
import { composePrompt, constraintBlock, roleBlock, workBlock } from "./sections";

/** 抽取意图参数 */
export interface ExtractIntent {
  /** 本章正文（L3；调用方已按授权范围与预算裁过） */
  chapter: string;
  /** 章节标题（让模型知道「这是第几章」，可选） */
  chapterTitle?: string;
  /** 本次 L3 授权范围（进 prompt，让模型知道看到的是整章还是一段） */
  scope?: L3Scope;
  /** 前情节选（仅 recent3），只作背景，不作为抽取来源 */
  contextText?: string;
  /** 单次最多产出多少条候选 */
  limit?: number;
}

/** 输出契约：名称 / 类型 / 一句话说明 / 原文依据 */
export const EXTRACT_OUTPUT_FORMAT: OutputFormat = {
  kind: "json-array",
  fields: [
    { key: "name", type: "string", label: "名称" },
    { key: "type", type: "string", label: "类型" },
    { key: "summary", type: "string", label: "一句话说明" },
    { key: "evidence", type: "string", label: "原文依据" },
  ],
};

/** 允许的类型（与内置六类的中文标签同字面，渲染层再映射回类型 id） */
export const EXTRACT_TYPE_LABELS = ["人物", "地点", "势力", "物品", "境界体系", "其他"] as const;

const DEFAULT_LIMIT = 20;

const ROLE =
  "你是一名小说设定管理员。请从用户给出的章节正文里找出**值得建卡的**设定项，供作者勾选入库。要求：";

/** 把候选条数夹在合理区间：0 条没有意义，50 条作者勾不过来 */
function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(30, Math.max(5, Math.floor(limit)));
}

/**
 * 组装抽取 Prompt。
 *
 * 单章正文是 L3 数据：调用方必须先过 M5 授权再调本模板，本层不感知授权。
 */
export function assembleExtractSpec(
  context: AiBookContext,
  intent: ExtractIntent,
): PromptSpec {
  const chapter = intent.chapter?.trim() ?? "";
  const title = intent.chapterTitle?.trim();
  const contextText = intent.contextText?.trim();
  const limit = clampLimit(intent.limit);
  const isSelection = intent.scope === "selection";

  return {
    system: composePrompt(
      roleBlock(ROLE),
      workBlock(context),
      context.entities.length > 0
        ? `【已有要素（不要再抽，也不要换个说法重抽）】\n${context.entities
            .map((entity) => `${entity.type}·${entity.name}`)
            .join("、")}`
        : null,
      title ? `【章节】${title}` : null,
      contextText
        ? `【前情（只作背景，不要从这里抽取）】\n${contextText}`
        : null,
      isSelection
        ? `【选中段落】\n${chapter || "（未选中任何内容）"}`
        : `【章节正文】\n${chapter || "（本章无正文内容）"}`,
      constraintBlock([
        `最多输出 ${limit} 条，按重要性排序（主角、反复出现的地点优先）；`,
        `"type" 只能是这些中文之一：${EXTRACT_TYPE_LABELS.join(" / ")}；`,
        `"name" 用正文里的**原样写法**，不要加书名号、引号或修饰语，也不要自创名字；`,
        `"summary" 一句话（不超过 40 字）说明它是谁 / 是什么，只能依据正文推断，不要编造身世与设定；`,
        `"evidence" 摘录正文里的原句片段（不超过 30 字），必须能在正文里逐字找到；`,
        "已被【已有要素】覆盖的名字（含别名）一律跳过；只出现一次的泛称（「那人」「掌柜」「老者」）不要抽；",
        ...(isSelection
          ? ["只从【选中段落】里抽，不要补上你没看到的其它段落。"]
          : []),
        "若正文里没有任何值得建卡的设定，输出空数组 []。",
      ]),
    ),
    prompt: `请从上述章节里抽取最多 ${limit} 条值得建卡的设定项，按约定输出 JSON 数组。`,
    outputFormat: EXTRACT_OUTPUT_FORMAT,
  };
}
