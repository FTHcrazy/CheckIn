import { describe, expect, it } from "vitest";
import {
  matchSelectionForCard,
  type MatchSelectionForCardInput,
} from "./matchSelectionForCard";

const TERMS = [
  { term: "林晚照", entityId: "e1" },
  { term: "晚照", entityId: "e1" },
  { term: "青云山", entityId: "e2" },
  { term: "青云山", entityId: "e3" },
];

const input = (overrides: Partial<MatchSelectionForCardInput> = {}): MatchSelectionForCardInput => ({
  selection: "林晚照",
  isComposing: false,
  focusOrigin: "body",
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  terms: TERMS,
  ...overrides,
});

/** O-17 §2.2 的 R1~R5：命中才开卡，任何一条不满足都放行编辑器默认行为 */
describe("matchSelectionForCard：选区裸 Enter 开卡判据", () => {
  it("R1：空选区 / 纯空白 → 不触发", () => {
    expect(matchSelectionForCard(input({ selection: "" }))).toEqual({ kind: "none" });
    expect(matchSelectionForCard(input({ selection: "   " }))).toEqual({ kind: "none" });
  });

  it("R2：精确命中名字或别名（含首尾空白）→ 开对应卡", () => {
    expect(matchSelectionForCard(input())).toEqual({ kind: "entity", entityId: "e1" });
    expect(
      matchSelectionForCard(input({ selection: "  晚照  " })),
    ).toEqual({ kind: "entity", entityId: "e1" });
  });

  it("R2：包含但不等于 → 普通文本，放行换行", () => {
    expect(matchSelectionForCard(input({ selection: "林晚照站在山巅" }))).toEqual({
      kind: "none",
    });
  });

  it("R1：IME 组合中 Enter 不误触发", () => {
    expect(matchSelectionForCard(input({ isComposing: true }))).toEqual({ kind: "none" });
  });

  it("R3：同名/别名多命中 → 返回候选列表交调用方弹 Dropdown", () => {
    const result = matchSelectionForCard(input({ selection: "青云山" }));
    expect(result.kind).toBe("candidates");
    if (result.kind === "candidates") {
      expect(result.entityIds).toEqual(["e2", "e3"]);
    }
  });

  it("R4：带任何修饰键 → 保留编辑器原行为", () => {
    for (const key of ["shiftKey", "ctrlKey", "metaKey", "altKey"] as const) {
      expect(matchSelectionForCard(input({ [key]: true }))).toEqual({ kind: "none" });
    }
  });

  it("R5：焦点不在正文 → 不抢输入框 / 弹窗的 Enter", () => {
    expect(matchSelectionForCard(input({ focusOrigin: "other" }))).toEqual({
      kind: "none",
    });
  });
});
