import { useMemo } from "react";
import { Input } from "antd";
import { highlightText } from "../../memo-utils";
import {
  memoActions,
  useMemoContent,
} from "../../store/useMemoStore";
import { useMemoSearchStore } from "../../store/useMemoSearchStore";
import "./index.scss";

const { TextArea } = Input;

interface MemoEditorProps {
  onBlur: () => void;
}

/**
 * 备忘编辑区（透明 textarea + 高亮 underlay）
 *
 * 正文与高亮都在本组件内订阅 store：
 * - `content` 每敲一个字都在变，若由页面根持有再透传，侧栏虚拟列表、
 *   头部、预览、Modal 都会被一起重渲染
 * - 高亮只在「已执行查找的关键词 / 命中序号」变化时重算，
 *   输入搜索词的过程不会触发全文 escape
 */
export default function MemoEditor({ onBlur }: MemoEditorProps) {
  const content = useMemoContent();
  const activeSearchQuery = useMemoSearchStore(
    (state) => state.activeSearchQuery,
  );
  const activeSearchIndex = useMemoSearchStore(
    (state) => state.activeSearchIndex,
  );

  const highlightedHtml = useMemo(
    () => highlightText(content, activeSearchQuery, activeSearchIndex),
    [content, activeSearchQuery, activeSearchIndex],
  );

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
        onChange={(event) => memoActions.setContent(event.target.value)}
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
