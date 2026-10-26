import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import SettingsActionBar from "./index";

/**
 * 底部操作条：设置窗口「保存手感」的唯一出口。
 *
 * 只测一件事：三种状态各自给出什么（点 / 文案 / 有没有左侧内容）。
 * 位置与滚动行为在 jsdom 里量不出来，由 settings-layout-guard.test.ts 钉源码。
 */
describe("SettingsActionBar", () => {
  it("dirty：warning 状态点 + 「有未保存的更改」", () => {
    const { container } = render(
      <SettingsActionBar state="dirty">
        <button type="button">保存</button>
      </SettingsActionBar>,
    );

    const state = container.querySelector(".settings-actionbar__state");
    expect(state?.className).toContain("is-dirty");
    expect(state?.textContent).toBe("有未保存的更改");
    // 状态不是纯装饰：读屏会念出变化
    expect(state?.getAttribute("role")).toBe("status");
    expect(container.querySelector(".settings-actionbar__dot")).toBeTruthy();
    expect(screen.getByText("保存")).toBeTruthy();
  });

  it("saved：「已保存」且状态点换成成功色", () => {
    const { container } = render(<SettingsActionBar state="saved" />);

    const state = container.querySelector(".settings-actionbar__state");
    expect(state?.className).toContain("is-saved");
    expect(state?.textContent).toBe("已保存");
  });

  it("hint：只给一句说明，不出状态点（「立即生效」不该被读成「已保存」）", () => {
    const { container } = render(
      <SettingsActionBar state="hint" hint="修改后立即生效，无需保存">
        <button type="button">恢复默认</button>
      </SettingsActionBar>,
    );

    expect(container.querySelector(".settings-actionbar__state")).toBeNull();
    expect(container.querySelector(".settings-actionbar__dot")).toBeNull();
    expect(screen.getByText("修改后立即生效，无需保存")).toBeTruthy();
    expect(screen.getByText("恢复默认")).toBeTruthy();
  });

  it("不传 state：左侧留空，动作仍在（配置读不到时不能谎报状态）", () => {
    const { container } = render(
      <SettingsActionBar>
        <button type="button">保存</button>
      </SettingsActionBar>,
    );

    expect(container.querySelector(".settings-actionbar__state")).toBeNull();
    expect(container.querySelector(".settings-actionbar__hint")).toBeNull();
    expect(container.querySelector(".settings-actionbar__actions")).toBeTruthy();
  });
});
