import { Input, Popover, Segmented } from "antd";
import { FilterOutlined, SearchOutlined } from "@ant-design/icons";
import type { LedgerCategoryDTO } from "@/shared/services/ledger";
import CategoryPicker from "../CategoryPicker";
import "./index.scss";

interface LedgerFilterBarProps {
  keyword: string;
  onKeywordChange: (keyword: string) => void;
  type: "all" | "expense" | "income";
  onTypeChange: (type: "all" | "expense" | "income") => void;
  categories: readonly LedgerCategoryDTO[];
  categoryId: string | null;
  onCategoryChange: (categoryId: string | null) => void;
  count: number;
}

/** 筛选条：关键词 + 类型 + 分类弹层 + 计数 */
export default function LedgerFilterBar({
  keyword,
  onKeywordChange,
  type,
  onTypeChange,
  categories,
  categoryId,
  onCategoryChange,
  count,
}: LedgerFilterBarProps) {
  const activeCategory = categoryId
    ? categories.find((category) => category.id === categoryId) ?? null
    : null;

  return (
    <div className="ld-filter">
      <Input
        className="ld-filter__search"
        value={keyword}
        onChange={(event) => onKeywordChange(event.target.value)}
        placeholder="搜索备注或分类"
        prefix={<SearchOutlined />}
        allowClear
        aria-label="搜索账目"
      />
      <Segmented<"all" | "expense" | "income">
        value={type}
        options={[
          { label: "全部", value: "all" },
          { label: "支出", value: "expense" },
          { label: "收入", value: "income" },
        ]}
        onChange={onTypeChange}
        aria-label="收支类型"
      />
      <Popover
        trigger="click"
        placement="bottomRight"
        content={
          <div className="ld-filter__pop">
            <button
              type="button"
              className={`ld-filter__pop-clear${categoryId ? "" : " is-active"}`}
              onClick={() => onCategoryChange(null)}
            >
              全部分类
            </button>
            <CategoryPicker
              categories={categories}
              value={categoryId}
              onChange={(id) => onCategoryChange(id === categoryId ? null : id)}
            />
          </div>
        }
      >
        <button
          type="button"
          className={`ld-filter__pill${activeCategory ? " is-active" : ""}`}
          aria-label="按分类筛选"
        >
          <FilterOutlined />
          {activeCategory ? activeCategory.name : "分类"}
        </button>
      </Popover>
      <span className="ld-filter__count">{count} 笔</span>
    </div>
  );
}
