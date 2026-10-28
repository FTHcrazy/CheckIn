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
  assembleContinuationStreamSpec,
  CONTINUATION_STREAM_OUTPUT_FORMAT,
  CONTINUATION_SUMMARY_MIN_BEFORE_CHARS,
} from "./continuation";
import {
  assembleSummarySpec,
  parseSummaryReply,
  SUMMARY_BODY_HEAD,
  SUMMARY_ONE_LINER_HEAD,
} from "./summary";
import {
  AI_INTENT_LABELS,
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

describe("assembleContinuationStreamSpec", () => {
  it("注入作品背景 / 前文 / 命中人物卡，前文用独立段（非 chapterSnippet）", () => {
    const spec = assembleContinuationStreamSpec(collectBookContext(snapshot, "continuation"), {
      before: "林晚照握紧剑柄，冷风掠过山巅。",
      characters: [{ name: "林晚照", type: "人物", summary: "清冷孤傲" }],
    });
    expect(spec.system).toContain("《青云志》");
    expect(spec.system).toContain("【前文】");
    expect(spec.system).toContain("林晚照握紧剑柄");
    expect(spec.system).toContain("本段涉及的人物");
    expect(spec.system).toContain("林晚照（人物）：清冷孤傲");
    expect(spec.outputFormat).toEqual(CONTINUATION_STREAM_OUTPUT_FORMAT);
  });

  it("流式输出契约为正文（text），直接顺着前文往下写、不重复前文", () => {
    const spec = assembleContinuationStreamSpec(collectBookContext(snapshot, "continuation"), {
      before: "前文。",
    });
    expect(spec.outputFormat.kind).toBe("text");
    expect(spec.prompt).toContain("接着往下写正文");
    expect(spec.system).toContain("直接顺着前文往下写正文");
    expect(spec.system).toContain("不要重复");
    expect(spec.system).toContain("保持前文的叙事视角");
  });

  it("分段口径与正文一致：多段、单换行、不空行、不手动缩进（R-AI-11）", () => {
    // 事故：模板只写「单段 300–600 字」→ 续写恒为一大整段，
    // 插进按「一段一行」排版的正文里，缩进与段距全错。
    const spec = assembleContinuationStreamSpec(collectBookContext(snapshot, "continuation"), {
      before: "前文。",
    });
    expect(spec.system).toContain("2–4 个自然段");
    expect(spec.system).toContain("一个换行");
    expect(spec.system).toContain("不要空行");
    expect(spec.system).toContain("不要手动缩进");
    // 反向断言：旧的「单段」口径不许回来
    expect(spec.system).not.toContain("单段控制在");
  });

  it("有 outlineNode 时注入当前剧情节点，缺失时静默省略（降级而非报错）", () => {
    const withNode = assembleContinuationStreamSpec(collectBookContext(snapshot, "continuation"), {
      before: "前文。",
      outlineNode: "林晚照在青云山巅决战",
    });
    expect(withNode.system).toContain("当前剧情节点");
    expect(withNode.system).toContain("决战");

    const withoutNode = assembleContinuationStreamSpec(collectBookContext(snapshot, "continuation"), {
      before: "前文。",
    });
    expect(withoutNode.system).not.toContain("当前剧情节点");
  });

  it("前文为空时给可读兜底，不产出空 prompt", () => {
    const spec = assembleContinuationStreamSpec(collectBookContext(snapshot, "continuation"), {
      before: "",
    });
    expect(spec.system).toContain("（前文为空");
  });

  // ── 上一章摘要（R-AI-09 的第二消费方）────────────────────────────
  it("前文短（断更回来 / 新章开头）时注入上一章摘要，并给出「已发生、不得矛盾」约束", () => {
    const spec = assembleContinuationStreamSpec(collectBookContext(snapshot, "continuation"), {
      before: "林晚照推开牢门。",
      previousSummary: "上一章：掌门被废去修为，关入后山牢房。",
    });
    expect(spec.system).toContain("【上一章摘要】");
    expect(spec.system).toContain("掌门被废去修为");
    expect(spec.system).toContain("不得让已死的角色复活");
    // 摘要段必须排在前文之前：先给背景再给「写到这里」，读起来才顺
    expect(spec.system.indexOf("【上一章摘要】")).toBeLessThan(spec.system.indexOf("【前文】"));
  });

  it("前文足够长时不注入摘要（连续写作时前文就是上下文，摘要只会打架）", () => {
    const spec = assembleContinuationStreamSpec(collectBookContext(snapshot, "continuation"), {
      before: "林".repeat(CONTINUATION_SUMMARY_MIN_BEFORE_CHARS),
      previousSummary: "上一章：掌门被废去修为。",
    });
    expect(spec.system).not.toContain("【上一章摘要】");
    expect(spec.system).not.toContain("掌门被废去修为");
  });

  it("摘要缺失 / 空白时静默省略（不产出空的【上一章摘要】残段）", () => {
    for (const previousSummary of ["", "   ", undefined]) {
      const spec = assembleContinuationStreamSpec(collectBookContext(snapshot, "continuation"), {
        before: "林晚照推开牢门。",
        ...(previousSummary === undefined ? {} : { previousSummary }),
      });
      expect(spec.system).not.toContain("【上一章摘要】");
    }
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

  it("要求两段式输出（一句话 + 摘要），供大纲回流拆分", () => {
    const spec = assembleSummarySpec(collectBookContext(snapshot, "summary"), {
      chapter: "正文。",
    });
    expect(spec.system).toContain(SUMMARY_ONE_LINER_HEAD);
    expect(spec.system).toContain(SUMMARY_BODY_HEAD);
    expect(spec.system).toContain("30 字");
    // 仍是 text 契约：加一段不等于换成 json
    expect(spec.outputFormat).toEqual(TEXT_OUTPUT_FORMAT);
  });
});

describe("parseSummaryReply", () => {
  it("标准两段：一句话进大纲，长摘要落库", () => {
    const reply = parseSummaryReply(
      "【一句话】林晚照击退来敌，掌门失踪的线索浮出水面。\n\n【摘要】本章写林晚照在青云山巅迎战……（略）",
    );
    expect(reply.oneLiner).toBe("林晚照击退来敌，掌门失踪的线索浮出水面。");
    expect(reply.summary).toContain("青云山巅迎战");
    // 长摘要里不该再带标记
    expect(reply.summary).not.toContain(SUMMARY_BODY_HEAD);
  });

  it("标记与内容同在一行也能拆", () => {
    const reply = parseSummaryReply("【一句话】主角入门。【摘要】他在山门领了牌子。");
    expect(reply.oneLiner).toBe("主角入门。");
    expect(reply.summary).toBe("他在山门领了牌子。");
  });

  it("模型不按格式返回：整段当摘要，一句话留空（不猜）", () => {
    const reply = parseSummaryReply("本章讲了一个很长的故事，没有任何标记。");
    expect(reply.oneLiner).toBe("");
    expect(reply.summary).toBe("本章讲了一个很长的故事，没有任何标记。");
  });

  it("只给了一句话没给摘要：兜底成摘要，不让本次生成作废", () => {
    const reply = parseSummaryReply("【一句话】主角入门。");
    expect(reply.oneLiner).toBe("主角入门。");
    expect(reply.summary).toBe("主角入门。");
  });

  it("一句话超长或带多余行：取第一行并截断到 60 字", () => {
    const long = "甲".repeat(120);
    const reply = parseSummaryReply(`【一句话】- ${long}\n第二行不该要\n【摘要】正文。`);
    expect(reply.oneLiner.length).toBeLessThanOrEqual(61); // 60 + 省略号
    expect(reply.oneLiner.startsWith("甲")).toBe(true);
    expect(reply.oneLiner).not.toContain("第二行");
    expect(reply.summary).toBe("正文。");
  });

  it("空回复不产出任何东西（不写大纲也不落库）", () => {
    expect(parseSummaryReply("   \n ")).toEqual({ oneLiner: "", summary: "" });
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
    const directContinuation = assembleContinuationStreamSpec(context, { before: "前文。" });
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

  it("AI_INTENT_LABELS 覆盖 PROMPT_INTENTS 全量（消费侧意图标签单一产地，G7）", () => {
    for (const intent of PROMPT_INTENTS) {
      expect(AI_INTENT_LABELS[intent], `${intent} 缺中文标签`).toBeTruthy();
    }
    // summary 是 2.10.0 新增，历史上被 UsagePanel 漏掉（review G7）
    expect(AI_INTENT_LABELS.summary).toBe("摘要");
  });
});
