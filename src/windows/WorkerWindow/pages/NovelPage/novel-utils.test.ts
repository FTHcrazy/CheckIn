import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, UNNAMED_VOLUME } from "./novel-config";
import {
  buildBreadcrumb,
  buildChapterGroups,
  buildChapterNumbers,
  buildEntityTerms,
  buildForeshadowDraft,
  buildOutlineTree,
  buildSearchSnippet,
  buildSortOrder,
  buildWorkMeta,
  calcGoalProgress,
  calcSpeed,
  countWords,
  filterNotes,
  findTermMatches,
  firstLineTitle,
  formatClock,
  formatNumberedLabel,
  formatThousands,
  fuzzyMatch,
  insertItemBefore,
  mergeEditorSettings,
  moveItemBefore,
  padIndex,
  parseJsonOrNull,
  patchChapterOutlineNote,
  patchNote,
  patchOutlineEntry,
  previewChapterReorder,
  previewChapterToVolume,
  previewVolumeReorder,
  sanitizeRestorePosition,
  sortNotes,
  splitByKeyword,
  toChineseOrdinal,
  truncate,
  volumeDisplayName,
} from "./novel-utils";
import type {
  NovelChapter,
  NovelEntity,
  NovelNote,
  NovelVolume,
  OutlineEntry,
  OutlineNode,
} from "./types";

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

/** 文件级章节工厂（持久化校验用例）；内层 describe 的同名工厂按块作用域遮蔽 */
const mkChapter = (over: Partial<NovelChapter>): NovelChapter => ({
  id: "c1",
  workId: "w1",
  volumeId: "v1",
  title: "第一章",
  content: "",
  wordCount: 0,
  status: "draft",
  sort: 1,
  updatedAt: 0,
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

  it("moveItemBefore 向下拖：落在目标之后", () => {
    expect(ids(moveItemBefore(make(["a", "b", "c"]), "a", "c"))).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("moveItemBefore 相邻向下拖：两章交换顺序（回归：原实现插回原位导致不动）", () => {
    expect(ids(moveItemBefore(make(["a", "b", "c"]), "a", "b"))).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(ids(moveItemBefore(make(["a", "b", "c"]), "b", "c"))).toEqual([
      "a",
      "c",
      "b",
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

  it("传入序号配置时，未命名卷的面包屑展示派生的「第N卷」", () => {
    const unnamed: NovelVolume[] = [
      { id: "v1", workId: "w1", name: UNNAMED_VOLUME, sort: 1 },
      { id: "v2", workId: "w1", name: "  ", sort: 2 },
    ];
    const cs: NovelChapter[] = [
      { id: "c1", workId: "w1", volumeId: "v1", title: "开篇", content: "", wordCount: 0, status: "draft", sort: 1, updatedAt: 0 },
      { id: "c2", workId: "w1", volumeId: "v9", title: "散章", content: "", wordCount: 0, status: "draft", sort: 1, updatedAt: 0 },
    ];
    const opts = { numberStyle: "chinese" as const, volumeSuffix: "卷" };
    expect(buildBreadcrumb(unnamed, cs, "c1", opts)).toEqual({
      volumeName: "第一卷",
      chapterName: "开篇",
    });
    // 章节不属于任何已知卷 → 兜底「未分卷」
    expect(buildBreadcrumb(unnamed, cs, "c2", opts).volumeName).toBe("未分卷");
  });

  it("volumeDisplayName：未命名卷派生序号，自定义名展示「第N卷 · 名字」", () => {
    const opts = { numberStyle: "chinese" as const, volumeSuffix: "卷" };
    expect(
      volumeDisplayName({ id: "v1", workId: "w1", name: UNNAMED_VOLUME, sort: 1 }, opts.numberStyle, opts.volumeSuffix),
    ).toBe("第一卷");
    expect(
      volumeDisplayName({ id: "v2", workId: "w1", name: "风起", sort: 3 }, opts.numberStyle, opts.volumeSuffix),
    ).toBe("第三卷 · 风起");
    expect(
      volumeDisplayName({ id: "v3", workId: "w1", name: "Part A", sort: 2 }, "arabic", "部"),
    ).toBe("第2部 · Part A");
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

// ── 大纲与灵感（R7）────────────────────────────────────────────────────

const asVolume = (node: OutlineNode): Extract<OutlineNode, { kind: "volume" }> => {
  if (node.kind !== "volume") throw new Error(`期望卷节点，实际是 ${node.kind}`);
  return node;
};

const asChapter = (
  node: OutlineNode,
): Extract<OutlineNode, { kind: "chapter" }> => {
  if (node.kind !== "chapter") throw new Error(`期望章节节点，实际是 ${node.kind}`);
  return node;
};

const asForeshadow = (
  node: OutlineNode,
): Extract<OutlineNode, { kind: "foreshadow" }> => {
  if (node.kind !== "foreshadow") {
    throw new Error(`期望伏笔节点，实际是 ${node.kind}`);
  }
  return node;
};

const outlineChapters: NovelChapter[] = [
  {
    id: "c1",
    workId: "w1",
    volumeId: "v1",
    title: "雨夜叩门",
    content: "",
    wordCount: 3200,
    status: "done",
    sort: 1,
    updatedAt: 0,
    outlineNote: "沈砚雨夜回到山门。",
  },
  {
    id: "c2",
    workId: "w1",
    volumeId: "v1",
    title: "旧剑",
    content: "",
    wordCount: 2800,
    status: "draft",
    sort: 2,
    updatedAt: 0,
  },
  {
    id: "c3",
    workId: "w1",
    volumeId: "v2",
    title: "渡口",
    content: "",
    wordCount: 0,
    status: "draft",
    sort: 1,
    updatedAt: 0,
  },
];

const outlineVolumes: NovelVolume[] = [
  { id: "v1", workId: "w1", name: "少年游", sort: 1 },
  { id: "v2", workId: "w1", name: UNNAMED_VOLUME, sort: 2 },
];

const entry = (over: Partial<OutlineEntry>): OutlineEntry => ({
  id: "f1",
  workId: "w1",
  kind: "foreshadow",
  volumeId: "v1",
  title: "断伞骨",
  note: "",
  status: "open",
  createdAt: 0,
  ...over,
});

const note = (over: Partial<NovelNote>): NovelNote => ({
  id: "n1",
  workId: "w1",
  content: "下一章开头：雨停。",
  createdAt: 0,
  pinned: false,
  ...over,
});

describe("buildOutlineTree", () => {
  const options = {
    numberStyle: "chinese" as const,
    chapterSuffix: "章",
    volumeSuffix: "卷",
  };

  it("骨架取自真实卷章，章节节点携带真实 chapterId（可直接跳转）", () => {
    const tree = buildOutlineTree(outlineVolumes, outlineChapters, [], options);
    const vol1 = asVolume(tree[0]);

    expect(tree).toHaveLength(2);
    expect(vol1.title).toBe("第一卷");
    expect(vol1.note).toBe("少年游");

    const [first, second] = vol1.children.map(asChapter);
    expect(first.chapterId).toBe("c1");
    expect(first.label).toBe("第一章");
    expect(first.wordCount).toBe(3200);
    expect(first.status).toBe("done");
    expect(second.chapterId).toBe("c2");
  });

  it("章节梗概直接带入，未填写为空串；卷内序号跨卷连续", () => {
    const tree = buildOutlineTree(outlineVolumes, outlineChapters, [], options);
    const [first, second] = asVolume(tree[0]).children.map(asChapter);
    const third = asChapter(asVolume(tree[1]).children[0]);

    expect(first.note).toBe("沈砚雨夜回到山门。");
    expect(second.note).toBe("");
    expect(third.label).toBe("第三章");
  });

  it("默认卷名不追显，自定义卷名作为副标题", () => {
    const tree = buildOutlineTree(outlineVolumes, outlineChapters, [], options);
    expect(asVolume(tree[0]).note).toBe("少年游");
    expect(asVolume(tree[1]).note).toBe("");
  });

  it("伏笔挂所属卷末尾，未回收在前、同级按写入时间排序", () => {
    const entries: OutlineEntry[] = [
      entry({ id: "f-resolved", title: "师父临终语", status: "resolved", createdAt: 100 }),
      entry({ id: "f-late", title: "断伞骨", createdAt: 200 }),
      entry({ id: "f-early", title: "旧诺", createdAt: 50 }),
    ];
    const vol1 = asVolume(
      buildOutlineTree(outlineVolumes, outlineChapters, entries, options)[0],
    );
    const tail = vol1.children.slice(2).map(asForeshadow);

    expect(vol1.openForeshadows).toBe(2);
    expect(tail.map((item) => item.title)).toEqual(["旧诺", "断伞骨", "师父临终语"]);
    expect(tail[2].resolved).toBe(true);
    expect(tail[0].entryId).toBe("f-early");
  });

  it("没有卷时返回空数组，不抛错", () => {
    expect(buildOutlineTree([], [], [entry({})], options)).toEqual([]);
  });
});

describe("灵感排序与过滤", () => {
  it("置顶优先，同级按创建时间倒序，不改入参", () => {
    const raw: NovelNote[] = [
      note({ id: "a", createdAt: 100 }),
      note({ id: "b", createdAt: 300 }),
      note({ id: "c", createdAt: 200, pinned: true }),
    ];
    const sorted = sortNotes(raw);

    expect(sorted.map((item) => item.id)).toEqual(["c", "b", "a"]);
    expect(raw.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("关键词过滤内容，忽略大小写与首尾空白", () => {
    const raw: NovelNote[] = [
      note({ id: "a", content: "断伞骨回收要修伞" }),
      note({ id: "b", content: "下一步：雨停" }),
    ];
    expect(filterNotes(raw, "  伞骨 ").map((item) => item.id)).toEqual(["a"]);
    expect(filterNotes(raw, "不存在").map((item) => item.id)).toEqual([]);
  });

  it("空关键词原样返回同一引用", () => {
    const raw: NovelNote[] = [note({})];
    expect(filterNotes(raw, "  ")).toBe(raw);
  });

  it("firstLineTitle 取首个非空行并字符级截断", () => {
    expect(firstLineTitle("\n\n  雨停，山门钟声  \n第二行")).toBe("雨停，山门钟声");
    expect(firstLineTitle("一二三四五六", 3)).toBe("一二三…");
    expect(firstLineTitle("   ")).toBe("");
  });

  it("buildForeshadowDraft 由灵感生成伏笔草稿，正文不丢", () => {
    const draft = buildForeshadowDraft(
      note({ id: "n9", content: "掌门的旧诺是什么？\n必须第九章前给出答案" }),
      "v1",
      "c7",
    );
    expect(draft).toEqual({
      workId: "w1",
      kind: "foreshadow",
      volumeId: "v1",
      chapterId: "c7",
      title: "掌门的旧诺是什么？",
      note: "掌门的旧诺是什么？\n必须第九章前给出答案",
      status: "open",
    });
  });

  it("buildForeshadowDraft 不传章节时记为卷级伏笔", () => {
    expect(buildForeshadowDraft(note({}), "v2").chapterId).toBeUndefined();
    expect(buildForeshadowDraft(note({}), "v2", "").chapterId).toBeUndefined();
  });
});

describe("梗概 / 伏笔 / 灵感的局部更新", () => {
  it("patchChapterOutlineNote 写入并去首尾空白", () => {
    const next = patchChapterOutlineNote(outlineChapters, "c2", "  旧剑出鞘  ");
    expect(next.find((item) => item.id === "c2")?.outlineNote).toBe("旧剑出鞘");
    expect(outlineChapters.find((item) => item.id === "c2")?.outlineNote).toBeUndefined();
  });

  it("patchChapterOutlineNote 空串清除梗概", () => {
    const next = patchChapterOutlineNote(outlineChapters, "c1", "   ");
    expect(next.find((item) => item.id === "c1")?.outlineNote).toBe("");
  });

  it("patchChapterOutlineNote 值未变或章节不存在时返回原引用", () => {
    expect(patchChapterOutlineNote(outlineChapters, "c1", "沈砚雨夜回到山门。")).toBe(
      outlineChapters,
    );
    expect(patchChapterOutlineNote(outlineChapters, "nope", "x")).toBe(
      outlineChapters,
    );
  });

  it("patchOutlineEntry 标题去空白，说明可独立更新", () => {
    const entries: OutlineEntry[] = [entry({ id: "f1", title: "断伞骨", note: "旧" })];
    const next = patchOutlineEntry(entries, "f1", { title: " 断伞骨 ", note: " 已回收 " });
    expect(next[0]).toEqual({ ...entries[0], title: "断伞骨", note: "已回收" });
    expect(next).not.toBe(entries);
  });

  it("patchOutlineEntry 空标题或条目不存在时返回原引用", () => {
    const entries: OutlineEntry[] = [entry({ id: "f1" })];
    expect(patchOutlineEntry(entries, "f1", { title: "   " })).toBe(entries);
    expect(patchOutlineEntry(entries, "nope", { title: "x" })).toBe(entries);
  });

  it("patchNote 支持内容 / 置顶 / 已转伏笔标记", () => {
    const notes: NovelNote[] = [note({ id: "n1", pinned: false })];
    const next = patchNote(notes, "n1", { content: " 雨停 ", pinned: true, foreshadowId: "f9" });
    expect(next[0]).toEqual({
      ...notes[0],
      content: "雨停",
      pinned: true,
      foreshadowId: "f9",
    });
    expect(notes[0].content).toBe("下一章开头：雨停。");
  });

  it("patchNote 空内容或灵感不存在时返回原引用", () => {
    const notes: NovelNote[] = [note({ id: "n1" })];
    expect(patchNote(notes, "n1", { content: "  " })).toBe(notes);
    expect(patchNote(notes, "nope", { pinned: true })).toBe(notes);
  });
});

describe("parseJsonOrNull", () => {
  it("合法 JSON 解析为未知类型", () => {
    expect(parseJsonOrNull('{"a":1}')).toEqual({ a: 1 });
  });

  it("空串 / null / 非法 JSON 一律返回 null", () => {
    expect(parseJsonOrNull(null)).toBeNull();
    expect(parseJsonOrNull("")).toBeNull();
    expect(parseJsonOrNull("{oops")).toBeNull();
  });
});

describe("mergeEditorSettings", () => {
  it("垃圾输入整体回退默认值", () => {
    expect(mergeEditorSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeEditorSettings("junk")).toEqual(DEFAULT_SETTINGS);
    expect(mergeEditorSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
  });

  it("合法字段覆盖默认值", () => {
    const merged = mergeEditorSettings({
      fontSize: 20,
      lineHeight: 2.2,
      indent: false,
      dailyGoal: 6000,
      wordCountMode: "hanOnly",
      numberStyle: "arabic",
      chapterSuffix: "回",
      annotationTypes: ["character", "item"],
      confirmReorder: false,
    });
    expect(merged.fontSize).toBe(20);
    expect(merged.lineHeight).toBe(2.2);
    expect(merged.indent).toBe(false);
    expect(merged.dailyGoal).toBe(6000);
    expect(merged.wordCountMode).toBe("hanOnly");
    expect(merged.numberStyle).toBe("arabic");
    expect(merged.chapterSuffix).toBe("回");
    expect(merged.annotationTypes).toEqual(["character", "item"]);
    expect(merged.confirmReorder).toBe(false);
    // 未提供的字段保持默认
    expect(merged.paragraphSpacing).toBe(DEFAULT_SETTINGS.paragraphSpacing);
    expect(merged.volumeSuffix).toBe(DEFAULT_SETTINGS.volumeSuffix);
  });

  it("数值越界夹取到合法区间，非法类型回退默认", () => {
    const merged = mergeEditorSettings({
      fontSize: 999,
      lineHeight: 0.1,
      dailyGoal: "很多",
      indent: "yes",
    });
    expect(merged.fontSize).toBe(24);
    expect(merged.lineHeight).toBe(1.4);
    expect(merged.dailyGoal).toBe(DEFAULT_SETTINGS.dailyGoal);
    expect(merged.indent).toBe(DEFAULT_SETTINGS.indent);
  });

  it("annotationTypes 过滤非法类型并去重，空数组保留（= 关闭标注）", () => {
    expect(
      mergeEditorSettings({ annotationTypes: ["character", "dragon", "character"] })
        .annotationTypes,
    ).toEqual(["character"]);
    expect(mergeEditorSettings({ annotationTypes: [] }).annotationTypes).toEqual([]);
    expect(mergeEditorSettings({ annotationTypes: "all" }).annotationTypes).toEqual(
      DEFAULT_SETTINGS.annotationTypes,
    );
  });

  it("章节 / 卷后缀允许空串（标签退化为纯序号）", () => {
    const merged = mergeEditorSettings({ chapterSuffix: "", volumeSuffix: "" });
    expect(merged.chapterSuffix).toBe("");
    expect(merged.volumeSuffix).toBe("");
  });
});

describe("sanitizeRestorePosition", () => {
  const works = [{ id: "w1" }, { id: "w2" }];
  const chapters = [mkChapter({ id: "c1", workId: "w1" }), mkChapter({ id: "c2", workId: "w2" })];

  it("合法四元组原样通过，负数归零", () => {
    expect(
      sanitizeRestorePosition(
        { workId: "w2", chapterId: "c2", cursor: 120, scrollTop: 300 },
        works,
        chapters,
      ),
    ).toEqual({ workId: "w2", chapterId: "c2", cursor: 120, scrollTop: 300 });
    expect(
      sanitizeRestorePosition(
        { workId: "w1", chapterId: "c1", cursor: -5, scrollTop: -1 },
        works,
        chapters,
      ),
    ).toEqual({ workId: "w1", chapterId: "c1", cursor: 0, scrollTop: 0 });
  });

  it("作品或章节不存在、归属不一致时返回 null", () => {
    expect(sanitizeRestorePosition({ workId: "wX", chapterId: "c1" }, works, chapters)).toBeNull();
    expect(sanitizeRestorePosition({ workId: "w1", chapterId: "cX" }, works, chapters)).toBeNull();
    // 章节存在但不属于该作品
    expect(sanitizeRestorePosition({ workId: "w1", chapterId: "c2" }, works, chapters)).toBeNull();
  });

  it("垃圾输入返回 null", () => {
    expect(sanitizeRestorePosition(null, works, chapters)).toBeNull();
    expect(sanitizeRestorePosition("junk", works, chapters)).toBeNull();
    expect(sanitizeRestorePosition({}, works, chapters)).toBeNull();
  });
});

describe("buildWorkMeta", () => {
  it("按作品聚合卷数 / 章节数 / 总字数", () => {
    const meta = buildWorkMeta(
      [
        { id: "v1", workId: "w1", name: UNNAMED_VOLUME, sort: 1 },
        { id: "v2", workId: "w2", name: UNNAMED_VOLUME, sort: 1 },
      ],
      [
        mkChapter({ id: "c1", workId: "w1", wordCount: 1000 }),
        mkChapter({ id: "c2", workId: "w1", wordCount: 2500 }),
        mkChapter({ id: "c3", workId: "w2", wordCount: 8 }),
      ],
    );
    expect(meta.get("w1")).toEqual({ volumes: 1, chapters: 2, words: 3500 });
    expect(meta.get("w2")).toEqual({ volumes: 1, chapters: 1, words: 8 });
    expect(meta.get("w3")).toBeUndefined();
  });

  it("无章节的作品卷数也计入", () => {
    const meta = buildWorkMeta(
      [{ id: "v1", workId: "w1", name: UNNAMED_VOLUME, sort: 1 }],
      [],
    );
    expect(meta.get("w1")).toEqual({ volumes: 1, chapters: 0, words: 0 });
  });
});
