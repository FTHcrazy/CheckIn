import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildNovelTemplateBook, type NovelTemplateBook } from "./novel-template";

/**
 * 渲染层 pack-config 里的核心模块清单（按源码文本抽取）。
 *
 * 这里刻意**不** import `@/shared/components/CharacterPack/pack-config`：主进程的
 * tsconfig 不含 DOM lib，把 pack-config（里面到处是 `window` 事件广播）拖进主进程
 * 的 program，`tsc -b` 立刻报一串 `Cannot find name 'window'`。主 / 渲染的边界
 * 只能靠文本守 —— 同 `novel-db-split.test.ts` / `work-numbering-guard.test.ts` 的手法。
 */
const rendererCoreModuleKeys = ((): string[] => {
  const source = readFileSync(
    path.resolve(process.cwd(), "src/shared/components/CharacterPack/pack-config.ts"),
    "utf8",
  );
  // 先去掉注释：说明文字里也引用过这个常量名，留着会先匹配到注释里的那处
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const hit = /CORE_PACK_MODULE_KEYS\s*=\s*\[([^\]]*)\]/.exec(code);
  if (!hit) throw new Error("pack-config.ts 里找不到 CORE_PACK_MODULE_KEYS 清单");
  return [...hit[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
})();

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
          book.settings.flatMap((category) => category.levels.map((level) => level.id)),
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

  it("设定分类至少两条、阶梯按 rank 升序，且恰有一条境界体系", () => {
    expect(book.settings.length).toBeGreaterThanOrEqual(2);
    for (const category of book.settings) {
      const ranks = category.levels.map((level) => level.rank);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
      expect(category.levels.length).toBeGreaterThanOrEqual(6);
    }
    // 「每部作品至多一个境界体系」是角色卡「当前境界」与行囊境界换算的前提
    expect(book.settings.filter((category) => category.kind === "realm")).toHaveLength(1);
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
      ...book.settings.flatMap((category) => [category.id, ...category.levels.map((level) => level.id)]),
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
      book.settings.flatMap((category) => category.levels.map((level) => level.id)),
    );
    expect(rungIds.has(relation!.toId)).toBe(true);
  });

  it("境界阶梯补齐小层数与战力当量（行囊换算依赖这两项）", () => {
    const realm = book.settings.find((category) => category.kind === "realm");
    expect(realm).toBeDefined();
    for (const level of realm!.levels) {
      expect(level.subLevels).toBeGreaterThanOrEqual(1);
      // 战力当量只有境界体系需要：品阶 / 稀有度的「当量」没有可比基准
      expect(typeof level.power).toBe("number");
      expect(level.power!).toBeGreaterThan(0);
    }
    // 至少要有一阶是多层，否则「小层进位」这条能力在模板里没被演示到
    expect(realm!.levels.some((level) => (level.subLevels ?? 1) > 1)).toBe(true);
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
    const attrIds = new Set(pack.attrDefs.map((a) => a.id));
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
      // 有 accepts 限制的部位，穿上去的物品必须落在白名单里（accepts 按组 id 匹配）
      if (slot!.accepts.length > 0) {
        expect(slot!.accepts).toContain(item.groupId);
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

  it("模块布局覆盖全部十个模块且顺序唯一", () => {
    const keys = pack.layouts.map((layout) => layout.moduleKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(10);
    for (const key of [
      "summary",
      "attributes",
      "mapping",
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

    // 新作品只默认启用核心三块（总属性汇总 / 人物属性 / 境界）。
    // 这条断言把主进程的播种清单与渲染层 pack-config 的 CORE_PACK_MODULE_KEYS
    // 钉在一起：两边一旦分叉，新书与「恢复默认」就会给出两套默认态 ——
    // 主进程不 import 渲染层，只能靠测试守。
    expect(
      pack.layouts
        .filter((layout) => layout.enabled)
        .map((layout) => layout.moduleKey),
    ).toEqual(rendererCoreModuleKeys);
  });

  it("属性映射：端点都在真实属性上，且有一条链式换算与一条停用示例", () => {
    const attrIds = new Set(pack.attrDefs.map((a) => a.id));
    expect(pack.mappings.length).toBeGreaterThan(0);
    for (const mapping of pack.mappings) {
      // 端点悬空 → 汇总里会归到 missing，模板不该自带这种例子
      expect(attrIds.has(mapping.sourceAttrId), `映射端点 ${mapping.sourceAttrId} 不存在`).toBe(true);
      expect(attrIds.has(mapping.targetAttrId), `映射端点 ${mapping.targetAttrId} 不存在`).toBe(true);
      expect(mapping.sourceAttrId).not.toBe(mapping.targetAttrId);
    }

    // 停用示例：系数为 0（这是「关掉一条映射」的唯一方式，模板要演示到）
    expect(pack.mappings.some((m) => m.rate === 0)).toBe(true);

    // 链式：存在 A → B 与 B → C（下游读到上游换算之后的值）
    const live = pack.mappings.filter((m) => m.rate !== 0);
    const edges = live.map((m) => [m.sourceAttrId, m.targetAttrId] as const);
    expect(
      live.some((first) =>
        edges.some(
          ([src, dst]) => src === first.targetAttrId && dst !== first.sourceAttrId,
        ),
      ),
    ).toBe(true);

    // 且不能自带环 —— 模板一打开就满屏「循环引用」是很糟的第一印象
    const onCycle = (start: string): boolean => {
      const stack = edges.filter(([src]) => src === start).map(([, dst]) => dst);
      const seen = new Set<string>();
      while (stack.length > 0) {
        const at = stack.pop() as string;
        if (at === start) return true;
        if (seen.has(at)) continue;
        seen.add(at);
        for (const [src, dst] of edges) if (src === at) stack.push(dst);
      }
      return false;
    };
    const nodes = [...new Set(edges.flat())];
    const cyclic = nodes.filter(onCycle);
    expect(cyclic, `模板映射自带了环：${cyclic.join(" / ")}`).toEqual([]);
  });

  it("行囊内 id 无重复（角色 / 属性 / 映射 / 部位 / 分组 / 物品 / 技能 / 效果 / 量纲）", () => {
    const ids = [
      pack.character.id,
      ...pack.attrDefs.map((a) => a.id),
      ...pack.mappings.map((m) => m.id),
      ...pack.slots.map((s) => s.id),
      ...pack.groups.map((g) => g.id),
      ...pack.items.map((i) => i.id),
      ...pack.skills.map((s) => s.id),
      ...pack.modifiers.map((m) => m.id),
      ...pack.unitSystems.map((u) => u.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  // ── 载体分组（1.39.0 二期）──
  it("分组：三个示例组 id / 名称唯一，能力开关各有一档示范", () => {
    expect(pack.groups.length).toBeGreaterThanOrEqual(3);
    expect(new Set(pack.groups.map((g) => g.id)).size).toBe(pack.groups.length);
    expect(new Set(pack.groups.map((g) => g.name)).size).toBe(pack.groups.length);
    // 能力开关要各有示范：可穿戴组（法宝）与无载体开关组（随身）都在
    expect(pack.groups.some((g) => g.canEquip)).toBe(true);
    expect(pack.groups.some((g) => !g.canEnable)).toBe(true);
  });

  it("条目分组引用有效：groupId 为空（未分组）或指向真实存在的组", () => {
    const groupIds = new Set(pack.groups.map((g) => g.id));
    for (const entry of [...pack.items, ...pack.skills]) {
      expect(
        entry.groupId === "" || groupIds.has(entry.groupId),
        `条目 ${entry.name} 的 groupId ${entry.groupId} 悬空`,
      ).toBe(true);
    }
  });

  it("部位 accepts 引用的组全部存在，且至少有一个设限部位做示范", () => {
    const groupIds = new Set(pack.groups.map((g) => g.id));
    expect(pack.slots.some((s) => s.accepts.length > 0)).toBe(true);
    for (const slot of pack.slots) {
      for (const id of slot.accepts) {
        expect(groupIds.has(id), `部位 ${slot.name} 的 accepts ${id} 不指向任何分组`).toBe(true);
      }
    }
  });

  it("功法组绑定熟练度体系（profSchemeId 指向真实量纲），为 Phase 3 留活口", () => {
    const unitIds = new Set(pack.unitSystems.map((u) => u.id));
    const gongfa = pack.groups.find((g) => g.profSchemeId !== "");
    expect(gongfa).toBeDefined();
    expect(unitIds.has(gongfa!.profSchemeId)).toBe(true);
  });

  it("分组绑定的 profSchemeId 全部悬空检测：指向的量纲必须存在且 use=proficiency（Phase 3）", () => {
    // 模板书是内存结构：config / levels 是对象（序列化成 JSON 串发生在落库层）
    const configOf = (raw: unknown): Record<string, unknown> =>
      typeof raw === "string"
        ? (JSON.parse(raw || "{}") as Record<string, unknown>)
        : ((raw ?? {}) as Record<string, unknown>);
    for (const group of pack.groups) {
      if (!group.profSchemeId) continue;
      const system = pack.unitSystems.find((u) => u.id === group.profSchemeId);
      expect(
        system,
        `分组 ${group.name} 绑定的体系 ${group.profSchemeId} 不存在`,
      ).toBeDefined();
      expect(configOf(system!.config).use).toBe("proficiency");
    }
  });

  it("模板熟练度体系可解析（levels 合法 / alias 有回落，Phase 3）", () => {
    const configOf = (raw: unknown): Record<string, unknown> =>
      typeof raw === "string"
        ? (JSON.parse(raw || "{}") as Record<string, unknown>)
        : ((raw ?? {}) as Record<string, unknown>);
    const levelsOf = (raw: unknown): Array<Record<string, unknown>> =>
      typeof raw === "string"
        ? (JSON.parse(raw || "[]") as Array<Record<string, unknown>>)
        : Array.isArray(raw)
          ? (raw as Array<Record<string, unknown>>)
          : [];
    const profSystems = pack.unitSystems.filter(
      (u) => configOf(u.config).use === "proficiency",
    );
    expect(profSystems.length).toBeGreaterThan(0);
    for (const system of profSystems) {
      const config = configOf(system.config);
      expect(String(config.alias ?? "熟练度").length).toBeGreaterThan(0);
      for (const level of levelsOf(system.levels)) {
        expect(String(level.name ?? "").length).toBeGreaterThan(0);
        expect(Number(level.min ?? 0)).toBeGreaterThanOrEqual(0);
        if (level.ratio !== undefined) expect(Number(level.ratio)).toBeGreaterThan(0);
      }
    }
  });
});
