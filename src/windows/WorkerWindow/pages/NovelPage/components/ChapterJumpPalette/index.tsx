import { useEffect, useMemo, useRef, useState } from "react";
import { SearchOutlined } from "@ant-design/icons";
import { fuzzyMatch, formatThousands, padIndex } from "../../novel-utils";
import type { NovelChapter } from "../../types";
import "./index.scss";

interface ChapterJumpPaletteProps {
  open: boolean;
  chapters: NovelChapter[];
  onSelect: (chapterId: string) => void;
  onClose: () => void;
}

/**
 * 章节快速跳转浮层（O1 / R6）
 *
 * Ctrl+P 唤出的模糊搜索面板：零模态、Esc 关闭、回车直达。
 * 键盘可达性是硬要求——↑↓ 移动、Enter 跳转，鼠标不是必需。
 */
export default function ChapterJumpPalette({
  open,
  chapters,
  onSelect,
  onClose,
}: ChapterJumpPaletteProps) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    inputRef.current?.focus();
  }, [open]);

  const matches = useMemo(() => {
    if (!query.trim()) return chapters;
    return fuzzyMatch(chapters, query, (chapter) => chapter.title);
  }, [chapters, query]);

  if (!open) return null;

  const commit = (index: number) => {
    const target = matches[index];
    if (!target) return;
    onSelect(target.id);
    onClose();
  };

  return (
    <div className="nv-palette" role="dialog" aria-label="章节快速跳转">
      <div className="nv-palette__input">
        <SearchOutlined className="nv-palette__icon" />
        <input
          ref={inputRef}
          value={query}
          placeholder="🔍 搜索章节"
          aria-label="搜索章节"
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setCursor((value) => Math.min(value + 1, matches.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setCursor((value) => Math.max(value - 1, 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              commit(cursor);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
        />
      </div>

      <div className="nv-palette__list">
        {matches.length === 0 ? (
          <p className="nv-palette__empty">没有匹配的章节</p>
        ) : (
          matches.map((chapter, index) => (
            <button
              key={chapter.id}
              type="button"
              className={`nv-palette__row${index === cursor ? " is-on" : ""}`}
              onMouseEnter={() => setCursor(index)}
              onClick={() => commit(index)}
            >
              <span className="nv-palette__index">
                {padIndex(chapters.indexOf(chapter) + 1)}
              </span>
              <span className="nv-palette__title">{chapter.title}</span>
              <span className="nv-palette__words">
                {formatThousands(chapter.wordCount)}
              </span>
            </button>
          ))
        )}
      </div>

      <div className="nv-palette__foot">
        <span>↑↓ 选择</span>
        <span>Enter 跳转</span>
        <span>Esc 关闭</span>
      </div>
    </div>
  );
}
