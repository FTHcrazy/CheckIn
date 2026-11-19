import { describe, expect, it } from "vitest";
import { createBranchStreamParser } from "./parseBranchStream";

/**
 * 分段流式解析（R-AI-11，§3.4）
 *
 * 钉四件容易写错的事：跨块边界、字符串里的花括号、转义引号、坏块不拖累好块。
 * 每一条都对应真实会出现的模型输出（尤其「标题里带引号」几乎必然出现）。
 */
describe("createBranchStreamParser", () => {
  it("一个完整对象落一张卡，三段字段都取到", () => {
    const parser = createBranchStreamParser();
    const cards = parser.push(
      '[{"title":"当场翻脸","conflict":"师徒为了玉佩对峙","consequence":"名分撕破"}]',
    );
    expect(cards).toEqual([
      { title: "当场翻脸", conflict: "师徒为了玉佩对峙", consequence: "名分撕破" },
    ]);
  });

  it("跨块边界：未闭合的块留到下一轮，闭合即出卡", () => {
    const parser = createBranchStreamParser();
    expect(parser.push('```json\n[{"title":"A","conflict":"B"')).toEqual([]);
    const cards = parser.push(',"consequence":"C"}]```');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toEqual({ title: "A", conflict: "B", consequence: "C" });
  });

  it("字符串里的花括号与转义引号不提前闭合", () => {
    const parser = createBranchStreamParser();
    const cards = parser.push(
      // 标题里带 { } 与 \" —— 不感知引号状态会在第一个 } 处切断
      '[{"title":"他喊了一声{停}","conflict":"他说\\"走\\"","consequence":"门开了"}]',
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].title).toBe("他喊了一声{停}");
    expect(cards[0].conflict).toBe('他说"走"');
  });

  it("一次喂多条：按顺序全部落卡（流式批量到来时也要逐条出）", () => {
    const parser = createBranchStreamParser();
    const cards = parser.push(
      '[{"title":"A","conflict":"a","consequence":"a"},{"title":"B","conflict":"b","consequence":"b"}]',
    );
    expect(cards.map((card) => card.title)).toEqual(["A", "B"]);
  });

  it("坏块被跳过，后面的好块照常出卡（不整批失败）", () => {
    const parser = createBranchStreamParser();
    const cards = parser.push(
      '[{"title":"A",}, {"title":"B","conflict":"b","consequence":"b"}]',
    );
    expect(cards.map((card) => card.title)).toEqual(["B"]);
  });

  it("缺字段的对象不算完整卡片（三段是渲染前提）", () => {
    const parser = createBranchStreamParser();
    const cards = parser.push('[{"title":"只有标题"}]');
    expect(cards).toEqual([]);
  });

  it("flush 补齐末尾缺失的右括号：被中断的最后一条不白丢", () => {
    const parser = createBranchStreamParser();
    expect(parser.push('[{"title":"A","conflict":"a","consequence":"a"}]')).toHaveLength(1);
    expect(parser.push(',{"title":"B","conflict":"b","consequence":"b"')).toEqual([]);
    const tail = parser.flush();
    expect(tail.map((card) => card.title)).toEqual(["B"]);
  });

  it("text() 保留原文（结构化降级与排查用）", () => {
    const parser = createBranchStreamParser();
    parser.push("以下是走向：\n");
    parser.push('[{"title":"A","conflict":"a","consequence":"a"}]');
    expect(parser.text()).toContain("以下是走向");
    expect(parser.text()).toContain('"title":"A"');
  });
});
