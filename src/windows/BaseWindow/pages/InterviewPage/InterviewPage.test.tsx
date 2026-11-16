import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import InterviewPage from "./InterviewPage";
import { FAVORITES_STORAGE_KEY } from "./data/favorites-storage";
import { PAGE_SIZE } from "./data/interview-filter-utils";

/**
 * 页面级冒烟测试。
 *
 * 纯函数已经有各自的单测，这里只回答一个问题：**整页能不能渲染并响应交互**。
 * 组件装配错误（props 名字对不上、antd 用法笔误、状态没接上）不会被 `tsc` 抓到，
 * 但会让用户看到白屏 —— 这层用例就是防它。
 *
 * 查询一律走类名而不是 `getByRole(name)`：页面里每张卡片都带十几个「名词」按钮，
 * role + 可访问名查询要为每个按钮算一次 accessible name（jsdom 下单个查询可达数秒），
 * 而这里要断言的是「结构里有几个入口、点了会怎样」，类名恰好更直接。
 * 可访问性由 `components/TermText` 自己的用例覆盖。
 */
function readToggles(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".interview-card__toggle"));
}

function clickCategory(label: string): void {
  const item = Array.from(
    document.querySelectorAll<HTMLElement>(".interview-cats__item"),
  ).find((node) => node.textContent?.startsWith(label));
  if (!item) throw new Error(`找不到分类：${label}`);
  fireEvent.click(item);
}

describe("InterviewPage 冒烟", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  // vitest 未开 globals，Testing Library 的自动清理不会注册，必须显式 cleanup
  afterEach(() => {
    cleanup();
  });

  it("默认渲染第一页题目，答案展开与收起状态互斥", () => {
    const { container } = render(<InterviewPage />);

    expect(container.querySelectorAll(".interview-card")).toHaveLength(PAGE_SIZE);
    expect(container.querySelector(".interview-list__hint")?.textContent).toContain(
      "每页 12 题",
    );

    // 读代码类题目的按钮文案是「先作答，再看答案」，两类都算展开入口
    const toggles = readToggles(container);
    expect(toggles).toHaveLength(PAGE_SIZE);

    fireEvent.click(toggles[0]);
    expect(container.querySelectorAll(".interview-card__answer.is-open")).toHaveLength(1);

    // 展开第二张：第一张自动收起
    fireEvent.click(toggles[1]);
    expect(container.querySelectorAll(".interview-card__answer.is-open")).toHaveLength(1);

    const collapse = readToggles(container).find((node) =>
      node.textContent?.includes("收起答案"),
    );
    expect(collapse).toBeTruthy();
    fireEvent.click(collapse as HTMLElement);
    expect(container.querySelectorAll(".interview-card__answer.is-open")).toHaveLength(0);
  });

  it("分类筛选、关键词搜索与收藏都能生效", () => {
    const { container } = render(<InterviewPage />);

    // ① 点侧栏的 JavaScript 分类，列表只剩该知识域
    clickCategory("JavaScript");
    const scopedCards = Array.from(container.querySelectorAll(".interview-card"));
    expect(scopedCards.length).toBeGreaterThan(0);
    for (const card of scopedCards) {
      expect(card.querySelector(".interview-card__path")?.textContent).toContain(
        "JavaScript",
      );
    }

    // ② 回车搜索「闭包」，结果收窄并出现 <mark> 高亮
    const input = screen.getByPlaceholderText(/搜索题目/);
    fireEvent.change(input, { target: { value: "闭包" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 13 });

    const searchedCards = container.querySelectorAll(".interview-card");
    expect(searchedCards.length).toBeGreaterThan(0);
    expect(searchedCards.length).toBeLessThan(PAGE_SIZE);
    expect(container.querySelector("mark")).not.toBeNull();

    // ③ 收藏第一条，写入 localStorage
    const star = container.querySelector<HTMLElement>(".interview-card__star");
    expect(star).toBeTruthy();
    fireEvent.click(star as HTMLElement);
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const saved: unknown = JSON.parse(raw ?? "[]");
    expect(Array.isArray(saved)).toBe(true);
    expect(saved as string[]).toHaveLength(1);
  });

  it("切换题库轨道后分类归零，空态可一键重置", () => {
    const { container } = render(<InterviewPage />);

    // 先选中一个具体分类，制造「分类不是 all」的状态
    clickCategory("JavaScript");
    expect(container.querySelector(".interview-cats__item.is-active")?.textContent).toContain(
      "JavaScript",
    );

    // 切到笔试题轨道：分类必须回到「全部分类」，否则旧分类在新轨道里恒无结果
    fireEvent.click(screen.getByRole("radio", { name: "笔试题" }));
    expect(container.querySelector(".interview-cats__item.is-active")?.textContent).toContain(
      "全部分类",
    );

    const cards = Array.from(container.querySelectorAll(".interview-card"));
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(card.querySelector(".interview-card__path")?.textContent).toContain("笔试题");
    }

    // 搜不存在的关键词 → 空态给出重置入口
    const input = screen.getByPlaceholderText(/搜索题目/);
    fireEvent.change(input, { target: { value: "zzz-一定不存在-zzz" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", keyCode: 13 });
    expect(container.querySelectorAll(".interview-card")).toHaveLength(0);

    const reset = container.querySelector<HTMLElement>(".interview-list__reset");
    expect(reset).toBeTruthy();
    fireEvent.click(reset as HTMLElement);
    expect(container.querySelectorAll(".interview-card")).toHaveLength(PAGE_SIZE);
  });

  it("收藏写入本机后重新挂载仍在，且只看收藏能筛出该题", () => {
    const first = render(<InterviewPage />);
    const firstTitle =
      first.container.querySelector(".interview-card__title")?.textContent ?? "";
    expect(firstTitle.length).toBeGreaterThan(0);

    fireEvent.click(
      first.container.querySelector<HTMLElement>(".interview-card__star") as HTMLElement,
    );
    first.unmount();

    // 重新挂载 = 模拟刷新页面：收藏从 localStorage 读回
    const { container } = render(<InterviewPage />);
    expect(container.textContent).toContain("已收藏 1 题");

    fireEvent.click(screen.getByRole("checkbox", { name: /只看收藏/ }));
    const cards = Array.from(container.querySelectorAll(".interview-card"));
    expect(cards).toHaveLength(1);
    expect(cards[0].querySelector(".interview-card__title")?.textContent).toBe(firstTitle);

    const star = container.querySelector(".interview-card__star");
    expect(star?.getAttribute("aria-pressed")).toBe("true");
  });
});
