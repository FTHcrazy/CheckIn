import { describe, expect, it } from "vitest";
import { toCategoryNodes } from "./useInterviewBank";
import { mergeInterviewBank, type MergeRow } from "../persistence/merge-interview-bank";
import { hashPayload } from "../persistence/interview-hash";
import { buildMergeBaseline } from "../persistence/interview-bank-source";
import type { InterviewTaxonomyDTO } from "@/shared/types/electron";
import type { InterviewQuestion } from "../data/interview-types";

/**
 * 自定义分类（`u-c-*`）在合并视图里的接线（T06-B）。
 *
 * 三件事必须成立，否则「AI 建了个分类、题也出了」在界面上就是「分类不见了、
 * 题也不见了」：
 * 1. 只有 `adopted` 的分类进白名单（`draft` 是预览态）；
 * 2. 合并时挂在自定义分类下的题要保留自己的 `categoryId`，不被回落到基线分类；
 * 3. 分类被删（题悬空）时回落基线分类并记 warning，而不是崩。
 */
function taxonomy(overrides: Partial<InterviewTaxonomyDTO> = {}): InterviewTaxonomyDTO {
  return {
    id: "u-c-rsc",
    label: "RSC 与服务端组件",
    track: "foundation",
    orderNo: 101,
    status: "adopted",
    origin: "manual",
    note: "服务端组件边界",
    updatedAt: 1,
    ...overrides,
  };
}

/** 一条挂在自定义分类下的用户新增题 */
function addedQuestion(categoryId: string): InterviewQuestion {
  return {
    id: "u-q-rsc-0001",
    title: "RSC 的数据序列化限制",
    stem: "为什么服务端组件不能把函数传给客户端组件？",
    answer: "因为跨边界只允许可序列化的值……",
    track: "foundation",
    categoryId: categoryId as InterviewQuestion["categoryId"],
    difficulty: "medium",
    tags: ["RSC"],
    topic: "RSC",
    reviewedAt: "2026-11",
    heat: 50,
    updatedAt: "2026-11-17",
  };
}

function row(question: InterviewQuestion): MergeRow {
  return {
    id: question.id,
    kind: "question",
    action: "new",
    baseId: null,
    status: "adopted",
    title: question.title,
    payload: question,
    baseStamp: null,
    baseHash: null,
    ackBaseHash: null,
    updatedAt: 1,
  };
}

describe("toCategoryNodes", () => {
  it("只收 adopted，并按 orderNo 排序", () => {
    const nodes = toCategoryNodes([
      taxonomy({ id: "u-c-b", label: "B", orderNo: 102 }),
      taxonomy({ id: "u-c-a", label: "A", orderNo: 101 }),
      taxonomy({ id: "u-c-draft", label: "草稿", status: "draft" }),
    ]);

    expect(nodes.map((node) => node.id)).toEqual(["u-c-a", "u-c-b"]);
    expect(nodes[0].track).toBe("foundation");
  });

  it("轨道非法的行被丢掉（脏数据不该把侧栏渲染成 undefined 分组）", () => {
    const nodes = toCategoryNodes([taxonomy({ track: "unknown" })]);
    expect(nodes).toEqual([]);
  });
});

describe("合并且自定义分类", () => {
  const custom = toCategoryNodes([taxonomy()]);
  const baseline = buildMergeBaseline([...buildMergeBaseline().categories, ...custom]);

  it("挂在自定义分类下的新增题保留原分类", () => {
    const merged = mergeInterviewBank(baseline, [row(addedQuestion("u-c-rsc"))], hashPayload);

    const question = merged.questions.find((item) => item.id === "u-q-rsc-0001");
    expect(question?.categoryId).toBe("u-c-rsc");
    expect(merged.categories.some((node) => node.id === "u-c-rsc")).toBe(true);
    expect(merged.warnings).toEqual([]);
  });

  it("分类没进白名单时按未分类保留，并记一条 warning（不丢题）", () => {
    const merged = mergeInterviewBank(
      buildMergeBaseline(),
      [row(addedQuestion("u-c-missing"))],
      hashPayload,
    );

    const question = merged.questions.find((item) => item.id === "u-q-rsc-0001");
    expect(question).toBeDefined();
    expect(merged.warnings.some((text) => text.includes("不在可用分类里"))).toBe(true);
  });
});
