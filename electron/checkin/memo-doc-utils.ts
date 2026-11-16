/**
 * 备忘文档转换纯函数（导入 .txt/.docx → .md 落盘；导出 .md → .txt/.docx）
 *
 * 不依赖 electron / Node API，可在 vitest 中直接测试；
 * 实际文件读写与弹窗在 main.ts 的 memo-import / memo-export handler 中。
 */

/** markdown 行内标记 → 纯文本（加粗/斜体/行内代码/图片/链接） */
export function stripInlineMarkdown(text: string): string {
  return text
    // 图片：保留 alt
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    // 链接：保留文字
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // 加粗 / 斜体 / 行内代码
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/`([^`]*)`/g, "$1");
}

/** 压缩 3 个以上连续空行为 1 个空行（docx 提取的文本常带大量空行） */
export function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * markdown → 纯文本（.txt 导出）
 *
 * 去掉标题 #、列表标记（无序列表换成 •）、引用 >、行内标记；
 * 保留换行结构与有序列表编号，正文内容不丢。
 */
export function markdownToPlainText(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n").map((line) => {
    let text = line.trimEnd();
    // 标题
    text = text.replace(/^#{1,6}\s+/, "");
    // 引用（可多层）
    text = text.replace(/^\s*(>\s?)+/, "");
    // 无序列表 → •；有序列表保留 "1." 前缀
    text = text.replace(/^(\s*)[-*+]\s+/, "$1• ");
    // 分隔线
    if (/^\s*([-*_]\s*){3,}$/.test(text)) return "";
    return stripInlineMarkdown(text);
  });
  return collapseBlankLines(lines.join("\n"));
}

/** docx 段落块模型：由 markdown 行解析，main 进程映射为 docx 包对象 */
export type DocxBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4; text: string }
  | { type: "bullet"; text: string }
  | { type: "paragraph"; text: string };

/** markdown 行 → docx 块（.docx 导出）：标题/列表/引用/正文，空行丢弃 */
export function markdownToDocxBlocks(markdown: string): DocxBlock[] {
  const blocks: DocxBlock[] = [];
  for (const rawLine of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(heading[1].length, 4) as 1 | 2 | 3 | 4;
      blocks.push({ type: "heading", level, text: stripInlineMarkdown(heading[2]) });
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      blocks.push({ type: "bullet", text: stripInlineMarkdown(bullet[1]) });
      continue;
    }

    // 引用与分隔线按普通段落落（保留文字；分隔线丢弃）
    if (/^([-*_]\s*){3,}$/.test(line)) continue;
    const quote = /^\s*(>\s?)+/.exec(line);
    const text = quote ? line.slice(quote[0].length) : line;
    blocks.push({ type: "paragraph", text: stripInlineMarkdown(text) });
  }
  return blocks;
}
