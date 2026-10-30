import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App as AntdApp } from "antd";
import {
  DEFAULT_BINDINGS,
  resetShortcutStoreForTest,
  setShortcutConfig,
} from "@/shared/shortcuts";
import ShortcutSection from "./index";

/**
 * 快捷键分区（1.47.0）
 *
 * 覆盖用户视角的三件事：
 * 1. 分组与条目齐全，Esc 这类协议键明确不可改；
 * 2. 「应用外生效」只出现在允许全局的动作上（只有唤出窗口类）；
 * 3. 录制 → 提交 → 落 IPC；与已有键位冲突时不保存。
 */
const setMock = vi.fn();

function installBridge(): void {
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    shortcut: {
      get: vi.fn().mockResolvedValue({
        bindings: { ...DEFAULT_BINDINGS },
        globals: [],
      }),
      set: setMock,
    },
  };
}

function renderSection() {
  return render(
    <AntdApp>
      <ShortcutSection />
    </AntdApp>,
  );
}

/** 找到某一行的键位按钮（按行内文案定位，避免依赖渲染顺序） */
function keyButtonOf(container: HTMLElement, label: string): HTMLElement {
  const rows = [...container.querySelectorAll(".settings-shortcut__row")];
  const row = rows.find((item) => item.textContent?.includes(label));
  if (!row) throw new Error(`没有找到「${label}」这一行`);
  const button = row.querySelector(".settings-shortcut__key");
  if (!button) throw new Error(`「${label}」这行没有键位按钮`);
  return button as HTMLElement;
}

describe("ShortcutSection", () => {
  beforeEach(() => {
    resetShortcutStoreForTest();
    setShortcutConfig({ bindings: { ...DEFAULT_BINDINGS }, globals: [] });
    setMock.mockReset();
    setMock.mockResolvedValue({
      config: { bindings: { ...DEFAULT_BINDINGS }, globals: [] },
      globalFailures: [],
    });
    installBridge();
  });

  it("四个分组都在，且列出全部快捷键", () => {
    const { container } = renderSection();
    for (const title of ["写作", "导航与视图", "面板", "窗口"]) {
      expect(screen.getByText(title)).toBeTruthy();
    }
    expect(container.querySelectorAll(".settings-shortcut__row")).toHaveLength(9);
  });

  it("Esc 不可修改（协议键），按钮为禁用态", () => {
    const { container } = renderSection();
    const button = keyButtonOf(container, "关闭最上层浮层");
    expect(button).toHaveProperty("disabled", true);
  });

  it("「应用外生效」只出现在可全局的动作上", () => {
    const { container } = renderSection();
    const toggles = container.querySelectorAll(".settings-shortcut__global");
    expect(toggles).toHaveLength(1);
    expect(toggles[0].textContent).toContain("应用外生效");
    // 它属于「唤出小说窗口」那一行
    const row = toggles[0].closest(".settings-shortcut__row");
    expect(row?.textContent).toContain("唤出小说窗口");
  });

  it("录制新键位：按下 Ctrl+K 后提交给主进程", async () => {
    const { container } = renderSection();
    const button = keyButtonOf(container, "保存当前章");

    fireEvent.click(button);
    expect(button.textContent).toContain("按下组合键…");

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    await waitFor(() => {
      expect(setMock).toHaveBeenCalledTimes(1);
    });
    const payload = setMock.mock.calls[0][0] as { bindings: Record<string, string> };
    expect(payload.bindings.save).toBe("Mod+K");
  });

  it("与已有键位冲突时不保存，并给出提示", async () => {
    const { container } = renderSection();
    const button = keyButtonOf(container, "保存当前章");

    fireEvent.click(button);
    // Ctrl+P 已被「章节快速跳转」占用
    fireEvent.keyDown(window, { key: "p", ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByText(/已被「章节快速跳转」占用/)).toBeTruthy();
    });
    expect(setMock).not.toHaveBeenCalled();
  });

  it("录制中按 Esc 取消，不保存", () => {
    const { container } = renderSection();
    const button = keyButtonOf(container, "保存当前章");

    fireEvent.click(button);
    fireEvent.keyDown(window, { key: "Escape" });

    expect(setMock).not.toHaveBeenCalled();
    expect(button.textContent).not.toContain("按下组合键…");
  });

  it("Backspace 回退默认键位", async () => {
    setShortcutConfig({ bindings: { ...DEFAULT_BINDINGS, save: "Mod+K" }, globals: [] });
    const { container } = renderSection();
    const button = keyButtonOf(container, "保存当前章");
    expect(button.textContent).toContain("Ctrl+K");

    fireEvent.click(button);
    fireEvent.keyDown(window, { key: "Backspace" });

    await waitFor(() => {
      expect(setMock).toHaveBeenCalledTimes(1);
    });
    const payload = setMock.mock.calls[0][0] as { bindings: Record<string, string> };
    expect(payload.bindings.save).toBe(DEFAULT_BINDINGS.save);
  });

  it("切换应用外开关会写入 globals", async () => {
    const { container } = renderSection();
    const toggle = within(container).getByRole("switch");
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(setMock).toHaveBeenCalledTimes(1);
    });
    const payload = setMock.mock.calls[0][0] as { globals: string[] };
    expect(payload.globals).toContain("showNovelWindow");
  });
});
