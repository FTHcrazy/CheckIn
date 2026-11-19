import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  aiGenerateStructured,
  getAiConfig,
  logAiEvent,
  saveAiConfig,
} from "@/shared/ai/ai-client";
import type { BookSnapshot } from "@/shared/ai/context";
import {
  createConsistencyScanner,
  type ConsistencyIssue,
} from "@/shared/novel/consistency";
import { useConsistencyStore } from "../store/useConsistencyStore";
import { useConsistencyAi, type UseConsistencyAiOptions, type UseConsistencyAiResult } from "./useConsistencyAi";

/**
 * 一致性 AI 复核（R-AI-10b）
 *
 * 这一层钉的是**边界**，不是文案：
 * - 只送 `suspect` 级（`sure` 级一个字节都不许进 prompt，更不许被 AI 推翻）；
 * - 只认白名单里的名字，编造的名字丢弃并如实计数；
 * - 判定必须是三态之一，否则丢弃；
 * - 采纳只对「错字」开放，且采纳不等于改正文。
 *
 * 10a 的判据（`@/shared/novel/consistency`）本用例一行都不碰：它只负责产出
 * `ConsistencyIssue`，AI 档在它之上加一列建议。
 */
vi.mock("@/shared/ai/ai-client", () => ({
  aiGenerateStructured: vi.fn(),
  getAiConfig: vi.fn(),
  saveAiConfig: vi.fn(),
  logAiEvent: vi.fn(),
}));

/** 造一条 10a 的产物：字段与 `ConsistencyIssue` 一致，本用例不解释它们的来源 */
function makeIssue(overrides: Partial<ConsistencyIssue> = {}): ConsistencyIssue {
  return {
    id: "issue-1",
    kind: "name-near-miss",
    severity: "suspect",
    chapterId: "c1",
    chapterTitle: "第一章 山门",
    found: "林轩",
    expected: "林轩儿",
    expectedLabel: "人物",
    count: 2,
    from: 12,
    evidence: "林轩提剑而立，林轩看了一眼山门。",
    suggestion: "确认为「林轩儿」",
    ...overrides,
  };
}

const SNAPSHOT: BookSnapshot = {
  workName: "剑起山门",
  entities: [{ type: "character", name: "林轩儿", aliases: ["轩儿"] }],
};

function buildOptions(overrides: Partial<UseConsistencyAiOptions> = {}): UseConsistencyAiOptions {
  return {
    issues: [makeIssue()],
    knownNames: ["林轩儿", "轩儿"],
    snapshot: SNAPSHOT,
    notify: vi.fn(),
    ...overrides,
  };
}

/** 让 `useAiConsent` 读到「已授权 / 未授权」 */
function grantL3(enabled: boolean): void {
  vi.mocked(getAiConfig).mockResolvedValue({ provider: "openai", l3Enabled: enabled } as never);
  vi.mocked(saveAiConfig).mockResolvedValue({ ok: true } as never);
}

/** 结构化通道的返回值：entries 的键取自 `CONSISTENCY_OUTPUT_FORMAT` */
function replyEntries(
  entries: Array<{ expected?: string; candidate?: string; verdict?: string; reason?: string }>,
) {
  vi.mocked(aiGenerateStructured).mockResolvedValue({
    ok: true,
    data: { text: "", usedFallback: false, entries },
  } as never);
}

/**
 * 点「AI 复核」并跑到终态。
 *
 * `useAiConsent` 的配置是在 effect 里异步读进来的，读到之前 `l3Enabled` 恒为
 * false —— 直接点按钮会误走授权弹窗。所以先让微任务清空；万一仍进了弹窗
 * （正是「未授权」用例的真实路径），就照用户的真实操作确认一次。
 */
async function runNow(result: { current: UseConsistencyAiResult }): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    result.current.requestRun();
  });
  if (result.current.consentPending) {
    await act(async () => {
      await result.current.confirmConsent();
    });
  }
  await waitFor(() => expect(["done", "error"]).toContain(result.current.status));
}

describe("useConsistencyAi", () => {
  beforeEach(() => {
    useConsistencyStore.getState().clearAi();
  });

  afterEach(() => {
    vi.mocked(aiGenerateStructured).mockReset();
    vi.mocked(getAiConfig).mockReset();
    vi.mocked(saveAiConfig).mockReset();
    vi.mocked(logAiEvent).mockReset();
  });

  it("只有 suspect 级进输入集：sure 级不进 prompt（10a 的判据不许被 AI 碰）", async () => {
    grantL3(true);
    replyEntries([
      { expected: "林轩儿", candidate: "林轩", verdict: "错字", reason: "漏字" },
    ]);

    const issues = [
      makeIssue({ id: "s1", severity: "suspect" }),
      makeIssue({ id: "u1", severity: "sure", found: "林轩儿儿" }),
    ];
    const { result } = renderHook(() => useConsistencyAi(buildOptions({ issues })));

    expect(result.current.suspects.map((item) => item.candidate)).toEqual(["林轩"]);

    await runNow(result);
    expect(result.current.status).toBe("done");

    // 疑似条目排在 system 里（本意图的 prompt 主体只有一句收尾指令）
    const system = vi.mocked(aiGenerateStructured).mock.calls[0][0].system;
    expect(system).toContain("疑似「林轩儿」被写成了「林轩」");
    // sure 级那一条（found = 「林轩儿儿」）不该出现在 prompt 里
    expect(system).not.toContain("林轩儿儿");
  });

  it("编造的名字（不在 knownNames）丢弃并如实计数", async () => {
    grantL3(true);
    replyEntries([
      { expected: "林轩儿", candidate: "林轩", verdict: "错字", reason: "漏字" },
      { expected: "欧阳锋", candidate: "欧阳丰", verdict: "错字", reason: "编的" },
    ]);
    const notify = vi.fn();
    const { result } = renderHook(() => useConsistencyAi(buildOptions({ notify })));

    await runNow(result);

    expect(Object.keys(result.current.verdicts)).toEqual(["issue-1"]);
    expect(result.current.dropped).toBe(1);
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("1 条判定被丢弃"),
      "info",
    );
  });

  it("判定不是三态之一 / 对不上条目 → 都算丢弃", async () => {
    grantL3(true);
    replyEntries([
      { expected: "林轩儿", candidate: "林轩", verdict: "可能吧", reason: "含糊" },
      { expected: "林轩儿", candidate: "查无此人", verdict: "错字", reason: "对不上" },
    ]);
    const { result } = renderHook(() => useConsistencyAi(buildOptions()));

    await runNow(result);
    // 两条都被丢光 → 走 error，而不是留一张空白的「已完成」
    expect(result.current.status).toBe("error");
    expect(result.current.error).toContain("没有给出可用的判定");
  });

  it("采纳只对「错字」开放：另两态（意思是别改）勾不动", async () => {
    grantL3(true);
    replyEntries([
      { expected: "林轩儿", candidate: "林轩", verdict: "错字", reason: "漏字" },
      { expected: "轩儿", candidate: "林轩", verdict: "同形异名", reason: "可能是称呼" },
    ]);
    const issues = [
      makeIssue({ id: "t1" }),
      makeIssue({ id: "t2", expected: "轩儿", found: "林轩" }),
    ];
    const { result } = renderHook(() =>
      useConsistencyAi(buildOptions({ issues, knownNames: ["林轩儿", "轩儿"] })),
    );

    await runNow(result);
    expect(result.current.status).toBe("done");

    act(() => result.current.toggleAdopt("t1"));
    act(() => result.current.toggleAdopt("t2"));
    expect(result.current.adopted).toEqual(["t1"]);

    // 再点一次 = 取消勾选
    act(() => result.current.toggleAdopt("t1"));
    expect(result.current.adopted).toEqual([]);
  });

  it("未授权：点按钮只弹授权、不发请求；确认后才真的跑", async () => {
    grantL3(false);
    replyEntries([
      { expected: "林轩儿", candidate: "林轩", verdict: "错字", reason: "漏字" },
    ]);
    const { result } = renderHook(() => useConsistencyAi(buildOptions()));

    // 等配置读进来（读到的是 l3Enabled=false），再走「点按钮 → 弹授权」的真实路径
    await act(async () => {
      await Promise.resolve();
    });

    act(() => result.current.requestRun());
    expect(result.current.consentPending).toBe(true);
    expect(aiGenerateStructured).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.confirmConsent();
    });
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(vi.mocked(saveAiConfig).mock.calls[0][0]).toEqual({ l3Enabled: true });
    expect(aiGenerateStructured).toHaveBeenCalledTimes(1);
  });

  it("取消授权：记一条 cancel 事件，不发请求", async () => {
    grantL3(false);
    const { result } = renderHook(() => useConsistencyAi(buildOptions()));

    act(() => result.current.requestRun());
    act(() => result.current.cancelConsent());

    expect(result.current.consentPending).toBe(false);
    expect(aiGenerateStructured).not.toHaveBeenCalled();
    expect(vi.mocked(logAiEvent).mock.calls[0][0]).toMatchObject({
      intent: "consistency",
      step: "cancel",
    });
  });

  it("没有 suspect 级条目：canRun=false，按钮点了也不发请求", () => {
    grantL3(true);
    const notify = vi.fn();
    const { result } = renderHook(() =>
      useConsistencyAi(
        buildOptions({
          issues: [makeIssue({ severity: "sure" })],
          notify,
        }),
      ),
    );

    expect(result.current.canRun).toBe(false);
    expect(result.current.estimate.notice).toContain("没有「疑似」级条目");

    act(() => result.current.requestRun());
    expect(aiGenerateStructured).not.toHaveBeenCalled();
  });

  it("估算口径与实发同源：按送出去的片段字数算", async () => {
    grantL3(true);
    const issues = [
      makeIssue({ id: "a", evidence: "一二三四五" }),
      makeIssue({ id: "b", evidence: "六七八" }),
    ];
    const { result } = renderHook(() => useConsistencyAi(buildOptions({ issues })));

    // 两条片段按换行拼起来 → 5 + 1（换行）+ 3 = 9 个字符
    expect(result.current.estimate.chars).toBe(9);
    expect(result.current.estimate.tokens).toBeGreaterThan(0);
  });

  /**
   * 守卫（架构 §3.1 / §9 第 2 条）：2.15.1 修掉的两类误报——「碎片源整组」与
   * 「数字替换」——不许出现在 AI 复核的输入集里。
   *
   * 这条用例跑的是**真的 10a 扫描器**，不是手搓的 issue：只有从正文一路走到
   * 输入集，才能证明 AI 档没有绕过 10a 的过滤去「重判」历史误报。
   */
  it("2.15.1 的两类误报（碎片源整组 / 数字替换）不出现在 AI 输入集里", () => {
    grantL3(true);
    const scanner = createConsistencyScanner({
      entities: [
        { id: "e1", name: "布偶", type: "item", aliases: [] },
        { id: "e2", name: "第二病栋", type: "location", aliases: [] },
        // 对照项：这一条**是**该进 AI 输入集的真疑似，用来证明管道是活的
        { id: "e3", name: "林轩儿", type: "character", aliases: [] },
      ],
      realmLevels: [],
    });
    // 布偶 ×3 撑起「正确写法是高频词」，布控 / 布匹 / 布丁 三种写法 ⇒ 碎片源整组
    // 第二病栋 ×3 + 第三病栋 ⇒ 数字对数字，是两个真名
    scanner.scanChapter({
      id: "c1",
      title: "第一章",
      content:
        "布偶在笑。布偶点头。布偶走了。布控没来。布匹很旧。布丁很甜。" +
        "第二病栋很冷。第二病栋很暗。第二病栋有人。第三病栋空着。" +
        "林轩儿来了。林轩儿点头。林轩儿走了。林轩几站着。",
    });
    const issues = scanner.finalize();

    // 10a 侧：这两类根本没被判成问题
    expect(issues.map((item) => item.found)).not.toContain("布控");
    expect(issues.map((item) => item.found)).not.toContain("第三病栋");

    // AI 侧：输入集里只有那条真疑似，两类历史误报一条都没有
    const { result } = renderHook(() => useConsistencyAi(buildOptions({ issues })));
    expect(result.current.suspects.map((item) => item.candidate)).toEqual(["林轩几"]);
  });
});
