/**
 * 关系建议模板（R-AI-15）
 *
 * 从一章正文里读出「谁和谁是什么关系」，产出**候选边**交由作者勾选，
 * 确认后走 `novel-graph-commit` 单事务写入 `novel_links`。
 *
 * 为什么必须是 `json-array`：一条边是「两个端点 + 关系名 + 置信度 + 出处句」
 * 五元组，自由文本没法稳定拆回来；而关系写错是**画布上的可见错误**，
 * 没有结构化字段就没法让作者逐条核对与勾选。
 *
 * 与 R-AI-10a 的边界（PRD 明确要求划分）：10a **报问题**，本条**建资产**。
 * 所以这里只产出「新增边」，绝不产出删除 / 改写已有关系的指令。
 */
import type { AiBookContext } from "../collector";
import type { L3Scope } from "../../ai-consent";
import type { OutputFormat } from "../output-spec";
import type { PromptSpec } from "./types";
import { composePrompt, constraintBlock, entityBlock, roleBlock, workBlock } from "./sections";

/** 关系推断意图参数 */
export interface RelationIntent {
  /** 本章正文（L3；调用方已按授权范围与预算裁过） */
  chapter: string;
  /** 章节标题（让模型知道「这是第几章」，可选） */
  chapterTitle?: string;
  /** 本次 L3 授权范围（进 prompt，让模型知道看到的是整章还是一段） */
  scope?: L3Scope;
  /** 前情节选（仅 recent3），只作背景，不作为推断来源 */
  contextText?: string;
  /** 已有的关系边，逐条写成「李玄 —师徒— 苏棠」（去重用，避免重复建边） */
  existingEdges?: readonly string[];
  /** 单次最多产出多少条候选 */
  limit?: number;
}

/** 输出契约：两端点名 / 关系名 / 置信度 / 原文依据 */
export const RELATION_OUTPUT_FORMAT: OutputFormat = {
  kind: "json-array",
  fields: [
    { key: "from", type: "string", label: "一端人物或势力名" },
    { key: "to", type: "string", label: "另一端名" },
    { key: "relation", type: "string", label: "关系名" },
    { key: "confidence", type: "string", label: "置信度" },
    { key: "evidence", type: "string", label: "原文依据" },
  ],
};

/** 允许的置信度字面量（渲染层再归一成三档） */
export const RELATION_CONFIDENCE_VALUES = ["high", "medium", "low"] as const;

const DEFAULT_LIMIT = 20;

const ROLE =
  "你是一名小说关系图谱编辑。请从用户给出的章节正文里读出**人物 / 势力之间的关系**，供作者勾选后画进关系图。要求：";

/** 把候选条数夹在合理区间：0 条没有意义，40 条作者勾不过来 */
function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(40, Math.max(5, Math.floor(limit)));
}

/**
 * 组装关系推断 Prompt。
 *
 * 单章正文是 L3 数据：调用方必须先过 M5 授权再调本模板，本层不感知授权。
 */
export function assembleRelationSpec(
  context: AiBookContext,
  intent: RelationIntent,
): PromptSpec {
  const chapter = intent.chapter?.trim() ?? "";
  const title = intent.chapterTitle?.trim();
  const contextText = intent.contextText?.trim();
  const limit = clampLimit(intent.limit);
  const isSelection = intent.scope === "selection";
  const existing = (intent.existingEdges ?? []).map((edge) => edge.trim()).filter(Boolean);

  return {
    system: composePrompt(
      roleBlock(ROLE),
      workBlock(context),
      // 端点白名单：模型只能从已有要素里挑，编出来的名字会在渲染层被丢弃，
      // 与其让它白写，不如在 prompt 里就把口子堵上
      entityBlock(
        context,
        "关系两端**必须**是上面这些名字之一，逐字照抄；不在这份清单里的人或势力一律不要输出（作者会先建卡）。",
      ),
      title ? `【章节】${title}` : null,
      contextText ? `【前情（只作背景，不要从这里推断）】\n${contextText}` : null,
      existing.length > 0
        ? `【已有关系（不要重复输出）】\n${existing.map((edge) => `- ${edge}`).join("\n")}`
        : null,
      isSelection
        ? `【选中段落】\n${chapter || "（未选中任何内容）"}`
        : `【章节正文】\n${chapter || "（本章无正文内容）"}`,
      constraintBlock([
        `最多输出 ${limit} 条，按确定性从高到低排序；`,
        `"from" / "to" 两端都必须是【已有要素】里的名字，逐字照抄，不要加书名号或称谓；`,
        `"relation" 是 2~6 字的短关系名（如 师徒 / 同门 / 宿敌 / 父子 / 上下级 / 出身），不要写"他们是师徒关系"这种整句；`,
        `"confidence" 只能取 ${RELATION_CONFIDENCE_VALUES.join(" / ")}：正文明说（拜师、称父、结拜）用 high，靠对话与称呼推断用 medium，只是同场出现用 low；`,
        `"evidence" 摘录正文里的原句片段（不超过 30 字），必须能在正文里逐字找到；`,
        "只输出**正文明确支持**的关系；同场出现、没说关系的一律不输出；",
        "同一对人物只输出一次最确定的关系，不要罗列多个近义关系名（师徒 / 师父 / 弟子 是同一个）；",
        ...(isSelection
          ? ["只从【选中段落】里推断，不要补上你没看到的其它段落。"]
          : []),
        "若正文里读不出任何关系，输出空数组 []。",
      ]),
    ),
    prompt: `请从上述章节里推断最多 ${limit} 条人物 / 势力之间的关系，按约定输出 JSON 数组。`,
    outputFormat: RELATION_OUTPUT_FORMAT,
  };
}
