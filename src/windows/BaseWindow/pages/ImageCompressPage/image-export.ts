/**
 * 结果落盘：单张下载与批量打包。
 *
 * 下载动作走 `shared/utils/download`（object URL + `<a download>`），
 * 这里只负责「该拿哪个 Blob」与 zip 内的命名去重。
 */

import JSZip from "jszip";
import { downloadBlob } from "@/shared/utils/download";
import { archiveStamp, outputNameOf, uniqueName } from "./image-compress-utils";
import type { CompressItem } from "./image-compress-types";

/** 该条目可下载的产物：原样保留时就是原文件 */
function payloadOf(item: CompressItem): Blob | null {
  if (item.status !== "done") return null;
  return item.outBlob ?? item.file;
}

export function downloadItem(item: CompressItem, filename: string): boolean {
  const blob = payloadOf(item);
  if (!blob) return false;
  downloadBlob(blob, filename);
  return true;
}

/**
 * 批量打包：只打包已完成的条目，同名文件改用 `-2` `-3` 后缀，避免 zip 里互相覆盖。
 * 返回实际打包的数量，供 UI 提示「有几个还在处理中」。
 */
export async function downloadArchive(items: CompressItem[]): Promise<number> {
  const ready = items.filter((item) => payloadOf(item) !== null);
  if (ready.length === 0) return 0;

  const zip = new JSZip();
  const used = new Set<string>();
  for (const item of ready) {
    const blob = payloadOf(item);
    if (!blob) continue;
    zip.file(uniqueName(outputNameOf(item), used), blob);
  }

  const archive = await zip.generateAsync({ type: "blob" });
  downloadBlob(archive, `图片压缩-${archiveStamp(new Date())}.zip`);
  return ready.length;
}
