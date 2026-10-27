import { describe, expect, it } from "vitest";
import { collectBookContext, type BookSnapshot } from "../collector";
import { NAMING_OUTPUT_FORMAT, TEXT_OUTPUT_FORMAT } from "../output-spec";
import { assembleNamingSpec } from "./naming";
import { assemblePolishSpec } from "./polish";
import {
  assembleTransformSpec,
  TRANSFORM_KIND_LABELS,
  type TransformKind,
} from "./transform";
import {
  assembleContinuationSpec,
  CONTINUATION_OUTPUT_FORMAT,
} from "./continuation";
import { assembleSummarySpec } from "./summary";
import {
  buildPromptSpec,
  PROMPT_BUILDERS,
  PROMPT_INTENTS,
  PROMPT_VERSIONS,
  promptVersionOf,
} from "./registry";

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

describe("assembleTransformSpec", () => {
  const KINDS: TransformKind[] = ["expand", "condense", "rewrite", "tone", "pov"];

  it("五种变换都有各自的角色定位（首句互不相同，绝不复用润色角色）", () => {
    const roles = KINDS.map((kind) => {
      const spec = assembleTransformSpec(collectBookContext(snapshot, "transform"), {
        kind,
        text: "一句原文。",
      });
      return spec.system.split("\n")[0];
    });
    // 五种角色句两两不同
    expect(new Set(roles).size).toBe(KINDS.length);
    // 都不含润色的「无损微调」定位，避免与润色语义吞并
    for (const role of roles) {
      expect(role).toContain("小说写作助手");
    }
  });

  it("每种变换注入作品背景 / 人物卡 / 章节片段 + 段落分隔约束", () => {
    for (const kind of KINDS) {
      const spec = assembleTransformSpec(collectBookContext(snapshot, "transform"), {
        kind,
        text: "林晚照冷冷地说：退下。",
        characters: [{ name: "林晚照", type: "人物", summary: "清冷孤傲" }],
      });
      expect(spec.system).toContain("《青云志》");
      expect(spec.system).toContain("本段涉及的人物");
      expect(spec.system).toContain("本段所在章节片段");
      // 段落分隔必须跟原文（整段回填，多空行只能作者手删）
      expect(spec.system).toContain("不得加空行");
      expect(spec.prompt).toBe("林晚照冷冷地说：退下。");
      expect(spec.outputFormat).toEqual(TEXT_OUTPUT_FORMAT);
    }
  });

  it("扩写与精简给出方向相反的篇幅约束", () => {
    const expand = assembleTransformSpec(collectBookContext(snapshot, "transform"), {
      kind: "expand",
      text: "一句原文。",
    });
    const condense = assembleTransformSpec(collectBookContext(snapshot, "transform"), {
      kind: "condense",
      text: "一句原文。",
    });
    expect(expand.system).toContain("明显长于原文");
    expect(condense.system).toContain("明显短于原文");
  });

  it("换语气与转视角声明「不改变原意」，与润色的无损约束对齐", () => {
    for (const kind of ["tone", "pov"] as const) {
      const spec = assembleTransformSpec(collectBookContext(snapshot, "transform"), {
        kind,
        text: "一句原文。",
      });
      expect(spec.system).toContain("不改变原意");
    }
  });

  it("TRANSFORM_KIND_LABELS 覆盖全部五种，无缺漏", () => {
    expect(Object.keys(TRANSFORM_KIND_LABELS).sort()).toEqual([...KINDS].sort());
  });
});

describe("assembleContinuationSpec", () => {
  it("注入作品背景 / 前文 / 命中人物卡，前文用独立段（非 chapterSnippet）", () => {
    const spec = assembleContinuationSpec(collectBookContext(snapshot, "continuation"), {
      before: "林晚照握紧剑柄，冷风掠过山巅。",
      characters: [{ name: "林晚照", type: "人物", summary: "清冷孤傲" }],
    });
    expect(spec.system).toContain("《青云志》");
    expect(spec.system).toContain("【前文】");
    expect(spec.system).toContain("林晚照握紧剑柄");
    expect(spec.system).toContain("本段涉及的人物");
    expect(spec.system).toContain("林晚照（人物）：清冷孤傲");
    expect(spec.outputFormat).toEqual(CONTINUATION_OUTPUT_FORMAT);
  });

  it("输出契约要求 2–3 个候选，且只续写不重复前文", () => {
    const spec = assembleContinuationSpec(collectBookContext(snapshot, "continuation"), {
      before: "前文。",
    });
    expect(spec.prompt).toContain("2");
    expect(spec.prompt).toContain("3");
    expect(spec.system).toContain("不要重复");
    expect(spec.system).toContain("保持前文的叙事视角");
  });

  it("有 outlineNode 时注入当前剧情节点，缺失时静默省略（降级而非报错）", () => {
    const withNode = assembleContinuationSpec(collectBookContext(snapshot, "continuation"), {
      before: "前文。",
      outlineNode: "林晚照在青云山巅决战",
    });
    expect(withNode.system).toContain("当前剧情节点");
    expect(withNode.system).toContain("决战");

    const withoutNode = assembleContinuationSpec(collectBookContext(snapshot, "continuation"), {
      before: "前文。",
    });
    expect(withoutNode.system).not.toContain("当前剧情节点");
  });

  it("前文为空时给可读兜底，不产出空 prompt", () => {
    const spec = assembleContinuationSpec(collectBookContext(snapshot, "continuation"), {
      before: "",
    });
    expect(spec.system).toContain("（前文为空");
  });
});

describe("assembleSummarySpec", () => {
  it("注入作品背景 / 章节全文，text 输出（非 json-array）", () => {
    const spec = assembleSummarySpec(collectBookContext(snapshot, "summary"), {
      chapter: "林晚照在山巅击败来敌，埋下掌门失踪的伏笔。",
      chapterTitle: "决战青云山巅",
    });
    expect(spec.system).toContain("《青云志》");
    expect(spec.system).toContain("【章节】决战青云山巅");
    expect(spec.system).toContain("【章节正文】");
    expect(spec.system).toContain("林晚照在山巅击败来敌");
    expect(spec.outputFormat).toEqual(TEXT_OUTPUT_FORMAT);
  });

  it("约束覆盖：梗概要素 + 不剧透 + 不编造", () => {
    const spec = assembleSummarySpec(collectBookContext(snapshot, "summary"), {
      chapter: "正文。",
    });
    expect(spec.system).toContain("发生了什么");
    expect(spec.system).toContain("不要剧透");
    expect(spec.system).toContain("不要编造");
  });

  it("有 outlineNode 时注入对齐节点，缺失时静默省略", () => {
    const withNode = assembleSummarySpec(collectBookContext(snapshot, "summary"), {
      chapter: "正文。",
      outlineNode: "决战青云山巅",
    });
    expect(withNode.system).toContain("本章对应大纲节点");
    expect(withNode.system).toContain("决战");

    const withoutNode = assembleSummarySpec(collectBookContext(snapshot, "summary"), {
      chapter: "正文。",
    });
    expect(withoutNode.system).not.toContain("本章对应大纲节点");
  });

  it("正文为空时给可读兜底", () => {
    const spec = assembleSummarySpec(collectBookContext(snapshot, "summary"), {
      chapter: "",
    });
    expect(spec.system).toContain("（本章无正文内容）");
  });
});

/**
 * 注册表守卫：这里钉的是「模板层的统一性」。
 * 新功能漏登记、漏声明 outputFormat、角色定位不在首句，都会在这里红。
 */
describe("Prompt 模板注册表", () => {
  it("清单与注册表一致，且起名 / 润色 / 变换 / 续写 / 摘要都在册", () => {
    expect([...PROMPT_INTENTS].sort()).toEqual(Object.keys(PROMPT_BUILDERS).sort());
    expect(PROMPT_INTENTS).toContain("naming");
    expect(PROMPT_INTENTS).toContain("polish");
    expect(PROMPT_INTENTS).toContain("transform");
    expect(PROMPT_INTENTS).toContain("continuation");
    expect(PROMPT_INTENTS).toContain("summary");
  });

  it("每个模板都产出完整 PromptSpec：角色句在首句、system 非空、声明了输出契约", () => {
    const context = collectBookContext(snapshot, "naming");
    const naming = PROMPT_BUILDERS.naming(context, { count: 3 });
    const polish = PROMPT_BUILDERS.polish(context, { text: "一句原文。" });
    const transform = PROMPT_BUILDERS.transform(context, { kind: "rewrite", text: "一句原文。" });
    const continuation = PROMPT_BUILDERS.continuation(context, { before: "前文。" });
    const summary = PROMPT_BUILDERS.summary(context, { chapter: "正文。" });

    for (const spec of [naming, polish, transform, continuation, summary]) {
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

    const viaTransform = buildPromptSpec("transform", context, { kind: "condense", text: "原文。" });
    const directTransform = assembleTransformSpec(context, { kind: "condense", text: "原文。" });
    expect(viaTransform).toEqual(directTransform);

    const viaContinuation = buildPromptSpec("continuation", context, { before: "前文。" });
    const directContinuation = assembleContinuationSpec(context, { before: "前文。" });
    expect(viaContinuation).toEqual(directContinuation);

    const viaSummary = buildPromptSpec("summary", context, { chapter: "正文。" });
    const directSummary = assembleSummarySpec(context, { chapter: "正文。" });
    expect(viaSummary).toEqual(directSummary);
  });

  it("每个已登记意图都有 prompt 版本（M7：效果归因的对照基准）", () => {
    for (const intent of PROMPT_INTENTS) {
      expect(PROMPT_VERSIONS[intent], `${intent} 缺版本`).toBeTruthy();
    }
  });

  it("promptVersionOf 对已登记意图返回版本，未登记返回空串", () => {
    expect(promptVersionOf("naming")).toBe(PROMPT_VERSIONS.naming);
    expect(promptVersionOf("polish")).toBe(PROMPT_VERSIONS.polish);
    expect(promptVersionOf("不存在的意图")).toBe("");
  });
});
