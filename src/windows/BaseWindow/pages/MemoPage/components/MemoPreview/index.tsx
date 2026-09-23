import { App } from "antd";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { marked } from "marked";
import { highlightRenderedHtml } from "../../memo-utils";
import { useMemoOriginal } from "../../store/useMemoStore";
import { useMemoSearchStore } from "../../store/useMemoSearchStore";
import "./index.scss";

/**
 * 备忘预览区
 *
 * 渲染结果由本组件订阅「已落库原文」后自行计算：
 * marked 渲染与高亮都只随原文 / 查找词变化，编辑中的逐字输入不会波及这里
 * （此前由页面根算好再透传，敲一个字就要重跑一次 marked）。
 */
export default function MemoPreview() {
  const originalContent = useMemoOriginal();
  const activeSearchQuery = useMemoSearchStore(
    (state) => state.activeSearchQuery,
  );
  const activeSearchIndex = useMemoSearchStore(
    (state) => state.activeSearchIndex,
  );

  const html = useMemo(() => {
    if (!originalContent) return "";
    const rendered = marked.parse(originalContent, {
      async: false,
      breaks: true,
    }) as string;
    return highlightRenderedHtml(rendered, activeSearchQuery, activeSearchIndex);
  }, [originalContent, activeSearchQuery, activeSearchIndex]);

  const { message } = App.useApp();
  // 用 ref 持有最新回调，让下面这个重构 DOM 的 effect 只依赖 html，
  // 不再因 message 实例变化而清空并重建全部代码块按钮。
  // 注意：在 effect 中同步，避免渲染期写 ref 在并发渲染下写入过期函数。
  const onCopyCodeRef = useRef<(code: string) => void>(() => {});
  const onCopyCode = useCallback(
    async (code: string): Promise<void> => {
      try {
        await navigator.clipboard.writeText(code);
        message.success("代码已复制");
      } catch (error) {
        message.error("复制失败");
        console.error(error);
      }
    },
    [message],
  );

  useEffect(() => {
    onCopyCodeRef.current = onCopyCode;
  }, [onCopyCode]);

  useEffect(() => {
    const preview = document.querySelector(".memo-preview");
    if (!preview) return;

    const handleAnchorClick = (event: Event) => {
      const anchor = event.target instanceof Element ? event.target.closest("a") : null;
      if (!anchor) return;

      event.preventDefault();
      event.stopPropagation();
    };

    preview.addEventListener("click", handleAnchorClick, true);

    const codeBlocks = document.querySelectorAll(".memo-preview pre code");
    codeBlocks.forEach((block) => {
      const code = block.textContent ?? "";
      const wrapper = block.parentElement;
      if (!wrapper || wrapper.querySelector(".memo-code-copy")) return;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "memo-code-copy";
      button.textContent = "复制";
      button.addEventListener("click", () => onCopyCodeRef.current(code));

      wrapper.style.position = "relative";
      wrapper.appendChild(button);
    });

    return () => {
      preview.removeEventListener("click", handleAnchorClick, true);
      document
        .querySelectorAll(".memo-code-copy")
        .forEach((node) => node.remove());
    };
  }, [html]);

  return (
    <div className="memo-preview" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
