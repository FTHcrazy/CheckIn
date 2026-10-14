/**
 * useNovelData 预设套用（createSettingCategoryWithLevels）回归测试。
 *
 * ── 报障成因 ──
 * 此前「应用内置预设」是 createSettingCategory + batchAddSettingLevels 两连调：
 * batchAdd 从当前闭包的 bundle 里 find 刚建好的分类，而 setBundle 是异步的，
 * 同一次点击里它还不在里面 → find 失败、静默返回 0。观感是「模板应用成功、
 * 分类也建了（0 级），等级序列却永远是空的」。
 *
 * 这里钉住：一次调用必须同时落地分类与全部等级（本地状态 + 远端两条调用）。
 *
 * 服务层整体 mock：只验证 hook 的状态编排，IPC 由 handler 负责。
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NovelBundleDTO } from "@/shared/types/electron";

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

function makeBundle(): NovelBundleDTO {
  return {
    works: [{ id: "w1", name: "测试书", createdAt: 1 }],
    volumes: [],
    chapters: [],
    entities: [],
    links: [],
    settings: [],
    notes: [],
    outlineEntries: [],
    recovery: null,
  };
}

async function renderLoadedBundle() {
  serviceMocks.fetchNovelBundle.mockResolvedValue(makeBundle());
  serviceMocks.fetchLastPosition.mockResolvedValue(null);
  serviceMocks.fetchNameFavorites.mockResolvedValue("[]");
  const { result } = renderHook(() => useNovelData());
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  serviceMocks.openEditorSession.mockResolvedValue(true);
  serviceMocks.addSettingCategory.mockResolvedValue({ id: "sc-test-1", kind: "realm" });
  serviceMocks.batchAddSettingLevels.mockResolvedValue(2);
});

afterEach(() => {
  cleanup();
});

describe("createSettingCategoryWithLevels —— 预设套用一次性落地", () => {
  it("分类与等级在同一次更新里出现，不再被旧闭包吞掉", async () => {
    const result = await renderLoadedBundle();

    act(() => {
      result.current.createSettingCategoryWithLevels(
        "修仙 · 练气十三层",
        "realm",
        [
          { name: "练气", subLevels: 13, subPattern: "第{n}层" },
          { name: "筑基", subLevels: 4, subPattern: "初期,中期,后期,圆满" },
        ],
        { note: "练气十三层", subLevels: 13, carryDir: "asc", subPattern: "第{n}层" },
      );
    });

    expect(result.current.settings).toHaveLength(1);
    const category = result.current.settings[0];
    expect(category.name).toBe("修仙 · 练气十三层");
    // 关键断言：等级不再被时序坑吞掉
    expect(category.levels).toHaveLength(2);
    expect(category.levels.map((level) => level.name)).toEqual(["练气", "筑基"]);
    expect(category.levels[0]?.rank).toBe(1);
    // 分类级 meta 也带上（此前预设的这些字段被整包丢弃）
    expect(category.subLevels).toBe(13);
    expect(category.carryDir).toBe("asc");
    expect(category.note).toBe("练气十三层");
  });

  it("远端两条调用都发出：category-add 对新分类、batch level-add 挂同一 id", async () => {
    const result = await renderLoadedBundle();

    act(() => {
      result.current.createSettingCategoryWithLevels("都市 · 异能评级", "custom", [
        { name: "F" },
        { name: "E" },
      ]);
    });

    expect(serviceMocks.addSettingCategory).toHaveBeenCalledTimes(1);
    const categoryId = serviceMocks.addSettingCategory.mock.calls[0]?.[1] as string;
    expect(serviceMocks.batchAddSettingLevels).toHaveBeenCalledTimes(1);
    const [remoteCategoryId, items] = serviceMocks.batchAddSettingLevels.mock.calls[0];
    // 两批等级必须挂在刚建的那个分类上
    expect(remoteCategoryId).toBe(categoryId);
    expect(items).toHaveLength(2);
  });

  it("kind='realm' 被主进程降级时，本地 kind 跟着回执修正", async () => {
    serviceMocks.addSettingCategory.mockResolvedValue({ id: "sc-test-1", kind: "custom" });
    const result = await renderLoadedBundle();

    act(() => {
      result.current.createSettingCategoryWithLevels("洪荒 · 仙道品位", "realm", [
        { name: "人仙" },
      ]);
    });

    await waitFor(() => {
      expect(result.current.settings[0]?.kind).toBe("custom");
    });
  });

  it("空名 / 空等级名单仍会建分类，但不会发出 batch 调用", async () => {
    const result = await renderLoadedBundle();

    act(() => {
      result.current.createSettingCategoryWithLevels("空体系", "custom", [
        { name: "  " },
      ]);
    });

    expect(result.current.settings).toHaveLength(1);
    expect(result.current.settings[0]?.levels).toHaveLength(0);
    expect(serviceMocks.batchAddSettingLevels).not.toHaveBeenCalled();
  });
});
