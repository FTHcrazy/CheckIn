import { useEffect, useMemo, useRef, useState } from "react";
import { App } from "antd";
import type { InputRef } from "antd";
import { marked } from "marked";
import { highlightText } from "../memo-utils";

export function useMemoViewState(
  content: string,
  originalContent: string,
  isEditing: boolean,
) {
  const { message } = App.useApp();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearchQuery, setActiveSearchQuery] = useState("");
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const searchInputRef = useRef<InputRef>(null);

  const renderedHtml = useMemo(() => {
    if (!originalContent) return "";
    return marked.parse(originalContent, { async: false, breaks: true }) as string;
  }, [originalContent]);

  const highlightedHtml = useMemo(() => {
    if (!activeSearchQuery) return renderedHtml;
    const escapedQuery = activeSearchQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const highlightPattern = new RegExp(`(${escapedQuery})`, "gi");
    let matchIndex = 0;
    return renderedHtml.replace(
      />([^<]+)</g,
      (_match, text: string) =>
        `>${text.replace(highlightPattern, (_fullMatch: string, found: string) => {
          const className =
            matchIndex++ === activeSearchIndex
              ? "memo-search-highlight memo-search-highlight--active"
              : "memo-search-highlight";
          return `<mark class="${className}">${found}</mark>`;
        })}<`,
    );
  }, [activeSearchIndex, activeSearchQuery, renderedHtml]);

  const highlightedEditorHtml = useMemo(
    () => highlightText(content, activeSearchQuery, activeSearchIndex),
    [activeSearchIndex, activeSearchQuery, content],
  );

  const handleFind = (): void => {
    const query = searchQuery.trim();
    if (!query) return;
    const source = isEditing ? content : originalContent;
    const matches = source.match(
      new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
    );
    if (!matches?.length) {
      message.info("未找到匹配内容");
      return;
    }

    const nextIndex =
      query === activeSearchQuery
        ? (activeSearchIndex + 1) % matches.length
        : 0;
    setActiveSearchQuery(query);
    setActiveSearchIndex(nextIndex);
  };

  useEffect(() => {
    if (!activeSearchQuery) return;
    requestAnimationFrame(() => {
      const activeMark = document.querySelector<HTMLElement>(
        ".memo-search-highlight--active",
      );
      if (!activeMark) return;

      const textArea = document.querySelector<HTMLTextAreaElement>(
        ".memo-editor-input-wrap textarea",
      );
      if (textArea && isEditing) {
        textArea.scrollTo({
          top: Math.max(0, activeMark.offsetTop - textArea.clientHeight / 2),
          behavior: "instant",
        });
        return;
      }
      activeMark.scrollIntoView({ behavior: "instant", block: "center" });
    });
  }, [activeSearchIndex, activeSearchQuery, isEditing]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const isModifier = event.ctrlKey || event.metaKey;
      if (!isModifier || event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      const activeElement = document.activeElement;
      const selectedText =
        activeElement instanceof HTMLTextAreaElement
          ? activeElement.value
              .slice(activeElement.selectionStart, activeElement.selectionEnd)
              .trim()
          : (window.getSelection()?.toString().trim() ?? "");
      setSearchQuery(selectedText);
      setSearchOpen(true);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  return {
    searchOpen,
    searchQuery,
    searchInputRef,
    highlightedHtml,
    highlightedEditorHtml,
    setSearchQuery,
    setSearchOpen,
    setActiveSearchQuery,
    setActiveSearchIndex,
    handleFind,
  };
}
