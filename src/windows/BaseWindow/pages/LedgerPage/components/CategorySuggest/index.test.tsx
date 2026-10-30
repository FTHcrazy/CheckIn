import { render, within } from "@testing-library/react";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { describe, expect, it, vi } from "vitest";
import type { LedgerCategoryDTO } from "@/shared/services/ledger";
import type { CategorySuggestion } from "../../ledger-suggest";
import CategorySuggest from ".";

const CATEGORIES: LedgerCategoryDTO[] = [
  {
    id: "food",
    name: "餐饮",
    icon: "CoffeeOutlined",
    color: "--app-accent-orange",
    type: "expense",
    builtin: true,
    sort: 1,
    archived: false,
  },
  {
    id: "transport",
    name: "交通",
    icon: "CarOutlined",
    color: "--app-accent-blue",
    type: "expense",
    builtin: true,
    sort: 2,
    archived: false,
  },
];

function renderSuggest(
  suggestions: CategorySuggestion[],
  activeId: string | null = null,
  onPick = vi.fn(),
): { onPick: ReturnType<typeof vi.fn>; container: HTMLElement } {
  const { container } = render(
    <ConfigProvider locale={zhCN}>
      <CategorySuggest
        suggestions={suggestions}
        categories={CATEGORIES}
        activeId={activeId}
        onPick={onPick}
      />
    </ConfigProvider>,
  );
  return { onPick, container };
}

describe("CategorySuggest", () => {
  it("没有建议时什么都不渲染（不给空壳占位条）", () => {
    const { container } = renderSuggest([]);
    expect(container.querySelector(".ld-suggest")).toBeNull();
  });

  it("渲染建议项；点一下把分类交给调用方（不自己改状态）", () => {
    const { container, onPick } = renderSuggest([
      { categoryId: "transport", score: 0.66, reason: "keyword", word: "地铁", count: 0 },
    ]);
    within(container).getByRole("button", { name: /交通/ }).click();
    expect(onPick).toHaveBeenCalledWith("transport");
  });

  it("当前分类已是被建议项时标成按下态（点了不会有变化，但仍可点）", () => {
    const { container } = renderSuggest(
      [
        { categoryId: "transport", score: 0.66, reason: "keyword", word: "地铁", count: 0 },
        { categoryId: "food", score: 0.55, reason: "history", word: "", count: 2 },
      ],
      "food",
    );
    const scope = within(container);
    expect(scope.getByRole("button", { name: /交通/ }).getAttribute("aria-pressed")).toBe("false");
    expect(scope.getByRole("button", { name: /餐饮/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("建议指向已删除 / 不可见的分类时跳过该项，不渲染空 chip", () => {
    const { container } = renderSuggest([
      { categoryId: "gone", score: 0.9, reason: "history", word: "", count: 3 },
    ]);
    expect(container.querySelector(".ld-suggest")).toBeNull();
  });
});
