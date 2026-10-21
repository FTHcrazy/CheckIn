import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ShelfTopBar from "./index";

/**
 * 书架顶栏「全局设定中心」入口（T04 / M12 / REQ-041）
 *
 * 钉的是「入口可发现、一击命中、位置对」三件事：它是跨书共享设定库的唯一入口，
 * 一旦改坏（丢锚点 / 少回调 / 挪到别处）引导第 6 步会高亮错位且入口失联。
 */

const buildProps = (
  over: Partial<Parameters<typeof ShelfTopBar>[0]> = {},
): Parameters<typeof ShelfTopBar>[0] => ({
  workCount: 3,
  totalWordsText: "12.3 万",
  keyword: "",
  onKeywordChange: vi.fn(),
  onCreateClick: vi.fn(),
  onImportClick: vi.fn(),
  importing: false,
  onGlobalSettingClick: vi.fn(),
  ...over,
});

describe("书架顶栏 · 全局设定中心入口（T04）", () => {
  afterEach(() => cleanup());

  it("「全局设定中心」按钮一击触发回调（图标 + 文字标签，可发现）", () => {
    const onGlobalSettingClick = vi.fn();
    render(<ShelfTopBar {...buildProps({ onGlobalSettingClick })} />);
    const button = screen.getByRole("button", { name: "全局设定中心" });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onGlobalSettingClick).toHaveBeenCalledTimes(1);
  });

  it("按钮带引导锚点 shelf-global-setting，且位于「新建作品」左侧、与搜索/导入同一行", () => {
    render(<ShelfTopBar {...buildProps()} />);
    const global = screen.getByRole("button", { name: "全局设定中心" });
    expect(global.getAttribute("data-tour-target")).toBe("shelf-global-setting");

    const newWork = screen.getByText("新建作品").closest("button");
    expect(newWork).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING：newWork 排在 global 之后 ⇒ global 在左侧
    expect(
      global.compareDocumentPosition(newWork!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // 同一行：三者同属 .bs-topbar__actions 容器
    const actions = global.closest(".bs-topbar__actions");
    expect(actions).not.toBeNull();
    expect(actions!.contains(newWork!)).toBe(true);
    expect(actions!.querySelector(".bs-topbar__search")).not.toBeNull();
  });

  it("窗口正在打开时按钮转「正在打开…」且仍可点击（REQ-054 修法对齐行囊）", () => {
    const onGlobalSettingClick = vi.fn();
    render(
      <ShelfTopBar
        {...buildProps({ onGlobalSettingClick, globalSettingOpening: true })}
      />,
    );

    // aria-label 仍为「全局设定中心」；内容换成「正在打开…」并带 busy 标记
    const button = screen.getByRole("button", { name: "全局设定中心" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("正在打开…")).toBeInTheDocument();

    // 刻意不用 antd 的 loading（它会吞 onClick）：窗口落到后面时再点一次仍是退路
    fireEvent.click(button);
    expect(onGlobalSettingClick).toHaveBeenCalledTimes(1);
  });
});
