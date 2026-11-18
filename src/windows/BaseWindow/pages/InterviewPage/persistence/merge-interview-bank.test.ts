import { describe, expect, it } from "vitest";
import type { InterviewQuestion } from "../data/interview-types";
import type { GlossaryTerm } from "../data/interview-glossary";
import type { FlowDiagram, InterviewDiagram } from "../data/interview-diagrams";
import type { CategoryNode } from "../data/interview-taxonomy";
import { hashPayload } from "./interview-hash";
import {
  mergeInterviewBank,
  type MergeBaseline,
  type MergeResult,
  type MergeRow,
} from "./merge-interview-bank";

/**
 * 合并视图守卫（§5.2 七步 + §5.3 墓碑不可 purge）。
 *
 * 这些断言对应的都是「不报错、只是数据悄悄错」的退化：
 * hidden 复活（用户删了个寂寞）、override 被基线盖掉（用户改了个寂寞）、
 * `new` 行换了 id（收藏全丢）、坏 payload 打掉整页。
 * 用**手写小基线**而不是真题库：断言能写成 `toEqual` 字面量，红了能一眼看出差在哪。
 */
const CATEGORIES: CategoryNode[] = [
  { id: "foundation-js", label: "JavaScript", track: "foundation", order: 7 },
  { id: "foundation-react", label: "React", track: "foundation", order: 9 },
];

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

const BASELINE: MergeBaseline = {
  questions: [QUESTION_A, QUESTION_B],
  glossary: [TERM_A],
  diagrams: [DIAGRAM_A],
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

function merge(rows: readonly MergeRow[]): MergeResult {
  return mergeInterviewBank(BASELINE, rows, hashPayload);
}

describe("无增量（干净基线）", () => {
  it("输出等于基线，且没有任何上报", () => {
    const result = merge([]);
    expect(result.questions).toEqual([QUESTION_A, QUESTION_B]);
    expect(result.glossary).toEqual([TERM_A]);
    expect(result.diagrams).toEqual([DIAGRAM_A]);
    expect(result.categories).toEqual(CATEGORIES);
    expect(result.hiddenIds).toEqual([]);
    expect(result.orphaned).toEqual([]);
    expect(result.staleBase).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("基线顺序不被重排（升级后老题不许跳位）", () => {
    const result = merge([]);
    expect(result.questions.map((item) => item.id)).toEqual(["js-event-loop", "js-closure"]);
  });
});

describe("覆盖基线题（override）", () => {
  it("用行内 payload 替换基线内容", () => {
    const result = merge([
      makeRow({ payload: makeQuestion({ answer: "我的版本：补了 Node 与浏览器差异。" }) }),
    ]);
    const question = result.questions.find((item) => item.id === "js-event-loop");
    expect(question?.answer).toBe("我的版本：补了 Node 与浏览器差异。");
    // 未覆盖的那道题仍然跟随基线
    expect(result.questions).toHaveLength(2);
    expect(result.questions[1]).toEqual(QUESTION_B);
  });

  it("强制 payload.id = 基线 id（导入文件改过 id 也不认）", () => {
    const result = merge([makeRow({ payload: makeQuestion({ id: "js-event-loop-hacked" }) })]);
    expect(result.questions[0].id).toBe("js-event-loop");
    expect(result.questions.map((item) => item.id)).toEqual(["js-event-loop", "js-closure"]);
  });

  it("分类不在白名单 → 回落基线分类并记 warning", () => {
    // 自定义分类（`u-c-*`）不在 `InterviewQuestion["categoryId"]` 的 22 个基线字面量里，
    // 这里模拟「库里残留了一条指向已删分类的覆盖行」
    const payload = { ...makeQuestion(), categoryId: "u-c-deleted" };
    const result = merge([makeRow({ payload })]);
    expect(result.questions[0].categoryId).toBe("foundation-js");
    expect(result.warnings.join()).toContain("u-c-deleted");
  });
});

describe("隐藏基线题（墓碑）", () => {
  it("喂一条 hidden 进去，该题不出现（§5.3 硬要求）", () => {
    const result = merge([makeRow({ status: "hidden", payload: null })]);
    expect(result.questions.map((item) => item.id)).toEqual(["js-closure"]);
    expect(result.hiddenIds).toEqual(["js-event-loop"]);
  });

  it("hidden 行带上 payload 也不许漏出来", () => {
    // 正常写入会清空墓碑的 payload_json，但导入的脏数据可能带一份内容副本
    const result = merge([
      makeRow({ status: "hidden", payload: makeQuestion({ answer: "不该出现" }) }),
    ]);
    expect(result.questions.map((item) => item.id)).toEqual(["js-closure"]);
    expect(result.hiddenIds).toEqual(["js-event-loop"]);
  });

  it("词条被隐藏后从结果里剔除（正文不再变蓝）", () => {
    const result = merge([
      makeRow({ id: "closure", kind: "glossary", baseId: "closure", status: "hidden", payload: null }),
    ]);
    expect(result.glossary).toEqual([]);
  });
});

describe("用户新增（new）", () => {
  const NEW_SLOW = makeRow({
    id: "u-q-1",
    action: "new",
    baseId: null,
    baseHash: null,
    title: "StrictMode 下 useEffect 为什么执行两次",
    payload: makeQuestion({
      id: "u-q-1",
      title: "StrictMode 下 useEffect 为什么执行两次",
      categoryId: "foundation-react",
    }),
    updatedAt: 2_000,
  });
  const NEW_FAST = makeRow({
    id: "u-q-2",
    action: "new",
    baseId: null,
    baseHash: null,
    title: "useMemo 与 useCallback 的分工",
    payload: makeQuestion({
      id: "u-q-2",
      title: "useMemo 与 useCallback 的分工",
      categoryId: "foundation-react",
    }),
    updatedAt: 3_000,
  });

  it("追加在基线之后，且按 updatedAt 倒序", () => {
    const result = merge([NEW_SLOW, NEW_FAST]);
    expect(result.questions.map((item) => item.id)).toEqual([
      "js-event-loop",
      "js-closure",
      "u-q-2",
      "u-q-1",
    ]);
  });

  it("草稿 / 已驳回不进合并视图（只活在草稿箱）", () => {
    const result = merge([{ ...NEW_SLOW, status: "draft" }, { ...NEW_FAST, status: "rejected" }]);
    expect(result.questions).toHaveLength(2);
  });

  it("回收站（deleted）不进合并视图", () => {
    const result = merge([{ ...NEW_SLOW, status: "deleted" }]);
    expect(result.questions).toHaveLength(2);
  });
});

describe("升级提示（staleBase，§5.4）", () => {
  it("baseHash 对不上当前基线 → 进 staleBase", () => {
    const result = merge([makeRow({ baseHash: "fp:00000000", payload: makeQuestion() })]);
    expect(result.staleBase).toEqual([{ id: "js-event-loop", baseStamp: "2026-01" }]);
    // 合并算法不自动挑边：内容仍然是用户版
    expect(result.questions[0].answer).toBe(QUESTION_A.answer);
  });

  it("点过「沿用我的」（ackBaseHash 等于当前基线指纹）→ 不再提示", () => {
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

  it("没改过基线（baseHash 与当前一致）→ 不提示", () => {
    const result = merge([makeRow({ payload: makeQuestion({ answer: "我的版本" }) })]);
    expect(result.staleBase).toEqual([]);
  });
});

describe("孤儿覆盖（§5.2 步骤 6）", () => {
  it("覆盖指向的基线已不存在 → 上报但不进结果，id 不被改", () => {
    const result = merge([
      makeRow({
        id: "js-removed",
        baseId: "js-removed",
        title: "新版删掉的那道题",
        baseHash: null,
        payload: makeQuestion({ id: "js-removed", title: "新版删掉的那道题" }),
      }),
    ]);
    expect(result.orphaned).toEqual([
      { id: "js-removed", title: "新版删掉的那道题", baseStamp: "2026-01" },
    ]);
    expect(result.questions.map((item) => item.id)).toEqual(["js-event-loop", "js-closure"]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("坏数据（单条不许打掉整页）", () => {
  it("新增题的 payload 残缺 → 丢弃该条并记 warning", () => {
    const result = merge([
      makeRow({ id: "u-q-broken", action: "new", baseId: null, baseHash: null, payload: { id: "u-q-broken" } }),
    ]);
    expect(result.questions).toHaveLength(2);
    expect(result.warnings.join()).toContain("u-q-broken");
  });

  it("payload 是没解析干净的字符串 → 丢该条，不抛", () => {
    const result = merge([
      makeRow({
        id: "u-q-broken",
        action: "new",
        baseId: null,
        baseHash: null,
        payload: '{"id":"u-q-broken","title":',
      }),
    ]);
    expect(result.questions).toHaveLength(2);
    expect(result.warnings.join()).toContain("u-q-broken");
  });

  it("覆盖行的 payload 坏了 → 回落基线内容（题不消失），并记 warning", () => {
    const result = merge([makeRow({ payload: "[object Object]" })]);
    expect(result.questions[0]).toEqual(QUESTION_A);
    expect(result.warnings.join()).toContain(QUESTION_A.title);
  });
});

describe("三条不变式（§5.2 步骤 7）", () => {
  it("id 全局唯一：重复的只留一条并记 warning", () => {
    const payload = makeQuestion({ id: "u-q-dup", title: "重复的新增题" });
    const result = merge([
      makeRow({ id: "u-q-dup", action: "new", baseId: null, baseHash: null, payload, updatedAt: 5 }),
      makeRow({ id: "u-q-dup", action: "new", baseId: null, baseHash: null, payload, updatedAt: 6 }),
    ]);
    expect(result.questions.filter((item) => item.id === "u-q-dup")).toHaveLength(1);
    expect(new Set(result.questions.map((item) => item.id)).size).toBe(result.questions.length);
  });

  it("new 行 id 没有 u- 前缀 → 丢弃并记 warning", () => {
    const result = merge([
      makeRow({
        id: "sneaky-id",
        action: "new",
        baseId: null,
        baseHash: null,
        payload: makeQuestion({ id: "sneaky-id", title: "没有前缀的新增题" }),
      }),
    ]);
    expect(result.questions.map((item) => item.id)).toEqual(["js-event-loop", "js-closure"]);
    expect(result.warnings.join()).toContain("sneaky-id");
  });

  it("hidden 行不出现（三条不变式一起过）", () => {
    const result = merge([makeRow({ status: "hidden", payload: null })]);
    expect(result.questions.some((item) => item.id === "js-event-loop")).toBe(false);
    expect(result.hiddenIds).toContain("js-event-loop");
  });
});

describe("脏数据：同一 base_id 多行", () => {
  it("取 updatedAt 最大的一条并记 warning（不抛错）", () => {
    const result = merge([
      makeRow({ payload: makeQuestion({ answer: "旧的一版" }), updatedAt: 100 }),
      makeRow({ payload: makeQuestion({ answer: "新的一版" }), updatedAt: 200 }),
    ]);
    expect(result.questions[0].answer).toBe("新的一版");
    expect(result.warnings.join()).toContain("重复的覆盖记录");
  });
});

describe("词条 / 图解同构", () => {
  it("同 id 覆盖是替换，不报「键冲突」warning", () => {
    const result = merge([
      makeRow({
        id: "closure",
        kind: "glossary",
        baseId: "closure",
        baseHash: hashPayload(TERM_A),
        payload: makeTerm({ short: "我的版本：函数 + 它的词法环境。" }),
      }),
    ]);
    expect(result.glossary[0].id).toBe("closure");
    expect(result.glossary[0].short).toBe("我的版本：函数 + 它的词法环境。");
    expect(result.warnings).toEqual([]);
  });

  it("覆盖词条的 id 被强制回基线 id（related 引用不能悬空）", () => {
    const result = merge([
      makeRow({
        id: "closure",
        kind: "glossary",
        baseId: "closure",
        baseHash: hashPayload(TERM_A),
        payload: makeTerm({ id: "u-g-closure", short: "我的版本" }),
      }),
    ]);
    expect(result.glossary[0].id).toBe("closure");
  });

  it("图解覆盖用行内 payload，id 仍是基线 id", () => {
    const result = merge([
      makeRow({
        id: "dg-react-diff",
        kind: "diagram",
        baseId: "dg-react-diff",
        baseHash: hashPayload(DIAGRAM_A),
        payload: makeDiagram({ caption: "我的版本：三条策略分层看。" }),
      }),
    ]);
    expect(result.diagrams[0].caption).toBe("我的版本：三条策略分层看。");
    expect(result.diagrams[0].id).toBe("dg-react-diff");
  });

  it("新增词条追加在基线之后", () => {
    const result = merge([
      makeRow({
        id: "u-g-render-phase",
        kind: "glossary",
        action: "new",
        baseId: null,
        baseHash: null,
        payload: makeTerm({ id: "u-g-render-phase", term: "render 阶段" }),
      }),
    ]);
    expect(result.glossary.map((item) => item.id)).toEqual(["closure", "u-g-render-phase"]);
  });
});

describe("未知 action / 类型（导入的边界值）", () => {
  it("action 不是 new / override → 跳过并记 warning", () => {
    const result = merge([
      { ...makeRow(), action: "baseline" as never, payload: makeQuestion() },
    ]);
    expect(result.questions).toEqual([QUESTION_A, QUESTION_B]);
    expect(result.warnings.join()).toContain("baseline");
  });
});

/**
 * 来源标记（`originById`）：卡片靠它决定显示「编辑 / 隐藏 / 还原默认 / 删除」中的哪几个。
 *
 * 这里钉的是**同源**这件事：`originById` 与三条不变式必须在同一次遍历里产出，
 * 否则「被隐藏的题还留着删除按钮」「被丢弃的重复项还在表里」这类不一致会
 * 直接变成用户点得到、但点了没反应的死按钮。
 */
describe("来源标记（originById）", () => {
  it("没动过的条目一律是 baseline（题目 / 词条 / 图解三处都要）", () => {
    const result = merge([]);
    expect(result.originById).toEqual({
      "js-event-loop": "baseline",
      "js-closure": "baseline",
      closure: "baseline",
      "dg-react-diff": "baseline",
    });
  });

  it("有 adopted 覆盖行 → override；没覆盖的仍是 baseline", () => {
    const result = merge([makeRow({ payload: makeQuestion({ answer: "我的版本" }) })]);
    expect(result.originById["js-event-loop"]).toBe("override");
    expect(result.originById["js-closure"]).toBe("baseline");
  });

  it("被隐藏的题不在表里（它不在渲染结果中，不该留一个点不到的动作位）", () => {
    const result = merge([makeRow({ status: "hidden", payload: null })]);
    expect(result.originById).not.toHaveProperty("js-event-loop");
    expect(Object.keys(result.originById).sort()).toEqual([
      "closure",
      "dg-react-diff",
      "js-closure",
    ]);
  });

  it("用户新增的题是 new", () => {
    const result = merge([
      makeRow({
        id: "u-q-1",
        action: "new",
        baseId: null,
        baseHash: null,
        payload: makeQuestion({ id: "u-q-1", title: "自己新增的一道题" }),
      }),
    ]);
    expect(result.originById["u-q-1"]).toBe("new");
  });

  it("被不变式丢弃的条目不进表（new 行没有 u- 前缀 → 丢弃）", () => {
    const result = merge([
      makeRow({
        id: "sneaky-id",
        action: "new",
        baseId: null,
        baseHash: null,
        payload: makeQuestion({ id: "sneaky-id", title: "没有前缀的新增题" }),
      }),
    ]);
    expect(result.originById).not.toHaveProperty("sneaky-id");
  });

  it("表里的 id 与渲染结果一一对应（不许多也不许少）", () => {
    const result = merge([
      makeRow({ status: "hidden", payload: null }),
      makeRow({
        id: "closure",
        kind: "glossary",
        baseId: "closure",
        baseHash: hashPayload(TERM_A),
        payload: makeTerm({ short: "我的版本" }),
      }),
      makeRow({
        id: "u-q-9",
        action: "new",
        baseId: null,
        baseHash: null,
        payload: makeQuestion({ id: "u-q-9", title: "新题" }),
      }),
    ]);
    const rendered = [
      ...result.questions.map((item) => item.id),
      ...result.glossary.map((item) => item.id),
      ...result.diagrams.map((item) => item.id),
    ].sort();
    expect(Object.keys(result.originById).sort()).toEqual(rendered);
  });
});
