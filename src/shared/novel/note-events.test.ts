/**
 * note-events 行为测试（P2-4 灵感跨页同步事件）
 *
 * 验证事件模块自身的契约：双通道投递（同窗口 CustomEvent + 跨窗口 broadcast）、
 * 负载原样携带。监听侧的 patch 语义由 useNovelData 的测试负责。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOVEL_NOTE_EVENT,
  notifyNoteChanged,
  type NovelNoteChangedDetail,
} from "./note-events";
import type { NovelNoteDTO } from "@/shared/types/electron";

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

const originalAPI = window.electronAPI;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  window.electronAPI = originalAPI;
});

describe("notifyNoteChanged", () => {
  it("同窗口路径：以 CustomEvent 派发，detail 原样携带", () => {
    const received: NovelNoteChangedDetail[] = [];
    window.addEventListener(NOVEL_NOTE_EVENT, (event) => {
      received.push((event as CustomEvent<NovelNoteChangedDetail>).detail);
    });

    const note = makeNote();
    notifyNoteChanged({ action: "upsert", workId: "w1", note });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ action: "upsert", workId: "w1", note });
  });

  it("跨窗口路径：electronAPI 在场时 broadcast 同名事件", () => {
    const broadcast = vi.fn();
    window.electronAPI = {
      windowAPI: { broadcast },
    } as unknown as typeof window.electronAPI;

    notifyNoteChanged({ action: "remove", noteId: "n-9" });

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith(NOVEL_NOTE_EVENT, {
      action: "remove",
      noteId: "n-9",
    });
  });

  it("electronAPI 缺席（测试环境）时不抛错，同窗口路径照常工作", () => {
    window.electronAPI = undefined;
    const received: NovelNoteChangedDetail[] = [];
    window.addEventListener(NOVEL_NOTE_EVENT, (event) => {
      received.push((event as CustomEvent<NovelNoteChangedDetail>).detail);
    });

    expect(() =>
      notifyNoteChanged({ action: "remove", noteId: "n-1" }),
    ).not.toThrow();
    expect(received).toHaveLength(1);
  });
});
