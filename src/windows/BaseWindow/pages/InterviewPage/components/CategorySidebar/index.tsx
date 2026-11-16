import { Button } from "antd";
import { CATEGORIES_BY_TRACK } from "../../data/interview-taxonomy";
import type { CategoryCounts } from "../../data/interview-filter-utils";
import type { CategoryKey, QuestionTrack } from "../../data/interview-types";
import "./index.scss";

interface CategorySidebarProps {
  track: QuestionTrack;
  categoryId: CategoryKey;
  counts: CategoryCounts;
  onSelect: (categoryId: CategoryKey) => void;
}

/** 笔试题按题型分、基础知识库按知识域分，小标题跟着轨道变 */
const SECTION_TITLE: Record<QuestionTrack, string> = {
  written: "题型",
  foundation: "知识域",
};

/**
 * 左侧分类栏。
 *
 * 角标数来自 `countByCategory`（已排除分类维度），因此「角标 = 点进去的条数」；
 * 用 Button 承载是为了直接拿到键盘可达性、禁用语义与 focus 环，
 * 外观通过组件级变量清零后重写（见 index.scss）。
 */
export default function CategorySidebar({
  track,
  categoryId,
  counts,
  onSelect,
}: CategorySidebarProps) {
  const nodes = CATEGORIES_BY_TRACK[track];

  return (
    <aside className="interview-cats">
      <div className="interview-cats__title">{SECTION_TITLE[track]}</div>
      <nav className="interview-cats__list">
        <Button
          className={`interview-cats__item${categoryId === "all" ? " is-active" : ""}`}
          block
          aria-current={categoryId === "all" ? "true" : undefined}
          onClick={() => onSelect("all")}
        >
          <span className="interview-cats__label">全部分类</span>
          <span className="interview-cats__count">{counts.all ?? 0}</span>
        </Button>
        {nodes.map((node) => {
          const active = categoryId === node.id;
          return (
            <Button
              key={node.id}
              className={`interview-cats__item${active ? " is-active" : ""}`}
              block
              aria-current={active ? "true" : undefined}
              onClick={() => onSelect(node.id)}
            >
              <span className="interview-cats__label">{node.label}</span>
              <span className="interview-cats__count">{counts[node.id] ?? 0}</span>
            </Button>
          );
        })}
      </nav>
    </aside>
  );
}
