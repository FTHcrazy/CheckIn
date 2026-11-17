import { describe, expect, it } from "vitest";
import type { InterviewItemDetailDTO } from "@/shared/types/electron";
import { QUESTION_BANK } from "../data/interview-bank";
import { DIAGRAMS } from "../data/interview-diagrams";
import { GLOSSARY_TERMS } from "../data/interview-glossary";
import { CATEGORIES } from "../data/interview-taxonomy";
import type { CategoryNode } from "../data/interview-taxonomy";
import { buildMergeBaseline, toMergeRows } from "./interview-bank-source";

/**
 * 货源层的守卫（T06-A）。
 *
 * 这一层只回答两个问题，都是「接错了不会报错、只会静默少数据」的类型：
 * ① 基线是不是真的四个常量都给全了（漏一个 → 词条不再变蓝 / 图解消失）；
 * ② DTO 投影成 `MergeRow` 时字段有没有错位、脏 action 有没有被挡住
 *    （放过 `baseline` 行 → 合并层把它当覆盖行，用户的题被默认内容盖掉）。
 */
function makeItem(overrides: Partial<InterviewItemDetailDTO> = {}): InterviewItemDetailDTO {
  return {
    id: "u-q-demo",
    kind: "question",
    action: "new",
    baseId: null,
    status: "adopted",
    origin: "manual",
    categoryId: "foundation-js",
    track: "foundation",
    title: "演示题：这是用户自己加的",
    errors: [],
    updatedAt: 1_760_000_000_000,
    payload: { id: "u-q-demo", title: "演示题：这是用户自己加的" },
    sourceIntent: null,
    aiLogId: null,
    baseStamp: null,
    baseHash: null,
    ackBaseHash: null,
    reviewedAt: null,
    createdAt: 1_760_000_000_000,
    deletedAt: null,
    ...overrides,
  };
}

describe("buildMergeBaseline", () => {
  it("四类基线都给全，且数量与源码常量一致", () => {
    const baseline = buildMergeBaseline();

    expect(baseline.questions).toHaveLength(QUESTION_BANK.length);
    expect(baseline.glossary).toHaveLength(GLOSSARY_TERMS.length);
    expect(baseline.diagrams).toHaveLength(DIAGRAMS.length);
    expect(baseline.categories).toHaveLength(CATEGORIES.length);
  });

  it("直接引用常量（不复制）：下游 useMemo 靠引用判等，复制一份等于每次都重算", () => {
    const baseline = buildMergeBaseline();

    expect(baseline.questions).toBe(QUESTION_BANK);
    expect(baseline.glossary).toBe(GLOSSARY_TERMS);
    expect(baseline.diagrams).toBe(DIAGRAMS);
    expect(baseline.categories).toBe(CATEGORIES);
  });

  it("传入分类时用传入的那份（留给后续拼自定义分类）", () => {
    const custom: readonly CategoryNode[] = [
      { id: "foundation-js", label: "JavaScript", track: "foundation", order: 7 },
    ];

    const baseline = buildMergeBaseline(custom);

    expect(baseline.categories).toBe(custom);
    // 其余三类不受影响
    expect(baseline.questions).toBe(QUESTION_BANK);
  });
});

describe("toMergeRows", () => {
  it("字段完整映射，payload 原样带过去", () => {
    const payload = { id: "u-q-demo", title: "演示题" };
    const [row] = toMergeRows([
      makeItem({
        id: "u-q-demo",
        kind: "question",
        action: "new",
        baseId: null,
        status: "adopted",
        title: "演示题",
        payload,
        updatedAt: 1_760_000_000_123,
      }),
    ]).rows;

    expect(row).toEqual({
      id: "u-q-demo",
      kind: "question",
      action: "new",
      baseId: null,
      status: "adopted",
      title: "演示题",
      payload,
      baseStamp: null,
      baseHash: null,
      ackBaseHash: null,
      updatedAt: 1_760_000_000_123,
    });
    // 引用不变：payload 由合并层统一做 JSON.parse / 结构校验，这里不许提前处理
    expect(row.payload).toBe(payload);
  });

  it("覆盖行的 baseId / baseStamp / baseHash / ackBaseHash 一并带过来", () => {
    const [row] = toMergeRows([
      makeItem({
        id: "js-event-loop",
        action: "override",
        baseId: "js-event-loop",
        status: "adopted",
        baseStamp: "2026-01-15",
        baseHash: "fp:11112222",
        ackBaseHash: "fp:33334444",
      }),
    ]).rows;

    expect(row.action).toBe("override");
    expect(row.baseId).toBe("js-event-loop");
    expect(row.baseStamp).toBe("2026-01-15");
    expect(row.baseHash).toBe("fp:11112222");
    expect(row.ackBaseHash).toBe("fp:33334444");
  });

  it("action 只接受 new / override：baseline 与未知值被丢弃并计数", () => {
    const result = toMergeRows([
      makeItem({ id: "u-q-a", action: "new" }),
      makeItem({ id: "js-event-loop", action: "override", baseId: "js-event-loop" }),
      // full 模式导出文件里的值，导入后会混进表里
      makeItem({ id: "js-closure", action: "baseline" }),
      makeItem({ id: "u-q-b", action: "占位" }),
      // 大小写不同的变体同样不认（库里约定是小写字面量）
      makeItem({ id: "u-q-c", action: "NEW" }),
    ]);

    expect(result.rows.map((row) => row.id)).toEqual(["u-q-a", "js-event-loop"]);
    expect(result.skipped).toBe(3);
  });

  it("空 id 的行也丢掉（无法当 React key，也没法和基线对齐）", () => {
    const result = toMergeRows([makeItem({ id: "   " }), makeItem({ id: "u-q-ok" })]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].id).toBe("u-q-ok");
    expect(result.skipped).toBe(1);
  });

  it("空数组 → 空行、零跳过（未登录 / 空库是正常状态，不是脏数据）", () => {
    expect(toMergeRows([])).toEqual({ rows: [], skipped: 0 });
  });
});
