import { describe, expect, it } from "vitest";
import {
  isValidDiagramShape,
  isValidGlossaryShape,
  isValidQuestionShape,
  validatePayloadShape,
} from "@/shared/interview/payload-shape";
import { QUESTION_BANK } from "./interview-bank";
import { DIAGRAMS } from "./interview-diagrams";
import { GLOSSARY_TERMS } from "./interview-glossary";

/**
 * 结构校验 × 基线数据的对照守卫。
 *
 * 【为什么需要这一层】
 * `payload-shape.ts` 是**主进程落库前**唯一的闸门，它的判据一旦比基线数据更严，
 * 症状不是「报错」，而是「用户改这 8 条永远保存不了，还被告知内容已损坏」——
 * 反过来说，它一旦比基线宽松，脏 payload 就会静默入库。两个方向都没有编译期保护，
 * 而 `payload-shape.test.ts` 里的用例是**手写的合法样例**，天然跟着判据一起漂移
 * （判据收紧，手写样例也可能顺手收紧）。
 *
 * 所以这里拿**真实基线**当测试数据：413 条（243 题 + ~100 词条 + 24 图）
 * 必须全部通过结构校验。谁再收紧判据，这里会立刻红，并直接告诉他是哪条过不去。
 *
 * 第二条守的是「键名往返保真」：结构校验的返回值会被 `JSON.stringify` 落库、
 * 被导出文件带走、被合并视图直接当联合类型用，所以它**必须原样还原每种图型的键名**。
 * 早先 timeline 的 `events` 被改写成 `{ label, note }`（而 `DiagramEvent` 要的是
 * `{ title, detail }`），库里的坏数据与 24 张图里那 2 张时间轴空白就是这么来的。
 */
interface BaselineItem {
  id: string;
}

describe("基线数据必须全部通过结构校验（判据不许比数据更严）", () => {
  function collectOffenders(): string[] {
    const offenders: string[] = [];
    const check = (kind: "question" | "glossary" | "diagram", item: BaselineItem): void => {
      const checked = validatePayloadShape(kind, item);
      if (!checked.ok) offenders.push(`${kind} ${item.id}：${checked.errors[0]}`);
    };
    for (const question of QUESTION_BANK) check("question", question);
    for (const term of GLOSSARY_TERMS) check("glossary", term);
    for (const diagram of DIAGRAMS) check("diagram", diagram);
    return offenders;
  }

  it("243 题 + 词条 + 24 图没有一条被判非法", () => {
    // 失败时 offenders 里是「类型 + id：第一条错误」，直接指出是哪条基线过不去
    expect(collectOffenders()).toEqual([]);
  });

  it("基线规模没被悄悄改小（否则上面那条会「空跑」通过）", () => {
    expect(QUESTION_BANK.length).toBeGreaterThan(200);
    expect(GLOSSARY_TERMS.length).toBeGreaterThan(80);
    expect(DIAGRAMS.length).toBeGreaterThan(20);
  });

  it("单条也逐类通过（失败时能定位到具体 id，而不是只知道「有一批不对」）", () => {
    for (const question of QUESTION_BANK) {
      const checked = isValidQuestionShape(question);
      expect(checked.ok, `题目 ${question.id} 过不了结构校验`).toBe(true);
    }
    for (const term of GLOSSARY_TERMS) {
      const checked = isValidGlossaryShape(term);
      expect(checked.ok, `词条 ${term.id} 过不了结构校验`).toBe(true);
    }
    for (const diagram of DIAGRAMS) {
      const checked = isValidDiagramShape(diagram);
      expect(checked.ok, `图解 ${diagram.id} 过不了结构校验`).toBe(true);
    }
  });

  /**
   * F2 的回归清单：这 8 条曾经被判成「内容已损坏」，症状是用户点编辑改完
   * **保存必被拒**（而且报错说他的数据坏了）。
   *
   * 单独钉住而不是只靠「全量通过」：全量那条万一哪天被人用 `filter` 绕过去，
   * 这里还会红，并且直接指名道姓。
   */
  it("F2 回归清单：这 8 条正文里的技术字符不许再被误判", () => {
    const cases: Array<{ kind: "question" | "glossary" | "diagram"; id: string; why: string }> = [
      { kind: "question", id: "written-memoize", why: "答案里写着 [object Object]（它讲的就是这个坑）" },
      { kind: "glossary", id: "prototype-chain", why: "正文里的 [[Prototype]]" },
      { kind: "glossary", id: "iterator-protocol", why: "正文里的 { value, done }" },
      { kind: "diagram", id: "dg-quicksort", why: "事件说明里的数组字面量" },
      { kind: "diagram", id: "dg-mergesort", why: "事件说明里的数组字面量" },
      { kind: "diagram", id: "dg-sliding-window", why: "事件说明里的数组字面量" },
      { kind: "diagram", id: "dg-binary-search", why: "caption 里的 [left, right]" },
      { kind: "diagram", id: "dg-lis", why: "caption 里的 tails[i]" },
    ];

    const pool: Record<string, readonly BaselineItem[]> = {
      question: QUESTION_BANK,
      glossary: GLOSSARY_TERMS,
      diagram: DIAGRAMS,
    };

    for (const item of cases) {
      const target = pool[item.kind].find((entry) => entry.id === item.id);
      // 清单本身写错 id 时也要红（否则这条守卫会「空跑」通过）
      expect(target, `基线里找不到 ${item.kind} ${item.id}`).toBeDefined();
      const checked = validatePayloadShape(item.kind, target);
      expect(checked.ok, `${item.kind} ${item.id}（${item.why}）仍被判非法`).toBe(true);
    }
  });
});

describe("图解的键名往返保真（F1 专用防线）", () => {
  it("flow：nodes 仍然是 { label, note?, tone? }", () => {
    for (const diagram of DIAGRAMS) {
      if (diagram.kind !== "flow") continue;
      const checked = isValidDiagramShape(diagram);
      expect(checked.ok, `图解 ${diagram.id} 过不了校验`).toBe(true);
      if (!checked.ok) continue;
      expect(checked.value.nodes, `flow ${diagram.id} 的 nodes 键名被改写`).toEqual(diagram.nodes);
    }
  });

  it("timeline：events 仍然是 { title, detail?, tone? }（写成 label/note 会让时间轴空白）", () => {
    const timelines = DIAGRAMS.filter((diagram) => diagram.kind === "timeline");
    expect(timelines.length, "基线里应当有步骤图，否则这条守卫是空跑").toBeGreaterThan(0);
    for (const diagram of timelines) {
      if (diagram.kind !== "timeline") continue;
      const checked = isValidDiagramShape(diagram);
      expect(checked.ok, `图解 ${diagram.id} 过不了校验`).toBe(true);
      if (!checked.ok) continue;
      expect(checked.value.events, `timeline ${diagram.id} 的 events 键名被改写`).toEqual(
        diagram.events,
      );
      // 再明确一次「渲染层真的读得到 title」：合并视图正是按这个字段读的
      const titles = (checked.value.events ?? []).map((event) => event.title);
      expect(titles).toEqual(diagram.events.map((event) => event.title));
      expect(titles.every((title) => Boolean(title))).toBe(true);
    }
  });

  it("compare：left / right 仍然是 { title, note?, items }", () => {
    for (const diagram of DIAGRAMS) {
      if (diagram.kind !== "compare") continue;
      const checked = isValidDiagramShape(diagram);
      expect(checked.ok, `图解 ${diagram.id} 过不了校验`).toBe(true);
      if (!checked.ok) continue;
      expect(checked.value.left, `compare ${diagram.id} 的左栏被改写`).toEqual(diagram.left);
      expect(checked.value.right, `compare ${diagram.id} 的右栏被改写`).toEqual(diagram.right);
    }
  });

  it("layers：layers 仍然是 { label, note?, tags? }", () => {
    for (const diagram of DIAGRAMS) {
      if (diagram.kind !== "layers") continue;
      const checked = isValidDiagramShape(diagram);
      expect(checked.ok, `图解 ${diagram.id} 过不了校验`).toBe(true);
      if (!checked.ok) continue;
      expect(checked.value.layers, `layers ${diagram.id} 的分层被改写`).toEqual(diagram.layers);
    }
  });

  it("公共字段（id / kind / title / caption / steps / note）原样还原", () => {
    for (const diagram of DIAGRAMS) {
      const checked = isValidDiagramShape(diagram);
      expect(checked.ok, `图解 ${diagram.id} 过不了校验`).toBe(true);
      if (!checked.ok) continue;
      const value = checked.value;
      expect(value.id).toBe(diagram.id);
      expect(value.kind).toBe(diagram.kind);
      expect(value.title).toBe(diagram.title);
      expect(value.caption).toBe(diagram.caption);
      expect(value.steps).toEqual(diagram.steps);
      expect(value.note).toBe(diagram.note);
    }
  });
});

describe("残片判据仍然抓得住真残片（不许为了放行基线把闸门拆了）", () => {
  function question(overrides: Record<string, unknown> = {}): unknown {
    return {
      id: "u-q-shape",
      title: "数组方法里哪个会改原数组",
      stem: "push / slice / splice 谁改原数组？",
      answer: "push 与 splice 改，slice 不改。",
      track: "foundation",
      categoryId: "foundation-js",
      difficulty: "basic",
      tags: ["数组"],
      topic: "JS 基础",
      reviewedAt: "2026-01",
      heat: 30,
      updatedAt: "2026-01-15",
      ...overrides,
    };
  }

  it("引号键 + 冒号判残片（半截 JSON 对象）", () => {
    for (const title of ['{"title": "事件循环"}', '"name": "foo', "`id`：u-q-1"]) {
      expect(isValidQuestionShape(question({ title })).ok, `应判残片：${title}`).toBe(false);
    }
  });

  it("方括号 / 花括号不成对判残片（半截数组）", () => {
    for (const title of ["[1,2,3", "{ value, done", "先看 [a, b 这两项"]) {
      expect(isValidQuestionShape(question({ title })).ok, `应判残片：${title}`).toBe(false);
    }
  });

  it("成对的括号与技术文案一律放行（这就是那 8 条基线倒下的原因）", () => {
    for (const title of [
      "数组 [3,1,4,1,5,9,2,6] 快排怎么分区",
      "解构 { value, done } 的迭代器协议",
      "[[Prototype]] 与 prototype 的区别",
      "tails[i] 维护的是什么",
      "二分取 [left, right] 的中点",
      "[object Object] 是怎么来的",
    ]) {
      expect(isValidQuestionShape(question({ title })).ok, `不该判残片：${title}`).toBe(true);
    }
  });

  it("整个字段恰好是 [object Object] 才判损坏（写在正文里是正常内容）", () => {
    expect(isValidQuestionShape(question({ topic: "[object Object]" })).ok).toBe(false);
    expect(
      isValidQuestionShape(question({ topic: "为什么日志里会出现 [object Object] 这种输出" })).ok,
    ).toBe(true);
  });
});
