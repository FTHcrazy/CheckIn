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

describe("模板行囊（buildTemplatePack）", () => {
  const pack = book.pack;

  it("主角绑到模板里真实存在的角色要素上", () => {
    const target = book.entities.find((e) => e.id === pack.character.entityId);
    expect(target).toBeDefined();
    // 绑到非角色卡（地点 / 派系）会让「主角」这个说法直接失真
    expect(target?.type).toBe("character");
    expect(pack.character.name).toBe(target?.name);
  });

  it("模板已把该角色的当前境界落在有效等级项上（打开行囊即见联动是活的）", () => {
    const relation = book.links.find(
      (link) => link.fromId === pack.character.entityId && link.toType === "level",
    );
    expect(relation).toBeDefined();
    expect(relation?.relation).toBe("当前境界");
    const rungIds = new Set(
      book.levelSystems.flatMap((system) => system.rungs.map((rung) => rung.id)),
    );
    expect(rungIds.has(relation!.toId)).toBe(true);
  });

  it("等级阶梯补齐 R25 两个缺口：小层数与战力当量都有值", () => {
    for (const system of book.levelSystems) {
      for (const rung of system.rungs) {
        expect(rung.subLevels).toBeGreaterThanOrEqual(1);
        expect(typeof rung.power).toBe("number");
        expect(rung.power!).toBeGreaterThan(0);
      }
    }
    // 至少要有一阶是多层，否则「小层」这条能力在模板里没被演示到
    expect(
      book.levelSystems.some((system) =>
        system.rungs.some((rung) => (rung.subLevels ?? 1) > 1),
      ),
    ).toBe(true);
  });

  it("三档效果性质都有范例，且两条不计入的边界情况都在", () => {
    const natures = new Set(pack.modifiers.map((m) => m.nature));
    expect(natures.has("passive")).toBe(true);
    expect(natures.has("sustained")).toBe(true);
    expect(natures.has("cast")).toBe(true);

    // 持续型必须「开着 / 关着」各一条，否则看不出它有独立开关
    const sustained = pack.modifiers.filter((m) => m.nature === "sustained");
    expect(sustained.some((m) => m.active)).toBe(true);
    expect(sustained.some((m) => !m.active)).toBe(true);

    // 被动 + 触发条件 → 不计入；技能总开关关掉 → 其被动同样不计入
    expect(
      pack.modifiers.some((m) => m.nature === "passive" && m.trigger !== ""),
    ).toBe(true);
    const disabledSkills = new Set(
      pack.skills.filter((s) => !s.enabled).map((s) => s.id),
    );
    expect(disabledSkills.size).toBeGreaterThan(0);
    expect(
      pack.modifiers.some(
        (m) => m.ownerType === "skill" && disabledSkills.has(m.ownerId),
      ),
    ).toBe(true);
  });

  it("每一条效果都指向有效的载体与属性（不会被汇总静默丢掉）", () => {
    const itemIds = new Set(pack.items.map((i) => i.id));
    const skillIds = new Set(pack.skills.map((s) => s.id));
    const attrIds = new Set(pack.attributes.map((a) => a.id));
    for (const modifier of pack.modifiers) {
      if (modifier.ownerType === "item") {
        expect(itemIds.has(modifier.ownerId)).toBe(true);
      } else if (modifier.ownerType === "skill") {
        expect(skillIds.has(modifier.ownerId)).toBe(true);
      } else {
        // 状态效果的载体就是主角自己
        expect(modifier.ownerId).toBe(pack.character.id);
      }
      // cast 型不指向属性（只记参数），其余必须指向一条真实属性
      if (modifier.nature === "cast") {
        expect(modifier.targetAttrId).toBe("");
      } else {
        expect(attrIds.has(modifier.targetAttrId)).toBe(true);
      }
    }
  });

  it("穿戴位置合法：部位存在、槽位下标不越容量（戒指两枚各占一格）", () => {
    const slotById = new Map(pack.slots.map((s) => [s.id, s]));
    const equipped = pack.items.filter((item) => item.equippedSlotId !== "");
    expect(equipped.length).toBeGreaterThan(0);

    const used = new Map<string, Set<number>>();
    for (const item of equipped) {
      const slot = slotById.get(item.equippedSlotId);
      expect(slot).toBeDefined();
      expect(item.slotIndex).not.toBeNull();
      expect(item.slotIndex!).toBeGreaterThanOrEqual(0);
      expect(item.slotIndex!).toBeLessThan(slot!.capacity);
      // 有 accepts 限制的部位，穿上去的物品必须落在白名单里
      if (slot!.accepts.length > 0) {
        expect(slot!.accepts).toContain(item.category);
      }
      const taken = used.get(slot!.id) ?? new Set<number>();
      expect(taken.has(item.slotIndex!)).toBe(false);
      taken.add(item.slotIndex!);
      used.set(slot!.id, taken);
    }

    // 至少有一个部位容量 > 1，否则「一部位多件」这条能力没被演示到
    expect(pack.slots.some((slot) => slot.capacity > 1)).toBe(true);
  });

  it("未穿戴物品的 slotIndex 为空（不能出现「没穿却占着格子」）", () => {
    for (const item of pack.items) {
      if (item.equippedSlotId === "") expect(item.slotIndex).toBeNull();
    }
  });

  it("量纲齐备：货币进制与熟练度阈值各一套", () => {
    const uses = pack.unitSystems.map(
      (system) => (system.config as { use?: string }).use,
    );
    expect(uses).toContain("currency");
    expect(uses).toContain("proficiency");
  });

  it("模块布局覆盖全部九个模块且顺序唯一", () => {
    const keys = pack.layouts.map((layout) => layout.moduleKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(9);
    for (const key of [
      "summary",
      "attributes",
      "equipment",
      "inventory",
      "skills",
      "realm",
      "currency",
      "status",
      "note",
    ]) {
      expect(keys).toContain(key);
    }
  });

  it("行囊内 id 无重复（角色 / 属性 / 部位 / 物品 / 技能 / 效果 / 量纲）", () => {
    const ids = [
      pack.character.id,
      ...pack.attributes.map((a) => a.id),
      ...pack.slots.map((s) => s.id),
      ...pack.items.map((i) => i.id),
      ...pack.skills.map((s) => s.id),
      ...pack.modifiers.map((m) => m.id),
      ...pack.unitSystems.map((u) => u.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
