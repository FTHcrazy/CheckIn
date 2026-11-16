import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import KnowledgeDrawer from "./index";
import { knowledgeOfCategory } from "../../data/interview-knowledge";

/** 抽屉渲染在 body 上的 portal 里，容器查询要走 document.body */
function groupTitles(): string[] {
  return Array.from(
    document.body.querySelectorAll(".interview-kc__group-title"),
  ).map((node) => node.textContent ?? "");
}

/**
 * 知识体系抽屉的装配测试。
 *
 * 数据完整性由 `data/interview-knowledge.test.ts` 保证，这里只验证
 * 「给定分类/轨道时，抽屉真的把对应主题渲染出来了」—— props 传错、
 * 分组逻辑写反这类问题 tsc 抓不到。
 */
describe("KnowledgeDrawer", () => {
  afterEach(() => {
    cleanup();
  });

  it("按当前分类渲染主题标题与上下游", () => {
    const topics = knowledgeOfCategory("foundation-react");
    expect(topics.length).toBeGreaterThan(0);

    render(
      <KnowledgeDrawer
        open
        track="foundation"
        categoryId="foundation-react"
        onClose={() => {}}
      />,
    );

    expect(screen.getByText(topics[0].title)).not.toBeNull();
    expect(screen.getAllByText(/^(上游|后续)：/).length).toBeGreaterThan(0);
    expect(groupTitles()).toEqual(["React"]);
  });

  it("范围选到全部分类时，多个知识域一起出现", () => {
    render(
      <KnowledgeDrawer open track="foundation" categoryId="all" onClose={() => {}} />,
    );

    const titles = groupTitles();
    expect(titles.length).toBeGreaterThan(1);
    expect(titles).toContain("React");
  });

  it("笔试题轨道只渲染笔试题的知识域", () => {
    render(
      <KnowledgeDrawer open track="written" categoryId="all" onClose={() => {}} />,
    );

    const titles = groupTitles();
    expect(titles.length).toBeGreaterThan(0);
    expect(titles).not.toContain("React");
  });

  /**
   * 缺陷回归：抽屉默认 `inset: 0`，把 34px 窗口标题栏一起盖住 ——
   * 面板顶部的 × 落进拖动带（系统命中测试判成 HTCAPTION，与 z-index 无关），
   * 点上去没有任何反应，窗口的最小化/关闭也被埋掉。根节点必须整体下移。
   */
  it("抽屉根节点下移到标题栏以下，× 不落进拖动带", () => {
    render(
      <KnowledgeDrawer open track="foundation" categoryId="all" onClose={() => {}} />,
    );

    const root = document.body.querySelector<HTMLElement>(".ant-drawer");
    expect(root).not.toBeNull();
    expect(root?.style.top).toBe("var(--app-window-header-height, 34px)");
  });
});
