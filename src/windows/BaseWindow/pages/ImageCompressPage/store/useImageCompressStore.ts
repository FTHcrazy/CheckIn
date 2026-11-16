/**
 * 图片压缩页的状态与队列编排。
 *
 * 为什么用 store 而不是页面内 hook（§6.2 的三条信号都命中了）：
 * 1. 参数面板、汇总条、文件列表、对比弹窗是四个兄弟组件，状态提上去还要再透传一层；
 * 2. 队列是**串行异步**的，用组件 effect 驱动必然要写「用 ref 镜像最新 items/options」
 *    那一套，回调里读到的还是挂载时的快照；
 * 3. 用户切走页面再回来，已经压好的结果不该消失（组件卸载会丢 state）。
 *
 * store 里只放状态与调度；真正的编解码在 `image-encoder.ts`（本地纯引擎，不是
 * 数据访问层，因此这里直接 import，不套 §6.2 的「runner 注册」那一层）。
 */

import { create } from "zustand";
import { compressImage } from "../image-encoder";
import { DEFAULT_OPTIONS } from "../image-compress-utils";
import type {
  CompressItem,
  CompressOptions,
  CompressStatus,
} from "../image-compress-types";

/** 单次压缩任务的令牌：参数一变就作废旧任务，避免旧结果覆盖新参数的结果 */
let runToken = 0;
let itemSeq = 0;
/** 正在进行的那一轮（新一轮要等它退出，避免同一张图被并行压两遍） */
let activeRun: Promise<void> | null = null;

interface ImageCompressState {
  items: CompressItem[];
  options: CompressOptions;
  processing: boolean;
  /** 加入文件（过滤掉非图片与 SVG，二者都压不了） */
  addFiles: (files: File[]) => void;
  removeItem: (id: number) => void;
  clearAll: () => void;
  setOptions: (patch: Partial<CompressOptions>) => void;
  /** 参数没变时手动重跑（例如换了目标体积想再试一次） */
  rerun: () => void;
}

function patchItem(
  items: CompressItem[],
  id: number,
  patch: Partial<CompressItem>,
): CompressItem[] {
  return items.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

function isCompressible(file: File): boolean {
  if (!file.type.startsWith("image/")) return false;
  // SVG 是矢量，光栅化后再压没有意义，两个参考工具也都直接拒收
  return file.type !== "image/svg+xml";
}

export const useImageCompressStore = create<ImageCompressState>()((set, get) => {
  /** 串行处理给定条目；令牌失配即退出（参数变更 / 清空 / 新一轮开始） */
  async function run(ids: number[]): Promise<void> {
    const myToken = ++runToken;
    if (ids.length === 0) {
      set({ processing: false });
      return;
    }
    set({ processing: true });

    for (const id of ids) {
      if (myToken !== runToken) return;
      const item = get().items.find((entry) => entry.id === id);
      if (!item) continue;

      set((state) => ({
        items: patchItem(state.items, id, { status: "working" as CompressStatus, error: "" }),
      }));

      try {
        const result = await compressImage(item.file, get().options);
        if (myToken !== runToken) return;

        const blob = result.blob ?? item.file;
        const resultUrl = URL.createObjectURL(blob);
        const previous = get().items.find((entry) => entry.id === id)?.resultUrl;
        if (previous) URL.revokeObjectURL(previous);

        set((state) => {
          const current = state.items.find((entry) => entry.id === id);
          if (!current) {
            // 条目在处理期间被移除：把刚建的 URL 立刻回收，别泄漏
            URL.revokeObjectURL(resultUrl);
            return state;
          }
          return {
            items: patchItem(state.items, id, {
              status: "done",
              outBlob: result.blob,
              outSize: result.size,
              outWidth: result.width,
              outHeight: result.height,
              outType: result.type,
              origWidth: result.origWidth,
              origHeight: result.origHeight,
              applied: result.applied,
              passthrough: result.blob === null,
              oversize: result.oversize,
              resultUrl,
              error: "",
            }),
          };
        });
      } catch (error) {
        if (myToken !== runToken) return;
        const message = error instanceof Error ? error.message : String(error);
        set((state) => ({
          items: patchItem(state.items, id, {
            status: "error" as CompressStatus,
            error: message,
          }),
        }));
      }
    }

    if (myToken === runToken) set({ processing: false });
  }

  function schedule(ids: number[]): void {
    // 新一轮要等旧一轮退出：旧轮在每个 await 之后都会检查令牌，最多再完成一张
    const previous = activeRun;
    activeRun = (async () => {
      if (previous) await previous.catch(() => undefined);
      await run(ids);
    })();
  }

  return {
    items: [],
    options: DEFAULT_OPTIONS,
    processing: false,

    addFiles: (files) => {
      const accepted = files.filter(isCompressible);
      if (accepted.length === 0) return;
      const created: CompressItem[] = accepted.map((file) => {
        itemSeq += 1;
        return {
          id: itemSeq,
          file,
          name: file.name || `粘贴图片-${itemSeq}.png`,
          origSize: file.size,
          origType: file.type,
          origWidth: 0,
          origHeight: 0,
          status: "pending" as CompressStatus,
          outBlob: null,
          outSize: 0,
          outWidth: 0,
          outHeight: 0,
          outType: "image/png" as const,
          applied: "",
          passthrough: false,
          oversize: false,
          error: "",
          previewUrl: URL.createObjectURL(file),
          resultUrl: "",
        };
      });
      set((state) => ({ items: [...state.items, ...created] }));
      schedule(created.map((item) => item.id));
    },

    removeItem: (id) => {
      const target = get().items.find((item) => item.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        if (target.resultUrl) URL.revokeObjectURL(target.resultUrl);
      }
      set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
    },

    clearAll: () => {
      for (const item of get().items) {
        URL.revokeObjectURL(item.previewUrl);
        if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
      }
      set({ items: [], processing: false });
    },

    setOptions: (patch) => {
      const next = { ...get().options, ...patch };
      const changed = (Object.keys(patch) as Array<keyof CompressOptions>).some(
        (key) => get().options[key] !== next[key],
      );
      if (!changed) return;
      set({ options: next });
      const ids = get().items.map((item) => item.id);
      if (ids.length > 0) schedule(ids);
    },

    rerun: () => {
      const ids = get().items.map((item) => item.id);
      if (ids.length > 0) schedule(ids);
    },
  };
});
