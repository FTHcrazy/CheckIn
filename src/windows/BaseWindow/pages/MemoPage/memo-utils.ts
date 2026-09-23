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

  // 搜索词先做 HTML 转义再正则转义：source 已经被 escapeHtml 处理过，
  // 原文中的特殊字符已变为实体（& → &amp;、< → &lt;）。若直接用原始
  // query 匹配，会命中实体中间的字符，把 &amp; 切断成 "&" + "amp;"，
  // 破坏高亮标记结构与原文显示。转义后的 query 与转义后的文本在同一
  // "坐标系"上匹配，<mark> 包住完整实体，浏览器渲染回原字符，视觉正确。
  const escapedQuery = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

/**
 * 在「已渲染的 HTML」上按搜索词打高亮（预览态用）
 *
 * 只替换标签之间的文本节点（`>([^<]+)<`），不会命中标签名与属性，
 * 因此不会破坏 marked 生成的结构。无搜索词时直接返回原串，避免无谓遍历。
 */
export function highlightRenderedHtml(
  renderedHtml: string,
  query: string,
  activeIndex: number,
): string {
  if (!query) return renderedHtml;

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const highlightPattern = new RegExp(`(${escapedQuery})`, "gi");
  let matchIndex = 0;
  return renderedHtml.replace(
    />([^<]+)</g,
    (_match: string, text: string) =>
      `>${text.replace(highlightPattern, (_fullMatch: string, found: string) => {
        const className =
          matchIndex++ === activeIndex
            ? "memo-search-highlight memo-search-highlight--active"
            : "memo-search-highlight";
        return `<mark class="${className}">${found}</mark>`;
      })}<`,
  );
}
