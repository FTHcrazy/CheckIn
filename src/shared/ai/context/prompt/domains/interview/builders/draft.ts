/**
 * AI 拓展模板（面试题库 · 意图 2）—— 出题 / 出词 / 出图
 *
 * 三个按钮合成一个意图：它们的**上下文完全相同**（分类词表 / 已有条目 / 库规模），
 * 差别只在输出契约与角色定位。落库口径本来就是 `interviewDraft:<kind>`
 * （`draftSubIntent`），拆成三个意图只会让 `AI_INTENT_LABELS` 多两行、
 * 让调用方多一个 switch。
 *
 * ⚠️ 输出契约按 kind 分两份：question / glossary 走 json-array，diagram 走 text。
 * 理由见 `DRAFT_OUTPUT_FORMATS.diagram` 上的注释 —— `OutputField.type` 只有
 * `string | number`，表达不了嵌套节点，硬塞进扁平字段会让模型按「只包含这些字段」
 * 的强约束把 `nodes` 丢掉，图直接画不出来。
 *
 * 枚举取值一律从 `InterviewDraftPayload` 派生，不另抄字面量：payload 是唯一产地，
 * 抄一份必然漂移。
 */
import { composePrompt, constraintBlock, jsonArrayFormat, outputBlock, requirementBlock, roleBlock } from "../../../kit";
import type { PromptSpec } from "../../../types";
import { TEXT_OUTPUT_FORMAT, type OutputFormat } from "../../../../output-spec";
import { categoryBlock, coverageBlock, siblingTitlesBlock } from "../sections";
import type { InterviewDraftPayload, InterviewPromptContext } from "../types";

/** 从 payload 派生的枚举联合（避免在 prompt 层重复声明一套字面量） */
type InterviewKind = InterviewDraftPayload["kind"];
type DiagramKindShape = NonNullable<InterviewDraftPayload["diagramKind"]>;
type QuestionDifficultyShape = NonNullable<InterviewDraftPayload["difficulty"]>;

/** 难度中文：prompt 里给人读，也让 requirementBlock 不必裸写 "medium" */
export const DRAFT_DIFFICULTY_LABELS: Record<QuestionDifficultyShape, string> = {
  basic: "基础（一面常见，答不出就是硬伤）",
  medium: "中等（能问出区分度，要看细节）",
  hard: "困难（源码 / 边界 / 设计取舍）",
};

/** 三种产物的 json 契约（模型产出字段；应用侧补齐字段不在契约里） */
export const DRAFT_OUTPUT_FORMATS: Record<InterviewKind, OutputFormat> = {
  question: jsonArrayFormat([
    { key: "title", type: "string", label: "题目标题（不超过 40 字，不带「请简述」这类前缀）" },
    { key: "stem", type: "string", label: "题干（含设问；代码另放 stemCode）" },
    { key: "stemCode", type: "string", label: "题干代码（没有就填空字符串）" },
    { key: "answer", type: "string", label: "参考答案（分点讲清，去掉寒暄）" },
    { key: "difficulty", type: "string", label: "难度，只能取 basic / medium / hard" },
    { key: "topic", type: "string", label: "来源主题（如 React / JS 基础）" },
    { key: "tags", type: "string", label: "标签，用顿号分隔，最多 5 个" },
  ]),
  glossary: jsonArrayFormat([
    { key: "term", type: "string", label: "词条名（不超过 24 字）" },
    { key: "en", type: "string", label: "英文全称 / 原名（没有就填空字符串）" },
    { key: "short", type: "string", label: "一句话定义（不超过 80 字）" },
    { key: "detail", type: "string", label: "展开细节 2–4 条，每条一行，换行写成 \\n" },
    { key: "aliases", type: "string", label: "别名，用顿号分隔，最多 4 个（没有就填空字符串）" },
    { key: "domain", type: "string", label: "所属领域（如 React / 浏览器）" },
  ]),
  // diagram 走 text：嵌套结构无法用扁平 OutputField 表达。
  // `buildOutputInstruction` 对 json-array 会写死「每个元素……只包含这些字段」，
  // 节点是嵌套数组，硬塞进去模型会按强约束丢掉 nodes。改用 text + 在约束里
  // 写死整段 JSON 骨架（见 DIAGRAM_KIND_SHAPE_HINT），是不改 output-spec 的唯一路径。
  diagram: TEXT_OUTPUT_FORMAT,
};

/**
 * 图型 → 必须带的键的**逐字样例**。
 *
 * 这张表的存在理由是一条真实缺陷：`flow` 用 `label`/`note`、`timeline` 用
 * `title`/`detail`，两类图曾经共用一份节点类型，落库时键名被悄悄改写，
 * 时间轴渲染成空白。把键名写进 prompt 的示例里，是「让模型照抄」而不是
 * 「让解析器猜」。
 */
export const DIAGRAM_KIND_SHAPE_HINT: Record<DiagramKindShape, string> = {
  flow: '{"kind":"flow","title":"…","caption":"…","nodes":[{"label":"…","note":"…"}],"note":"易错点"}',
  timeline: '{"kind":"timeline","title":"…","caption":"…","events":[{"title":"…","detail":"…"}]}',
  compare:
    '{"kind":"compare","title":"…","caption":"…","left":{"title":"…","items":["…"]},"right":{"title":"…","items":["…"]}}',
  layers: '{"kind":"layers","title":"…","caption":"…","layers":[{"label":"…","note":"…"}]}',
};

const DEFAULT_COUNT: Record<InterviewKind, number> = { question: 3, glossary: 3, diagram: 1 };

/** 条数区间：一次出太多作者审不动；图解恒 1 张（一屏放不下第二张） */
export function clampDraftCount(kind: InterviewKind, count: number | undefined): number {
  if (kind === "diagram") return 1;
  if (!count || !Number.isFinite(count)) return DEFAULT_COUNT[kind];
  return Math.min(10, Math.max(1, Math.floor(count)));
}

/** 三种产物各自的身份定位（首句必须互不相同，模型才不会串台） */
const ROLE_BY_KIND: Record<InterviewKind, string> = {
  question: "你是一名资深前端面试官，负责为题库补出**可被追问**的面试题与参考答案。",
  glossary: "你是一名技术词典编辑，负责把术语写成面试者能秒懂、又能背下来的词条。",
  diagram: "你是一名技术图解作者，负责把一个抽象机制画成结构清晰、节点不超过 8 个的图。",
};

/** 已有条目的避重口径（三种产物撞名的方式不同，提示语也不同） */
const SIBLING_NOTE_BY_KIND: Record<InterviewKind, string | undefined> = {
  question:
    "同一条知识点换个角度问是允许的，但标题不能只换说法（「手写 Promise」出现两次就是重复）。",
  glossary:
    "近义词也算重复（「事件循环」与「Event Loop」是同一个词），命中就别再造一条。",
  diagram: undefined,
};

/** 题干 / 词条 / 图解的约束集（条数与图型是变量，其余逐条固定） */
function constraintsFor(params: {
  kind: InterviewKind;
  count: number;
  diagramKind?: DiagramKindShape;
}): string[] {
  const { kind, count, diagramKind } = params;

  if (kind === "question") {
    return [
      `只输出 ${count} 条，宁可少也不要凑数；同一道题只能出现一次；`,
      "不要输出 id / categoryId / reviewedAt 这类字段，它们由应用在落库时补齐；",
      "难度 difficulty 只能取 basic / medium / hard 三档，不要自造档位；",
      "题干与答案都要能直接背下来：答案分点讲清关键点，不要写「详情见文档」「参考相关资料」这类空话；",
      "不得与【已有条目】里的标题重复，也不要只换一种说法（换个近义词重出一遍算重复）；",
      "tags 用顿号分隔（不要用逗号或竖线），最多 5 个；",
      "题库只有「一问一答」形态：不要出选择题、判断题、填空题，也不要用「请简述」这类前缀撑标题；",
    ];
  }

  if (kind === "glossary") {
    return [
      `只输出 ${count} 条，宁可少也不要凑数；`,
      "term 只能是一个词或短语本身，不要带解释、不要带括号补充；",
      "short 是**定义**（不超过 80 字），不是使用场景，不要用「用于…」开头；",
      "detail 写 2–4 条、每条一行（JSON 里用 \\n 分隔），讲清原理、边界与常见误解；",
      "与【已有条目】里的词条键（含别名）不重复；近义词也算重复（「事件循环」与「Event Loop」是同一个词），命中就别再造一条；",
      "en 是英文全称 / 原名，拿不准就留空字符串，不要编造缩写；",
      "不要输出 id / categoryId / 归一后的 aliases，它们由应用补齐；",
    ];
  }

  const diagramKind2 = diagramKind ?? "flow";
  return [
    "只输出**一个** JSON 对象（不是数组、也不要包在数组里），不要输出任何解释性文字；",
    `必须逐字照抄这个骨架的键名，不许改名、不许增删键：${DIAGRAM_KIND_SHAPE_HINT[diagramKind2]}；`,
    `本次图型是 ${diagramKind2}：flow / layers 的节点用 label + note，timeline 的事件用 title + detail，compare 用 left / right 两个对象 —— 四类键名不许混用；`,
    "title 是图的名字，caption 用一句话说明这张图讲什么（不超过 30 字）；",
    "节点 2–8 个，超出人眼一屏看不清；",
    "值里不许出现 JSON 结构字符（引号、花括号、方括号），需要多个要点时用顿号分隔；",
  ];
}

/** 用户提示词主体（一句话，与小说域模板的习惯一致） */
function promptFor(params: {
  kind: InterviewKind;
  count: number;
  category: string;
  diagramKind?: DiagramKindShape;
}): string {
  const { kind, count, category, diagramKind } = params;
  if (kind === "question") {
    return `请为「${category}」补出 ${count} 道题，按约定输出 JSON 数组。`;
  }
  if (kind === "glossary") {
    return `请补出 ${count} 个「${category}」方向的词条，按约定输出 JSON 数组。`;
  }
  return `请画一张说明该机制的 ${diagramKind ?? "flow"} 图，按约定输出一个 JSON 对象。`;
}

/** 组装 AI 拓展 Prompt（三段式：按 kind 选角色定位 + 约束集 + 输出契约） */
export function assembleDraftSpec(
  context: InterviewPromptContext,
  payload: InterviewDraftPayload,
): PromptSpec {
  const kind = payload.kind;
  const count = clampDraftCount(kind, payload.count);
  const format = DRAFT_OUTPUT_FORMATS[kind];
  const category = context.categories.find((c) => c.id === payload.categoryId);
  const siblings =
    kind === "question"
      ? context.questionTitles
      : kind === "glossary"
        ? context.glossaryTerms
        : []; // 图解标题不在 ctx 里（量小且不易撞名）

  const requirements: string[] = [];
  if (category) requirements.push(`目标分类：${category.label}（${category.id}）`);
  if (payload.track) {
    requirements.push(`轨道：${payload.track === "written" ? "手写题" : "基础题"}`);
  }
  if (payload.difficulty) {
    requirements.push(`难度：${DRAFT_DIFFICULTY_LABELS[payload.difficulty]}`);
  }
  if (payload.seed?.trim()) requirements.push(`围绕这个种子展开：${payload.seed.trim()}`);
  if (kind === "glossary" && payload.seed?.trim() && !payload.existingTerm?.trim()) {
    // 词条的 term 直接决定「正文里的哪几个字会变蓝」：改成自己习惯的叫法虽然更通顺，
    // 却会让用户点不动刚划的那个词（词表是整词命中，不做语义归一）
    requirements.push(
      `词条的 term 必须与上面的种子原文逐字一致（就是用户在正文里划中的那一段），不要改写成别的叫法；全称 / 别称写进 en 或 aliases。`,
    );
  }
  if (kind === "glossary" && payload.existingTerm?.trim()) {
    requirements.push(
      `词条库里已经有「${payload.existingTerm.trim()}」${
        payload.existingShort?.trim() ? `（现有一句话定义：${payload.existingShort.trim()}）` : ""
      }：本次是**补充释义**，必须写出它没讲到的原理 / 边界 / 常见误解，不许复述现有定义，也不要把同名字再录一遍；`,
    );
  }

  return {
    system: composePrompt(
      roleBlock(ROLE_BY_KIND[kind]),
      categoryBlock(context.categories, payload.categoryId),
      coverageBlock(context.stats),
      siblingTitlesBlock(siblings, SIBLING_NOTE_BY_KIND[kind]),
      requirementBlock(requirements),
      constraintBlock(constraintsFor({ kind, count, diagramKind: payload.diagramKind })),
      outputBlock(format),
    ),
    prompt: promptFor({
      kind,
      count,
      category: category?.label ?? "当前分类",
      diagramKind: payload.diagramKind,
    }),
    outputFormat: format,
    ...(format.kind === "json-array" ? { count } : {}),
  };
}
