/**
 * 等级体系生成 / 拓展模板（R-AI-18）
 *
 * 场景：设定中心的「阶梯」卡里，作者给一个分类名（境界体系 / 功法品阶 /
 * 丹药稀有度…），AI 排出一条**有序**阶梯；已有阶梯则接着末端往下续。
 *
 * 为什么两档模式而不是一个按钮：
 * - 「整理整套」要求梯度均匀（第 1 条是入门、末条是顶点）；
 * - 「拓展后续」要求**接着现有末端**排、延续命名风格与方向。
 * 这两件事塞进一个 prompt，模型容易把「补齐缺失」和「接着往下」混着做，
 * 结果既不是重排也不是续写。
 *
 * 为什么是 `json-array` 而不是 `text`：等级名之外还要一句梯度说明
 * （「这一层能做什么」），自由文本没法稳定拆回两列。
 *
 * ⚠️ 本意图**不发送章节正文**（只有作品名 / 题材 / 分类信息 / 已有阶梯名），
 * 属 L1/L2 —— 调用方**不得**为它弹 L3 授权（PRD §五 数据分级）。
 */
import type { AiBookContext } from "../collector";
import type { OutputFormat } from "../output-spec";
import type { PromptSpec } from "./types";
import { composePrompt, constraintBlock, roleBlock, workBlock } from "./sections";

/** 两档模式：整理整套 / 在现有顶点之后拓展 */
export type LevelGenMode = "generate" | "extend";

/** 等级体系生成意图参数 */
export interface LevelGenIntent {
  /** 分类名（作者自己起的，如「境界体系」「功法品阶」） */
  categoryName: string;
  /** 分类说明（可为空）：作者写的一句世界观约束 */
  categoryNote?: string;
  /** 是否为境界体系（决定是否用「修炼口径」的措辞约束） */
  kind: "realm" | "custom";
  /**
   * 已有等级名，**按作者阶梯的显示顺序**（第一条在最上），不含子层级。
   *
   * ⚠️ 刻意不换算成「从低到高」：分类有「进位方向」（`asc` 由低到高 /
   * `desc` 由高到低），换算错了模型就会往反方向排。让它跟着作者的顺序走，
   * 「接着最后一条往下」在两种方向下都成立。
   */
  existing: string[];
  mode: LevelGenMode;
  /** 期望产出的条数 */
  count: number;
}

/** 输出契约：等级名 + 一句话梯度说明 */
export const LEVEL_OUTPUT_FORMAT: OutputFormat = {
  kind: "json-array",
  fields: [
    { key: "name", type: "string", label: "等级名" },
    { key: "note", type: "string", label: "一句话说明" },
  ],
};

const DEFAULT_COUNT: Record<LevelGenMode, number> = { generate: 9, extend: 4 };
/** 条数区间：少于 3 排不出梯度，多于 20 作者勾不过来 */
const COUNT_RANGE: Record<LevelGenMode, { min: number; max: number }> = {
  generate: { min: 3, max: 20 },
  extend: { min: 1, max: 12 },
};

const ROLE =
  "你是一名网文设定架构师，擅长设计**有序的等级阶梯**（境界体系、功法品阶、丹药稀有度、职称军衔这类从低到高的体系）。";

/** 把条数夹进区间（纯函数，供面板与模板共用同一口径） */
export function clampLevelCount(mode: LevelGenMode, count: number | undefined): number {
  const { min, max } = COUNT_RANGE[mode];
  if (!count || !Number.isFinite(count)) return DEFAULT_COUNT[mode];
  return Math.min(max, Math.max(min, Math.floor(count)));
}

/** 现有末端（拓展模式的起点；空阶梯时为空串） */
function topOf(existing: string[]): string {
  return existing.length > 0 ? existing[existing.length - 1] : "";
}

/**
 * 组装等级体系 Prompt。
 *
 * 调用方必须先把分类的**根级**名字按显示顺序排好传进来（子层级不算一级：
 * 「练气 1–9 层」是练气的细分，不是新的境界）。
 */
export function assembleLevelGenSpec(
  context: AiBookContext,
  intent: LevelGenIntent,
): PromptSpec {
  const count = clampLevelCount(intent.mode, intent.count);
  const categoryName = intent.categoryName?.trim() || "等级体系";
  const note = intent.categoryNote?.trim();
  const existing = intent.existing.map((name) => name.trim()).filter(Boolean);
  const top = topOf(existing);
  const isRealm = intent.kind === "realm";
  const isExtend = intent.mode === "extend";

  return {
    system: composePrompt(
      roleBlock(ROLE),
      workBlock(context),
      `【体系】${categoryName}（${isRealm ? "境界体系" : "自定义体系"}）`,
      note ? `【体系说明】${note}` : null,
      existing.length > 0
        ? `【现有阶梯（按作者的排列顺序，第一条在最上）】${existing.join(" → ")}`
        : null,
      constraintBlock([
        isExtend
          ? `现有阶梯的最后一条是「${top}」，请**接着它往下**再排 ${count} 条，一级接一级，不要把现有级别重排、也不要插到中间；`
          : `只输出 ${count} 条，按**从入门到顶端**的顺序：第 1 条是刚踏上这条路的人，最后一条是这套体系的顶点，梯度要均匀，不要一步登天；`,
        isExtend
          ? "方向跟着作者的顺序走：若上面的顺序看起来由弱到强，就继续往更强的方向排；若由强到弱，就继续往更弱的方向排（例如「一品 → 二品」往下写）。**不要替作者翻转阶梯**；"
          : "命名要有内在的统一感（同字数或同构词），读起来像同一套体系，而不是十个互不相干的词；",
        `"name" 为 2–6 个汉字，不带序号、书名号、引号，也不要写「第N层 / 第N重」这类小层写法（小层是等级之下的细分，不是新的一级）；`,
        `"note" 一句话（不超过 20 字）说明这一级的人大致能做什么、处在什么位置；只依据体系本身合理推断，不要编造具体人物或门派；`,
        // 条件约束用 spread 展开：`constraintBlock` 只收 string[]，
        // 传 null 会被静默拼成 "- null"（模型会照着这一行当约束读）
        ...(existing.length > 0
          ? [`不得与【现有阶梯】里任何一级重名，也不要只差一个字（例如已有「金丹」时不要给「金舟」）；`]
          : []),
        ...(isRealm
          ? ["按【作品背景】的题材口径命名；题材未设置时用中性的东方玄幻口径，不要混入科幻、现代或西幻词汇；"]
          : []),
        "若这个分类名本身不是一个有序体系（例如「人物关系」），输出空数组 []，不要硬凑。",
      ]),
    ),
    prompt: isExtend
      ? `请接着「${top}」往下，为「${categoryName}」再排 ${count} 级，按约定输出 JSON 数组。`
      : `请为「${categoryName}」整理一套 ${count} 级的完整阶梯，按约定输出 JSON 数组。`,
    outputFormat: LEVEL_OUTPUT_FORMAT,
  };
}
