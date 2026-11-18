/**
 * 面试域契约守卫
 *
 * ⚠️ 本文件**只依赖面试域自身**（`./index` 的域模块 + 三个 builder + 段落 + 采集器），
 * 刻意**不 import `../index` 的 `DOMAINS` / `PROMPT_INTENTS` / `AI_INTENT_LABELS`**。
 *
 * 原因：域模块落地与「登记进 `DOMAINS`」是两步。在登记之前，全局表里还没有这三个
 * 意图，任何「查全局表」的断言都会红成一片，让真正在改折叠层的人误判。全局层的
 * 不变式（意图唯一、label / version 全量）由 `prompt/prompt.test.ts` 的
 * `DOMAINS` 遍历守卫负责，这里是纯域内契约。
 */
import { describe, expect, it } from "vitest";
import { TEXT_OUTPUT_FORMAT, parseOutput } from "../../../output-spec";
import {
  AUDIT_OUTPUT_FORMAT,
  AUDIT_SEVERITIES,
  AUDIT_SEVERITY_LABELS,
  assembleAuditSpec,
} from "./builders/audit";
import {
  DIAGRAM_KIND_SHAPE_HINT,
  DRAFT_DIFFICULTY_LABELS,
  DRAFT_OUTPUT_FORMATS,
  assembleDraftSpec,
  clampDraftCount,
} from "./builders/draft";
import {
  EXPLAIN_BODY_HEAD,
  EXPLAIN_ONE_LINER_HEAD,
  assembleExplainSpec,
} from "./builders/explain";
import {
  TAXONOMY_LABEL_MAX,
  TAXONOMY_OUTPUT_FORMAT,
  TAXONOMY_SUGGEST_MAX,
  assembleTaxonomySpec,
  clampTaxonomyCount,
} from "./builders/taxonomy";
import { INTERVIEW_LIMITS, collectInterviewContext } from "./collector";
import { INTERVIEW_INTENT_LABELS, INTERVIEW_PROMPT_VERSIONS, interviewPromptDomain } from "./index";
import type { InterviewAuditTarget, InterviewPromptContext } from "./types";

/** 题库上下文：两个分类（其中一个带 note）+ 已有条目 + 非空规模 */
function makeContext(): InterviewPromptContext {
  return collectInterviewContext({
    categories: [
      { id: "js", label: "JavaScript" },
      { id: "react", label: "React", note: "只考 hooks 与渲染" },
    ],
    stats: { questions: 42, glossaries: 18, diagrams: 3 },
    questionTitles: ["手写 Promise", "事件循环是什么"],
    glossaryTerms: ["事件循环", "闭包"],
    activeCategoryId: "js",
  });
}

/** 三题待检（含 tags 与不含 tags 各一，验证空行不残留） */
const auditTargets: InterviewAuditTarget[] = [
  {
    id: "q-1",
    title: "手写 Promise",
    stem: "实现一个符合 Promise/A+ 的 Promise。",
    answer: "维护状态机与回调队列……",
    categoryId: "js",
    difficulty: "hard",
    tags: ["异步", "手写"],
  },
  {
    id: "q-2",
    title: "事件循环",
    stem: "说说浏览器的事件循环。",
    answer: "宏任务与微任务交替……",
    categoryId: "js",
    difficulty: "medium",
  },
];

describe("interviewExplain（划词解释）", () => {
  it("① 段落齐全：选区 + 词本身 + 两段标记行，且是 text 契约", () => {
    const spec = assembleExplainSpec(makeContext(), {
      term: "闭包",
      sentence: "闭包让你可以在函数外部访问内部变量。",
    });
    expect(spec.system).toContain("【选区】");
    expect(spec.system).toContain("闭包");
    expect(spec.system).toContain(EXPLAIN_ONE_LINER_HEAD);
    expect(spec.system).toContain(EXPLAIN_BODY_HEAD);
    expect(spec.outputFormat).toEqual(TEXT_OUTPUT_FORMAT);
    expect(spec.outputFormat.kind).toBe("text");
  });

  it("② 没有 sentence / stem 时不留「- 所在原文：」这类空残段", () => {
    const spec = assembleExplainSpec(makeContext(), { term: "闭包" });
    expect(spec.system).toContain("【选区】闭包");
    expect(spec.system).not.toContain("- 所在原文：");
    expect(spec.system).not.toContain("- 所在题干（节选）：");
    // 没有语境句时用户提示词也不该假装有语境
    expect(spec.prompt).toBe("请解释「闭包」，按约定的两段格式输出。");
  });

  it("③ 词条库已有释义时，明确要求「不要复述它」", () => {
    const spec = assembleExplainSpec(makeContext(), {
      term: "闭包",
      existingShort: "函数与其词法环境的组合。",
    });
    expect(spec.system).toContain("函数与其词法环境的组合。");
    expect(spec.system).toContain("不要复述它");
  });
});

describe("interviewDraft（AI 拓展）", () => {
  it("④ question：字段键与契约顺序一致，count 夹在 1–10", () => {
    const format = DRAFT_OUTPUT_FORMATS.question;
    const keys = format.kind === "json-array" ? format.fields.map((field) => field.key) : [];
    expect(keys).toEqual([
      "title",
      "stem",
      "stemCode",
      "answer",
      "difficulty",
      "topic",
      "tags",
    ]);

    const base = { kind: "question" as const, categoryId: "react" };
    expect(assembleDraftSpec(makeContext(), { ...base, count: 99 }).count).toBe(10);
    expect(assembleDraftSpec(makeContext(), { ...base, count: -3 }).count).toBe(1);
    expect(assembleDraftSpec(makeContext(), { ...base, count: Number.NaN }).count).toBe(3);
    expect(clampDraftCount("question", 7)).toBe(7);
    // diagram 恒 1 张（一屏放不下第二张）
    expect(clampDraftCount("diagram", 5)).toBe(1);
  });

  /**
   * 真实事故（2026-11）：模型完全照契约交上 `stemCode: ""`（大多数题没有代码），
   * 而解析层当时把空串当成「字段缺失」→ 整条丢弃 → 抽屉报「没有可用的内容」。
   * 契约说「没有就填空字符串」，解析就必须照着读。
   */
  it("④-b question：stemCode 填空字符串的合法条目不会被丢掉", () => {
    const raw = JSON.stringify([
      {
        title: "WebGL 渲染管线的主要阶段与着色器作用",
        stem: "请说明 WebGL 渲染管线从顶点输入到屏幕输出的主要阶段。",
        stemCode: "",
        answer: "1. 顶点数据输入：顶点属性由 Buffer 提供。\n2. 顶点着色器：逐顶点做坐标变换。",
        difficulty: "basic",
        topic: "threeJS&webGL",
        tags: "WebGL、渲染管线、顶点着色器、片元着色器",
      },
    ]);
    const parsed = parseOutput(raw, DRAFT_OUTPUT_FORMATS.question);
    expect(parsed.usedFallback).toBe(false);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].stemCode).toBe("");
    expect(parsed.entries[0].title).toBe("WebGL 渲染管线的主要阶段与着色器作用");
    // 标签串仍按顿号拆（空 stemCode 不能连带影响别的字段归一）
    expect(parsed.entries[0].tags).toContain("渲染管线");
  });

  it("④-c glossary：en / aliases 填空字符串的条目同样保留", () => {
    const raw = JSON.stringify([
      {
        term: "事件循环",
        en: "",
        short: "浏览器把任务排队后逐个执行并持续检查微任务的机制。",
        detail: "宏任务先入队。\n微任务在每个宏任务后清空。",
        aliases: "",
        domain: "浏览器",
      },
    ]);
    const parsed = parseOutput(raw, DRAFT_OUTPUT_FORMATS.glossary);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].en).toBe("");
    expect(parsed.entries[0].term).toBe("事件循环");
  });

  it("⑤ question：注入目标分类（label + id）、已有标题，并要求顿号分隔标签", () => {
    const spec = assembleDraftSpec(makeContext(), {
      kind: "question",
      categoryId: "react",
      track: "written",
      difficulty: "medium",
      count: 3,
    });
    expect(spec.system).toContain("React");
    expect(spec.system).toContain("react");
    expect(spec.system).toContain("只考 hooks 与渲染");
    expect(spec.system).toContain("手写 Promise");
    expect(spec.system).toContain("顿号分隔");
    expect(spec.system).toContain("手写题");
    expect(spec.system).toContain(DRAFT_DIFFICULTY_LABELS.medium);
    // 一问一答形态：不许出选择题
    expect(spec.system).toContain("不要出选择题");
    expect(spec.count).toBe(3);
  });

  it("⑥ glossary：字段键与契约一致，且要求「不重复造词条」", () => {
    const format = DRAFT_OUTPUT_FORMATS.glossary;
    const keys = format.kind === "json-array" ? format.fields.map((field) => field.key) : [];
    expect(keys).toEqual(["term", "en", "short", "detail", "aliases", "domain"]);

    const spec = assembleDraftSpec(makeContext(), { kind: "glossary", count: 4 });
    expect(spec.system).toContain("事件循环");
    expect(spec.system).toContain("近义词也算重复");
    expect(spec.system).toContain("命中就别再造一条");
    expect(spec.count).toBe(4);
  });

  it("⑦ diagram：走 text 契约，且键名逐字样例不混用", () => {
    // 两类图的键名必须互斥：flow 用 label/note，timeline 用 title/detail
    expect(DIAGRAM_KIND_SHAPE_HINT.flow).toContain('"label"');
    expect(DIAGRAM_KIND_SHAPE_HINT.flow).not.toContain('"events"');
    expect(DIAGRAM_KIND_SHAPE_HINT.timeline).toContain('"title"');
    expect(DIAGRAM_KIND_SHAPE_HINT.timeline).not.toContain('"nodes"');

    const flow = assembleDraftSpec(makeContext(), {
      kind: "diagram",
      diagramKind: "flow",
      count: 3,
    });
    expect(flow.outputFormat.kind).toBe("text");
    // text 契约没有「条目数」概念，不该带 count
    expect(flow.count).toBeUndefined();
    // 本次图型的骨架逐字进 prompt，且不夹带别的图型
    expect(flow.system).toContain(DIAGRAM_KIND_SHAPE_HINT.flow);
    expect(flow.system).not.toContain(DIAGRAM_KIND_SHAPE_HINT.timeline);
    expect(flow.system).not.toContain(DIAGRAM_KIND_SHAPE_HINT.layers);
  });
});

describe("interviewAudit（题目质检）", () => {
  it("⑧ 输出契约首字段是 id（parseOutput 的去重键），并要求一题一条", () => {
    expect(AUDIT_OUTPUT_FORMAT.kind).toBe("json-array");
    const keys =
      AUDIT_OUTPUT_FORMAT.kind === "json-array"
        ? AUDIT_OUTPUT_FORMAT.fields.map((field) => field.key)
        : [];
    expect(keys[0]).toBe("id");
    expect(keys).toEqual(["id", "severity", "issues", "suggestion"]);

    const spec = assembleAuditSpec(makeContext(), { targets: auditTargets });
    expect(spec.system).toContain("一题一条");
    expect(spec.system).toContain("【待检题目 q-1】");
    expect(spec.system).toContain("【待检题目 q-2】");
    // 没有 tags 的题不留「- 标签：」残行
    expect(spec.system).not.toContain("- 标签：\n");
    expect(spec.count).toBe(2);
  });

  it("⑨ 三档严重程度的中文口径全部进 prompt", () => {
    const spec = assembleAuditSpec(makeContext(), { targets: auditTargets });
    for (const severity of AUDIT_SEVERITIES) {
      expect(spec.system, `缺 ${severity} 的判定口径`).toContain(AUDIT_SEVERITY_LABELS[severity]);
    }
    expect(AUDIT_SEVERITIES.join(" / ")).toBe("high / medium / low");
  });

  it("⑩ 待检题目超过上限时按 INTERVIEW_LIMITS.auditTargets 截断", () => {
    const many: InterviewAuditTarget[] = Array.from(
      { length: INTERVIEW_LIMITS.auditTargets + 5 },
      (_, index) => ({
        id: `q-${index}`,
        title: `题目 ${index}`,
        stem: "题干",
        answer: "答案",
        categoryId: "js",
        difficulty: "basic" as const,
      }),
    );
    const spec = assembleAuditSpec(makeContext(), { targets: many });
    expect(spec.count).toBe(INTERVIEW_LIMITS.auditTargets);
    expect(spec.system).toContain(`【待检题目 q-${INTERVIEW_LIMITS.auditTargets - 1}】`);
    expect(spec.system).not.toContain(`【待检题目 q-${INTERVIEW_LIMITS.auditTargets}】`);
  });
});

describe("interviewTaxonomySuggest（分类建议）", () => {
  it("⑬ 输出契约四字段齐全，条数夹取到 1~3", () => {
    expect(TAXONOMY_OUTPUT_FORMAT.kind).toBe("json-array");
    const keys =
      TAXONOMY_OUTPUT_FORMAT.kind === "json-array"
        ? TAXONOMY_OUTPUT_FORMAT.fields.map((field) => field.key)
        : [];
    expect(keys).toEqual(["label", "track", "note", "sampleTitles"]);

    expect(clampTaxonomyCount(undefined)).toBe(2);
    expect(clampTaxonomyCount(0)).toBe(2);
    expect(clampTaxonomyCount(9)).toBe(TAXONOMY_SUGGEST_MAX);
    expect(clampTaxonomyCount(1.6)).toBe(1);
  });

  it("⑭ 现有分类作为封闭词表进 prompt，且要求给 3 条示例题名", () => {
    const spec = assembleTaxonomySpec(makeContext(), { count: 2, seed: "服务端渲染" });
    expect(spec.system).toContain("【可选分类");
    expect(spec.system).toContain("React");
    expect(spec.system).toContain(`不超过 ${TAXONOMY_LABEL_MAX} 字`);
    expect(spec.system).toContain("sampleTitles 必须给 3 条");
    expect(spec.system).toContain("围绕这个方向展开：服务端渲染");
    expect(spec.count).toBe(2);
    expect(spec.prompt).toContain("服务端渲染");
  });

  it("⑮ 没有种子时让模型自己找空缺", () => {
    const spec = assembleTaxonomySpec(makeContext(), { count: 2 });
    expect(spec.prompt).toContain("最缺的");
    expect(spec.system).not.toContain("围绕这个方向展开");
  });
});

describe("interviewPromptDomain（域模块自述 + 泛化层没走样）", () => {
  it("⑪ 三张域内表覆盖全部意图，且分级不含 L3", () => {
    const intents = [...interviewPromptDomain.intents];
    expect(intents).toEqual([
      "interviewExplain",
      "interviewDraft",
      "interviewAudit",
      "interviewTaxonomySuggest",
    ]);
    expect(Object.keys(interviewPromptDomain.labels).sort()).toEqual([...intents].sort());
    expect(Object.keys(interviewPromptDomain.versions).sort()).toEqual([...intents].sort());
    for (const intent of intents) {
      // 标签必须是中文且不等于原始 key（否则消费侧会回落成英文意图名）
      expect(interviewPromptDomain.labels[intent]).not.toBe(intent);
      expect(INTERVIEW_INTENT_LABELS[intent]).toBe(interviewPromptDomain.labels[intent]);
      expect(INTERVIEW_PROMPT_VERSIONS[intent]).toMatch(/^v\d+$/);
    }
    expect(interviewPromptDomain.domain).toBe("interview");
    // 题库不发送任何作品正文：声明 L3 等于给隐私口径开后门
    expect(interviewPromptDomain.allowedLevels).toEqual(["L1", "L2"]);
  });

  it("⑫ 经域模块分发与直接调 builder 逐字节等价（不查全局表）", () => {
    const context = makeContext();
    const explainPayload = { term: "闭包", sentence: "闭包会捕获变量。" };
    const draftPayload = { kind: "question" as const, categoryId: "js", count: 3 };
    const auditPayload = { targets: auditTargets };
    const taxonomyPayload = { count: 2, seed: "服务端渲染" };

    expect(interviewPromptDomain.build("interviewExplain", context, explainPayload)).toEqual(
      assembleExplainSpec(context, explainPayload),
    );
    expect(interviewPromptDomain.build("interviewDraft", context, draftPayload)).toEqual(
      assembleDraftSpec(context, draftPayload),
    );
    expect(interviewPromptDomain.build("interviewAudit", context, auditPayload)).toEqual(
      assembleAuditSpec(context, auditPayload),
    );
    expect(
      interviewPromptDomain.build("interviewTaxonomySuggest", context, taxonomyPayload),
    ).toEqual(assembleTaxonomySpec(context, taxonomyPayload));
  });
});
