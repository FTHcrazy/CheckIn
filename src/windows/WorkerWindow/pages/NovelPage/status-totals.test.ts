import { describe, expect, it } from "vitest";
import { computeTotals } from "./status-totals";
import type { StatusEntry, StatusSheetContent } from "./types";

function sheet(entries: StatusEntry[]): StatusSheetContent {
  return { groups: [{ id: "g1", name: "状态", entries }] };
}

function attr(id: string, value: string): StatusEntry {
  return { id, name: id, kind: "number", value, note: "" };
}

describe("computeTotals", () => {
  it("无加成时返回空数组（未被指向的属性不出现）", () => {
    const rows = computeTotals(sheet([attr("a", "10")]));
    expect(rows).toEqual([]);
  });

  it("永久加成恒计入，无需激活态", () => {
    const rows = computeTotals(
      sheet([
        attr("a", "87"),
        { ...attr("s", "1"), bonuses: [{ attrId: "a", amount: 4, mode: "permanent" }] },
      ]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBe(91);
    expect(rows[0].sources[0].on).toBe(true);
  });

  it("激活时加成：条目 active 才计入，未激活灰显不累加", () => {
    const rows = computeTotals(
      sheet([
        attr("a", "87"),
        { ...attr("e1", "x"), kind: "text", active: true, bonuses: [{ attrId: "a", amount: 12, mode: "while_active" }] },
        { ...attr("e2", "y"), kind: "text", active: false, bonuses: [{ attrId: "a", amount: 8, mode: "while_active" }] },
      ]),
    );
    expect(rows[0].base).toBe(87);
    expect(rows[0].bonus).toBe(12);
    expect(rows[0].total).toBe(99);
    expect(rows[0].sources).toHaveLength(2);
    expect(rows[0].sources[0].on).toBe(true);
    expect(rows[0].sources[1].on).toBe(false);
  });

  it("支持负加成（诅咒装备）", () => {
    const rows = computeTotals(
      sheet([
        attr("a", "50"),
        { ...attr("c", "x"), kind: "text", active: true, bonuses: [{ attrId: "a", amount: -7, mode: "while_active" }] },
      ]),
    );
    expect(rows[0].total).toBe(43);
  });

  it("多条加成同目标直接累加", () => {
    const rows = computeTotals(
      sheet([
        attr("a", "10"),
        { ...attr("s1", "1"), bonuses: [{ attrId: "a", amount: 5, mode: "permanent" }] },
        { ...attr("s2", "1"), active: true, bonuses: [{ attrId: "a", amount: 3, mode: "while_active" }] },
      ]),
    );
    expect(rows[0].bonus).toBe(8);
    expect(rows[0].total).toBe(18);
  });

  it("加成目标不存在时忽略（目标被删的兜底）", () => {
    const rows = computeTotals(
      sheet([{ ...attr("s", "1"), bonuses: [{ attrId: "ghost", amount: 5, mode: "permanent" }] }]),
    );
    expect(rows).toEqual([]);
  });

  it("非数字基础值容错为 0；跨分组的加成照常汇总", () => {
    const rows = computeTotals({
      groups: [
        { id: "g1", name: "状态", entries: [attr("a", "abc")] },
        {
          id: "g2",
          name: "装备",
          entries: [
            { ...attr("e", "x"), kind: "text", active: true, bonuses: [{ attrId: "a", amount: 6, mode: "while_active" }] },
          ],
        },
      ],
    });
    expect(rows[0].base).toBe(0);
    expect(rows[0].total).toBe(6);
  });
});
