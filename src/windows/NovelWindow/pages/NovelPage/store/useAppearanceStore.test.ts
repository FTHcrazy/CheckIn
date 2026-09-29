import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntityTerm, NovelChapter } from "../types";
import {
  resetAppearances,
  syncAppearances,
  useAppearanceStore,
} from "./useAppearanceStore";

/** 统计 findTermMatches 的调用次数：用它证明「只重扫内容变了的章」 */
const scan = vi.hoisted(() => ({ count: 0 }));

vi.mock("../novel-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../novel-utils")>();
  return {
    ...actual,
    findTermMatches: (...args: Parameters<typeof actual.findTermMatches>) => {
      scan.count += 1;
      return actual.findTermMatches(...args);
    },
  };
});

const scanCount = () => scan.count;
const resetScan = () => {
  scan.count = 0;
};

const state = () => useAppearanceStore.getState();

function chapter(id: string, content: string): NovelChapter {
  return {
    id,
    workId: "w1",
    volumeId: "v1",
    title: id,
    content,
    wordCount: content.length,
    status: "draft",
    sort: 1,
    updatedAt: 0,
  };
}

function term(term: string, entityId: string): EntityTerm {
  return { term, entityId, type: "character" };
}

describe("useAppearanceStore（要素出场章数索引）", () => {
  beforeEach(() => {
    resetScan();
    resetAppearances();
  });

  afterEach(() => {
    resetAppearances();
    vi.clearAllMocks();
  });

  it("首次同步按章聚合出出场章数", () => {
    const chapters = [
      chapter("c1", "苏晚走进了灵潮"),
      chapter("c2", "陆昭看着苏晚"),
      chapter("c3", "无关正文"),
    ];
    const terms = [term("苏晚", "e1"), term("陆昭", "e2")];

    syncAppearances(chapters, terms);

    expect(state().counts.get("e1")).toBe(2);
    expect(state().counts.get("e2")).toBe(1);
    expect(scanCount()).toBe(3);
  });

  it("只改一章正文时只重扫那一章（保存正文不再全书扫描）", () => {
    const chapters = [
      chapter("c1", "苏晚"),
      chapter("c2", "陆昭"),
      chapter("c3", "无"),
      chapter("c4", "无"),
    ];
    const terms = [term("苏晚", "e1"), term("陆昭", "e2")];

    syncAppearances(chapters, terms);
    expect(scanCount()).toBe(4);

    // c1 内容替换（模拟自动保存写回当前章），其余章原样
    resetScan();
    syncAppearances(
      [chapter("c1", "苏晚与陆昭同行"), chapters[1], chapters[2], chapters[3]],
      terms,
    );

    // 只有 c1 被重扫 —— 这正是把索引搬出组件的核心收益
    expect(scanCount()).toBe(1);
    expect(state().counts.get("e1")).toBe(1);
    expect(state().counts.get("e2")).toBe(2);
  });

  it("章节数组重建但内容全未变时，不产生新索引（订阅者不会空重渲染）", () => {
    const terms = [term("苏晚", "e1")];
    syncAppearances([chapter("c1", "苏晚来了")], terms);
    const before = state().counts;

    syncAppearances([chapter("c1", "苏晚来了")], terms);
    expect(state().counts).toBe(before);
    expect(scanCount()).toBe(1);
  });

  it("词库变化会整表重扫（词库换引用 = 命中集合可能全变）", () => {
    const chapters = [chapter("c1", "苏晚与陆昭")];

    syncAppearances(chapters, [term("苏晚", "e1")]);
    expect(state().counts.get("e1")).toBe(1);

    resetScan();
    syncAppearances(chapters, [term("苏晚", "e1"), term("陆昭", "e2")]);
    expect(scanCount()).toBe(1);
    expect(state().counts.get("e2")).toBe(1);
  });

  it("删除章节后其命中不再计入", () => {
    const terms = [term("苏晚", "e1")];
    const chapters = [chapter("c1", "苏晚"), chapter("c2", "苏晚")];

    syncAppearances(chapters, terms);
    expect(state().counts.get("e1")).toBe(2);

    syncAppearances([chapters[0]], terms);
    expect(state().counts.get("e1")).toBe(1);
  });

  it("reset 后索引清空，可重新同步", () => {
    const terms = [term("苏晚", "e1")];
    syncAppearances([chapter("c1", "苏晚")], terms);
    expect(state().counts.get("e1")).toBe(1);

    resetAppearances();
    expect(state().counts.size).toBe(0);

    syncAppearances([chapter("c1", "苏晚")], terms);
    expect(state().counts.get("e1")).toBe(1);
  });

  it("空词库不产出索引", () => {
    syncAppearances([chapter("c1", "苏晚")], []);
    expect(state().counts.size).toBe(0);
  });
});
