import { useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Tooltip } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { CATEGORIES_BY_TRACK, type CategoryNode } from "../../data/interview-taxonomy";
import type { CategoryCounts } from "../../data/interview-filter-utils";
import type { CategoryKey, QuestionTrack } from "../../data/interview-types";
import "./index.scss";

interface CategorySidebarProps {
  track: QuestionTrack;
  categoryId: CategoryKey;
  counts: CategoryCounts;
  /**
   * 合并后的分类表（22 基线 + 已采纳的自定义分类）。
   * 不传则只用基线 —— 单测与「没有 Provider」的场景仍能渲染。
   */
  categories?: readonly CategoryNode[];
  onSelect: (categoryId: CategoryKey) => void;
  /** 打开「分类管理」抽屉；不传则不显示入口 */
  onManage?: () => void;
}

/** 笔试题按题型分、基础知识库按知识域分，小标题跟着轨道变 */
const SECTION_TITLE: Record<QuestionTrack, string> = {
  written: "题型",
  foundation: "知识域",
};

/**
 * 分类名：**被截断时** hover 才给 tooltip。
 *
 * 没截断还弹一个和眼前文字一模一样的提示，等于鼠标每路过一行都被打断一次；
 * 所以这里做成受控 —— 溢出判定在 mouseenter 里现测（不在挂载时算一次），
 * 侧栏宽度会随窗口变，提前量出来的值过一会儿就不准了。
 *
 * 用 `ref` 而不是 state 存判定结果：rc-tooltip 会在同一次事件里紧接着
 * 调用 `onOpenChange(true)`，那时 state 还没刷进闭包，只有 ref 读得到新值。
 */
function CategoryLabel({ text }: { text: string }): ReactNode {
  const labelRef = useRef<HTMLSpanElement | null>(null);
  const overflowing = useRef(false);
  const [open, setOpen] = useState(false);

  return (
    <Tooltip title={text} open={open} onOpenChange={(next) => setOpen(next && overflowing.current)}>
      <span
        ref={labelRef}
        className="interview-cats__label"
        onMouseEnter={() => {
          const el = labelRef.current;
          if (!el) return;
          // +1 是亚像素误差：scrollWidth 会取整，差 1px 不算截断
          overflowing.current = el.scrollWidth > el.clientWidth + 1;
        }}
      >
        {text}
      </span>
    </Tooltip>
  );
}

/**
 * 左侧分类栏。
 *
 * 角标数来自 `countByCategory`（已排除分类维度），因此「角标 = 点进去的条数」；
 * 用 Button 承载是为了直接拿到键盘可达性、禁用语义与 focus 环，
 * 外观通过组件级变量清零后重写（见 index.scss）。
 *
 * 分类清单来自**合并后的分类表**：`u-c-*` 自定义分类与 22 个基线分类在侧栏里
 * 平权（只按 `order` 排序，基线 1-22 在前）。某分类下一道已采纳题都没有时
 * 角标显示 0 并置灰 —— 规范 §9 的「空分类标灰」。
 */
export default function CategorySidebar({
  track,
  categoryId,
  counts,
  categories,
  onSelect,
  onManage,
}: CategorySidebarProps) {
  const nodes = useMemo<readonly CategoryNode[]>(() => {
    if (!categories || categories.length === 0) return CATEGORIES_BY_TRACK[track];
    return categories
      .filter((node) => node.track === track)
      .slice()
      .sort((left, right) => left.order - right.order);
  }, [categories, track]);

  return (
    <aside className="interview-cats">
      <div className="interview-cats__title">
        {SECTION_TITLE[track]}
        {onManage ? (
          <Button
            className="interview-cats__manage"
            type="text"
            size="small"
            icon={<PlusOutlined />}
            aria-label="分类管理"
            onClick={onManage}
          >
            分类
          </Button>
        ) : null}
      </div>
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
          const count = counts[node.id] ?? 0;
          return (
            <Button
              key={node.id}
              className={`interview-cats__item${active ? " is-active" : ""}${
                count === 0 ? " is-empty" : ""
              }`}
              block
              aria-current={active ? "true" : undefined}
              onClick={() => onSelect(node.id)}
            >
              <CategoryLabel text={node.label} />
              <span className="interview-cats__count">{count}</span>
            </Button>
          );
        })}
      </nav>
    </aside>
  );
}
