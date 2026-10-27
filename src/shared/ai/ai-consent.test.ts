import { describe, expect, it } from "vitest";
import {
  COMPLIANCE_NOTICE,
  DATA_LEVEL_LABELS,
  DEFAULT_L3_SCOPE,
  isL3,
  L3_SCOPE_LABELS,
  L3_SCOPE_ORDER,
} from "./ai-consent";

describe("数据分级", () => {
  it("只有 L3 需要授权弹窗", () => {
    expect(isL3("L3")).toBe(true);
    expect(isL3("L2")).toBe(false);
    expect(isL3("L1")).toBe(false);
  });

  it("三个分级都有中文标签", () => {
    expect(DATA_LEVEL_LABELS.L1).toContain("字段级");
    expect(DATA_LEVEL_LABELS.L2).toContain("片段级");
    expect(DATA_LEVEL_LABELS.L3).toContain("整章");
  });
});

describe("L3 范围", () => {
  it("不提供「全书」档（Q4 拍板：成本与隐私不可控）", () => {
    expect(L3_SCOPE_ORDER).not.toContain("book");
    expect(L3_SCOPE_LABELS).not.toHaveProperty("book");
  });

  it("默认范围保守为「仅本章」", () => {
    expect(DEFAULT_L3_SCOPE).toBe("chapter");
    expect(L3_SCOPE_ORDER[0]).toBe("chapter");
  });

  it("三个范围都有中文标签且顺序固定", () => {
    expect(L3_SCOPE_ORDER).toEqual(["chapter", "selection", "recent3"]);
    expect(L3_SCOPE_LABELS.chapter).toBe("仅本章");
    expect(L3_SCOPE_LABELS.selection).toBe("选中段落");
    expect(L3_SCOPE_LABELS.recent3).toBe("最近 3 章");
  });
});

describe("合规提示位", () => {
  it("声明「不中转、不存储作品内容」", () => {
    expect(COMPLIANCE_NOTICE).toContain("不中转");
    expect(COMPLIANCE_NOTICE).toContain("不存储");
  });
});
