/**
 * 全局设定中心 · 左栏（搜索 / 筛选 / 排序 / 分类行 / 新建 / 快捷键提示）
 *
 * 窗口私有，替换 shared 的 `CategoryList`：
 * - shared 那一份是本书侧的口径（「等级序列」分组名 + FR-05 提示「重命名与删除
 *   在右侧卡片的『编辑 / 删除』按钮」），被共享用例钉死，本次**一个字不动**；
 * - 全局库要的是「几十条分类里 3 秒定位」+「一眼看出哪几条动不得」+「就近改完」。
 *
 * 搜索与筛选是**纯前端**：改 view 态 → `visibleCategories` 重算 → 重渲染，
 * **不触发任何 IPC、不改 sortOrder**（R1⑤ / R2③）。
 */

import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Empty, Input, Select, type InputRef } from "antd";
import type { KeyboardEvent, RefObject } from "react";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { SettingCategory } from "@/shared/novel/setting-types";
import { catId } from "@/shared/components/SettingCenter/setting-center-shared";
import type { GsView } from "../../hooks/useGlobalSettingView";
import type {
  GsCategoryFilter,
  GsSortMode,
} from "../../hooks/gs-view-utils";
import GsCategoryRow from "../GsCategoryRow";
import "./index.scss";

export interface GsCategorySidebarProps {
  /** 当前可见（过滤 + 排序后）的分类 */
  categories: SettingCategory[];
  /** 全量条数（空态判定要区分「本来就没有」与「搜/筛 0 命中」） */
  total: number;
  activeId: string;
  view: GsView;
  /** 是否允许拖拽排序（= `view.canDrag`，显式传入避免子组件再去算一遍） */
  canDrag: boolean;
  /** 拖拽中的条目 id（带 cat:/lvl: 前缀） */
  dragId: string | null;
  newCategoryName: string;
  onNewCategoryNameChange: (value: string) => void;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleKind: (id: string) => void;
  /** 「新建分类」输入框的 ref：工具头与空态引导靠它把焦点送进来 */
  inputRef: RefObject<InputRef | null>;
  /** 搜索框的 ref：`Ctrl/⌘+F` 靠它聚焦并全选 */
  searchRef: RefObject<InputRef | null>;
}

const FILTER_OPTIONS: Array<{ value: GsCategoryFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "realm", label: "境界体系" },
  { value: "custom", label: "自定义" },
  { value: "referenced", label: "已被引用" },
  { value: "unreferenced", label: "暂无引用" },
];

const SORT_OPTIONS: Array<{ value: GsSortMode; label: string }> = [
  { value: "name", label: "按名称" },
  { value: "refCount", label: "按引用数" },
  { value: "custom", label: "自定义顺序" },
];

export default function GsCategorySidebar({
  categories,
  total,
  activeId,
  view,
  canDrag,
  dragId,
  newCategoryName,
  onNewCategoryNameChange,
  onCreate,
  onSelect,
  onDelete,
  onToggleKind,
  inputRef,
  searchRef,
}: GsCategorySidebarProps) {
  const { keyword, emptyKind, renamingId } = view;

  return (
    <aside className="gs-side">
      {/* 栏头：给这块面板一个名字与总量，窗口左栏才不是一列「悬浮的搜索 + 列表」 */}
      <div className="gs-side__head">
        <span className="gs-side__title">设定库</span>
        {/* 条数仍是**过滤后**的可见条数（与搜索/筛选同口径），不是全量 */}
        <span className="gs-side__count">{categories.length} 条</span>
      </div>

      <Input
        ref={searchRef}
        size="small"
        allowClear
        prefix={<SearchOutlined />}
        className="gs-side__search"
        aria-label="搜索设定分类"
        placeholder="搜索分类名 / 说明"
        value={keyword}
        onChange={(event) => view.setKeyword(event.target.value)}
      />

      {/* Q-C1：5 个筛选项在窄栏里 Segmented 必挤爆 ⇒ 一律用 Select
          （选项收进 portal 弹层，宽度恒定、键盘可达） */}
      <div className="gs-side__controls">
        <Select
          size="small"
          className="gs-side__select"
          aria-label="筛选分类"
          value={view.filter}
          options={FILTER_OPTIONS}
          classNames={{ popup: { root: "gs-side__dropdown" } }}
          onChange={(value: GsCategoryFilter) => view.setFilter(value)}
        />
        <Select
          size="small"
          className="gs-side__select"
          aria-label="排序方式"
          value={view.sortMode}
          options={SORT_OPTIONS}
          classNames={{ popup: { root: "gs-side__dropdown" } }}
          onChange={(value: GsSortMode) => view.setSortMode(value)}
        />
      </div>

      {/* 左栏唯一滚动区 */}
      <div className="gs-side__list" aria-label={`设定分类列表（共 ${total} 条）`}>
        <SortableContext
          items={categories.map((category) => catId(category.id))}
          strategy={verticalListSortingStrategy}
        >
          {categories.map((category) => (
            <GsCategoryRow
              key={category.id}
              category={category}
              isOn={category.id === activeId}
              canDrag={canDrag}
              isDragSource={dragId === catId(category.id)}
              renaming={renamingId === category.id}
              onSelect={() => onSelect(category.id)}
              onBeginRename={() => view.beginRename(category.id)}
              onCommitRename={view.commitRename}
              onCancelRename={view.cancelRename}
              onDelete={() => onDelete(category.id)}
              onToggleKind={() => onToggleKind(category.id)}
            />
          ))}
        </SortableContext>

        {emptyKind === "no-category" && (
          <Empty
            className="gs-side__empty"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="还没有设定分类"
          />
        )}
        {emptyKind === "no-match" && (
          <Empty
            className="gs-side__empty"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              keyword.trim()
                ? `没找到「${keyword.trim()}」相关的分类`
                : "当前筛选下没有分类"
            }
          >
            <Button size="small" onClick={() => (keyword.trim() ? view.clearKeyword() : view.setFilter("all"))}>
              {keyword.trim() ? "清空搜索" : "重置筛选"}
            </Button>
          </Empty>
        )}
      </div>

      {/* 新建块：输入独占一行、按钮落到下一行整行 —— 240px 栏宽里
          「输入 + 按钮」并排会把占位文案截成半句，也挤不出点击目标。 */}
      <div className="gs-side__newcat">
        <Input
          ref={inputRef}
          size="small"
          className="gs-side__newcat-input"
          value={newCategoryName}
          placeholder="新分类名，如法宝品阶"
          aria-label="新分类名"
          onChange={(event) => onNewCategoryNameChange(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter") onCreate();
          }}
        />
        <Button
          size="small"
          className="gs-side__newcat-btn"
          onClick={onCreate}
          disabled={!newCategoryName.trim()}
        >
          <PlusOutlined />
          新建
        </Button>
      </div>

      {/* Q5：旧提示「重命名与删除在右侧卡片的『编辑 / 删除』按钮」已过时
          （新左栏双击改名 + 右键菜单），换成实际入口。 */}
      <div className="gs-side__tip">
        双击改名 · 右键更多操作
        <br />
        Ctrl+F 搜索 · ↑↓ 切换
      </div>
    </aside>
  );
}
