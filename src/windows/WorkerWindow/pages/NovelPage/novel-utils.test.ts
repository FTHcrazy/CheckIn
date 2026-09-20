import { describe, expect, it } from "vitest";
import {
  buildBreadcrumb,
  buildChapterGroups,
  buildChapterNumbers,
  buildEntityTerms,
  buildSearchSnippet,
  buildSortOrder,
  calcGoalProgress,
  calcSpeed,
  countWords,
  findTermMatches,
  formatClock,
  formatNumberedLabel,
  formatThousands,
  fuzzyMatch,
  insertItemBefore,
  moveItemBefore,
  padIndex,
  previewChapterReorder,
  previewChapterToVolume,
  previewVolumeReorder,
  splitByKeyword,
  toChineseOrdinal,
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

describe("拖拽排序纯函数", () => {
  const ids = (list: Array<{ id: string }>) => list.map((item) => item.id);
  const make = (names: string[]) => names.map((name) => ({ id: name }));

  it("moveItemBefore 向下拖：落到目标原位置", () => {
    expect(ids(moveItemBefore(make(["a", "b", "c"]), "a", "c"))).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("moveItemBefore 向上拖：落到目标原位置", () => {
    expect(ids(moveItemBefore(make(["a", "b", "c"]), "c", "a"))).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(ids(moveItemBefore(make(["a", "b", "c"]), "b", "a"))).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("moveItemBefore 相同 id 或找不到时原样返回且不修改入参", () => {
    const items = make(["a", "b"]);
    expect(moveItemBefore(items, "a", "a")).toBe(items);
    expect(moveItemBefore(items, "x", "a")).toBe(items);
    expect(moveItemBefore(items, "a", "x")).toBe(items);
    expect(ids(items)).toEqual(["a", "b"]);
  });

  it("insertItemBefore 插到目标之前，目标不存在则追加末尾", () => {
    expect(ids(insertItemBefore(make(["a", "c"]), "c", { id: "b" }))).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(ids(insertItemBefore(make(["a"]), "missing", { id: "b" }))).toEqual([
      "a",
      "b",
    ]);
  });

  it("buildSortOrder 按顺序生成 1 起的 sort 映射", () => {
    expect(buildSortOrder(make(["a", "b", "c"]))).toEqual(
      new Map([
        ["a", 1],
        ["b", 2],
        ["c", 3],
      ]),
    );
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

  it("buildChapterNumbers 跨卷连续编号", () => {
    expect(buildChapterNumbers(volumes, chapters)).toEqual(
      new Map([
        ["c1", 1],
        ["c2", 2],
        ["c3", 3],
      ]),
    );
  });

  it("buildChapterNumbers 随拖拽重排自动跟随（序号是排序的派生属性）", () => {
    // 模拟 c2 拖到卷二末尾（volumeId/sort 变更后重新派生）；
    // 注意上方 chapters 数组定义顺序是 [c2, c1, c3]，按 id 取避免索引陷阱
    const pick = (id: string): NovelChapter =>
      chapters.find((chapter) => chapter.id === id)!;
    const reordered: NovelChapter[] = [
      pick("c1"),
      pick("c3"),
      { ...pick("c2"), volumeId: "v2", sort: 2 },
    ];
    expect(buildChapterNumbers(volumes, reordered)).toEqual(
      new Map([
        ["c1", 1],
        ["c3", 2],
        ["c2", 3],
      ]),
    );
  });
});

describe("中文序号与标签预设", () => {
  it("toChineseOrdinal 覆盖常规序号范围", () => {
    expect(toChineseOrdinal(1)).toBe("一");
    expect(toChineseOrdinal(9)).toBe("九");
    expect(toChineseOrdinal(10)).toBe("十");
    expect(toChineseOrdinal(11)).toBe("十一");
    expect(toChineseOrdinal(20)).toBe("二十");
    expect(toChineseOrdinal(21)).toBe("二十一");
    expect(toChineseOrdinal(100)).toBe("一百");
    expect(toChineseOrdinal(101)).toBe("一百零一");
    expect(toChineseOrdinal(110)).toBe("一百一十");
    expect(toChineseOrdinal(123)).toBe("一百二十三");
    expect(toChineseOrdinal(1000)).toBe("一千");
    expect(toChineseOrdinal(1001)).toBe("一千零一");
    expect(toChineseOrdinal(1234)).toBe("一千二百三十四");
    expect(toChineseOrdinal(10000)).toBe("一万");
    expect(toChineseOrdinal(10001)).toBe("一万零一");
    expect(toChineseOrdinal(12345)).toBe("一万二千三百四十五");
  });

  it("formatNumberedLabel 数字样式与后缀自由组合", () => {
    expect(formatNumberedLabel("arabic", "章", 12)).toBe("第12章");
    expect(formatNumberedLabel("chinese", "回", 12)).toBe("第十二回");
    expect(formatNumberedLabel("arabic", "节", 3)).toBe("第3节");
    expect(formatNumberedLabel("chinese", "部", 21)).toBe("第二十一部");
    // 序号最小为 1，防御 0 / 负数；空后缀退化为纯序号
    expect(formatNumberedLabel("chinese", "卷", 0)).toBe("第一卷");
    expect(formatNumberedLabel("arabic", "", 7)).toBe("第7");
  });
});

describe("重排预览纯函数", () => {
  const volumes: NovelVolume[] = [
    { id: "v1", workId: "w1", name: "第一卷", sort: 1 },
    { id: "v2", workId: "w1", name: "第二卷", sort: 2 },
  ];
  const chapter = (id: string, volumeId: string, sort: number): NovelChapter => ({
    id,
    workId: "w1",
    volumeId,
    title: id,
    content: "",
    wordCount: 0,
    status: "draft",
    sort,
    updatedAt: 0,
  });
  const chapters: NovelChapter[] = [
    chapter("c1", "v1", 1),
    chapter("c2", "v1", 2),
    chapter("c3", "v2", 1),
  ];

  it("previewChapterReorder 同卷重排会顺延兄弟章节 sort", () => {
    const next = previewChapterReorder(chapters, "c2", "c1");
    expect(next.find((c) => c.id === "c1")?.sort).toBe(2);
    expect(next.find((c) => c.id === "c2")?.sort).toBe(1);
    expect(next.find((c) => c.id === "c3")?.sort).toBe(1);
  });

  it("previewChapterReorder 跨卷移动改 volumeId 并落入目标位置", () => {
    const next = previewChapterReorder(chapters, "c3", "c1");
    const c3 = next.find((c) => c.id === "c3");
    expect(c3?.volumeId).toBe("v1");
    expect(c3?.sort).toBe(1);
    expect(next.find((c) => c.id === "c1")?.sort).toBe(2);
    expect(next.find((c) => c.id === "c2")?.sort).toBe(3);
  });

  it("previewChapterReorder 自拖与找不到时原样返回", () => {
    expect(previewChapterReorder(chapters, "c1", "c1")).toBe(chapters);
    expect(previewChapterReorder(chapters, "x", "c1")).toBe(chapters);
  });

  it("previewChapterToVolume 移入目标卷末尾，已在卷内时原样返回", () => {
    const next = previewChapterToVolume(chapters, "c1", "v2");
    expect(next.find((c) => c.id === "c1")?.volumeId).toBe("v2");
    expect(next.find((c) => c.id === "c1")?.sort).toBe(2);
    expect(previewChapterToVolume(chapters, "c3", "v2")).toBe(chapters);
  });

  it("previewVolumeReorder 重排卷 sort，不影响章节", () => {
    const next = previewVolumeReorder(volumes, "v2", "v1");
    expect(next.find((v) => v.id === "v1")?.sort).toBe(2);
    expect(next.find((v) => v.id === "v2")?.sort).toBe(1);
    expect(previewVolumeReorder(volumes, "v1", "v1")).toBe(volumes);
  });
});
