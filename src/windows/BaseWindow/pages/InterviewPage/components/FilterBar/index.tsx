import { Button, Checkbox, Segmented, Select, Tooltip } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { DIFFICULTY_LABEL } from "../../data/interview-taxonomy";
import type { DifficultyKey, SortBy } from "../../data/interview-types";
import "./index.scss";

interface FilterBarProps {
  difficulty: DifficultyKey;
  sortBy: SortBy;
  tags: string[];
  tagOptions: string[];
  favoritesOnly: boolean;
  onDifficultyChange: (difficulty: DifficultyKey) => void;
  onSortChange: (sortBy: SortBy) => void;
  onTagsChange: (tags: string[]) => void;
  onFavoritesOnlyChange: (favoritesOnly: boolean) => void;
  onReset: () => void;
}

const DIFFICULTY_OPTIONS = [
  { label: "全部难度", value: "all" },
  { label: DIFFICULTY_LABEL.basic, value: "basic" },
  { label: DIFFICULTY_LABEL.medium, value: "medium" },
  { label: DIFFICULTY_LABEL.hard, value: "hard" },
];

const SORT_OPTIONS: readonly { label: string; value: SortBy }[] = [
  { label: "最近校对", value: "updated" },
  { label: "按热度", value: "hot" },
  { label: "按难度", value: "difficulty" },
];

function isDifficultyKey(value: string): value is DifficultyKey {
  return (
    value === "all" ||
    value === "basic" ||
    value === "medium" ||
    value === "hard"
  );
}

function isSortBy(value: string): value is SortBy {
  return value === "updated" || value === "hot" || value === "difficulty";
}

/**
 * 筛选条：难度、排序、标签多选、只看收藏、重置。
 *
 * 所有控件都是受控的纯展示组件，状态与动作全部来自页面 hook，
 * 因此「任一筛选变更把页码拉回 1」这类规则只存在于 reducer 里一处。
 */
export default function FilterBar({
  difficulty,
  sortBy,
  tags,
  tagOptions,
  favoritesOnly,
  onDifficultyChange,
  onSortChange,
  onTagsChange,
  onFavoritesOnlyChange,
  onReset,
}: FilterBarProps) {
  return (
    <div className="interview-filter">
      <Segmented
        className="interview-filter__difficulty"
        size="small"
        value={difficulty}
        options={DIFFICULTY_OPTIONS}
        onChange={(value) => {
          if (isDifficultyKey(value)) onDifficultyChange(value);
        }}
      />

      <Select
        className="interview-filter__tags"
        size="small"
        mode="multiple"
        allowClear
        value={tags}
        placeholder="按标签筛选（多选取交集）"
        options={tagOptions.map((tag) => ({ label: tag, value: tag }))}
        onChange={(value: string[]) => onTagsChange(value)}
      />

      <Select
        className="interview-filter__sort"
        size="small"
        value={sortBy}
        options={[...SORT_OPTIONS]}
        onChange={(value: string) => {
          if (isSortBy(value)) onSortChange(value);
        }}
      />

      <Tooltip title="只显示已经收藏的题目，收藏记录保存在本机">
        <Checkbox
          className="interview-filter__favorite"
          checked={favoritesOnly}
          onChange={(event) => onFavoritesOnlyChange(event.target.checked)}
        >
          只看收藏
        </Checkbox>
      </Tooltip>

      <Button
        className="interview-filter__reset"
        size="small"
        icon={<ReloadOutlined />}
        onClick={onReset}
      >
        重置筛选
      </Button>
    </div>
  );
}
