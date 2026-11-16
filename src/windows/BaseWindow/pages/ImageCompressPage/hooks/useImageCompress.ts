/**
 * 图片压缩页的组合层 Hook（§6.2.1：组件只订阅状态、派发动作）。
 *
 * 汇总与计数在这里派生，避免四个兄弟组件各算一遍导致口径分叉
 * （比如汇总条算 done 条目、列表算全部条目，两个数字对不上）。
 */

import { useMemo } from "react";
import { useImageCompressStore } from "../store/useImageCompressStore";
import { summarize } from "../image-compress-utils";
import type { CompressOptions } from "../image-compress-types";

export function useImageCompress() {
  const items = useImageCompressStore((state) => state.items);
  const options = useImageCompressStore((state) => state.options);
  const processing = useImageCompressStore((state) => state.processing);
  const addFiles = useImageCompressStore((state) => state.addFiles);
  const removeItem = useImageCompressStore((state) => state.removeItem);
  const clearAll = useImageCompressStore((state) => state.clearAll);
  const setOptions = useImageCompressStore((state) => state.setOptions);
  const rerun = useImageCompressStore((state) => state.rerun);

  const summary = useMemo(() => summarize(items), [items]);

  const pendingCount = useMemo(
    () =>
      items.filter(
        (item) => item.status === "pending" || item.status === "working",
      ).length,
    [items],
  );

  return {
    items,
    options,
    processing,
    summary,
    pendingCount,
    addFiles,
    removeItem,
    clearAll,
    setOptions: (patch: Partial<CompressOptions>) => setOptions(patch),
    rerun,
  };
}
