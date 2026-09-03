import { useEffect } from "react";

interface MemoPreviewProps {
  html: string;
  onCopyCode: (code: string) => void;
}

export default function MemoPreview({ html, onCopyCode }: MemoPreviewProps) {
  useEffect(() => {
    const codeBlocks = document.querySelectorAll(".memo-preview pre code");
    codeBlocks.forEach((block) => {
      const code = block.textContent ?? "";
      const wrapper = block.parentElement;
      if (!wrapper || wrapper.querySelector(".memo-code-copy")) return;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "memo-code-copy";
      button.textContent = "复制";
      button.addEventListener("click", () => onCopyCode(code));

      wrapper.style.position = "relative";
      wrapper.appendChild(button);
    });

    return () => {
      document
        .querySelectorAll(".memo-code-copy")
        .forEach((node) => node.remove());
    };
  }, [html, onCopyCode]);

  return (
    <div className="memo-preview" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
