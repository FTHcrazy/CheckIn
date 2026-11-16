import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ShelfTopBar from "./index";

/**
 * 书架顶栏「全局设定中心」入口（T04 / M12 / REQ-041）
 *
 * 钉的是「入口可发现、一击命中、位置对」三件事：它是跨书共享设定库的唯一入口，
 * 一旦改坏（丢锚点 / 少回调 / 挪到别处）引导第 6 步会高亮错位且入口失联。
 *
 * 2.57.0（O-10 / O-11）之后顶栏只剩三个动作：全局设定中心 / 导入书籍 / 新建作品。
 * 数据安全与回收站搬去了页脚（`BookshelfPage` 的 `bs-page__status`），
 * 所以这里连带钉「它们**不再**出现在顶栏」—— 否则两处入口并存，主次又会糊。
 */

const buildProps = (
  over: Partial<Parameters<typeof ShelfTopBar>[0]> = {},
): Parameters<typeof ShelfTopBar>[0] => ({
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

describe("书架顶栏 · 入口收敛到 3 个（O-10）", () => {
  afterEach(() => cleanup());

  it("顶栏只有三颗动作（全局设定中心 / 导入书籍 / 新建作品）", () => {
    const { container } = render(<ShelfTopBar {...buildProps()} />);
    // 工具条里恰好两颗（搜索框的清除按钮由 antd 渲染在 Input 内部，不在此列）
    const tools = container.querySelector(".bs-topbar__tools");
    expect(tools!.querySelectorAll("button")).toHaveLength(2);

    // 两个工具 + 主按钮，且都以文字示人（纯图标猜不出用途）
    expect(tools!.textContent).toContain("全局设定中心");
    expect(tools!.textContent).toContain("导入书籍");
    expect(screen.getByText("新建作品")).toBeInTheDocument();
  });

  it("数据安全与回收站不再出现在顶栏（已移到页脚）", () => {
    render(<ShelfTopBar {...buildProps()} />);
    expect(screen.queryByRole("button", { name: "数据安全" })).toBeNull();
    expect(screen.queryByRole("button", { name: "回收站" })).toBeNull();
  });

  it("导入升为带文字按钮（纯图标猜不出「把旧稿搬进来」）", () => {
    const onImportClick = vi.fn();
    render(<ShelfTopBar {...buildProps({ onImportClick })} />);
    const button = screen.getByRole("button", { name: "导入书籍" });
    expect(button.textContent).toContain("导入书籍");
    fireEvent.click(button);
    expect(onImportClick).toHaveBeenCalledTimes(1);
  });

  it("导入进行中给出阶段文案，且按钮保持可访问名", () => {
    render(
      <ShelfTopBar
        {...buildProps({ importing: true, importPhase: "正在拆分章节…" })}
      />,
    );
    const button = screen.getByRole("button", { name: "正在拆分章节…" });
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});

describe("书架顶栏 · 规模摘要去重（O-11）", () => {
  afterEach(() => cleanup());

  it("顶栏不再报作品数 / 字数，只说一句状态语", () => {
    const { container } = render(<ShelfTopBar {...buildProps()} />);
    const meta = container.querySelector(".bs-topbar__meta");
    expect(meta).not.toBeNull();
    expect(meta!.textContent).toBe("本地优先 · 全部数据存本机");
    // 数字口径只留给统计卡一处，顶栏复读会引出「64.6 万 / 64.6万」两种写法
    expect(meta!.textContent).not.toMatch(/\d/);
  });
});
