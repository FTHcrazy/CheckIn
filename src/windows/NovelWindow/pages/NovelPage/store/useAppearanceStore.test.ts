import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntityTerm, NovelChapter } from "../types";
import {
  appearancesOf,
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

describe("useAppearanceStore —— 首扫分批调度（长篇小说不冻结主线程）", () => {
  beforeEach(() => {
    resetScan();
    resetAppearances();
  });

  afterEach(() => {
    resetAppearances();
    vi.clearAllMocks();
  });

  /** 造出超过分批阈值的章节量（阈值 400）：500 章必走分片 */
  const manyChapters = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      // 每章都命中 e1：最终 counts.get("e1") === count
      chapter(`c${i}`, `苏晚第${i}章`),
    );

  it("待扫超过阈值时立即标记 pending，并在调度结束后补齐索引", async () => {
    const chapters = manyChapters(500);
    const terms = [term("苏晚", "e1")];

    syncAppearances(chapters, terms);

    // 首帧：不能等全部扫完才给反馈，pending 必须立刻为 true
    expect(state().pending).toBe(true);
    // 未扫完前不应给出「完整」结果（已扫部分的中间态允许存在，但一定 < 全量）
    expect(state().counts.get("e1") ?? 0).toBeLessThan(500);

    // 让出主线程的调度跑完（setTimeout(0) 宏任务）
    await vi.waitFor(() => {
      expect(state().pending).toBe(false);
    });
    expect(state().counts.get("e1")).toBe(500);
  });

  it("分片期间重复同步会取消在途调度，最终结果以最后一次为准", async () => {
    const terms = [term("苏晚", "e1")];
    syncAppearances(manyChapters(500), terms);
    expect(state().pending).toBe(true);

    // 内容全变：再来一次，取消上一轮分片，避免两轮互相覆盖
    resetScan();
    const next = manyChapters(600);
    syncAppearances(next, terms);

    await vi.waitFor(() => {
      expect(state().pending).toBe(false);
    });
    expect(state().counts.get("e1")).toBe(600);
  });

  it("reset 会取消在途分片，之后不会再把旧书结果写回来", async () => {
    const terms = [term("苏晚", "e1")];
    syncAppearances(manyChapters(500), terms);
    expect(state().pending).toBe(true);

    resetAppearances();
    expect(state().pending).toBe(false);
    expect(state().counts.size).toBe(0);

    // 等过原本分片该跑完的时间：旧结果不得回流
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(state().counts.size).toBe(0);
    expect(appearancesOf("e1")).toEqual([]);
  });

  it("小书（低于阈值）仍同步扫完，保持「保存后角标立即正确」", () => {
    const terms = [term("苏晚", "e1")];
    syncAppearances([chapter("c1", "苏晚"), chapter("c2", "苏晚")], terms);
    // 没有 pending 过程，直接可用
    expect(state().pending).toBe(false);
    expect(state().counts.get("e1")).toBe(2);
  });

  it("分片完成后倒排索引可用（详情卡跳转列表拿到全部出场章）", async () => {
    const terms = [term("苏晚", "e1")];
    syncAppearances(manyChapters(500), terms);
    await vi.waitFor(() => {
      expect(state().pending).toBe(false);
    });
    expect(appearancesOf("e1")).toHaveLength(500);
  });
});

describe("appearancesOf（详情卡跳转列表走倒排索引，不再扫全书）", () => {
  beforeEach(() => {
    resetScan();
    resetAppearances();
  });

  afterEach(() => {
    resetAppearances();
    vi.clearAllMocks();
  });

  const chapters = () => [
    chapter("c1", "青梧走进山门"),
    chapter("c2", "山门空无一人"),
    chapter("c3", "青梧与掌门对峙"),
  ];
  const terms = () => [term("青梧", "e1"), term("掌门", "e2")];

  it("返回出场章节 id，顺序与书籍顺序一致", () => {
    syncAppearances(chapters(), terms());
    expect(appearancesOf("e1")).toEqual(["c1", "c3"]);
    expect(appearancesOf("e2")).toEqual(["c3"]);
  });

  it("读倒排索引不再触发任何扫描（详情卡开着也不重扫）", () => {
    syncAppearances(chapters(), terms());
    resetScan();
    appearancesOf("e1");
    appearancesOf("e2");
    expect(scanCount()).toBe(0);
  });

  it("拖拽重排后顺序跟着 chapters 变，而不是停留在缓存插入序", () => {
    syncAppearances(chapters(), terms());
    const reordered = [chapters()[2], chapters()[0], chapters()[1]];
    // 内容没变 —— 只有顺序变了，索引必须按新的 chapters 顺序重排
    syncAppearances(reordered, terms());
    expect(appearancesOf("e1")).toEqual(["c3", "c1"]);
  });

  it("reset 后倒排索引清空（切作品不该读到上一本书）", () => {
    syncAppearances(chapters(), terms());
    resetAppearances();
    expect(appearancesOf("e1")).toEqual([]);
  });
});
