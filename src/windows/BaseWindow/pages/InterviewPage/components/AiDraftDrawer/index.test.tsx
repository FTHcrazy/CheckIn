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

function makeAi(
  candidates: DraftCandidate[],
  adoptMany?: UseInterviewAiResult["adoptMany"],
): UseInterviewAiResult {
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
    adoptMany: adoptMany ?? (async (list) => ({ ok: list.map((item) => item.key), failed: [] })),
    adoptingKey: null,
    discard: () => undefined,
    reset: () => undefined,
    explain: { loading: false, text: null, error: null },
    askExplain: async () => undefined,
    clearExplain: () => undefined,
  };
}

function renderWith(candidates: DraftCandidate[], adoptMany?: UseInterviewAiResult["adoptMany"]): void {
  render(
    <AiDraftDrawer
      open
      prefill={{ kind: "question" }}
      categories={CATEGORIES}
      ai={makeAi(candidates, adoptMany)}
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

describe("AiDraftDrawer 批量采纳", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  const three = (): DraftCandidate[] => [
    candidateOf("question", {
      title: "事件循环里的宏任务",
      stem: "setTimeout 与 Promise.then 谁先跑？",
      answer: "微任务先跑完再进下一个宏任务。",
    }),
    candidateOf("question", {
      title: "useEffect 的清理时机",
      stem: "依赖变化时清理函数什么时候执行？",
      answer: "在下一次副作用执行之前。",
    }),
    candidateOf("question", {
      title: "闭包为什么能记住变量",
      stem: "闭包保留的是值还是引用？",
      answer: "保留的是词法环境里的绑定。",
    }),
  ];

  it("全选后一次写入全部可采纳的候选，回执点名条数", async () => {
    const batches: string[][] = [];
    renderWith(three(), async (list) => {
      batches.push(list.map((item) => item.title));
      return { ok: list.map((item) => item.key), failed: [] };
    });

    fireEvent.click(screen.getByRole("checkbox", { name: /全选可采纳（3）/ }));
    expect(screen.getByText("已选 3 条，一次写进题库")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "采纳所选 3 条" }));

    expect(await screen.findByText(/已采纳 3 条（「事件循环里的宏任务」等）/)).not.toBeNull();
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
  });

  it("结构校验不过的候选不给勾选，也不进全选", () => {
    const invalid: DraftCandidate = {
      key: "bad",
      kind: "diagram",
      title: "缺节点的图",
      payload: { id: "u-d-bad", kind: "flow", title: "缺节点的图", caption: "只有一句说明" },
      errors: ["流程节点必须是非空列表"],
    };
    renderWith([...three(), invalid]);

    // 四条里只有三条能采纳：全选文案跟着可采纳数走
    const all = screen.getByRole("checkbox", {
      name: /全选可采纳（3）/,
    }) as HTMLInputElement;
    const badPick = screen.getByRole("checkbox", {
      name: "选择「缺节点的图」",
    }) as HTMLInputElement;
    expect(badPick.disabled).toBe(true);

    fireEvent.click(all);
    expect(all.checked).toBe(true);
    expect(badPick.checked).toBe(false);
  });

  it("部分失败时失败项留在列表里，回执给出标题与原因", async () => {
    const list = three();
    renderWith(list, async (targets) => ({
      ok: [targets[0].key],
      failed: [
        { key: targets[1].key, title: targets[1].title, reason: "写入失败：库被占用" },
        { key: targets[2].key, title: targets[2].title, reason: "写入失败：库被占用" },
      ],
    }));

    fireEvent.click(screen.getByRole("checkbox", { name: /全选可采纳（3）/ }));
    fireEvent.click(screen.getByRole("button", { name: "采纳所选 3 条" }));

    expect(await screen.findByText(/已采纳「事件循环里的宏任务」/)).not.toBeNull();
    expect(screen.getByText(/2 条没写进去/)).not.toBeNull();
    expect(screen.getByText(/useEffect 的清理时机（写入失败：库被占用）/)).not.toBeNull();
  });
});
