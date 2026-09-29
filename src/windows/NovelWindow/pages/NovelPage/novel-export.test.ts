import { describe, expect, it } from "vitest";
import type { NovelChapter, NovelEntity, NovelVolume } from "./types";
import {
  buildBookPlainText,
  buildChapterPlainText,
  buildEntityCardText,
  buildVolumePlainText,
  sanitizeCustomTypes,
  type ExportNumberingOptions,
} from "./novel-utils";
import { UNNAMED_VOLUME } from "./novel-config";

const options: ExportNumberingOptions = {
  numberStyle: "chinese",
  chapterSuffix: "章",
  volumeSuffix: "卷",
};

const makeChapter = (overrides: Partial<NovelChapter>): NovelChapter => ({
  id: overrides.id ?? "c1",
  workId: "w1",
  volumeId: "v1",
  title: "",
  content: "",
  wordCount: 0,
  status: "draft",
  sort: 1,
  updatedAt: 0,
  ...overrides,
});

const makeVolume = (overrides: Partial<NovelVolume>): NovelVolume => ({
  id: "v1",
  workId: "w1",
  name: UNNAMED_VOLUME,
  sort: 1,
  ...overrides,
});

describe("buildChapterPlainText 章节标题序号（用户要求：导出带自定义序号）", () => {
  it("中文数字 + 默认后缀：「第一章 灵潮起」", () => {
    const chapter = makeChapter({ title: "灵潮起", content: "潮起东海。" });
    expect(buildChapterPlainText(chapter, 1, options)).toBe(
      "第一章 灵潮起\n\n潮起东海。",
    );
  });

  it("阿拉伯数字 + 自定义后缀「回」：「第12回 探岛」", () => {
    const chapter = makeChapter({ title: "探岛" });
    const text = buildChapterPlainText(chapter, 12, {
      numberStyle: "arabic",
      chapterSuffix: "回",
      volumeSuffix: "部",
    });
    expect(text.startsWith("第12回 探岛")).toBe(true);
  });

  it("章节名为空时退化为纯序号「第三章」", () => {
    const chapter = makeChapter({ title: "" });
    expect(buildChapterPlainText(chapter, 3, options).startsWith("第三章")).toBe(
      true,
    );
  });

  it("序号随全书位置走，不取章节 sort", () => {
    const chapter = makeChapter({ title: "X" });
    expect(buildChapterPlainText(chapter, 105, options).startsWith("第一百零五章")).toBe(
      true,
    );
  });
});

describe("buildVolumePlainText / buildBookPlainText", () => {
  const volumes = [
    makeVolume({ id: "v1", sort: 1 }),
    makeVolume({ id: "v2", name: "潮汐之乱", sort: 2 }),
  ];
  const chapters = [
    makeChapter({ id: "c1", volumeId: "v1", sort: 1, title: "灵潮起" }),
    makeChapter({ id: "c2", volumeId: "v1", sort: 2, title: "出海" }),
    makeChapter({ id: "c3", volumeId: "v2", sort: 1, title: "乱起" }),
  ];
  const numbers = new Map([
    ["c1", 1],
    ["c2", 2],
    ["c3", 3],
  ]);

  it("未命名卷头为「第一卷」，有自定义名时为「第二卷 · 潮汐之乱」", () => {
    const v1 = buildVolumePlainText(volumes[0], chapters, numbers, options);
    const v2 = buildVolumePlainText(volumes[1], chapters, numbers, options);
    expect(v1.startsWith("第一卷\n\n")).toBe(true);
    expect(v2.startsWith("第二卷 · 潮汐之乱\n\n")).toBe(true);
  });

  it("单卷导出时章序号保持全书连续（第二章 / 第三章）", () => {
    const v2 = buildVolumePlainText(volumes[1], chapters, numbers, options);
    expect(v2).toContain("第三章 乱起");
    expect(v2).not.toContain("第一章");
  });

  it("整本：书名行 + 卷头 + 全部章节标题按序出现", () => {
    const text = buildBookPlainText("山海拾遗", volumes, chapters, options);
    const lines = text.split("\n");
    expect(lines[0]).toBe("《山海拾遗》");
    expect(text.indexOf("第一章 灵潮起")).toBeLessThan(text.indexOf("第二章 出海"));
    expect(text.indexOf("第二章 出海")).toBeLessThan(text.indexOf("第三章 乱起"));
    expect(text).toContain("第二卷 · 潮汐之乱");
  });

  it("书名为空时兜底「未命名作品」", () => {
    const text = buildBookPlainText("  ", volumes, chapters, options);
    expect(text.startsWith("《未命名作品》")).toBe(true);
  });
});

describe("buildEntityCardText 设定卡导出", () => {
  const entity: NovelEntity = {
    id: "e1",
    workId: "w1",
    type: "character",
    name: "沈孤舟",
    aliases: ["舟哥"],
    summary: "东海外海巡海人。",
    content: "",
    fields: { 性格: "沉稳·重诺", 境界: "凝丹" },
    sort: 1,
  };

  it("包含名称 / 别名 / 一句话 / 自定义字段", () => {
    const text = buildEntityCardText(entity, []);
    expect(text).toContain("【沈孤舟】");
    expect(text).toContain("别名：舟哥");
    expect(text).toContain("一句话：东海外海巡海人。");
    expect(text).toContain("境界：凝丹");
  });

  it("关联要素区分方向，当前境界单列一行", () => {
    const text = buildEntityCardText(
      entity,
      [
        {
          id: "l1",
          direction: "out",
          targetId: "e2",
          targetName: "陆惊澜",
          targetType: "character",
          relation: "亦敌亦友",
        },
        {
          id: "l2",
          direction: "in",
          targetId: "e3",
          targetName: "照影灯",
          targetType: "item",
          relation: "持有",
        },
        {
          id: "l3",
          direction: "out",
          targetId: "tpl-lr-4",
          targetName: "凝丹（灵徒九境）",
          targetType: "level",
          relation: "当前境界",
        },
      ],
      "凝丹（灵徒九境）",
    );
    expect(text).toContain("→ 陆惊澜（亦敌亦友）");
    expect(text).toContain("← 照影灯（持有）");
    expect(text).toContain("当前境界：凝丹（灵徒九境）");
    // 当前境界绑定不重复出现在关联列表里
    expect(text.indexOf("当前境界")).toBe(text.lastIndexOf("当前境界"));
  });
});

describe("sanitizeCustomTypes 自建类型清洗", () => {
  it("丢弃非法项并按 id 去重", () => {
    const result = sanitizeCustomTypes([
      { id: "ct-1", name: "功法", color: "#e0559a" },
      { id: "ct-1", name: "重复", color: "#14b8a6" },
      { id: "bad", name: "前缀不对", color: "#14b8a6" },
      { id: "ct-2", name: "  ", color: "#14b8a6" },
      { id: "ct-3", name: "没颜色", color: "" },
      "not-an-object",
      null,
      { id: "ct-4", name: "器物", color: "#3b82f6" },
    ]);
    expect(result).toEqual([
      { id: "ct-1", name: "功法", color: "#e0559a" },
      { id: "ct-4", name: "器物", color: "#3b82f6" },
    ]);
  });

  it("非数组输入返回空数组", () => {
    expect(sanitizeCustomTypes(null)).toEqual([]);
    expect(sanitizeCustomTypes("ct-1")).toEqual([]);
    expect(sanitizeCustomTypes({ id: "ct-1" })).toEqual([]);
  });
});
