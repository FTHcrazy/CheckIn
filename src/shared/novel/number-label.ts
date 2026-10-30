/**
 * 编号与中文数字的**单一实现**（跨窗口共享，REQ-052 ③：不另写一份）
 *
 * `toChineseOrdinal` / `formatNumberedLabel` 原本在 `bookshelf-utils.ts`
 * 与 `NovelPage/novel-utils.ts` 各有一份（后者超集，支持到「万」级）。
 * 这里合并成唯一实现（取超集口径），两个页面改为 re-export（M30 / M31），
 * 原 import 路径不变 —— 于是「数字 → 中文」在全局只有一处口径。
 *
 * 本文件**不含 React**（跨窗口共享位）。渲染层与主进程各自持有一份实现是既有
 * 惯例（主进程不能 import `src/`），本文件服务的是渲染层多窗口复用。
 */

/** 序号数字样式：阿拉伯数字（第1章）/ 中文数字（第一章） */
export type NumberLabelStyle = "arabic" | "chinese";

/** 中文数字位权（个十百千），配合 CN_DIGITS 支持到万级 */
const CN_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const CN_UNITS = ["", "十", "百", "千"];

/** 0-9999 节内转换（不做零压缩边界，由 toChineseOrdinal 编排） */
function fourDigitToChinese(n: number): string {
  // 10-19 规范写法省略「一」：10 → 十、12 → 十二（口语「一十二」不采用）
  if (n >= 10 && n < 20) {
    const tail = n % 10;
    return tail > 0 ? `十${CN_DIGITS[tail]}` : "十";
  }
  let result = "";
  let zeroPending = false;
  for (let i = 3; i >= 0; i -= 1) {
    const digit = Math.floor(n / 10 ** i) % 10;
    if (digit === 0) {
      if (result) zeroPending = true;
    } else {
      if (zeroPending) {
        result += "零";
        zeroPending = false;
      }
      result += CN_DIGITS[digit] + CN_UNITS[i];
    }
  }
  return result;
}

/** 阿拉伯数字 → 中文序号：1→一、11→十一、123→一百二十三、10001→一万零一 */
export function toChineseOrdinal(value: number): string {
  const n = Math.max(1, Math.round(value));
  if (n >= 100_000_000) return String(n); // 超出常规序号范围回退阿拉伯数字

  const wan = Math.floor(n / 10_000);
  const rest = n % 10_000;
  if (wan === 0) return fourDigitToChinese(rest);

  let result = fourDigitToChinese(wan) + "万";
  if (rest > 0) {
    // 万节不足一千必须补零：10500 → 一万零五百
    result += rest < 1000 ? `零${fourDigitToChinese(rest)}` : fourDigitToChinese(rest);
  }
  return result;
}

/**
 * 按数字样式与后缀格式化序号标签："章" + 12 → 第十二章 / 第12章。
 * 数字样式与后缀是两个独立配置（numberStyle / chapterSuffix / volumeSuffix），
 * 在此自由组合；后缀为空时退化为纯序号。
 */
export function formatNumberedLabel(
  style: NumberLabelStyle,
  suffix: string,
  value: number,
): string {
  const n = Math.max(1, Math.round(value));
  const numberText = style === "chinese" ? toChineseOrdinal(n) : String(n);
  return `第${numberText}${suffix}`;
}
