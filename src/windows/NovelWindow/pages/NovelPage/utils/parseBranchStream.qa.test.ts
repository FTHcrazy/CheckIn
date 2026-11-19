import { describe, expect, it } from "vitest";
import { createBranchStreamParser } from "./parseBranchStream";

/**
 * 分段流式解析的**刁钻**边界（QA 独立补充，R-AI-11 §3.4）
 *
 * 与 `parseBranchStream.test.ts` 不重叠：那边钉常规四种情形（跨块、串内花括号、
 * 转义引号、坏块），这里钉「模型输出几乎一定会踩到、但手写用例容易漏」的三件事：
 * 1. 转义反斜杠后紧跟引号（`\\"` 序列）—— `\\` 是转义的反斜杠，后面的 `"` 才是
 *    字符串结束位；把 `\\` 当两次转义会让 `inString` 反向翻转，整段吞掉。
 * 2. chunk 边界正好落在 `\` 与 `"` 之间 —— 状态必须从 buffer 重算，不能跨 chunk 记忆。
 * 3. 被截断在字符串中间的残块 —— `flush` 补花括号不能补出一张假卡。
 */
describe("createBranchStreamParser：转义与截断（QA 补充）", () => {
  it("转义反斜杠后紧跟引号：`\\\\` 只吃一次转义，字符串正常闭合", () => {
    const parser = createBranchStreamParser();
    // 实际文本：{"title":"路径结尾\\","conflict":...}  → JSON 里 title 是 `路径结尾\`
    const cards = parser.push(
      '[{"title":"路径结尾\\\\","conflict":"撞墙","consequence":"门开了"}]',
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].title).toBe("路径结尾\\");
    expect(cards[0].consequence).toBe("门开了");
  });

  it("chunk 断在 `\\` 与 `\"` 之间：下一轮从 buffer 重算状态，不提前闭合也不永远开着", () => {
    const parser = createBranchStreamParser();
    // 第一块停在转义符上（`他说\`），此时字符串**没有**结束
    expect(parser.push('[{"title":"他说\\')).toEqual([]);
    // 第二块先来一个 `"`（转义引号），再来真正的结束引号
    const cards = parser.push('"走","conflict":"拦人","consequence":"追不上"}]');
    expect(cards).toHaveLength(1);
    expect(cards[0].title).toBe('他说"走');
  });

  it("截断在字符串中间：flush 补括号也救不回来，宁可少一张也不出假卡", () => {
    const parser = createBranchStreamParser();
    expect(parser.push('[{"title":"未闭合{')).toEqual([]);
    // 补一个 `}` 之后仍是非法 JSON（引号没闭），必须返回空而不是半张卡
    expect(parser.flush()).toEqual([]);
  });

  it("截断在对象尾部但字段不全：补括号也补不出字段，不产卡（三段是渲染前提）", () => {
    const parser = createBranchStreamParser();
    expect(
      parser.push('[{"title":"A","conflict":"a","consequence":"a"},{"title":"B","conflict":"b"'),
    ).toHaveLength(1);
    // 缺的是 `"consequence":"b"`，补右括号虽能得到合法 JSON，但三段不完整 → 丢弃
    expect(parser.flush()).toEqual([]);
  });

  it("语法错误（单引号）的块跳过，后面的好块照常出卡且顺序不变", () => {
    const parser = createBranchStreamParser();
    const cards = parser.push(
      "[{'title':'坏块'},{\"title\":\"好块\",\"conflict\":\"c\",\"consequence\":\"s\"}]",
    );
    expect(cards.map((card) => card.title)).toEqual(["好块"]);
  });

  it("同一批对象分两块到达：先出的卡不重复，后到的接在后面", () => {
    const parser = createBranchStreamParser();
    const first = parser.push('[{"title":"A","conflict":"a","consequence":"a"}');
    expect(first.map((card) => card.title)).toEqual(["A"]);
    // 后一块是数组剩余部分（逗号 + 第二个对象 + 右方括号）
    const second = parser.push(',{"title":"B","conflict":"b","consequence":"b"}]');
    expect(second.map((card) => card.title)).toEqual(["B"]);
    expect(parser.flush()).toEqual([]);
  });
});
