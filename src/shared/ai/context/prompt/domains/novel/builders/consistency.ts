/**
 * 一致性校对 · AI 档模板（R-AI-10b）
 *
 * 本地判据（`src/shared/novel/consistency.ts`，10a）已经把**确定**的问题
 * （整组碎片、数字替换、明确的错字）判完了；剩下的是它**拿不准**的残余：
 * 单写法的碎片、同形异名、成对出现的同姓角色。这些只有读懂上下文才能定，
 * 于是送到这里让 AI 逐条判一个结论，**作者勾选后**才改正文。
 *
 * 三条铁律（写入 prompt，也在调用方再兜一遍）：
 * 1. 只判白名单里的名字——AI 不得判一个「作者根本没建过卡」的名字为错字；
 * 2. 只判**送进来的这些条目**，不得自行新增疑似写法；
 * 3. 拿不准就判「不要改」：把一个人名改错，比漏改一个错字贵得多。
 *
 * 为什么是 `json-array`：一次送几十条，每条都要回「判定 + 依据」两列，
 * 自由文本没法稳定对回原条目（对不上就等于白判）。
 *
 * ⚠️ 本模板**不改** 10a 的任何判据，也不产出「删除 / 合并要素」的指令：
 * 它只是给 10a 标了 `suspect` 的条目补一列**建议**。
 */
import type { AiBookContext } from "../types";
import type { OutputFormat } from "../../../../output-spec";
import type { PromptSpec } from "../../../types";
import { composePrompt, constraintBlock, outputBlock, roleBlock } from "../../../kit";
import { entityBlock, workBlock } from "../sections";

/**
 * 判定三态。
 *
 * 只有「错字」意味着「建议改」；另两态都是「这两个写法指的是不同的东西，别动」。
 * 三态而不是「对 / 错」二元，是因为 10a 的疑似条目里有大量**合法的近似名**
 * （李玄 / 李弦是两个人），二元判定会把这些全推进「改」的那一侧。
 */
export const CONSISTENCY_VERDICTS = ["错字", "同形异名", "同姓角色"] as const;

/** 判定结果字面量类型 */
export type ConsistencyVerdict = (typeof CONSISTENCY_VERDICTS)[number];

/** 唯一表示「建议改正文」的判定（面板据此决定是否给出「采纳」勾选框） */
export const CONSISTENCY_TYPO_VERDICT: ConsistencyVerdict = "错字";

/** 判定归一：只有明确的「错字」才算建议改，其余（含模型自造的新词）一律按「不要改」处理 */
export function isTypoVerdict(verdict: string | undefined): boolean {
  return verdict?.trim() === CONSISTENCY_TYPO_VERDICT;
}

/** 一条疑似写法（由 10a 的 `suspect` 级 issue 归一而来） */
export interface ConsistencySuspect {
  /** 正确写法（10a 认为的要素名 / 高频写法） */
  expected: string;
  /** 疑似写法（正文里读到的残余写法） */
  candidate: string;
  /** 该写法在本次校对范围里出现的次数 */
  occurrences: number;
  /** 出处片段（含疑似写法的一小段正文，用于判上下文） */
  snippet: string;
}

/** 一致性 AI 档意图参数 */
export interface ConsistencyIntent {
  /** 10a 标「疑似」的候选集（`sure` 级不送，已由本地判据定罪） */
  suspects: ConsistencySuspect[];
  /** 已有要素名白名单（AI 不得判不在此清单里的名字为错字） */
  knownNames: string[];
}

/** 输出契约：正确写法 / 疑似写法 / 判定 / 依据 */
export const CONSISTENCY_OUTPUT_FORMAT: OutputFormat = {
  kind: "json-array",
  fields: [
    { key: "expected", type: "string", label: "正确写法" },
    { key: "candidate", type: "string", label: "疑似写法" },
    { key: "verdict", type: "string", label: "判定（错字/同形异名/同姓角色）" },
    { key: "reason", type: "string", label: "依据" },
  ],
};

/**
 * 单次最多送多少条。
 *
 * 与调用方的分批口径**必须同源**（导出给 `useConsistencyAi` 用）：
 * 一批几十条时模型会开始「跳条」（只回一半），作者看到的是「剩下的没判」。
 * 40 条是实测能稳定逐条回完的上限。
 */
export const CONSISTENCY_MAX_SUSPECTS = 40;

/** 出处片段进 prompt 的截断上限（一条一行，片段太长会把整批挤掉） */
const SNIPPET_MAX_CHARS = 60;

const ROLE =
  "你是一名中文小说校对编辑。作者的书里有一批**拿不准的疑似写法**（可能是错字，也可能是两个不同的人名），请逐条判断它们到底是哪一种。要求：";

/** 一条疑似写法渲染成一行（编号便于模型逐条回，不编号时它会漏条） */
function suspectLine(suspect: ConsistencySuspect, index: number): string {
  const expected = suspect.expected?.trim() ?? "";
  const candidate = suspect.candidate?.trim() ?? "";
  const occurrences =
    Number.isFinite(suspect.occurrences) && suspect.occurrences > 0
      ? Math.floor(suspect.occurrences)
      : 1;
  const rawSnippet = suspect.snippet?.trim() ?? "";
  const snippet =
    rawSnippet.length > SNIPPET_MAX_CHARS
      ? `${rawSnippet.slice(0, SNIPPET_MAX_CHARS)}…`
      : rawSnippet;
  return `${index + 1}. 疑似「${expected}」被写成了「${candidate}」（出现 ${occurrences} 次）${
    snippet ? `｜出处：${snippet}` : ""
  }`;
}

/**
 * 白名单段。
 *
 * `knownNames` 是**本次批次**的白名单（调用方从要素表派生，已去重），
 * 有它就优先用它——不必再重复罗列整张要素表；没有才退回按类型分组的要素段。
 * 两段都出现只会把同一批名字说两遍，白烧 token。
 */
function whitelistBlock(context: AiBookContext, knownNames: string[]): string | null {
  if (knownNames.length > 0) {
    return `【可以判定的名字（白名单）】${knownNames.join("、")}\n- 只有出现在这份清单里的名字才允许作为 "expected"；清单外的名字一律不要判、更不要编造。`;
  }
  return entityBlock(
    context,
    "只有出现在上面这些名字里才允许作为 \"expected\"；清单外的名字一律不要判、更不要编造。",
  );
}

/**
 * 组装一致性 AI 档 Prompt。
 *
 * 送进来的是 10a 标 `suspect` 的条目（调用方已去掉 `sure` 级与 2.15.1 已过滤的两类误报），
 * 本层只负责把它们连同白名单排版成一次判定任务。
 */
export function assembleConsistencySpec(
  context: AiBookContext,
  intent: ConsistencyIntent,
): PromptSpec {
  const suspects = (intent.suspects ?? [])
    .map((suspect) => ({
      expected: suspect.expected?.trim() ?? "",
      candidate: suspect.candidate?.trim() ?? "",
      occurrences: suspect.occurrences,
      snippet: suspect.snippet?.trim() ?? "",
    }))
    // 两端都空的行判不出任何东西，送上去只会让模型多回一条废话
    .filter((suspect) => Boolean(suspect.expected) || Boolean(suspect.candidate))
    .slice(0, CONSISTENCY_MAX_SUSPECTS);
  const knownNames = Array.from(
    new Set((intent.knownNames ?? []).map((name) => name?.trim()).filter(Boolean)),
  );
  const total = suspects.length;

  return {
    system: composePrompt(
      roleBlock(ROLE),
      workBlock(context),
      whitelistBlock(context, knownNames),
      total > 0
        ? `【待判定的疑似写法（共 ${total} 条）】\n${suspects
            .map((suspect, index) => suspectLine(suspect, index))
            .join("\n")}`
        : "【待判定的疑似写法】\n（本次没有需要判定的条目）",
      constraintBlock([
        `逐条判：送进来 ${total} 条，就回 ${total} 条，一条一条对应，不要漏条、不要合并、不要自行新增条目；`,
        `"expected" / "candidate" 两栏**逐字照抄**输入里的写法，不要改写、不要调换两栏、不要补上书名号；`,
        `"verdict" 只能是这些中文之一：${CONSISTENCY_VERDICTS.join(" / ")}；`,
        `判定口径：指的是同一个人、写法只差一字且读起来是明显笔误 → ${CONSISTENCY_TYPO_VERDICT}；两个字面各有其人 / 各指一物，只是形近音近容易混 → 同形异名；姓氏相同但确实是两个不同角色 → 同姓角色；`,
        `"reason" 一句话（不超过 30 字）说明依据，只能引用【待判定的疑似写法】里给出的出处片段，不要编造情节或身世；`,
        `拿不准时判「同形异名」（意思是**不要改**）：把一个人名改错，比漏改一个错字代价大得多；`,
        "只判名字的写法，不要顺手评价文笔、剧情或设定合理性；",
        "若没有需要判定的条目，输出空数组 []。",
      ]),
      outputBlock(CONSISTENCY_OUTPUT_FORMAT),
    ),
    prompt:
      total > 0
        ? `请逐条判定上述 ${total} 条疑似写法，按约定输出 JSON 数组。`
        : "本次没有需要判定的条目，请按约定输出空数组 []。",
    outputFormat: CONSISTENCY_OUTPUT_FORMAT,
  };
}
