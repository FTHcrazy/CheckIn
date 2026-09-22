import { memo } from "react";
import type { LedgerCategoryDTO } from "@/shared/services/ledger";
import { renderCategoryIcon, colorVar, weakColorVar } from "../../constants/categories";
import "./index.scss";

interface CategoryPickerProps {
  categories: readonly LedgerCategoryDTO[];
  value: string | null;
  onChange: (categoryId: string) => void;
}

/**
 * 分类选择 chips 网格
 * 纯展示 + 单选回调，选中态用 primary 描边（不依赖颜色单独传达）
 */
function CategoryPicker({ categories, value, onChange }: CategoryPickerProps) {
  return (
    <div className="ld-picker" role="radiogroup" aria-label="选择分类">
      {categories.map((category) => {
        const active = category.id === value;
        return (
          <button
            key={category.id}
            type="button"
            role="radio"
            aria-checked={active}
            className={`ld-picker__chip${active ? " ld-picker__chip--active" : ""}`}
            onClick={() => onChange(category.id)}
          >
            <span
              className="ld-picker__icon"
              style={{ background: weakColorVar(category.color), color: colorVar(category.color) }}
            >
              {renderCategoryIcon(category.icon)}
            </span>
            <span className="ld-picker__name">{category.name}</span>
          </button>
        );
      })}
    </div>
  );
}

export default memo(CategoryPicker);
