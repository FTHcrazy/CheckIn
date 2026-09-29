import { AppstoreOutlined, SortAscendingOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { Select } from "antd";
import type { ShelfSortKey, ShelfStatusFilter } from "../../bookshelf-utils";
import "./index.scss";

export type ShelfViewMode = "grid" | "list";

interface ShelfToolbarProps {
  status: ShelfStatusFilter;
  counts: Record<ShelfStatusFilter, number>;
  sortKey: ShelfSortKey;
  viewMode: ShelfViewMode;
  onStatusChange: (status: ShelfStatusFilter) => void;
  onSortChange: (key: ShelfSortKey) => void;
  onViewModeChange: (mode: ShelfViewMode) => void;
}

const STATUS_CHIPS: Array<{ key: ShelfStatusFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "ongoing", label: "连载中" },
  { key: "finished", label: "已完稿" },
];

const SORT_OPTIONS: Array<{ value: ShelfSortKey; label: string }> = [
  { value: "recent", label: "最近更新" },
  { value: "created", label: "创建时间" },
  { value: "words", label: "字数最多" },
];

/** 书架工具行（R32）：状态筛选 chips + 排序 + 视图切换 */
export default function ShelfToolbar({
  status,
  counts,
  sortKey,
  viewMode,
  onStatusChange,
  onSortChange,
  onViewModeChange,
}: ShelfToolbarProps) {
  return (
    <div className="bs-toolbar">
      <div className="bs-toolbar__chips" role="tablist" aria-label="作品状态筛选">
        {STATUS_CHIPS.map((chip) => (
          <button
            key={chip.key}
            type="button"
            role="tab"
            aria-selected={status === chip.key}
            className={`bs-toolbar__chip${status === chip.key ? " is-active" : ""}`}
            onClick={() => onStatusChange(chip.key)}
          >
            {chip.label}
            <span className="bs-toolbar__chip-count">{counts[chip.key]}</span>
          </button>
        ))}
      </div>

      <div className="bs-toolbar__right">
        <Select
          className="bs-toolbar__sort"
          value={sortKey}
          options={SORT_OPTIONS}
          onChange={onSortChange}
          size="small"
          variant="borderless"
          suffixIcon={<SortAscendingOutlined />}
          popupMatchSelectWidth={false}
        />
        <div className="bs-toolbar__views" role="group" aria-label="视图切换">
          <button
            type="button"
            className={`bs-toolbar__view${viewMode === "grid" ? " is-active" : ""}`}
            onClick={() => onViewModeChange("grid")}
            aria-label="网格视图"
          >
            <AppstoreOutlined />
          </button>
          <button
            type="button"
            className={`bs-toolbar__view${viewMode === "list" ? " is-active" : ""}`}
            onClick={() => onViewModeChange("list")}
            aria-label="列表视图"
          >
            <UnorderedListOutlined />
          </button>
        </div>
      </div>
    </div>
  );
}
