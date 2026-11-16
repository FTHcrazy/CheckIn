import { useState } from "react";
import Page from "@/shared/components/Page";
import SearchPanel from "./components/SearchPanel";
import CategorySidebar from "./components/CategorySidebar";
import FilterBar from "./components/FilterBar";
import QuestionList from "./components/QuestionList";
import KnowledgeDrawer from "./components/KnowledgeDrawer";
import { useInterviewPage } from "./hooks/useInterviewPage";
import "./index.scss";

/**
 * 前端面试题页。
 *
 * 结构固定三层：顶部搜索区 → 左侧分类栏 + 右侧（筛选条 + 题目列表）。
 * 状态全部收敛在 `useInterviewPage`：一个 `useReducer` 持有筛选条件，
 * 命中集合 / 角标 / 排序 / 分页都由 `useMemo` 从题库派生，组件本身不存业务状态。
 */
export default function InterviewPage() {
  /** 知识体系抽屉是纯展示态，不影响筛选，留在页面本地 */
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);

  const {
    filter,
    keywordInput,
    setKeywordInput,
    submitKeyword,
    questions,
    total,
    page,
    pageCount,
    pageSize,
    counts,
    tagOptions,
    favorites,
    favoriteCount,
    toggleFavorite,
    setTrack,
    setCategory,
    setDifficulty,
    setTags,
    setFavoritesOnly,
    setSortBy,
    setPage,
    reset,
  } = useInterviewPage();

  return (
    <Page>
      <div className="interview-page">
        <SearchPanel
          track={filter.track}
          keyword={keywordInput}
          total={total}
          favoriteCount={favoriteCount}
          onTrackChange={setTrack}
          onKeywordChange={setKeywordInput}
          onSearch={submitKeyword}
          onOpenKnowledge={() => setKnowledgeOpen(true)}
        />

        <div className="interview-page__body">
          <CategorySidebar
            track={filter.track}
            categoryId={filter.categoryId}
            counts={counts}
            onSelect={setCategory}
          />

          <div className="interview-page__main">
            <FilterBar
              difficulty={filter.difficulty}
              sortBy={filter.sortBy}
              tags={filter.tags}
              tagOptions={tagOptions}
              favoritesOnly={filter.favoritesOnly}
              onDifficultyChange={setDifficulty}
              onSortChange={setSortBy}
              onTagsChange={setTags}
              onFavoritesOnlyChange={setFavoritesOnly}
              onReset={reset}
            />

            <QuestionList
              questions={questions}
              total={total}
              page={page}
              pageCount={pageCount}
              pageSize={pageSize}
              keyword={filter.keyword}
              favorites={favorites}
              onToggleFavorite={toggleFavorite}
              onPageChange={setPage}
              onReset={reset}
            />
          </div>
        </div>

        <KnowledgeDrawer
          open={knowledgeOpen}
          track={filter.track}
          categoryId={filter.categoryId}
          onClose={() => setKnowledgeOpen(false)}
        />
      </div>
    </Page>
  );
}
