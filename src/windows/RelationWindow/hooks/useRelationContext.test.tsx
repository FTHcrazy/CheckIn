/**
 * 窗口上下文单测（R27 / S2）
 *
 * 钉一条产品口径：**主窗口切书不静默**。自动跟随看起来更顺，但正在摆图的人
 * 一抬头会发现画布换了一本书 —— 所以这里断言「一律先挂起，等用户点横幅」。
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRelationContext } from "./useRelationContext";
import type { ElectronAPI } from "@/shared/types/electron";

type Handler = (...args: unknown[]) => void;

function installApi() {
  const handlers = new Map<string, Handler>();
  const api = {
    windowAPI: {
      on: vi.fn((event: string, handler: Handler) => handlers.set(event, handler)),
      off: vi.fn((event: string) => handlers.delete(event)),
    },
  };
  (window as unknown as { electronAPI?: unknown }).electronAPI = api;
  return {
    fire: (event: string, payload: unknown) => {
      const handler = handlers.get(event);
      if (!handler) throw new Error(`未注册 ${event}`);
      act(() => handler(payload));
    },
  };
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;
});

describe("useRelationContext", () => {
  it("打开时携带的上下文直接绑定", () => {
    const { fire } = installApi();
    const { result } = renderHook(() => useRelationContext());
    fire("relation-window-context", { workId: "w1" });
    expect(result.current.workId).toBe("w1");
    expect(result.current.pendingWorkId).toBeNull();
  });

  it("主窗口切到别的书：挂起而不是跟过去", () => {
    const { fire } = installApi();
    const { result } = renderHook(() => useRelationContext());
    fire("relation-window-context", { workId: "w1" });
    fire("novel-work-changed", { workId: "w2", chapterId: "c9", nonce: 0 });

    expect(result.current.workId).toBe("w1");
    expect(result.current.pendingWorkId).toBe("w2");
  });

  it("点「切到」才真的换，并清掉挂起", () => {
    const { fire } = installApi();
    const { result } = renderHook(() => useRelationContext());
    fire("relation-window-context", { workId: "w1" });
    fire("novel-work-changed", { workId: "w2" });

    act(() => result.current.adoptPending());
    expect(result.current.workId).toBe("w2");
    expect(result.current.pendingWorkId).toBeNull();
  });

  it("点「留在这本」保持当前作品，不产生后续弹窗", () => {
    const { fire } = installApi();
    const { result } = renderHook(() => useRelationContext());
    fire("relation-window-context", { workId: "w1" });
    fire("novel-work-changed", { workId: "w2" });

    act(() => result.current.dismissPending());
    expect(result.current.workId).toBe("w1");
    expect(result.current.pendingWorkId).toBeNull();
  });

  it("重复唤起补发上下文：不同作品也挂起，不静默换书", () => {
    const { fire } = installApi();
    const { result } = renderHook(() => useRelationContext());
    fire("relation-window-context", { workId: "w1" });
    // createRelationWindow 对已存在的窗口会再投一次 context（raise 到前台）
    fire("relation-window-context", { workId: "w2" });

    expect(result.current.workId).toBe("w1");
    expect(result.current.pendingWorkId).toBe("w2");
  });

  it("同一本书的广播（切章）不会弹横幅", () => {
    const { fire } = installApi();
    const { result } = renderHook(() => useRelationContext());
    fire("relation-window-context", { workId: "w1" });
    fire("novel-work-changed", { workId: "w1", chapterId: "c2", nonce: 3 });
    expect(result.current.pendingWorkId).toBeNull();
  });

  it("脏负载（缺 workId）直接忽略，不把窗口带进空态", () => {
    const { fire } = installApi();
    const { result } = renderHook(() => useRelationContext());
    fire("relation-window-context", { workId: "w1" });
    fire("novel-work-changed", { nope: true });
    expect(result.current.workId).toBe("w1");
    expect(result.current.pendingWorkId).toBeNull();
  });
});
