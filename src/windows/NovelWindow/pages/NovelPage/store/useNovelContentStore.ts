/**
 * 章节正文懒加载缓存（模块级 Zustand store）
 *
 * 为什么抽成 store：正文懒加载后，`useNovelData` 的 `chapters` 数组不再天然携带
 * 全部正文（editor-load 只取元数据，content 为空串）。而搜索 / 导出 / 全书扫描 /
 * 要素出场 / 一致性校对 / 改名同步 / 卡文救援 7 类功能都遍历 `chapter.content`，
 * 它们跨组件、跨 hook，不能各自维护一份「已加载」状态 —— 用 store 收口：
 * 谁触发「需要全量正文」的动作，就先 `ensureAll` 把缺失正文回填进 store，
 * 之后所有读 `chapter.content` 的地方自然拿到正确值。
 *
 * 边界（沿用 useSearchStore / useNovelEditorStore 的 runner 范式）：
 * store 不 import service、不认识 data Hook，正文拉取由页面注册的
 * `fetcher` runner 提供（registerContentFetcher）。这样 store 可被任意
 * 消费方订阅，而 IPC 通道只在注册点出现一次。
 *
 * 「未加载」与「空章」必须区分：content 为空串可能是「这章真的没写」，
 * 也可能是「正文还没拉下来」。用 `loaded` 集合标记后者 —— 只有 loaded
 * 里有的 id，其 content 才是可信的最终值。
 */

import { create } from "zustand";

/** 正文拉取能力（由页面注册；单章 + 批量两条通道） */
export interface ContentFetcher {
  /** 拉取单章正文（当前章 / 相邻章预取） */
  fetchOne: (chapterId: string) => Promise<string | null>;
  /** 批量拉取正文（全书扫描等触发时回填），返回 Record<id, content> */
  fetchMany: (chapterIds: string[]) => Promise<Record<string, string>>;
}

interface NovelContentState {
  /** 已加载的章节正文（id → content）。空串可能是「空章」，需配合 loaded 判断。 */
  contents: Record<string, string>;
  /** 已确认加载过的章节 id 集合（content 可信最终值）。 */
  loaded: ReadonlySet<string>;
  /** 在途的批量拉取 Promise（去重：并发触发同一次回填）。 */
  inflightAll: Promise<void> | null;
  /** 注册正文拉取 runner（页面挂载时调用，返回反注册）。 */
  registerFetcher: (fetcher: ContentFetcher | null) => void;
  /** 拉取单章正文并写入缓存（幂等：已加载则跳过）。 */
  ensureOne: (chapterId: string) => Promise<void>;
  /** 批量拉取并写入缓存（只拉未加载的；并发共享同一次在途请求）。 */
  ensureMany: (chapterIds: string[]) => Promise<void>;
  /** 确保给定集合内所有章节的正文都已加载（全书扫描等触发前调用）。 */
  ensureAll: (chapterIds: string[]) => Promise<void>;
  /** 同步读某章正文（未加载返回空串；消费方应先 ensure）。 */
  contentOf: (chapterId: string) => string;
  /** 某章正文是否已确认加载（区分「未加载」与「空章」）。 */
  isLoaded: (chapterId: string) => boolean;
  /** 覆盖某章正文（保存正文后同步缓存，避免派生 chapters 拿旧值）。 */
  setContent: (chapterId: string, content: string) => void;
  /** 清空缓存（重置模板 / 删书后调用，避免残留已删章节的正文）。 */
  reset: () => void;
}

let fetcher: ContentFetcher | null = null;

export const useNovelContentStore = create<NovelContentState>((set, get) => {
  /** 把一批正文并进缓存，返回是否真的新增了内容 */
  const mergeContents = (incoming: Record<string, string>): boolean => {
    const current = get();
    let changed = false;
    const nextContents = { ...current.contents };
    const nextLoaded = new Set(current.loaded);
    for (const [id, content] of Object.entries(incoming)) {
      if (nextLoaded.has(id)) continue;
      nextContents[id] = content;
      nextLoaded.add(id);
      changed = true;
    }
    if (!changed) return false;
    set({ contents: nextContents, loaded: nextLoaded });
    return true;
  };

  return {
    contents: {},
    loaded: new Set(),
    inflightAll: null,

    registerFetcher: (next) => {
      fetcher = next;
    },

    ensureOne: async (chapterId) => {
      if (!chapterId || get().loaded.has(chapterId)) return;
      if (!fetcher) return;
      const content = await fetcher.fetchOne(chapterId);
      // 章节不存在 / 已删除返回 null：记为「已加载但无正文」，避免反复重拉
      mergeContents({ [chapterId]: content ?? "" });
    },

    ensureMany: async (chapterIds) => {
      const missing = chapterIds.filter(
        (id) => id && !get().loaded.has(id),
      );
      if (missing.length === 0) return;
      if (!fetcher) return;
      const incoming = await fetcher.fetchMany(missing);
      // 缺键 = 章节已删除：mergeContents 只并存在键，删除章节自然不占 loaded，
      // 下次仍会重拉 —— 但删除章节不会再出现在 chapters 里，可接受
      mergeContents(incoming);
      // 对「库里已经没有」的章节（fetchMany 缺键）也标记为 loaded，避免反复重拉
      const result = get();
      const orphan = missing.filter((id) => !result.loaded.has(id));
      if (orphan.length > 0) {
        const patch: Record<string, string> = {};
        for (const id of orphan) patch[id] = "";
        mergeContents(patch);
      }
    },

    ensureAll: async (chapterIds) => {
      const missing = chapterIds.filter(
        (id) => id && !get().loaded.has(id),
      );
      if (missing.length === 0) return;
      // 并发共享：一次触发里多个消费方同时 ensureAll，只发一次请求
      if (get().inflightAll) {
        await get().inflightAll;
        return;
      }
      const task = get().ensureMany(missing).finally(() => {
        set({ inflightAll: null });
      });
      set({ inflightAll: task });
      await task;
    },

    contentOf: (chapterId) => get().contents[chapterId] ?? "",

    isLoaded: (chapterId) => get().loaded.has(chapterId),

    setContent: (chapterId, content) => {
      const current = get();
      const nextContents = { ...current.contents, [chapterId]: content };
      const nextLoaded = new Set(current.loaded);
      nextLoaded.add(chapterId);
      set({ contents: nextContents, loaded: nextLoaded });
    },

    reset: () => {
      set({ contents: {}, loaded: new Set(), inflightAll: null });
    },
  };
});
