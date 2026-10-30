/**
 * useNovelData 全局库变更 → 本书引用镜像就地刷新测试（1.45.1 P0-1）。
 *
 * ── 报障成因 ──
 * 1.45.0 的「引用实时同步」只做在主进程：全局写成功后主进程已把新值按
 * `source_global_id` upsert 进本书的 `novel_setting_*` 镜像行 —— **库里是对的**。
 * 但书窗口的 `bundle` 是一份内存快照，而唯一订阅 `global-setting-changed`
 * 的是全局设定中心窗口自己；书窗口不跟进，于是在全局库里改了分类名，书窗口的
 * 设定中心仍显示旧值（要切作品 / 重开窗口才看得到）。
 *
 * 这里钉住订阅后的刷新语义：
 * 1. 本书没有引用项 → 整条链路不空转（不发 IPC、不换引用）；
 * 2. 只替换「引用态」行，书内自建分类与 chapters（正文基线）一律不动；
 * 3. 全局项被删时镜像会就地固化（`sourceGlobalId` → null），那一行同样要跟；
 * 4. 装载在途跳过（装载响应本身就带库内最新值）；
 * 5. 卸载时按同一 handler 引用退订，不留悬挂监听。
 *
 * 服务层整体 mock：只验证 hook 的状态编排，IPC 由 handler 负责。
 */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ElectronAPI,
  NovelBundleDTO,
  NovelChapterDTO,
  NovelSettingCategoryDTO,
} from "@/shared/types/electron";
import { useNovelEditorStore } from "../store/useNovelEditorStore";

type Handler = (...args: unknown[]) => void;

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
  fetchSettingMirror: vi.fn(),
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

const GLOBAL_EVENT = "global-setting-changed";

// ── 广播订阅桩 ──
// preload 的 on/off 按 handler **引用**配对，所以这里用真实 Map 承载监听，
// 「卸载后还有没有人收到广播」才能被断言到。
let subscribers: Map<string, Set<Handler>>;
const onSpy = vi.fn((event: string, handler: Handler) => {
  const set = subscribers.get(event) ?? new Set<Handler>();
  set.add(handler);
  subscribers.set(event, set);
});
const offSpy = vi.fn((event: string, handler: Handler) => {
  subscribers.get(event)?.delete(handler);
});

/** 触发一次全局库变更广播（主进程只发事件名，负载本 hook 不看） */
function emitGlobalChanged(): void {
  for (const handler of [...(subscribers.get(GLOBAL_EVENT) ?? [])]) {
    handler({ kinds: ["category"] });
  }
}

// ── fixtures ──

function makeCategory(
  overrides: Partial<NovelSettingCategoryDTO> & { id: string },
): NovelSettingCategoryDTO {
  return {
    workId: "w1",
    name: "分类",
    color: "#888888",
    kind: "custom",
    sortOrder: 0,
    note: "",
    subLevels: 0,
    carryDir: "asc",
    subPattern: "",
    levels: [],
    sourceGlobalId: null,
    detachedFromName: null,
    ...overrides,
  };
}

function makeChapter(overrides: Partial<NovelChapterDTO> & { id: string }): NovelChapterDTO {
  return {
    workId: "w1",
    volumeId: "",
    title: "第一章",
    content: "正文草稿基线",
    wordCount: 6,
    status: "draft",
    sort: 0,
    updatedAt: 1,
    ...overrides,
  };
}

function makeBundle(
  overrides: { settings?: NovelSettingCategoryDTO[]; chapters?: NovelChapterDTO[] } = {},
): NovelBundleDTO {
  return {
    works: [{ id: "w1", name: "测试书", createdAt: 1 }],
    volumes: [],
    chapters: overrides.chapters ?? [],
    entities: [],
    links: [],
    settings: overrides.settings ?? [],
    notes: [],
    outlineEntries: [],
    recovery: null,
  };
}

/** ⚠️ 返回 renderHook 的完整结果：`result.current` 会被换引用，需按需取用 */
async function renderLoadedBundle(bundle: NovelBundleDTO) {
  serviceMocks.fetchNovelBundle.mockResolvedValue(bundle);
  serviceMocks.fetchLastPosition.mockResolvedValue(null);
  serviceMocks.fetchNameFavorites.mockResolvedValue("[]");
  const rendered = renderHook(() => useNovelData());
  await waitFor(() => expect(rendered.result.current.loading).toBe(false));
  return rendered;
}

beforeEach(() => {
  vi.clearAllMocks();
  subscribers = new Map();
  serviceMocks.openEditorSession.mockResolvedValue(true);
  Object.defineProperty(window, "electronAPI", {
    writable: true,
    configurable: true,
    value: {
      windowAPI: {
        on: onSpy,
        off: offSpy,
        broadcast: vi.fn(async () => {}),
        sendTo: vi.fn(async () => {}),
      },
    } as unknown as ElectronAPI,
  });
});

afterEach(() => {
  cleanup();
  // store 是模块级单例：清掉本文件造过的草稿，避免同文件后续用例读到脏值
  useNovelEditorStore.setState({ draftMap: {} });
});

describe("全局库变更 → 本书引用镜像（1.45.1 P0-1）", () => {
  it("本书无引用项 → 不发 IPC、不换引用（整条链路不空转）", async () => {
    const selfBuilt = makeCategory({ id: "c-self", name: "书内自建" });
    const rendered = await renderLoadedBundle(makeBundle({ settings: [selfBuilt] }));
    const before = rendered.result.current.settings;

    await act(async () => {
      emitGlobalChanged();
    });

    expect(serviceMocks.fetchSettingMirror).not.toHaveBeenCalled();
    expect(rendered.result.current.settings).toBe(before);
  });

  it("有引用项 → 只换引用行，自建分类与 chapters（正文基线）原样保留", async () => {
    const referenced = makeCategory({
      id: "c-ref",
      name: "旧名",
      sourceGlobalId: "g-1",
    });
    const selfBuilt = makeCategory({ id: "c-self", name: "书内自建" });
    const chapter = makeChapter({ id: "ch-1" });
    const rendered = await renderLoadedBundle(
      makeBundle({ settings: [referenced, selfBuilt], chapters: [chapter] }),
    );
    const chaptersBefore = rendered.result.current.chapters;
    const activeChapterBefore = rendered.result.current.activeChapter;

    // 镜像读数：引用行的名字已在全局库改过；自建分类在库里的版本故意给成旧值，
    // 用来证明「不是引用」的行不会被这次刷新覆盖
    serviceMocks.fetchSettingMirror.mockResolvedValue([
      { ...referenced, name: "改过的引用名" },
      { ...selfBuilt, name: "库里的旧值" },
    ]);

    await act(async () => {
      emitGlobalChanged();
    });

    expect(serviceMocks.fetchSettingMirror).toHaveBeenCalledTimes(1);
    const settings = rendered.result.current.settings;
    expect(settings.find((category) => category.id === "c-ref")?.name).toBe("改过的引用名");
    expect(settings.find((category) => category.id === "c-self")?.name).toBe("书内自建");
    // 正文基线：chapters 表整体没被碰（同一引用），当前章对象也未变
    expect(rendered.result.current.chapters).toBe(chaptersBefore);
    expect(rendered.result.current.activeChapter).toBe(activeChapterBefore);
    expect(rendered.result.current.chapters[0]?.content).toBe("正文草稿基线");
  });

  it("全局项被删（sourceGlobalId → null 就地固化）→ 那一行同样跟随", async () => {
    const referenced = makeCategory({ id: "c-ref", name: "旧名", sourceGlobalId: "g-1" });
    const rendered = await renderLoadedBundle(makeBundle({ settings: [referenced] }));

    serviceMocks.fetchSettingMirror.mockResolvedValue([
      {
        ...referenced,
        name: "固化后的本书副本",
        sourceGlobalId: null,
        detachedFromName: "被删掉的全局项",
      },
    ]);

    await act(async () => {
      emitGlobalChanged();
    });

    // 判据看「当前行是不是引用」：本地这一行刷新前仍是引用态 → 会跟
    const row = rendered.result.current.settings.find((category) => category.id === "c-ref");
    expect(row?.name).toBe("固化后的本书副本");
    expect(row?.sourceGlobalId ?? null).toBeNull();
  });

  it("装载在途 → 广播被跳过；装载完成后再来的照常刷新", async () => {
    let resolveBundle!: (bundle: NovelBundleDTO) => void;
    serviceMocks.fetchNovelBundle.mockImplementation(
      () =>
        new Promise<NovelBundleDTO>((resolve) => {
          resolveBundle = resolve;
        }),
    );
    serviceMocks.fetchLastPosition.mockResolvedValue(null);
    serviceMocks.fetchNameFavorites.mockResolvedValue("[]");
    const rendered = renderHook(() => useNovelData());

    expect(rendered.result.current.loading).toBe(true);
    act(() => {
      emitGlobalChanged();
    });
    expect(serviceMocks.fetchSettingMirror).not.toHaveBeenCalled();

    act(() => {
      resolveBundle(
        makeBundle({ settings: [makeCategory({ id: "c-ref", sourceGlobalId: "g-1" })] }),
      );
    });
    await waitFor(() => expect(rendered.result.current.loading).toBe(false));

    serviceMocks.fetchSettingMirror.mockResolvedValue([]);
    await act(async () => {
      emitGlobalChanged();
    });
    expect(serviceMocks.fetchSettingMirror).toHaveBeenCalledTimes(1);
  });

  it("卸载 → 按同一 handler 引用退订，广播不再有订阅者", async () => {
    const rendered = await renderLoadedBundle(
      makeBundle({ settings: [makeCategory({ id: "c-ref", sourceGlobalId: "g-1" })] }),
    );
    const registered = onSpy.mock.calls.find(([event]) => event === GLOBAL_EVENT)?.[1];
    expect(registered).toBeTypeOf("function");
    expect(subscribers.get(GLOBAL_EVENT)?.size).toBe(1);

    rendered.unmount();

    const unregistered = offSpy.mock.calls.find(([event]) => event === GLOBAL_EVENT)?.[1];
    expect(unregistered).toBe(registered);
    expect(subscribers.get(GLOBAL_EVENT)?.size).toBe(0);
  });

  /**
   * 草稿安全的**回归网**（本文件唯一一处跨到编辑器 store 的断言）。
   *
   * 为什么这条必须有：上面几例只钉住「只换 settings 表 / 只换引用行 / 成对退订」，
   * 而「不动编辑器草稿」这句话此前只有推理、没有断言 —— 将来若有人把
   * `refreshSettingMirror` 换成整体 `load()`，正是这条会先红。
   *
   * 不变量有两条，缺一不可：
   * 1. `draftMap` 引用不变（store 与 bundle 无关，刷新不该碰它）；
   * 2. 本章 `chapter` **对象引用**不变 —— `NovelPage` 把它作为 `activeChapter`
   *    传给**没有 key** 的 `EditorPane`（`NovelPage.tsx:510`），而 EditorPane 取的是
   *    `draft ?? chapter?.content`：引用一变就可能重挂载 / 重新灌入，正在编辑的
   *    正文基线随之被顶掉。
   */
  it("广播刷新不触碰编辑器草稿（draftMap 引用不变 + 当前章对象不变）", async () => {
    const referenced = makeCategory({ id: "c-ref", name: "旧名", sourceGlobalId: "g-1" });
    const chapter = makeChapter({ id: "ch-1" });
    const rendered = await renderLoadedBundle(
      makeBundle({ settings: [referenced], chapters: [chapter] }),
    );
    const activeChapterBefore = rendered.result.current.activeChapter;

    // 造一份「打了一半、还没落库」的脏草稿
    useNovelEditorStore.setState({ draftMap: { "ch-1": "打了一半的新正文" } });
    const draftBefore = useNovelEditorStore.getState().draftMap;

    serviceMocks.fetchSettingMirror.mockResolvedValue([
      { ...referenced, name: "改过的引用名" },
    ]);
    await act(async () => {
      emitGlobalChanged();
    });

    // 刷新确实发生了 …
    expect(
      rendered.result.current.settings.find((category) => category.id === "c-ref")?.name,
    ).toBe("改过的引用名");
    // … 但编辑器侧一个字都没动
    expect(useNovelEditorStore.getState().draftMap).toBe(draftBefore);
    expect(useNovelEditorStore.getState().draftMap["ch-1"]).toBe("打了一半的新正文");
    expect(rendered.result.current.activeChapter).toBe(activeChapterBefore);
  });
});
