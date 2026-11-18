import { useEffect, useRef, useState } from "react";
import { Button, Empty, Pagination, Typography } from "antd";
import QuestionCard from "../QuestionCard";
import type { InterviewQuestion } from "../../data/interview-types";
import type { QuestionOrigin } from "../../hooks/useQuestionOverride";
import "./index.scss";

const { Text } = Typography;

interface QuestionListProps {
  questions: readonly InterviewQuestion[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  keyword: string;
  favorites: ReadonlySet<string>;
  /** 每道题的来源（合并视图的 `originById`）：卡片据此显示维护动作 */
  originById: Readonly<Record<string, QuestionOrigin>>;
  /** 「基线已更新」的题目 id（`staleBase` 投影） */
  staleIds: ReadonlySet<string>;
  /** 正在写的那条（按钮 loading） */
  pendingId: string | null;
  /**
   * 换一批题目就回到顶部（左栏分类 / 轨道切换时变化）。
   *
   * 滚动位置属于「上一批内容」：换了分类还停在列表中间，第一屏看到的是半截
   * 列表，很容易以为这个分类只有这么几道题。
   */
  scrollResetKey: string;
  onToggleFavorite: (id: string) => void;
  onPageChange: (page: number) => void;
  onReset: () => void;
  onEdit: (question: InterviewQuestion) => void;
  onHide: (question: InterviewQuestion) => void;
  onRevert: (question: InterviewQuestion) => void;
  onDeleteNew: (question: InterviewQuestion) => void;
  onAckBase: (question: InterviewQuestion) => void;
}

/**
 * 题目列表。
 *
 * 展开态只保留一道题（作答场景下同时展开多张卡只会让人分不清哪条答案属于哪条题干）；
 * 状态只在这里，不上移到页面 —— 它不影响筛选结果，没必要进入全局状态。
 *
 * 维护动作在本层只做**透传**：写库要「先写、再重算合并视图」，那份状态在页面
 * （`useQuestionOverride`）里只有一份，卡片自己建会各算各的 `pendingId`。
 */
export default function QuestionList({
  questions,
  total,
  page,
  pageCount,
  pageSize,
  keyword,
  favorites,
  originById,
  staleIds,
  pendingId,
  scrollResetKey,
  onToggleFavorite,
  onPageChange,
  onReset,
  onEdit,
  onHide,
  onRevert,
  onDeleteNew,
  onAckBase,
}: QuestionListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const toggleExpand = (id: string): void => {
    setExpandedId((previous) => (previous === id ? null : id));
  };

  // 换分类 / 换页后内容整批换掉，滚动位置没有意义：直接回顶。
  // 翻页按钮在列表底部，不重置的话翻完还停在上一页的末尾位置，
  // 看到的是这一页的最后几条 —— 等于「翻页没反应」。
  // 用 `scrollTop = 0` 而不是 `scrollTo`：jsdom 没有实现后者（单测会直接抛）
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
  }, [scrollResetKey, page]);

  return (
    <div className="interview-list">
      <div className="interview-list__scroll" ref={scrollRef}>
        {questions.length === 0 ? (
          <Empty
            className="interview-list__empty"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            // 空态要分清「搜不到」和「筛空了」：前者用户会去改关键词，
            // 后者改关键词没用，得放宽难度 / 标签 / 收藏那几个条件
            description={
              keyword
                ? `没有匹配「${keyword}」的题目，换个说法或清空关键词再试`
                : "当前筛选条件下没有题目，放宽条件后再试"
            }
          >
            <Button className="interview-list__reset" type="primary" onClick={onReset}>
              重置筛选条件
            </Button>
          </Empty>
        ) : (
          questions.map((question) => (
            <QuestionCard
              key={question.id}
              question={question}
              keyword={keyword}
              favorite={favorites.has(question.id)}
              expanded={expandedId === question.id}
              origin={originById[question.id]}
              stale={staleIds.has(question.id)}
              pending={pendingId === question.id}
              onToggleFavorite={onToggleFavorite}
              onToggleExpand={toggleExpand}
              onEdit={onEdit}
              onHide={onHide}
              onRevert={onRevert}
              onDeleteNew={onDeleteNew}
              onAckBase={onAckBase}
            />
          ))
        )}
      </div>

      {total > 0 ? (
        <div className="interview-list__footer">
          <Text type="secondary" className="interview-list__hint">
            第 {page} / {pageCount} 页 · 每页 {pageSize} 题
          </Text>
          <Pagination
            current={page}
            pageSize={pageSize}
            total={total}
            showSizeChanger={false}
            size="small"
            showTotal={(value) => `共 ${value} 题`}
            onChange={onPageChange}
          />
        </div>
      ) : null}
    </div>
  );
}
