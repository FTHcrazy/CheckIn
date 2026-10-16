import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import NovelTopBar from ".";
import type { NovelWork } from "../../types";

/**
 * 顶栏动作图标的层次与开关语义（UI-07 收尾 + REQ-050 修法 ③）。
 *
 * 这里钉的是**结构契约**（几颗图标、哪些带 is-on、aria-pressed 是否跟着状态走、
 * 「小说设定」是不是 toggle），视觉三档本身由 `novel-ui-kit.test.ts` 从编译产物
 * 断言 —— jsdom 没有样式引擎，在这边断言背景色只会得到空字符串。
 *
 * REQ-050：顶栏「本书设定」（小说设定）与「排版与偏好」原本「只开不关」，
 * 缺 toggle 语义 —— 让「再点一次」看起来像「第一次无效」。修法是
 * `onOpenSettings` → `onToggleSettingCenter`（再接 `useNovelViewState.
 * toggleSettingCenter`），并加 `aria-pressed` 反映开合态。
 * （连点两次「状态回落」由 `useNovelViewState.test.ts` 钉 hook 侧。）
 */

const works: NovelWork[] = [
  { id: "w1", name: "测试作品", createdAt: 1 },
  { id: "w2", name: "第二本", createdAt: 2 },
];

/** 六颗动作图标的可访问名，顺序即渲染顺序 */
const ICON_LABELS = ["章节栏", "支撑面板", "行囊", "历史快照", "小说设定", "排版与偏好"] as const;

/** 只构建 props（不渲染）—— 需要自己控制 render/rerender 的用例用这个 */
function buildProps(over: Partial<Parameters<typeof NovelTopBar>[0]> = {}) {
  return {
    works,
    activeWorkId: "w1",
    workMeta: new Map(),
    volumeName: "第一卷",
    chapterName: "第一章",
    leftOpen: false,
    rightOpen: false,
    settingsOpen: false,
    snapshotOpen: false,
    settingCenterOpen: false,
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
    onToggleSettingCenter: vi.fn(),
    onToggleHistory: vi.fn(),
    onOpenPack: vi.fn(),
    ...over,
  };
}

function setup(over: Partial<Parameters<typeof NovelTopBar>[0]> = {}) {
  const props = buildProps(over);
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
    setup({ leftOpen: true, snapshotOpen: true, settingsOpen: false, settingCenterOpen: true });

    // 带持久态的开关：开 → is-on + aria-pressed=true
    expect(iconButton("章节栏").className).toContain("is-on");
    expect(iconButton("章节栏").getAttribute("aria-pressed")).toBe("true");
    expect(iconButton("历史快照").className).toContain("is-on");
    expect(iconButton("历史快照").getAttribute("aria-pressed")).toBe("true");
    // 「小说设定」也是 toggle（REQ-050），开合同理
    expect(iconButton("小说设定").className).toContain("is-on");
    expect(iconButton("小说设定").getAttribute("aria-pressed")).toBe("true");

    // 未开的仍是默认档，aria-pressed 明确为 false（不是缺失）
    expect(iconButton("支撑面板").className).not.toContain("is-on");
    expect(iconButton("支撑面板").getAttribute("aria-pressed")).toBe("false");
    expect(iconButton("排版与偏好").className).not.toContain("is-on");
    expect(iconButton("排版与偏好").getAttribute("aria-pressed")).toBe("false");

    // 非开关（唤起独立窗口）不该谎报按下态
    expect(iconButton("行囊").hasAttribute("aria-pressed")).toBe(false);
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

describe("NovelTopBar：「本书设定」toggle 语义（REQ-050 修法 ③）", () => {
  it("「小说设定」每次点击都调 onToggleSettingCenter（不是「打开」而是「切换」）", () => {
    const onToggleSettingCenter = vi.fn();
    setup({ onToggleSettingCenter });

    const btn = screen.getByRole("button", { name: "小说设定" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(onToggleSettingCenter).toHaveBeenCalledTimes(2);
  });

  it("aria-pressed 跟随 settingCenterOpen（开 → 关 高亮态回落）", () => {
    const { rerender } = render(
      <NovelTopBar {...buildProps({ settingCenterOpen: false })} />,
    );
    const btn = () => screen.getByRole("button", { name: "小说设定" });

    expect(btn()).toHaveAttribute("aria-pressed", "false");
    rerender(<NovelTopBar {...buildProps({ settingCenterOpen: true })} />);
    expect(btn()).toHaveAttribute("aria-pressed", "true");
    rerender(<NovelTopBar {...buildProps({ settingCenterOpen: false })} />);
    expect(btn()).toHaveAttribute("aria-pressed", "false");
  });

  it("引导锚点 data-tour-target=\"topbar-setting\" 仍在（引导第 5 步依赖）", () => {
    setup();
    expect(
      screen.getByRole("button", { name: "小说设定" }),
    ).toHaveAttribute("data-tour-target", "topbar-setting");
  });

  it("「排版与偏好」带 data-drawer-keep-open=settings（点外部关闭的例外标记）", () => {
    setup();
    const btn = screen.getByRole("button", { name: "排版与偏好" });
    expect(btn).toHaveAttribute("data-drawer-keep-open", "settings");
    expect(btn).toHaveAttribute("aria-pressed", "false");
  });
});
