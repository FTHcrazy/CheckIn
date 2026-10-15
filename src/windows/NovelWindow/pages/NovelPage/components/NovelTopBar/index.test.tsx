import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import NovelTopBar from ".";
import type { NovelWork } from "../../types";

/**
 * 顶栏动作图标的三档层次（UI-07 收尾）。
 *
 * 这里钉的是**结构契约**（几颗图标、哪些带 is-on、aria-pressed 是否跟着状态走），
 * 视觉三档本身由 `novel-ui-kit.test.ts` 从编译产物断言 —— jsdom 没有样式引擎，
 * 在这边断言背景色只会得到空字符串。
 */

const works: NovelWork[] = [
  { id: "w1", name: "测试作品", createdAt: 1 },
  { id: "w2", name: "第二本", createdAt: 2 },
];

/** 六颗动作图标的可访问名，顺序即渲染顺序 */
const ICON_LABELS = ["章节栏", "支撑面板", "行囊", "历史快照", "小说设定", "排版与偏好"] as const;

function setup(over: Partial<Parameters<typeof NovelTopBar>[0]> = {}) {
  const props = {
    works,
    activeWorkId: "w1",
    workMeta: new Map(),
    volumeName: "第一卷",
    chapterName: "第一章",
    leftOpen: false,
    rightOpen: false,
    settingsOpen: false,
    snapshotOpen: false,
    onSelectWork: vi.fn(),
    onCreateWork: vi.fn(() => true),
    onRenameWork: vi.fn(() => true),
    onDeleteWork: vi.fn(),
    onResetTemplate: vi.fn(),
    onExportBook: vi.fn(),
    onExportVolume: vi.fn(),
    onExportChapter: vi.fn(),
    onToggleLeft: vi.fn(),
    onToggleRight: vi.fn(),
    onToggleSettings: vi.fn(),
    onToggleHistory: vi.fn(),
    onOpenPack: vi.fn(),
    onOpenSettings: vi.fn(),
    ...over,
  };
  render(<NovelTopBar {...props} />);
  return props;
}

/** 顶栏图标按钮：class 含 `nv-topbar__icon`（antd 会把 className 挂到根 button 上） */
const iconButton = (label: string) =>
  screen.getByLabelText(label).closest("button") as HTMLButtonElement;

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("NovelTopBar：图标层次契约", () => {
  it("六颗动作图标都挂同一个类，才能共用三档样式", () => {
    setup();
    ICON_LABELS.forEach((label) => {
      const button = iconButton(label);
      expect(button, `${label} 未渲染成按钮`).toBeTruthy();
      expect(button.className).toContain("nv-topbar__icon");
    });
  });

  it("全部收起时六颗图标都不带 is-on（默认档）", () => {
    setup();
    ICON_LABELS.forEach((label) => {
      expect(iconButton(label).className).not.toContain("is-on");
    });
  });

  it("开关打开时对应按钮进激活档，且 aria-pressed 跟着状态走", () => {
    setup({ leftOpen: true, snapshotOpen: true, settingsOpen: false });

    // 带持久态的四个开关：开 → is-on + aria-pressed=true
    expect(iconButton("章节栏").className).toContain("is-on");
    expect(iconButton("章节栏").getAttribute("aria-pressed")).toBe("true");
    expect(iconButton("历史快照").className).toContain("is-on");
    expect(iconButton("历史快照").getAttribute("aria-pressed")).toBe("true");

    // 未开的仍是默认档，aria-pressed 明确为 false（不是缺失）
    expect(iconButton("支撑面板").className).not.toContain("is-on");
    expect(iconButton("支撑面板").getAttribute("aria-pressed")).toBe("false");
    expect(iconButton("排版与偏好").className).not.toContain("is-on");
    expect(iconButton("排版与偏好").getAttribute("aria-pressed")).toBe("false");

    // 非开关（唤起独立窗口 / 页面）不该谎报按下态
    expect(iconButton("行囊").hasAttribute("aria-pressed")).toBe(false);
    expect(iconButton("小说设定").hasAttribute("aria-pressed")).toBe(false);
  });

  it("点击各自只触发自己的回调", () => {
    const props = setup();
    iconButton("章节栏").click();
    iconButton("排版与偏好").click();
    expect(props.onToggleLeft).toHaveBeenCalledTimes(1);
    expect(props.onToggleSettings).toHaveBeenCalledTimes(1);
    expect(props.onToggleRight).not.toHaveBeenCalled();
    expect(props.onToggleHistory).not.toHaveBeenCalled();
  });
});
