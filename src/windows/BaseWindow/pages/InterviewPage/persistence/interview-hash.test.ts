import { describe, expect, it } from "vitest";
import { hashPayload, stableStringify } from "./interview-hash";

/**
 * 基线指纹守卫。
 *
 * 指纹退化是**安静**的：同内容算出两个值 → 每次启动都提示「基线已更新」；
 * 改字段算出同一个值 → 新版的修订永远提示不出来。两边都没有报错可看，
 * 所以这里把「键序无关」「任一字段敏感」「任何输入不抛」三条钉成断言。
 */
describe("stableStringify", () => {
  it("对象键序不影响结果（同内容必同串）", () => {
    const left = { b: 2, a: 1, c: { y: true, x: [1, 2] } };
    const right = { a: 1, c: { x: [1, 2], y: true }, b: 2 };
    expect(stableStringify(left)).toBe(stableStringify(right));
    expect(stableStringify(left)).toBe('{"a":1,"b":2,"c":{"x":[1,2],"y":true}}');
  });

  it("数组保序（下标就是语义）", () => {
    expect(stableStringify(["a", "b"])).toBe('["a","b"]');
    expect(stableStringify(["b", "a"])).toBe('["b","a"]');
    expect(stableStringify(["a", "b"])).not.toBe(stableStringify(["b", "a"]));
  });

  it("undefined 字段跳过（{a:1} 与 {a:1,b:undefined} 是同一内容）", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
    // 数组里的 undefined 占位不能跳过，否则 [1,undefined,3] 会塌成 [1,3]
    expect(stableStringify([1, undefined, 3])).toBe("[1,null,3]");
  });

  it("空对象 / 空数组 / 空串 / 0 / false 都得到确定结果且不抛", () => {
    expect(stableStringify({})).toBe("{}");
    expect(stableStringify([])).toBe("[]");
    expect(stableStringify("")).toBe('""');
    expect(stableStringify(0)).toBe("0");
    expect(stableStringify(false)).toBe("false");
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify(undefined)).toBe("null");
  });

  it("NaN / Infinity 不是合法 JSON，按 null 处理（不抛）", () => {
    expect(stableStringify({ a: Number.NaN, b: Number.POSITIVE_INFINITY })).toBe(
      '{"a":null,"b":null}',
    );
  });

  it("嵌套对象逐层排序（不是只排第一层）", () => {
    const nested = { outer: { z: 1, a: { n: 2, b: 3 } } };
    expect(stableStringify(nested)).toBe('{"outer":{"a":{"b":3,"n":2},"z":1}}');
  });
});

describe("hashPayload", () => {
  it("形如 fp: + 8 位十六进制", () => {
    expect(hashPayload({ a: 1 })).toMatch(/^fp:[0-9a-f]{8}$/);
  });

  it("同内容不同键序 → 相同指纹", () => {
    const left = { title: "事件循环", tags: ["微任务"], heat: 88 };
    const right = { heat: 88, tags: ["微任务"], title: "事件循环" };
    expect(hashPayload(left)).toBe(hashPayload(right));
  });

  it("改任一字段 → 不同指纹", () => {
    const base = { title: "事件循环", heat: 88, tags: ["微任务"] };
    const variants = [
      { ...base, title: "事件循环（改）" },
      { ...base, heat: 89 },
      { ...base, tags: ["宏任务"] },
      { ...base, extra: 1 },
    ];
    const fingerprints = new Set([hashPayload(base), ...variants.map((item) => hashPayload(item))]);
    expect(fingerprints.size).toBe(variants.length + 1);
  });

  it("空对象 / 数组 / 字符串 / 数字都不抛", () => {
    for (const value of [{}, [], "", 0, null, undefined, [1, 2, 3], { a: [null] }]) {
      expect(() => hashPayload(value)).not.toThrow();
      expect(hashPayload(value)).toMatch(/^fp:[0-9a-f]{8}$/);
    }
  });

  it("稳定：同一输入连续调用结果一致（合并视图每次渲染都会算）", () => {
    const payload = { id: "js-event-loop", tags: ["事件循环", "微任务"] };
    expect(hashPayload(payload)).toBe(hashPayload(payload));
  });
});
