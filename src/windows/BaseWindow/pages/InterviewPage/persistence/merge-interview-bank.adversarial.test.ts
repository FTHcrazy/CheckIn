/**
 * 合并视图 / 词条匹配器 / 基线指纹的**对抗性**验证（独立于 `*.test.ts` 三份单测）。
 *
 * 那三份单测用「手写小基线 + 字面量断言」，好处是红了能一眼看出差在哪；代价是
 * 它只覆盖作者想到的情况。这里换两个方向下手：
 *
 * 1. **用真实题库当输入**（243 题 / 全部词条 / 24 图解 / 22 分类）。手写样例喂不出
 *    「`FiberNode` 与 `最长递增子序列` 同段命中」这种文本，也压不出 `linked` 里
 *    几百条覆盖行的行为 —— 而用户每天看的就是这些文本。
 * 2. **专挑边界与污染输入**：被改过 id 的 payload、`baseId` 指向已删题、同 `base_id`
 *    多行、payload 是字符串 / 数字 / 数组、空基线、`action='baseline'`、深度 40 层对象、
 *    自引用对象、`ack_base_hash` 缺失的行。
 *
 * 断言只钉**用户可感知的正确行为**：收藏会不会丢、正文高亮会不会悄悄变、
 * 删掉的题会不会被升级复活、一屏列表会不会突然带上几百 KB 答案。
 * 内部数据结构与 warning 文案全文不钉（只钉「warning 里点得出是哪一条」）。
 *
 * 规范：docs/spec/interview-db-ai-spec.md §5.1-§5.5 / §10.2 / §10.4
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { isValidDiagramShape, isValidGlossaryShape, validatePayloadShape } from "@/shared/interview/payload-shape";
import { QUESTION_BANK } from "../data/interview-bank";
import { DIAGRAMS } from "../data/interview-diagrams";
import { GLOSSARY_TERMS, splitByGlossary, type GlossaryTerm } from "../data/interview-glossary";
import { CATEGORIES, type CategoryNode } from "../data/interview-taxonomy";
import type { FlowDiagram, InterviewDiagram, TimelineDiagram } from "../data/interview-diagrams";
import type { InterviewQuestion } from "../data/interview-types";
import { buildGlossaryIndex } from "./glossary-matcher";
import { hashPayload, stableStringify } from "./interview-hash";
import { mergeInterviewBank, type MergeBaseline, type MergeRow } from "./merge-interview-bank";

// ──────────────────────────── 夹具 ────────────────────────────

function makeQuestion(overrides: Partial<InterviewQuestion> = {}): InterviewQuestion {
  return {
    id: "js-event-loop",
    title: "事件循环里微任务与宏任务的执行顺序",
    stem: "同步代码 → Promise.then → setTimeout，输出顺序是什么？",
    answer: "同步 → 微任务 → 宏任务。",
    track: "foundation",
    categoryId: "foundation-js",
    difficulty: "medium",
    tags: ["事件循环"],
    topic: "JS 异步模型",
    reviewedAt: "2026-01",
    heat: 88,
    updatedAt: "2026-01-15",
    ...overrides,
  };
}

function makeTerm(overrides: Partial<GlossaryTerm> = {}): GlossaryTerm {
  return {
    id: "closure",
    term: "闭包",
    en: "Closure",
    domain: "javascript",
    short: "函数记住了定义时所在作用域里的变量。",
    detail: ["即使外层作用域已经执行完，变量仍然活着。"],
    ...overrides,
  };
}

function makeDiagram(overrides: Partial<FlowDiagram> = {}): InterviewDiagram {
  return {
    id: "dg-react-diff",
    kind: "flow",
    title: "React Diff 三条策略",
    caption: "只比同层、类型不同直接重建、同层按 key 配对。",
    nodes: [{ label: "新旧两棵 Fiber 树" }, { label: "记录副作用" }],
    ...overrides,
  };
}

const CATS: CategoryNode[] = [
  { id: "foundation-js", label: "JavaScript", track: "foundation", order: 7 },
  { id: "foundation-react", label: "React", track: "foundation", order: 9 },
];

const QUESTION_A = makeQuestion();
const QUESTION_B = makeQuestion({
  id: "js-closure",
  title: "闭包为什么会造成内存泄漏",
  stem: "循环里 setTimeout 拿到同一个 i，为什么？",
  answer: "因为 var 没有块级作用域。",
  tags: ["闭包"],
  heat: 70,
});
const TERM_A = makeTerm();
const DIAGRAM_A = makeDiagram();

/** 手写小基线：断言能写成字面量，红了能一眼看出差在哪 */
const BASELINE: MergeBaseline = {
  questions: [QUESTION_A, QUESTION_B],
  glossary: [TERM_A],
  diagrams: [DIAGRAM_A],
  categories: CATS,
};

/** 真实基线：用来压规模与真实文本 */
const REAL_BASELINE: MergeBaseline = {
  questions: QUESTION_BANK,
  glossary: GLOSSARY_TERMS,
  diagrams: DIAGRAMS,
  categories: CATEGORIES,
};

function makeRow(overrides: Partial<MergeRow> = {}): MergeRow {
  return {
    id: "js-event-loop",
    kind: "question",
    action: "override",
    baseId: "js-event-loop",
    status: "adopted",
    title: "事件循环里微任务与宏任务的执行顺序",
    payload: null,
    baseStamp: "2026-01",
    // 默认与「当前基线」一致：不写这一项的话每一行都会被判成「基线已更新」
    baseHash: hashPayload(QUESTION_A),
    ackBaseHash: null,
    updatedAt: 1_000,
    ...overrides,
  };
}

function merge(rows: readonly MergeRow[]): ReturnType<typeof mergeInterviewBank> {
  return mergeInterviewBank(BASELINE, rows, hashPayload);
}

function mergeReal(rows: readonly MergeRow[]): ReturnType<typeof mergeInterviewBank> {
  return mergeInterviewBank(REAL_BASELINE, rows, hashPayload);
}

/** warning 里点得出是哪一条（文案会改，id 不会） */
function warnsAbout(warnings: readonly string[], needle: string): boolean {
  return warnings.some((warning) => warning.includes(needle));
}

function idsOf(items: readonly { id: string }[]): string[] {
  return items.map((item) => item.id);
}

// ──────────────────── ① override 必须回流基线 id ────────────────────

describe("① override 强制回流基线 id（收藏 / React key 都按 id 认人）", () => {
  it("payload.id 被改成别的东西时，结果 id 仍是基线 id", () => {
    const result = merge([makeRow({ payload: makeQuestion({ id: "js-event-loop-hacked" }) })]);
    const question = result.questions.find((item) => item.id === "js-event-loop");
    expect(question).toBeDefined();
    expect(question?.id).toBe("js-event-loop");
    // 除了 id，内容仍然是用户版（不能因为纠 id 把内容也丢了）
    expect(question?.answer).toBe(QUESTION_A.answer);
  });

  it("payload.id 被改成另一个基线题的 id 时，两个 id 都不串位", () => {
    const result = merge([makeRow({ payload: makeQuestion({ id: "js-closure" }) })]);
    expect(idsOf(result.questions)).toEqual(["js-event-loop", "js-closure"]);
    // 被覆盖的那道题内容来自用户版，未被覆盖的那道题仍是自己的基线内容
    expect(result.questions[0]).toMatchObject({
      id: "js-event-loop",
      answer: QUESTION_A.answer,
    });
    expect(result.questions[1]).toEqual(QUESTION_B);
  });

  it("payload.id 改成 u- 前缀（伪装成用户新建）也压回基线 id", () => {
    const result = merge([makeRow({ payload: makeQuestion({ id: "u-q-x" }) })]);
    expect(idsOf(result.questions)).toEqual(["js-event-loop", "js-closure"]);
    expect(warnsAbout(result.warnings, "u-q-x")).toBe(false);
  });

  it("不就地改写调用方传进来的 payload（后续保存会用到原对象）", () => {
    const payload = makeQuestion({ id: "js-event-loop-hacked" });
    merge([makeRow({ payload })]);
    expect(payload.id).toBe("js-event-loop-hacked");
  });

  it("全量真实基线：243 条覆盖行（每条都改过 id）不许丢也不能造出新 id", () => {
    const baselineIds = idsOf(QUESTION_BANK);
    const rows = QUESTION_BANK.map((question) =>
      makeRow({
        id: question.id,
        baseId: question.id,
        title: question.title,
        payload: { ...question, id: `hacked-${question.id}` },
        baseHash: hashPayload(question),
      }),
    );
    const result = mergeReal(rows);
    expect(idsOf(result.questions)).toEqual(baselineIds);
    expect(result.questions.some((item) => item.id.startsWith("hacked-"))).toBe(false);
    // warnings 不在这里断言：语料里本身有过不了结构校验的条目（见 ⑯），
    // 它们会各自留下一条 warning，与本用例「id 不许被改」的主张无关。
  });

  it("覆盖行 payload.id 整个缺失 → 结构校验不通过，回落基线（题不消失）", () => {
    const withoutId: Record<string, unknown> = { ...makeQuestion() };
    delete withoutId.id;
    const result = merge([makeRow({ payload: withoutId })]);
    expect(result.questions[0]).toEqual(QUESTION_A);
    expect(warnsAbout(result.warnings, QUESTION_A.title)).toBe(true);
  });
});

// ──────────────────── ② hidden 绝不出现（§5.3）────────────────────

describe("② hidden 墓碑绝不出现，且升级不复活（§5.3 硬要求）", () => {
  it("喂一条 hidden 进去：不在 questions 里，在 hiddenIds 里", () => {
    const result = merge([makeRow({ status: "hidden", payload: null })]);
    expect(idsOf(result.questions)).toEqual(["js-closure"]);
    expect(result.hiddenIds).toEqual(["js-event-loop"]);
  });

  it("墓碑带着内容副本（导入的脏数据）也不许漏出来", () => {
    const result = merge([
      makeRow({ status: "hidden", payload: makeQuestion({ answer: "不该出现" }) }),
    ]);
    expect(result.questions.some((item) => item.id === "js-event-loop")).toBe(false);
    expect(JSON.stringify(result.questions)).not.toContain("不该出现");
    expect(result.hiddenIds).toEqual(["js-event-loop"]);
  });

  it("baseId 为 null 的墓碑（老数据 / 手写导入）也认得出 base 是谁", () => {
    const result = merge([makeRow({ status: "hidden", baseId: null, payload: null })]);
    expect(result.questions.some((item) => item.id === "js-event-loop")).toBe(false);
    expect(result.hiddenIds).toEqual(["js-event-loop"]);
  });

  it("同一 base_id 有覆盖 + 墓碑两行时，墓碑（更新的一条）赢", () => {
    const result = merge([
      makeRow({ id: "u-import-a", payload: makeQuestion({ answer: "一版内容" }), updatedAt: 100 }),
      makeRow({ id: "u-import-b", status: "hidden", payload: null, updatedAt: 200 }),
    ]);
    expect(result.questions.some((item) => item.id === "js-event-loop")).toBe(false);
    expect(result.hiddenIds).toEqual(["js-event-loop"]);
  });

  it("词条被隐藏 → 从结果剔除，且合并后的词表里不再高亮它", () => {
    const result = merge([
      makeRow({
        id: "closure",
        kind: "glossary",
        baseId: "closure",
        status: "hidden",
        payload: null,
        baseHash: hashPayload(TERM_A),
      }),
    ]);
    expect(result.glossary).toEqual([]);
    const index = buildGlossaryIndex(result.glossary);
    expect(index.split("闭包会记住变量")).toEqual([{ text: "闭包会记住变量" }]);
  });

  it("图解被隐藏 → 从结果剔除", () => {
    const result = merge([
      makeRow({
        id: "dg-react-diff",
        kind: "diagram",
        baseId: "dg-react-diff",
        status: "hidden",
        payload: null,
        baseHash: hashPayload(DIAGRAM_A),
      }),
    ]);
    expect(result.diagrams).toEqual([]);
  });

  it("真实基线：藏掉 20 道题后剩 223 道，且被藏的全部记进 hiddenIds（不重不漏）", () => {
    const victims = QUESTION_BANK.slice(0, 20);
    const rows = victims.map((question) =>
      makeRow({
        id: question.id,
        baseId: question.id,
        status: "hidden",
        title: question.title,
        payload: null,
        baseHash: hashPayload(question),
      }),
    );
    const result = mergeReal(rows);
    expect(result.hiddenIds).toEqual(idsOf(victims));
    expect(result.questions).toHaveLength(QUESTION_BANK.length - victims.length);
    const present = new Set(idsOf(result.questions));
    expect(victims.some((question) => present.has(question.id))).toBe(false);
  });
});

// ──────────────── ③ new 行 id 必须 u- 前缀（§5.2 步骤 7）────────────────

describe("③ 用户新建（new）的 id 必须 u- 前缀：丢弃 + warning，绝不抛", () => {
  const LEGAL_NEW = makeRow({
    id: "u-q-legal",
    action: "new",
    baseId: null,
    baseHash: null,
    ackBaseHash: null,
    title: "合法的新建题",
    payload: makeQuestion({ id: "u-q-legal", title: "合法的新建题" }),
    updatedAt: 5_000,
  });

  function illegalNew(id: string): MergeRow {
    return {
      ...LEGAL_NEW,
      id,
      payload: makeQuestion({ id, title: `没有前缀的新增题 ${id}` }),
    };
  }

  it.each(["sneaky-id", "U-q-upper", "u", "u_q-underscore"])(
    "id=%s 没有 u- 前缀 → 丢弃并记 warning",
    (id) => {
      const result = merge([illegalNew(id)]);
      expect(idsOf(result.questions)).toEqual(["js-event-loop", "js-closure"]);
      expect(warnsAbout(result.warnings, id)).toBe(true);
      expect(warnsAbout(result.warnings, "u- 前缀")).toBe(true);
    },
  );

  it("一条坏行不打掉同批的好行", () => {
    const result = merge([illegalNew("sneaky-id"), LEGAL_NEW]);
    expect(idsOf(result.questions)).toEqual(["js-event-loop", "js-closure", "u-q-legal"]);
  });

  it("空 id 的 new 行不抛，也不产生空 id 条目", () => {
    const result = merge([illegalNew("")]);
    expect(result.questions.every((item) => item.id.length > 0)).toBe(true);
    expect(idsOf(result.questions)).toEqual(["js-event-loop", "js-closure"]);
  });

  it("主键有 u- 前缀、payload.id 没有 → 以主键为准（收藏按主键认人）", () => {
    const result = merge([
      { ...LEGAL_NEW, payload: makeQuestion({ id: "js-event-loop", title: "合法的新建题" }) },
    ]);
    const added = result.questions.find((item) => item.id === "u-q-legal");
    expect(added).toBeDefined();
    expect(idsOf(result.questions)).toEqual(["js-event-loop", "js-closure", "u-q-legal"]);
  });
});

// ──────── ④ 匹配器与旧实现逐字一致（旧实现 = 现网行为）────────

describe("④ buildGlossaryIndex 与 splitByGlossary 在真实文本上逐字一致", () => {
  const index = buildGlossaryIndex(GLOSSARY_TERMS);

  /** 真实语料：243 道题的题干 + 答案 + 标题（≥200 条，覆盖中英混排与代码块） */
  const texts: string[] = QUESTION_BANK.flatMap((question) => [
    question.stem,
    question.answer,
    question.title,
  ]);

  function segmentKeys(segments: readonly { text: string; term?: GlossaryTerm }[]): unknown[] {
    return segments.map((segment) => [segment.text, segment.term?.id]);
  }

  it(`取样条数够多（${texts.length} 条真实文本，其中不含空串）`, () => {
    expect(texts.length).toBeGreaterThanOrEqual(200);
    expect(texts.every((text) => text.length > 0)).toBe(true);
  });

  it("逐段一致：切段文本 + 命中词条 id 全部相同", () => {
    const offenders: string[] = [];
    for (const text of texts) {
      const expected = segmentKeys(splitByGlossary(text));
      const actual = segmentKeys(index.split(text));
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        offenders.push(`不一致：${text.slice(0, 40)}…`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("样例里确实命中了很多词条（否则这条回归是空跑）", () => {
    const hits = texts.reduce(
      (count, text) => count + index.split(text).filter((segment) => segment.term).length,
      0,
    );
    expect(hits).toBeGreaterThan(200);
  });

  it("termsIn 与 glossaryTermsIn 的去重顺序一致", () => {
    const offenders: string[] = [];
    for (const text of texts) {
      const expected = splitByGlossary(text)
        .map((segment) => segment.term?.id)
        .filter((id): id is string => typeof id === "string")
        .filter((id, position, list) => list.indexOf(id) === position);
      const actual = idsOf(index.termsIn(text));
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        offenders.push(`不一致：${text.slice(0, 40)}…`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("exact / byId 与旧实现一致（行内代码与「相关词条」都靠它）", () => {
    const offenders: string[] = [];
    for (const term of GLOSSARY_TERMS) {
      for (const key of [term.term, term.en, ...(term.aliases ?? [])]) {
        if (!key) continue;
        const hit = index.exact(key);
        // 旧实现只做小写化，不做 trim —— 这里断言两边对同一份基线键给出同一答案
        if (hit?.id !== term.id) offenders.push(`${key} → ${hit?.id ?? "未命中"}`);
      }
      if (index.byId(term.id)?.id !== term.id) offenders.push(`${term.id} 反查失败`);
    }
    expect(offenders).toEqual([]);
  });

  it("基线匹配键本身没有首尾空白（新实现多做的 trim 归一不改变现网行为）", () => {
    const offenders: string[] = [];
    for (const term of GLOSSARY_TERMS) {
      for (const key of [term.term, term.en, ...(term.aliases ?? [])]) {
        if (!key) continue;
        if (key !== key.trim()) offenders.push(`${term.id} → 「${key}」`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ──────────────────── ⑤ 偏移量可用（划词反算）────────────────────

describe("⑤ start / end 偏移量必须能反算原文（划词靠它）", () => {
  const index = buildGlossaryIndex(GLOSSARY_TERMS);
  const samples = [
    "闭包（closure）与作用域链，闭包还会持有变量",
    "FiberNode 里的 Fiber 不算命中，但 Fiber 算",
    "在 render 阶段不能放副作用；render 之前先算一下",
    "Promise.then 是微任务，setTimeout 是宏任务",
    "",
    "   ",
    ...QUESTION_BANK.slice(0, 60).flatMap((question) => [question.stem, question.answer]),
  ];

  it("text.slice(start, end) 恒等于 segment.text", () => {
    const offenders: string[] = [];
    for (const text of samples) {
      for (const segment of index.split(text)) {
        if (!segment.term) continue;
        if (text.slice(segment.start, segment.end) !== segment.text) {
          offenders.push(`${text.slice(0, 20)}… → ${segment.text}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("普通段不带偏移（只认命中段）", () => {
    for (const text of samples) {
      for (const segment of index.split(text)) {
        if (segment.term) continue;
        expect(segment.start).toBeUndefined();
        expect(segment.end).toBeUndefined();
      }
    }
  });

  it("命中区间严格递增且互不重叠", () => {
    for (const text of samples) {
      const hits = index.split(text).filter((segment) => segment.term);
      for (let position = 1; position < hits.length; position += 1) {
        expect(hits[position].start as number).toBeGreaterThanOrEqual(
          hits[position - 1].end as number,
        );
      }
    }
  });

  it("切段拼回原文无损（不丢字符、不加字符）", () => {
    for (const text of samples) {
      expect(
        index
          .split(text)
          .map((segment) => segment.text)
          .join(""),
      ).toBe(text);
    }
  });

  it("空文本返回空数组（旧实现同款）", () => {
    expect(index.split("")).toEqual([]);
    expect(splitByGlossary("")).toEqual([]);
  });

  it("旧实现不填偏移（TermText 等 30+ 调用点按「无偏移」工作）", () => {
    for (const segment of splitByGlossary("闭包（closure）")) {
      expect(segment.start).toBeUndefined();
      expect(segment.end).toBeUndefined();
    }
  });
});

// ───────── ⑥ withPayload 真的把 payload 带出来（源码断言 + 推演）─────────

describe("⑥ withPayload 链路：handler → preload → d.ts 没有断点", () => {
  function read(relative: string): string {
    return readFileSync(path.resolve(process.cwd(), relative), "utf8");
  }

  const HANDLERS = read("electron/handlers/interview/interview-handlers.ts");
  const PRELOAD = read("electron/preload.ts");
  const DTS = read("src/shared/types/electron.d.ts");

  /** 取一段源码（[from, to) 之间），to 缺省到文件尾 */
  function slice(source: string, from: string, to?: string): string {
    const start = source.indexOf(from);
    expect(start, `源码里找不到 ${from}`).toBeGreaterThan(-1);
    if (!to) return source.slice(start);
    const end = source.indexOf(to, start + from.length);
    expect(end, `源码里找不到 ${to}`).toBeGreaterThan(start);
    return source.slice(start, end);
  }

  it("handler：query.withPayload 为真走 toDetail，否则走 toSummary（两支不许写反）", () => {
    const block = slice(HANDLERS, '"interview-items-list"', '"interview-item-get"');
    expect(block).toMatch(/withPayload\?: boolean/);
    expect(block).toMatch(
      /query\?\.withPayload\s*\?\s*rows\.map\(toDetail\)\s*:\s*rows\.map\(toSummary\)/,
    );
  });

  it("toDetail 带 payload 字段，toSummary 一个 payload 字段都没有", () => {
    const detail = slice(HANDLERS, "function toDetail(", "function isInterviewKind");
    expect(detail).toMatch(/payload:\s*parseJson<unknown>\(row\.payload_json,\s*null\)/);

    const summary = slice(HANDLERS, "function toSummary(", "function toDetail(");
    expect(summary).not.toMatch(/payload/);
  });

  it("payload 是解析后的对象，不是 JSON 字符串（合并视图直接拿去用）", () => {
    const detail = slice(HANDLERS, "function toDetail(", "function isInterviewKind");
    expect(detail).toContain("parseJson<unknown>");
    // parseJson 自带 try/catch 兜底：坏一条不该让整页炸
    const parse = slice(HANDLERS, "function parseJson<T>(", "function toSummary(");
    expect(parse).toContain("catch");
  });

  it("preload 把 query 原样透传给通道（不是只挑几个字段重拼）", () => {
    const block = slice(PRELOAD, "itemsList: (query?: {", "itemGet:");
    expect(block).toMatch(/withPayload\?: boolean/);
    expect(block).toMatch(/trackedInvoke\('interview-items-list',\s*query\)/);
    // 反向守卫：不许出现「只传 kind / status」这种把 withPayload 丢掉的重拼
    expect(block).not.toMatch(/trackedInvoke\('interview-items-list',\s*\{/);
  });

  it("trackedInvoke 用展开参数把 query 交出去（不在这一层丢字段）", () => {
    const block = slice(PRELOAD, "function trackedInvoke(", "// 通过 contextBridge");
    expect(block).toMatch(/ipcRenderer\.invoke\(channel,\s*\.\.\.args\)/);
  });

  it("d.ts 的重载：withPayload: true → DetailDTO[]，不传 → SummaryDTO[]", () => {
    const block = slice(DTS, "    itemsList: {", "    itemGet:");
    expect(block).toMatch(
      /\(query: InterviewItemsListQueryDTO & \{ withPayload: true \}\): Promise<InterviewItemDetailDTO\[\]>/,
    );
    expect(block).toMatch(
      /\(query\?: InterviewItemsListQueryDTO\): Promise<InterviewItemSummaryDTO\[\]>/,
    );
    // DTO 上确实有这个字段，且摘要 DTO 没有 payload 字段声明
    const query = slice(
      DTS,
      "export interface InterviewItemsListQueryDTO {",
      "export interface InterviewItemSummaryDTO",
    );
    expect(query).toMatch(/withPayload\?: boolean/);
    const summary = slice(
      DTS,
      "export interface InterviewItemSummaryDTO {",
      "export interface InterviewItemDetailDTO",
    );
    expect(summary).not.toMatch(/^\s*payload\??:/m);
    const detail = slice(
      DTS,
      "export interface InterviewItemDetailDTO",
      "export interface InterviewTaxonomyDTO",
    );
    expect(detail).toMatch(/^\s*payload: unknown/m);
  });

  it("DetailDTO 覆盖 MergeRow 需要的每一列（缺一列合并就静默少一条）", () => {
    const detail = slice(
      DTS,
      "export interface InterviewItemDetailDTO",
      "export interface InterviewTaxonomyDTO",
    );
    const summary = slice(
      DTS,
      "export interface InterviewItemSummaryDTO {",
      "export interface InterviewItemDetailDTO",
    );
    // DetailDTO extends SummaryDTO：合并要的 id/kind/action/baseId/status/title/updatedAt
    // 都在摘要里，payload 与 base_hash 三兄弟在详情里
    for (const field of ["baseStamp", "baseHash", "ackBaseHash", "payload"]) {
      expect(detail, `DetailDTO 缺 ${field}`).toContain(`${field}:`);
    }
    for (const field of ["id", "kind", "action", "baseId", "status", "title", "updatedAt"]) {
      expect(summary, `SummaryDTO 缺 ${field}`).toContain(`${field}:`);
    }
  });
});

// ──────────────── ⑦ stableStringify 真的稳定吗 ────────────────

describe("⑦ stableStringify 的对抗输入", () => {
  it("键序不同的同一对象 → 同一结果（含嵌套三层）", () => {
    const left = { a: { y: [1, { q: 2, p: 3 }], x: "s" }, b: [true, null] };
    const right = { b: [true, null], a: { x: "s", y: [1, { p: 3, q: 2 }] } };
    expect(stableStringify(left)).toBe(stableStringify(right));
  });

  it("数组顺序不同 → 不同结果（下标就是语义）", () => {
    expect(stableStringify({ tags: ["a", "b"] })).not.toBe(
      stableStringify({ tags: ["b", "a"] }),
    );
  });

  it("undefined 字段跳过；数组里的 undefined 占位不跳过", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
    expect(stableStringify([1, undefined, 3])).toBe("[1,null,3]");
  });

  it("NaN / Infinity / -Infinity 一律 null（不是合法 JSON）", () => {
    expect(
      stableStringify({ a: Number.NaN, b: Number.POSITIVE_INFINITY, c: Number.NEGATIVE_INFINITY }),
    ).toBe('{"a":null,"b":null,"c":null}');
  });

  it("带 toJSON 的对象先走 toJSON（Date 与 JSON.stringify 对齐）", () => {
    const date = new Date("2026-01-15T00:00:00.000Z");
    expect(stableStringify({ at: date })).toBe(`{"at":${JSON.stringify(date.toJSON())}}`);
    // 自定义 toJSON 折叠后与「折叠后的内容」同值
    const wrapper = { toJSON: () => ({ b: 2, a: 1 }) };
    expect(stableStringify(wrapper)).toBe(stableStringify({ a: 1, b: 2 }));
  });

  it("字符串里的引号 / 换行 / 反斜杠按 JSON 规则转义（不与分隔符混淆）", () => {
    const tricky = 'a"b\nc\\d,e:f';
    expect(stableStringify({ k: tricky })).toBe(`{"k":${JSON.stringify(tricky)}}`);
  });

  it("深度 40 层不炸栈，且结果确定", () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let level = 0; level < 40; level += 1) deep = { child: deep };
    const once = stableStringify(deep);
    expect(once).toBe(stableStringify(deep));
    expect(once).toContain("超深嵌套");
  });

  it("自引用对象不炸栈（普通 JSON 不会有，但库里可能躺着脏数据）", () => {
    const loop: Record<string, unknown> = { name: "loop" };
    loop.self = loop;
    expect(() => stableStringify(loop)).not.toThrow();
    expect(stableStringify(loop)).toBe(stableStringify(loop));
  });

  it("bigint / function / symbol 都有确定结果且不抛", () => {
    expect(() =>
      stableStringify({ big: 1n, fn: () => 0, sym: Symbol("s") }),
    ).not.toThrow();
    expect(stableStringify({ big: 1n })).toBe('{"big":"1"}');
    expect(stableStringify({ fn: () => 0, sym: Symbol("s") })).toBe('{"fn":null,"sym":null}');
  });

  it("真实题库往返 JSON 后串不变（落库 → 读出 → 指纹必须还对得上）", () => {
    const offenders: string[] = [];
    for (const question of QUESTION_BANK) {
      const roundTrip = JSON.parse(JSON.stringify(question)) as unknown;
      if (stableStringify(roundTrip) !== stableStringify(question)) {
        offenders.push(question.id);
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ──────────────── ⑧ hashPayload 的碰撞与敏感性 ────────────────

describe("⑧ hashPayload：敏感、可复现、真实语料无碰撞", () => {
  it("形如 fp: + 8 位十六进制", () => {
    expect(hashPayload(makeQuestion())).toMatch(/^fp:[0-9a-f]{8}$/);
  });

  it("同内容的两个独立构造 → 同一指纹", () => {
    const built = { title: "事件循环", tags: ["微任务"], heat: 88 };
    const parsed = JSON.parse('{"heat":88,"tags":["微任务"],"title":"事件循环"}') as unknown;
    expect(hashPayload(parsed)).toBe(hashPayload(built));
  });

  it("改任一字段都必须变（新版修订才提示得出来）", () => {
    const base = makeQuestion();
    const variants: InterviewQuestion[] = [
      { ...base, title: `${base.title}（改）` },
      { ...base, stem: `${base.stem} 补充一句` },
      { ...base, answer: `${base.answer} 补充一句` },
      { ...base, tags: [...base.tags, "宏任务"] },
      { ...base, heat: base.heat + 1 },
      { ...base, difficulty: "hard" },
      { ...base, topic: `${base.topic}（改）` },
      { ...base, updatedAt: "2026-02-01" },
      { ...base, diagramId: "dg-react-diff" },
    ];
    const fingerprints = new Set([hashPayload(base), ...variants.map((item) => hashPayload(item))]);
    expect(fingerprints.size).toBe(variants.length + 1);
  });

  it("改一个字符（含大小写 / 空白）都要变", () => {
    const text = "Fiber 与 FiberNode 的区别";
    const variants = [text.replace("Fiber", "fiber"), `${text} `, text.replace("与", "和")];
    const fingerprints = new Set([text, ...variants].map((value) => hashPayload({ text: value })));
    expect(fingerprints.size).toBe(variants.length + 1);
  });

  it("真实语料里 243 题 + 词条 + 24 图解互相不撞指纹", () => {
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    const items: Array<[string, unknown]> = [
      ...QUESTION_BANK.map((question) => [`q:${question.id}`, question] as [string, unknown]),
      ...GLOSSARY_TERMS.map((term) => [`g:${term.id}`, term] as [string, unknown]),
      ...DIAGRAMS.map((diagram) => [`d:${diagram.id}`, diagram] as [string, unknown]),
    ];
    for (const [label, item] of items) {
      const fingerprint = hashPayload(item);
      const owner = seen.get(fingerprint);
      if (owner) collisions.push(`${owner} 与 ${label} 撞 ${fingerprint}`);
      seen.set(fingerprint, label);
    }
    expect(collisions).toEqual([]);
    expect(seen.size).toBe(items.length);
  });
});

// ───────── ⑨ 指纹 ↔ 落库 payload 的往返（base_hash 能不能对上）─────────

describe("⑨ base_hash 的往返一致性（写库路径与合并路径必须用同一把尺）", () => {
  /**
   * 为什么会漂：`interview-item-save` / `interview-import` 落库的是
   * `validatePayloadShape` 归一后的值（`JSON.stringify(checked.value)`）。如果渲染层
   * 用「落库内容」算 `base_hash`，而合并视图用「基线常量」算 `hashOf(base)`，两边
   * 归一程度不同就会算出两个值 —— 后果是**刚改完就提示「基线已更新」**，
   * 点「沿用我的」也压不住（下一版又对不上）。
   *
   * 这里只对「过得了一次结构校验」的条目主张这条不变式：过不了校验的条目根本进不了库
   * （save / import 会整条拒绝），它们的问题是「改不了」而不是「指纹漂」，单独在 ⑯ 上报。
   */
  function drift(
    items: readonly { id: string }[],
    kind: "question" | "glossary" | "diagram",
  ): string[] {
    const offenders: string[] = [];
    for (const item of items) {
      const checked = validatePayloadShape(kind, item);
      if (!checked.ok) {
        offenders.push(`${item.id}：过不了结构校验（${checked.errors[0]}）`);
        continue;
      }
      const roundTrip = JSON.parse(JSON.stringify(checked.value)) as unknown;
      if (hashPayload(roundTrip) !== hashPayload(item)) {
        offenders.push(`${item.id}：${hashPayload(item)} → ${hashPayload(roundTrip)}`);
      }
    }
    return offenders;
  }

  const validQuestions = QUESTION_BANK.filter(
    (question) => validatePayloadShape("question", question).ok,
  );
  const validTerms = GLOSSARY_TERMS.filter((term) => validatePayloadShape("glossary", term).ok);
  const validDiagrams = DIAGRAMS.filter((diagram) => validatePayloadShape("diagram", diagram).ok);

  it("能过结构校验的基线题：往返后指纹不变", () => {
    expect(validQuestions.length).toBeGreaterThanOrEqual(240);
    expect(drift(validQuestions, "question")).toEqual([]);
  });

  it("能过结构校验的基线词条：往返后指纹不变", () => {
    expect(drift(validTerms, "glossary")).toEqual([]);
  });

  it("24 张图解（四种图型全在内）：往返后指纹不变", () => {
    // F1 修好之前这里必须排除 timeline（两张步骤图的 events 键名会被改写）；
    // 修好之后**全类型**都得往返一致，所以把过滤去掉了 —— 这条是收紧，不是放宽。
    expect(validDiagrams).toHaveLength(DIAGRAMS.length);
    expect(drift(validDiagrams, "diagram")).toEqual([]);
  });
});

// ──────────────── ⑩ merge 的输入污染 ────────────────

describe("⑩ 输入污染：空输入、专有 action、未知 kind 都有确定行为且不抛", () => {
  it("rows 为空 → 输出等于基线，零上报", () => {
    const result = merge([]);
    expect(result.questions).toEqual([QUESTION_A, QUESTION_B]);
    expect(result.warnings).toEqual([]);
    expect(result.hiddenIds).toEqual([]);
    expect(result.orphaned).toEqual([]);
    expect(result.staleBase).toEqual([]);
  });

  it("空基线 + 有增量 → 不抛；新建题照进，覆盖行进 orphaned", () => {
    const empty: MergeBaseline = {
      questions: [],
      glossary: [],
      diagrams: [],
      categories: CATS,
    };
    const result = mergeInterviewBank(
      empty,
      [
        makeRow({
          id: "u-q-1",
          action: "new",
          baseId: null,
          baseHash: null,
          title: "只有增量",
          payload: makeQuestion({ id: "u-q-1", title: "只有增量" }),
        }),
        makeRow({ payload: makeQuestion() }),
      ],
      hashPayload,
    );
    expect(idsOf(result.questions)).toEqual(["u-q-1"]);
    expect(result.orphaned).toHaveLength(1);
    expect(result.categories).toEqual(CATS);
  });

  it.each([
    ["baseline", "full 导出文件里的专有值"],
    ["NEW", "大小写不一致"],
    ["", "空字符串"],
    ["override ", "尾部多了空白"],
  ])("action=%s（%s）→ 跳过该行 + warning，绝不抛", (action) => {
    const row = { ...makeRow({ payload: makeQuestion({ answer: "不该采用" }) }), action };
    const result = merge([row as unknown as MergeRow]);
    expect(result.questions).toEqual([QUESTION_A, QUESTION_B]);
    expect(warnsAbout(result.warnings, "无法识别")).toBe(true);
  });

  it("未知 kind 的 new 行被忽略，不抛、也不污染任何产物", () => {
    const result = merge([
      makeRow({
        id: "u-x-1",
        kind: "taxonomy",
        action: "new",
        baseId: null,
        baseHash: null,
        payload: { id: "u-x-1", label: "自定义分类" },
      }),
    ]);
    expect(result.questions).toEqual([QUESTION_A, QUESTION_B]);
    expect(result.glossary).toEqual([TERM_A]);
    expect(result.diagrams).toEqual([DIAGRAM_A]);
  });

  it("覆盖行 kind 与基线不对（id 恰好重名）→ 忽略这次覆盖 + warning，基线照出", () => {
    const result = merge([
      makeRow({ kind: "glossary", payload: makeTerm({ id: "js-event-loop" }) }),
    ]);
    expect(result.questions).toEqual([QUESTION_A, QUESTION_B]);
    expect(warnsAbout(result.warnings, "类型")).toBe(true);
  });

  it("不就地排序调用方传进来的 rows（上层还拿着这个数组）", () => {
    const rows = [
      makeRow({ id: "u-import-a", action: "new", baseId: null, payload: makeQuestion({ id: "u-import-a" }), updatedAt: 1 }),
      makeRow({ id: "u-import-b", action: "new", baseId: null, payload: makeQuestion({ id: "u-import-b" }), updatedAt: 9 }),
    ];
    merge(rows);
    expect(rows.map((row) => row.id)).toEqual(["u-import-a", "u-import-b"]);
  });
});

// ──────────────── ⑪ 同 base_id 多行（脏数据）────────────────

describe("⑪ 同一 base_id 多行：取最近更新的一条 + warning，结果与输入顺序无关", () => {
  function oldAndNew(): MergeRow[] {
    return [
      makeRow({ id: "u-import-old", payload: makeQuestion({ answer: "旧的一版" }), updatedAt: 100 }),
      makeRow({ id: "u-import-new", payload: makeQuestion({ answer: "新的一版" }), updatedAt: 200 }),
    ];
  }

  it("取 updatedAt 最大的那条", () => {
    const result = merge(oldAndNew());
    expect(result.questions[0].answer).toBe("新的一版");
    expect(warnsAbout(result.warnings, "重复的覆盖记录")).toBe(true);
  });

  it("把输入顺序倒过来还是同一条（不依赖数组顺序）", () => {
    const result = merge([...oldAndNew()].reverse());
    expect(result.questions[0].answer).toBe("新的一版");
    expect(result.questions).toHaveLength(2);
  });

  it("updatedAt 相同时结果确定（两次调用一致，不会一次一个样）", () => {
    const rows = [
      makeRow({ id: "u-import-a", payload: makeQuestion({ answer: "甲" }), updatedAt: 100 }),
      makeRow({ id: "u-import-b", payload: makeQuestion({ answer: "乙" }), updatedAt: 100 }),
    ];
    expect(merge(rows).questions[0].answer).toBe(merge(rows).questions[0].answer);
  });

  it("三行叠加也只渲染一条（不产生重复 React key）", () => {
    const result = merge([
      ...oldAndNew(),
      makeRow({ id: "u-import-third", payload: makeQuestion({ answer: "第三版" }), updatedAt: 300 }),
    ]);
    expect(idsOf(result.questions).filter((id) => id === "js-event-loop")).toHaveLength(1);
    expect(result.questions[0].answer).toBe("第三版");
  });
});

// ──────────────── ⑫ 孤儿覆盖（§5.2 步骤 6）────────────────

describe("⑫ 孤儿覆盖：上报、不渲染、id 一律不改", () => {
  const ORPHAN = makeRow({
    id: "u-q-imported",
    baseId: "js-removed",
    title: "新版删掉的那道题",
    payload: makeQuestion({ id: "u-q-imported", title: "新版删掉的那道题" }),
    baseHash: null,
  });

  it("进 orphaned、不进结果，且 id 报的是行主键而不是 baseId", () => {
    const result = merge([ORPHAN]);
    expect(result.orphaned).toEqual([
      { id: "u-q-imported", title: "新版删掉的那道题", baseStamp: "2026-01" },
    ]);
    expect(idsOf(result.questions)).toEqual(["js-event-loop", "js-closure"]);
    expect(warnsAbout(result.warnings, "新版删掉的那道题")).toBe(true);
  });

  it("孤儿行的 payload 再坏也不抛（它根本不该被解析影响渲染）", () => {
    for (const payload of [null, "残片", 42, [1, 2], { id: "u-q-imported" }]) {
      const result = merge([{ ...ORPHAN, payload }]);
      expect(result.orphaned).toHaveLength(1);
      expect(result.questions).toHaveLength(2);
    }
  });

  it("墓碑型的孤儿也一并上报（维护面板要看得到），且不复活任何题", () => {
    const result = merge([{ ...ORPHAN, status: "hidden", payload: null }]);
    expect(result.orphaned).toHaveLength(1);
    expect(result.questions).toHaveLength(2);
    expect(result.hiddenIds).toEqual([]);
  });

  it("真实基线：指向已删题 10 条覆盖 → 10 条孤儿，243 题一道不少", () => {
    const rows = Array.from({ length: 10 }, (_, position) =>
      makeRow({
        id: `u-q-orphan-${position}`,
        baseId: `gone-${position}`,
        title: `已删题 ${position}`,
        payload: makeQuestion({ id: `u-q-orphan-${position}` }),
        baseHash: null,
      }),
    );
    const result = mergeReal(rows);
    expect(result.orphaned).toHaveLength(10);
    expect(result.questions).toHaveLength(QUESTION_BANK.length);
  });
});

// ──────────────── ⑬ 坏 payload（单条不许打掉整页）────────────────

describe("⑬ 坏 payload：new 丢弃、override 回落基线（不是留个空壳）", () => {
  const BROKEN: unknown[] = [
    null,
    "",
    "   ",
    "[object Object]",
    "{}",
    { id: "x" },
    [1, 2, 3],
    42,
    true,
    '{"id":"x","title":',
  ];

  it.each(BROKEN.map((payload) => [JSON.stringify(payload) ?? "undefined", payload]))(
    "new 行 payload=%s → 丢弃 + warning，基线一道不少",
    (_label, payload) => {
      const result = merge([
        makeRow({
          id: "u-q-broken",
          action: "new",
          baseId: null,
          baseHash: null,
          payload,
        }),
      ]);
      expect(result.questions).toEqual([QUESTION_A, QUESTION_B]);
      expect(warnsAbout(result.warnings, "u-q-broken")).toBe(true);
    },
  );

  it.each(BROKEN.map((payload) => [JSON.stringify(payload) ?? "undefined", payload]))(
    "override 行 payload=%s → 回落基线内容（字段齐全，不是空壳）",
    (_label, payload) => {
      const result = merge([makeRow({ payload })]);
      const question = result.questions[0];
      expect(question).toEqual(QUESTION_A);
      expect(question.title).toBe(QUESTION_A.title);
      expect(question.stem).toBe(QUESTION_A.stem);
      expect(question.answer).toBe(QUESTION_A.answer);
      expect(question.tags).toEqual(QUESTION_A.tags);
      expect(idsOf(result.questions)).toEqual(["js-event-loop", "js-closure"]);
    },
  );

  it("payload 是**合法**的 JSON 字符串（导入路径）→ 正常采纳", () => {
    const payload = JSON.stringify(makeQuestion({ answer: "从导入文件来的内容" }));
    const result = merge([makeRow({ payload })]);
    expect(result.questions[0].answer).toBe("从导入文件来的内容");
    expect(result.questions[0].id).toBe("js-event-loop");
  });

  it("payload 过了结构校验但分类已删 → 内容保留、分类回落基线 + warning", () => {
    const result = merge([makeRow({ payload: { ...makeQuestion(), categoryId: "u-c-deleted" } })]);
    expect(result.questions[0].categoryId).toBe("foundation-js");
    expect(warnsAbout(result.warnings, "u-c-deleted")).toBe(true);
  });

  it("新增题分类已删 → 题保留（按未分类处理），不静默丢弃", () => {
    const result = merge([
      makeRow({
        id: "u-q-new-cat",
        action: "new",
        baseId: null,
        baseHash: null,
        payload: { ...makeQuestion({ id: "u-q-new-cat" }), categoryId: "u-c-deleted" },
      }),
    ]);
    const added = result.questions.find((item) => item.id === "u-q-new-cat");
    expect(added).toBeDefined();
    expect(warnsAbout(result.warnings, "u-q-new-cat")).toBe(true);
  });

  it("一条坏覆盖不影响同批其它覆盖（脏数据是单条事故）", () => {
    const result = merge([
      makeRow({ payload: "[object Object]" }),
      makeRow({
        id: "js-closure",
        baseId: "js-closure",
        title: QUESTION_B.title,
        payload: { ...QUESTION_B, answer: "我改过的闭包答案" },
        baseHash: hashPayload(QUESTION_B),
      }),
    ]);
    expect(result.questions[0]).toEqual(QUESTION_A);
    expect(result.questions[1].answer).toBe("我改过的闭包答案");
  });
});

// ──────────────── ⑭ 升级提示（§5.4）────────────────

describe("⑭ staleBase 判定（三条分支 + 不自动挑边）", () => {
  it("baseHash 与当前基线一致 → 不提示", () => {
    const result = merge([makeRow({ payload: makeQuestion({ answer: "我的版本" }) })]);
    expect(result.staleBase).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("baseHash 对不上 → 进 staleBase，但内容仍是用户版", () => {
    const result = merge([
      makeRow({ baseHash: "fp:00000000", payload: makeQuestion({ answer: "我的版本" }) }),
    ]);
    expect(result.staleBase).toEqual([{ id: "js-event-loop", baseStamp: "2026-01" }]);
    expect(result.questions[0].answer).toBe("我的版本");
  });

  it("ackBaseHash 等于当前基线 → 不再提示，内容不动", () => {
    const result = merge([
      makeRow({
        baseHash: "fp:00000000",
        ackBaseHash: hashPayload(QUESTION_A),
        payload: makeQuestion({ answer: "我的版本" }),
      }),
    ]);
    expect(result.staleBase).toEqual([]);
    expect(result.questions[0].answer).toBe("我的版本");
  });

  it("baseHash 为 null 的行按规范判为「已更新」并提示（导入行要带 base_hash）", () => {
    // §5.4 的判定就是「base_hash !== hashOf(当前) && ack !== hashOf(当前)」，
    // null 落进不等式 → 提示。这里钉住这个**已知**语义：写库路径必须带上 base_hash，
    // 否则导入进来的覆盖行一进库就显示「新版已修订」。
    const result = merge([
      makeRow({ baseHash: null, payload: makeQuestion({ answer: "我的版本" }) }),
    ]);
    expect(result.staleBase).toEqual([{ id: "js-event-loop", baseStamp: "2026-01" }]);
    expect(warnsAbout(result.warnings, "在新版已修订")).toBe(true);
  });

  it("墓碑与坏 payload 都不产生 staleBase（内容回落的题没有「我的版本」可挑边）", () => {
    expect(merge([makeRow({ status: "hidden", payload: null })]).staleBase).toEqual([]);
    // payload 坏了 → 回落基线内容，recordStale 根本不会被调用
    expect(merge([makeRow({ payload: null, baseHash: "fp:00000000" })]).staleBase).toEqual([]);
    expect(merge([makeRow({ payload: "[object Object]" })]).warnings.join()).toContain(
      QUESTION_A.title,
    );
  });

  it("真实基线：243 条覆盖行都基于当前基线 → 一条 stale 都不该有", () => {
    const rows = QUESTION_BANK.map((question) =>
      makeRow({
        id: question.id,
        baseId: question.id,
        title: question.title,
        payload: { ...question, answer: `${question.answer}（我的补充）` },
        baseHash: hashPayload(question),
      }),
    );
    const result = mergeReal(rows);
    expect(result.staleBase).toEqual([]);
    expect(result.questions).toHaveLength(QUESTION_BANK.length);
  });
});

// ──────────────── ⑮ 真实基线的整体不变式 ────────────────

describe("⑮ 真实题库的规模与不变式（用户可感知的「题库还在不在」）", () => {
  it("干净合并：题 / 词条 / 图 / 分类数量与基线一致，id 全局唯一", () => {
    const result = mergeReal([]);
    expect(result.questions).toHaveLength(QUESTION_BANK.length);
    expect(result.glossary).toHaveLength(GLOSSARY_TERMS.length);
    expect(result.diagrams).toHaveLength(DIAGRAMS.length);
    expect(result.categories).toHaveLength(CATEGORIES.length);
    expect(new Set(idsOf(result.questions)).size).toBe(result.questions.length);
    expect(new Set(idsOf(result.glossary)).size).toBe(result.glossary.length);
    expect(new Set(idsOf(result.diagrams)).size).toBe(result.diagrams.length);
  });

  it("题库规模没有被合并层悄悄缩水（243 题 / 22 分类 / 24 图）", () => {
    expect(QUESTION_BANK.length).toBeGreaterThanOrEqual(240);
    expect(CATEGORIES).toHaveLength(22);
    expect(DIAGRAMS).toHaveLength(24);
    expect(GLOSSARY_TERMS.length).toBeGreaterThanOrEqual(90);
  });

  it("基线顺序不被重排（升级后老题不许跳位）", () => {
    expect(idsOf(mergeReal([]).questions)).toEqual(idsOf(QUESTION_BANK));
  });

  it("真实基线 + 全量覆盖：仍是 243 条、顺序不变、id 唯一", () => {
    const rows = QUESTION_BANK.map((question) =>
      makeRow({
        id: question.id,
        baseId: question.id,
        title: question.title,
        payload: { ...question, answer: `${question.answer} 补一句` },
        baseHash: hashPayload(question),
      }),
    );
    const result = mergeReal(rows);
    expect(idsOf(result.questions)).toEqual(idsOf(QUESTION_BANK));
    expect(new Set(idsOf(result.questions)).size).toBe(QUESTION_BANK.length);
    // 每道题都真的换成了用户版（不是「全回落基线」那种假绿）。
    // 只有「过不了结构校验」的条目会回落 —— 那份清单由 ⑯ 单独主张，
    // 这里对账的是「回落集合 === 不可编辑集合」，修好 ⑯ 后这条会自动跟上。
    const uneditable = new Set(
      QUESTION_BANK.filter((question) => !validatePayloadShape("question", question).ok).map(
        (question) => question.id,
      ),
    );
    const fellBack = result.questions
      .filter((question) => !question.answer.endsWith("补一句"))
      .map((question) => question.id);
    expect(fellBack).toEqual([...uneditable]);
    expect(result.questions.length - fellBack.length).toBeGreaterThanOrEqual(240);
  });

  it("new 与 override 混排：新增按 updatedAt 倒序追加在基线之后", () => {
    const result = mergeReal([
      makeRow({
        id: "u-q-slow",
        action: "new",
        baseId: null,
        baseHash: null,
        payload: makeQuestion({ id: "u-q-slow", title: "先加的" }),
        updatedAt: 1,
      }),
      makeRow({
        id: "u-q-fast",
        action: "new",
        baseId: null,
        baseHash: null,
        payload: makeQuestion({ id: "u-q-fast", title: "后加的" }),
        updatedAt: 2,
      }),
      makeRow({
        id: "js-event-loop",
        baseId: "js-event-loop",
        payload: { ...QUESTION_A, answer: "我的版本" },
        baseHash: hashPayload(QUESTION_A),
      }),
    ]);
    const ids = idsOf(result.questions);
    expect(ids.slice(0, QUESTION_BANK.length)).toEqual(idsOf(QUESTION_BANK));
    expect(ids.slice(QUESTION_BANK.length)).toEqual(["u-q-fast", "u-q-slow"]);
  });
});

// ───────── ⑯ 回归：F1 / F2 修复后必须保持（曾是 it.fails，现已转正）─────────
/**
 * 这两条是当初钉住「已上报 Engineer」的两个缺陷的用例。缺陷由
 * `src/shared/interview/payload-shape.ts` 修复（timeline 键名各自落地 / 闸门收紧口径），
 * 断言文本一个字没改就直接绿了 —— 说明修的是缺陷而不是把断言改软了。
 *
 * 它们现在的身份是**回归防线**：谁再把 `events` 写成 `{ label, note }`，
 * 或者把守门条件放宽到拦掉技术正文，这两条立刻红。
 */
describe("⑯ 回归：timeline 键名保真 + 基线全量可编辑", () => {
  it("timeline 图解的 events 键名保真：title/detail 不被改写成 label/note", () => {
    // 用户什么都没改，只是「编辑 → 保存」了一张步骤图。
    // 当初结构校验把 events 建成 { label, note }，而 TimelineDiagram.events 是
    // { title, detail } —— DiagramFigure 拿到的事件全是空标题空说明（时间轴一片空白），
    // 同一条根因还让 dg-webpack-flow / dg-tcp-handshake 的基线指纹漂移（见 ⑨）。
    const baseline = DIAGRAMS.find((diagram) => diagram.id === "dg-webpack-flow");
    expect(baseline).toBeDefined();
    const timeline = baseline as TimelineDiagram;

    const result = mergeReal([
      makeRow({
        id: timeline.id,
        kind: "diagram",
        baseId: timeline.id,
        title: timeline.title,
        payload: timeline,
        baseHash: hashPayload(timeline),
      }),
    ]);
    const merged = result.diagrams.find((diagram) => diagram.id === timeline.id) as
      | TimelineDiagram
      | undefined;
    expect(merged).toBeDefined();
    expect((merged as TimelineDiagram).events.map((event) => event.title)).toEqual(
      timeline.events.map((event) => event.title),
    );
    // 不只是标题：detail 与 tone 也要原样过一遍（避免「只修了 title」的半修）
    expect((merged as TimelineDiagram).events.map((event) => event.detail)).toEqual(
      timeline.events.map((event) => event.detail),
    );
  });

  it("基线全量都能过结构校验（过不了的条目用户永远改不了）", () => {
    // 当初这 8 条被误拦：written-memoize 的答案里写着 `[object Object]`（它讲的就是
    // 对象被拼成字符串这个坑）；prototype-chain 的 short 里有 `[[Prototype]]`；
    // iterator-protocol 有 `{ value, done }`；dg-quicksort / dg-mergesort /
    // dg-sliding-window 的事件说明里有 `[3,1,4,1,5,9,2,6]`；dg-binary-search / dg-lis
    // 的 caption 里有 `[left, right]`。
    // 后面 ⑰ 会把「该拦的仍被拦 / 该放的已经放」逐条钉死。
    const offenders: string[] = [];
    const check = (kind: "question" | "glossary" | "diagram", item: { id: string }): void => {
      const checked = validatePayloadShape(kind, item);
      if (!checked.ok) offenders.push(`${kind} ${item.id}：${checked.errors[0]}`);
    };
    for (const question of QUESTION_BANK) check("question", question);
    for (const term of GLOSSARY_TERMS) check("glossary", term);
    for (const diagram of DIAGRAMS) check("diagram", diagram);
    expect(offenders).toEqual([]);
  });
});

// ───── ⑰ F1 / F2 / P3 修复的独立复核（不看工程师的测试，自己造输入验一遍）─────
/**
 * 复核原则：**既要证明修好了，也要证明没把闸门拆了**。
 * 修 F1 的方式是「键名按图型分别落地」，所以要验**两个方向**（写对 / 写错都拦住）；
 * 修 F2 的方式是把 misfire 的判据收紧，所以要验「真残片仍被拦」+「技术正文已放行」两侧。
 */
describe("⑰ 修复复核：图解键名两个方向 + 闸门松紧两侧 + 导入路径的 warning", () => {
  /** 流程图的键名：label / note */
  function flowProbe(): Record<string, unknown> {
    return {
      id: "dg-flow-probe",
      kind: "flow",
      title: "探针流程图：验证节点键名",
      caption: "用来验证键名落地的探针图。",
      nodes: [
        { label: "起点", note: "第一条说明", tone: "primary" },
        { label: "终点" },
      ],
    };
  }

  /** 时序图的键名：title / detail */
  function timelineProbe(): Record<string, unknown> {
    return {
      id: "dg-timeline-probe",
      kind: "timeline",
      title: "探针时序图：验证事件键名",
      caption: "用来验证事件键名落地的探针图。",
      events: [
        { title: "第一步", detail: "先做这个", tone: "warning" },
        { title: "第二步" },
      ],
    };
  }

  it("flow：校验后节点键名仍是 label / note（不许多出 title / detail）", () => {
    const checked = isValidDiagramShape(flowProbe());
    expect(checked.ok).toBe(true);
    const nodes = checked.ok ? checked.value.nodes : undefined;
    expect(nodes).toEqual([
      { label: "起点", note: "第一条说明", tone: "primary" },
      { label: "终点" },
    ]);
    expect(Object.keys(nodes?.[0] as object)).toEqual(["label", "note", "tone"]);
  });

  it("timeline：校验后事件键名是 title / detail（F1 的现场，不许再变 label / note）", () => {
    const checked = isValidDiagramShape(timelineProbe());
    expect(checked.ok).toBe(true);
    const events = checked.ok ? checked.value.events : undefined;
    expect(events).toEqual([
      { title: "第一步", detail: "先做这个", tone: "warning" },
      { title: "第二步" },
    ]);
    expect(Object.keys(events?.[0] as object)).toEqual(["title", "detail", "tone"]);
  });

  it("两种图过一遍校验后与输入完全相等（校验不该是「改内容」）", () => {
    for (const probe of [flowProbe(), timelineProbe()]) {
      const checked = isValidDiagramShape(probe);
      expect(checked.ok).toBe(true);
      expect(checked.ok ? checked.value : null).toEqual(probe);
      expect(JSON.parse(JSON.stringify(checked.ok ? checked.value : null))).toEqual(probe);
    }
  });

  it("反向：timeline 的事件写成 label / note → 判非法（键名写错必须拦住）", () => {
    const broken = {
      ...timelineProbe(),
      events: [
        { label: "第一步", note: "先做这个" },
        { label: "第二步" },
      ],
    };
    const checked = isValidDiagramShape(broken);
    expect(checked.ok).toBe(false);
    expect(checked.ok ? [] : checked.errors.join()).toContain("时序事件项文字不能为空");
  });

  it("反向：flow 的节点写成 title / detail → 判非法", () => {
    const broken = {
      ...flowProbe(),
      nodes: [
        { title: "起点", detail: "第一条说明" },
        { title: "终点" },
      ],
    };
    expect(isValidDiagramShape(broken).ok).toBe(false);
  });

  /** 用词条的 `short`（singleLine）当载体验闸门：其余字段沿用合法词条 */
  function shortOk(text: string): boolean {
    return isValidGlossaryShape({ ...TERM_A, short: text }).ok;
  }

  it.each([
    ['{"title": "x', "半截 JSON 对象（花括号不成对 + 引号键）"],
    ['"name": "foo', "引号包住的键 + 冒号"],
    ["`id`：", "反引号键 + 中文冒号"],
    ["'key' :", "单引号键 + 空格后的冒号"],
    ["[1,2,3", "半截数组（方括号不成对）"],
    ["{ value, done", "半截对象字面量"],
    ["先看 [a, b", "正文里带半截方括号"],
    ["]1,2[", "右括号比左括号多"],
    ["[object Object]", "整段就是对象残片"],
  ])("仍被拦：%s（%s）", (text) => {
    expect(shortOk(text)).toBe(false);
  });

  it.each([
    ["[3,1,4,1,5,9]", "成对括号的数组字面量"],
    ["{ value, done }", "成对花括号的对象字面量"],
    ["[[Prototype]]", "双层方括号"],
    ["tails[i]", "下标访问"],
    ["[left, right]", "区间写法"],
    ["用对象当键时 [object Object] 全撞在一起", "正文里提到对象残片（不是整段等于）"],
    ["（补充说明）括号不参与判定", "圆括号不参与"],
    ['他说 "先这样" 就行', "引号但没有键冒号"],
  ])("已放行：%s（%s）", (text) => {
    expect(shortOk(text)).toBe(true);
  });

  it("拦住的原因对得上（不是被长度 / 其它规则误伤，否则这两条是假阳）", () => {
    const noise = isValidGlossaryShape({ ...TERM_A, short: '{"title": "x' });
    expect(noise.ok).toBe(false);
    expect(noise.ok ? "" : noise.errors.join()).toContain("混入了 JSON 结构字符");
    const residue = isValidGlossaryShape({ ...TERM_A, short: "[object Object]" });
    expect(residue.ok).toBe(false);
    expect(residue.ok ? "" : residue.errors.join()).toContain("整段就是 [object Object]");
  });

  it("导入路径（payload 是 JSON **字符串**）现在也报「payload id 被改过」", () => {
    const payload = JSON.stringify(
      makeQuestion({ id: "u-q-string-id", title: "字符串 payload 的新增题" }),
    );
    const result = merge([
      makeRow({ id: "u-q-imported", action: "new", baseId: null, baseHash: null, payload }),
    ]);
    expect(result.questions.some((item) => item.id === "u-q-imported")).toBe(true);
    expect(warnsAbout(result.warnings, "被改成了 u-q-string-id")).toBe(true);
  });

  it("对照：字符串 payload 的 id 与主键一致时不该有这条 warning（不是无脑报）", () => {
    const payload = JSON.stringify(
      makeQuestion({ id: "u-q-same-id", title: "字符串 payload 的新增题" }),
    );
    const result = merge([
      makeRow({ id: "u-q-same-id", action: "new", baseId: null, baseHash: null, payload }),
    ]);
    expect(warnsAbout(result.warnings, "被改成了")).toBe(false);
  });
});
