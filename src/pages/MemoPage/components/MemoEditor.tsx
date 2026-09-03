import { Input } from "antd";

const { TextArea } = Input;

interface MemoEditorProps {
  content: string;
  highlightedHtml: string;
  onChange: (content: string) => void;
  onBlur: () => void;
}

export default function MemoEditor({
  content,
  highlightedHtml,
  onChange,
  onBlur,
}: MemoEditorProps) {
  return (
    <div className="memo-editor-input-wrap">
      <div
        className="memo-textarea-highlight"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: highlightedHtml || "&nbsp;" }}
      />
      <TextArea
        value={content}
        onChange={(event) => onChange(event.target.value)}
        placeholder="在此编辑 Markdown 内容..."
        spellCheck={false}
        className="memo-textarea"
        onScroll={(event) => {
          const highlight =
            event.currentTarget.parentElement?.querySelector<HTMLElement>(
              ".memo-textarea-highlight",
            );
          if (highlight) {
            highlight.scrollTop = event.currentTarget.scrollTop;
            highlight.scrollLeft = event.currentTarget.scrollLeft;
          }
        }}
        onBlur={onBlur}
      />
    </div>
  );
}
