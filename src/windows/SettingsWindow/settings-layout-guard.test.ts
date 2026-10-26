import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 设置页布局守卫（1.47.0 立，1.48.0 改版后按新骨架重写）
 *
 * 由一次真实事故换来：加完「快捷键」「诊断」两个分区后，页面总高度超过了窗口，
 * 于是每个分区都被压扁一截 —— 「外观」只剩一条空白带、「邮箱」「退出登录」被
 * 拦腰裁断。
 *
 * 成因是 flex 的两个默认值叠加，**没有任何错误提示**：
 * 1. 页面是定高的 `flex-direction: column` 容器，子项默认 `flex-shrink: 1`
 *    → 内容超高时先按比例压缩子项，而不是让容器滚动；
 * 2. 分区又有 `overflow: hidden`，它把 flex 项的自动最小尺寸
 *    （`min-height: auto`）变成了 0 → 压缩没有下限，直接压到只剩一截。
 *
 * 1.48.0 把「一列分区从头滚到尾」改成「左导航 + 右内容页」后，**这条结论一个字
 * 都没变**，只是容器从 `.settings-page` 换成了「`.settings-content` 里的定高
 * 滚动区」。所以守卫按新骨架重写，钉的仍是同一件事：
 * - 滚动区必须是「定高 + 自身滚动」（`flex: 1` / `min-height: 0` / `overflow-y: auto`），
 *   不能只靠 `height: 100%` —— 它上面还有固定高度的页头，100% 会顶出窗口底部；
 * - 分区必须 `flex: none`，把「超出」交给滚动区承担；
 * - 左导航定宽不收缩，内容区两个 `min-*` 归零（否则长文案会把右栏撑开）。
 *
 * 这类问题在 jsdom 里量不出来（不做布局计算），只能靠源码断言钉住。
 */

const SCSS_PATH = path.resolve(process.cwd(), "src/windows/SettingsWindow/index.scss");
const SCSS = readFileSync(SCSS_PATH, "utf8").replace(/\r\n/g, "\n");

/** 左栏是窗口私有组件，样式就近在它自己的目录里 */
const NAV_SCSS_PATH = path.resolve(
  process.cwd(),
  "src/windows/SettingsWindow/components/SettingsNav/index.scss",
);
const NAV_SCSS = readFileSync(NAV_SCSS_PATH, "utf8").replace(/\r\n/g, "\n");

/** 取出某个选择器的声明块（只认「类名后紧跟 `{`」，不会误吞 `__title` 之类） */
function blockOf(source: string, selector: string): string {
  const match = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(source);
  expect(match, `找不到 ${selector} 这个规则块`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("设置页布局：定高 flex column 里的分区不能被压扁", () => {
  it("前提：.settings-page 在定高父容器里拿到确定高度 + 自身滚动", () => {
    const page = blockOf(SCSS, ".settings-page");
    // `flex: 1` + `min-height: 0` 才是「在定高列里拿到确定高度」的正解；
    // 换成 height: 100% 会和上方的固定页头叠加，把内容顶出窗口
    expect(page).toMatch(/flex:\s*1/);
    expect(page).toMatch(/min-height:\s*0/);
    expect(page).toMatch(/flex-direction:\s*column/);
    expect(page).toMatch(/overflow-y:\s*auto/);
  });

  it("前提：.settings-section 带 overflow: hidden（正是它把最小高度变 0）", () => {
    expect(blockOf(SCSS, ".settings-section")).toMatch(/overflow:\s*hidden/);
  });

  it(".settings-section 显式 flex: none —— 否则超高时被压扁并裁切内容", () => {
    expect(blockOf(SCSS, ".settings-section")).toMatch(/flex:\s*none/);
  });

  it("非当前页只隐藏不卸载：is-hidden 必须 display:none，否则会占住滚动区高度", () => {
    expect(SCSS).toMatch(/\.settings-page\.is-hidden\s*\{[^}]*display:\s*none/);
  });
});

describe("双栏骨架：左导航定宽、右内容可收缩", () => {
  it(".settings-nav 定宽且不参与收缩（导航被压扁会让文案变成省略号）", () => {
    const nav = blockOf(NAV_SCSS, ".settings-nav");
    expect(nav).toMatch(/flex:\s*0\s+0\s+\d+px/);
    expect(nav).toMatch(/min-height:\s*0/);
  });

  it(".settings-content 的 min-width / min-height 归零 —— 否则内容把窗口顶出滚动条", () => {
    const content = blockOf(SCSS, ".settings-content");
    expect(content).toMatch(/min-width:\s*0/);
    expect(content).toMatch(/min-height:\s*0/);
  });
});
