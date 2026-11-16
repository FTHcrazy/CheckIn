/**
 * 参考答案的轻量解析。
 *
 * 答案只允许两种结构：普通文本（支持 `**加粗**` 与 `` `行内代码` ``）
 * 与 ```lang 代码块。这里把它切成人可枚举的数据结构，渲染层用 React 元素
 * 逐段拼装 —— 全程不产生 HTML 字符串，因此不需要（也禁止）`dangerouslySetInnerHTML`。
 */

export interface AnswerTextBlock {
  kind: "text";
  lines: string[];
}

export interface AnswerCodeBlock {
  kind: "code";
  lang: string;
  code: string;
}

export type AnswerBlock = AnswerTextBlock | AnswerCodeBlock;

export interface InlineToken {
  kind: "text" | "strong" | "code";
  text: string;
}

/** 去掉首尾的空行，纯空白的文本块不进入结果 */
function trimBlankEdges(input: readonly string[]): string[] {
  let start = 0;
  let end = input.length;
  while (start < end && input[start].trim().length === 0) start += 1;
  while (end > start && input[end - 1].trim().length === 0) end -= 1;
  return input.slice(start, end);
}

/**
 * 按 ``` 围栏把答案切成文本块与代码块。
 *
 * 兼容 CRLF 与未闭合的围栏（末尾仍在代码块里时按代码块收尾）：
 * 题库是手写的长文本，漏一个闭合符不该让整段答案变成一堆代码。
 */
export function splitAnswerBlocks(answer: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  const lines = answer.replace(/\r\n/g, "\n").split("\n");

  let buffer: string[] = [];
  let inCode = false;
  let lang = "";

  const flushText = (): void => {
    const trimmed = trimBlankEdges(buffer);
    if (trimmed.length > 0) blocks.push({ kind: "text", lines: trimmed });
    buffer = [];
  };

  const flushCode = (): void => {
    blocks.push({ kind: "code", lang, code: buffer.join("\n") });
    buffer = [];
    lang = "";
  };

  for (const line of lines) {
    const fence = /^```(\S*)\s*$/.exec(line.trim());
    if (fence) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushText();
        inCode = true;
        lang = fence[1] ?? "";
      }
      continue;
    }
    buffer.push(line);
  }

  if (inCode) flushCode();
  else flushText();

  return blocks;
}

/**
 * 把一行文本切成「普通 / 加粗 / 行内代码」片段。
 *
 * 只认成对的记号：落单的 `**` 或反引号原样保留，不会吞掉后文。
 */
export function parseInlineTokens(line: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let buffer = "";
  let index = 0;

  const pushText = (): void => {
    if (buffer.length > 0) {
      tokens.push({ kind: "text", text: buffer });
      buffer = "";
    }
  };

  while (index < line.length) {
    if (line.startsWith("**", index)) {
      const end = line.indexOf("**", index + 2);
      if (end > index + 2) {
        pushText();
        tokens.push({ kind: "strong", text: line.slice(index + 2, end) });
        index = end + 2;
        continue;
      }
    }
    if (line[index] === "`") {
      const end = line.indexOf("`", index + 1);
      if (end > index + 1) {
        pushText();
        tokens.push({ kind: "code", text: line.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }
    buffer += line[index];
    index += 1;
  }

  pushText();
  return tokens;
}

/** 去掉行内记号，供 aria-label / Tooltip 等纯文本场景使用 */
export function stripInlineMarkup(line: string): string {
  return line.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
}
