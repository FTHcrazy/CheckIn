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
