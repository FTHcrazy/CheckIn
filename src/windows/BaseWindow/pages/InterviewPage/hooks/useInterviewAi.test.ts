import { describe, expect, it } from "vitest";
import { buildDraftCandidate, extractJsonObject } from "./useInterviewAi";

/**
 * AI 产物的归一（T06-B）。
 *
 * 模型不会照着契约写字：`tags` 写顿号串、`detail` 写一整段、难度写「中级」、
 * 图解塞在代码围栏里。这一层负责把它们变成**能通过结构校验**的产物；
 * 归不动的必须变成 `errors`（界面红字），绝不能静默丢掉或少字段落库。
 */
const base = {
  categoryId: "foundation-react",
  track: "foundation" as const,
  difficulty: "medium" as const,
};

describe("buildDraftCandidate · question", () => {
  it("补全应用侧字段，并把顿号串拆成标签数组", () => {
    const candidate = buildDraftCandidate({
      ...base,
      kind: "question",
      entry: {
        title: "StrictMode 下 useEffect 为什么执行两次",
        stem: "开发环境挂载时的副作用执行了两次，这是 bug 吗？",
        answer: "不是，开发环境会故意多跑一次。",
        difficulty: "高级",
        topic: "React 渲染",
        tags: "StrictMode、useEffect、开发环境",
      },
    });

    expect(candidate).not.toBeNull();
    expect(candidate?.errors).toEqual([]);
    const payload = candidate?.payload as {
      id: string;
      tags: string[];
      difficulty: string;
      categoryId: string;
      track: string;
    };
    expect(payload.id.startsWith("u-q-")).toBe(true);
    expect(payload.tags).toEqual(["StrictMode", "useEffect", "开发环境"]);
    // 中文档位要归一成枚举，否则结构校验直接红
    expect(payload.difficulty).toBe("hard");
    expect(payload.categoryId).toBe("foundation-react");
    expect(payload.track).toBe("foundation");
  });

  it("缺题干 = 整条丢掉（返回 null，不留半截内容）", () => {
    expect(
      buildDraftCandidate({
        ...base,
        kind: "question",
        entry: { title: "只有标题", answer: "有答案" },
      }),
    ).toBeNull();
  });
});

describe("buildDraftCandidate · glossary", () => {
  it("换行分隔的 detail 拆成数组，别名按顿号拆", () => {
    const candidate = buildDraftCandidate({
      ...base,
      kind: "glossary",
      entry: {
        term: "render 阶段",
        en: "Render Phase",
        short: "React 计算要改什么的那一段。",
        detail: "只做 diff，不碰 DOM\n- 不能放副作用",
        aliases: "渲染阶段、render phase",
        domain: "React",
      },
    });

    expect(candidate?.errors).toEqual([]);
    const payload = candidate?.payload as {
      detail: string[];
      aliases: string[];
      domain: string;
    };
    expect(payload.detail).toEqual(["只做 diff，不碰 DOM", "不能放副作用"]);
    expect(payload.aliases).toEqual(["渲染阶段", "render phase"]);
    expect(payload.domain).toBe("react");
  });

  it("没给 detail 时补一句占位，避免结构校验因为空数组判非法", () => {
    const candidate = buildDraftCandidate({
      ...base,
      kind: "glossary",
      entry: { term: "Lane 模型", short: "优先级模型。" },
    });
    expect((candidate?.payload as { detail: string[] }).detail.length).toBeGreaterThan(0);
  });
});

describe("buildDraftCandidate · diagram", () => {
  it("图型与键名原样保留，缺 caption 用标题兜底", () => {
    const candidate = buildDraftCandidate({
      ...base,
      kind: "diagram",
      entry: {
        kind: "flow",
        title: "事件循环",
        nodes: [
          { label: "宏任务", note: "setTimeout" },
          { label: "微任务", note: "Promise.then" },
        ],
      },
    });

    expect(candidate?.errors).toEqual([]);
    const payload = candidate?.payload as { id: string; caption: string };
    expect(payload.id.startsWith("u-d-")).toBe(true);
    expect(payload.caption).toBe("事件循环");
  });
});

describe("extractJsonObject", () => {
  it("能从代码围栏与前后寒暄里抠出对象", () => {
    const text = '好的，结果如下：\n```json\n{"kind":"flow","title":"x"}\n```\n希望对你有帮助';
    expect(extractJsonObject(text)).toEqual({ kind: "flow", title: "x" });
  });

  it("数组或多段 JSON 一律不认（图解只收一个对象）", () => {
    expect(extractJsonObject("[1,2,3]")).toBeNull();
    expect(extractJsonObject("没什么可解析的")).toBeNull();
  });
});
