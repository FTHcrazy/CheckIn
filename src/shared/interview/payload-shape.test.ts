import { describe, expect, it } from "vitest";
import {
  DIAGRAM_KINDS,
  INTERVIEW_KINDS,
  QUESTION_DIFFICULTIES,
  QUESTION_TRACKS,
  SHAPE_LIMITS,
  isValidDiagramShape,
  isValidGlossaryShape,
  isValidQuestionShape,
  validatePayloadShape,
  type QuestionShape,
} from "./payload-shape";

/** 一道最小合法题（各用例只覆盖自己关心的字段） */
function question(overrides: Partial<Record<keyof QuestionShape, unknown>> = {}): unknown {
  return {
    id: "u-q-test",
    title: "事件循环里微任务什么时候清空",
    stem: "说说微任务与宏任务的执行顺序。",
    answer: "每轮宏任务结束后清空一次微任务队列。",
    track: "foundation",
    categoryId: "foundation-js",
    difficulty: "medium",
    tags: ["事件循环"],
    topic: "JS 运行机制",
    reviewedAt: "2026-01",
    heat: 50,
    updatedAt: "2026-01-15",
    ...overrides,
  };
}

describe("题目结构校验", () => {
  it("最小合法题通过，并把缺省数组补成空数组", () => {
    const result = isValidQuestionShape(question());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBe("u-q-test");
      expect(result.value.tags).toEqual(["事件循环"]);
    }
  });

  it("tags 缺失时补空数组而不是报错（新增题允许没标签）", () => {
    const result = isValidQuestionShape(question({ tags: undefined }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.tags).toEqual([]);
  });

  it("缺标题报人话错误", () => {
    const result = isValidQuestionShape(question({ title: "   " }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("题目标题不能为空");
  });

  it("标题是对象而不是文本时报错", () => {
    const result = isValidQuestionShape(question({ title: { text: "x" } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("题目标题必须是文本");
  });

  it("标题里混入 JSON 结构字符判为解析残片", () => {
    const result = isValidQuestionShape(question({ title: '{"title": "事件循环"}' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toContain("JSON 结构字符");
  });

  it("答案里出现代码块的花括号不被误杀（题干/答案允许代码）", () => {
    const result = isValidQuestionShape(
      question({ answer: "```js\nfunction f() { return { a: 1 } }\n```\n先声明再调用。" }),
    );
    expect(result.ok).toBe(true);
  });

  it("字段被 String(obj) 硬拼成 [object Object] 时拦下", () => {
    const result = isValidQuestionShape(question({ topic: "[object Object]" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toContain("内容已损坏");
  });

  it("标签超量与单项超长都报错", () => {
    const tooMany = isValidQuestionShape(
      question({ tags: Array.from({ length: SHAPE_LIMITS.question.tags + 1 }, () => "t") }),
    );
    expect(tooMany.ok).toBe(false);
    const tooLong = isValidQuestionShape(question({ tags: ["x".repeat(SHAPE_LIMITS.question.tag + 1)] }));
    expect(tooLong.ok).toBe(false);
  });

  it("热度只接受 0~100 的整数", () => {
    for (const heat of [101, -1, 12.5, "abc"]) {
      const result = isValidQuestionShape(question({ heat }));
      expect(result.ok, `heat=${String(heat)} 应被拒`).toBe(false);
    }
  });

  it("轨道与难度只接受白名单值", () => {
    expect(isValidQuestionShape(question({ track: "novel" })).ok).toBe(false);
    expect(isValidQuestionShape(question({ difficulty: "expert" })).ok).toBe(false);
    for (const track of QUESTION_TRACKS) {
      expect(isValidQuestionShape(question({ track })).ok).toBe(true);
    }
    for (const difficulty of QUESTION_DIFFICULTIES) {
      expect(isValidQuestionShape(question({ difficulty })).ok).toBe(true);
    }
  });

  it("分类只查非空，不查白名单（新增分类 u-c-* 必须放行）", () => {
    expect(isValidQuestionShape(question({ categoryId: "u-c-webgl" })).ok).toBe(true);
    expect(isValidQuestionShape(question({ categoryId: "" })).ok).toBe(false);
  });

  it("出处残缺时整块丢弃而不是拼出半个对象", () => {
    const noLabel = isValidQuestionShape(question({ source: { url: "https://example.com" } }));
    expect(noLabel.ok).toBe(false);
    const ok = isValidQuestionShape(
      question({ source: { label: "MDN", url: "https://developer.mozilla.org" } }),
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.value.source).toEqual({ label: "MDN", url: "https://developer.mozilla.org" });
  });

  it("非对象输入直接判非法", () => {
    for (const bad of [null, undefined, "text", 42, [1, 2]]) {
      expect(isValidQuestionShape(bad).ok).toBe(false);
    }
  });
});

describe("词条结构校验", () => {
  function glossary(overrides: Record<string, unknown> = {}): unknown {
    return {
      id: "u-g-clone",
      term: "结构化克隆",
      domain: "javascript",
      short: "把对象深拷贝一份，函数与原型链不跟着走。",
      detail: ["不可克隆的字段会直接抛 DataCloneError。"],
      ...overrides,
    };
  }

  it("最小合法词条通过", () => {
    const result = isValidGlossaryShape(glossary());
    expect(result.ok).toBe(true);
  });

  it("展开细节为空是错的（弹层里会只剩一句话定义）", () => {
    const result = isValidGlossaryShape(glossary({ detail: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("展开细节不能为空");
  });

  it("一句话定义超过 80 字报错并说清上限", () => {
    const result = isValidGlossaryShape(glossary({ short: "长".repeat(81) }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join()).toContain(`上限 ${SHAPE_LIMITS.glossary.short} 字`);
  });

  it("词条名只查非空与长度，域集合属领域层", () => {
    expect(isValidGlossaryShape(glossary({ domain: "webgl" })).ok).toBe(true);
    expect(isValidGlossaryShape(glossary({ term: "" })).ok).toBe(false);
  });

  it("别名与相关词条是可选列表，空数组不回填", () => {
    const result = isValidGlossaryShape(glossary({ aliases: [], related: [] }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.aliases).toBeUndefined();
      expect(result.value.related).toBeUndefined();
    }
  });
});

describe("图解结构校验", () => {
  function flow(overrides: Record<string, unknown> = {}): unknown {
    return {
      id: "u-d-flow",
      kind: "flow",
      title: "一次 AI 出题走到落库",
      caption: "从划词到入库的六步。",
      nodes: [
        { label: "划词", note: "选中文本" },
        { label: "出题", tone: "primary" },
      ],
      ...overrides,
    };
  }

  it("合法流程图通过", () => {
    const result = isValidDiagramShape(flow());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.nodes).toHaveLength(2);
  });

  it("图型只接受四种", () => {
    expect(isValidDiagramShape(flow({ kind: "pie" })).ok).toBe(false);
    expect(DIAGRAM_KINDS).toEqual(["flow", "timeline", "compare", "layers"]);
  });

  it("流程图缺 nodes 或只有 1 个节点都判非法", () => {
    expect(isValidDiagramShape(flow({ nodes: undefined })).ok).toBe(false);
    expect(isValidDiagramShape(flow({ nodes: [{ label: "只有一步" }] })).ok).toBe(false);
  });

  it("时序图用 title / detail 键，用 label 会报缺文字", () => {
    const ok = isValidDiagramShape({
      id: "u-d-tl",
      kind: "timeline",
      title: "TCP 三次握手",
      caption: "谁先发谁后发。",
      events: [
        { title: "SYN", detail: "客户端发起" },
        { title: "SYN+ACK" },
      ],
    });
    expect(ok.ok).toBe(true);
    const bad = isValidDiagramShape({
      id: "u-d-tl2",
      kind: "timeline",
      title: "x",
      caption: "y",
      events: [{ label: "SYN" }, { label: "ACK" }],
    });
    expect(bad.ok).toBe(false);
  });

  it("对照图缺一侧就判非法（半个对照没有意义）", () => {
    const result = isValidDiagramShape({
      id: "u-d-cmp",
      kind: "compare",
      title: "Map 版与链表版",
      caption: "对照看。",
      left: { title: "Map", items: ["O(1) 查询"] },
    });
    expect(result.ok).toBe(false);
  });

  it("分层图少于 2 层判非法", () => {
    const result = isValidDiagramShape({
      id: "u-d-ly",
      kind: "layers",
      title: "进程分层",
      caption: "上下关系。",
      layers: [{ label: "主进程" }],
    });
    expect(result.ok).toBe(false);
  });

  it("步骤与易错提示是可选段", () => {
    const result = isValidDiagramShape(flow({ steps: ["先划词", "再出题"], note: "别在当前题上改" }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.steps).toEqual(["先划词", "再出题"]);
      expect(result.value.note).toBe("别在当前题上改");
    }
  });
});

describe("按类型分发", () => {
  it("三种类型各自路由", () => {
    expect(validatePayloadShape("question", question()).ok).toBe(true);
    expect(
      validatePayloadShape("glossary", {
        id: "u-g-x",
        term: "队头阻塞",
        domain: "network",
        short: "前一个请求慢，后面的全等着。",
        detail: ["HTTP/1.1 的六连接限制会放大这个问题。"],
      }).ok,
    ).toBe(true);
  });

  it("未知类型返回人话错误而不是抛异常", () => {
    const result = validatePayloadShape("ledger" as never, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("未知的产物类型");
  });

  it("类型清单与分发覆盖一致", () => {
    for (const kind of INTERVIEW_KINDS) {
      const result = validatePayloadShape(kind, null);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]).not.toContain("未知的产物类型");
    }
  });
});
