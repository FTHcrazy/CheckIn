/**
 * 变体归一化（第二批接入口，当前为恒等实现）
 *
 * 业界做法是「检测前把正文压成规范形」，否则「色 情」「色\u200b情」「ＤＱ」
 * 这类变体一个都命不中。归一化会改变字符下标，因此必须同时产出
 * **归一化下标 → 原文下标**的映射，命中位置才能正确回标到正文。
 *
 * 第一批只落地接口与坐标映射：`normalizeForMatch` 原样返回并给恒等映射，
 * 调用链（AC 扫描 → 坐标回映 → 装饰层）已经完整跑通。
 * 第二批只需替换本文件的内核，其余代码零改动：
 *
 * 1. 全角 → 半角（含全角字母数字与全角标点）
 * 2. 大小写折叠
 * 3. 繁简统一（OpenCC 映射表）
 * 4. 干扰字符剥离（空格 / `*` `.` `-` `_` / 零宽字符）
 * 5. 同音形近字映射、拼音级匹配
 *
 * ⚠️ 剥离类规则会让 `offsets` 变长（一个原文区间只剩一个归一化字符），
 * 回映时必须取「该归一化字符在原文里的完整区间」，不能只取起点——
 * 否则高亮会少掉被剥离的干扰字符，用户看到的是半截词。
 */

import type { AcMatch } from "./ac-automaton";

export interface NormalizedText {
  /** 供 AC 自动机扫描的规范文本 */
  text: string;
  /**
   * 归一化下标 → 原文下标，长度恒为 `text.length + 1`，末位等于原文长度。
   * `offsets[i]` 是归一化第 i 个字符在原文里的起点，
   * `offsets[i + 1]` 即它的终点（也是下一个字符的起点）。
   */
  offsets: number[];
}

/**
 * 归一化正文。
 *
 * 当前为恒等实现：文本原样返回 + 恒等映射（`offsets[i] === i`）。
 * 全部消费者都应按「结果可能变短、可能重排」来写，第二批替换实现时不需要改调用方。
 */
export function normalizeForMatch(text: string): NormalizedText {
  const offsets = new Array<number>(text.length + 1);
  for (let index = 0; index <= text.length; index += 1) {
    offsets[index] = index;
  }
  return { text, offsets };
}

/** 把归一化坐标的命中回映成原文区间；越界一律夹到原文长度 */
export function mapMatchToRaw(
  match: Pick<AcMatch, "from" | "to">,
  normalized: NormalizedText,
): { from: number; to: number } {
  const { offsets, text } = normalized;
  const last = text.length;
  const from = offsets[Math.min(Math.max(match.from, 0), last)] ?? 0;
  const to = offsets[Math.min(Math.max(match.to, 0), last)] ?? last;
  // 极端情况下（归一化把整段剥成空）保证区间非负且不倒置
  return { from: Math.min(from, to), to: Math.max(from, to) };
}
