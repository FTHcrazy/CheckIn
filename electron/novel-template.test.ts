import { describe, expect, it } from "vitest";
import { buildNovelTemplateBook, type NovelTemplateBook } from "./novel-template";

const MIN_WORDS_PER_CHAPTER = 3200;

const book: NovelTemplateBook = buildNovelTemplateBook(MIN_WORDS_PER_CHAPTER);

/** 非空白字符数（与生成器 countWords 同口径） */
const countWords = (content: string): number => content.replace(/\s/g, "").length;

describe("buildNovelTemplateBook 结构完整性", () => {
  it("生成单作品多卷多章：1 作品 / 3 卷 / 15 章", () => {
    expect(book.workId).toBe("tpl-w");
    expect(book.workName).toContain("模板示例");
    expect(book.volumes).toHaveLength(3);
    expect(book.chapters).toHaveLength(15);
  });

  it("每章字数达标且 word_count 与内容一致（非空白口径）", () => {
    for (const chapter of book.chapters) {
      expect(countWords(chapter.content)).toBeGreaterThanOrEqual(MIN_WORDS_PER_CHAPTER);
      expect(chapter.wordCount).toBe(countWords(chapter.content));
    }
    const totalWords = book.chapters.reduce((sum, c) => sum + c.wordCount, 0);
    expect(totalWords).toBeGreaterThanOrEqual(15 * MIN_WORDS_PER_CHAPTER);
  });

  it("章节归属合法：volumeId 有效、卷内 sort 连续、全书 sort 唯一", () => {
    const volumeIds = new Set(book.volumes.map((v) => v.id));
    const globalSorts = new Set<number>();
    for (const volume of book.volumes) {
      const inVolume = book.chapters.filter((c) => c.volumeId === volume.id);
      expect(inVolume.length).toBeGreaterThan(0);
      expect(inVolume.map((c) => c.sort)).toEqual(
        inVolume.map((c) => c.sort).slice().sort((a, b) => a - b),
      );
    }
    for (const chapter of book.chapters) {
      expect(volumeIds.has(chapter.volumeId)).toBe(true);
      expect(globalSorts.has(chapter.sort)).toBe(false);
      globalSorts.add(chapter.sort);
    }
  });

  it("章节状态与梗概覆盖：草稿 / 完稿混合，每章都有 outlineNote", () => {
    const statuses = new Set(book.chapters.map((c) => c.status));
    expect(statuses).toEqual(new Set(["draft", "done"]));
    for (const chapter of book.chapters) {
      expect(chapter.outlineNote).toBeTruthy();
    }
  });
});

describe("buildNovelTemplateBook 功能覆盖", () => {
  it("六类要素全部覆盖，别名与自定义字段非空", () => {
    const types = new Set(book.entities.map((e) => e.type));
    expect(types).toEqual(
      new Set(["character", "location", "faction", "item", "level_system", "custom"]),
    );
    const withAliases = book.entities.filter((e) => e.aliases.length > 0);
    expect(withAliases.length).toBeGreaterThan(0);
    const withFields = book.entities.filter(
      (e) => Object.keys(e.fields).length > 0,
    );
    expect(withFields.length).toBe(book.entities.length);
  });

  it("正文织入要素名与别名：每章至少出现两类要素名，全书出现别名", () => {
    const names = book.entities.map((e) => e.name);
    for (const chapter of book.chapters) {
      const hits = names.filter((name) => chapter.content.includes(name));
      expect(hits.length).toBeGreaterThanOrEqual(2);
    }
    const aliases = book.entities.flatMap((e) => e.aliases);
    const joined = book.chapters.map((c) => c.content).join("");
    expect(aliases.some((alias) => joined.includes(alias))).toBe(true);
  });

  it("要素关联合法：引用的要素与类型都存在", () => {
    const byId = new Map(book.entities.map((e) => [e.id, e]));
    expect(book.links.length).toBeGreaterThanOrEqual(5);
    for (const link of book.links) {
      const from = byId.get(link.fromId);
      expect(from).toBeDefined();
      expect(from?.type).toBe(link.fromType);
      // 当前境界绑定（R25）指向等级项而非要素卡，单独校验
      if (link.toType === "level") {
        expect(link.relation).toBe("当前境界");
        const rungIds = new Set(
          book.levelSystems.flatMap((s) => s.rungs.map((r) => r.id)),
        );
        expect(rungIds.has(link.toId)).toBe(true);
        continue;
      }
      const to = byId.get(link.toId);
      expect(to).toBeDefined();
      expect(to?.type).toBe(link.toType);
    }
    expect(
      book.links.some((l) => l.toType === "level" && l.toId === "tpl-lr-4"),
    ).toBe(true);
  });

  it("等级体系两条且阶梯按 rank 升序", () => {
    expect(book.levelSystems).toHaveLength(2);
    for (const system of book.levelSystems) {
      const ranks = system.rungs.map((r) => r.rank);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      expect(system.rungs.length).toBeGreaterThanOrEqual(7);
    }
  });

  it("灵感速记覆盖置顶与已转伏笔标记", () => {
    expect(book.notes.some((n) => n.pinned)).toBe(true);
    expect(book.notes.some((n) => n.foreshadowId !== null)).toBe(true);
    for (const note of book.notes) {
      if (note.foreshadowId) {
        expect(book.outlineEntries.some((e) => e.id === note.foreshadowId)).toBe(true);
      }
    }
  });

  it("伏笔条目覆盖待回收 / 已回收、卷级 / 章级挂载，且引用有效", () => {
    const volumeIds = new Set(book.volumes.map((v) => v.id));
    const chapterIds = new Set(book.chapters.map((c) => c.id));
    expect(book.outlineEntries.some((e) => e.status === "open")).toBe(true);
    expect(book.outlineEntries.some((e) => e.status === "resolved")).toBe(true);
    expect(book.outlineEntries.some((e) => e.chapterId === null)).toBe(true);
    expect(book.outlineEntries.some((e) => e.chapterId !== null)).toBe(true);
    for (const entry of book.outlineEntries) {
      expect(volumeIds.has(entry.volumeId)).toBe(true);
      if (entry.chapterId) expect(chapterIds.has(entry.chapterId)).toBe(true);
    }
  });
});

describe("buildNovelTemplateBook 确定性与幂等", () => {
  it("两次构建结果逐字段一致（无 Math.random / Date.now 依赖）", () => {
    const again = buildNovelTemplateBook(MIN_WORDS_PER_CHAPTER);
    expect(JSON.stringify(again)).toBe(JSON.stringify(book));
  });

  it("全部行 id 无重复（卷 / 章 / 要素 / 关联 / 灵感 / 伏笔 / 等级）", () => {
    const ids = [
      ...book.volumes.map((v) => v.id),
      ...book.chapters.map((c) => c.id),
      ...book.entities.map((e) => e.id),
      ...book.links.map((l) => l.id),
      ...book.notes.map((n) => n.id),
      ...book.outlineEntries.map((e) => e.id),
      ...book.levelSystems.flatMap((s) => [s.id, ...s.rungs.map((r) => r.id)]),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
