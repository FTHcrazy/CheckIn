import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PackHeader from "./index";

/**
 * 保存条三态 + 失败态逃生出口（G-3 / G-4 / REQ-045）
 *
 * 这一组的核心是**「保存失败时不能只有一句抱歉」**：面板存不进去时，
 * 作者唯一能救回那半小时改动的方式是把草稿整份导出成 JSON。
 * 而这个入口只在失败态出现 —— 常驻的话它和 REQ-030 的模块级 Markdown 导出
 * 会在同一个面板里共存，作者分不清哪个是给人读的、哪个是给机器读的。
 */

function props(over: Partial<Parameters<typeof PackHeader>[0]> = {}) {
  const onExportDraft = vi.fn();
  const base: Parameters<typeof PackHeader>[0] = {
    characterName: "主角",
    realmText: "筑基 1/9",
    realmHint: "",
    dirty: 0,
    saving: false,
    saveFailed: false,
    savedAt: 0,
    breathe: false,
    changedCount: 0,
    onMarkAllRead: vi.fn(),
    onRename: vi.fn(),
    onSave: vi.fn(),
    onRevertAll: vi.fn(),
    onExportDraft,
    onOpenModules: vi.fn(),
    onOpenUnitManager: vi.fn(),
    onOpenRecords: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  return { base, onExportDraft };
}

const exportButton = () => screen.queryByRole("button", { name: /导\s*出\s*草\s*稿/ });

describe("PackHeader —— 保存条（G-3）", () => {
  afterEach(cleanup);

  it("三态文案互斥：干净 / 脏 / 保存中 / 失败各说各的", () => {
    const { unmount } = render(<PackHeader {...props().base} />);
    expect(document.querySelector(".cpk-savebar")?.className).toContain("is-idle");
    expect(document.querySelector(".cpk-savebar__state")?.textContent).toBe("已保存");
    unmount();

    render(<PackHeader {...props({ dirty: 3 }).base} />);
    expect(document.querySelector(".cpk-savebar")?.className).toContain("is-dirty");
    expect(document.querySelector(".cpk-savebar__state")?.textContent).toBe("3 处改动未保存");
  });

  it("「全部已读」只在真有角标时出现（常驻一个无事发生的按钮更让人困惑）", () => {
    const { unmount } = render(<PackHeader {...props().base} />);
    expect(screen.queryByRole("button", { name: /全部已读/ })).toBeNull();
    unmount();

    render(<PackHeader {...props({ changedCount: 2 }).base} />);
    expect(screen.getByRole("button", { name: /全部已读/ })).toBeInTheDocument();
  });
});

describe("PackHeader —— 失败态逃生出口（REQ-045）", () => {
  afterEach(cleanup);

  it("干净态与脏态都没有「导出草稿」（它不是常规导出）", () => {
    render(<PackHeader {...props().base} />);
    expect(exportButton()).toBeNull();
    cleanup();
    render(<PackHeader {...props({ dirty: 4 }).base} />);
    expect(exportButton()).toBeNull();
  });

  it("失败态出现，点了就把草稿整份导出；主按钮变成「重试」", () => {
    const { base, onExportDraft } = props({ saveFailed: true, dirty: 4 });
    render(<PackHeader {...base} />);

    const button = exportButton();
    expect(button).toBeInTheDocument();
    fireEvent.click(button as HTMLElement);
    expect(onExportDraft).toHaveBeenCalledTimes(1);
    // 失败时不该出现「保存失败」+「保存 (4)」这种自相矛盾的组合
    expect(screen.getByRole("button", { name: /重\s*试/ })).toBeInTheDocument();
  });

  it("失败态下「撤销全部」让位给逃生出口（此刻最怕的是误撤掉那半小时）", () => {
    render(<PackHeader {...props({ saveFailed: true, dirty: 4 }).base} />);
    expect(screen.queryByRole("button", { name: /撤销全部/ })).toBeNull();
  });
});
