/**
 * 书籍导入解析 Worker
 *
 * 把「解码 + 章节拆分」这一整段 CPU 密集活儿挪到 worker 线程：
 * 几十万字的长篇 TXT 拆章在主线程上会卡住书架界面（尤其拖入大文件时），
 * 放进 worker 后主界面依旧可以滚动、点击，用户体验是无感的。
 *
 * 通信协议（见 novel-import-service.ts）：
 *   → { type: "parse", bytes: ArrayBuffer, fileName: string }
 *   ← { type: "progress", phase, ratio }
 *   ← { type: "done", result }
 *   ← { type: "error", message }
 *
 * 编码探测：与参考实现（Ftiehan）同思路——先按 UTF-8 解出「替换字符 U+FFFD」
 * 数量，若明显偏多则回退 GB18030；GB18030 由浏览器 TextDecoder 原生支持，
 * 无需 iconv 依赖。
 */

import {
  countWords,
  parseTxtBook,
  type ParsedBook,
} from "./novel-import-parser";

/** 解析结果：结构 + 统计（供 UI 通知展示） */
export interface ImportParseResult {
  /** 最终采用的编码 */
  encoding: string;
  structured: boolean;
  volumes: ParsedBook["volumes"];
  chapters: Array<{
    title: string;
    content: string;
    volumeIndex: number;
    wordCount: number;
  }>;
  totalWords: number;
}

/** 统计文本中的替换字符（U+FFFD）：解码失败的信号 */
function countReplacementChars(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 0xfffd) count += 1;
  }
  return count;
}

/** 用指定编码解码；解码器不可用（老环境）返回 null */
function decodeWith(bytes: Uint8Array, encoding: string): string | null {
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * 编码探测：UTF-8 优先，替换字符率过高则回退 GB18030。
 * 两者都不可用（理论上不会）时退回 UTF-8 的宽松解码。
 */
export function detectEncoding(bytes: Uint8Array): { text: string; encoding: string } {
  const utf8 = decodeWith(bytes, "utf-8");
  if (utf8 !== null) {
    // 替换字符占比 < 0.1% 视为解码正常
    const bad = countReplacementChars(utf8);
    if (bad === 0 || bad / Math.max(1, utf8.length) < 0.001) {
      return { text: utf8, encoding: "utf-8" };
    }
  }

  const gb = decodeWith(bytes, "gb18030");
  if (gb !== null) {
    const badUtf8 = utf8 === null ? Infinity : countReplacementChars(utf8);
    const badGb = countReplacementChars(gb);
    if (badGb <= badUtf8) return { text: gb, encoding: "gb18030" };
  }

  return { text: utf8 ?? "", encoding: "utf-8" };
}

self.onmessage = (event: MessageEvent<{ type: string; bytes: ArrayBuffer; fileName: string }>) => {
  const { type, bytes } = event.data;
  if (type !== "parse") return;

  try {
    self.postMessage({ type: "progress", phase: "decode", ratio: 0.1 });

    const view = new Uint8Array(bytes);
    const { text, encoding } = detectEncoding(view);

    self.postMessage({ type: "progress", phase: "parse", ratio: 0.5 });

    const book = parseTxtBook(text);

    self.postMessage({ type: "progress", phase: "finalize", ratio: 0.9 });

    const chapters = book.chapters.map((chapter) => ({
      title: chapter.title,
      content: chapter.content,
      volumeIndex: chapter.volumeIndex,
      wordCount: countWords(chapter.content),
    }));

    const result: ImportParseResult = {
      encoding,
      structured: book.structured,
      volumes: book.volumes,
      chapters,
      totalWords: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
    };

    self.postMessage({ type: "done", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
