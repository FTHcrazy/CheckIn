export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function highlightText(
  source: string,
  query: string,
  activeIndex: number,
): string {
  // 无搜索词时必须短路：否则每次输入都会对全文做一次 escapeHtml 全量转换，
  // 大文件下足以造成明显的输入延迟（这是编辑卡顿的主因之一）。
  if (!query) return escapeHtml(source);

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const highlightPattern = new RegExp(`(${escapedQuery})`, "gi");
  let matchIndex = 0;
  return escapeHtml(source).replace(
    highlightPattern,
    (_fullMatch: string, found: string) => {
      const className =
        matchIndex++ === activeIndex
          ? "memo-search-highlight memo-search-highlight--active"
          : "memo-search-highlight";
      return `<mark class="${className}">${found}</mark>`;
    },
  );
}
