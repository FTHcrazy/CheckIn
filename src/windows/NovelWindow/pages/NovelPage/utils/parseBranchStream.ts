/**
 * 卡文救援 · 分段流式解析（R-AI-11，§3.4）
 *
 * 目标：模型一边吐 JSON 数组，界面一边落卡 —— 每识别出一个**完整**的
 * `{...}` 就交出去一张，作者不必等全部生成完才看见第一条走向。
 *
 * 为什么不复用 `shared/ai/ai-stream-parse.ts`：那个累加器解决的是
 * 「SSE / 逐行 JSON 里取出**文本增量**」，产物仍是字符串；而这里要在增量文本上
 * 做**结构**切分（括号配平 + 字符串转义感知），是两个不同层次的事。把配平逻辑
 * 塞进通用累加器，会让所有 text 契约的调用方都背上 JSON 知识。
 *
 * 三个必须处理对的东西：
 * 1. **字符串里的花括号**：`{"title":"他喊了一声{"} `——不感知引号就会提前闭合；
 * 2. **转义引号**：`"他说\"走\""` 里的 `\"` 不能当成字符串结束；
 * 3. **增量边界**：一个 `{` 可能落在两个 chunk 之间，未闭合的部分必须留到下一轮。
 *
 * 解析失败的块**静默跳过**（宁可少一张卡，也不要因为一处瑕疵让整批失败）：
 * 后到的完整块照常出卡，末尾残缺块由 `flush()` 丢弃。
 */
import type { RescueSegment } from "./rescue";

/** 单段走向的三个字段（缺任意一个都不算完整卡片） */
function toSegment(value: unknown): RescueSegment | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const read = (key: string): string =>
    typeof record[key] === "string" ? (record[key] as string).trim() : "";
  const title = read("title");
  const conflict = read("conflict");
  const consequence = read("consequence");
  // 三个字段缺一个都渲染不出「三段结构」，直接丢弃而不是给空占位
  if (!title || !conflict || !consequence) return null;
  return { title, conflict, consequence };
}

/** 尝试把一个候选块解析成走向；失败返回 null（不抛） */
function parseCandidate(raw: string): RescueSegment | null {
  try {
    return toSegment(JSON.parse(raw));
  } catch {
    return null;
  }
}

export interface BranchStreamParser {
  /** 喂入一段增量，返回本轮新解析出的完整走向（可能为空数组） */
  push: (delta: string) => RescueSegment[];
  /**
   * 收尾。
   *
   * 只做一件事：把「已经很接近完整」的残块再试一次（补上缺失的 `}`）。
   * 模型被中断时最后一条常常只差一个括号，丢掉它等于让作者少看一条走向。
   */
  flush: () => RescueSegment[];
  /** 累计收到的原文（结构化降级解析 / 调试用） */
  text: () => string;
}

/** 补齐尾部缺失的右花括号（最多补 8 个，多的说明它压根不是一个对象） */
function closeOpenBraces(raw: string, open: number): string | null {
  if (open <= 0 || open > 8) return null;
  return `${raw}${"}".repeat(open)}`;
}

/**
 * 创建一个分段流式解析器。
 *
 * 用法与 SSE 累加器一致：`push(accumulator.push(chunk))`，把返回值里新出的
 * 走向追加到界面；流结束时调一次 `flush()`。
 */
export function createBranchStreamParser(): BranchStreamParser {
  /** 尚未消费的原始文本（含对象外的引导语 / Markdown 围栏） */
  let buffer = "";
  /** 已累计的全部文本（`flush` 后再 push 也不会重复计数） */
  let raw = "";

  const drain = (allowPartial: boolean): RescueSegment[] => {
    const segments: RescueSegment[] = [];
    let index = buffer.indexOf("{");
    while (index >= 0) {
      let depth = 0;
      let inString = false;
      let escaped = false;
      let end = -1;
      for (let cursor = index; cursor < buffer.length; cursor += 1) {
        const char = buffer[cursor];
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (char === "\\") {
            escaped = true;
          } else if (char === '"') {
            inString = false;
          }
          continue;
        }
        if (char === '"') {
          inString = true;
          continue;
        }
        if (char === "{") depth += 1;
        else if (char === "}") {
          depth -= 1;
          if (depth === 0) {
            end = cursor;
            break;
          }
        }
      }

      if (end < 0) {
        // 未闭合：把已消费的部分切掉，剩余留到下一轮（下一轮可能就闭合了）
        buffer = buffer.slice(index);
        if (allowPartial) {
          const candidate = parseCandidate(closeOpenBraces(buffer, depth) ?? "");
          if (candidate) {
            segments.push(candidate);
            buffer = "";
          }
        }
        return segments;
      }

      const candidate = parseCandidate(buffer.slice(index, end + 1));
      if (candidate) segments.push(candidate);
      buffer = buffer.slice(end + 1);
      index = buffer.indexOf("{");
    }
    return segments;
  };

  return {
    push: (delta: string): RescueSegment[] => {
      if (!delta) return [];
      raw += delta;
      buffer += delta;
      return drain(false);
    },
    flush: (): RescueSegment[] => drain(true),
    text: (): string => raw,
  };
}
