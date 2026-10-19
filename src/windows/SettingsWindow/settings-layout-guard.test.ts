import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 设置页布局守卫（1.47.0）
 *
 * 由一次真实事故换来：加完「快捷键」「诊断」两个分区后，页面总高度超过了窗口，
 * 于是每个分区都被压扁一截 —— 「外观」只剩一条空白带、「邮箱」「退出登录」被
 * 拦腰裁断。
 *
 * 成因是 flex 的两个默认值叠加，**没有任何错误提示**：
 * 1. `.settings-page` 是定高的 `flex-direction: column` 容器，子项默认
 *    `flex-shrink: 1` → 内容超高时先按比例压缩子项，而不是让容器滚动；
 * 2. `.settings-section` 又有 `overflow: hidden`，它把 flex 项的自动最小尺寸
 *    （`min-height: auto`）变成了 0 → 压缩没有下限，直接压到只剩一截。
 *
 * 所以分区必须显式 `flex: none`，把「超出」交给 `.settings-page` 的
 * `overflow-y: auto` 承担。这类问题在 jsdom 里量不出来（不做布局计算），
 * 只能靠源码断言钉住。
 */

const SCSS_PATH = path.resolve(process.cwd(), "src/windows/SettingsWindow/index.scss");
const SCSS = readFileSync(SCSS_PATH, "utf8").replace(/\r\n/g, "\n");

/** 取出某个选择器的声明块（只认「类名后紧跟 `{`」，不会误吞 `__title` 之类） */
function blockOf(selector: string): string {
  const match = new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`).exec(SCSS);
  expect(match, `index.scss 里找不到 ${selector} 这个规则块`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("设置页布局：定高 flex column 里的分区不能被压扁", () => {
  it("前提：.settings-page 是定高的 flex column + 自身滚动", () => {
    const page = blockOf(".settings-page");
    expect(page).toMatch(/height:\s*100%/);
    expect(page).toMatch(/flex-direction:\s*column/);
    expect(page).toMatch(/overflow-y:\s*auto/);
  });

  it("前提：.settings-section 带 overflow: hidden（正是它把最小高度变 0）", () => {
    expect(blockOf(".settings-section")).toMatch(/overflow:\s*hidden/);
  });

  it(".settings-section 显式 flex: none —— 否则超高时被压扁并裁切内容", () => {
    expect(blockOf(".settings-section")).toMatch(/flex:\s*none/);
  });
});
