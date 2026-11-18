import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ElectronAPI, InterviewItemDetailDTO } from "@/shared/types/electron";
import { QUESTION_BANK } from "../data/interview-bank";
import { DIAGRAMS } from "../data/interview-diagrams";
import { GLOSSARY_TERMS } from "../data/interview-glossary";
import { useInterviewBank } from "./useInterviewBank";

/**
 * 合并视图 hook 的四条回落路径（T06-A 的核心可感知要求）。
 *
 * 这一层的断言都围着同一句话：**未登录 / 库没就绪 / 通道报错 / 数据全脏时，
 * 题库页必须仍然完整可用（基线 243 题）**。所以每条失败路径都要验两件事：
 * ① 数据等于基线（不是空）；② `error` 里有原因（供后续 UI 提示）。
 *
 * 唯一「不该报错」的失败路径是「库里本来就没有增量」（未登录返回 `[]`）：
 * 那是正常状态，报了反而会让用户以为坏库了。
 */
const NEW_QUESTION_PAYLOAD = {
  id: "u-q-t06a",
  title: "T06-A 演示题：合并视图接线",
  stem: "这道题来自本地库，不在源码基线里。",
  answer: "因为合并视图把库内增量叠在了基线之上。",
  track: "foundation",
  categoryId: "foundation-js",
  difficulty: "medium",
  tags: ["合并视图"],
  topic: "题库增量",
  reviewedAt: "2026-01",
  heat: 60,
  updatedAt: "2026-02-01",
};

/** 装一份（不完整的）`window.electronAPI.interview` 桩 */
function mountInterviewApi(interview: Partial<ElectronAPI["interview"]>): void {
  Object.defineProperty(window, "electronAPI", {
    writable: true,
    configurable: true,
    value: { interview } as unknown as ElectronAPI,
  });
}

/** 一条「用户新建的题」DTO（action=new 且 id 带 u- 前缀，才会进合并结果） */
function makeNewQuestionItem(
  overrides: Partial<InterviewItemDetailDTO> = {},
): InterviewItemDetailDTO {
  return {
    id: "u-q-t06a",
    kind: "question",
    action: "new",
    baseId: null,
    status: "adopted",
    origin: "manual",
    categoryId: "foundation-js",
    track: "foundation",
    title: NEW_QUESTION_PAYLOAD.title,
    errors: [],
    updatedAt: 1_760_000_000_000,
    payload: { ...NEW_QUESTION_PAYLOAD },
    sourceIntent: null,
    aiLogId: null,
    baseStamp: null,
    baseHash: null,
    ackBaseHash: null,
    reviewedAt: null,
    createdAt: 1_760_000_000_000,
    deletedAt: null,
    ...overrides,
  };
}

const BASELINE_QUESTION_IDS = QUESTION_BANK.map((question) => question.id);

describe("useInterviewBank", () => {
  afterEach(() => {
    cleanup();
    window.electronAPI = undefined;
  });

  it("首帧立刻是基线（不会先渲染空数组），IPC 回来后才换成合并结果", async () => {
    let release!: (items: InterviewItemDetailDTO[]) => void;
    const pending = new Promise<InterviewItemDetailDTO[]>((resolve) => {
      release = resolve;
    });
    mountInterviewApi({ itemsList: vi.fn(() => pending) as never });

    const { result } = renderHook(() => useInterviewBank());

    // 一个 await 都没让出去：此刻必须已经有题，否则页面会闪一下「没有题目」
    expect(result.current.questions).toHaveLength(QUESTION_BANK.length);
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();

    await act(async () => {
      release([makeNewQuestionItem()]);
      await pending;
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.questions).toHaveLength(QUESTION_BANK.length + 1);
    expect(result.current.error).toBeNull();
  });

  it("① 正常返回增量：题目变多且含新题，词条 / 图解映射可查", async () => {
    mountInterviewApi({
      itemsList: vi.fn(async () => [makeNewQuestionItem()]) as never,
    });

    const { result } = renderHook(() => useInterviewBank());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.questions).toHaveLength(QUESTION_BANK.length + 1);
    expect(result.current.questions.some((question) => question.id === "u-q-t06a")).toBe(true);
    expect(result.current.error).toBeNull();

    // 没有增量时词条 / 图解就是基线：这两条是「首帧就有名词可点、有图可看」的保证
    expect(result.current.glossary).toHaveLength(GLOSSARY_TERMS.length);
    expect(result.current.diagramsById[DIAGRAMS[0].id]).toBe(DIAGRAMS[0]);
    expect(result.current.glossaryIndex.byId(GLOSSARY_TERMS[0].id)).toBe(GLOSSARY_TERMS[0]);
    expect(result.current.categories.length).toBeGreaterThan(0);
  });

  it("② itemsList reject：回落到基线 + error 有人话原因，不抛", async () => {
    mountInterviewApi({
      itemsList: vi.fn(async () => {
        throw new Error("database is locked");
      }) as never,
    });

    const { result } = renderHook(() => useInterviewBank());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.questions.map((question) => question.id)).toEqual(
      BASELINE_QUESTION_IDS,
    );
    expect(result.current.error).toContain("读取本地题库失败");
    // 具体原因要带出来，否则用户/我们都没法定位
    expect(result.current.error).toContain("database is locked");
  });

  it("③ 未登录返回空数组：等于基线，error 为 null（空库不是错误）", async () => {
    mountInterviewApi({ itemsList: vi.fn(async () => []) as never });

    const { result } = renderHook(() => useInterviewBank());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.questions.map((question) => question.id)).toEqual(
      BASELINE_QUESTION_IDS,
    );
    expect(result.current.error).toBeNull();
  });

  it("④ window.electronAPI 不存在（jsdom / 纯浏览器）：等于基线、不抛", () => {
    // 不装桩：模拟测试环境与「浏览器直接开 dev server」
    const { result } = renderHook(() => useInterviewBank());

    // 这条路径是同步回落的，连一个微任务都不等
    expect(result.current.loading).toBe(false);
    expect(result.current.questions.map((question) => question.id)).toEqual(
      BASELINE_QUESTION_IDS,
    );
    expect(result.current.error).toContain("本地题库通道");
  });

  it("④ 补充：行全是脏数据（action 不可识别）时同样回落基线并说明跳过条数", async () => {
    mountInterviewApi({
      itemsList: vi.fn(async () => [
        makeNewQuestionItem({ id: "js-event-loop", action: "baseline" }),
      ]) as never,
    });

    const { result } = renderHook(() => useInterviewBank());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.questions.map((question) => question.id)).toEqual(
      BASELINE_QUESTION_IDS,
    );
    expect(result.current.error).toContain("1 条记录格式无法识别");
  });

  it("⑤ reload() 后能拿到新数据", async () => {
    mountInterviewApi({
      itemsList: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([makeNewQuestionItem()]) as never,
    });

    const { result } = renderHook(() => useInterviewBank());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.questions).toHaveLength(QUESTION_BANK.length);

    await act(async () => {
      result.current.reload();
    });

    await waitFor(() =>
      expect(result.current.questions).toHaveLength(QUESTION_BANK.length + 1),
    );
    expect(result.current.questions.some((question) => question.id === "u-q-t06a")).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it("卸载后回来的响应不再 setState（不产生 act 警告、不泄漏）", async () => {
    let release!: (items: InterviewItemDetailDTO[]) => void;
    const pending = new Promise<InterviewItemDetailDTO[]>((resolve) => {
      release = resolve;
    });
    const itemsList = vi.fn(() => pending);
    mountInterviewApi({ itemsList: itemsList as never });

    const { unmount } = renderHook(() => useInterviewBank());
    unmount();

    // 组件已卸载：这条 resolve 之后不许再有任何 setState（React 会报 remount 警告）
    await act(async () => {
      release([makeNewQuestionItem()]);
      await pending;
      await Promise.resolve();
    });
  });
});
