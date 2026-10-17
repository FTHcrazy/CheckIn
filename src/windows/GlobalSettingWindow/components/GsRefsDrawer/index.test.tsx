import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GlobalCategoryRef } from "../../hooks/useGlobalSettingRefs";
import GsRefsDrawer from "./index";

/**
 * GsRefsDrawer 的防回归守卫（R12）
 *
 * 核心是一条**否决项**：四条路径里没有任何一条可以白屏或静默。
 * 尤其「口径不一致」（计数说被 5 部书引用、名单却读到 0 条）——
 * 那不是「没人引用」，静默会让用户误判成无人引用然后放心去删。
 */

const refs: GlobalCategoryRef[] = [
  { workId: "w1", workName: "问道录" },
  { workId: "w2", workName: "青云志" },
];

/**
 * 按可见文案点按钮（antd 会给两字中文插字间距：「重试」→「重 试」，
 * 直接 getByText 会找不到 —— 与 App.test.tsx / GsBody 同款处理）
 */
function clickButton(text: string): HTMLElement {
  const target = screen
    .getAllByRole("button")
    .find((button) => (button.textContent ?? "").replace(/\s/g, "") === text);
  if (!target) throw new Error(`找不到按钮：${text}`);
  fireEvent.click(target);
  return target;
}

function renderDrawer(
  over: Partial<React.ComponentProps<typeof GsRefsDrawer>> = {},
): void {
  render(
    <GsRefsDrawer
      open
      categoryName="法宝品阶"
      refCount={2}
      refs={refs}
      loading={false}
      error={null}
      onClose={vi.fn()}
      onRetry={vi.fn()}
      {...over}
    />,
  );
}

afterEach(() => {
  cleanup();
  // Drawer 经 portal 挂 body，RTL 收不走
  document.body.innerHTML = "";
});

describe("GsRefsDrawer · 四条呈现路径（无白屏、无静默）", () => {
  it("有数据：计数由 formatReferenceCountLabel 产出，逐行列书名，行右侧无操作", () => {
    renderDrawer();
    expect(screen.getByText("引用方 · 法宝品阶")).toBeInTheDocument();
    expect(screen.getByText("2 部书引用")).toBeInTheDocument();
    expect(screen.getByText("问道录")).toBeInTheDocument();
    expect(screen.getByText("青云志")).toBeInTheDocument();
    // 只读：列表项里不出现按钮
    const items = document.querySelectorAll(".gs-refs__name");
    expect(items).toHaveLength(2);
    expect(document.querySelector(".gs-refs__item button")).toBeNull();
  });

  it("加载中：只给 Spin，不显示「暂无引用」（把还在读误报成没人引用）", () => {
    renderDrawer({ loading: true, refs: [] });
    expect(document.querySelector(".ant-spin")).not.toBeNull();
    expect(screen.queryByText("暂无作品引用")).toBeNull();
    // 标题照常可用
    expect(screen.getByText("引用方 · 法宝品阶")).toBeInTheDocument();
  });

  it("口径不一致（计数 5 > 名单 0）：必须给警示 + 重试，不得静默", () => {
    const onRetry = vi.fn();
    renderDrawer({ refs: [], refCount: 5, onRetry });
    expect(screen.getByText("没能读到引用方名单")).toBeInTheDocument();
    expect(screen.getByText(/计数显示 5 部书引用，但名单是空的/)).toBeInTheDocument();
    // 不得渲染成「没人引用」的空态
    expect(screen.queryByText("暂无作品引用")).toBeNull();
    clickButton("重试");
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("异常：Alert + 原因文案 + 重试；标题与关闭按钮始终可用", () => {
    const onRetry = vi.fn();
    const onClose = vi.fn();
    renderDrawer({ refs: [], refCount: 0, error: "novel 数据尚未初始化", onRetry, onClose });
    expect(screen.getByText("引用方名单读取失败")).toBeInTheDocument();
    expect(screen.getByText("novel 数据尚未初始化")).toBeInTheDocument();
    clickButton("重试");
    expect(onRetry).toHaveBeenCalledTimes(1);
    // 关闭通道不因错误态失效
    fireEvent.click(screen.getByLabelText("Close", { selector: "button" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("refCount 与名单同为 0：兜底空态（入口本就不渲染，属不可达兜底）", () => {
    renderDrawer({ refs: [], refCount: 0 });
    expect(screen.getByText("暂无作品引用")).toBeInTheDocument();
    expect(screen.queryByText("没能读到引用方名单")).toBeNull();
  });

  it("closed 时不渲染内容", () => {
    renderDrawer({ open: false });
    expect(screen.queryByText("引用方 · 法宝品阶")).toBeNull();
  });
});
