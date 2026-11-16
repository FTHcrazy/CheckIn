import { describe, expect, it } from "vitest";
import type { NovelTrashItemDTO } from "@/shared/types/electron";
import {
  countTrashKinds,
  daysLeftInfo,
  filterTrashItems,
  formatDeletedAt,
  isAllSelected,
  latestDeleted,
  pickSelected,
  toggleSelectAll,
  toggleSelection,
  TRASH_KIND_LABEL,
  trashKey,
  trashMetaText,
} from "./recycle-bin-utils";

/** 造一条回收站条目：默认是「作品」，其余字段按需覆盖 */
function item(over: Partial<NovelTrashItemDTO> = {}): NovelTrashItemDTO {
  return {
    kind: "work",
    id: "w1",
    name: "山海拾遗",
    // 用本地时间构造：断言里的「10-22 21:14」与运行机器时区无关
    deletedAt: new Date(2026, 9, 22, 21, 14).getTime(),
    workName: "",
    volumeName: "",
    volumes: 3,
    chapters: 15,
    words: 123456,
    daysLeft: 27,
    expired: false,
    ...over,
  };
}

describe("trashKey：选中判据必须带类型", () => {
  it("作品 / 卷 / 章的 id 各自独立自增，撞号时不能互相顶掉", () => {
    expect(trashKey({ kind: "work", id: "3" })).toBe("work:3");
    expect(trashKey({ kind: "chapter", id: "3" })).toBe("chapter:3");
    expect(trashKey({ kind: "work", id: "3" })).not.toBe(
      trashKey({ kind: "chapter", id: "3" }),
    );
  });
});

describe("formatDeletedAt", () => {
  it("只到分钟，补零（列表里不需要秒与年份）", () => {
    const at = formatDeletedAt(new Date(2026, 0, 5, 9, 7).getTime());
    expect(at).toBe("01-05 09:07");
  });

  it("时间戳坏掉时给破折号，不抛也不显示 Invalid Date", () => {
    expect(formatDeletedAt(Number.NaN)).toBe("—");
  });
});

describe("trashMetaText：作品看规模，卷 / 章看归属", () => {
  it("作品：卷 / 章 / 字数 / 删除时间", () => {
    expect(trashMetaText(item())).toBe(
      "3 卷 · 15 章 · 123,456 字 · 删除于 10-22 21:14",
    );
  });

  it("卷：带书名与章数", () => {
    expect(
      trashMetaText(
        item({ kind: "volume", id: "v1", name: "第二卷", workName: "山海拾遗", chapters: 4, words: 8000 }),
      ),
    ).toBe("《山海拾遗》· 4 章 · 8,000 字 · 删除于 10-22 21:14");
  });

  it("章节：带书名 + 卷名（找回时靠它认位置）", () => {
    expect(
      trashMetaText(
        item({ kind: "chapter", id: "c1", name: "夜行", workName: "山海拾遗", volumeName: "第二卷", words: 2100 }),
      ),
    ).toBe("《山海拾遗》· 第二卷 · 2,100 字 · 删除于 10-22 21:14");
  });

  it("章节缺卷名（父卷已被彻底删除）时不留一个空的「· 」", () => {
    expect(
      trashMetaText(item({ kind: "chapter", workName: "山海拾遗", volumeName: "", words: 2100 })),
    ).toBe("《山海拾遗》· 2,100 字 · 删除于 10-22 21:14");
  });
});

describe("countTrashKinds", () => {
  it("all 是总数，三种类型各算各的", () => {
    const counts = countTrashKinds([
      item({ kind: "work", id: "w1" }),
      item({ kind: "work", id: "w2" }),
      item({ kind: "volume", id: "v1" }),
      item({ kind: "chapter", id: "c1" }),
    ]);
    expect(counts).toEqual({ all: 4, work: 2, volume: 1, chapter: 1 });
  });

  it("空列表全为 0（分段标签要显示「全部 0」而不是空白）", () => {
    expect(countTrashKinds([])).toEqual({ all: 0, work: 0, volume: 0, chapter: 0 });
  });
});

describe("filterTrashItems", () => {
  const items = [
    item({ kind: "work", id: "w1", name: "山海拾遗" }),
    item({ kind: "chapter", id: "c1", name: "夜行", workName: "山海拾遗" }),
    item({ kind: "chapter", id: "c2", name: "雾港", workName: "长夜将尽" }),
  ];

  it("类型过滤只留该类型", () => {
    expect(filterTrashItems(items, "chapter", "").map((i) => i.id)).toEqual(["c1", "c2"]);
    expect(filterTrashItems(items, "volume", "")).toHaveLength(0);
  });

  it("关键词同时匹配条目名与所属作品名（章节名往往认不出来，记得的是书名）", () => {
    // 「山海」命中作品自身的名字，也命中两章所属的作品名
    expect(filterTrashItems(items, "all", "山海").map((i) => i.id)).toEqual([
      "w1",
      "c1",
    ]);
    // 「长夜」只出现在另一本书的书名里
    expect(filterTrashItems(items, "all", "长夜").map((i) => i.id)).toEqual(["c2"]);
  });

  it("关键词首尾空格无效、忽略大小写", () => {
    const list = [item({ kind: "work", id: "w1", name: "MoonLight" })];
    expect(filterTrashItems(list, "all", "  moonlight ")).toHaveLength(1);
  });
});

describe("daysLeftInfo：剩余 3 天内要显性提醒", () => {
  it("27 天 → 正常档", () => {
    expect(daysLeftInfo(item({ daysLeft: 27 }))).toEqual({
      text: "剩 27 天",
      urgency: "normal",
    });
  });

  it("3 天 → 警示档（与刚删的不能长得一样）", () => {
    expect(daysLeftInfo(item({ daysLeft: 3 }))).toEqual({
      text: "剩 3 天",
      urgency: "soon",
    });
  });

  it("0 天 → 今天内到期，危险档", () => {
    expect(daysLeftInfo(item({ daysLeft: 0 }))).toEqual({
      text: "今天内到期",
      urgency: "urgent",
    });
  });

  it("已过期 → 「已过期」，哪怕 daysLeft 算出来还 > 0", () => {
    expect(daysLeftInfo(item({ daysLeft: 2, expired: true }))).toEqual({
      text: "已过期",
      urgency: "urgent",
    });
  });
});

describe("latestDeleted", () => {
  it("空回收站返回 null（由页面渲染「暂无」）", () => {
    expect(latestDeleted([])).toBeNull();
  });

  it("取删除时间最大的一条；作品条目用自身名字", () => {
    const latest = latestDeleted([
      item({ kind: "work", id: "w1", name: "山海拾遗", deletedAt: new Date(2026, 9, 20, 9, 0).getTime() }),
      item({ kind: "chapter", id: "c1", name: "夜行", workName: "长夜将尽", deletedAt: new Date(2026, 9, 22, 21, 14).getTime() }),
    ]);
    expect(latest).toEqual({ at: "10-22 21:14", workName: "长夜将尽" });
  });
});

describe("选中集合", () => {
  it("toggleSelection 返回新集合，不改原对象", () => {
    const base = new Set<string>();
    const added = toggleSelection(base, "work:w1", true);
    expect(base.size).toBe(0);
    expect(added.has("work:w1")).toBe(true);
    expect(toggleSelection(added, "work:w1", false).size).toBe(0);
  });

  it("全选只增删可见条目：筛选后点全选不该把看不见的一起选走", () => {
    const visible = [item({ kind: "work", id: "w1" }), item({ kind: "volume", id: "v1" })];
    const selected = toggleSelectAll(new Set(), visible, true);
    expect([...selected].sort()).toEqual(["volume:v1", "work:w1"]);
    expect(toggleSelectAll(selected, visible, false).size).toBe(0);
  });

  it("isAllSelected：空列表不算全选（表头复选框不能误亮）", () => {
    expect(isAllSelected([], new Set())).toBe(false);
    expect(isAllSelected([item()], new Set())).toBe(false);
    expect(isAllSelected([item()], new Set(["work:w1"]))).toBe(true);
  });

  it("pickSelected 按列表顺序取出，已不在列表里的 key 会被忽略", () => {
    const items = [item({ kind: "work", id: "w1" }), item({ kind: "chapter", id: "c1" })];
    const picked = pickSelected(items, new Set(["chapter:c1", "work:w1", "work:gone"]));
    expect(picked.map((i) => i.id)).toEqual(["w1", "c1"]);
  });
});

describe("类型标签", () => {
  it("三类都有中文标签（缺一个就会在列表里露出英文 kind）", () => {
    expect(TRASH_KIND_LABEL).toEqual({ work: "作品", volume: "卷", chapter: "章节" });
  });
});
