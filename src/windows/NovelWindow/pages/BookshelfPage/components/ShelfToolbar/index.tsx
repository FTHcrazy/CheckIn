import { AppstoreOutlined, SortAscendingOutlined, UnorderedListOutlined } from "@ant-design/icons";
import { Button, Segmented, Select } from "antd";
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
          <Button
            key={chip.key}
            role="tab"
            aria-selected={status === chip.key}
            className={`bs-toolbar__chip${status === chip.key ? " is-active" : ""}`}
            onClick={() => onStatusChange(chip.key)}
          >
            {chip.label}
            <span className="bs-toolbar__chip-count">{counts[chip.key]}</span>
          </Button>
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
        {/* 视图切换：antd Segmented（AGENTS §6.1.2 分段切换一律走组件库）。
            改前是两颗 antd Button 手搓的「轨道 + 选中格」，交互语义与键盘行为
            都要自己维护；Segmented 原生带滑块动画与 radio 语义，外观靠
            `--ant-segmented-*` 变量复刻成同一套（见 index.scss）。
            icon 选项不传 label，标题由 option.title 提供原生 title 提示。 */}
        <Segmented<ShelfViewMode>
          className="bs-toolbar__views"
          value={viewMode}
          onChange={onViewModeChange}
          aria-label="视图切换"
          options={[
            { value: "grid", icon: <AppstoreOutlined />, title: "网格视图" },
            { value: "list", icon: <UnorderedListOutlined />, title: "列表视图" },
          ]}
        />
      </div>
    </div>
  );
}
