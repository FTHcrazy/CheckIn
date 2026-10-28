import { describe, expect, it } from "vitest";
import {
  buildChapterScopePayload,
  clipText,
  collectBookContext,
  deriveExcludeNames,
  entityTypeLabel,
  matchEntitiesInText,
  type BookSnapshot,
} from "./collector";

const snapshot: BookSnapshot = {
  workName: "青云志",
  workGenre: "仙侠",
  entities: [
    { type: "character", name: "林晚照", aliases: ["晚照师姐"], summary: "青云宗大师姐，清冷孤傲" },
    { type: "location", name: "青云山", summary: "青云宗所在" },
    { type: "faction", name: "青云宗" },
  ],
  realmLevels: ["炼气", "筑基", "金丹"],
  chapterSnippet: "林晚照立于青云山巅，望向远处的云海。",
};

describe("entityTypeLabel", () => {
  it("内置类型转中文，自建类型原样返回", () => {
    expect(entityTypeLabel("character")).toBe("人物");
    expect(entityTypeLabel("location")).toBe("地点");
    expect(entityTypeLabel("ct-1712")).toBe("ct-1712");
  });
});

describe("clipText", () => {
  it("超长截断并加省略号，空值返回 undefined", () => {
    expect(clipText("一二三四", 2)).toBe("一二…");
    expect(clipText("  ", 2)).toBeUndefined();
    expect(clipText("一二", 0)).toBeUndefined();
  });
});

describe("deriveExcludeNames", () => {
  it("合并 name 与 aliases 并去重", () => {
    const names = deriveExcludeNames([
      { type: "character", name: "林晚照", aliases: ["晚照", "林晚照"] },
      { type: "location", name: "青云山" },
    ]);
    expect(names.sort()).toEqual(["林晚照", "晚照", "青云山"].sort());
  });
});

describe("collectBookContext", () => {
  it("naming：只带 type+name，不采集 summary / 章节片段，带已用名与境界", () => {
    const ctx = collectBookContext(snapshot, "naming");
    expect(ctx.work).toEqual({ name: "青云志", genre: "仙侠" });
    expect(ctx.entities.every((e) => e.summary === undefined)).toBe(true);
    expect(ctx.chapterSnippet).toBeUndefined();
    expect(ctx.realmLevels).toEqual(["炼气", "筑基", "金丹"]);
    expect(ctx.excludeNames).toContain("晚照师姐");
  });

  it("polish：带 summary 与章节片段，不带已用名", () => {
    const ctx = collectBookContext(snapshot, "polish");
    expect(ctx.entities.find((e) => e.name === "林晚照")?.summary).toContain("清冷孤傲");
    expect(ctx.chapterSnippet).toContain("青云山巅");
    expect(ctx.excludeNames).toBeUndefined();
  });

  it("transform：与 polish 同口径（带 summary 与章节片段，不带已用名）", () => {
    const ctx = collectBookContext(snapshot, "transform");
    expect(ctx.entities.find((e) => e.name === "林晚照")?.summary).toContain("清冷孤傲");
    expect(ctx.chapterSnippet).toContain("青云山巅");
    expect(ctx.excludeNames).toBeUndefined();
  });

  it("题材缺失时不伪造，书名缺失给可读兜底", () => {
    const ctx = collectBookContext({ workName: "  ", entities: [] }, "naming");
    expect(ctx.work.name).toBe("未命名作品");
    expect(ctx.work.genre).toBeUndefined();
  });

  it("调用方传入的 excludeNames 优先于派生结果", () => {
    const ctx = collectBookContext({ ...snapshot, excludeNames: ["自定义名"] }, "naming");
    expect(ctx.excludeNames).toEqual(["自定义名"]);
  });
});

describe("matchEntitiesInText", () => {
  it("反向往句子里找名字（含别名），人物优先", () => {
    const hits = matchEntitiesInText("林晚照立在青云山巅。", snapshot.entities);
    expect(hits.map((h) => h.name)).toEqual(["林晚照", "青云山"]);
    expect(hits[0].type).toBe("人物");
  });

  it("别名命中时回填 matchedText", () => {
    const hits = matchEntitiesInText("晚照师姐来了。", snapshot.entities);
    expect(hits[0]).toMatchObject({ name: "林晚照", matchedText: "晚照师姐" });
  });

  it("没命中返回空数组；空文本不报错", () => {
    expect(matchEntitiesInText("与他无关的一句话。", snapshot.entities)).toEqual([]);
    expect(matchEntitiesInText("", snapshot.entities)).toEqual([]);
  });

  it("按 limit 截断，避免一次塞太多卡", () => {
    const hits = matchEntitiesInText("林晚照立于青云山，青云宗弟子随行。", snapshot.entities, {
      limit: 1,
    });
    expect(hits).toHaveLength(1);
  });

  it("单字名不参与匹配（误命中率过高）", () => {
    const hits = matchEntitiesInText("李在城中行走。", [
      { type: "character", name: "李" },
    ]);
    expect(hits).toEqual([]);
  });
});

describe("L3 授权范围 → 实际发送内容（buildChapterScopePayload）", () => {
  // 每章 3000 字：足以让 recent3 的三段预算（60/25/15）都真的触发裁剪
  const chapter = { title: "第三章 落霞", content: "甲".repeat(3000) };
  const prev2 = { title: "第一章 入山", content: "乙".repeat(3000) };
  const prev1 = { title: "第二章 试剑", content: "丙".repeat(3000) };

  it("chapter：只发本章，按预算裁剪，不带前情", () => {
    const payload = buildChapterScopePayload({
      scope: "chapter",
      chapter,
      previousChapters: [prev2, prev1],
      budget: 4000,
    });
    expect(payload.ok).toBe(true);
    if (!payload.ok) return;
    expect(payload.contextText).toBeUndefined();
    expect(payload.chars).toBe(payload.chapterText.length);
    expect(payload.chapterText).toBe(chapter.content);
  });

  it("selection：只发选中段落（不是整章），chars 即选区长度", () => {
    const payload = buildChapterScopePayload({
      scope: "selection",
      chapter,
      selection: "  只有这一段会被发出去。  ",
      budget: 4000,
    });
    expect(payload.ok).toBe(true);
    if (!payload.ok) return;
    expect(payload.chapterText).toBe("只有这一段会被发出去。");
    expect(payload.chars).toBe("只有这一段会被发出去。".length);
  });

  it("selection 但什么都没选中：拒绝发送，绝不退回整章", () => {
    for (const selection of [undefined, "", "   "]) {
      const payload = buildChapterScopePayload({
        scope: "selection",
        chapter,
        selection,
        budget: 4000,
      });
      expect(payload).toEqual({ ok: false, reason: "no-selection" });
    }
  });

  it("recent3：本章 + 前两章，前情按故事时间正序（远的在前）", () => {
    const payload = buildChapterScopePayload({
      scope: "recent3",
      chapter,
      previousChapters: [prev2, prev1],
      budget: 4000,
    });
    expect(payload.ok).toBe(true);
    if (!payload.ok) return;
    expect(payload.chapterText.length).toBeLessThanOrEqual(2400); // 60% 预算为上限
    expect(payload.chapterText.length).toBeGreaterThan(2000);
    expect(payload.contextText).toBeDefined();
    // 前情按「章」切成两块，顺序按故事时间（远的在前）
    const parts = payload.contextText!.split(/\n\n(?=【)/);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("第一章 入山");
    expect(parts[1]).toContain("第二章 试剑");
    // 越近的章留得越多：第二章 25% 预算 > 第一章 15%
    expect(parts[1].length).toBeGreaterThan(parts[0].length);
    expect(payload.chars).toBe(payload.chapterText.length + payload.contextText!.length);
  });

  it("recent3 但本章是第一章：有几章发几章，不报错", () => {
    const payload = buildChapterScopePayload({
      scope: "recent3",
      chapter,
      previousChapters: [],
      budget: 4000,
    });
    expect(payload.ok).toBe(true);
    if (!payload.ok) return;
    expect(payload.contextText).toBeUndefined();
    expect(payload.chapterText.length).toBeLessThanOrEqual(2400);
    expect(payload.chapterText.length).toBeGreaterThan(2000);
  });

  it("预算变小 → 实际发送跟着变少（contextLen 不是摆设）", () => {
    const wide = buildChapterScopePayload({ scope: "chapter", chapter, budget: 4000 });
    const narrow = buildChapterScopePayload({ scope: "chapter", chapter, budget: 600 });
    expect(wide.ok && narrow.ok).toBe(true);
    if (!wide.ok || !narrow.ok) return;
    expect(narrow.chars).toBeLessThan(wide.chars);
    expect(narrow.chapterText).toContain("中间省略");
  });
});
