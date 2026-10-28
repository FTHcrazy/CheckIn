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
    // 结果里带所属分区。
    //
    // 这里**不能**用 `getByText`（唯一性）：2.12.0 给「AI 总开关」补了一句
    // 「正文右下角的续写按钮…」，于是「续写」在同一个分区里多命中了一条，
    // 分区标签会随每条命中各出现一次 —— 那是搜索本来就该有的行为，不是缺陷。
    // 断言改钉「至少出现一次分区标签」，意图（结果能看出属于哪个分区）不变。
    expect(screen.getAllByText("AI 创作助手").length).toBeGreaterThan(0);
  });
});
