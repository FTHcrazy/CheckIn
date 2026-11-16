import { describe, expect, it } from "vitest";
import {
  isAiGenerated,
  makeAiProvenance,
  newBatchId,
  summaryModelOf,
} from "./ai-provenance";

describe("makeAiProvenance（M6 来源标记构造）", () => {
  it("模型名与批次齐全时返回完整标记", () => {
    const p = makeAiProvenance("gpt-4o", 1700000000000, "ai_batch_1");
    expect(p).toEqual({
      source: "ai",
      model: "gpt-4o",
      at: 1700000000000,
      batchId: "ai_batch_1",
    });
  });

  it("模型名或批次缺失时返回 null（宁可无标记也不落「来源不明」的假标记）", () => {
    expect(makeAiProvenance("", 1, "b")).toBeNull();
    expect(makeAiProvenance("  ", 1, "b")).toBeNull();
    expect(makeAiProvenance("gpt", 1, "")).toBeNull();
    expect(makeAiProvenance(undefined, 1, "b")).toBeNull();
    expect(makeAiProvenance(null, 1, "b")).toBeNull();
  });

  it("模型名去首尾空白", () => {
    const p = makeAiProvenance("  gpt-4o  ", 1, "b");
    expect(p?.model).toBe("gpt-4o");
  });
});

describe("isAiGenerated", () => {
  it("source === ai 才判定为 AI 生成", () => {
    expect(isAiGenerated({ source: "ai", model: "m", at: 1, batchId: "b" })).toBe(true);
    expect(isAiGenerated(null)).toBe(false);
    expect(isAiGenerated(undefined)).toBe(false);
  });
});

describe("newBatchId", () => {
  it("每次生成唯一、以 ai_ 前缀", () => {
    const a = newBatchId();
    const b = newBatchId();
    expect(a).not.toBe(b);
    expect(a.startsWith("ai_")).toBe(true);
    expect(b.startsWith("ai_")).toBe(true);
  });
});

describe("summaryModelOf（摘要列 ↔ M6 溯源桥）", () => {
  it("AI 生成返回模型名，无标记返回空串（= 手工编辑清空来源）", () => {
    expect(summaryModelOf({ source: "ai", model: "gpt-4o", at: 1, batchId: "b" })).toBe(
      "gpt-4o",
    );
    expect(summaryModelOf(null)).toBe("");
  });
});
