import { useRef, useState } from "react";
import { CloseOutlined } from "@ant-design/icons";
import { formatRelativeTime } from "../../novel-utils";
import type { NovelNote } from "../../types";
import "./index.scss";

interface InspirationPanelProps {
  notes: NovelNote[];
  onAddNote: (content: string) => void;
  onRemoveNote: (noteId: string) => void;
}

/**
 * 灵感速记面板（R7）
 *
 * 写作中一键把想法甩进来，不离开正文：输入框自持草稿，Enter 提交并做 IME 守卫，
 * 中文候选期间的回车不上抛。
 */
export default function InspirationPanel({
  notes,
  onAddNote,
  onRemoveNote,
}: InspirationPanelProps) {
  const [draft, setDraft] = useState("");
  const composingRef = useRef(false);

  const submit = () => {
    const value = draft.trim();
    if (!value) return;
    onAddNote(value);
    setDraft("");
  };

  return (
    <div className="nv-note">
      <div className="nv-note__editor">
        <textarea
          value={draft}
          placeholder="甩一句灵感进来…（Enter 记录）"
          rows={3}
          onChange={(event) => setDraft(event.target.value)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            if (composingRef.current || event.nativeEvent.isComposing) return;
            event.preventDefault();
            submit();
          }}
        />
        <button type="button" className="nv-note__submit" onClick={submit}>
          记录
        </button>
      </div>

      {notes.length === 0 ? (
        <p className="nv-note__empty">还没有灵感记录</p>
      ) : (
        <ul className="nv-note__list">
          {notes.map((note) => (
            <li key={note.id} className="nv-note__card">
              <p className="nv-note__text">{note.content}</p>
              <footer className="nv-note__meta">
                <span>{formatRelativeTime(note.createdAt)}</span>
                <button
                  type="button"
                  aria-label="删除灵感"
                  onClick={() => onRemoveNote(note.id)}
                >
                  <CloseOutlined />
                </button>
              </footer>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
