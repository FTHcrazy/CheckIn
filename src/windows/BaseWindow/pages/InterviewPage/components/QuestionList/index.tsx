import { useState } from "react";
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

  const toggleExpand = (id: string): void => {
    setExpandedId((previous) => (previous === id ? null : id));
  };

  return (
    <div className="interview-list">
      <div className="interview-list__scroll">
        {questions.length === 0 ? (
          <Empty
            className="interview-list__empty"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="没有匹配的题目，试试换个关键词或放宽筛选条件"
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
