import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NOVEL_HELP_DOC } from "@/shared/novel/guide-doc";
import HelpCenter from "./index";

/**
 * 帮助中心的渲染守卫
 *
 * 数据层（词条是否存在、是否可检索）由 `guide-doc.test.ts` 覆盖；这里只钉
 * 壳子的两件事：
 * 1. 「功能索引」tab 真的把 AI 分区渲染出来了（数据加了、UI 没接 = 白加）；
 * 2. 搜索「续写」这种口语词能出结果（作者不会用「continuation」去找）。
 */
afterEach(cleanup);

describe("HelpCenter", () => {
  it("功能索引渲染出 AI 分区及其词条", () => {
    render(<HelpCenter open doc={NOVEL_HELP_DOC} onClose={() => {}} />);
    // 默认落在「快速上手」，先切到功能索引
    fireEvent.click(screen.getByRole("tab", { name: "功能索引" }));
    expect(screen.getByText("AI 创作助手")).toBeTruthy();
    expect(screen.getByText("AI 续写")).toBeTruthy();
    expect(screen.getByText("章节摘要")).toBeTruthy();
  });

  it("搜「续写」能命中 AI 续写词条（口语词也要搜得到）", () => {
    render(<HelpCenter open doc={NOVEL_HELP_DOC} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/搜索功能/), {
      target: { value: "续写" },
    });
    expect(screen.getByText("AI 续写")).toBeTruthy();
    expect(screen.getByText("AI 创作助手")).toBeTruthy(); // 结果里带所属分区
  });
});
