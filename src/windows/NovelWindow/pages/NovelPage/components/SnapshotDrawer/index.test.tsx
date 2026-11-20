/**
 * 历史快照抽屉的关闭路径契约。
 *
 * 此前只有 ✕ 与 Esc 两条出口，点正文空白毫无反应 —— 真机上被读成
 * 「这个抽屉关不掉」。现在补了「点外部关闭」：文档级 `mousedown` 分流，
 * 落点在抽屉外才 `onClose()`，且绝不 preventDefault / stopPropagation
 * （同一次点击要继续派发给被点元素，与 SettingsDrawer 同一套战术）。
 *
 * 触发它的是顶栏「⋯ → 历史快照」：菜单浮层渲染在 body 上，不经过顶栏，
 * 所以「⋯」按钮与菜单项都带 `data-drawer-keep-open="snapshot"` —— 否则
 * mousedown 先把抽屉关掉、同一次 click 又 toggle 回来，表现为点了没反应。
 */
import path from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as sass from "sass";
import { afterEach, describe, expect, it, vi } from "vitest";
import SnapshotDrawer from "./index";

const buildProps = (
  over: Partial<Parameters<typeof SnapshotDrawer>[0]> = {},
) => ({
  open: true,
  snapshots: [],
  activeChapterId: "c1",
  onClose: vi.fn(),
  onRollback: vi.fn(),
  ...over,
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("SnapshotDrawer：关闭路径", () => {
  it("落点在抽屉外部 → onClose，且不拦截这次点击", () => {
    const onClose = vi.fn();
    render(<SnapshotDrawer {...buildProps({ onClose })} />);

    const outside = document.createElement("button");
    document.body.appendChild(outside);
    const clickSpy = vi.fn();
    outside.addEventListener("click", clickSpy);

    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    const preventSpy = vi.spyOn(down, "preventDefault");
    outside.dispatchEvent(down);

    expect(onClose).toHaveBeenCalledTimes(1);
    // 关键：绝不拦截 —— 否则被点元素收不到这次点击（第一击被吞）
    expect(preventSpy).not.toHaveBeenCalled();

    outside.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("落点在抽屉内 → 不关闭", () => {
    const onClose = vi.fn();
    const { container } = render(<SnapshotDrawer {...buildProps({ onClose })} />);

    const drawer = container.querySelector(".nv-snap");
    expect(drawer).not.toBeNull();
    fireEvent.mouseDown(drawer!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("落在触发入口上（data-drawer-keep-open=snapshot） → 不关闭", () => {
    const onClose = vi.fn();
    render(<SnapshotDrawer {...buildProps({ onClose })} />);

    // 顶栏「⋯」与菜单项都带这个标记：它们自带 toggle 语义，不算「外部」
    const trigger = document.createElement("button");
    trigger.setAttribute("data-drawer-keep-open", "snapshot");
    document.body.appendChild(trigger);

    fireEvent.mouseDown(trigger);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("✕ 与 Esc 两条老出口仍通", () => {
    const onClose = vi.fn();
    render(<SnapshotDrawer {...buildProps({ onClose })} />);

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("收起态（open=false）不挂外部监听：点正文不会误调 onClose", () => {
    const onClose = vi.fn();
    render(<SnapshotDrawer {...buildProps({ open: false, onClose })} />);

    const outside = document.createElement("button");
    document.body.appendChild(outside);
    fireEvent.mouseDown(outside);
    expect(onClose).not.toHaveBeenCalled();
  });
});

/**
 * 收起态必须真的下屏。
 *
 * 真机反馈：关掉「排版与偏好」后它还在，而且和历史快照并排。
 * 两个抽屉都是 `position:absolute; right:0; width:300px` 的自绘浮层，收起只靠
 * `translateX(100%)` 推出**定位容器**右缘 —— 容器比窗口窄（右侧还有支撑面板）时，
 * 推出去的那一块仍停在可见区。所以收起态必须同时 `visibility: hidden`
 * （不可见 / 不可点 / 不可聚焦），展开态再显式 visible，不靠位移赌父容器会裁切。
 */
describe("右侧抽屉收起的可见性隔离（.nv-snap / .nv-setting）", () => {
  const compile = (rel: string): string =>
    sass
      .compile(path.join(process.cwd(), rel), { style: "expanded" })
      .css.replace(/\/\*[\s\S]*?\*\//g, "");

  const block = (css: string, selector: string): string => {
    const at = css.indexOf(`${selector} {`);
    expect(at).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf("}", at));
  };

  const cases = [
    ["历史快照", "src/windows/NovelWindow/pages/NovelPage/components/SnapshotDrawer/index.scss", ".nv-snap"],
    ["排版与偏好", "src/windows/NovelWindow/pages/NovelPage/components/SettingsDrawer/index.scss", ".nv-setting"],
  ] as const;

  for (const [name, file, root] of cases) {
    it(`${name}：收起态 visibility:hidden，展开态 visible`, () => {
      const css = compile(file);

      const base = block(css, root);
      expect(base).toContain("transform: translateX(100%)");
      expect(base, "收起态不能只靠位移，必须真的不可见").toContain(
        "visibility: hidden",
      );

      const open = block(css, `${root}.is-open`);
      expect(open).toContain("transform: none");
      expect(open).toContain("visibility: visible");
    });
  }
});
