/**
 * 全局设定中心 · **独立对抗性验证**（QA / REQ-051 / REQ-052 边界）
 *
 * 实现者的 `pack-utils.test.ts` 只覆盖了「正常值」的三种目标输出。这里补齐
 * **越界 / 脏值 / 互斥** 面，并加一条"绝不出现脏串"的不变量断言（`undefined` /
 * `NaN` / `[object`），这是最容易在 sub 越界时冒出来的缺陷。
 */
import { describe, expect, it } from "vitest";
import { formatRealm, subLabelAt, type LadderRung } from "./pack-utils";

const rung = (over: Partial<LadderRung>): LadderRung => ({
  id: "r",
  name: "筑基",
  rank: 1,
  subLevels: 1,
  power: null,
  ...over,
});

const NO_DIRT = (text: string): void => {
  expect(text).not.toContain("undefined");
  expect(text).not.toContain("NaN");
  expect(text).not.toContain("[object");
  expect(text).not.toMatch(/\s{2,}/);
};

describe("formatRealm：REQ-051 / REQ-052 边界与脏串", () => {
  const SUB4 = rung({ subLevels: 4, subLabels: ["初期", "中期", "后期", "圆满"] });
  const SEC13 = rung({ name: "练气", subLevels: 13, subPattern: "第{n}层" });
  const PLAIN = rung({ subLevels: 4, subPattern: "" });
  const FIXED = rung({ subLevels: 4, subPattern: "初期,中期,后期,圆满" });

  it("subLevels <= 1：只出阶名，样式不影响", () => {
    const flat = rung({ name: "金丹", subLevels: 1 });
    expect(formatRealm([flat], { index: 0, sub: 1 })).toBe("金丹");
    expect(formatRealm([flat], { index: 0, sub: 1 }, "chinese")).toBe("金丹");
    // 即便 sub 越界，也不该因无小层而渲染进度
    expect(formatRealm([flat], { index: 0, sub: 99 })).toBe("金丹");
  });

  it("index 越界 / 空阶梯：返回「未设置」，不抛", () => {
    expect(formatRealm([], { index: 0, sub: 1 })).toBe("未设置");
    expect(formatRealm([SEC13], { index: 5, sub: 1 })).toBe("未设置");
    expect(formatRealm([SEC13], { index: -1, sub: 1 })).toBe("未设置");
  });

  it("固定名单（subLabels）：REQ-051 ① 筑基 * 初期 1/4", () => {
    expect(formatRealm([SUB4], { index: 0, sub: 1 })).toBe("筑基 * 初期 1/4");
    expect(formatRealm([SUB4], { index: 0, sub: 4 })).toBe("筑基 * 圆满 4/4");
  });

  it("{n} 模板：REQ-052 ① 练气 * 第七层 7/13（中文）/ 第7层（默认）", () => {
    expect(formatRealm([SEC13], { index: 0, sub: 7 }, "chinese")).toBe(
      "练气 * 第七层 7/13",
    );
    expect(formatRealm([SEC13], { index: 0, sub: 7 })).toBe("练气 * 第7层 7/13");
  });

  it("无小层名：省略 `* 小层名`，回落 `筑基 1/4`", () => {
    expect(formatRealm([PLAIN], { index: 0, sub: 1 })).toBe("筑基 1/4");
    expect(formatRealm([FIXED], { index: 0, sub: 1 })).toBe("筑基 1/4");
  });

  it("不变量：sub 越界（0 / 负数 / >subLevels）也不产出脏串", () => {
    const ladder = [SUB4, SEC13];
    for (const index of [0, 1]) {
      for (const sub of [0, -1, -50, 1, 4, 13, 99, 9999]) {
        for (const style of ["arabic", "chinese"] as const) {
          NO_DIRT(formatRealm(ladder, { index, sub }, style));
        }
      }
    }
  });

  it("固定名单越界（sub > 名单长度）：回落编号，不 undefined", () => {
    // subLabels 只有 4 项，sub=7 → subLabelAt 返回空串 → 无模板可渲染 → 仅进度
    const out = formatRealm([SUB4], { index: 0, sub: 7 });
    expect(out).toBe("筑基 7/4");
    NO_DIRT(out);
  });

  it("subLabels 中的空串按「无小层名」处理（回落进度），不渲染空 `* `", () => {
    const r = rung({ subLevels: 3, subLabels: ["", "中期", ""] });
    expect(formatRealm([r], { index: 0, sub: 1 })).toBe("筑基 1/3");
    expect(formatRealm([r], { index: 0, sub: 2 })).toBe("筑基 * 中期 2/3");
    expect(formatRealm([r], { index: 0, sub: 3 })).toBe("筑基 3/3");
  });
});

describe("subLabelAt：越界 / 无别名表的一律空串（调用方据此不渲染）", () => {
  it("越界与缺失都返回空串", () => {
    const r = rung({ subLevels: 2, subLabels: ["甲", "乙"] });
    expect(subLabelAt(r, 1)).toBe("甲");
    expect(subLabelAt(r, 2)).toBe("乙");
    expect(subLabelAt(r, 3)).toBe("");
    expect(subLabelAt(r, 0)).toBe("");
    expect(subLabelAt(r, -1)).toBe("");
    expect(subLabelAt(rung({ subLevels: 2 }), 1)).toBe("");
    expect(subLabelAt(undefined, 1)).toBe("");
  });
});
