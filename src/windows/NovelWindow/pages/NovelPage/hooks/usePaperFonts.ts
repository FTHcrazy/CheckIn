import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NovelFontEntry } from "@/shared/types/electron";
import type { PaperFontCandidate } from "../paper-fonts";

/**
 * 正文字体管理 hook（下载 / 列表 / @font-face 挂载 / 预览）
 *
 * 职责分层：
 * - `installed`：已下载到 `{userData}/fonts/` 的字体（启动时拉一次，下载后刷新）；
 *   每个字体的 `fileUrl` 通过动态注入 `<style>` 的 @font-face 注册，正文
 *   `font-family` 指向 `family` 即可命中。
 * - `previewFont(candidate)`：预览用 —— 动态 `<link>` 加载候选的 webfont CSS
 *   （jsDelivr），不落盘；预览区的 `<span style="font-family: ...">` 随之生效。
 * - `download(candidate)`：调主进程下载字体文件到 fonts/，成功后刷新 installed。
 * - `remove(entry)`：删除已下载字体。
 *
 * 所有 @font-face / preview 的 DOM 节点都由本 hook 持有，卸载时清理。
 */
export interface PaperFontState {
  /** 已下载字体列表（fileUrl 已注册 @font-face） */
  installed: NovelFontEntry[];
  /** 当前正文字体 family（空 = 跟随系统） */
  activeFamily: string;
  /** 是否正在下载某个候选 */
  downloadingId: string | null;
  /** 下载错误消息（可展示） */
  error: string | null;
  preview: (candidate: PaperFontCandidate) => void;
  download: (candidate: PaperFontCandidate) => Promise<boolean>;
  remove: (entry: NovelFontEntry) => Promise<void>;
  /** 设置正文字体（先确保字体就绪，再回写 settings.paperFont） */
  select: (family: string) => Promise<void>;
}

/** 已注入 @font-face 的 family 集合（去重，避免重复注入同名规则） */
const registeredFamilies = new Set<string>();
/** 已加载 preview CSS 的 href 集合（去重） */
const loadedPreviewCss = new Set<string>();

/** 注入 @font-face：family → fileUrl（format 按文件真实扩展名声明） */
function injectFontFace(family: string, fileUrl: string): void {
  if (registeredFamilies.has(family)) return;
  const format = /\.woff2$/i.test(fileUrl)
    ? "woff2"
    : /\.woff$/i.test(fileUrl)
      ? "woff"
      : "truetype"; // ttf / otf
  const style = document.createElement("style");
  style.dataset.nvFont = family;
  style.textContent = `@font-face{font-family:"${family}";src:url("${fileUrl}") format("${format}");font-display:swap;}`;
  document.head.appendChild(style);
  registeredFamilies.add(family);
}

/**
 * 摘掉某 family 的预览 webfont CSS（<link>）。
 *
 * ⚠️ 必须在下载成功后调用：预览 CSS 里是同名 family 的「unicode-range 分片
 * @font-face」，与本地全量 face 同名并存时，命中分片 range 的字符会走 CDN
 * 分片——分片加载失败/慢就回退系统字，表现为「部分字还是系统字」。
 */
function removePreviewCssByFamily(family: string): void {
  const links = document.head.querySelectorAll<HTMLLinkElement>(
    'link[data-nv-preview="1"]',
  );
  for (const link of links) {
    // 预览 CSS 与候选的对应关系：link.href 含包名即可判别（见 paper-fonts.ts）
    const pkg =
      /lxgw-wenkai-webfont/.test(link.href) ? "LXGW WenKai"
      : /noto-serif-sc/.test(link.href) ? "Source Han Serif SC"
      : /noto-sans-sc/.test(link.href) ? "Source Han Sans SC"
      : "";
    if (pkg && pkg === family) {
      link.remove();
      loadedPreviewCss.delete(link.href);
    }
  }
}

/** 注入 preview webfont CSS（<link>） */
function injectPreviewCss(cssUrl: string): void {
  if (!cssUrl || loadedPreviewCss.has(cssUrl)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = cssUrl;
  link.dataset.nvPreview = "1";
  document.head.appendChild(link);
  loadedPreviewCss.add(cssUrl);
}

type DownloadResult =
  | {
      ok: true;
      entry: { family: string; fileName: string; size: number; fileUrl: string };
    }
  | { ok: false; error: string };

/** 主源失败且有备用源时依次尝试（URL 清单见 paper-fonts.ts 各条目注释） */
async function downloadWithFallback(
  download: (url: string, family: string) => Promise<DownloadResult>,
  urls: string[],
  family: string,
): Promise<DownloadResult> {
  let result: DownloadResult = { ok: false, error: "下载失败" };
  for (const url of urls) {
    result = await download(url, family);
    if (result.ok) break;
  }
  return result;
}

export function usePaperFonts(opts: {
  activeFamily: string;
  onSelect: (family: string) => void;
}): PaperFontState {
  const { activeFamily, onSelect } = opts;
  const [installed, setInstalled] = useState<NovelFontEntry[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // onSelect 可能是每次渲染都换的闭包，放 ref 避免进入 effect 依赖
  const selectRef = useRef(onSelect);
  useEffect(() => {
    selectRef.current = onSelect;
  }, [onSelect]);

  // 启动拉取已下载字体 + 注册 @font-face
  useEffect(() => {
    let alive = true;
    void window.electronAPI?.novel.font
      .list()
      .then((list) => {
        if (!alive) return;
        for (const entry of list) {
          injectFontFace(entry.family, entry.fileUrl);
        }
        setInstalled(list);
      })
      .catch(() => {
        if (alive) setError("字体列表读取失败");
      });
    return () => {
      alive = false;
    };
  }, []);

  const preview = useCallback((candidate: PaperFontCandidate): void => {
    // 已下载（本地 face 已挂）的字体不再注入 CDN 预览分片：同名分片规则会
    // 抢走部分字符的渲染，分片加载失败时回退系统字（漏字）。
    if (registeredFamilies.has(candidate.family)) return;
    injectPreviewCss(candidate.previewCss);
  }, []);

  const download = useCallback(
    async (candidate: PaperFontCandidate): Promise<boolean> => {
      const api = window.electronAPI;
      if (!api) return false;
      setError(null);
      setDownloadingId(candidate.id);
      try {
        const urls = [candidate.downloadUrl, candidate.fallbackUrl].filter(
          (u): u is string => typeof u === "string" && u.length > 0,
        );
        const result = await downloadWithFallback(
          (url, family) => api.novel.font.download(url, family),
          urls,
          candidate.family,
        );
        if (!result.ok) {
          setError(result.error);
          return false;
        }
        injectFontFace(result.entry.family, result.entry.fileUrl);
        // 本地 face 已就位，摘掉同名预览分片（分片加载失败会漏字回系统字）
        removePreviewCssByFamily(candidate.family);
        const entry = result.entry;
        setInstalled((prev) => {
          const rest = prev.filter((e) => e.family !== entry.family);
          return [...rest, entry];
        });
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "下载失败");
        return false;
      } finally {
        setDownloadingId(null);
      }
    },
    [],
  );

  const remove = useCallback(async (entry: NovelFontEntry): Promise<void> => {
    const api = window.electronAPI;
    if (!api) return;
    await api.novel.font.delete(entry.fileName);
    // 若当前正文正用这个字体，回退到跟随系统
    if (selectRef.current && activeFamily === entry.family) {
      selectRef.current("");
    }
    setInstalled((prev) => prev.filter((e) => e.fileName !== entry.fileName));
  }, [activeFamily]);

  /**
   * 应用正文字体：先确保字体文件已真正加载完成，再回写 settings.paperFont。
   *
   * 直接回写的问题：`@font-face` 是懒加载 + font-display:swap，点「应用」那一刻
   * 字体文件才开始真正下载（霞鹜文楷全量 19MB），期间正文渲染 fallback，看起来
   * 「没变化」；只有等字体加载完成浏览器才替换，而 CodeMirror 的字体度量缓存
   * 不会主动重测，于是要重启窗口（字体已缓存）才正确。这里用 document.fonts.load
   * 显式触发加载并 await，就绪后才切换，一次到位。
   */
  const select = useCallback(
    async (family: string): Promise<void> => {
      if (family) {
        try {
          await document.fonts.load(`16px "${family}"`);
          // load 只保证「有规则且触发加载」，不一定等到 swap 完成；再等 ready
          // 确保渲染层已拿到真实字形（部分 Chromium 下 load 后仍需一帧）。
          await document.fonts.ready;
        } catch {
          // 字体加载失败也不阻塞切换：回退系统字体，用户能看到真实结果
        }
      }
      onSelect(family);
    },
    [onSelect],
  );

  return useMemo(
    () => ({
      installed,
      activeFamily,
      downloadingId,
      error,
      preview,
      download,
      remove,
      select,
    }),
    [installed, activeFamily, downloadingId, error, preview, download, remove, select],
  );
}

/** 供预览/选择器判断某候选是否已下载（非 hook，纯函数） */
export function useFontDownloaded(installed: NovelFontEntry[]) {
  return useCallback(
    (candidate: PaperFontCandidate): boolean =>
      candidate.family !== "" &&
      installed.some((entry) => entry.family === candidate.family),
    [installed],
  );
}
