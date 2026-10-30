import { Button, Tooltip } from "antd";
import { memo, useMemo } from "react";
import type { LedgerCategoryDTO } from "@/shared/services/ledger";
import { colorVar, renderCategoryIcon } from "../../constants/categories";
import type { CategorySuggestion } from "../../ledger-suggest";
import "./index.scss";

interface CategorySuggestProps {
  /** 建议（已按分数排好，最多 3 条） */
  suggestions: readonly CategorySuggestion[];
  /** 全部分类：用来取建议项的图标 / 名称 / 颜色 */
  categories: readonly LedgerCategoryDTO[];
  /** 当前已选的分类：命中的那条标成「已选」，避免用户以为点了没反应 */
  activeId: string | null;
  onPick: (categoryId: string) => void;
}

/** 依据文案：历史给次数，关键词给命中的词 */
function hintOf(suggestion: CategorySuggestion): string {
  if (suggestion.reason === "history") {
    return `你记过 ${suggestion.count} 次类似备注`;
  }
  return `按「${suggestion.word}」推荐`;
}

/**
 * 分类建议条（R-AI-16a，纯本地规则）
 *
 * 出现在记一笔 / 编辑弹窗的备注下方。只在有把握时出现（纯函数侧已过滤
 * 低分项）；**点一下才生效**，既不改用户已选分类，也不影响保存流程。
 *
 * 为什么不用原生 button：§6.1.2 强制组件库承载；这里每个 chip 是一个
 * 真按钮（键盘可达 / focus 环 / 禁用语义都由 antd 提供），外观走
 * `ant-button-reset` 清零后重绘，色值全部来自 `--app-*`。
 */
function CategorySuggest({ suggestions, categories, activeId, onPick }: CategorySuggestProps) {
  const byId = useMemo(() => {
    const map = new Map<string, LedgerCategoryDTO>();
    for (const category of categories) map.set(category.id, category);
    return map;
  }, [categories]);

  const items = suggestions
    .map((suggestion) => ({ suggestion, category: byId.get(suggestion.categoryId) }))
    .filter((item): item is { suggestion: CategorySuggestion; category: LedgerCategoryDTO } =>
      Boolean(item.category),
    );

  if (items.length === 0) return null;

  return (
    <div className="ld-suggest" role="group" aria-label="分类建议">
      <span className="ld-suggest__label">建议</span>
      {items.map(({ suggestion, category }) => {
        const current = category.id === activeId;
        return (
          <Tooltip key={category.id} title={hintOf(suggestion)}>
            <Button
              type="text"
              size="small"
              className={`ld-suggest__chip${current ? " is-current" : ""}`}
              aria-pressed={current}
              onClick={() => onPick(category.id)}
            >
              <span className="ld-suggest__icon" style={{ color: colorVar(category.color) }}>
                {renderCategoryIcon(category.icon)}
              </span>
              <span className="ld-suggest__name">{category.name}</span>
            </Button>
          </Tooltip>
        );
      })}
    </div>
  );
}

export default memo(CategorySuggest);
