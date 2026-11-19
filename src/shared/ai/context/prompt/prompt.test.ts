import { describe, expect, it } from "vitest";
import { collectBookContext, type BookSnapshot } from "./domains/novel/collector";
import { NAMING_OUTPUT_FORMAT, TEXT_OUTPUT_FORMAT } from "../output-spec";
import { assembleNamingSpec } from "./domains/novel/builders/naming";
import { assemblePolishSpec } from "./domains/novel/builders/polish";
import {
  assembleTransformSpec,
  TRANSFORM_KIND_LABELS,
  type TransformKind,
} from "./domains/novel/builders/transform";
import {
  assembleContinuationStreamSpec,
  CONTINUATION_STREAM_OUTPUT_FORMAT,
  CONTINUATION_SUMMARY_MIN_BEFORE_CHARS,
} from "./domains/novel/builders/continuation";
import {
  assembleSummarySpec,
  parseSummaryReply,
  SUMMARY_BODY_HEAD,
  SUMMARY_ONE_LINER_HEAD,
} from "./domains/novel/builders/summary";
import {
  assembleExtractSpec,
  EXTRACT_OUTPUT_FORMAT,
  EXTRACT_TYPE_LABELS,
} from "./domains/novel/builders/extract";
import {
  assembleRelationSpec,
  RELATION_CONFIDENCE_VALUES,
  RELATION_OUTPUT_FORMAT,
} from "./domains/novel/builders/relation";
import {
  assembleLevelGenSpec,
  clampLevelCount,
  LEVEL_OUTPUT_FORMAT,
} from "./domains/novel/builders/level-gen";
import {
  assembleBranchSpec,
  BRANCH_OUTPUT_FORMAT,
  clampBranchCount,
  RESCUE_STYLE_LABELS,
} from "./domains/novel/builders/branch";
import {
  assembleConsistencySpec,
  CONSISTENCY_MAX_SUSPECTS,
  CONSISTENCY_OUTPUT_FORMAT,
  CONSISTENCY_VERDICTS,
  isTypoVerdict,
} from "./domains/novel/builders/consistency";
import {
  AI_INTENT_LABELS,
  buildPromptSpec,
  PROMPT_BUILDERS,
  PROMPT_INTENTS,
  PROMPT_VERSIONS,
  promptVersionOf,
} from "./index";

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
describe("assembleExtractSpec", () => {
  const extractContext = () => collectBookContext(snapshot, "extract");

  it("json-array 契约：四个字段都在，供候选列表逐条渲染", () => {
    const spec = assembleExtractSpec(extractContext(), {
      chapter: "李玄握刀而立，青冥宗的山门在雾里。",
      chapterTitle: "第一章 山门",
    });
    expect(spec.outputFormat.kind).toBe("json-array");
    expect(spec.outputFormat).toEqual(EXTRACT_OUTPUT_FORMAT);
    // OutputFormat 是判别联合，取字段前必须先按 kind 收窄
    const format = spec.outputFormat;
    const keys = format.kind === "json-array" ? format.fields.map((field) => field.key) : [];
    expect(keys).toEqual(["name", "type", "summary", "evidence"]);
  });

  it("注入作品背景 / 章节标题 / 章节正文", () => {
    const spec = assembleExtractSpec(extractContext(), {
      chapter: "李玄握刀而立。",
      chapterTitle: "第一章 山门",
    });
    expect(spec.system).toContain("《青云志》");
    expect(spec.system).toContain("【章节】第一章 山门");
    expect(spec.system).toContain("【章节正文】");
    expect(spec.system).toContain("李玄握刀而立");
  });

  it("已有要素是硬约束段：名字列进去并要求跳过（否则每次抽一半是老面孔）", () => {
    const spec = assembleExtractSpec(extractContext(), { chapter: "正文。" });
    expect(spec.system).toContain("【已有要素（不要再抽，也不要换个说法重抽）】");
    expect(spec.system).toContain("林晚照");
    // 注释里承诺的「含别名」必须真的写进约束
    expect(spec.system).toContain("含别名");
  });

  it("类型只能取枚举里的六个中文值", () => {
    const spec = assembleExtractSpec(extractContext(), { chapter: "正文。" });
    for (const label of EXTRACT_TYPE_LABELS) {
      expect(spec.system).toContain(label);
    }
  });

  it("选中段落范围：换成【选中段落】段并禁止补写没看到的段落", () => {
    const spec = assembleExtractSpec(extractContext(), {
      chapter: "他抬头看山门。",
      scope: "selection",
    });
    expect(spec.system).toContain("【选中段落】");
    expect(spec.system).not.toContain("【章节正文】");
    expect(spec.system).toContain("只从【选中段落】里抽");
  });

  it("前情只作背景：有 contextText 才出现，且明说不从这里抽", () => {
    const withContext = assembleExtractSpec(extractContext(), {
      chapter: "正文。",
      contextText: "上一章他刚下山。",
    });
    expect(withContext.system).toContain("【前情（只作背景，不要从这里抽取）】");
    expect(withContext.system).toContain("上一章他刚下山");

    const without = assembleExtractSpec(extractContext(), { chapter: "正文。" });
    expect(without.system).not.toContain("【前情");
  });

  it("条数夹在 5–30：0 / 负数 / 离谱值都退回合理区间", () => {
    expect(assembleExtractSpec(extractContext(), { chapter: "正文。", limit: 0 }).prompt).toContain(
      "最多 20 条",
    );
    expect(assembleExtractSpec(extractContext(), { chapter: "正文。", limit: 2 }).prompt).toContain(
      "最多 5 条",
    );
    expect(
      assembleExtractSpec(extractContext(), { chapter: "正文。", limit: 999 }).prompt,
    ).toContain("最多 30 条");
  });

  it("正文为空时给可读兜底，且要求空数组而不是编造", () => {
    const spec = assembleExtractSpec(extractContext(), { chapter: "" });
    expect(spec.system).toContain("（本章无正文内容）");
    expect(spec.system).toContain("输出空数组");
  });
});

describe("assembleRelationSpec", () => {
  const relationContext = () => collectBookContext(snapshot, "relation");

  it("json-array 契约：五字段（两端 + 关系名 + 置信度 + 出处）", () => {
    const spec = assembleRelationSpec(relationContext(), {
      chapter: "林晚照收下他做弟子。",
      chapterTitle: "第二章 拜师",
    });
    expect(spec.outputFormat.kind).toBe("json-array");
    expect(spec.outputFormat).toEqual(RELATION_OUTPUT_FORMAT);
    const format = spec.outputFormat;
    const keys = format.kind === "json-array" ? format.fields.map((field) => field.key) : [];
    expect(keys).toEqual(["from", "to", "relation", "confidence", "evidence"]);
  });

  it("端点白名单写进 prompt：只能用已有要素的名字（编出来的名字会被渲染层丢掉）", () => {
    const spec = assembleRelationSpec(relationContext(), { chapter: "正文。" });
    expect(spec.system).toContain("【已有要素】");
    expect(spec.system).toContain("林晚照");
    expect(spec.system).toContain("必须");
    expect(spec.system).toContain("逐字照抄");
  });

  it("已有关系逐条列出并要求不重复输出（同一对要素的平行关系仍可建）", () => {
    const withEdges = assembleRelationSpec(relationContext(), {
      chapter: "正文。",
      existingEdges: ["林晚照 —师徒— 李玄"],
    });
    expect(withEdges.system).toContain("【已有关系（不要重复输出）】");
    expect(withEdges.system).toContain("林晚照 —师徒— 李玄");

    const without = assembleRelationSpec(relationContext(), { chapter: "正文。" });
    expect(without.system).not.toContain("【已有关系");
  });

  it("置信度只允许三档，且约束里说清何时用哪档", () => {
    const spec = assembleRelationSpec(relationContext(), { chapter: "正文。" });
    for (const value of RELATION_CONFIDENCE_VALUES) {
      expect(spec.system).toContain(value);
    }
    expect(spec.system).toContain("拜师");
  });

  it("选中段落范围：换成【选中段落】段并禁止补写没看到的段落", () => {
    const spec = assembleRelationSpec(relationContext(), {
      chapter: "他跪下叫了一声师父。",
      scope: "selection",
    });
    expect(spec.system).toContain("【选中段落】");
    expect(spec.system).not.toContain("【章节正文】");
    expect(spec.system).toContain("只从【选中段落】里推断");
  });

  it("前情只作背景：有 contextText 才出现，且明说不从这里推断", () => {
    const withContext = assembleRelationSpec(relationContext(), {
      chapter: "正文。",
      contextText: "上一章他们刚结拜。",
    });
    expect(withContext.system).toContain("【前情（只作背景，不要从这里推断）】");
    expect(withContext.system).toContain("上一章他们刚结拜");
  });

  it("条数夹在 5–40，空正文要求空数组而不是编造", () => {
    expect(assembleRelationSpec(relationContext(), { chapter: "正文。", limit: 1 }).prompt).toContain(
      "最多 5 条",
    );
    expect(
      assembleRelationSpec(relationContext(), { chapter: "正文。", limit: 999 }).prompt,
    ).toContain("最多 40 条");

    const empty = assembleRelationSpec(relationContext(), { chapter: "" });
    expect(empty.system).toContain("（本章无正文内容）");
    expect(empty.system).toContain("输出空数组");
  });
});

describe("Prompt 模板注册表", () => {
  it("清单与注册表一致，且起名 / 润色 / 变换 / 续写 / 摘要 / 抽取 / 关系 / 卡文救援 / 一致性都在册", () => {
    expect([...PROMPT_INTENTS].sort()).toEqual(Object.keys(PROMPT_BUILDERS).sort());
    expect(PROMPT_INTENTS).toContain("naming");
    expect(PROMPT_INTENTS).toContain("polish");
    expect(PROMPT_INTENTS).toContain("transform");
    expect(PROMPT_INTENTS).toContain("continuation");
    expect(PROMPT_INTENTS).toContain("summary");
    expect(PROMPT_INTENTS).toContain("extract");
    expect(PROMPT_INTENTS).toContain("relation");
    expect(PROMPT_INTENTS).toContain("branch");
    expect(PROMPT_INTENTS).toContain("consistency");
  });

  it("每个模板都产出完整 PromptSpec：角色句在首句、system 非空、声明了输出契约", () => {
    const context = collectBookContext(snapshot, "naming");
    const naming = PROMPT_BUILDERS.naming(context, { count: 3 });
    const polish = PROMPT_BUILDERS.polish(context, { text: "一句原文。" });
    const transform = PROMPT_BUILDERS.transform(context, { kind: "rewrite", text: "一句原文。" });
    const continuation = PROMPT_BUILDERS.continuation(context, { before: "前文。" });
    const summary = PROMPT_BUILDERS.summary(context, { chapter: "正文。" });
    const extract = PROMPT_BUILDERS.extract(context, { chapter: "正文。" });
    const relation = PROMPT_BUILDERS.relation(context, { chapter: "正文。" });
    const branch = PROMPT_BUILDERS.branch(collectBookContext(snapshot, "branch"), {
      chapter: "正文。",
      style: "default",
      count: 4,
    });
    const consistency = PROMPT_BUILDERS.consistency(
      collectBookContext(snapshot, "consistency"),
      { suspects: [{ expected: "林晚照", candidate: "林晚昭", occurrences: 2, snippet: "林晚昭提剑。" }], knownNames: ["林晚照"] },
    );

    for (const spec of [
      naming,
      polish,
      transform,
      continuation,
      summary,
      extract,
      relation,
      branch,
      consistency,
    ]) {
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

    const viaExtract = buildPromptSpec("extract", context, { chapter: "正文。" });
    const directExtract = assembleExtractSpec(context, { chapter: "正文。" });
    expect(viaExtract).toEqual(directExtract);

    const viaRelation = buildPromptSpec("relation", context, { chapter: "正文。" });
    const directRelation = assembleRelationSpec(context, { chapter: "正文。" });
    expect(viaRelation).toEqual(directRelation);

    const levelIntent = {
      categoryName: "境界体系",
      kind: "realm" as const,
      existing: ["炼气"],
      mode: "extend" as const,
      count: 4,
    };
    const viaLevelGen = buildPromptSpec("levelGen", context, levelIntent);
    const directLevelGen = assembleLevelGenSpec(context, levelIntent);
    expect(viaLevelGen).toEqual(directLevelGen);

    // 卡文救援 / 一致性 AI 档：新增意图的**参数不错位**（ctx 用错域的、payload 少字段都会红）
    const branchIntent = { chapter: "正文。", style: "darker" as const, count: 4 };
    const viaBranch = buildPromptSpec("branch", context, branchIntent);
    const directBranch = assembleBranchSpec(context, branchIntent);
    expect(viaBranch).toEqual(directBranch);

    const consistencyIntent = {
      suspects: [{ expected: "林晚照", candidate: "林晚昭", occurrences: 2, snippet: "林晚昭提剑。" }],
      knownNames: ["林晚照"],
    };
    const viaConsistency = buildPromptSpec("consistency", context, consistencyIntent);
    const directConsistency = assembleConsistencySpec(context, consistencyIntent);
    expect(viaConsistency).toEqual(directConsistency);
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
    // 2.72.0 新增的两个意图：标签必须与域内表同字面（否则看板上是英文键名）
    expect(AI_INTENT_LABELS.branch).toBe("卡文救援");
    expect(AI_INTENT_LABELS.consistency).toBe("一致性 AI 档");
  });
});

describe("assembleLevelGenSpec", () => {
  const levelContext = () => collectBookContext(snapshot, "levelGen");

  it("json-array 契约：等级名 + 一句话说明两列", () => {
    const spec = assembleLevelGenSpec(levelContext(), {
      categoryName: "境界体系",
      kind: "realm",
      existing: [],
      mode: "generate",
      count: 9,
    });
    expect(spec.outputFormat).toEqual(LEVEL_OUTPUT_FORMAT);
    const format = spec.outputFormat;
    const keys = format.kind === "json-array" ? format.fields.map((field) => field.key) : [];
    expect(keys).toEqual(["name", "note"]);
  });

  it("注入作品背景 / 体系名 / 分类说明", () => {
    const spec = assembleLevelGenSpec(levelContext(), {
      categoryName: "功法品阶",
      categoryNote: "武道一途，共分九品",
      kind: "custom",
      existing: [],
      mode: "generate",
      count: 9,
    });
    expect(spec.system).toContain("《青云志》");
    expect(spec.system).toContain("仙侠");
    expect(spec.system).toContain("【体系】功法品阶（自定义体系）");
    expect(spec.system).toContain("【体系说明】武道一途，共分九品");
  });

  it("整理整套：要求从入门到顶端、条数进 system 与 prompt", () => {
    const spec = assembleLevelGenSpec(levelContext(), {
      categoryName: "境界体系",
      kind: "realm",
      existing: [],
      mode: "generate",
      count: 8,
    });
    expect(spec.system).toContain("从入门到顶端");
    expect(spec.system).toContain("只输出 8 条");
    expect(spec.prompt).toContain("8 级");
  });

  it("拓展后续：以现有末条为起点、不许重排、方向跟着作者", () => {
    const spec = assembleLevelGenSpec(levelContext(), {
      categoryName: "境界体系",
      kind: "realm",
      existing: ["炼气", "筑基"],
      mode: "extend",
      count: 3,
    });
    // 起点是「最后一条」（末条在 desc 阶梯上也成立），而不是「最高一级」
    expect(spec.system).toContain("现有阶梯的最后一条是「筑基」");
    expect(spec.system).toContain("不要把现有级别重排");
    expect(spec.system).toContain("不要替作者翻转阶梯");
    expect(spec.system).toContain("【现有阶梯（按作者的排列顺序，第一条在最上）】炼气 → 筑基");
    expect(spec.prompt).toContain("接着「筑基」往下");
    // 拓展模式不该出现「从入门到顶端」那套整套口径
    expect(spec.system).not.toContain("从入门到顶端");
  });

  it("有现有阶梯时才叮嘱重名；空阶梯不出现该段与空标签", () => {
    const withExisting = assembleLevelGenSpec(levelContext(), {
      categoryName: "境界体系",
      kind: "realm",
      existing: ["炼气"],
      mode: "extend",
      count: 2,
    });
    expect(withExisting.system).toContain("不得与【现有阶梯】里任何一级重名");

    const empty = assembleLevelGenSpec(levelContext(), {
      categoryName: "境界体系",
      kind: "realm",
      existing: [],
      mode: "generate",
      count: 5,
    });
    expect(empty.system).not.toContain("不得与【现有阶梯】");
    // 空数据必须整段丢弃，不能留下「【现有阶梯】」后面什么都没有的残句
    expect(empty.system).not.toContain("【现有阶梯");
  });

  it("只有境界体系才加题材口径约束（自定义体系不该被塞进修炼词汇）", () => {
    const realm = assembleLevelGenSpec(levelContext(), {
      categoryName: "境界体系",
      kind: "realm",
      existing: [],
      mode: "generate",
      count: 5,
    });
    expect(realm.system).toContain("东方玄幻口径");

    const custom = assembleLevelGenSpec(levelContext(), {
      categoryName: "丹药稀有度",
      kind: "custom",
      existing: [],
      mode: "generate",
      count: 5,
    });
    expect(custom.system).not.toContain("东方玄幻口径");
  });

  it("不发送任何正文（L1/L2：不需要整章授权）", () => {
    const spec = assembleLevelGenSpec(levelContext(), {
      categoryName: "境界体系",
      kind: "realm",
      existing: ["炼气"],
      mode: "extend",
      count: 3,
    });
    // snapshot 里带了 chapterSnippet；levelGen 的采集上限是全 0，绝不能出现在 prompt 里
    expect(spec.system).not.toContain("林晚照立于青云山巅");
    expect(spec.system).not.toContain("【本段所在章节片段");
  });

  it("条数夹取：未填回落默认、越界夹到区间", () => {
    expect(clampLevelCount("generate", undefined)).toBe(9);
    expect(clampLevelCount("extend", undefined)).toBe(4);
    expect(clampLevelCount("generate", 0)).toBe(9);
    expect(clampLevelCount("generate", 1)).toBe(3);
    expect(clampLevelCount("generate", 999)).toBe(20);
    expect(clampLevelCount("extend", 999)).toBe(12);
  });

  it("空分类名也有兜底，不拼出「【体系】（境界体系）」这种残句", () => {
    const spec = assembleLevelGenSpec(levelContext(), {
      categoryName: "   ",
      kind: "realm",
      existing: [],
      mode: "generate",
      count: 5,
    });
    expect(spec.system).toContain("【体系】等级体系（境界体系）");
  });
});

describe("assembleBranchSpec（R-AI-11 卡文救援）", () => {
  const branchContext = () => collectBookContext(snapshot, "branch");

  it("json-array 契约：走向标题 / 核心冲突 / 走向后果三列", () => {
    const spec = assembleBranchSpec(branchContext(), {
      chapter: "林晚照立于青云山巅。",
      style: "default",
      count: 4,
    });
    expect(spec.outputFormat).toEqual(BRANCH_OUTPUT_FORMAT);
    const format = spec.outputFormat;
    const keys = format.kind === "json-array" ? format.fields.map((field) => field.key) : [];
    expect(keys).toEqual(["title", "conflict", "consequence"]);
  });

  it("注入作品背景 / 要素白名单 / 正文", () => {
    const spec = assembleBranchSpec(branchContext(), {
      chapter: "林晚照立于青云山巅，剑已在手。",
      style: "default",
      count: 4,
    });
    expect(spec.system).toContain("《青云志》");
    expect(spec.system).toContain("仙侠");
    // 要素表是人物白名单：走向可以让现有角色做新选择，但不能凭空多出有名有姓的人
    expect(spec.system).toContain("人物：林晚照");
    expect(spec.system).toContain("必须**是上面这些名字之一");
    expect(spec.system).toContain("【正文（作者写到这里卡住了）】");
    expect(spec.system).toContain("剑已在手");
    expect(spec.prompt).toContain("4 条");
  });

  it("大纲入口：节点标题与梗概进 prompt，且要求每条走向都推进该节点", () => {
    const spec = assembleBranchSpec(branchContext(), {
      chapter: "林晚照立于青云山巅。",
      outlineNode: { title: "山巅对峙", gist: "逼师门表态" },
      style: "default",
      count: 3,
    });
    expect(spec.system).toContain("【当前剧情节点】山巅对峙");
    expect(spec.system).toContain("这一节点要推进的是：逼师门表态");
    expect(spec.system).toContain("不要绕开它另起炉灶");
  });

  it("选中段落档：卡住段落与本章正文分两段给出，且不要求改写正文", () => {
    const spec = assembleBranchSpec(branchContext(), {
      chapter: "整章正文在此。",
      selection: "林晚照握住剑柄。",
      style: "default",
      count: 4,
    });
    expect(spec.system).toContain("【卡住的段落】\n林晚照握住剑柄。");
    expect(spec.system).toContain("【本章正文（只作背景，不要求改写它）】");
  });

  it("条数夹取到 [3,5]：未填回落默认、越界夹紧", () => {
    expect(clampBranchCount(undefined)).toBe(4);
    expect(clampBranchCount(0)).toBe(4);
    expect(clampBranchCount(1)).toBe(3);
    expect(clampBranchCount(9)).toBe(5);
    expect(clampBranchCount(4.7)).toBe(4);

    // 面板传 9 也要真的只发 5 条（口径同源，不能 UI 显示 9、实发 5）
    const spec = assembleBranchSpec(branchContext(), {
      chapter: "正文。",
      style: "default",
      count: 9,
    });
    expect(spec.system).toContain("必须输出 5 条");
    expect(spec.prompt).toContain("5 条");
  });

  it("四档风格旋钮各有硬约束，且都写明「不要做什么」", () => {
    for (const style of ["default", "darker", "restrained", "twist"] as const) {
      const spec = assembleBranchSpec(branchContext(), { chapter: "正文。", style, count: 4 });
      // 风格档位是「用户可见的旋钮名」→ 进 user prompt；硬约束 → 进 system
      expect(spec.prompt).toContain(`风格：${RESCUE_STYLE_LABELS[style]}`);
    }
    const darker = assembleBranchSpec(branchContext(), { chapter: "正文。", style: "darker", count: 4 });
    expect(darker.system).toContain("不要为黑而黑");
    const twist = assembleBranchSpec(branchContext(), { chapter: "正文。", style: "twist", count: 4 });
    expect(twist.system).toContain("不要凭空掉下一个新势力");
  });

  it("摘要只在正文短于 300 字时注入（与续写同一阈值）", () => {
    const short = assembleBranchSpec(branchContext(), {
      chapter: "林晚照立于山巅。",
      summary: "上一章：她拜入青云宗。",
      style: "default",
      count: 4,
    });
    expect(short.system).toContain("【上一章摘要】上一章：她拜入青云宗。");

    const long = assembleBranchSpec(branchContext(), {
      chapter: "正".repeat(CONTINUATION_SUMMARY_MIN_BEFORE_CHARS),
      summary: "上一章：她拜入青云宗。",
      style: "default",
      count: 4,
    });
    expect(long.system).not.toContain("【上一章摘要】");
  });

  it("空正文也有兜底，不拼出空的【正文】残段", () => {
    const spec = assembleBranchSpec(branchContext(), { chapter: "   ", style: "default", count: 4 });
    expect(spec.system).toContain("（本章暂无正文，请基于已有设定给开局走向）");
    expect(spec.system).not.toContain("【上一章摘要】");
  });
});

describe("assembleConsistencySpec（R-AI-10b 一致性 AI 档）", () => {
  const consistencyContext = () => collectBookContext(snapshot, "consistency");

  it("json-array 契约：正确写法 / 疑似写法 / 判定 / 依据四列", () => {
    const spec = assembleConsistencySpec(consistencyContext(), {
      suspects: [
        { expected: "林晚照", candidate: "林晚昭", occurrences: 2, snippet: "林晚昭提剑。" },
      ],
      knownNames: ["林晚照"],
    });
    expect(spec.outputFormat).toEqual(CONSISTENCY_OUTPUT_FORMAT);
    const format = spec.outputFormat;
    const keys = format.kind === "json-array" ? format.fields.map((field) => field.key) : [];
    expect(keys).toEqual(["expected", "candidate", "verdict", "reason"]);
  });

  it("逐条渲染疑似写法（含出现次数与出处），并给出总条数", () => {
    const spec = assembleConsistencySpec(consistencyContext(), {
      suspects: [
        { expected: "林晚照", candidate: "林晚昭", occurrences: 3, snippet: "林晚昭提剑。" },
        { expected: "青云山", candidate: "青云山颠", occurrences: 1, snippet: "回到青云山颠。" },
      ],
      knownNames: ["林晚照", "青云山"],
    });
    expect(spec.system).toContain("【待判定的疑似写法（共 2 条）】");
    expect(spec.system).toContain("1. 疑似「林晚照」被写成了「林晚昭」（出现 3 次）｜出处：林晚昭提剑。");
    expect(spec.system).toContain("2. 疑似「青云山」被写成了「青云山颠」");
    expect(spec.system).toContain("送进来 2 条，就回 2 条");
    expect(spec.prompt).toContain("2 条");
  });

  it("名字白名单：优先用本批次 knownNames，不再重复罗列整张要素表", () => {
    const spec = assembleConsistencySpec(consistencyContext(), {
      suspects: [
        { expected: "林晚照", candidate: "林晚昭", occurrences: 2, snippet: "林晚昭提剑。" },
      ],
      knownNames: ["林晚照", "林晚照"], // 重复项应被去重
    });
    expect(spec.system).toContain("【可以判定的名字（白名单）】林晚照");
    expect(spec.system).toContain('只有出现在这份清单里的名字才允许作为 "expected"');
    // 白名单已在场，不再叠一遍【已有要素】
    expect(spec.system).not.toContain("【已有要素】");
  });

  it("没有 knownNames 时退回要素段作白名单（旧调用方不必改）", () => {
    const spec = assembleConsistencySpec(consistencyContext(), {
      suspects: [
        { expected: "林晚照", candidate: "林晚昭", occurrences: 2, snippet: "林晚昭提剑。" },
      ],
      knownNames: [],
    });
    expect(spec.system).toContain("【已有要素】");
    expect(spec.system).toContain("林晚照");
    expect(spec.system).not.toContain("【可以判定的名字（白名单）】");
  });

  it("判定三态写进约束；只有「错字」算建议改（isTypoVerdict）", () => {
    const spec = assembleConsistencySpec(consistencyContext(), {
      suspects: [
        { expected: "林晚照", candidate: "林晚昭", occurrences: 2, snippet: "林晚昭提剑。" },
      ],
      knownNames: ["林晚照"],
    });
    for (const verdict of CONSISTENCY_VERDICTS) {
      expect(spec.system).toContain(verdict);
    }
    expect(spec.system).toContain("拿不准时判「同形异名」");
    expect(isTypoVerdict("错字")).toBe(true);
    expect(isTypoVerdict(" 错字 ")).toBe(true);
    expect(isTypoVerdict("同形异名")).toBe(false);
    expect(isTypoVerdict("同姓角色")).toBe(false);
    expect(isTypoVerdict("模型自造的新词")).toBe(false);
    expect(isTypoVerdict(undefined)).toBe(false);
  });

  it("空疑似集：输出空数组口径，不出现「共 0 条」的残句", () => {
    const spec = assembleConsistencySpec(consistencyContext(), { suspects: [], knownNames: [] });
    expect(spec.system).toContain("（本次没有需要判定的条目）");
    expect(spec.system).toContain("输出空数组 []");
    expect(spec.system).not.toContain("共 0 条");
    expect(spec.prompt).toContain("空数组");
  });

  it("超过单批上限时截断（与 useConsistencyAi 的分批口径同源）", () => {
    const suspects = Array.from({ length: CONSISTENCY_MAX_SUSPECTS + 5 }, (_, index) => ({
      expected: "林晚照",
      candidate: `林晚昭${index}`,
      occurrences: 1,
      snippet: "出处。",
    }));
    const spec = assembleConsistencySpec(consistencyContext(), { suspects, knownNames: ["林晚照"] });
    expect(spec.system).toContain(`【待判定的疑似写法（共 ${CONSISTENCY_MAX_SUSPECTS} 条）】`);
    expect(spec.system).not.toContain(`林晚昭${CONSISTENCY_MAX_SUSPECTS}`);
  });

  it("两端都空的疑似行被丢弃（不浪费一次判定额度）", () => {
    const spec = assembleConsistencySpec(consistencyContext(), {
      suspects: [
        { expected: "  ", candidate: "", occurrences: 1, snippet: "" },
        { expected: "林晚照", candidate: "林晚昭", occurrences: 2, snippet: "林晚昭提剑。" },
      ],
      knownNames: ["林晚照"],
    });
    expect(spec.system).toContain("（共 1 条）");
  });
});
