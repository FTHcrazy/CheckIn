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

/** 底部操作条与按钮原语（2.6.0 上收的窗口级公共层） */
const readWindowScss = (relative: string): string =>
  readFileSync(path.resolve(process.cwd(), relative), "utf8").replace(/\r\n/g, "\n");

const ACTIONBAR_SCSS = readWindowScss(
  "src/windows/SettingsWindow/components/SettingsActionBar/index.scss",
);
const CONTROLS_SCSS = readWindowScss("src/windows/SettingsWindow/styles/settings-controls.scss");

/** 各分区自己的样式：用来反向断言「不许再手写一份描边按钮」 */
const SECTION_SCSS: Record<string, string> = {
  "AISection/index.scss": readWindowScss(
    "src/windows/SettingsWindow/components/AISection/index.scss",
  ),
  "DiagnosticSection/index.scss": readWindowScss(
    "src/windows/SettingsWindow/components/DiagnosticSection/index.scss",
  ),
  "ShortcutSection/index.scss": readWindowScss(
    "src/windows/SettingsWindow/components/ShortcutSection/index.scss",
  ),
};

const readSectionTsx = (name: string): string =>
  readWindowScss(`src/windows/SettingsWindow/components/${name}/index.tsx`);

/** 注释里常引用选择器原文/旧文案，反向断言前先去掉 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

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

/**
 * 统一手感（2.6.0）：保存范式只允许一套。
 *
 * 现状是「每页各有一套」——AI 有状态点、个人资料把按钮塞在表单里、
 * 诊断改一项弹一次「已保存」、快捷键把「恢复默认」放在卡片内部。
 * 用户每切一页都要重新找按钮，看到亮着的保存按钮还得猜「是不是坏了」。
 *
 * 这组断言钉住三件事，防止下一次改动又散开：
 * 1. 操作条的位置恒定（栈撑满 + sticky + margin-top:auto）；
 * 2. 按钮造型只有一份实现，各分区不许再手写；
 * 3. 状态文案只有一处定义，各分区不许自己编。
 */
describe("统一手感：保存范式只有一套", () => {
  it(".settings-page__stack 撑满滚动区 —— 操作条贴底的前提", () => {
    const stack = blockOf(SCSS, ".settings-page__stack");
    expect(stack).toMatch(/display:\s*flex/);
    expect(stack).toMatch(/flex-direction:\s*column/);
    // 少了它，内容不足一屏时操作条会紧跟最后一张卡，切页时位置忽高忽低
    expect(stack).toMatch(/min-height:\s*100%/);
  });

  it(".settings-actionbar 的四件事缺一不可：sticky / bottom:0 / margin-top:auto / flex:none", () => {
    const bar = blockOf(ACTIONBAR_SCSS, ".settings-actionbar");
    expect(bar).toMatch(/position:\s*sticky/);
    expect(bar).toMatch(/bottom:\s*0/);
    expect(bar).toMatch(/margin-top:\s*auto/);
    expect(bar).toMatch(/flex:\s*none/);
    // 不透明底：卡片从下方滚过时会穿帮
    expect(bar).toMatch(/background:\s*var\(--app-bg\)/);
  });

  it("描边按钮只有一份实现（第四份拷贝会让某一处的 hover 静默漂移）", () => {
    // 清零点与控件变量必须写在同一个选择器里（AGENTS §6.1.2）
    const btn = blockOf(CONTROLS_SCSS, ".settings-btn.ant-btn");
    expect(btn).toContain("ant-button-reset");
    expect(btn).toMatch(/--ant-control-height:\s*32px/);
    // 危险变体只改变量、不重画结构
    expect(blockOf(CONTROLS_SCSS, ".settings-btn--danger.ant-btn")).toMatch(/--app-error/);
  });

  it("各分区不再自己写按钮造型", () => {
    for (const [name, css] of Object.entries(SECTION_SCSS)) {
      expect(stripComments(css), `${name} 又手写了一份按钮造型`).not.toMatch(
        /--ant-control-height/,
      );
    }
  });

  it("状态文案只有一处定义 —— 三页共用同一句话", () => {
    const actionbar = stripComments(readSectionTsx("SettingsActionBar"));
    expect(actionbar).toContain("有未保存的更改");
    expect(actionbar).toContain("已保存");
    for (const name of ["AISection", "DiagnosticSection", "ProfileSection", "ShortcutSection"]) {
      expect(stripComments(readSectionTsx(name)), `${name} 自己编了一套状态文案`).not.toContain(
        "有未保存的更改",
      );
    }
  });

  it("有保存动作的三页都接入操作条；账号页不放（动作不是配置）", () => {
    for (const name of ["AISection", "DiagnosticSection", "ProfileSection"]) {
      expect(readSectionTsx(name), `${name} 没接入 SettingsActionBar`).toContain(
        "<SettingsActionBar",
      );
    }
    // 快捷键页是 hint 模式：立即生效，没有「保存」
    expect(readSectionTsx("ShortcutSection")).toContain('state="hint"');
    // 账号页：退出登录留在行内，避免常驻条被误点
    expect(readSectionTsx("AccountSection")).not.toContain("<SettingsActionBar");
  });
});
