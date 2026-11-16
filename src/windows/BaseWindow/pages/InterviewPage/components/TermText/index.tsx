import { useState, type ReactNode } from "react";
import { Button, Popover, Tag } from "antd";
import { highlightSegments } from "../../data/interview-filter-utils";
import {
  GLOSSARY_DOMAIN_LABEL,
  glossaryById,
  splitByGlossary,
  type GlossaryTerm,
} from "../../data/interview-glossary";
import "./index.scss";

interface TermTextProps {
  /** 纯文本（不含 `**` / 反引号等标记，标记由调用方先解析） */
  text: string;
  /** 当前搜索词，命中处仍要高亮，否则搜索结果里被术语吃掉的部分看起来没命中 */
  keyword?: string;
}

/** 关键词高亮：只包文本节点，不产生 HTML 字符串 */
function KeywordText({ text, keyword }: { text: string; keyword: string }): ReactNode {
  const segments = highlightSegments(text, keyword);
  return (
    <>
      {segments.map((segment, index) =>
        segment.hit ? (
          <mark className="interview-term__mark" key={`hit-${index}`}>
            {segment.text}
          </mark>
        ) : (
          <span key={`plain-${index}`}>{segment.text}</span>
        ),
      )}
    </>
  );
}

/**
 * 名词按钮。
 *
 * 用 `Button type="text"` 承载而不是自绘 `<span onClick>`：键盘可达性、焦点环、
 * 禁用语义都由组件库给（AGENTS §6.1.2）。外观在 index.scss 里清成「行内下划线」。
 */
function TermChip({
  text,
  term,
  keyword = "",
  code = false,
}: {
  text: string;
  term: GlossaryTerm;
  keyword?: string;
  code?: boolean;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const related = (term.related ?? [])
    .map((id) => glossaryById(id))
    .filter((item): item is GlossaryTerm => Boolean(item));

  const panel = (
    <div className="interview-term__panel">
      <div className="interview-term__panel-head">
        <strong className="interview-term__panel-title">{term.term}</strong>
        {term.en && term.en !== term.term ? (
          <span className="interview-term__panel-en">{term.en}</span>
        ) : null}
        <Tag className="interview-term__panel-domain">
          {GLOSSARY_DOMAIN_LABEL[term.domain]}
        </Tag>
      </div>
      <p className="interview-term__panel-short">{term.short}</p>
      <ul className="interview-term__panel-points">
        {term.detail.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      {related.length > 0 ? (
        <p className="interview-term__panel-related">
          另见：{related.map((item) => item.term).join(" / ")}
        </p>
      ) : null}
    </div>
  );

  return (
    <Popover
      trigger="click"
      placement="top"
      arrow={false}
      open={open}
      onOpenChange={setOpen}
      classNames={{ root: "interview-term__pop" }}
      content={panel}
    >
      <Button
        className={`interview-term${code ? " is-code" : ""}`}
        type="text"
        aria-label={`名词解释：${term.term}`}
        aria-expanded={open}
      >
        {keyword ? <KeywordText text={text} keyword={keyword} /> : text}
      </Button>
    </Popover>
  );
}

/**
 * 名词感知的文本渲染器。
 *
 * 题干、标题、答案段落都经过这里：命中的名词变成可点击按钮，点击弹出
 * 「一句话定义 + 细节 + 相关词」。未命中时退化为普通文本 + 关键词高亮，
 * 因此可以放心地全量替换原来的 `Highlighted`。
 */
export default function TermText({ text, keyword = "" }: TermTextProps): ReactNode {
  if (text.length === 0) return null;
  const segments = splitByGlossary(text);

  return (
    <>
      {segments.map((segment, index) =>
        segment.term ? (
          <TermChip
            text={segment.text}
            term={segment.term}
            keyword={keyword}
            key={`term-${segment.term.id}-${index}`}
          />
        ) : (
          <KeywordText text={segment.text} keyword={keyword} key={`text-${index}`} />
        ),
      )}
    </>
  );
}

/** 行内代码里的名词：整段相等才算命中，由渲染层先判断再决定用哪个组件 */
export { TermChip };
