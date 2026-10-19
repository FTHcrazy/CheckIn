import { describe, expect, it } from "vitest";
import { AcAutomaton, automatonOf } from "./ac-automaton";

describe("AcAutomaton", () => {
  it("命中单个词条并给出正确的起止下标", () => {
    const ac = new AcAutomaton(["色情"]);
    expect(ac.match("这是色情内容")).toEqual([
      { from: 2, to: 4, pattern: 0 },
    ]);
  });

  it("一次扫描命中多个互不相邻的词条", () => {
    const ac = new AcAutomaton(["色情", "赌博"]);
    const hits = ac.match("色情与赌博都违规");
    expect(hits.map((hit) => hit.from)).toEqual([0, 3]);
    expect(hits.map((hit) => ac.patternAt(hit.pattern))).toEqual(["色情", "赌博"]);
  });

  it("同起点长词优先，短词不再单独产出（避免高亮叠加）", () => {
    const ac = new AcAutomaton(["色情", "色情小说"]);
    const hits = ac.match("色情小说不该发");
    expect(hits).toHaveLength(1);
    expect(ac.patternAt(hits[0].pattern)).toBe("色情小说");
  });

  it("失配后靠 fail 指针继续推进，不丢后续命中", () => {
    // "aab"：第二个 a 在 "a" 节点上没有 a 转移，必须经 fail 回到 root 再进 "a"
    const hits = new AcAutomaton(["ab"]).match("aab");
    expect(hits).toEqual([{ from: 1, to: 3, pattern: 0 }]);
  });

  it("后缀命中被折叠进更长的命中（不重叠语义）", () => {
    // "ushers" 里 she[1,4] 与 he[2,4]、hers[2,6] 全部重叠，
    // 按「同起点长词优先 + 丢弃被覆盖区间」只剩一条
    const ac = new AcAutomaton(["he", "she", "his", "hers"]);
    expect(ac.matchWords("ushers")).toEqual(["she"]);
  });

  it("同一段文本里重复出现的词条各自计一次", () => {
    const ac = new AcAutomaton(["毒品"]);
    const hits = ac.match("毒品毒品毒品");
    expect(hits).toHaveLength(3);
  });

  it("空词库 / 空文本返回空数组", () => {
    expect(new AcAutomaton([]).match("任何内容")).toEqual([]);
    expect(new AcAutomaton(["词"]).match("")).toEqual([]);
  });

  it("空串词条被过滤，不产生零宽命中", () => {
    const ac = new AcAutomaton(["", "色情"]);
    expect(ac.size).toBe(1);
    expect(ac.match("色情")).toEqual([{ from: 0, to: 2, pattern: 0 }]);
  });

  it("词库规模不影响正确性：命中数量与逐个子串判断一致", () => {
    const words = ["暴力", "血腥", "肢解", "赌博", "毒品"];
    const text = "暴力与血腥、肢解、赌博、毒品";
    const ac = new AcAutomaton(words);
    const byRaw = words.filter((word) => text.includes(word));
    expect(ac.matchWords(text).sort()).toEqual(byRaw.sort());
  });
});

describe("automatonOf 缓存", () => {
  it("同一数组引用返回同一实例（分批扫描全书时不重复构建）", () => {
    const words = ["色情", "赌博"];
    expect(automatonOf(words)).toBe(automatonOf(words));
  });

  it("换了数组引用就重建，词库热更新立即生效", () => {
    const first = automatonOf(["色情"]);
    const second = automatonOf(["色情", "赌博"]);
    expect(first).not.toBe(second);
    expect(second.matchWords("赌博")).toEqual(["赌博"]);
    expect(first.matchWords("赌博")).toEqual([]);
  });
});
