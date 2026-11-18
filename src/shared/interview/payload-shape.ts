/**
 * 面试题库产物的**结构层**校验（主进程与渲染层共用）
 *
 * 【为什么单独一层】
 * 题库的领域校验（分类白名单、图解 id 引用、词条键唯一）依赖
 * `pages/InterviewPage/data/` 下的基线常量，而主进程**从不 import 渲染层**
 * （`electron/**` 对 `@/windows` 零引用）。于是「渲染层校验一遍、主进程再校验一遍」
 * 若各写一份必然漂移 —— 漂移的后果是用户能存进一条 AI 已判非法、或反过来
 * 主进程静默改写过的数据。
 *
 * 解法：把**不依赖任何基线常量**的那一半抽到这里。
 *
 *   | 层 | 位置 | 查什么 |
 *   |---|---|---|
 *   | 结构 | 本文件（`src/shared/`） | 字段存在、类型、长度、`[object Object]`、JSON 残片 |
 *   | 领域 | `pages/InterviewPage/data/` | 分类白名单、引用完整性、键唯一 |
 *
 * 主进程落库前只跑结构层；渲染层采纳前跑结构 + 领域两层。本文件不 import
 * 任何页面代码，也不碰 IO —— 它是纯函数，可在 vitest 里直接跑。
 *
 * 【为什么长度上限写死在这里】
 * 上限要同时被三处尊重：AI 产出的解析（超长直接丢）、落库前的校验、UI 的
 * 字数提示。写三份等于允许三份不一致；写在这里是唯一产地。
 *
 * 规范：docs/spec/interview-db-ai-spec.md §11
 */

/** 产物类型（`interview_item.kind`） */
export type InterviewKind = "question" | "glossary" | "diagram";

export const INTERVIEW_KINDS: readonly InterviewKind[] = ["question", "glossary", "diagram"];

/** 轨道枚举（`interview_item.track`；图解为 null） */
export const QUESTION_TRACKS = ["written", "foundation"] as const;
export type QuestionTrackShape = (typeof QUESTION_TRACKS)[number];

/** 难度枚举 */
export const QUESTION_DIFFICULTIES = ["basic", "medium", "hard"] as const;
export type QuestionDifficultyShape = (typeof QUESTION_DIFFICULTIES)[number];

/** 图解图型枚举（与 `InterviewDiagram["kind"]` 同集合，此处不 import 页面类型） */
export const DIAGRAM_KINDS = ["flow", "timeline", "compare", "layers"] as const;
export type DiagramKindShape = (typeof DIAGRAM_KINDS)[number];

/**
 * 长度上限（唯一产地）。
 *
 * 数量级依据：现有最长答案是「手写 Promise」那类，约 3000 字；8000 留足余量
 * 但不至于让一条脏数据把列表拖死。词条 `short` 卡 80 字是因为弹层首屏只显示
 * 两行，超了就要滚动，反而没人读。
 */
export const SHAPE_LIMITS = {
  question: { title: 120, stem: 4000, stemCode: 4000, answer: 8000, topic: 60, tags: 12, tag: 24 },
  glossary: { term: 24, en: 60, short: 80, detail: 6, detailItem: 200, aliases: 8, related: 8 },
  diagram: { title: 80, caption: 200, steps: 8, step: 200, note: 300, nodes: 12, layers: 8, events: 12 },
} as const;

/** 校验结果：成功带归一后的值，失败带人话错误（直接进 `errors_json` 显示为红字） */
export type ShapeResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** 校验通过后的题目（只有结构层保证的字段；领域字段原样透传） */
export interface QuestionShape {
  id: string;
  title: string;
  stem: string;
  stemCode?: string;
  stemCodeLang?: string;
  answer: string;
  diagramId?: string;
  track: QuestionTrackShape;
  categoryId: string;
  difficulty: QuestionDifficultyShape;
  tags: string[];
  topic: string;
  source?: { label: string; url?: string; license?: string };
  reviewedAt: string;
  heat: number;
  updatedAt: string;
}

export interface GlossaryShape {
  id: string;
  term: string;
  en?: string;
  aliases?: string[];
  domain: string;
  short: string;
  detail: string[];
  related?: string[];
  categoryId?: string;
}

/**
 * 流程图的节点：`{ label, note? }`（对齐 `data/interview-diagrams.ts` 的 `DiagramNode`）。
 *
 * 【为什么 flow 与 timeline 必须分成两个类型】
 * 两种图读的键名不同：`flow` 用 `label` / `note`，`timeline` 用 `title` / `detail`。
 * 早先两类共用 `DiagramNodeShape`（只有 `label` / `note`），于是时序图**读**的时候
 * 按 `title` / `detail` 取、**写**的时候统一输出 `label` / `note` —— 落库的
 * `payload_json` 键名被悄悄改写，渲染层读 `event.title` 拿到 undefined，
 * 时间轴直接空白。类型分开之后，「写错键名」是编译错误而不是线上白屏。
 */
export interface DiagramFlowNode {
  label: string;
  note?: string;
  tone?: string;
}

/** 时序图的节点：`{ title, detail? }`（对齐 `DiagramEvent`） */
export interface DiagramEventNode {
  title: string;
  detail?: string;
  tone?: string;
}

export interface DiagramShape {
  id: string;
  kind: DiagramKindShape;
  title: string;
  caption: string;
  steps?: string[];
  note?: string;
  nodes?: DiagramFlowNode[];
  events?: DiagramEventNode[];
  left?: { title: string; note?: string; items: string[] };
  right?: { title: string; note?: string; items: string[] };
  layers?: Array<{ label: string; note?: string; tags?: string[] }>;
}

/**
 * 对象被字符串化后的经典残片（`String({})`）。
 *
 * 判据是**整个字段值恰好等于它**，不是「出现过」：`written-memoize` 这道题
 * 的答案正文里就写着 `[object Object]`（它讲的就是「对象被拼成字符串」这个坑），
 * 按「出现过」判会把一道正确的基线题判成损坏 —— 用户点编辑改完保存必被拒，
 * 而错误文案还说「内容已损坏」。
 */
const OBJECT_STRING = "[object Object]";

/**
 * 残片信号一：**引号包起来的键 + 冒号**。
 *
 * 只有 JSON 对象才有这个形态（`"title":`、`'name':`、`` `id`： ``），
 * 正文里不会出现「引号 + 标识符 + 引号 + 冒号」这种组合。
 */
function hasQuotedKeyColon(value: string): boolean {
  return /["'`]\s*[A-Za-z_$][\w$]*\s*["'`]\s*[:：]/.test(value);
}

/**
 * 残片信号二：**方括号 / 花括号不成对**。
 *
 * 半截数组被切碎时最典型的形态是 `[1,2,3`（少了右括号）。反过来，
 * `[3,1,4,1,5,9]`、`{ value, done }`、`[[Prototype]]`、`tails[i]` 这些
 * **成对**的写法是技术正文的日常内容（8 条基线就倒在这上面），必须放行。
 *
 * 圆括号不参与判定：正文里 `（补充说明）`、`(a)` 太常见，而原判据本来
 * 也只管方括号与花括号。
 */
const OPEN_BRACKETS = new Set(["[", "{"]);
const CLOSE_BRACKETS = new Set(["]", "}"]);

function hasUnbalancedBrackets(value: string): boolean {
  let depth = 0;
  for (const ch of value) {
    if (OPEN_BRACKETS.has(ch)) {
      depth += 1;
      continue;
    }
    if (CLOSE_BRACKETS.has(ch)) {
      depth -= 1;
      // 右括号比左括号多：立刻判残片（不必等结尾）
      if (depth < 0) return true;
    }
  }
  return depth !== 0;
}

/** 单行字段里混进 JSON 结构字符 = 模型把结构写进了内容里，不是正常文本 */
function looksLikeStructureNoise(value: string): boolean {
  return hasQuotedKeyColon(value) || hasUnbalancedBrackets(value);
}

interface TextRule {
  /** 字段中文名，用于报错（用户看得到，不写字段名写人话） */
  label: string;
  min?: number;
  max: number;
  /** 单行字段：禁换行、禁 JSON 结构残片（题干/答案里的代码必须放行） */
  singleLine?: boolean;
}

function readText(
  source: Record<string, unknown>,
  key: string,
  rule: TextRule,
  errors: string[],
): string | undefined {
  const raw = source[key];
  if (raw === undefined || raw === null) {
    if ((rule.min ?? 0) > 0) errors.push(`${rule.label}不能为空`);
    return undefined;
  }
  if (typeof raw !== "string") {
    errors.push(`${rule.label}必须是文本`);
    return undefined;
  }
  const value = raw.trim();
  if (value.length < (rule.min ?? 0)) {
    errors.push(`${rule.label}不能为空`);
    return undefined;
  }
  if (value.length > rule.max) {
    errors.push(`${rule.label}太长（上限 ${rule.max} 字，当前 ${value.length} 字）`);
    return undefined;
  }
  if (value === OBJECT_STRING) {
    errors.push(`${rule.label}整段就是 [object Object]，是对象被硬拼成了字符串，内容已损坏`);
    return undefined;
  }
  if (rule.singleLine && looksLikeStructureNoise(value)) {
    errors.push(`${rule.label}里混入了 JSON 结构字符，像是没解析干净的残片`);
    return undefined;
  }
  if (rule.singleLine && /[\r\n]/.test(value)) {
    errors.push(`${rule.label}不能换行`);
    return undefined;
  }
  return value;
}

function readEnum<T extends string>(
  source: Record<string, unknown>,
  key: string,
  label: string,
  allowed: readonly T[],
  errors: string[],
): T | undefined {
  const raw = source[key];
  if (typeof raw !== "string" || !(allowed as readonly string[]).includes(raw)) {
    errors.push(`${label}只能是 ${allowed.join(" / ")} 之一`);
    return undefined;
  }
  return raw as T;
}

function readStringList(
  source: Record<string, unknown>,
  key: string,
  rule: { label: string; max: number; itemMax: number; min?: number },
  errors: string[],
): string[] | undefined {
  const raw = source[key];
  if (raw === undefined || raw === null) {
    if ((rule.min ?? 0) > 0) errors.push(`${rule.label}不能为空`);
    return undefined;
  }
  if (!Array.isArray(raw)) {
    errors.push(`${rule.label}必须是列表`);
    return undefined;
  }
  if (raw.length < (rule.min ?? 0)) {
    errors.push(`${rule.label}不能为空`);
    return undefined;
  }
  if (raw.length > rule.max) {
    errors.push(`${rule.label}最多 ${rule.max} 项`);
    return undefined;
  }
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      errors.push(`${rule.label}的每一项都必须是文本`);
      return undefined;
    }
    const value = item.trim();
    if (!value) continue;
    if (value.length > rule.itemMax) {
      errors.push(`${rule.label}的单项太长（上限 ${rule.itemMax} 字）`);
      return undefined;
    }
    if (value === OBJECT_STRING) {
      errors.push(`${rule.label}里有对象被硬拼成了字符串`);
      return undefined;
    }
    out.push(value);
  }
  return out;
}

function readInt(
  source: Record<string, unknown>,
  key: string,
  label: string,
  min: number,
  max: number,
  errors: string[],
): number | undefined {
  const raw = source[key];
  const num = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < min || num > max) {
    errors.push(`${label}必须是 ${min}~${max} 的整数`);
    return undefined;
  }
  return num;
}

/** 归一任意输入为普通对象（AI 解析产物 / 导入的 JSON / 渲染层手构造都走这里） */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * 题目结构校验。
 *
 * 只查「这一段 JSON 是不是一道题」，不查 `categoryId` 在不在 22 个基线分类里
 * —— 那是领域层的事，且新增分类（`u-c-*`）本来就合法。
 */
export function isValidQuestionShape(value: unknown): ShapeResult<QuestionShape> {
  const source = asRecord(value);
  if (!source) return { ok: false, errors: ["题目内容不是一个对象"] };
  const errors: string[] = [];
  const L = SHAPE_LIMITS.question;

  const id = readText(source, "id", { label: "题目 id", min: 1, max: 64, singleLine: true }, errors);
  const title = readText(source, "title", { label: "题目标题", min: 1, max: L.title, singleLine: true }, errors);
  const stem = readText(source, "stem", { label: "题干", min: 1, max: L.stem }, errors);
  const answer = readText(source, "answer", { label: "参考答案", min: 1, max: L.answer }, errors);
  const track = readEnum(source, "track", "轨道", QUESTION_TRACKS, errors);
  const difficulty = readEnum(source, "difficulty", "难度", QUESTION_DIFFICULTIES, errors);
  const categoryId = readText(
    source,
    "categoryId",
    { label: "分类", min: 1, max: 64, singleLine: true },
    errors,
  );
  const topic = readText(source, "topic", { label: "来源主题", min: 1, max: L.topic, singleLine: true }, errors);
  const tags = readStringList(
    source,
    "tags",
    { label: "标签", max: L.tags, itemMax: L.tag },
    errors,
  );
  const reviewedAt = readText(
    source,
    "reviewedAt",
    { label: "校对时间", min: 1, max: 10, singleLine: true },
    errors,
  );
  const updatedAt = readText(
    source,
    "updatedAt",
    { label: "更新时间", min: 1, max: 10, singleLine: true },
    errors,
  );
  const heat = readInt(source, "heat", "热度", 0, 100, errors);

  const stemCode = readText(
    source,
    "stemCode",
    { label: "题干代码", max: L.stemCode },
    errors,
  );
  const stemCodeLang = readText(
    source,
    "stemCodeLang",
    { label: "代码语言", max: 20, singleLine: true },
    errors,
  );
  const diagramId = readText(
    source,
    "diagramId",
    { label: "关联图解", max: 64, singleLine: true },
    errors,
  );

  let sourceRef: QuestionShape["source"];
  const rawSource = asRecord(source.source);
  if (rawSource) {
    const label = readText(
      rawSource,
      "label",
      { label: "出处名称", min: 1, max: 60, singleLine: true },
      errors,
    );
    const url = readText(rawSource, "url", { label: "出处链接", max: 300, singleLine: true }, errors);
    const license = readText(
      rawSource,
      "license",
      { label: "出处许可协议", max: 60, singleLine: true },
      errors,
    );
    if (label) sourceRef = { label, ...(url ? { url } : {}), ...(license ? { license } : {}) };
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      id: id as string,
      title: title as string,
      stem: stem as string,
      answer: answer as string,
      track: track as QuestionTrackShape,
      categoryId: categoryId as string,
      difficulty: difficulty as QuestionDifficultyShape,
      tags: tags ?? [],
      topic: topic as string,
      reviewedAt: reviewedAt as string,
      heat: heat as number,
      updatedAt: updatedAt as string,
      ...(stemCode ? { stemCode } : {}),
      ...(stemCodeLang ? { stemCodeLang } : {}),
      ...(diagramId ? { diagramId } : {}),
      ...(sourceRef ? { source: sourceRef } : {}),
    },
  };
}

/** 词条结构校验（`domain` 只查非空，合法域集合属领域层） */
export function isValidGlossaryShape(value: unknown): ShapeResult<GlossaryShape> {
  const source = asRecord(value);
  if (!source) return { ok: false, errors: ["词条内容不是一个对象"] };
  const errors: string[] = [];
  const L = SHAPE_LIMITS.glossary;

  const id = readText(source, "id", { label: "词条 id", min: 1, max: 64, singleLine: true }, errors);
  const term = readText(source, "term", { label: "词条名", min: 1, max: L.term, singleLine: true }, errors);
  const domain = readText(source, "domain", { label: "词条领域", min: 1, max: 32, singleLine: true }, errors);
  const short = readText(source, "short", { label: "一句话定义", min: 1, max: L.short, singleLine: true }, errors);
  const en = readText(source, "en", { label: "英文全称", max: L.en, singleLine: true }, errors);
  const aliases = readStringList(
    source,
    "aliases",
    { label: "别名", max: L.aliases, itemMax: L.term },
    errors,
  );
  const related = readStringList(
    source,
    "related",
    { label: "相关词条", max: L.related, itemMax: 64 },
    errors,
  );
  const detail = readStringList(
    source,
    "detail",
    { label: "展开细节", max: L.detail, itemMax: L.detailItem, min: 1 },
    errors,
  );
  const categoryId = readText(
    source,
    "categoryId",
    { label: "分类", max: 64, singleLine: true },
    errors,
  );

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      id: id as string,
      term: term as string,
      domain: domain as string,
      short: short as string,
      detail: detail ?? [],
      ...(en ? { en } : {}),
      ...(aliases?.length ? { aliases } : {}),
      ...(related?.length ? { related } : {}),
      ...(categoryId ? { categoryId } : {}),
    },
  };
}

/**
 * 节点读出来的**中性形态**。
 *
 * 键名（`label`/`note` 还是 `title`/`detail`）由调用方按图型还原 —— 早先这里
 * 直接输出 `{ label, note }`，时序图读 `title` 写 `label`，落库后键名就被改写了。
 * 把「读」与「写」的键名解耦：这里只保证内容正确，键名归 `isValidDiagramShape`
 * 的两个分支各自负责（见 `DiagramFlowNode` / `DiagramEventNode` 的注释）。
 */
interface NodeText {
  text: string;
  note?: string;
  tone?: string;
}

function readNodeList(
  source: Record<string, unknown>,
  key: string,
  rule: {
    label: string;
    max: number;
    labelMax: number;
    noteMax: number;
    min?: number;
    /** 节点文字用的键名：flow 用 label，timeline 用 title */
    textKey: "label" | "title";
    /** 节点补充说明用的键名：flow 用 note，timeline 用 detail */
    noteKey: "note" | "detail";
  },
  errors: string[],
): NodeText[] | undefined {
  const raw = source[key];
  if (!Array.isArray(raw)) {
    if ((rule.min ?? 0) > 0) errors.push(`${rule.label}必须是非空列表`);
    return undefined;
  }
  if (raw.length < (rule.min ?? 0)) {
    errors.push(`${rule.label}至少 ${rule.min} 项`);
    return undefined;
  }
  if (raw.length > rule.max) {
    errors.push(`${rule.label}最多 ${rule.max} 项`);
    return undefined;
  }
  const out: NodeText[] = [];
  for (const item of raw) {
    const node = asRecord(item);
    if (!node) {
      errors.push(`${rule.label}的每一项都必须是对象`);
      return undefined;
    }
    const text = readText(
      node,
      rule.textKey,
      { label: `${rule.label}项文字`, min: 1, max: rule.labelMax, singleLine: true },
      errors,
    );
    // 键名固定，不做「label 没有就试 title」的兜底：兜底会让缺字段的错误
    // 记在错的键上，用户按报错去改也改不好
    const note = readText(
      node,
      rule.noteKey,
      { label: `${rule.label}项补充说明`, max: rule.noteMax, singleLine: true },
      errors,
    );
    const tone = readText(
      node,
      "tone",
      { label: `${rule.label}项语气`, max: 16, singleLine: true },
      errors,
    );
    if (!text) continue;
    out.push({
      text,
      ...(note ? { note } : {}),
      ...(tone ? { tone } : {}),
    });
  }
  return out;
}

function readColumn(
  source: Record<string, unknown>,
  key: string,
  label: string,
  errors: string[],
): DiagramShape["left"] {
  const raw = asRecord(source[key]);
  if (!raw) {
    errors.push(`${label}必须是对象`);
    return undefined;
  }
  const title = readText(raw, "title", { label: `${label}标题`, min: 1, max: 30, singleLine: true }, errors);
  const note = readText(raw, "note", { label: `${label}总述`, max: 80, singleLine: true }, errors);
  const items = readStringList(
    raw,
    "items",
    { label: `${label}条目`, max: 10, itemMax: 60, min: 1 },
    errors,
  );
  if (!title || !items?.length) return undefined;
  return { title, items, ...(note ? { note } : {}) };
}

/**
 * 图解结构校验。
 *
 * 按 `kind` 分别查必填分支：`flow` 要 `nodes`、`timeline` 要 `events`、
 * `compare` 要 `left`/`right`、`layers` 要 `layers`。缺失不是「渲染时兜底」而是
 * 直接判非法 —— 一张画不出来的图留在库里只会让人以为数据坏了。
 */
export function isValidDiagramShape(value: unknown): ShapeResult<DiagramShape> {
  const source = asRecord(value);
  if (!source) return { ok: false, errors: ["图解内容不是一个对象"] };
  const errors: string[] = [];
  const L = SHAPE_LIMITS.diagram;

  const id = readText(source, "id", { label: "图解 id", min: 1, max: 64, singleLine: true }, errors);
  const kind = readEnum(source, "kind", "图型", DIAGRAM_KINDS, errors);
  const title = readText(source, "title", { label: "图解标题", min: 1, max: L.title, singleLine: true }, errors);
  const caption = readText(
    source,
    "caption",
    { label: "图解说明", min: 1, max: L.caption, singleLine: true },
    errors,
  );
  const steps = readStringList(
    source,
    "steps",
    { label: "编号步骤", max: L.steps, itemMax: L.step },
    errors,
  );
  const note = readText(source, "note", { label: "易错提示", max: L.note, singleLine: true }, errors);

  const base: DiagramShape = {
    id: id as string,
    kind: kind as DiagramKindShape,
    title: title as string,
    caption: caption as string,
    ...(steps?.length ? { steps } : {}),
    ...(note ? { note } : {}),
  };

  if (kind === "flow") {
    const nodes = readNodeList(
      source,
      "nodes",
      {
        label: "流程节点",
        max: L.nodes,
        labelMax: 40,
        noteMax: 80,
        min: 2,
        textKey: "label",
        noteKey: "note",
      },
      errors,
    );
    // 键名在这里落地：FlowDiagram.nodes 是 { label, note, tone }（见 data/interview-diagrams.ts）
    if (nodes) {
      base.nodes = nodes.map((node) => ({
        label: node.text,
        ...(node.note ? { note: node.note } : {}),
        ...(node.tone ? { tone: node.tone } : {}),
      }));
    }
  } else if (kind === "timeline") {
    const events = readNodeList(
      source,
      "events",
      {
        label: "时序事件",
        max: L.events,
        labelMax: 40,
        noteMax: 100,
        min: 2,
        textKey: "title",
        noteKey: "detail",
      },
      errors,
    );
    // 时序图必须写成 { title, detail } —— 写回 label/note 会让 DiagramFigure
    // 读不到 event.title（时间轴空白），是 F1 那条缺陷的现场
    if (events) {
      base.events = events.map((event) => ({
        title: event.text,
        ...(event.note ? { detail: event.note } : {}),
        ...(event.tone ? { tone: event.tone } : {}),
      }));
    }
  } else if (kind === "compare") {
    const left = readColumn(source, "left", "左栏", errors);
    const right = readColumn(source, "right", "右栏", errors);
    if (left) base.left = left;
    if (right) base.right = right;
  } else if (kind === "layers") {
    const raw = source.layers;
    if (!Array.isArray(raw)) {
      errors.push("分层列表必须是非空列表");
    } else if (raw.length < 2 || raw.length > L.layers) {
      errors.push(`分层数量必须在 2~${L.layers} 之间`);
    } else {
      const layers: NonNullable<DiagramShape["layers"]> = [];
      for (const item of raw) {
        const layer = asRecord(item);
        const label = layer
          ? readText(layer, "label", { label: "分层名称", min: 1, max: 30, singleLine: true }, errors)
          : undefined;
        if (!layer || !label) {
          if (!layer) errors.push("每一层都必须是对象");
          continue;
        }
        const layerNote = readText(layer, "note", { label: "分层说明", max: 80, singleLine: true }, errors);
        const tags = readStringList(
          layer,
          "tags",
          { label: "分层关键字", max: 6, itemMax: 20 },
          errors,
        );
        layers.push({
          label,
          ...(layerNote ? { note: layerNote } : {}),
          ...(tags?.length ? { tags } : {}),
        });
      }
      base.layers = layers;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: base };
}

/** 按类型分发（handler 里只有一处调用，避免每个通道自己 switch） */
export function validatePayloadShape(
  kind: InterviewKind,
  value: unknown,
): ShapeResult<QuestionShape | GlossaryShape | DiagramShape> {
  if (kind === "question") return isValidQuestionShape(value);
  if (kind === "glossary") return isValidGlossaryShape(value);
  if (kind === "diagram") return isValidDiagramShape(value);
  return { ok: false, errors: [`未知的产物类型：${String(kind)}`] };
}
