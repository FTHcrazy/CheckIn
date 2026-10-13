/**
 * useBookshelfData 行为测试（P2-6 装载失败错误态 / P2-4 灵感变更广播）。
 *
 * 服务层整体 mock：这里只验证 hook 的状态编排（装载 / 失败 / 重试）与
 * 「写操作完成后广播 novel-note-changed」的契约；IPC 与 SQL 由 handler 负责。
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOVEL_NOTE_EVENT, type NovelNoteChangedDetail } from "@/shared/novel/note-events";
import type { NovelBundleDTO, NovelNoteDTO } from "@/shared/types/electron";

const serviceMocks = vi.hoisted(() => ({
  fetchShelfBundle: vi.fn(),
  fetchShelfUsage: vi.fn(),
  fetchShelfSettingsRaw: vi.fn(),
  fetchShelfPositionRaw: vi.fn(),
  addShelfWork: vi.fn(),
  saveShelfNote: vi.fn(),
  removeShelfNote: vi.fn(),
  moveShelfNote: vi.fn(),
  createShelfId: vi.fn((prefix: string) => `${prefix}-test-${Math.random().toString(36).slice(2, 8)}`),
}));
vi.mock("../services/bookshelf-service", () => serviceMocks);

const numberingMocks = vi.hoisted(() => ({
  fetchWorkNumbering: vi.fn(),
  applyWorkNumbering: vi.fn(),
}));
vi.mock("@/shared/novel/work-numbering", () => numberingMocks);

const { useBookshelfData } = await import("./useBookshelfData");

// ── fixtures ──

function makeNote(overrides: Partial<NovelNoteDTO> = {}): NovelNoteDTO {
  return {
    id: "n-1",
    workId: "w1",
    content: "灵感一条",
    createdAt: 100,
    pinned: false,
    ...overrides,
  };
}

function makeBundle(overrides: { notes?: NovelNoteDTO[] } = {}): NovelBundleDTO {
  return {
    works: [{ id: "w1", name: "测试书", createdAt: 1 }],
    volumes: [],
    chapters: [],
    entities: [],
    links: [],
    settings: [],
    notes: overrides.notes ?? [],
    outlineEntries: [],
    recovery: null,
  };
}

/** 收集 hook 发出的灵感事件（notifyNoteChanged 的同窗口路径） */
function useNoteEventCollector(): NovelNoteChangedDetail[] {
  const received: NovelNoteChangedDetail[] = [];
  window.addEventListener(NOVEL_NOTE_EVENT, (event) => {
    received.push((event as CustomEvent<NovelNoteChangedDetail>).detail);
  });
  return received;
}

beforeEach(() => {
  vi.clearAllMocks();
  serviceMocks.fetchShelfUsage.mockResolvedValue({
    todayWords: 0,
    saveCount: 0,
    streakDays: 0,
  });
  serviceMocks.fetchShelfSettingsRaw.mockResolvedValue(null);
  serviceMocks.fetchShelfPositionRaw.mockResolvedValue(null);
  numberingMocks.fetchWorkNumbering.mockResolvedValue({});
  serviceMocks.saveShelfNote.mockResolvedValue(true);
  serviceMocks.removeShelfNote.mockResolvedValue(true);
  serviceMocks.moveShelfNote.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
});

describe("装载失败错误态（P2-6）", () => {
  it("IPC reject → loadError 置位、bundle 保持 null，不静默吞掉", async () => {
    serviceMocks.fetchShelfBundle.mockRejectedValue(new Error("db gone"));
    const { result } = renderHook(() => useBookshelfData());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loadError).toBe("书架数据装载失败，请重试");
    expect(result.current.bundle).toBeNull();
  });

  it("点重试成功 → loadError 清空、bundle 到位", async () => {
    serviceMocks.fetchShelfBundle.mockRejectedValueOnce(new Error("db gone"));
    const { result } = renderHook(() => useBookshelfData());
    await waitFor(() => expect(result.current.loadError).not.toBe(""));

    serviceMocks.fetchShelfBundle.mockResolvedValue(makeBundle());
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.loadError).toBe("");
    expect(result.current.bundle).not.toBeNull();
  });

  it("静默刷新失败但 bundle 已在 → 保留旧数据，loadError 仅记录", async () => {
    serviceMocks.fetchShelfBundle.mockResolvedValue(makeBundle());
    const { result } = renderHook(() => useBookshelfData());
    await waitFor(() => expect(result.current.bundle).not.toBeNull());

    serviceMocks.fetchShelfBundle.mockRejectedValue(new Error("db gone"));
    await act(async () => {
      await result.current.refresh(true);
    });

    // 旧数据仍在（不打扰用户），错误被记录但页面不会因此渲染成空书架
    expect(result.current.bundle).not.toBeNull();
    expect(result.current.loadError).not.toBe("");
  });
});

describe("灵感写操作广播 novel-note-changed（P2-4）", () => {
  it("addNote → upsert 事件携带完整行，且落库", async () => {
    serviceMocks.fetchShelfBundle.mockResolvedValue(makeBundle());
    const received = useNoteEventCollector();
    const { result } = renderHook(() => useBookshelfData());
    await waitFor(() => expect(result.current.bundle).not.toBeNull());

    act(() => {
      result.current.addNote("新灵感", "w1");
    });

    await waitFor(() => expect(received.length).toBe(1));
    expect(received[0].action).toBe("upsert");
    expect(received[0].note?.content).toBe("新灵感");
    expect(received[0].note?.workId).toBe("w1");
    expect(serviceMocks.saveShelfNote).toHaveBeenCalledTimes(1);
  });

  it("toggleNotePinned → upsert 事件携带翻转后的行，落库只发一次", async () => {
    const note = makeNote();
    serviceMocks.fetchShelfBundle.mockResolvedValue(makeBundle({ notes: [note] }));
    const received = useNoteEventCollector();
    const { result } = renderHook(() => useBookshelfData());
    await waitFor(() => expect(result.current.bundle).not.toBeNull());

    act(() => {
      result.current.toggleNotePinned(note.id);
    });

    await waitFor(() => expect(received.length).toBe(1));
    expect(received[0].action).toBe("upsert");
    expect(received[0].note?.pinned).toBe(true);
    expect(serviceMocks.saveShelfNote).toHaveBeenCalledTimes(1);
  });

  it("moveNoteTo → upsert 事件携带迁移后的 workId", async () => {
    const note = makeNote();
    serviceMocks.fetchShelfBundle.mockResolvedValue(makeBundle({ notes: [note] }));
    const received = useNoteEventCollector();
    const { result } = renderHook(() => useBookshelfData());
    await waitFor(() => expect(result.current.bundle).not.toBeNull());

    act(() => {
      result.current.moveNoteTo(note.id, "w2");
    });

    await waitFor(() => expect(received.length).toBe(1));
    expect(received[0].action).toBe("upsert");
    expect(received[0].note?.workId).toBe("w2");
    expect(serviceMocks.moveShelfNote).toHaveBeenCalledWith(note.id, "w2");
  });

  it("removeNoteById → remove 事件携带 noteId", async () => {
    const note = makeNote();
    serviceMocks.fetchShelfBundle.mockResolvedValue(makeBundle({ notes: [note] }));
    const received = useNoteEventCollector();
    const { result } = renderHook(() => useBookshelfData());
    await waitFor(() => expect(result.current.bundle).not.toBeNull());

    act(() => {
      result.current.removeNoteById(note.id);
    });

    await waitFor(() => expect(received.length).toBe(1));
    expect(received[0]).toEqual({ action: "remove", noteId: note.id });
    expect(serviceMocks.removeShelfNote).toHaveBeenCalledWith(note.id);
  });
});
