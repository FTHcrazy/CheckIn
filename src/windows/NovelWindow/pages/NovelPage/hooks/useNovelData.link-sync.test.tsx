/**
 * useNovelData 关系增量补丁测试（R27 / S3 写回 + S4 反向同步）。
 *
 * 只钉一件会静默串书的事：**`novel-links-changed` 必须按 `workId` 过滤**。
 * 图窗口可以停在 A 书，而主窗口已经切到 B 书；此时 A 的增量若照单全收，
 * 就会并进 B 的 `bundle.links`（`entityLinkCount` 靠 id 过滤才没露出来，
 * 但「B 书有 3 条关系」这类派生数就错了）。
 *
 * 服务层整体 mock（同 note-sync 的写法）：只验证 hook 的编排，IPC 归 handler。
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NovelBundleDTO, NovelLinkDTO } from "@/shared/types/electron";

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

const WORK = "w1";

function makeLink(overrides: Partial<NovelLinkDTO> = {}): NovelLinkDTO {
  return {
    id: "l-old",
    fromType: "character",
    fromId: "e1",
    toType: "location",
    toId: "e2",
    relation: "出身",
    ...overrides,
  };
}

function makeBundle(links: NovelLinkDTO[] = [makeLink()]): NovelBundleDTO {
  return {
    works: [{ id: WORK, name: "测试书", createdAt: 1 }],
    volumes: [],
    chapters: [],
    entities: [],
    links,
    settings: [],
    notes: [],
    outlineEntries: [],
    recovery: null,
  };
}

/** 捕获 hook 注册的 `novel-links-changed` 处理器 */
let linkHandlers: Array<(...args: unknown[]) => void> = [];

function emitLinks(payload: unknown): void {
  act(() => {
    for (const handler of linkHandlers) handler(payload, undefined);
  });
}

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
  linkHandlers = [];
  serviceMocks.openEditorSession.mockResolvedValue(true);
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    windowAPI: {
      on: vi.fn((name: string, handler: (...args: unknown[]) => void) => {
        if (name === "novel-links-changed") linkHandlers.push(handler);
      }),
      off: vi.fn((name: string, handler: (...args: unknown[]) => void) => {
        if (name === "novel-links-changed") {
          linkHandlers = linkHandlers.filter((item) => item !== handler);
        }
      }),
      send: vi.fn(),
      sendTo: vi.fn(),
      setCloseGuard: vi.fn(),
      respondClose: vi.fn(),
    },
    novel: {},
  };
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("关系增量按 workId 过滤", () => {
  it("别的作品的关系不会并进当前 bundle", async () => {
    const result = await renderLoadedBundle();
    emitLinks({
      workId: "w-other",
      created: [makeLink({ id: "l-other", relation: "同门" })],
    });
    expect(result.current.links.map((link) => link.id)).toEqual(["l-old"]);
  });

  it("本书的关系按 id 合并进来", async () => {
    const result = await renderLoadedBundle();
    emitLinks({
      workId: WORK,
      created: [makeLink({ id: "l-new", relation: "同门" })],
    });
    expect(result.current.links.map((link) => link.id)).toEqual(["l-new", "l-old"]);
  });

  it("缺省 workId（境界绑定反查不到作品）仍按 id 合并", async () => {
    const result = await renderLoadedBundle();
    emitLinks({ created: [makeLink({ id: "l-bound", relation: "境界" })] });
    expect(result.current.links.map((link) => link.id)).toEqual(["l-bound", "l-old"]);
  });
});
