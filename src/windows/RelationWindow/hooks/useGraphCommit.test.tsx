/**
 * 关系提交 hook（R27 / S3）
 *
 * 钉的是四件会让用户直接受损的事：
 * ① 提交前必须先把坐标刷掉（rev 以库里的值为准）；
 * ② 连点确认只发一次 IPC（同一帧里的第二次点击也要挡住）；
 * ③ 失败时内容不清空、错误留给人看（返回 null，不改任何本地状态）；
 * ④ stale 要能被上层识别成「需要重新载入」，而不是一句含糊的失败。
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useGraphCommit } from "./useGraphCommit";
import type { RelGraphDoc } from "../utils/graph-doc";

const WORK = "w1";

function snapshotDoc(rev = 4): RelGraphDoc {
  return {
    v: 2,
    ts: 0,
    view: { k: 1, tx: 0, ty: 0 },
    members: { e1: [10, 20, 1], e2: [30, 40, 1] },
    rev,
    autoSeeded: 1,
  };
}

interface ApiOptions {
  graphCommit?: (request: unknown) => Promise<unknown>;
}

function installApi(options: ApiOptions = {}) {
  const graphCommit = vi.fn(
    options.graphCommit ??
      (async () => ({
        ok: true,
        rev: 5,
        created: [
          {
            id: "l-new",
            fromType: "character",
            fromId: "e1",
            toType: "location",
            toId: "e2",
            relation: "出身",
          },
        ],
        merged: [],
        notes: [],
        rejected: [],
      })),
  );
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    novel: { graphCommit },
    windowAPI: { on: vi.fn(), off: vi.fn() },
  };
  return { graphCommit };
}

afterEach(() => {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

function renderCommit(overrides: Partial<Parameters<typeof useGraphCommit>[0]> = {}) {
  const flush = vi.fn(async () => true);
  const onCommitted = vi.fn();
  const snapshot = vi.fn(() => snapshotDoc());
  const hook = renderHook(() =>
    useGraphCommit({
      workId: WORK,
      snapshot,
      flush,
      onCommitted,
      ...overrides,
    }),
  );
  return { ...hook, flush, onCommitted, snapshot };
}

describe("成功路径", () => {
  it("先刷坐标、再提交，载荷带 rev 与画布文档", async () => {
    const { graphCommit } = installApi();
    const { result, flush, snapshot, onCommitted } = renderCommit();

    let outcome: unknown = null;
    await act(async () => {
      outcome = await result.current.commit({
        addLinks: [
          {
            id: "l-new",
            fromType: "character",
            fromId: "e1",
            toType: "location",
            toId: "e2",
            relation: "出身",
          },
        ],
      });
    });

    expect(flush).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveBeenCalled();
    expect(graphCommit).toHaveBeenCalledTimes(1);
    const request = graphCommit.mock.calls[0][0] as {
      workId: string;
      expectedRev: number;
      doc: string;
      addLinks: unknown[];
    };
    expect(request.workId).toBe(WORK);
    expect(request.expectedRev).toBe(4);
    expect(JSON.parse(request.doc).members.e1).toEqual([10, 20, 1]);
    expect(request.addLinks).toHaveLength(1);

    expect(onCommitted).toHaveBeenCalledTimes(1);
    expect((outcome as { ok: boolean }).ok).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.submitting).toBe(false);
  });

  it("rev 以 snapshot 为准（flush 可能已经把 rev 推进一步）", async () => {
    const { graphCommit } = installApi();
    const flush = vi.fn(async () => true);
    const snapshot = vi.fn(() => snapshotDoc(9));
    const { result } = renderHook(() =>
      useGraphCommit({ workId: WORK, snapshot, flush, onCommitted: vi.fn() }),
    );

    await act(async () => {
      await result.current.commit({ noteUpdates: [{ id: "l1", note: "备注" }] });
    });

    expect((graphCommit.mock.calls[0][0] as { expectedRev: number }).expectedRev).toBe(9);
  });
});

describe("连点只写一次", () => {
  it("同一帧内两次 commit 只有一次真正发 IPC", async () => {
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const { graphCommit } = installApi({ graphCommit: () => pending });
    const { result } = renderCommit();

    let first: unknown;
    let second: unknown;
    await act(async () => {
      const a = result.current.commit({ addLinks: [] });
      const b = result.current.commit({ addLinks: [] });
      release({ ok: true, rev: 5, created: [], merged: [], notes: [], rejected: [] });
      [first, second] = await Promise.all([a, b]);
    });

    expect(graphCommit).toHaveBeenCalledTimes(1);
    expect(first).not.toBeNull();
    // 第二次直接被同步锁挡掉，返回 null（调用方据此不关弹层、不提示成功）
    expect(second).toBeNull();
  });
});

describe("失败路径", () => {
  it("数据库失败：错误可读、submitting 归零、不回调 onCommitted", async () => {
    installApi({
      graphCommit: async () => ({ ok: false, code: "db", message: "disk I/O error" }),
    });
    const { result, onCommitted } = renderCommit();

    await act(async () => {
      await result.current.commit({ addLinks: [] });
    });

    expect(onCommitted).not.toHaveBeenCalled();
    expect(result.current.error).toContain("创建失败");
    expect(result.current.error).toContain("disk I/O error");
    expect(result.current.submitting).toBe(false);
    expect(result.current.staleRev).toBeNull();
  });

  it("端点已删（invalid-target）给的是「刷新后重试」而不是技术细节", async () => {
    installApi({
      graphCommit: async () => ({
        ok: false,
        code: "invalid-target",
        invalid: ["e9"],
      }),
    });
    const { result } = renderCommit();

    await act(async () => {
      await result.current.commit({ addLinks: [] });
    });

    expect(result.current.error).toContain("已被删除");
    expect(result.current.error).not.toContain("invalid-target");
  });

  it("stale：记下库里的 rev，上层据此显示「重新载入」", async () => {
    installApi({
      graphCommit: async () => ({ ok: false, code: "stale", rev: 12 }),
    });
    const { result } = renderCommit();

    await act(async () => {
      await result.current.commit({ addLinks: [] });
    });

    expect(result.current.staleRev).toBe(12);
    expect(result.current.error).toContain("已在别处改过");
  });

  it("通道缺失按失败处理，不抛穿到界面", async () => {
    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      novel: {},
      windowAPI: { on: vi.fn(), off: vi.fn() },
    };
    const { result } = renderCommit();

    await act(async () => {
      await result.current.commit({ addLinks: [] });
    });

    expect(result.current.error).toContain("数据通道不可用");
  });

  it("没有作品上下文时直接拒绝，不发 IPC", async () => {
    const { graphCommit } = installApi();
    const { result } = renderCommit({ workId: "" });

    await act(async () => {
      await result.current.commit({ addLinks: [] });
    });

    expect(graphCommit).not.toHaveBeenCalled();
    expect(result.current.error).toContain("没有作品上下文");
  });

  it("坐标没写进去（flush 失败）就中止提交，不拿旧 rev 去撞 stale", async () => {
    const { graphCommit } = installApi();
    const { result } = renderCommit({ flush: vi.fn(async () => false) });

    let outcome: unknown = "unset";
    await act(async () => {
      outcome = await result.current.commit({ addLinks: [] });
    });

    expect(outcome).toBeNull();
    expect(graphCommit).not.toHaveBeenCalled();
    expect(result.current.error).toContain("坐标没能保存");
    // 真实原因必须说清，不能让它表现成「这本书的图已在别处改过」
    expect(result.current.staleRev).toBeNull();
  });
});

describe("错误清理", () => {
  it("clearError 同时清掉 stale 标记", async () => {
    installApi({ graphCommit: async () => ({ ok: false, code: "stale", rev: 3 }) });
    const { result } = renderCommit();

    await act(async () => {
      await result.current.commit({ addLinks: [] });
    });
    expect(result.current.staleRev).toBe(3);

    act(() => result.current.clearError());
    await waitFor(() => expect(result.current.staleRev).toBeNull());
    expect(result.current.error).toBeNull();
  });
});
