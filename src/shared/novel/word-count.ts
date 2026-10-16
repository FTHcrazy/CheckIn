/**
 * 正文字数统计的**唯一**实现（N-07）
 *
 * 背景：渲染层此前有两份 `countWords`，口径不一致：
 * - `NovelWindow/pages/NovelPage/novel-utils.ts` —— `countWords(text, mode)`，
 *   `withPunctuation` 用 `/\S/gu` 匹配后取 `length`（**按码点**，`u` 标志让星平面
 *   字符算 1 个），`hanOnly` 数汉字；
 * - `NovelWindow/pages/BookshelfPage/import/novel-import-parser.ts` ——
 *   `text.replace(/\s/g, "").length`（**按 UTF-16 码元**）。
 *
 * （走查报告写的「渲染层 + 主进程各一份」不成立：主进程只经 IPC **接收** wordCount，
 * 不做统计 —— 真实分歧就在上面这两处渲染层实现之间。）
 *
 * 两者对 BMP 文本结果一致，但含**星平面字符**（emoji、CJK 扩展 B 区 `𠀀` 等，
 * 一个码点占两个 UTF-16 码元）时会差 1：编辑器按码点、导入按码元 ——
 * 导入进来的章节字数会莫名比编辑器里显示的多，这正是「字数口径漂移」。
 *
 * 本文件收敛为一份实现，口径与 `novel-utils` 现行那份**逐字节一致**（按码点）。
 * 两处调用方改为引用它，导入路径因此对星平面字符的计数从「码元」变为「码点」——
 * 这是一次**有意的口径统一**（见 CHANGELOG）。
 *
 * 本文件是纯函数、不含 React / 不碰 IO（跨窗口共享位）。
 */

/**
 * 字数统计口径：
 * - `withPunctuation`（默认，与主流网文平台一致）：统计所有非空白字符，标点计入；
 * - `hanOnly`：只统计汉字（中日韩统一表意文字 + 扩展 A + 兼容表意文字）。
 */
export type WordCountMode = "withPunctuation" | "hanOnly";

/** 中日韩统一表意文字 + 扩展 A + 兼容表意文字（与 novel-utils 原实现同一区间） */
const HAN_PATTERN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g;

/**
 * 非空白字符（`u` 标志按码点匹配，与逐字符 `for...of` 口径一致）。
 *
 * 打字链路每次按键要统计 2~3 遍整篇文档，原先是逐字符 `/\s/.test(ch)`：
 * 3 万字章节就是 9 万次正则调用。改一次原生 pass 后快一个数量级。
 * ⚠️ `u` 标志是口径的一部分：去掉它，emoji / 星平面字会按码元算成 2 个。
 */
const NON_WHITESPACE_PATTERN = /\S/gu;

/** 统计字数。默认口径含标点（与主流平台一致），可切纯汉字 */
export function countWords(text: string, mode: WordCountMode): number {
  if (!text) return 0;
  if (mode === "hanOnly") {
    const matched = text.match(HAN_PATTERN);
    return matched ? matched.length : 0;
  }
  const matched = text.match(NON_WHITESPACE_PATTERN);
  return matched ? matched.length : 0;
}
