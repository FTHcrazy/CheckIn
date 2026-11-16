import { describe, expect, it } from "vitest";
import {
  GLOSSARY_BY_ID,
  GLOSSARY_DOMAIN_LABEL,
  GLOSSARY_TERMS,
  glossaryExact,
  glossaryTermsIn,
  splitByGlossary,
} from "./interview-glossary";

/**
 * 名词词典守卫。
 *
 * 词典是「正文之外的第二份数据」，它的退化方式都很安静：键重复导致命中
 * 哪个词条取决于数组顺序、键太短导致满屏误命中、related 指向不存在的 id
 * 导致弹层里出现空白「另见」。这里把这些都钉成断言。
 */
describe("词典数据完整性", () => {
  it("id 全局唯一", () => {
    const ids = GLOSSARY_TERMS.map((term) => term.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每个词条都有定义与至少两条细节", () => {
    const offenders = GLOSSARY_TERMS.filter(
      (term) =>
        term.term.trim().length < 2 ||
        term.short.trim().length < 12 ||
        term.detail.length < 2 ||
        term.detail.some((item) => item.trim().length < 12),
    ).map((term) => term.id);
    expect(offenders).toEqual([]);
  });

  it("匹配键（term / en / aliases）全局唯一，且不短到会误命中", () => {
    const seen = new Map<string, string>();
    const offenders: string[] = [];
    for (const term of GLOSSARY_TERMS) {
      for (const key of [term.term, term.en, ...(term.aliases ?? [])]) {
        if (!key) continue;
        const normalized = key.toLowerCase();
        // 中文两字就足够具体（闭包 / 节流），纯英文缩写至少 3 个字符（map / ref 一律不收）
        const min = /^[\x20-\x7e]+$/.test(key) ? 3 : 2;
        if (normalized.length < min) offenders.push(`${term.id} → ${key} 过短`);
        const owner = seen.get(normalized);
        if (owner && owner !== term.id) offenders.push(`${term.id} 与 ${owner} 撞键 ${key}`);
        seen.set(normalized, term.id);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("related 只指向存在的词条，且不自指", () => {
    const offenders: string[] = [];
    for (const term of GLOSSARY_TERMS) {
      for (const id of term.related ?? []) {
        if (id === term.id) offenders.push(`${term.id} 自指`);
        if (!GLOSSARY_BY_ID[id]) offenders.push(`${term.id} → ${id} 不存在`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("每个领域都有词条（防止某个分类点开一个词都没有）", () => {
    const empty = Object.keys(GLOSSARY_DOMAIN_LABEL).filter(
      (domain) => !GLOSSARY_TERMS.some((term) => term.domain === domain),
    );
    expect(empty).toEqual([]);
  });
});

describe("名词匹配器", () => {
  it("切段后拼回原文，一个字符都不丢", () => {
    const samples = [
      "用 Proxy 拦截 get，并通过 Reflect.get(target, key, receiver) 保证 this 正确",
      "typeof 与 instanceof 的分工，以及 Object.prototype.toString.call 兜底",
      "最长递增子序列配合 key 映射，按下标 diff 会退化",
      "",
    ];
    for (const sample of samples) {
      const joined = splitByGlossary(sample)
        .map((segment) => segment.text)
        .join("");
      expect(joined).toBe(sample);
    }
  });

  it("长词优先：命中「最长递增子序列」而不是拆成短词", () => {
    const segments = splitByGlossary("Vue 3 用最长递增子序列减少移动");
    const hit = segments.find((segment) => segment.term);
    expect(hit?.text).toBe("最长递增子序列");
    expect(hit?.term?.id).toBe("lis");
  });

  it("英文词边界：FiberNode 里的 Fiber 不算命中", () => {
    const hits = splitByGlossary("FiberNode 与 Fiber 是两回事")
      .filter((segment) => segment.term)
      .map((segment) => segment.term?.id);
    expect(hits).toEqual(["fiber"]);
  });

  it("大小写不敏感：PROXY / Proxy 都命中同一条", () => {
    expect(glossaryExact("Proxy")?.id).toBe("proxy");
    expect(glossaryExact("STRUCTUREDCLONE")?.id).toBe("structured-clone");
    expect(glossaryExact("不存在的词")).toBeUndefined();
  });

  it("行内代码里的名词整段命中才算数", () => {
    expect(glossaryExact("structuredClone")?.id).toBe("structured-clone");
    // 含关键词但整段不相等，不能被替换成名词按钮
    expect(glossaryExact("new Set(arr)")).toBeUndefined();
  });

  it("同一段文本里的重复词条只返回一次", () => {
    const ids = glossaryTermsIn("闭包（closure）与作用域链，闭包还会持有变量").map(
      (term) => term.id,
    );
    expect(ids.filter((id) => id === "closure")).toHaveLength(1);
  });
});
