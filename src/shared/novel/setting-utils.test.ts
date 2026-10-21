import { describe, expect, it } from "vitest";
import {
  canSplitLevel,
  formatSubLevel,
  hasChildLevels,
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

describe("canSplitLevel：等级序列只支持两层（1.39.1）", () => {
  it("根阶（parentId 为 null）允许拆分", () => {
    expect(canSplitLevel(level({ parentId: null }))).toBe(true);
  });

  it("子层级（parentId 非空）不允许再拆 —— 否则出现第三层嵌套", () => {
    expect(canSplitLevel(level({ parentId: "l1" }))).toBe(false);
  });

  it("拆出的分段（segFrom/segTo 非空但 parentId 为空）仍是根阶，可被合并而非继续拆", () => {
    // 旧模型（父阶自己占第一段）里 segFrom 非空但 parentId 为空 —— 它仍是
    // 「阶」这一层，拆分层级判定只认 parentId，不认 seg 区间。
    expect(canSplitLevel(level({ parentId: null, segFrom: 1, segTo: 4 }))).toBe(true);
  });

  it("已拆出子行的根阶（parentId 为 null 且 hasChildren）不允许再拆（1.4x 收口）", () => {
    // 组阶的 parent_id 仍是 NULL，若不看子行就会再次放行 —— 结果是再造一层
    // 第二层而非第三层，属数据质量隐患。缺省 hasChildren=false 的旧调用点行为不变。
    expect(canSplitLevel(level({ parentId: null }), true)).toBe(false);
  });

  it("未拆子行的根阶（parentId 为 null 且 hasChildren=false）仍可拆", () => {
    expect(canSplitLevel(level({ parentId: null }), false)).toBe(true);
    // 缺省参数等价于 hasChildren=false
    expect(canSplitLevel(level({ parentId: null }))).toBe(true);
  });
});

describe("hasChildLevels：从整份序列里判「某阶已拆出子行」", () => {
  it("有任意一行 parentId 指向该阶即判为有子行", () => {
    const root = level({ id: "r1", parentId: null });
    const child = level({ id: "c1", parentId: "r1" });
    expect(hasChildLevels([root, child], "r1")).toBe(true);
  });

  it("无任何行指向该阶即判为无子行", () => {
    const root = level({ id: "r1", parentId: null });
    const other = level({ id: "r2", parentId: null });
    expect(hasChildLevels([root, other], "r1")).toBe(false);
  });

  it("空序列不抛，返回 false", () => {
    expect(hasChildLevels([], "r1")).toBe(false);
  });
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
