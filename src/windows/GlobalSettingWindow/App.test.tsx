import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ElectronAPI } from "@/shared/types/electron";
import GlobalSettingWindowApp from "./App";

/**
 * GlobalSettingWindow 根组件冒烟（1.45.1）
 *
 * 钉住三件事：
 *
 * 1. **装载成功后必须真的挂出设定中心**，且**不许再套一层浮层**。
 *    1.45.1 起设定中心以 `variant="panel"` 铺在窗口内容区（此前整窗是一张
 *    antd Modal，标题栏与浮层标题重复、多出第二枚关闭叉、还多一层遮罩）。
 *    所以这里既断言 panel 根在，也**反面断言 `document.body` 下没有 `.ant-modal`**
 *    —— 后者才是这次要治的形态，只断言「挂出来了」会漏掉它。
 * 2. **`novel.globalSettingLoad` 缺席时不得抛异常**。旧实现是 `void api.globalSettingLoad()`
 *    直接调用 → 同步 TypeError，而它由 `useEffect` 调用 → React 卸载整棵树 = 白屏。
 *    现在必须落到可见错误态（「全局设定库装载失败」+「重试」），且**不能**顺手把
 *    空壳设定中心也挂出来（空库与装载失败是两件事）。
 * 3. 「跨书共享」这条语义仍在（原浮层标题里的 pill → 窗口标题栏徽标）。
 *
 * ⚠️ antd 给两字中文按钮插字间距（「重试」的 textContent 可能是「重 试」），
 * 按可见文案定位按钮时要先去空白（与 SettingCenter/index.test.tsx 同款处理）。
 */

type Handler = (...args: unknown[]) => void;

/** 按可见文案找按钮（去空白匹配） */
function findButton(text: string): HTMLElement {
  const target = screen
    .getAllByRole("button")
    .find((button) => (button.textContent ?? "").replace(/\s/g, "") === text);
  if (!target) throw new Error(`找不到按钮：${text}`);
  return target;
}

/** 装一份（不完整的）window.electronAPI 桩 */
function mountApi(novel: Partial<ElectronAPI["novel"]> | undefined): void {
  Object.defineProperty(window, "electronAPI", {
    writable: true,
    configurable: true,
    value: {
      novel,
      windowAPI: {
        on: vi.fn<(event: string, handler: Handler) => void>(),
        off: vi.fn<(event: string, handler: Handler) => void>(),
        broadcast: vi.fn(async () => {}),
        sendTo: vi.fn(async () => {}),
        setCloseGuard: vi.fn(),
        respondClose: vi.fn(),
      },
      // WindowHeader 挂载时会订阅最大化状态并主动查询一次
      receive: () => () => {},
      send: vi.fn(),
    } as unknown as ElectronAPI,
  });
}

/** 设定中心的 panel 根节点（1.45.1 起不再经 portal，直接铺在窗口内容区） */
function settingCenterPanel(): HTMLElement | null {
  return document.querySelector(".nv-sc--panel");
}

/** 整棵树里是否出现了浮层（`.ant-modal` 是 Modal 的根，portal 也挂 body 下） */
function hasModalShell(): boolean {
  return document.querySelector(".ant-modal") !== null;
}

afterEach(() => {
  cleanup();
  window.electronAPI = undefined;
});

describe("GlobalSettingWindow · 根组件冒烟", () => {
  it("装载成功后挂出设定中心：panel 形态铺在窗口内，且不再套一层浮层", async () => {
    mountApi({ globalSettingLoad: vi.fn(async () => ({ categories: [] })) });

    render(<GlobalSettingWindowApp />);

    // 标题栏先出现（窗口壳），此时装载还在路上
    expect(screen.getByText("全局设定中心")).toBeInTheDocument();
    expect(hasModalShell()).toBe(false);

    await waitFor(() => {
      expect(settingCenterPanel()).not.toBeNull();
    });
    // ⚠️ 这次修复的核心：窗口里不该再出现第二层浮层（窗口套弹窗）
    expect(hasModalShell()).toBe(false);
    // panel 根同时带基础类，设定中心的全部 BEM 样式都挂在 `.nv-sc` 上
    expect(settingCenterPanel()?.className).toContain("nv-sc");
  });

  it("「跨书共享」语义仍在（原浮层标题的 pill → 窗口标题栏徽标）", async () => {
    mountApi({ globalSettingLoad: vi.fn(async () => ({ categories: [] })) });

    render(<GlobalSettingWindowApp />);

    expect(screen.getByText("跨书共享")).toBeInTheDocument();
  });

  it("preload 缺 globalSettingLoad：不抛异常，渲染可见错误态 + 重试", async () => {
    // 渲染层与 preload 版本错位的形态：novel 在，但少了这条通道
    mountApi({ globalSettingLoad: undefined });

    expect(() => render(<GlobalSettingWindowApp />)).not.toThrow();

    await waitFor(() => {
      expect(screen.getByText("全局设定库装载失败")).toBeInTheDocument();
    });
    expect(findButton("重试")).toBeInTheDocument();
    // 装载失败不能被伪装成「库是空的」
    expect(settingCenterPanel()).toBeNull();
  });

  it("electronAPI 整体缺失：同样进入错误态，不白屏", async () => {
    window.electronAPI = undefined;

    expect(() => render(<GlobalSettingWindowApp />)).not.toThrow();

    await waitFor(() => {
      expect(screen.getByText("全局设定库装载失败")).toBeInTheDocument();
    });
    expect(findButton("重试")).toBeInTheDocument();
  });

  it("IPC 拒绝：错误文案可见，且不抛异常", async () => {
    mountApi({
      globalSettingLoad: vi.fn(async () => {
        throw new Error("novel 数据尚未初始化");
      }),
    });

    expect(() => render(<GlobalSettingWindowApp />)).not.toThrow();

    await waitFor(() => {
      expect(screen.getByText("全局设定库装载失败")).toBeInTheDocument();
    });
    expect(screen.getByText("novel 数据尚未初始化")).toBeInTheDocument();
  });

  it("「重试」重新走一次装载，成功后进入设定中心", async () => {
    const load = vi
      .fn<() => Promise<{ categories: [] }>>()
      .mockRejectedValueOnce(new Error("库未初始化"))
      .mockResolvedValueOnce({ categories: [] });
    mountApi({ globalSettingLoad: load });

    render(<GlobalSettingWindowApp />);
    await waitFor(() => {
      expect(screen.getByText("全局设定库装载失败")).toBeInTheDocument();
    });

    fireEvent.click(findButton("重试"));

    await waitFor(() => {
      expect(settingCenterPanel()).not.toBeNull();
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("全局设定库装载失败")).toBeNull();
  });
});
