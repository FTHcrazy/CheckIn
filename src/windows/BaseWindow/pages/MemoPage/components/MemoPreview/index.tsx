import { App } from "antd";
import { useCallback, useEffect, useRef } from "react";
import "./index.scss";

interface MemoPreviewProps {
  html: string;
}

export default function MemoPreview({ html }: MemoPreviewProps) {
  const { message } = App.useApp();
  // 用 ref 持有最新回调，让下面这个重构 DOM 的 effect 只依赖 html，
  // 不再因 message 实例变化而清空并重建全部代码块按钮。
  const onCopyCodeRef = useRef<(code: string) => void>(() => {});
  onCopyCodeRef.current = useCallback(
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
