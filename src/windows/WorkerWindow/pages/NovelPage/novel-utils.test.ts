import { describe, expect, it } from "vitest";
import {
  buildBreadcrumb,
  buildChapterGroups,
  buildEntityTerms,
  buildSearchSnippet,
  calcGoalProgress,
  calcSpeed,
  countWords,
  findTermMatches,
  formatClock,
  formatThousands,
  fuzzyMatch,
  padIndex,
  splitByKeyword,
  truncate,
} from "./novel-utils";
import type { NovelChapter, NovelEntity, NovelVolume } from "./types";

const entity = (over: Partial<NovelEntity>): NovelEntity => ({
  id: "e1",
  workId: "w1",
  type: "character",
  name: "沈砚",
  aliases: [],
  summary: "",
  content: "",
  fields: {},
  sort: 0,
  ...over,
});

describe("countWords", () => {
  it("含标点口径统计所有非空白字符", () => {
    expect(countWords("你好，世界！", "withPunctuation")).toBe(6);
  });

  it("纯汉字口径忽略标点与空白", () => {
    expect(countWords("你好，世界！ a b", "hanOnly")).toBe(4);
  });

  it("空串与空白串返回 0", () => {
    expect(countWords("", "withPunctuation")).toBe(0);
    expect(countWords("   \n\t", "hanOnly")).toBe(0);
  });
});

describe("格式化工具", () => {
  it("千分位分隔", () => {
    expect(formatThousands(3240)).toBe("3,240");
    expect(formatThousands(1208)).toBe("1,208");
    expect(formatThousands(0)).toBe("0");
  });

  it("章节序号补零", () => {
    expect(padIndex(7)).toBe("07");
    expect(padIndex(12)).toBe("12");
  });

  it("时钟格式 HH:mm", () => {
    const ts = new Date(2026, 8, 18, 14, 32).getTime();
    expect(formatClock(ts)).toBe("14:32");
  });
});

describe("buildEntityTerms", () => {
  it("只纳入启用类型的要素", () => {
    const terms = buildEntityTerms(
      [
        entity({ id: "e1", type: "character", name: "沈砚" }),
        entity({ id: "e2", type: "location", name: "青梧山" }),
      ],
      ["character"],
    );
    expect(terms.map((term) => term.term)).toEqual(["沈砚"]);
  });

  it("名称与别名都进词库且去重", () => {
    const terms = buildEntityTerms(
      [entity({ name: "沈砚", aliases: ["阿砚", "沈砚", "沈师兄"] })],
      ["character"],
    );
    expect(terms.map((term) => term.term)).toEqual(["沈师兄", "沈砚", "阿砚"]);
  });

  it("长词排在前面，避免短名吃掉长名", () => {
    const terms = buildEntityTerms(
      [
        entity({ id: "a", type: "location", name: "青梧" }),
        entity({ id: "b", type: "location", name: "青梧山" }),
      ],
      ["location"],
    );
    expect(terms[0].term).toBe("青梧山");
  });
});

describe("findTermMatches", () => {
  it("命中区间不重叠且长词优先", () => {
    const terms = [
      { term: "青梧", entityId: "a", type: "location" as const },
      { term: "青梧山", entityId: "b", type: "location" as const },
    ];
    const matches = findTermMatches("远望青梧山，雨雾中", terms);
    expect(matches).toHaveLength(1);
    expect(matches[0].term).toBe("青梧山");
    expect(matches[0].from).toBe(2);
    expect(matches[0].to).toBe(5);
  });

  it("词库为空或文本为空时不产生命中", () => {
    expect(findTermMatches("任意文本", [])).toEqual([]);
    expect(findTermMatches("", [{ term: "沈砚", entityId: "a", type: "character" }])).toEqual([]);
  });
});

describe("目标与速度", () => {
  it("进度封顶 100，目标为 0 时返回 0", () => {
    expect(calcGoalProgress(3200, 3000)).toBe(100);
    expect(calcGoalProgress(1500, 3000)).toBe(50);
    expect(calcGoalProgress(1500, 0)).toBe(0);
  });

  it("速度为每分钟字数，时间非法返回 0", () => {
    expect(calcSpeed(600, 10)).toBe(60);
    expect(calcSpeed(600, 0)).toBe(0);
  });
});

describe("splitByKeyword", () => {
  it("按关键词切分并标记命中段", () => {
    const segments = splitByKeyword("你好青梧山的雨", "青梧山");
    expect(segments).toEqual([
      { text: "你好", hit: false },
      { text: "青梧山", hit: true },
      { text: "的雨", hit: false },
    ]);
  });

  it("关键词为空时整段返回", () => {
    expect(splitByKeyword("原文", "")).toEqual([{ text: "原文", hit: false }]);
  });

  it("大小写不敏感", () => {
    const segments = splitByKeyword("Alpha Beta", "alpha");
    expect(segments[0]).toEqual({ text: "Alpha", hit: true });
  });
});

describe("truncate", () => {
  it("超长截断并补省略号，emoji 按字符计", () => {
    expect(truncate("一二三四五六", 3)).toBe("一二三…");
    expect(truncate("短", 10)).toBe("短");
  });
});

describe("buildSearchSnippet", () => {
  it("抽取关键词附近片段并压缩空白", () => {
    const snippet = buildSearchSnippet("远望\n青梧山，雨雾里只见半截山门", "青梧山", 2);
    expect(snippet).toBe("…望 青梧山，雨…");
  });

  it("未命中时退化为开头摘要", () => {
    expect(buildSearchSnippet("没有任何关联的一段话", "缺失词", 2)).toBe("没有任何…");
  });
});

describe("fuzzyMatch", () => {
  it("连续命中排序优先", () => {
    const list = ["雨夜叩门", "青梧山道", "音档如下"];
    expect(fuzzyMatch(list, "雨夜", (item) => item)[0]).toBe("雨夜叩门");
  });

  it("无法组成子序列的结果被过滤掉", () => {
    expect(fuzzyMatch(["abc"], "xyz", (item) => item)).toEqual([]);
  });

  it("空关键词返回原序", () => {
    expect(fuzzyMatch(["b", "a"], "", (item) => item)).toEqual(["b", "a"]);
  });
});

describe("卷章分组与面包屑", () => {
  const volumes: NovelVolume[] = [
    { id: "v1", workId: "w1", name: "第一卷", sort: 1 },
    { id: "v2", workId: "w1", name: "第二卷", sort: 2 },
  ];
  const chapters: NovelChapter[] = [
    { id: "c2", workId: "w1", volumeId: "v1", title: "第二章", content: "", wordCount: 0, status: "draft", sort: 2, updatedAt: 0 },
    { id: "c1", workId: "w1", volumeId: "v1", title: "第一章", content: "", wordCount: 0, status: "done", sort: 1, updatedAt: 0 },
    { id: "c3", workId: "w1", volumeId: "v2", title: "第三章", content: "", wordCount: 0, status: "draft", sort: 1, updatedAt: 0 },
  ];

  it("按卷排序，卷内按 sort 排序", () => {
    const groups = buildChapterGroups(volumes, chapters);
    expect(groups[0].volume.name).toBe("第一卷");
    expect(groups[0].chapters.map((c) => c.title)).toEqual(["第一章", "第二章"]);
    expect(groups[1].chapters.map((c) => c.title)).toEqual(["第三章"]);
  });

  it("面包屑取当前章所属卷", () => {
    expect(buildBreadcrumb(volumes, chapters, "c3")).toEqual({
      volumeName: "第二卷",
      chapterName: "第三章",
    });
  });

  it("无选中章节时面包屑为空", () => {
    expect(buildBreadcrumb(volumes, chapters, null)).toEqual({
      volumeName: "",
      chapterName: "",
    });
  });
});
