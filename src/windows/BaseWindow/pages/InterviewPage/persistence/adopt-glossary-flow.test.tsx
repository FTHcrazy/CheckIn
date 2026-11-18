import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import type {
  ElectronAPI,
  InterviewItemDetailDTO,
  InterviewTaxonomyDTO,
} from "@/shared/types/electron";
import InterviewBankProvider from "../components/InterviewBankProvider";
import { useInterviewBankContext } from "../components/InterviewBankProvider/context";
import TermText from "../components/TermText";
import { buildDraftCandidate, useInterviewAi, type UseInterviewAiResult } from "../hooks/useInterviewAi";
import { useGlossaryAlias, type UseGlossaryAliasResult } from "../hooks/useGlossaryAlias";
import type { GlossaryTerm } from "../data/interview-glossary";

/**
 * 「采纳词条 → 正文里那个词变可点」的端到端回归。
 *
 * 实机反馈过：划词 → 加为词条 → 采纳，正文里划中的那个词仍然是死文字。
 * 这条链路横跨四层（写库 → 重读 → 合并 → 重建匹配器 → 重渲染），任何一层
 * 掉链子都只表现为「不亮」，所以这里用一份内存库把整条链跑通：
 *
 * 1. `itemSave(new, adopted)` 写行；
 * 2. `itemsList({withPayload:true})` 读回来；
 * 3. `mergeInterviewBank` 叠到基线上；
 * 4. `buildGlossaryIndex` 重建匹配器；
 * 5. `TermText` 命中后渲染成按钮。
 */

const LINE = "与 loader 的分工：loader 只做单文件内容转换。";

/** 内存库：只实现本次链路用到的三个通道 */
function makeStore() {
  const rows = new Map<string, InterviewItemDetailDTO>();
  const api = {
    itemsList: vi.fn(async () => [...rows.values()]),
    taxonomyList: vi.fn(async () => [] as InterviewTaxonomyDTO[]),
    // 返回值标注成宽类型：批量采纳的用例要能让其中一条失败（errors 非空）
    itemSave: vi.fn(
      async (payload: Record<string, unknown>): Promise<{ ok: boolean; errors: string[] }> => {
        const id = String(payload.id);
        rows.set(id, {
          id,
          kind: payload.kind as InterviewItemDetailDTO["kind"],
          action: payload.action as "new" | "override",
          baseId: null,
          status: payload.status as string,
          origin: "ai",
          categoryId: (payload.categoryId as string | null) ?? null,
          track: (payload.track as string | null) ?? null,
          title: String(payload.title ?? ""),
          errors: [],
          payload: payload.payload,
          sourceIntent: null,
          aiLogId: null,
          baseStamp: null,
          baseHash: null,
          ackBaseHash: null,
          reviewedAt: null,
          createdAt: 1,
          updatedAt: 1,
          deletedAt: null,
        } as InterviewItemDetailDTO);
        return { ok: true, errors: [] };
      },
    ),
    itemSetStatus: vi.fn(async (id: string, status: string) => {
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, status });
      return { ok: true, errors: [] };
    }),
  };
  return { rows, api };
}

/** 把页面里的两个 hook 实例交给测试：采纳 / 补别名都只在页面里才拿得到 */
interface HarnessApis {
  ai: UseInterviewAiResult;
  alias: UseGlossaryAliasResult;
  glossary: readonly GlossaryTerm[];
}

function Harness({ onReady }: { onReady: (apis: HarnessApis) => void }) {
  const bank = useInterviewBankContext();
  const ai = useInterviewAi({
    categories: bank?.categories ?? [],
    questionTitles: [],
    glossaryTerms: [],
    glossary: bank?.glossary ?? [],
    stats: { questions: 0, glossaries: 0, diagrams: 0 },
    reload: bank?.reload ?? (() => undefined),
  });
  const alias = useGlossaryAlias(bank?.reload ?? (() => undefined));
  useEffect(() => {
    onReady({ ai, alias, glossary: bank?.glossary ?? [] });
  });
  return null;
}

function renderBank(store: ReturnType<typeof makeStore>) {
  Object.defineProperty(window, "electronAPI", {
    writable: true,
    configurable: true,
    value: { interview: store.api } as unknown as ElectronAPI,
  });

  let latest: HarnessApis | null = null;
  render(
    <InterviewBankProvider>
      <TermText text={LINE} />
      <Harness
        onReady={(apis) => {
          latest = apis;
        }}
      />
    </InterviewBankProvider>,
  );
  return { current: () => latest };
}

const CANDIDATE_INPUT = {
  kind: "glossary" as const,
  entry: {
    term: "loader",
    short: "把源文件转成模块的转换函数。",
    detail: "按 test / include / exclude 命中文件后串行执行。",
    domain: "engineering",
  },
  categoryId: "foundation-js",
  track: "foundation" as const,
  difficulty: "medium" as const,
};

describe("采纳词条后正文立刻可点（端到端）", () => {
  afterEach(() => {
    cleanup();
    window.electronAPI = undefined;
  });

  it("采纳一条新词条 → 正文里两处 loader 都变成可点名词", async () => {
    const store = makeStore();
    const ai = renderBank(store);

    await waitFor(() => expect(ai.current()).not.toBeNull());
    // 基线里没有 loader 这个词条，采纳前必须是死文字
    expect(screen.queryAllByRole("button", { name: /名词解释：loader/ })).toHaveLength(0);

    const candidate = buildDraftCandidate(CANDIDATE_INPUT);
    expect(candidate).not.toBeNull();

    await act(async () => {
      await ai.current()?.ai.adopt(candidate!, "adopted");
    });

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /名词解释：loader/ }).length).toBe(2);
    });
  });

  it("模型把词名写成 Webpack Loader：划中的 loader 靠别名兜底，依然可点", async () => {
    const store = makeStore();
    const ai = renderBank(store);
    await waitFor(() => expect(ai.current()).not.toBeNull());

    const candidate = buildDraftCandidate({
      ...CANDIDATE_INPUT,
      entry: { ...CANDIDATE_INPUT.entry, term: "Webpack Loader" },
      anchor: "loader",
    });
    expect(candidate).not.toBeNull();

    await act(async () => {
      await ai.current()?.ai.adopt(candidate!, "adopted");
    });

    // aria-label 跟着词名走（Webpack Loader），但命中的原文是 loader
    await waitFor(() => {
      const chips = screen.getAllByRole("button", { name: /名词解释：Webpack Loader/ });
      expect(chips).toHaveLength(2);
      expect(chips[0].textContent).toBe("loader");
    });
  });

  it("库里已有一条 adopted 词条（重启后再进来）同样可点", async () => {
    const store = makeStore();
    const candidate = buildDraftCandidate(CANDIDATE_INPUT)!;
    await store.api.itemSave({
      id: candidate.payload.id,
      kind: "glossary",
      action: "new",
      status: "adopted",
      payload: candidate.payload,
      categoryId: "foundation-js",
      title: "loader",
    });

    renderBank(store);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /名词解释：loader/ }).length).toBe(2);
    });
  });

  it("库里那条叫 Webpack Loader（修复前采纳的历史数据）：补别名后同样可点", async () => {
    const store = makeStore();
    // 没有 anchor：模拟「原文没被记进别名」的那批旧数据
    const candidate = buildDraftCandidate({
      ...CANDIDATE_INPUT,
      entry: { ...CANDIDATE_INPUT.entry, term: "Webpack Loader" },
    })!;
    await store.api.itemSave({
      id: candidate.payload.id,
      kind: "glossary",
      action: "new",
      status: "adopted",
      payload: candidate.payload,
      categoryId: "foundation-js",
      title: "Webpack Loader",
    });

    const api = renderBank(store);
    await waitFor(() => expect(api.current()).not.toBeNull());
    // 等合并视图把这条读进来（首帧是纯基线，词条还没到）
    await waitFor(() =>
      expect(api.current()?.glossary.some((term) => term.term === "Webpack Loader")).toBe(true),
    );
    expect(screen.queryAllByRole("button", { name: /名词解释/ })).toHaveLength(0);

    const owner = api.current()?.glossary.find((term) => term.term === "Webpack Loader");
    expect(owner).toBeTruthy();

    await act(async () => {
      await api.current()?.alias.append(owner as GlossaryTerm, "loader");
    });

    await waitFor(() => {
      const chips = screen.getAllByRole("button", { name: /名词解释：Webpack Loader/ });
      expect(chips).toHaveLength(2);
      expect(chips[0].textContent).toBe("loader");
    });
  });
});

describe("批量采纳多条", () => {
  afterEach(() => {
    cleanup();
    window.electronAPI = undefined;
  });

  it("逐条写入：中间一条失败不打断后面的，失败项带原因回给调用方", async () => {
    const store = makeStore();
    const ai = renderBank(store);
    await waitFor(() => expect(ai.current()).not.toBeNull());

    const make = (term: string) =>
      buildDraftCandidate({
        kind: "glossary",
        entry: { term, short: `${term} 的一句话定义。`, detail: "细节一条", domain: "engineering" },
        categoryId: "foundation-js",
        track: "foundation",
        difficulty: "medium",
      })!;
    const list = [make("loader"), make("plugin"), make("preset")];

    // 第二条写库失败：批量不能因此把第一、三条也放弃掉
    const realSave = store.api.itemSave.getMockImplementation()!;
    store.api.itemSave.mockImplementation(async (payload: Record<string, unknown>) =>
      String(payload.title) === "plugin"
        ? { ok: false, errors: ["词条键已被占用"] }
        : realSave(payload),
    );

    const result = await act(async () => ai.current()!.ai.adoptMany(list, "adopted"));

    expect(result.ok).toEqual([list[0].key, list[2].key]);
    expect(result.failed).toEqual([
      { key: list[1].key, title: "plugin", reason: "词条键已被占用" },
    ]);
    // 三条都尝试过（失败那条没有短路后面的）
    expect(store.api.itemSave).toHaveBeenCalledTimes(3);
    expect(store.rows.size).toBe(2);
    expect([...store.rows.values()].every((row) => row.status === "adopted")).toBe(true);
  });
});
