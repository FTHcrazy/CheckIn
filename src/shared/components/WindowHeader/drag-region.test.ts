import { readFileSync } from "node:fs";
import path from "node:path";
import * as sass from "sass";
import { describe, expect, it } from "vitest";

/**
 * 拖动带 × 浮层的守卫（缺陷回归：「行囊窗口弹窗右上角的 × 点不动」）。
 *
 * 钉的是一条**没有编译期痕迹**的约定：`-webkit-app-region: drag` 在 Windows 上
 * 由系统在命中测试阶段处理（`WM_NCHITTEST → HTCAPTION`），落在带内的像素收不到
 * 任何鼠标消息 —— 没有 `:hover`、没有 `mousedown`，**且与 z-index 无关**。而
 * antd 的浮层 portal 到 `document.body`，天然在 `.window-shell` 那套 no-drag
 * 声明之外，只能各自豁免。
 *
 * 用「编译 SCSS 后断言产出 CSS」而不是搜源码文本：豁免组是逗号并列的选择器列表，
 * 断言产出才能同时验证「选择器没写错」与「声明确实进了同一个规则块」
 * （与 `CharacterPack/pack-ui-kit.test.ts` 同一手法）。
 */

const SCSS_PATH = path.resolve(
  process.cwd(),
  "src/shared/components/WindowHeader/index.scss",
);

/** 去掉注释再匹配：说明文字里会引用选择器原文，不该算命中 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const source = stripComments(readFileSync(SCSS_PATH, "utf8"));
const css = sass.compile(SCSS_PATH, { style: "expanded" }).css.replace(/\s+/g, " ");

/** 会 portal 到 body、又可能压在 34px 拖动带上的可交互浮层（新增浮层要一起加） */
const PORTAL_OVERLAYS = [
  ".ant-modal-container",
  ".ant-modal-render",
  ".ant-dropdown",
  ".ant-select-dropdown",
  ".ant-picker-dropdown",
  ".ant-popover",
];

describe("窗口拖动带（构建前提）", () => {
  it("标题栏整条仍是拖动区", () => {
    expect(source).toMatch(/\.window-header\s*\{[^}]*-webkit-app-region:\s*drag/);
  });

  it("标题栏自带的 no-drag 区域仍在（别被顺手删掉）", () => {
    // leading 里放的是页间导航按钮，漏掉 no-drag 会变成「点了没反应」
    expect(css).toMatch(/\.window-header__leading[^{]*\{[^}]*-webkit-app-region: no-drag/);
    expect(css).toMatch(/\.window-header__actions[^{]*\{[^}]*-webkit-app-region: no-drag/);
    expect(css).toMatch(
      /\.window-header__controls[^{]*\{[^}]*-webkit-app-region: no-drag/,
    );
  });
});

describe("浮层豁免拖动带（回归守卫）", () => {
  it("每个 portal 浮层都自己排除了拖动区", () => {
    for (const selector of PORTAL_OVERLAYS) {
      const escaped = selector.replace(/\./g, "\\.");
      expect(css, `${selector} 没有排除拖动区，落在带内的部分会点不动`).toMatch(
        new RegExp(`${escaped}[^{]*\\{[^}]*-webkit-app-region: no-drag`),
      );
    }
  });
});
