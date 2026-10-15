import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * QA 独立验证 · Esc 逐层关闭链（REQ-050 回归面）
 *
 * 为什么单独验证：REQ-050 改的是「点外部关闭」机制，同时顶栏两颗按钮从
 * 「只开不关」改成 toggle，浮层层数变多。Esc 是**唯一**能一次性验证「谁在最上层」
 * 的入口——排序错了，作者按 Esc 会关掉眼前看不见的那一层（体验错乱），
 * 而且不会有任何报错。这是最容易在后续重构里被打断的一条链。
 *
 * 用真组件、真 Hook、真事件：
 * - 真的 `useNovelShortcuts`（window keydown → handler）
 * - 真的 `useNovelViewState`（四层开关状态）
 * - 真的 `useNovelPage.handleEscape`（被测排序逻辑本体）
 * 只把「数据层 / 编辑态 / 悬停 / 行囊主角」换成桩，隔离出编排层。
 */

vi.mock("../services/novel-service", () => ({
  createNovelId: (prefix: string) => `${prefix}-stub`,
  exportTxtFile: vi.fn(async () => null),
  fetchCustomEntityTypes: vi.fn(async () => null),
  logUsageEvent: vi.fn(async () => true),
  saveCustomEntityTypes: vi.fn(async () => true),
  saveLastPosition: vi.fn(async () => true),
  fetchPanelWidth: vi.fn(async () => null),
  savePanelWidth: vi.fn(async () => true),
}));

vi.mock("@/shared/components/CharacterPack/services/pack-service", () => ({
  quickAddPackItem: vi.fn(async () => null),
}));
vi.mock("@/shared/components/CharacterPack/pack-config", () => ({
  notifyQuickAdded: vi.fn(),
}));
vi.mock("./useEntityHover", () => ({ useEntityHover: vi.fn() }));
vi.mock("./usePackProtagonist", () => ({
  usePackProtagonist: () => ({
    protagonistEntityId: null,
    designate: vi.fn(async () => true),
    refresh: vi.fn(async () => true),
  }),
}));

const dataStub = {
  works: [],
  volumes: [],
  chapters: [],
  entities: [],
  links: [],
  settings: [],
  realmCategory: null,
  notes: [],
  allNotes: [],
  outlineEntries: [],
  groups: [],
  chapterNumbers: new Map(),
  activeChapter: null,
  activeChapterId: null,
  activeWorkId: "w-stub",
  recovery: null,
  snapshots: [],
  loading: false,
  loadError: null,
  lastPosition: null,
  getEntityById: () => null,
  getEntityRelations: () => [],
  nameFavoritesOf: () => [],
  addNameFavorite: vi.fn(),
  removeNameFavorite: vi.fn(),
  setActiveWorkId: vi.fn(),
  selectChapter: vi.fn(),
  createWork: vi.fn(() => null),
  renameWork: vi.fn(() => false),
  deleteWork: vi.fn(),
  resetTemplate: vi.fn(async () => null),
  createChapter: vi.fn(() => null),
  createVolume: vi.fn(() => null),
  deleteChapter: vi.fn(),
  deleteVolume: vi.fn(),
  reorderChapters: vi.fn(),
  moveChapterToVolume: vi.fn(),
  reorderVolumes: vi.fn(),
  markSelectionAsEntity: vi.fn(() => null),
  updateEntity: vi.fn(),
  bindTextToEntity: vi.fn(() => null),
  addLink: vi.fn(() => false),
  removeLink: vi.fn(),
  addNote: vi.fn(),
  updateNote: vi.fn(),
  removeNote: vi.fn(),
  addOutlineEntry: vi.fn(() => null),
  updateOutlineEntry: vi.fn(),
  toggleOutlineEntryStatus: vi.fn(),
  removeOutlineEntry: vi.fn(),
  rollbackSnapshot: vi.fn(async () => null),
  updateChapterOutlineNote: vi.fn(),
  migrateEntityType: vi.fn(() => 0),
  setEntityLevel: vi.fn(),
};
vi.mock("./useNovelData", () => ({ useNovelData: () => dataStub }));

vi.mock("./useNovelEditorState", async () => {
  const real = await vi.importActual<typeof import("../novel-config")>(
    "../novel-config",
  );
  return {
    useNovelEditorState: () => ({
      settings: real.DEFAULT_SETTINGS,
      selection: null,
      flushSave: vi.fn(async () => true),
      clearDrafts: vi.fn(),
      dropChapterDraft: vi.fn(),
      dismissRecovery: vi.fn(),
      applyExternalContent: vi.fn(),
      setSelection: vi.fn(),
      markSelection: vi.fn(() => null),
    }),
  };
});

// ⚠️ 不 mock useNovelShortcuts：要让真实的 window keydown → handleEscape 通路生效
const { useNovelPage } = await import("./useNovelPage");
const { useNovelShortcuts } = await import("./useNovelShortcuts");

/** 用一次真实 keydown 事件驱动整条链 */
function pressEscape(): void {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
}

describe("Esc 逐层关闭链（REQ-050 回归面）", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("本测试走的是真 useNovelShortcuts（不是桩）：真实 keydown 能触达 onEscape", () => {
    // 若有人把 useNovelShortcuts 也 mock 掉，下面的链验证就退化成「测桩」。
    // 这里用真 Hook 挂载 + 真事件确认通路成立。
    expect(typeof useNovelShortcuts).toBe("function");
    const onEscape = vi.fn();
    renderHook(() =>
      useNovelShortcuts({
        onSave: vi.fn(),
        onJump: vi.fn(),
        onNewChapter: vi.fn(),
        onToggleFocus: vi.fn(),
        onTogglePack: vi.fn(),
        onOpenSettings: vi.fn(),
        onEscape,
      }),
    );
    pressEscape();
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("四层全开：Esc 依次关 设定中心 → 排版 → 快照 → 专注，各一次到位", () => {
    const { result, unmount } = renderHook(() => useNovelPage());
    const view = result.current.view;

    act(() => {
      view.openSettingCenter(null);
      view.openSettings();
      view.openSnapshot();
      view.toggleFocus();
    });
    expect(result.current.view.settingCenterOpen).toBe(true);
    expect(result.current.view.settingsOpen).toBe(true);
    expect(result.current.view.snapshotOpen).toBe(true);
    expect(result.current.view.focusMode).toBe(true);

    // 第 1 击：最上层「设定中心」关闭，其余三层纹丝不动
    pressEscape();
    expect(result.current.view.settingCenterOpen).toBe(false);
    expect(result.current.view.settingsOpen).toBe(true);
    expect(result.current.view.snapshotOpen).toBe(true);
    expect(result.current.view.focusMode).toBe(true);

    // 第 2 击：排版抽屉
    pressEscape();
    expect(result.current.view.settingCenterOpen).toBe(false);
    expect(result.current.view.settingsOpen).toBe(false);
    expect(result.current.view.snapshotOpen).toBe(true);
    expect(result.current.view.focusMode).toBe(true);

    // 第 3 击：快照
    pressEscape();
    expect(result.current.view.snapshotOpen).toBe(false);
    expect(result.current.view.focusMode).toBe(true);

    // 第 4 击：专注模式
    pressEscape();
    expect(result.current.view.focusMode).toBe(false);

    // 第 5 击：全空 → 空转，不抛、不改任何状态
    expect(() => pressEscape()).not.toThrow();
    expect(result.current.view.settingCenterOpen).toBe(false);
    expect(result.current.view.settingsOpen).toBe(false);
    expect(result.current.view.snapshotOpen).toBe(false);
    expect(result.current.view.focusMode).toBe(false);

    unmount();
  });

  it("优先级正确：只开「快照 + 专注」时，Esc 先关快照而不是先退专注", () => {
    const { result } = renderHook(() => useNovelPage());

    act(() => {
      result.current.view.openSnapshot();
      result.current.view.toggleFocus();
    });

    pressEscape();
    expect(result.current.view.snapshotOpen).toBe(false);
    // 专注仍在：说明快照排在专注之前，没被打穿
    expect(result.current.view.focusMode).toBe(true);

    pressEscape();
    expect(result.current.view.focusMode).toBe(false);
  });

  it("优先级正确：只开「设定中心 + 专注」时，Esc 先关设定中心", () => {
    const { result } = renderHook(() => useNovelPage());

    act(() => {
      result.current.view.openSettingCenter(null);
      result.current.view.toggleFocus();
    });

    pressEscape();
    expect(result.current.view.settingCenterOpen).toBe(false);
    expect(result.current.view.focusMode).toBe(true);
  });

  it("顶栏 toggle 打开设定中心后，Esc 也能收起（toggle 与 Esc 同一开关语义）", () => {
    const { result } = renderHook(() => useNovelPage());

    act(() => result.current.view.toggleSettingCenter());
    expect(result.current.view.settingCenterOpen).toBe(true);

    pressEscape();
    expect(result.current.view.settingCenterOpen).toBe(false);
    // 收起时聚焦分类一并清空（下次从顶栏打开不停在旧分类）
    expect(result.current.view.settingFocusId).toBeNull();
  });

  it("Esc 不会误伤正在输入：IME 组合期（isComposing）事件被放行，链不动", () => {
    const { result } = renderHook(() => useNovelPage());
    act(() => result.current.view.openSettings());

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          isComposing: true,
        }),
      );
    });
    // 组合期不处理：排版抽屉保持打开
    expect(result.current.view.settingsOpen).toBe(true);
  });
});
