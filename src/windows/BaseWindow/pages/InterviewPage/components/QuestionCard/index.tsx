import { useLayoutEffect, useState, type ReactNode } from "react";
import { Button, Card, Tag, Tooltip } from "antd";
import { DownOutlined, StarFilled, StarOutlined, UpOutlined } from "@ant-design/icons";
import { categoryPath } from "../../data/interview-filter-utils";
import { DIFFICULTY_LABEL } from "../../data/interview-taxonomy";
import { parseInlineTokens, splitAnswerBlocks } from "../../data/interview-answer-utils";
import { glossaryExact } from "../../data/interview-glossary";
import { diagramById } from "../../data/interview-diagrams";
import type { InterviewQuestion } from "../../data/interview-types";
import TermText, { TermChip } from "../TermText";
import DiagramFigure from "../DiagramFigure";
import "./index.scss";

interface QuestionCardProps {
  question: InterviewQuestion;
  /** 当前关键词，用于标题与题干高亮 */
  keyword: string;
  favorite: boolean;
  expanded: boolean;
  onToggleFavorite: (id: string) => void;
  onToggleExpand: (id: string) => void;
}

/** 行内标记：**加粗** 与 `行内代码`；两种都要再过一遍名词识别 */
function InlineLine({ line, keyword }: { line: string; keyword: string }): ReactNode {
  const tokens = parseInlineTokens(line);
  return (
    <>
      {tokens.map((token, index) => {
        if (token.kind === "strong") {
          return (
            <strong key={`strong-${index}`}>
              <TermText text={token.text} keyword={keyword} />
            </strong>
          );
        }
        if (token.kind === "code") {
          // 行内代码常常就是术语本身（如 `structuredClone`），整段相等才换成可点名词
          const term = glossaryExact(token.text);
          if (term) {
            return (
              <TermChip
                key={`code-${index}`}
                text={token.text}
                term={term}
                keyword={keyword}
                code
              />
            );
          }
          return (
            <code className="interview-card__inline-code" key={`code-${index}`}>
              {token.text}
            </code>
          );
        }
        return <TermText text={token.text} keyword={keyword} key={`text-${index}`} />;
      })}
    </>
  );
}

/**
 * 参考答案渲染器。
 *
 * 按 ``` 围栏切成文本块与代码块；文本块逐行解析行内标记。
 * 全部用 React 元素拼装 —— 题库是本地静态数据也不放松这条，避免哪天
 * 接上远端题库时把 XSS 口子一起带进来。
 */
function AnswerBody({ answer, keyword }: { answer: string; keyword: string }): ReactNode {
  const blocks = splitAnswerBlocks(answer);
  return (
    <div className="interview-card__answer-body">
      {blocks.map((block, blockIndex) =>
        block.kind === "code" ? (
          <pre className="interview-card__code" key={`code-block-${blockIndex}`}>
            <code>{block.code}</code>
          </pre>
        ) : (
          <div className="interview-card__paragraph" key={`text-block-${blockIndex}`}>
            {block.lines.map((line, lineIndex) => {
              const isBullet = /^[-*]\s+/.test(line);
              const content = isBullet ? line.replace(/^[-*]\s+/, "") : line;
              return (
                <span
                  className={isBullet ? "interview-card__line is-bullet" : "interview-card__line"}
                  key={`line-${lineIndex}`}
                >
                  <InlineLine line={content} keyword={keyword} />
                </span>
              );
            })}
          </div>
        ),
      )}
    </div>
  );
}

/**
 * 单道题卡片：标题、分类路径、难度与标签、来源主题、校对时间、收藏星标，
 * 以及可展开的「图解 + 参考答案」。
 */
export default function QuestionCard({
  question,
  keyword,
  favorite,
  expanded,
  onToggleFavorite,
  onToggleExpand,
}: QuestionCardProps) {
  const path = categoryPath(question.categoryId).join(" / ");
  const diagram = question.diagramId ? diagramById(question.diagramId) : undefined;

  /**
   * 答案区懒挂载：首次展开前不渲染答案里的名词按钮与图解。
   * 一屏 12 张卡片的答案叠起来是几百个浮层锚点，开局全建出来会明显拖慢首屏。
   *
   * 用 `useLayoutEffect` 而不是 `useEffect`：后者在绘制之后才补内容，
   * 首次展开会变成「先瞬间撑开、再跳出内容」，展开动画白做。
   */
  const [revealed, setRevealed] = useState(false);
  useLayoutEffect(() => {
    if (expanded) setRevealed(true);
  }, [expanded]);

  return (
    <Card className="interview-card" size="small">
      <div className="interview-card__head">
        <h3 className="interview-card__title">
          <TermText text={question.title} keyword={keyword} />
        </h3>
        <Tooltip title={favorite ? "取消收藏" : "收藏这道题"}>
          <Button
            className={`interview-card__star${favorite ? " is-on" : ""}`}
            type="text"
            size="small"
            icon={favorite ? <StarFilled /> : <StarOutlined />}
            aria-pressed={favorite}
            aria-label={favorite ? "取消收藏" : "收藏"}
            onClick={() => onToggleFavorite(question.id)}
          />
        </Tooltip>
      </div>

      <div className="interview-card__meta">
        <span className="interview-card__path">{path}</span>
        <Tag className={`interview-card__difficulty is-${question.difficulty}`}>
          {DIFFICULTY_LABEL[question.difficulty]}
        </Tag>
        {diagram ? <Tag className="interview-card__tag is-diagram">图解</Tag> : null}
        {question.tags.map((tag) => (
          <Tag className="interview-card__tag" key={tag}>
            {tag}
          </Tag>
        ))}
      </div>

      <p className="interview-card__stem">
        <TermText text={question.stem} keyword={keyword} />
      </p>

      {/* 题目代码常显：读代码类的题，代码是题干的一部分，不能藏在答案里 */}
      {question.stemCode ? (
        <div className="interview-card__stem-code">
          {question.stemCodeLang ? (
            <span className="interview-card__stem-code-lang">{question.stemCodeLang}</span>
          ) : null}
          <pre className="interview-card__code">
            <code>{question.stemCode}</code>
          </pre>
        </div>
      ) : null}

      <div className="interview-card__footer">
        <span className="interview-card__topic" title="来源主题">
          {question.topic}
        </span>
        <span className="interview-card__reviewed">
          校对 {question.reviewedAt} · 热度 {question.heat}
        </span>
        <Button
          className="interview-card__toggle"
          type="link"
          size="small"
          icon={expanded ? <UpOutlined /> : <DownOutlined />}
          aria-expanded={expanded}
          onClick={() => onToggleExpand(question.id)}
        >
          {expanded
            ? "收起答案"
            : question.stemCode
              ? "先作答，再看答案"
              : "查看参考答案"}
        </Button>
      </div>

      {/* 展开动画走 grid-template-rows 过渡，避免条件渲染打断动画 */}
      <div
        className={`interview-card__answer${expanded ? " is-open" : ""}`}
        aria-hidden={!expanded}
      >
        <div className="interview-card__answer-inner">
          {revealed ? (
            <>
              {diagram ? (
                <div className="interview-card__diagram">
                  <DiagramFigure diagram={diagram} />
                </div>
              ) : null}
              <AnswerBody answer={question.answer} keyword={keyword} />
            </>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
