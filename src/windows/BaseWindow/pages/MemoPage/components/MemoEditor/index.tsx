import { Input } from "antd";
import "./index.scss";

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
        // 恒追加 <br />（react-simple-code-editor 同款手法）：内容以 \n 结尾时
        // pre-wrap 的 div 会比 textarea 少渲染最后一行空行盒，导致高亮层
        // scrollHeight 偏矮一行，滚动到底部时被 clamp 产生一行永久偏移。
        dangerouslySetInnerHTML={{ __html: `${highlightedHtml || "&nbsp;"}<br />` }}
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
