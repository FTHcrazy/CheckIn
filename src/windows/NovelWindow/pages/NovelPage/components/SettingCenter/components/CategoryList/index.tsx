/**
 * 设定中心 · 左栏分类列表（UI-10 拆分）
 *
 * 一列「等级序列」分类：境界体系只是其中 kind='realm' 的那一条，与自定义
 * 分类共用同一套能力。整行即拖拽把手（PointerSensor 带 distance 约束，
 * 点击仍是「选中分类」）；sortable 同时注册了同名 droppable，等级行拖到
 * 分类上松手 = 跨分类搬移，不需要额外的 Droppable。
 *
 * UI-05：此前这里只写中性的「设定分类」，新手按「世界观 / 人物 / 大纲」这类
 * 常识找不到「境界 / 品阶 / 功法等级」的入口。改为直白的分组名「等级序列」+
 * 一句人话说明，让新手一次找到。
 */

import { Button, Empty, Input } from "antd";
import type { KeyboardEvent } from "react";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PlusOutlined } from "@ant-design/icons";
import type { SettingCategory } from "../../../../types";
import { catId } from "../../setting-center-shared";
import "./index.scss";

/** 左栏分类行的可排序包装（@dnd-kit） */
function SortableCategoryRow({
  category,
  isOn,
  isDragSource,
  onSelect,
}: {
  category: SettingCategory;
  isOn: boolean;
  isDragSource: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: catId(category.id) });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`nv-sc__cat${isOn ? " is-on" : ""}${
        isDragSource || isDragging ? " is-drag" : ""
      }`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={onSelect}
    >
      <span
        className="nv-sc__dot"
        style={{ background: category.color }}
        aria-hidden
      />
      <span className="nv-sc__cat-name">{category.name}</span>
      <span className="nv-sc__cat-count">{category.levels.length} 级</span>
    </div>
  );
}

export interface CategoryListProps {
  categories: SettingCategory[];
  /** 当前选中的分类 id（已解析：点选 > 外部指定 > 第一个） */
  activeId: string;
  /** 拖拽中的条目 id（带 cat:/lvl: 前缀） */
  dragId: string | null;
  newCategoryName: string;
  onNewCategoryNameChange: (value: string) => void;
  onSelect: (categoryId: string) => void;
  onCreate: () => void;
}

export default function CategoryList({
  categories,
  activeId,
  dragId,
  newCategoryName,
  onNewCategoryNameChange,
  onSelect,
  onCreate,
}: CategoryListProps) {
  return (
    <aside className="nv-sc__side">
      {/* UI-05：常识化分组名，让新手一眼知道「境界 / 品阶」这类体系在哪 */}
      <div className="nv-sc__side-head">等级序列</div>
      <p className="nv-sc__side-desc">
        境界 / 品阶 / 功法等级都在这里 —— 一种体系建一个分类
      </p>
      <div className="nv-sc__list">
        <SortableContext
          items={categories.map((category) => catId(category.id))}
          strategy={verticalListSortingStrategy}
        >
          {categories.map((category) => (
            <SortableCategoryRow
              key={category.id}
              category={category}
              isOn={category.id === activeId}
              isDragSource={dragId === catId(category.id)}
              onSelect={() => onSelect(category.id)}
            />
          ))}
        </SortableContext>
        {categories.length === 0 && (
          <Empty
            className="nv-sc__empty"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="还没有设定分类"
          />
        )}
      </div>
      <div className="nv-sc__newcat">
        <Input
          size="small"
          value={newCategoryName}
          placeholder="新分类名，如「法宝品阶」"
          aria-label="新分类名"
          onChange={(event) => onNewCategoryNameChange(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter") onCreate();
          }}
        />
        <Button
          size="small"
          type="primary"
          onClick={onCreate}
          disabled={!newCategoryName.trim()}
        >
          <PlusOutlined />
          新建
        </Button>
      </div>
      {/* FR-05：旧提示承诺了右键与行尾菜单，但分类行两者都没有（无
          onContextMenu、无「⋯」），作者会一路找下去——已按实际入口订正 */}
      <div className="nv-sc__tip">重命名与删除在右侧卡片的「编辑 / 删除」按钮</div>
    </aside>
  );
}
