/**
 * useNovelData 灵感就地补丁测试（P2-4 书架 ↔ 编辑器笔记同步）。
 *
 * 书架侧广播 novel-note-changed，编辑器（常驻挂载）订阅后就地 patch
 * bundle.notes。这里验证补丁语义：新增落头部、更新整行替换、remove 摘除、
 * 内容未变返回原引用、装载在途时跳过（等装载响应带回库内真值）。
 *
 * 服务层整体 mock：只验证 hook 的状态编排，IPC 由 handler 负责。
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOVEL_NOTE_EVENT, type NovelNoteChangedDetail } from "@/shared/novel/note-events";
import type { NovelBundleDTO, NovelNoteDTO } from "@/shared/types/electron";

const serviceMocks = vi.hoisted(() => ({
  addChapter: vi.fn(),
  addLink: vi.fn(),
  addSettingCategory: vi.fn(),
  addSettingLevel: vi.fn(),
  batchAddSettingLevels: vi.fn(),
  addVolume: vi.fn(),
  addWork: vi.fn(),
  createNovelId: vi.fn((prefix: string) => `${prefix}-test-${Math.random().toString(36).slice(2, 8)}`),
  fetchChapterSnapshots: vi.fn(),
  fetchLastPosition: vi.fn(),
  fetchNameFavorites: vi.fn(),
  fetchNovelBundle: vi.fn(),
  mergeSettingLevel: vi.fn(),
  openEditorSession: vi.fn(),
  patchSettingCategory: vi.fn(),
  patchSettingLevel: vi.fn(),
  removeLink: vi.fn(),
  removeNote: vi.fn(),
  removeOutlineEntry: vi.fn(),
  removeSettingCategory: vi.fn(),
  removeSettingLevel: vi.fn(),
  removeWork: vi.fn(),
  removeChapter: vi.fn(),
  renameChapter: vi.fn(),
  renameVolume: vi.fn(),
  renameWork: vi.fn(),
  resetTemplateBook: vi.fn(),
  saveChapterContent: vi.fn(),
  saveChapterOrder: vi.fn(),
  saveChapterOutline: vi.fn(),
  saveEntity: vi.fn(),
  saveNameFavorites: vi.fn(),
  saveNote: vi.fn(),
  saveOutlineEntry: vi.fn(),
  saveSettingCategoryOrder: vi.fn(),
  saveSettingLevelOrder: vi.fn(),
  saveVolumeOrder: vi.fn(),
  searchAcrossBook: vi.fn(),
  setChapterStatus: vi.fn(),
  splitSettingLevel: vi.fn(),
}));
vi.mock("../services/novel-service", () => serviceMocks);

const { useNovelData } = await import("./useNovelData");

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

function dispatchNote(detail: NovelNoteChangedDetail): void {
  window.dispatchEvent(new CustomEvent(NOVEL_NOTE_EVENT, { detail }));
}

// ⚠️ 返回 result 引用而非 result.current 快照：dispatch 触发重渲染后
// result.current 会换成新对象，快照里留着的 allNotes 永远是旧值
async function renderLoadedBundle(bundle: NovelBundleDTO = makeBundle()) {
  serviceMocks.fetchNovelBundle.mockResolvedValue(bundle);
  serviceMocks.fetchLastPosition.mockResolvedValue(null);
  serviceMocks.fetchNameFavorites.mockResolvedValue("[]");
  const { result } = renderHook(() => useNovelData());
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  serviceMocks.openEditorSession.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
});

describe("灵感就地补丁（P2-4）", () => {
  it("upsert 新行 → 插到 notes 头部", async () => {
    const existing = makeNote({ id: "n-old", createdAt: 50 });
    const result = await renderLoadedBundle(makeBundle({ notes: [existing] }));

    const fresh = makeNote({ id: "n-new", createdAt: 200 });
    act(() => {
      dispatchNote({ action: "upsert", workId: "w1", note: fresh });
    });

    expect(result.current.allNotes[0]?.id).toBe("n-new");
    expect(result.current.allNotes).toHaveLength(2);
  });

  it("upsert 已有行 → 整行替换", async () => {
    const existing = makeNote();
    const result = await renderLoadedBundle(makeBundle({ notes: [existing] }));

    act(() => {
      dispatchNote({
        action: "upsert",
        workId: "w1",
        note: { ...existing, content: "改过的灵感", pinned: true },
      });
    });

    expect(result.current.allNotes).toHaveLength(1);
    expect(result.current.allNotes[0]?.content).toBe("改过的灵感");
    expect(result.current.allNotes[0]?.pinned).toBe(true);
  });

  it("upsert 内容未变 → 返回原引用，不触发无谓重算", async () => {
    const existing = makeNote();
    const result = await renderLoadedBundle(makeBundle({ notes: [existing] }));
    const before = result.current.allNotes;

    act(() => {
      dispatchNote({ action: "upsert", workId: "w1", note: { ...existing } });
    });

    expect(result.current.allNotes).toBe(before);
  });

  it("remove → 按 noteId 摘除", async () => {
    const existing = makeNote();
    const result = await renderLoadedBundle(makeBundle({ notes: [existing] }));

    act(() => {
      dispatchNote({ action: "remove", noteId: existing.id });
    });

    expect(result.current.allNotes).toHaveLength(0);
  });

  it("装载在途 → 补丁被跳过，库内真值随装载响应回来", async () => {
    let resolveBundle!: (bundle: NovelBundleDTO) => void;
    serviceMocks.fetchNovelBundle.mockImplementation(
      () =>
        new Promise<NovelBundleDTO>((resolve) => {
          resolveBundle = resolve;
        }),
    );
    serviceMocks.fetchLastPosition.mockResolvedValue(null);
    serviceMocks.fetchNameFavorites.mockResolvedValue("[]");
    const { result } = renderHook(() => useNovelData());

    // 装载未完成期间书架发来的事件：bundle 即将被整体替换，补丁跳过
    expect(result.current.loading).toBe(true);
    act(() => {
      dispatchNote({
        action: "upsert",
        workId: "w1",
        note: makeNote({ id: "n-external" }),
      });
    });
    act(() => {
      resolveBundle(makeBundle({ notes: [] }));
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.allNotes.some((note) => note.id === "n-external")).toBe(false);

    // 装载完成后再来的事件照常打补丁
    act(() => {
      dispatchNote({
        action: "upsert",
        workId: "w1",
        note: makeNote({ id: "n-external" }),
      });
    });
    expect(result.current.allNotes.some((note) => note.id === "n-external")).toBe(true);
  });
});
