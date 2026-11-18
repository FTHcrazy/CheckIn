import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ElectronAPI,
  InterviewMetaDTO,
  InterviewWriteResultDTO,
} from "@/shared/types/electron";
import { QUESTION_BANK } from "../data/interview-bank";
import type { InterviewQuestion } from "../data/interview-types";
import { hashPayload } from "../persistence/interview-hash";
import { useQuestionOverride, type QuestionWriteOutcome } from "./useQuestionOverride";

/**
 * 写通道的守卫（T08-A）。
 *
 * 这套用例的重点不是「有没有调到通道」，而是**调的时候带的参数对不对**：
 * 参数错了不会报错，只会在下一次合并时安静地把题目标成「基线已更新」、
 * 或者让用户改的题从列表里消失。所以每条断言都对着一个具体的退化：
 *
 * - `baseHash` 算成用户版本 → 每次合并都误报「基线已更新」，点「沿用我的」也消不掉；
 * - `id` / `baseId` 不一致 → 主进程直接拒写（"覆盖基线题时 baseId 必须与 id 相同"）；
 * - 墓碑带上 `payload` → 库里同时存在「已删除」与一份可被误读的内容副本；
 * - 成功后不 `reload` → 用户点完「还原默认」看到的还是那道题，以为没生效；
 * - 失败被吞 → 界面只剩「点了没反应」，用户无法自助修正。
 */
type SavePayload = Parameters<ElectronAPI["interview"]["itemSave"]>[0];

/** 基线第一题（真数据；手势构造的样例喂不出真实的 10 字 `updatedAt` 这类细节） */
const BASELINE: InterviewQuestion = QUESTION_BANK[0];

function mountInterviewApi(interview: Partial<ElectronAPI["interview"]>): void {
  Object.defineProperty(window, "electronAPI", {
    writable: true,
    configurable: true,
    value: { interview } as unknown as ElectronAPI,
  });
}

function makeMeta(): InterviewMetaDTO {
  return {
    schemaVersion: 1,
    baselineVersion: "2026-01",
    glossaryVersion: 0,
    lastImportAt: null,
    lastExportAt: null,
  };
}

/** 一个记录入参的 `itemSave` 桩 */
function makeItemSave(result: InterviewWriteResultDTO = { ok: true }) {
  return vi.fn(async (_payload: SavePayload): Promise<InterviewWriteResultDTO> => {
    void _payload;
    return result;
  });
}

describe("useQuestionOverride", () => {
  afterEach(() => {
    cleanup();
    window.electronAPI = undefined;
    vi.restoreAllMocks();
  });

  it("① 保存基线题：baseHash 是【基线原题】的指纹，不是用户版本", async () => {
    const itemSave = makeItemSave();
    mountInterviewApi({
      itemSave: itemSave as never,
      metaGet: vi.fn(async () => makeMeta()) as never,
    });
    const reload = vi.fn();
    const { result } = renderHook(() => useQuestionOverride(reload));

    const edited: InterviewQuestion = { ...BASELINE, answer: "我的版本：补了浏览器差异。" };
    await act(async () => {
      await result.current.saveOverride(edited);
    });

    expect(itemSave).toHaveBeenCalledTimes(1);
    const payload = itemSave.mock.calls[0][0];
    expect(payload.baseHash).toBe(hashPayload(BASELINE));
    // 反证：拿用户版本算出来的指纹是另一个值 —— 那正是「永久误报基线已更新」的来源
    expect(payload.baseHash).not.toBe(hashPayload(edited));
    // 版本号来自 `interview-meta-get`（拿不到就 null）
    expect(payload.baseStamp).toBe("2026-01");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("② 覆盖行的 id 与 baseId 必须同值，且 kind 固定 question", async () => {
    const itemSave = makeItemSave();
    mountInterviewApi({ itemSave: itemSave as never });
    const { result } = renderHook(() => useQuestionOverride(vi.fn()));

    await act(async () => {
      await result.current.saveOverride(BASELINE);
    });

    const payload = itemSave.mock.calls[0][0];
    expect(payload.id).toBe(BASELINE.id);
    expect(payload.baseId).toBe(BASELINE.id);
    expect(payload.kind).toBe("question");
    expect(payload.action).toBe("override");
    expect(payload.status).toBe("adopted");
    // 没有 metaGet 通道时不许瞎猜版本号
    expect(payload.baseStamp).toBeNull();
  });

  it("③ 隐藏基线题：墓碑不带 payload，但必须带标题", async () => {
    const itemSave = makeItemSave();
    mountInterviewApi({ itemSave: itemSave as never });
    const { result } = renderHook(() => useQuestionOverride(vi.fn()));

    await act(async () => {
      await result.current.hideBaseline(BASELINE);
    });

    const payload = itemSave.mock.calls[0][0];
    expect(payload.status).toBe("hidden");
    expect(payload.action).toBe("override");
    expect(payload.baseId).toBe(BASELINE.id);
    expect(payload.title).toBe(BASELINE.title);
    // 不变量 3：墓碑的 payload 必须清空（连键都不该出现）
    expect(Object.keys(payload)).not.toContain("payload");
  });

  it("④ handler 返回 ok:false → errors 原样上抛，不 reload，pendingId 复位", async () => {
    const itemRevertDefault = vi.fn(
      async (_id: string): Promise<InterviewWriteResultDTO> => {
        void _id;
        return {
          ok: false,
          code: "not_overridden",
          errors: ["这道题没有被你改过，无需还原"],
        };
      },
    );
    mountInterviewApi({ itemRevertDefault: itemRevertDefault as never });
    const reload = vi.fn();
    const { result } = renderHook(() => useQuestionOverride(reload));

    let outcome: QuestionWriteOutcome | undefined;
    await act(async () => {
      outcome = await result.current.revertToDefault(BASELINE.id);
    });

    expect(outcome).toEqual({ ok: false, errors: ["这道题没有被你改过，无需还原"] });
    expect(result.current.error).toContain("这道题没有被你改过");
    expect(result.current.pendingId).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it("⑤ 没有 IPC 通道（jsdom / 纯浏览器）：返回失败结果，不抛", async () => {
    const { result } = renderHook(() => useQuestionOverride(vi.fn()));

    let outcome: QuestionWriteOutcome | undefined;
    await act(async () => {
      outcome = await result.current.saveOverride(BASELINE);
    });

    expect(outcome).toEqual({ ok: false, errors: ["当前环境没有本地题库通道"] });
    expect(result.current.error).toContain("本地题库通道");
  });

  it("通道 reject：把原因翻成人话，不抛", async () => {
    mountInterviewApi({
      itemSave: vi.fn(async () => {
        throw new Error("database is locked");
      }) as never,
    });
    const { result } = renderHook(() => useQuestionOverride(vi.fn()));

    let outcome: QuestionWriteOutcome | undefined;
    await act(async () => {
      outcome = await result.current.hideBaseline(BASELINE);
    });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.errors.join()).toContain("database is locked");
  });

  it("「沿用我的」记的是【当前基线】的指纹（不是用户版本的）", async () => {
    const itemAckBase = vi.fn(
      async (_id: string, _baseHash: string): Promise<InterviewWriteResultDTO> => {
        void _id;
        void _baseHash;
        return { ok: true };
      },
    );
    mountInterviewApi({ itemAckBase: itemAckBase as never });
    const { result } = renderHook(() => useQuestionOverride(vi.fn()));

    await act(async () => {
      await result.current.ackBaseline(BASELINE.id);
    });

    const [id, baseHash] = itemAckBase.mock.calls[0];
    expect(id).toBe(BASELINE.id);
    expect(baseHash).toBe(hashPayload(BASELINE));
  });

  it("用户自建题走 new 行，且不带基线指纹", async () => {
    const itemSave = makeItemSave();
    mountInterviewApi({ itemSave: itemSave as never });
    const { result } = renderHook(() => useQuestionOverride(vi.fn()));

    const fresh: InterviewQuestion = {
      ...BASELINE,
      id: "u-q-t08a-1",
      title: "自建的一道题",
    };
    await act(async () => {
      await result.current.saveOverride(fresh);
    });

    const payload = itemSave.mock.calls[0][0];
    expect(payload.action).toBe("new");
    expect(payload.baseId).toBeNull();
    expect(payload.baseHash).toBeNull();
    expect(payload.baseStamp).toBeNull();
  });

  it("还原默认 / 删除自建分别打到各自的通道", async () => {
    const itemRevertDefault = vi.fn(
      async (_id: string): Promise<InterviewWriteResultDTO> => {
        void _id;
        return { ok: true };
      },
    );
    const itemDelete = vi.fn(async (_id: string): Promise<InterviewWriteResultDTO> => {
      void _id;
      return { ok: true };
    });
    mountInterviewApi({
      itemRevertDefault: itemRevertDefault as never,
      itemDelete: itemDelete as never,
    });
    const reload = vi.fn();
    const { result } = renderHook(() => useQuestionOverride(reload));

    await act(async () => {
      await result.current.revertToDefault(BASELINE.id);
      await result.current.deleteNew("u-q-t08a-1");
    });

    expect(itemRevertDefault).toHaveBeenCalledWith(BASELINE.id);
    expect(itemDelete).toHaveBeenCalledWith("u-q-t08a-1");
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("卸载后回来的响应被丢弃：不 reload、不 setState", async () => {
    let release!: (result: InterviewWriteResultDTO) => void;
    const pending = new Promise<InterviewWriteResultDTO>((resolve) => {
      release = resolve;
    });
    mountInterviewApi({ itemSave: vi.fn(() => pending) as never });
    const reload = vi.fn();

    const { result, unmount } = renderHook(() => useQuestionOverride(reload));
    await act(async () => {
      // 故意不 await：让回调停在这一步，模拟「请求还在路上时组件被卸载」
      void result.current.hideBaseline(BASELINE);
      await Promise.resolve();
    });
    expect(result.current.pendingId).toBe(BASELINE.id);

    unmount();
    await act(async () => {
      release({ ok: true });
      await pending;
      await Promise.resolve();
    });

    expect(reload).not.toHaveBeenCalled();
  });
});
