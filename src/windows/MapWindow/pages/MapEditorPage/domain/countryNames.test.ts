import { describe, expect, it } from "vitest";
import { createRng } from "../regions";
import {
  COUNTRY_NAME_MAX_RETRY,
  COUNTRY_PREFIXES,
  COUNTRY_SUFFIXES,
  makeCountryName,
  makeCountryNames,
} from "./countryNames";

/**
 * 国名生成（2.50.0，对齐 `decoded.js` 的 `ctrls.rand_text`）。
 *
 * 值得钉的是**观感契约**而不是随机数本身：12 个国家必须 12 个不同的名字、
 * 名字必须读得出是"国"（要么专名要么带后缀）、同 seed 必须复现。
 */

describe("国名池", () => {
  it("前缀池去重且不缺项（参考 173 项含 27 项重复 → 146）", () => {
    expect(new Set(COUNTRY_PREFIXES).size).toBe(COUNTRY_PREFIXES.length);
    expect(COUNTRY_PREFIXES.length).toBeGreaterThanOrEqual(140);
    // 抽样几位用户截图里出现过的（北辰国 / 一目国 / 宋国）
    expect(COUNTRY_PREFIXES).toContain("北辰");
    expect(COUNTRY_PREFIXES).toContain("一目");
    expect(COUNTRY_PREFIXES).toContain("宋");
  });

  it("后缀只有「国」（对齐 `end_country:[\"国\"]`）", () => {
    expect(COUNTRY_SUFFIXES).toEqual(["国"]);
  });

  it("重抽轮数与参考一致（20）", () => {
    expect(COUNTRY_NAME_MAX_RETRY).toBe(20);
  });
});

describe("makeCountryName", () => {
  it("12 个国家 12 个互不相同的名字", () => {
    const names = makeCountryNames(12, createRng(20261110));
    expect(names).toHaveLength(12);
    expect(new Set(names).size).toBe(12);
  });

  it("名字要么是专名（不带「国」）、要么是「前缀+国」", () => {
    const rng = createRng(7);
    const used = new Set<string>();
    for (let i = 0; i < 60; i += 1) {
      const name = makeCountryName(rng, used);
      const bare = name.endsWith("国") ? name.slice(0, -1) : name;
      // 去掉后缀后必须能在池子里找到 —— 专名与"前缀+国"都满足这一条
      expect(COUNTRY_PREFIXES, `${name} 不在池子里`).toContain(
        COUNTRY_PREFIXES.find((p) => p.replace("_", "") === bare) ?? "",
      );
    }
  });

  it("专名（池里带下划线）不拼后缀，且下划线被去掉", () => {
    // 用足够多的抽样保证命中几个专名（池里 20 项以上带下划线）
    const rng = createRng(99);
    const used = new Set<string>();
    const names: string[] = [];
    for (let i = 0; i < 80; i += 1) names.push(makeCountryName(rng, used));
    const properPrefixes = COUNTRY_PREFIXES.filter((p) => p.includes("_")).map((p) =>
      p.replace("_", ""),
    );
    const hit = names.filter((n) => properPrefixes.includes(n));
    expect(hit.length, "80 次抽样没抽到任何专名，池子权重有问题").toBeGreaterThan(0);
    for (const n of hit) expect(n).not.toContain("国");
    for (const n of names) expect(n).not.toContain("_");
  });

  it("同 seed 复现同一串名字", () => {
    expect(makeCountryNames(12, createRng(4242))).toEqual(makeCountryNames(12, createRng(4242)));
  });

  it("池子抽空后不挂死（允许复用）", () => {
    // 强行抽满整池 + 20 个：exhausted 分支必须让函数正常返回
    const rng = createRng(5);
    const names = makeCountryNames(COUNTRY_PREFIXES.length + 20, rng);
    expect(names).toHaveLength(COUNTRY_PREFIXES.length + 20);
    expect(names.every((n) => n.length > 0)).toBe(true);
  });
});
