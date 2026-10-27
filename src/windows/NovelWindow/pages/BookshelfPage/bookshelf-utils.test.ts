import { describe, expect, it } from "vitest";
import {
  buildWorkCards,
  buildWorkOrdinals,
  countIdeaNotes,
  coverPaletteOf,
  filterIdeaNotes,
  filterWorkCards,
  formatDayLabel,
  formatGenreLabel,
  formatNumberedLabel,
  formatRelativeTime,
  formatWordsCompact,
  resolveHero,
  sortIdeaNotes,
  sortWorkCards,
  toChineseOrdinal,
  validateWorkName,
  EMPTY_WORK_NAME_HINT,
} from "./bookshelf-utils";
import type { NovelBundleDTO, NovelChapterDTO } from "@/shared/types/electron";

/** DTO 为 electron.d.ts 导出的 IPC 契约；测试内用工厂构造最小数据 */
const NOW = new Date("2026-09-21T12:00:00").getTime();

function makeBundle(overrides?: Partial<NovelBundleDTO>): NovelBundleDTO {
  return {
    works: [],
    volumes: [],
    chapters: [],
    entities: [],
    links: [],
    settings: [],
    notes: [],
    outlineEntries: [],
    recovery: null,
    ...overrides,
  };
}

function makeChapter(
  id: string,
  workId: string,
  volumeId: string,
  extra?: Partial<NovelChapterDTO>,
): NovelChapterDTO {
  return {
    id,
    workId,
    volumeId,
    title: `章节${id}`,
    content: "",
    wordCount: 100,
    status: "draft",
    sort: 1,
    updatedAt: NOW,
    ...extra,
  };
}

describe("formatWordsCompact / 序号标签", () => {
  it("万以下走千分位，万以上保留一位小数并去掉尾零", () => {
    expect(formatWordsCompact(1284)).toBe("1,284");
    expect(formatWordsCompact(482_000)).toBe("48.2 万");
    expect(formatWordsCompact(646_000)).toBe("64.6 万");
    expect(formatWordsCompact(10_000)).toBe("1 万");
    expect(formatWordsCompact(1_234_567)).toBe("123 万");
  });

  it("中文序数与后缀组合", () => {
    expect(toChineseOrdinal(87)).toBe("八十七");
    expect(toChineseOrdinal(306)).toBe("三百零六");
    expect(toChineseOrdinal(20)).toBe("二十");
    expect(formatNumberedLabel("chinese", "章", 87)).toBe("第八十七章");
    expect(formatNumberedLabel("arabic", "章", 87)).toBe("第87章");
    expect(formatNumberedLabel("chinese", "卷", 2)).toBe("第二卷");
  });

  it("相对时间与天级标签", () => {
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe("5 分钟前");
    expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3 小时前");
    expect(formatDayLabel(NOW - 86_400_000 + 3_600_000, NOW)).toContain("昨天");
    expect(formatDayLabel(NOW - 3 * 86_400_000, NOW)).toBe("3 天前");
    expect(formatDayLabel(NOW - 40 * 86_400_000, NOW)).toContain("月");
  });
});

describe("buildWorkCards", () => {
  it("聚合字数 / 章节数 / 完稿数，全部完稿判为已完结", () => {
    const bundle = makeBundle({
      works: [
        { id: "w1", name: "星陨大陆", createdAt: 100 },
        { id: "w2", name: "长夜灯", createdAt: 200 },
      ],
      volumes: [
        { id: "v1", workId: "w1", name: "未命名卷", sort: 1 },
        { id: "v2", workId: "w2", name: "未命名卷", sort: 1 },
      ],
      chapters: [
        makeChapter("c1", "w1", "v1", { wordCount: 300, status: "done", updatedAt: 500 }),
        makeChapter("c2", "w1", "v1", { wordCount: 200, sort: 2, updatedAt: 700 }),
        makeChapter("c3", "w2", "v2", { wordCount: 50, status: "done", updatedAt: 300 }),
      ],
    });

    const cards = buildWorkCards(bundle);
    expect(cards).toHaveLength(2);

    const w1 = cards.find((card) => card.id === "w1")!;
    expect(w1.totalWords).toBe(500);
    expect(w1.chapterCount).toBe(2);
    expect(w1.doneCount).toBe(1);
    expect(w1.volumeCount).toBe(1);
    expect(w1.updatedAt).toBe(700);
    expect(w1.status).toBe("ongoing");

    const w2 = cards.find((card) => card.id === "w2")!;
    expect(w2.status).toBe("finished");
  });

  it("题材透传到书卡；未设置的作品不产出 genre 字段", () => {
    const cards = buildWorkCards(
      makeBundle({
        works: [
          { id: "w1", name: "山海拔迹", createdAt: 1, genre: "仙侠" },
          { id: "w2", name: "测试协议", createdAt: 2 },
          { id: "w3", name: "空白题材", createdAt: 3, genre: "  " },
        ],
      }),
    );
    expect(cards.find((card) => card.id === "w1")!.genre).toBe("仙侠");
    // 空串 / 纯空格都不算「有题材」，书卡走「未归属」口径
    expect(cards.find((card) => card.id === "w2")!.genre).toBeUndefined();
    expect(cards.find((card) => card.id === "w3")!.genre).toBe("  ");
    expect(formatGenreLabel(cards.find((card) => card.id === "w3")!.genre)).toBe(
      "题材：未归属",
    );
  });

  it("排序：最近更新沉底未动笔作品，创建时间与字数可切换", () => {
    const cards = buildWorkCards(
      makeBundle({
        works: [
          { id: "a", name: "A", createdAt: 1 },
          { id: "b", name: "B", createdAt: 2 },
          { id: "c", name: "C", createdAt: 3 },
        ],
        volumes: [
          { id: "v", workId: "a", name: "", sort: 1 },
          { id: "v2", workId: "b", name: "", sort: 1 },
        ],
        chapters: [
          makeChapter("ca", "a", "v", { updatedAt: 100, wordCount: 10 }),
          makeChapter("cb", "b", "v2", { updatedAt: 300, wordCount: 999 }),
        ],
      }),
    );

    expect(sortWorkCards(cards, "recent").map((card) => card.id)).toEqual(["b", "a", "c"]);
    expect(sortWorkCards(cards, "created").map((card) => card.id)).toEqual(["c", "b", "a"]);
    expect(sortWorkCards(cards, "words")[0].id).toBe("b");
  });

  it("状态筛选与书名关键词", () => {
    const cards = buildWorkCards(
      makeBundle({
        works: [
          { id: "w1", name: "星陨大陆", createdAt: 1 },
          { id: "w2", name: "深海信号", createdAt: 2 },
        ],
        volumes: [{ id: "v", workId: "w2", name: "", sort: 1 }],
        chapters: [makeChapter("c2", "w2", "v", { status: "done" })],
      }),
    );

    expect(filterWorkCards(cards, "ongoing", "").map((card) => card.id)).toEqual(["w1"]);
    expect(filterWorkCards(cards, "finished", "").map((card) => card.id)).toEqual(["w2"]);
    expect(filterWorkCards(cards, "all", "深海").map((card) => card.id)).toEqual(["w2"]);
    expect(filterWorkCards(cards, "all", "不存在的书")).toHaveLength(0);
  });
});

describe("buildWorkOrdinals / resolveHero", () => {
  const style = {
    numberStyle: "chinese" as const,
    chapterSuffix: "章",
    volumeSuffix: "卷",
    dailyGoal: 2000,
  };

  it("章节序号按卷序 → 章序派生", () => {
    const ordinals = buildWorkOrdinals(
      [
        { id: "v1", workId: "w", name: "", sort: 1 },
        { id: "v2", workId: "w", name: "", sort: 2 },
      ],
      [
        makeChapter("c3", "w", "v2", { sort: 1 }),
        makeChapter("c1", "w", "v1", { sort: 2 }),
        makeChapter("c2", "w", "v1", { sort: 1 }),
      ],
    );
    expect(ordinals.get("c2")).toBe(1);
    expect(ordinals.get("c1")).toBe(2);
    expect(ordinals.get("c3")).toBe(3);
  });

  it("位置记忆有效 → 定位到记忆章节；无效 → 回退最近更新", () => {
    const bundle = makeBundle({
      works: [
        { id: "w1", name: "星陨大陆", createdAt: 1 },
        { id: "w2", name: "深海信号", createdAt: 2 },
      ],
      volumes: [
        { id: "v1", workId: "w1", name: "", sort: 1 },
        { id: "v2", workId: "w1", name: "", sort: 2 },
      ],
      chapters: [
        makeChapter("c1", "w1", "v1", { sort: 1, updatedAt: NOW - 1000 }),
        makeChapter("c2", "w1", "v2", {
          sort: 1,
          title: "潮起",
          updatedAt: NOW - 500,
        }),
        makeChapter("c9", "w2", "v-x", { sort: 1, updatedAt: NOW - 100 }),
      ],
    });

    const hero = resolveHero(bundle, { workId: "w1", chapterId: "c2" }, style, NOW);
    expect(hero?.workId).toBe("w1");
    expect(hero?.chapterId).toBe("c2");
    expect(hero?.workName).toBe("星陨大陆");
    expect(hero?.volumeLabel).toBe("第二卷");
    expect(hero?.chapterLabel).toBe("第二章 潮起");

    // 记忆指向已删除章节 → 回退到全库最近更新的 c9
    const fallback = resolveHero(bundle, { workId: "w1", chapterId: "gone" }, style, NOW);
    expect(fallback?.chapterId).toBe("c9");

    // 全库无章节 → 无 Hero
    expect(resolveHero(makeBundle(), null, style, NOW)).toBeNull();
  });
});

describe("灵感库筛选与排序", () => {
  const notes = [
    { id: "n1", workId: "", content: "雨夜追车", createdAt: 30, pinned: false },
    { id: "n2", workId: "w1", content: "主线反转", createdAt: 20, pinned: true },
    { id: "n3", workId: "w2", content: "灯芯不能说破", createdAt: 10, pinned: false },
    { id: "n4", workId: "", content: "新设定：灵潮", createdAt: 5, pinned: true },
  ];

  it("计数：全部 / 未归属 / 置顶 / 已归档", () => {
    expect(countIdeaNotes(notes)).toEqual({
      all: 4,
      unassigned: 2,
      pinned: 2,
      archived: 2,
    });
  });

  it("筛选 + 关键词叠加", () => {
    expect(filterIdeaNotes(notes, "unassigned", "").map((note) => note.id)).toEqual([
      "n1",
      "n4",
    ]);
    expect(filterIdeaNotes(notes, "archived", "").map((note) => note.id)).toEqual([
      "n2",
      "n3",
    ]);
    expect(filterIdeaNotes(notes, "all", "灵潮").map((note) => note.id)).toEqual(["n4"]);
    expect(filterIdeaNotes(notes, "pinned", "").map((note) => note.id)).toEqual([
      "n2",
      "n4",
    ]);
  });

  it("置顶优先，其余按时间倒序", () => {
    expect(sortIdeaNotes(notes).map((note) => note.id)).toEqual(["n2", "n4", "n1", "n3"]);
  });
});

describe("coverPaletteOf", () => {
  it("同一作品 id 稳定命中同一配色，且配色合法", () => {
    const first = coverPaletteOf("w-abc-123");
    expect(coverPaletteOf("w-abc-123")).toBe(first);
    expect(coverPaletteOf("w-xyz-999")).toBeTruthy();
  });
});

// L-03：书名留空点「创建并开写」曾经静默无反应（弹窗不动也不提示）。
// 校验必须是「有明确返回值」的函数，页面才说得清楚差什么。
describe("validateWorkName", () => {
  it("正常书名通过（返回 null，不挡路）", () => {
    expect(validateWorkName("灵潮纪元")).toBeNull();
    expect(validateWorkName("A")).toBeNull();
  });

  it("空串与纯空白都不通过 —— trim 之后才算数", () => {
    expect(validateWorkName("")).toBe(EMPTY_WORK_NAME_HINT);
    expect(validateWorkName("   ")).toBe(EMPTY_WORK_NAME_HINT);
    expect(validateWorkName("\u3000\t\n")).toBe(EMPTY_WORK_NAME_HINT);
  });

  it("提示语是给人看的话，不是字段名", () => {
    expect(EMPTY_WORK_NAME_HINT).not.toMatch(/不能为空|required|invalid/i);
    expect(EMPTY_WORK_NAME_HINT).toContain("名字");
  });

  it("两端空格不影响判定（书名本身由 createWork 负责 trim）", () => {
    expect(validateWorkName("  灵潮  ")).toBeNull();
  });
});
