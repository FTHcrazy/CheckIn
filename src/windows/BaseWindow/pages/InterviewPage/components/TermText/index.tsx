import { useState, type ReactNode } from "react";
import { Button, Popover, Tag } from "antd";
import { highlightSegments } from "../../data/interview-filter-utils";
import {
  GLOSSARY_DOMAIN_LABEL,
  glossaryById,
  splitByGlossary,
  type GlossaryTerm,
} from "../../data/interview-glossary";
import type { GlossaryMatchIndex } from "../../persistence/glossary-matcher";
import { isChipClickSuppressed } from "../../hooks/useSelectionTerms";
import { useInterviewBankContext } from "../InterviewBankProvider/context";
import "./index.scss";

interface TermTextProps {
  /** 纯文本（不含 `**` / 反引号等标记，标记由调用方先解析） */
  text: string;
  /** 当前搜索词，命中处仍要高亮，否则搜索结果里被术语吃掉的部分看起来没命中 */
  keyword?: string;
}

/**
 * 给片段补上「在完整原文里的起止下标」。
 *
 * 抽成模块级纯函数的两个理由：
 * 1. 组件体里累加游标会被 `react-hooks/immutability` 判成「渲染期间改闭包变量」；
 * 2. 划词反算偏移是纯计算，放在这里可以直接被单测覆盖。
 *
 * `data-text-*` 是划词的锚点：选区落在哪个片段上，就从它的起始下标 +
 * `range.startOffset` 反算出原文区间（规范 §10.2）。
 */
function withOffsets(
  segments: readonly { text: string }[],
  base: number,
): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let cursor = base;
  for (const segment of segments) {
    const start = cursor;
    cursor += segment.text.length;
    out.push({ start, end: cursor });
  }
  return out;
}

/** 关键词高亮：只包文本节点，不产生 HTML 字符串 */
function KeywordText({
  text,
  keyword,
  offset = 0,
}: {
  text: string;
  keyword: string;
  /** 这段文字在**完整原文**里的起始下标（划词反算偏移用） */
  offset?: number;
}): ReactNode {
  const segments = highlightSegments(text, keyword);
  const anchors = withOffsets(segments, offset);
  return (
    <>
      {segments.map((segment, index) =>
        segment.hit ? (
          <mark
            className="interview-term__mark"
            key={`hit-${index}`}
            data-text-start={anchors[index].start}
            data-text-end={anchors[index].end}
          >
            {segment.text}
          </mark>
        ) : (
          <span
            key={`plain-${index}`}
            data-text-start={anchors[index].start}
            data-text-end={anchors[index].end}
          >
            {segment.text}
          </span>
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
 *
 * `glossaryIndex` 可选：有合并视图时用它反查 `related`（用户新增的词条也能跳），
 * 没有时回落模块级基线函数 —— 两条路径的渲染结果完全一致。
 */
function TermChip({
  text,
  term,
  keyword = "",
  code = false,
  glossaryIndex,
  offset,
}: {
  text: string;
  term: GlossaryTerm;
  keyword?: string;
  code?: boolean;
  glossaryIndex?: GlossaryMatchIndex;
  /** 这段命中词在完整原文里的起止（划词反算偏移用；不传则不挂锚点） */
  offset?: { start: number; end: number };
}): ReactNode {
  const [open, setOpen] = useState(false);
  const termOf = (id: string): GlossaryTerm | undefined =>
    glossaryIndex ? glossaryIndex.byId(id) : glossaryById(id);
  const related = (term.related ?? [])
    .map((id) => termOf(id))
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
      onOpenChange={(next) => {
        // 拖选的终点常常正好落在这个按钮上：刚划完词的那一下 click 不该同时
        // 打开名词弹层（两套浮层会叠在一起）。抑制窗口由 `useSelectionTerms` 置。
        if (next && isChipClickSuppressed()) {
          setOpen(false);
          return;
        }
        setOpen(next);
      }}
      classNames={{ root: "interview-term__pop" }}
      content={panel}
    >
      <Button
        className={`interview-term${code ? " is-code" : ""}`}
        type="text"
        aria-label={`名词解释：${term.term}`}
        aria-expanded={open}
        {...(offset
          ? { "data-text-start": offset.start, "data-text-end": offset.end }
          : {})}
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
 *
 * 词表来源：有 `InterviewBankProvider` 时用**合并后**的匹配器
 * （`buildGlossaryIndex(merged.glossary)`，能认出用户新增 / 覆盖的词条）；
 * 没有 Provider 时用模块级基线 `splitByGlossary`。两条路径都产出
 * `GlossarySegment[]`，下游渲染结构完全一致 —— 这是既有测试能继续跑的原因。
 */
export default function TermText({ text, keyword = "" }: TermTextProps): ReactNode {
  // hook 必须在任何提前 return 之前调用
  const glossaryIndex = useInterviewBankContext()?.glossaryIndex;

  if (text.length === 0) return null;
  const segments = glossaryIndex ? glossaryIndex.split(text) : splitByGlossary(text);
  /**
   * 逐片段补齐原文偏移：`buildGlossaryIndex` 的命中片段自带 `start` / `end`，
   * 基线 `splitByGlossary` 不带。累加游标放在模块级纯函数里做（组件体里改闭包
   * 变量会被 `react-hooks/immutability` 拦），结果与片段一一对应。
   */
  const anchors = withOffsets(segments, 0);

  return (
    <>
      {segments.map((segment, index) => {
        const start = segment.start ?? anchors[index].start;
        const end = segment.end ?? anchors[index].end;
        return segment.term ? (
          <TermChip
            text={segment.text}
            term={segment.term}
            keyword={keyword}
            glossaryIndex={glossaryIndex}
            offset={{ start, end }}
            key={`term-${segment.term.id}-${index}`}
          />
        ) : (
          <KeywordText
            text={segment.text}
            keyword={keyword}
            offset={start}
            key={`text-${index}`}
          />
        );
      })}
    </>
  );
}

/** 行内代码里的名词：整段相等才算命中，由渲染层先判断再决定用哪个组件 */
export { TermChip };
