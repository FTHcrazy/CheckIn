import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CATEGORIES } from "../../data/interview-taxonomy";
import { buildDraftCandidate, type DraftCandidate, type UseInterviewAiResult } from "../../hooks/useInterviewAi";
import AiDraftDrawer from "./index";

/**
 * AI 候选预览的装配测试。
 *
 * 这条是实机缺陷的回归：候选只显示标题时，用户只能凭标题判断「答案对不对」，
 * 等于没有预览。三类产物必须各自把内容摊开 —— 题干 / 参考答案、定义 / 细则、
 * 以及真的把图画出来。
 */
const base = {
  categoryId: "foundation-react",
  track: "foundation" as const,
  difficulty: "medium" as const,
};

function candidateOf(
  kind: "question" | "glossary" | "diagram",
  entry: Record<string, unknown>,
): DraftCandidate {
  const candidate = buildDraftCandidate({ ...base, kind, entry });
  if (!candidate) throw new Error("测试数据构造失败");
  return candidate;
}

function makeAi(candidates: DraftCandidate[]): UseInterviewAiResult {
  return {
    available: true,
    hidden: false,
    loading: false,
    unavailableText: "",
    generating: false,
    error: null,
    candidates,
    usedFallback: false,
    generate: async () => undefined,
    adopt: async () => true,
    adoptingKey: null,
    discard: () => undefined,
    reset: () => undefined,
    explain: { loading: false, text: null, error: null },
    askExplain: async () => undefined,
    clearExplain: () => undefined,
  };
}

function renderWith(candidates: DraftCandidate[]): void {
  render(
    <AiDraftDrawer
      open
      prefill={{ kind: "question" }}
      categories={CATEGORIES}
      ai={makeAi(candidates)}
      onClose={() => undefined}
    />,
  );
}

describe("AiDraftDrawer 候选预览", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("题目：题干直接可见，参考答案默认折叠、点开才出现", () => {
    renderWith([
      candidateOf("question", {
        title: "StrictMode 下 useEffect 为什么执行两次",
        stem: "开发环境里副作用跑了两遍，是 bug 吗？",
        answer: "不是 bug：开发环境故意多跑一次以暴露副作用。",
        tags: "StrictMode、副作用",
      }),
    ]);

    expect(screen.getByText("开发环境里副作用跑了两遍，是 bug 吗？")).not.toBeNull();
    expect(screen.queryByText(/不是 bug/)).toBeNull();

    fireEvent.click(screen.getByText("查看参考答案"));
    expect(screen.getByText(/不是 bug/)).not.toBeNull();
  });

  it("词条：一句话定义、细节与别名都在预览里", () => {
    renderWith([
      candidateOf("glossary", {
        term: "render 阶段",
        en: "Render Phase",
        short: "React 计算要改什么的那一段。",
        detail: "只做 diff，不碰 DOM\n不能放副作用",
        aliases: "渲染阶段",
      }),
    ]);

    expect(screen.getByText("React 计算要改什么的那一段。")).not.toBeNull();
    expect(screen.getByText("只做 diff，不碰 DOM")).not.toBeNull();
    expect(screen.getByText(/别名：渲染阶段/)).not.toBeNull();
  });

  it("图解：结构合法就直接画出来（不是只显示标题）", () => {
    renderWith([
      candidateOf("diagram", {
        kind: "flow",
        title: "事件循环",
        nodes: [
          { label: "宏任务", note: "setTimeout" },
          { label: "微任务", note: "Promise.then" },
        ],
      }),
    ]);

    expect(screen.getByText("宏任务")).not.toBeNull();
    expect(screen.getByText("微任务")).not.toBeNull();
  });

  it("校验失败时给出红字并禁用采纳，同时提示画不出来", () => {
    // 缺 label 的分类建议不是这里的场景：直接造一个结构不完整的图解
    renderWith([
      {
        key: "bad",
        kind: "diagram",
        title: "缺节点的图",
        payload: { id: "u-d-bad", kind: "flow", title: "缺节点的图", caption: "只有一句说明" },
        errors: ["流程节点必须是非空列表"],
      },
    ]);

    expect(screen.getByText("流程节点必须是非空列表")).not.toBeNull();
    expect(screen.getByText(/画不出来/)).not.toBeNull();
    const adopt = screen.getByRole("button", { name: "采纳进题库" }) as HTMLButtonElement;
    expect(adopt.disabled).toBe(true);
  });

  it("采纳成功后给回执，并点名正文里被点亮的那段原文", async () => {
    const candidate = buildDraftCandidate({
      ...base,
      kind: "glossary",
      entry: { term: "Webpack Loader", short: "把源文件转成模块的函数。", detail: "串行执行" },
      anchor: "loader",
    });
    render(
      <AiDraftDrawer
        open
        // 划词进来时种子就是划中的原文
        prefill={{ kind: "glossary", seed: "loader" }}
        categories={CATEGORIES}
        ai={makeAi([candidate!])}
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "采纳进题库" }));

    // 候选立刻从列表消失，回执是用户唯一能确认「真的进去了」的东西
    expect(await screen.findByText(/已采纳「Webpack Loader」/)).not.toBeNull();
    expect(screen.getByText(/正文里的「loader」现在也能点开/)).not.toBeNull();
  });
});
