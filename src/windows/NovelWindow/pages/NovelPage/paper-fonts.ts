import type { NovelFontEntry } from "@/shared/types/electron";

/**
 * 内置正文字体清单（写作场景精选，全部开源免费、可商用）
 *
 * 每个候选提供两套 URL：
 * - `previewCss`：webfont 分片 CSS（jsDelivr，国内可用），用于「未下载也能预览」
 *   字体效果——动态 <link> 加载，不落盘。
 * - `downloadUrl`：字体文件的官方/稳定直链，点「下载」才真正落盘到
 *   `{userData}/fonts/`，之后经 @font-face 挂载为正文可用字体。
 *
 * 授权一览：
 * - 思源黑体 / 思源宋体：SIL OFL 1.1（Adobe × Google）
 * - 霞鹜文楷 LXGW WenKai：SIL OFL 1.1（基于 Klee One）
 * - 阿里巴巴普惠体：永久免费商用（阿里巴巴官方）
 *
 * ⚠️ 下载直链是外部资源，版本更新可能失效；失效时用户在字体选择器里可用
 * 「导入本地字体」兜底（上传 .ttf/.otf）。清单是数据而非逻辑，增删字体只改这里。
 */
export interface PaperFontCandidate {
  /** 唯一 id（用于选中态 / 下载去重） */
  id: string;
  /** @font-face 的 font-family（下载后正文用这个 family 引用） */
  family: string;
  /** 展示名 */
  label: string;
  /** 风格标签（宋体 / 黑体 / 楷体…） */
  style: string;
  /** 一句话适用说明 */
  hint: string;
  /** 预览 webfont CSS 直链（jsDelivr） */
  previewCss: string;
  /** 字体文件直链（下载用；.ttf/.otf/.woff2） */
  downloadUrl: string;
  /**
   * 备用直链（downloadUrl 失败时依次尝试）。
   * 主源与备用源的取舍见各条目注释；两源版本可能略有差异。
   */
  fallbackUrl?: string;
}

export const PAPER_FONT_CANDIDATES: PaperFontCandidate[] = [
  {
    id: "system",
    family: "",
    label: "跟随系统",
    style: "默认",
    hint: "不指定字体，使用系统默认正文",
    previewCss: "",
    downloadUrl: "",
  },
  {
    id: "source-han-serif",
    family: "Source Han Serif SC",
    label: "思源宋体",
    style: "宋体",
    hint: "横细竖粗、端庄，出版感与正式感强",
    previewCss:
      "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.1.0/index.css",
    downloadUrl:
      "https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.1.0/files/noto-serif-sc-chinese-simplified-400-normal.woff2",
  },
  {
    id: "source-han-sans",
    family: "Source Han Sans SC",
    label: "思源黑体",
    style: "黑体",
    hint: "中性现代，笔画干净，长时间码字耐看",
    previewCss:
      "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.1.0/index.css",
    downloadUrl:
      "https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.1.0/files/noto-sans-sc-chinese-simplified-400-normal.woff2",
  },
  {
    id: "lxgw-wenkai",
    family: "LXGW WenKai",
    label: "霞鹜文楷",
    style: "楷体",
    hint: "手写感楷体，国风与文艺向内容首选",
    previewCss:
      "https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/style.css",
    // 官方 Screen 版全量 TTF（~19MB，屏显优化笔画，解决普通版小字号发糊）。
    // GitHub release 直链依赖代理可达性，失败时回退 fontsource（非 Screen
    // 版 woff2，"latin" 名有误导实为全量 CJK；该包无 400，500 即 Regular 档）。
    downloadUrl:
      "https://github.com/lxgw/LxgwWenKai/releases/download/v1.520/LXGWWenKaiScreen.ttf",
    fallbackUrl:
      "https://cdn.jsdelivr.net/npm/@fontsource/lxgw-wenkai@5.3.0/files/lxgw-wenkai-latin-500-normal.woff2",
  },
];

/** 预览示例文字（固定，展示字体笔画特征） */
export const FONT_PREVIEW_TEXT = "落霞与孤鹜齐飞，秋水共长天一色";

/** 按 id 找候选 */
export function paperFontById(id: string): PaperFontCandidate | undefined {
  return PAPER_FONT_CANDIDATES.find((item) => item.id === id);
}

/**
 * 判断某 family 是否已下载（本地字体）。
 * 与「跟随系统」（family 为空）区分开。
 */
export function isFontDownloaded(
  family: string,
  installed: NovelFontEntry[],
): boolean {
  if (!family) return false;
  return installed.some((entry) => entry.family === family);
}
