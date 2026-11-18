import { useLayoutEffect, useState, type ReactNode } from "react";
import { Button, Card, Popover, Tag, Tooltip } from "antd";
import {
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  StarFilled,
  StarOutlined,
  UndoOutlined,
  UpOutlined,
} from "@ant-design/icons";
import { categoryPath } from "../../data/interview-filter-utils";
import { DIFFICULTY_LABEL } from "../../data/interview-taxonomy";
import { parseInlineTokens, splitAnswerBlocks } from "../../data/interview-answer-utils";
import { QUESTION_BY_ID } from "../../data/interview-bank";
import { glossaryExact } from "../../data/interview-glossary";
import { diagramById } from "../../data/interview-diagrams";
import type { InterviewQuestion } from "../../data/interview-types";
import type { QuestionOrigin } from "../../hooks/useQuestionOverride";
import { useInterviewBankContext } from "../InterviewBankProvider/context";
import TermText, { TermChip } from "../TermText";
import DiagramFigure from "../DiagramFigure";
import "./index.scss";

interface QuestionCardProps {
  question: InterviewQuestion;
  /** 当前关键词，用于标题与题干高亮 */
  keyword: string;
  favorite: boolean;
  expanded: boolean;
  /**
   * 这道题来自哪里（合并视图给的 `originById`）：决定显示哪些维护动作。
   * `undefined` = 查不到来源（被隐藏 / 被不变式丢弃 / 还没算出来）→ 不给动作。
   */
  origin?: QuestionOrigin;
  /** 这道题在 `staleBase` 里（改过且新版也改过，§5.4） */
  stale: boolean;
  /** 正在写这条：按钮转 loading，避免同一条被连点两次 */
  pending: boolean;
  onToggleFavorite: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onEdit: (question: InterviewQuestion) => void;
  /** 隐藏默认题（墓碑） */
  onHide: (question: InterviewQuestion) => void;
  /** 还原默认（丢掉自己的覆盖行） */
  onRevert: (question: InterviewQuestion) => void;
  /** 软删自建题 */
  onDeleteNew: (question: InterviewQuestion) => void;
  /** 确认「基线已更新，沿用我的」 */
  onAckBase: (question: InterviewQuestion) => void;
}

/**
 * 行内标记：**加粗** 与 `行内代码`；两种都要再过一遍名词识别。
 *
 * 行内代码的「整段精确匹配」也走合并后的词表（有 Provider 时）：用户在库里
 * 新增了一个词条，正文里的 `` `xxx` `` 立刻应该能点开，而不是只有散落在
 * 句子里的同名文字变蓝。没有 Provider 时仍是基线 `glossaryExact`。
 */
function InlineLine({ line, keyword }: { line: string; keyword: string }): ReactNode {
  const glossaryIndex = useInterviewBankContext()?.glossaryIndex;
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
          const term = glossaryIndex ? glossaryIndex.exact(token.text) : glossaryExact(token.text);
          if (term) {
            return (
              <TermChip
                key={`code-${index}`}
                text={token.text}
                term={term}
                keyword={keyword}
                code
                glossaryIndex={glossaryIndex}
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
 * 卡片头部的维护动作区。
 *
 * 三类来源给三套动作，**不给「全都能做」的按钮集合**：
 * - `baseline`（源码里的默认题）：编辑（写覆盖行）/ 删除（写墓碑，可恢复）；
 * - `override`（被我改过的默认题）：编辑 / 还原默认（删掉覆盖行）；
 * - `new`（我新建的题）：编辑 / 删除（软删进回收站）。
 *
 * 全部是图标按钮 + Tooltip：一行里已经挤了标题与收藏星，
 * 再放三个中文按钮会把标题压成两行。`aria-label` 保证读屏与测试都能认出来。
 */
function CardOps({
  question,
  origin,
  pending,
  onEdit,
  onHide,
  onRevert,
  onDeleteNew,
}: {
  question: InterviewQuestion;
  origin: QuestionOrigin | undefined;
  pending: boolean;
  onEdit: (question: InterviewQuestion) => void;
  onHide: (question: InterviewQuestion) => void;
  onRevert: (question: InterviewQuestion) => void;
  onDeleteNew: (question: InterviewQuestion) => void;
}): ReactNode {
  if (!origin) return null;

  const isNew = origin === "new";
  const removeLabel = isNew ? "删除这道题" : "隐藏这道默认题";

  return (
    <div className="interview-card__ops">
      <Tooltip title="编辑这道题">
        <Button
          className="interview-card__op"
          type="text"
          size="small"
          icon={<EditOutlined />}
          disabled={pending}
          aria-label="编辑这道题"
          onClick={() => onEdit(question)}
        />
      </Tooltip>

      {origin === "override" ? (
        <Tooltip title="还原默认（丢掉我的修改）">
          <Button
            className="interview-card__op"
            type="text"
            size="small"
            icon={<UndoOutlined />}
            disabled={pending}
            aria-label="还原默认"
            onClick={() => onRevert(question)}
          />
        </Tooltip>
      ) : (
        <Tooltip title={isNew ? "删除这道题（可在回收站找回）" : "隐藏这道默认题（可恢复）"}>
          <Button
            className="interview-card__op"
            type="text"
            size="small"
            icon={<DeleteOutlined />}
            disabled={pending}
            aria-label={removeLabel}
            onClick={() => (isNew ? onDeleteNew(question) : onHide(question))}
          />
        </Tooltip>
      )}
    </div>
  );
}

/**
 * 「基线已更新」浮层（§5.4）。
 *
 * 合并算法**不自动挑边**：内容仍用用户版，这里只把「新版也改过」摆出来，
 * 由用户决定「沿用我的」还是「看新版」。第一版只给只读的新版原文 ——
 * 「用新版覆盖我的」会丢用户改动，属于需要确认流程的动作，等下一批再做。
 *
 * 基线原文从 `QUESTION_BY_ID` 取（编译期常量），不从合并结果取：
 * 合并结果里的那道题是**用户版本**，拿来当「新版」展示等于自己跟自己 diff。
 */
function StaleBasePanel({
  question,
  pending,
  onAckBase,
  onUseBaseline,
}: {
  question: InterviewQuestion;
  pending: boolean;
  onAckBase: (question: InterviewQuestion) => void;
  /** 「用新版覆盖」= 删掉覆盖行（等价于还原默认），会丢用户的改动 */
  onUseBaseline: (question: InterviewQuestion) => void;
}): ReactNode {
  const [showBaseline, setShowBaseline] = useState(false);
  const baseline = QUESTION_BY_ID[question.id] ?? null;

  if (!baseline) {
    return (
      <div className="interview-card__stale-panel">
        <p className="interview-card__stale-hint">
          这道默认题在当前版本已经不存在了，你的修改仍然保留在库里。
        </p>
      </div>
    );
  }

  if (showBaseline) {
    return (
      <div className="interview-card__stale-panel">
        <p className="interview-card__stale-hint">
          新版默认内容（只读，不会覆盖你的修改）：
        </p>
        <h4 className="interview-card__stale-title">{baseline.title}</h4>
        <p className="interview-card__stale-stem">{baseline.stem}</p>
        <pre className="interview-card__stale-answer">{baseline.answer}</pre>
        <div className="interview-card__stale-ops">
          <Button size="small" onClick={() => setShowBaseline(false)}>
            收起新版
          </Button>
          <Button
            size="small"
            danger
            loading={pending}
            onClick={() => onUseBaseline(question)}
          >
            用新版覆盖
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="interview-card__stale-panel">
      <p className="interview-card__stale-hint">
        新版改过这道题的默认答案，你现在看到的仍然是自己改的版本。
      </p>
      <div className="interview-card__stale-ops">
        <Button
          type="primary"
          size="small"
          loading={pending}
          onClick={() => onAckBase(question)}
        >
          沿用我的
        </Button>
        <Button size="small" onClick={() => setShowBaseline(true)}>
          看新版
        </Button>
        <Button
          size="small"
          danger
          loading={pending}
          onClick={() => onUseBaseline(question)}
        >
          用新版覆盖
        </Button>
      </div>
    </div>
  );
}

/**
 * 单道题卡片：标题、分类路径、难度与标签、来源主题、校对时间、收藏星标、
 * 维护动作，以及可展开的「图解 + 参考答案」。
 *
 * 图解查找走合并视图（有 Provider 时）：用户覆盖 / 新增的图解要能在这张卡片上
 * 生效，隐藏的图解也不该再出现。没有 Provider 时回落基线 `diagramById`。
 */
export default function QuestionCard({
  question,
  keyword,
  favorite,
  expanded,
  origin,
  stale,
  pending,
  onToggleFavorite,
  onToggleExpand,
  onEdit,
  onHide,
  onRevert,
  onDeleteNew,
  onAckBase,
}: QuestionCardProps) {
  const bank = useInterviewBankContext();
  const diagramsById = bank?.diagramsById;
  // 分类路径用合并后的分类表：自建题可能挂在 `u-c-*` 自定义分类下
  const path = categoryPath(question.categoryId, bank?.categories).join(" / ");
  const diagram = question.diagramId
    ? diagramsById
      ? diagramsById[question.diagramId]
      : diagramById(question.diagramId)
    : undefined;

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
        <div className="interview-card__heading">
          <h3 className="interview-card__title">
            <TermText text={question.title} keyword={keyword} />
          </h3>
          {/* 「基线已更新」是这道题的属性，不是全局提示，所以挂在这一行而不是页面顶部。
              它在 `<h3>` 之外：标题元素的文本必须是**纯标题**，否则按 textContent
              取标题的地方（列表比标题、导出、测试）会顺带拿到这个标记。 */}
          {stale ? (
            <Popover
              className="interview-card__stale-popover"
              trigger="click"
              placement="bottomLeft"
              title="基线已更新"
              content={
                <StaleBasePanel
                  question={question}
                  pending={pending}
                  onAckBase={onAckBase}
                  onUseBaseline={onRevert}
                />
              }
            >
              {/* 用 Button 承载而不是 `<Tag role="button" tabIndex={0}>`：
                  后者只有标签语义，Enter / Space 不会触发点击，键盘用户进不去这个面板 */}
              <Button className="interview-card__stale" size="small">
                基线已更新
              </Button>
            </Popover>
          ) : null}
        </div>

        <CardOps
          question={question}
          origin={origin}
          pending={pending}
          onEdit={onEdit}
          onHide={onHide}
          onRevert={onRevert}
          onDeleteNew={onDeleteNew}
        />

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
        <Tooltip title="这道题出自哪个主题">
          <span className="interview-card__topic">{question.topic}</span>
        </Tooltip>
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
