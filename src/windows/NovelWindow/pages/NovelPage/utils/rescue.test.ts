import { describe, expect, it } from "vitest";
import { composeSegmentsText, pickCheckedSegments, type RescueSegment } from "./rescue";

/**
 * 卡文救援的共享小工具（R-AI-11）
 *
 * 两条容易被「顺手优化」掉的规则：
 * 1. 拼接顺序 = **作者勾选顺序**（§6.8），不是生成顺序；
 * 2. 拼出来的是**脚手架**（标题 / 冲突 / 后果三行），不是成稿正文。
 */
const SEGMENTS: RescueSegment[] = [
  { title: "当场翻脸", conflict: "为玉佩对峙", consequence: "师徒名分撕破" },
  { title: "按下不表", conflict: "暗中查证", consequence: "错失先机" },
  { title: "引入外援", conflict: "求助宿敌", consequence: "欠下人情" },
];

describe("pickCheckedSegments", () => {
  it("按勾选顺序返回，而不是生成顺序", () => {
    const picked = pickCheckedSegments(SEGMENTS, ["2", "0"]);
    expect(picked.map((item) => item.title)).toEqual(["引入外援", "当场翻脸"]);
  });

  it("非法 / 越界的键被静默跳过（不产出空洞）", () => {
    const picked = pickCheckedSegments(SEGMENTS, ["1", "9", "x", "-1"]);
    expect(picked.map((item) => item.title)).toEqual(["按下不表"]);
  });

  it("空勾选返回空数组（采纳前的空批次拒绝靠它）", () => {
    expect(pickCheckedSegments(SEGMENTS, [])).toEqual([]);
  });
});

describe("composeSegmentsText", () => {
  it("按顺序拼成三段式脚手架，段间空一行", () => {
    const text = composeSegmentsText([SEGMENTS[0], SEGMENTS[1]]);
    expect(text).toBe(
      [
        "一、当场翻脸",
        "冲突：为玉佩对峙",
        "后果：师徒名分撕破",
        "",
        "二、按下不表",
        "冲突：暗中查证",
        "后果：错失先机",
      ].join("\n"),
    );
  });

  it("空列表产出空串（调用方据此拒绝空插入）", () => {
    expect(composeSegmentsText([])).toBe("");
  });
});
