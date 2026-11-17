import { describe, expect, it } from "vitest";
import { GLOSSARY_TERMS, splitByGlossary, type GlossaryTerm } from "../data/interview-glossary";
import { buildGlossaryIndex } from "./glossary-matcher";

/**
 * 词条匹配器守卫。
 *
 * 这一层的退化方式全是「看起来还行」：偏一个字符 → 划词反算错位；
 * 长键被短键抢先 → 「render 阶段」只剩「render」可点；
 * 大小写漏归一 → 英文术语在正文里永远不变蓝。
 * 最后一条最重要：**在纯基线词表上必须与 `splitByGlossary` 逐段一致**，
 * 否则「基线正文高亮」与「合并视图正文高亮」会显示成两种样子。
 */
function makeTerm(id: string, term: string, extra: Partial<GlossaryTerm> = {}): GlossaryTerm {
  return {
    id,
    term,
    domain: "react",
    short: "一句话定义。",
    detail: ["展开细节。"],
    ...extra,
  };
}

/** 取出「命中段」的 id 序列，方便断言 */
function hitIds(index: ReturnType<typeof buildGlossaryIndex>, text: string): string[] {
  return index
    .split(text)
    .filter((segment) => segment.term)
    .map((segment) => (segment.term as GlossaryTerm).id);
}

describe("空词表与空文本（确定行为，不抛）", () => {
  const empty = buildGlossaryIndex([]);

  it("空词表：整段都是普通文字", () => {
    expect(empty.split("闭包与作用域链")).toEqual([{ text: "闭包与作用域链" }]);
    expect(empty.exact("闭包")).toBeUndefined();
    expect(empty.byId("closure")).toBeUndefined();
    expect(empty.termsIn("闭包")).toEqual([]);
  });

  it("空文本返回空数组（与 splitByGlossary 一致）", () => {
    expect(empty.split("")).toEqual([]);
    expect(buildGlossaryIndex(GLOSSARY_TERMS).split("")).toEqual([]);
  });

  it("全空白文本原样返回一段（不裁掉空白，偏移才对得上）", () => {
    const index = buildGlossaryIndex([makeTerm("g-render", "render")]);
    expect(index.split("   ")).toEqual([{ text: "   " }]);
  });
});

describe("最长优先与重叠键", () => {
  const index = buildGlossaryIndex([
    makeTerm("g-render", "render"),
    makeTerm("g-render-phase", "render 阶段"),
  ]);

  it("长键吃掉区间：render 阶段 整体命中，不再切成 render + 阶段", () => {
    expect(hitIds(index, "在 render 阶段不能放副作用")).toEqual(["g-render-phase"]);
  });

  it("只有短键能匹配时才用短键", () => {
    expect(hitIds(index, "render 之前先算一下")).toEqual(["g-render"]);
  });

  it("短键不在长键内部重复命中", () => {
    const segments = index.split("render 阶段");
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({ text: "render 阶段", start: 0, end: 9 });
  });

  it("长键在前、短键在后：两段都命中且不重叠", () => {
    expect(hitIds(index, "render 阶段之后是 render")).toEqual(["g-render-phase", "g-render"]);
  });
});

describe("匹配键：term / en / aliases，大小写不敏感", () => {
  const index = buildGlossaryIndex([
    makeTerm("g-closure", "闭包", { en: "Closure", aliases: ["词法闭包"] }),
  ]);

  it("term 命中", () => {
    expect(hitIds(index, "闭包会记住变量")).toEqual(["g-closure"]);
  });

  it("en 大小写不敏感", () => {
    expect(hitIds(index, "CLOSURE 与 closure 是同一个词")).toEqual(["g-closure", "g-closure"]);
  });

  it("aliases 参与匹配", () => {
    expect(hitIds(index, "词法闭包")).toEqual(["g-closure"]);
  });

  it("exact 整段精确匹配（允许首尾空白，不允许长片段）", () => {
    expect(index.exact("  CLOSURE ")).toMatchObject({ id: "g-closure" });
    expect(index.exact("Closure 与作用域链")).toBeUndefined();
  });

  it("byId 反查（related 引用要用）", () => {
    expect(index.byId("g-closure")?.term).toBe("闭包");
    expect(index.byId("g-missing")).toBeUndefined();
  });
});

describe("英文键两侧必须断开", () => {
  const index = buildGlossaryIndex([makeTerm("g-fiber", "Fiber")]);

  it("Fiber 单独出现算命中", () => {
    expect(hitIds(index, "Fiber 是一棵树")).toEqual(["g-fiber"]);
  });

  it("FiberNode 里的 Fiber 不算命中", () => {
    expect(hitIds(index, "FiberNode 里的节点")).toEqual([]);
  });

  it("中英混排时边界判定照旧（前面是中文不算 ASCII 边界）", () => {
    expect(hitIds(index, "这棵树叫Fiber了")).toEqual(["g-fiber"]);
  });
});

describe("偏移量（划词反算位置要用）", () => {
  const index = buildGlossaryIndex([
    makeTerm("g-closure", "闭包", { en: "Closure" }),
    makeTerm("g-microtask", "微任务"),
  ]);
  const text = "闭包产生的原因：微任务在 Closure 之后清空。";

  it("text.slice(start, end) 等于命中文本", () => {
    for (const segment of index.split(text)) {
      if (!segment.term) continue;
      expect(text.slice(segment.start, segment.end)).toBe(segment.text);
    }
  });

  it("普通段不填偏移（只认命中段）", () => {
    for (const segment of index.split(text)) {
      if (segment.term) continue;
      expect(segment.start).toBeUndefined();
      expect(segment.end).toBeUndefined();
    }
  });

  it("每个命中段的区间互不重叠且严格递增", () => {
    const hits = index.split(text).filter((segment) => segment.term);
    expect(hits).toHaveLength(3);
    for (let position = 1; position < hits.length; position += 1) {
      expect(hits[position].start as number).toBeGreaterThanOrEqual(
        hits[position - 1].end as number,
      );
    }
  });

  it("拼回原段落不丢字符（切段是无损的）", () => {
    expect(
      index
        .split(text)
        .map((segment) => segment.text)
        .join(""),
    ).toBe(text);
  });
});

describe("termsIn 去重", () => {
  const index = buildGlossaryIndex([makeTerm("g-closure", "闭包", { en: "Closure" })]);

  it("同一个词条在文里出现多次只算一次", () => {
    const terms = index.termsIn("闭包（closure）与作用域链，闭包还会持有变量");
    expect(terms.map((term) => term.id)).toEqual(["g-closure"]);
  });
});

describe("与 splitByGlossary 的结果一致（重要回归）", () => {
  const index = buildGlossaryIndex(GLOSSARY_TERMS);

  /** 用词表自己拼文本，保证一定有命中，覆盖中英混排与相邻键 */
  const chineseSample = GLOSSARY_TERMS.slice(0, 24)
    .map((term) => `${term.term}，`)
    .join("");
  const englishSample = GLOSSARY_TERMS.filter((term) => term.en)
    .slice(0, 24)
    .map((term) => `${term.en} / `)
    .join("");
  const mixedSample = GLOSSARY_TERMS.slice(24, 48)
    .map((term) => `${term.term}(${term.en ?? ""})`)
    .join(" 与 ");

  const samples = [
    "闭包（closure）与作用域链，闭包还会持有变量",
    "事件循环里微任务与宏任务的执行顺序：Promise.then → setTimeout",
    "FiberNode 里的 Fiber 不算命中，但 Fiber 算",
    "  ",
    "",
    chineseSample,
    englishSample,
    mixedSample,
  ];

  it("逐段一致（文本 + 命中词条 id）", () => {
    for (const text of samples) {
      const expected = splitByGlossary(text).map((segment) => [segment.text, segment.term?.id]);
      const actual = index.split(text).map((segment) => [segment.text, segment.term?.id]);
      expect(actual, `文本片段不一致：${text.slice(0, 20)}…`).toEqual(expected);
    }
  });

  it("样例里确实有命中（否则这条回归是空跑）", () => {
    expect(hitIds(index, "闭包（closure）与作用域链").length).toBeGreaterThan(0);
    expect(hitIds(index, chineseSample).length).toBeGreaterThan(5);
  });

  it("termsIn 与 glossaryTermsIn 的去重结果一致", () => {
    const expected = splitByGlossary(chineseSample)
      .map((segment) => segment.term?.id)
      .filter((id): id is string => typeof id === "string")
      .filter((id, position, list) => list.indexOf(id) === position);
    expect(index.termsIn(chineseSample).map((term) => term.id)).toEqual(expected);
  });
});
