import { describe, expect, it } from "vitest";
import {
  formatSubLevel,
  listSubLevels,
  previewSplit,
} from "@/shared/novel/setting-utils";
import type { SettingCategory, SettingLevel } from "@/shared/novel/setting-types";

/**
 * P2-3：`formatSubLevel` 对**多个** `{n}` 占位符的处理。
 *
 * 修复前用 `String.replace(SUB_PATTERN_TOKEN, …)`（只替首个），而 `previewSplit`
 * 的段名模板用 `/\{n\}/g`（全局）—— 同一个模板在两处会得到不同结果。仓库内置
 * 预设里 `{n}` 只出现 0–1 次，故无实际影响，但这是隐患。现统一为全局替换。
 */
const level = (over: Partial<SettingLevel> = {}): SettingLevel => ({
  id: "l1",
  categoryId: "c1",
  name: "筑基",
  rank: 1,
  aliases: [],
  note: "",
  subLevels: 1,
  subPattern: "",
  power: null,
  parentId: null,
  segFrom: null,
  segTo: null,
  ...over,
});

const category = (over: Partial<SettingCategory> = {}): SettingCategory => ({
  id: "c1",
  workId: "w1",
  name: "境界",
  color: "#5B8DEF",
  kind: "realm",
  sortOrder: 1,
  note: "",
  subLevels: 1,
  carryDir: "asc",
  subPattern: "",
  levels: [],
  ...over,
});

describe("formatSubLevel：多个 {n} 全替换（P2-3）", () => {
  it("模板含两个 {n} → 两处都被替换（阿拉伯 / 中文样式一致）", () => {
    expect(formatSubLevel("{n}层（第{n}阶）", 3)).toBe("3层（第3阶）");
    expect(formatSubLevel("{n}层（第{n}阶）", 3, "chinese")).toBe("三层（第三阶）");
  });

  it("与 previewSplit 的段名模板口径一致（同一模板同结果）", () => {
    const pattern = "{n}段·第{n}节";
    const segments = previewSplit(level({ name: "X" }), 2, 4, pattern);
    expect(segments).toHaveLength(2);
    // previewSplit 逐段以 index+1 调 formatSubLevel；两者必须同口径
    expect(segments[0].name).toBe(formatSubLevel(pattern, 1));
    expect(segments[1].name).toBe(formatSubLevel(pattern, 2));
    expect(segments[1].name).toBe("2段·第2节");
  });

  it("单个 {n} 的既有行为逐字不变", () => {
    expect(formatSubLevel("第{n}层", 7)).toBe("第7层");
    expect(formatSubLevel("第{n}层", 7, "chinese")).toBe("第七层");
  });

  it("listSubLevels 经同一 formatSubLevel 展开，多占位模板也全替换", () => {
    const names = listSubLevels(
      level({ subLevels: 2, subPattern: "{n}层（第{n}阶）" }),
      category(),
    );
    expect(names).toEqual(["1层（第1阶）", "2层（第2阶）"]);
  });
});
