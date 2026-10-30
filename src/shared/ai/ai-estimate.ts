/**
 * token 估算纯函数（M5 的成本与范围控制，PRD §5.3）
 *
 * 每次 L3 调用前要展示「本次将发送约 N 字 ≈ M tokens」。
 * 禁止引入 `tiktoken` / `js-tiktoken` / `gpt-tokenizer`（架构复核红线 I：
 * 渲染层依赖必须放 devDependencies，且 wasm/词表会进 asar）。这里用
 * 自研纯函数：中文字符 ×1.5 + 英文词 ×1.3 + JSON 结构开销常数。
 *
 * 精度目标是「数量级可信」而非逐 token 精确——它只用于让用户对发送量
 * 有体感，不参与任何计费。
 */

/** 估算参数（都可空，缺省用保守默认值） */
export interface EstimateOptions {
  /** 中文字符折算系数（默认 1.5） */
  chineseFactor?: number;
  /** 英文词折算系数（默认 1.3） */
  englishFactor?: number;
  /** JSON / 结构开销常数（默认 32） */
  structureOverhead?: number;
}

/** 中文字符正则（含 CJK 扩展与中文标点的字面区段，按「字符」而非「词」计） */
const CHINESE_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/g;

/** 英文词：连续拉丁字母 / 数字，按「词」计 */
const ENGLISH_WORD_RE = /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g;

/**
 * 估算一段文本的 token 数。
 *
 * 口径（架构复核 §6 自研替代方案）：
 * - 中文字符 × `chineseFactor`（默认 1.5）
 * - 英文词 × `englishFactor`（默认 1.3）
 * - 加 `structureOverhead` 常数（默认 32，覆盖分隔符 / 换行 / 标点）
 *
 * 空串 / undefined 返回 0。
 */
export function estimateTokens(text: string | undefined, options: EstimateOptions = {}): number {
  if (!text) return 0;
  const chineseFactor = options.chineseFactor ?? 1.5;
  const englishFactor = options.englishFactor ?? 1.3;
  const overhead = options.structureOverhead ?? 32;

  const chineseCount = (text.match(CHINESE_RE) ?? []).length;
  const englishWords = (text.match(ENGLISH_WORD_RE) ?? []).length;
  const raw = chineseCount * chineseFactor + englishWords * englishFactor;

  // 空文本不加开销：只有确有内容才给结构常数
  return text.trim() ? Math.round(raw) + overhead : 0;
}

/** 估算结果：供弹窗展示「约 N 字 ≈ M tokens」 */
export interface TokenEstimate {
  /** 原文长度（字符数，含空白） */
  chars: number;
  /** 估算 token 数（四舍五入） */
  tokens: number;
}

/** 估算一段文本的「字数 + token」双口径 */
export function estimateText(text: string | undefined, options: EstimateOptions = {}): TokenEstimate {
  const chars = text?.length ?? 0;
  return { chars, tokens: estimateTokens(text, options) };
}
