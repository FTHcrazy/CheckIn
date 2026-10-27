import { describe, expect, it } from "vitest";
import { collectBookContext, type BookSnapshot } from "../collector";
import { NAMING_OUTPUT_FORMAT, TEXT_OUTPUT_FORMAT } from "../output-spec";
import { assembleNamingSpec } from "./naming";
import { assemblePolishSpec } from "./polish";
import { buildPromptSpec, PROMPT_BUILDERS, PROMPT_INTENTS } from "./registry";

const snapshot: BookSnapshot = {
  workName: "青云志",
  workGenre: "仙侠",
  entities: [
    { type: "character", name: "林晚照", aliases: ["晚照师姐"], summary: "青云宗大师姐，清冷孤傲" },
    { type: "location", name: "青云山" },
  ],
  realmLevels: ["炼气", "筑基"],
  chapterSnippet: "林晚照立于青云山巅。",
};

describe("assembleNamingSpec", () => {
  it("把书名 / 题材 / 要素 / 境界 / 已用名 / 输出契约拼进 system", () => {
    const spec = assembleNamingSpec(collectBookContext(snapshot, "naming"), {
      kind: "人名",
      style: "仙侠",
      gender: "女",
      count: 8,
    });

    expect(spec.system).toContain("《青云志》");
    expect(spec.system).toContain("仙侠");
    expect(spec.system).toContain("人物：林晚照");
    expect(spec.system).toContain("炼气 → 筑基");
    expect(spec.system).toContain("不要与以下已用名字重复");
    expect(spec.system).toContain("JSON 数组");
    expect(spec.system).toContain("名字类型：人名");
    expect(spec.count).toBe(8);
    expect(spec.outputFormat).toEqual(NAMING_OUTPUT_FORMAT);
  });

  it("描述为空时给默认 prompt（作者不必每次手填）", () => {
    const spec = assembleNamingSpec(collectBookContext(snapshot, "naming"), { count: 3 });
    expect(spec.prompt).toContain("青云志");
  });

  it("描述非空时原样作为 prompt", () => {
    const spec = assembleNamingSpec(collectBookContext(snapshot, "naming"), {
      description: "一位剑修女侠",
      count: 3,
    });
    expect(spec.prompt).toBe("一位剑修女侠");
  });

  it("题材缺失时追加推断基调的约束，而不是伪造题材", () => {
    const spec = assembleNamingSpec(
      collectBookContext({ workName: "无题", entities: [] }, "naming"),
      { count: 3 },
    );
    expect(spec.system).toContain("题材未设置");
    expect(spec.system).not.toContain("题材：");
  });
});

describe("assemblePolishSpec", () => {
  it("命中人物卡时注入姓名 / 类型 / 简介 + 人设约束", () => {
    const spec = assemblePolishSpec(collectBookContext(snapshot, "polish"), {
      text: "林晚照冷冷地说：退下。",
      characters: [{ name: "林晚照", type: "人物", summary: "清冷孤傲" }],
    });

    expect(spec.system).toContain("本段涉及的人物");
    expect(spec.system).toContain("林晚照（人物）：清冷孤傲");
    expect(spec.system).toContain("性格");
    expect(spec.system).toContain("本段所在章节片段");
    // 历史 buildPolishPrompt 的四条基本约束必须一条不少
    expect(spec.system).toContain("不改变原意");
    expect(spec.system).toContain("保持原有的叙事视角");
    expect(spec.system).toContain("不要过度扩写");
    // 段落分隔必须跟原文（否则整段回填后作者要一行行删空行，2.8.1）
    expect(spec.system).toContain("不得加空行");
    expect(spec.prompt).toBe("林晚照冷冷地说：退下。");
    expect(spec.outputFormat).toEqual(TEXT_OUTPUT_FORMAT);
  });

  it("没有命中人物卡时不出现人物段落", () => {
    const spec = assemblePolishSpec(collectBookContext(snapshot, "polish"), { text: "无关一句。" });
    expect(spec.system).not.toContain("本段涉及的人物");
  });
});

/**
 * 注册表守卫：这里钉的是「模板层的统一性」。
 * 新功能漏登记、漏声明 outputFormat、角色定位不在首句，都会在这里红。
 */
describe("Prompt 模板注册表", () => {
  it("清单与注册表一致，且起名 / 润色都在册", () => {
    expect([...PROMPT_INTENTS].sort()).toEqual(Object.keys(PROMPT_BUILDERS).sort());
    expect(PROMPT_INTENTS).toContain("naming");
    expect(PROMPT_INTENTS).toContain("polish");
  });

  it("每个模板都产出完整 PromptSpec：角色句在首句、system 非空、声明了输出契约", () => {
    const context = collectBookContext(snapshot, "naming");
    const naming = PROMPT_BUILDERS.naming(context, { count: 3 });
    const polish = PROMPT_BUILDERS.polish(context, { text: "一句原文。" });

    for (const spec of [naming, polish]) {
      expect(spec.system.startsWith("你是")).toBe(true);
      expect(spec.system.length).toBeGreaterThan(20);
      expect(spec.prompt.trim().length).toBeGreaterThan(0);
      expect(["text", "json-array"]).toContain(spec.outputFormat.kind);
    }
  });

  it("buildPromptSpec 与直接调模板等价（类型安全的按意图分发）", () => {
    const context = collectBookContext(snapshot, "naming");
    const viaRegistry = buildPromptSpec("naming", context, { kind: "人名", count: 4 });
    const direct = assembleNamingSpec(context, { kind: "人名", count: 4 });
    expect(viaRegistry).toEqual(direct);
  });
});
