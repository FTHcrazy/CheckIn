import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import NovelTopBar from "./index";

/**
 * REQ-050（P0）修法 ③ 的正面要求：顶栏「本书设定」（小说设定）与「排版与偏好」
 * 原本「只开不关」，缺 toggle 语义 —— 让「再点一次」看起来像「第一次无效」。
 *
 * 修法：`onOpenSettings` → `onToggleSettingCenter`（再接 `useNovelViewState.
 * toggleSettingCenter`），并加 `aria-pressed` 反映开合态。
 *
 * 本文件钉住顶栏这一侧的契约：按钮真的接了 toggle 回调、开合态经 aria-pressed
 * 暴露、引导锚点与抽屉 keep-open 标记不回退。（连点两次「状态回落」由
 * `useNovelViewState.test.ts` 钉 hook 侧。）
 */
const buildProps = (
  over: Partial<Parameters<typeof NovelTopBar>[0]> = {},
): Parameters<typeof NovelTopBar>[0] => ({
  works: [{ id: "w1", name: "测试书", createdAt: 0 }],
  activeWorkId: "w1",
  workMeta: new Map(),
  volumeName: "第一卷",
  chapterName: "第一章",
  leftOpen: true,
  rightOpen: true,
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
});

describe("NovelTopBar：「本书设定」toggle 语义（REQ-050 修法 ③）", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("「小说设定」每次点击都调 onToggleSettingCenter（不是「打开」而是「切换」）", () => {
    const onToggleSettingCenter = vi.fn();
    render(<NovelTopBar {...buildProps({ onToggleSettingCenter })} />);

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
    render(<NovelTopBar {...buildProps()} />);
    expect(
      screen.getByRole("button", { name: "小说设定" }),
    ).toHaveAttribute("data-tour-target", "topbar-setting");
  });

  it("「排版与偏好」带 data-drawer-keep-open=settings（点外部关闭的例外标记）", () => {
    render(<NovelTopBar {...buildProps()} />);
    const btn = screen.getByRole("button", { name: "排版与偏好" });
    expect(btn).toHaveAttribute("data-drawer-keep-open", "settings");
    expect(btn).toHaveAttribute("aria-pressed", "false");
  });
});
