import { readFileSync } from "node:fs";
import path from "node:path";
import * as sass from "sass";
import { describe, expect, it } from "vitest";

/**
 * 敏感词高亮的「不干扰正文」守卫。
 *
 * 起因是一个**没有任何报错**的事故：装饰节点原本用 `class: "nv-sm"`，
 * 而 `nv-sm` 同时是右栏敏感词面板的 BEM 块名，面板根节点那条
 * `display: flex; flex-direction: column` 于是命中了正文里的行内 `<span>`——
 * 命中的词被撑成块级元素、独占一行，整个段落被顶断。类型检查、ESLint、
 * 单测全绿，只有肉眼看得见。
 *
 * 两层断言对应两类静默退化：
 * 1. **命名空间撞车**：装饰类名如果被某条「单类选择器」规则命中，就可能被
 *    别人的布局属性劫持（项目是普通 CSS，没有 CSS Module 隔离）；
 * 2. **重排**：高亮层一旦声明 display / width / margin / line-height /
 *    font-size / padding-inline，就会改变折行位置——写作时正文跳动比
 *    漏标几个词更难忍（与要素标注层同一条硬约束）。
 */

const PAGE_ROOT = path.resolve(
  process.cwd(),
  "src/windows/NovelWindow/pages/NovelPage",
);
const EDITOR_SCSS = path.join(PAGE_ROOT, "components/EditorPane/index.scss");
const PANEL_SCSS = path.join(PAGE_ROOT, "components/SensitivePanel/index.scss");
const LAYER_TS = path.join(PAGE_ROOT, "sensitive-editor.ts");

const compile = (file: string): string =>
  sass.compile(file, { loadPaths: [path.resolve(process.cwd(), "src")] }).css;

interface CssRule {
  selector: string;
  body: string;
}

/** 扁平化 CSS 规则（sass 输出无嵌套；@media 内部块的选择器仍能取到原文） */
function parseRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  // 注释里的 `{` `}` 与选择器前的注释块都会污染解析，先剔除
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(clean)) !== null) {
    const selector = match[1].trim();
    if (!selector || selector.startsWith("@")) continue;
    rules.push({ selector, body: match[2] });
  }
  return rules;
}

/** 从编辑器扩展源码里取出装饰类名（唯一 `class: "..."` 声明） */
function readMarkClass(): string {
  const source = readFileSync(LAYER_TS, "utf8");
  const match = /class:\s*"([\w-]+)"/.exec(source);
  expect(match, "sensitive-editor.ts 里应有一处 class: \"...\" 声明").not.toBeNull();
  return match![1];
}

describe("敏感词高亮的类名不与其它模块撞车", () => {
  it("装饰类名不能被任何单类选择器规则命中（撞车即被别人的布局劫持）", () => {
    const markClass = readMarkClass();
    const rules = [
      ...parseRules(compile(EDITOR_SCSS)),
      ...parseRules(compile(PANEL_SCSS)),
    ];

    const hijacked = rules.filter((rule) =>
      rule.selector
        .split(",")
        .map((item) => item.trim())
        .includes(`.${markClass}`),
    );

    expect(
      hijacked.map((rule) => rule.selector),
      `类名 .${markClass} 被独立的类选择器命中，可能带来 display / flex 之类的布局副作用`,
    ).toEqual([]);
  });

  it("面板样式全部限定在 .nv-panel 之下，不可能泄漏到正文", () => {
    const leaked = parseRules(compile(PANEL_SCSS))
      .flatMap((rule) => rule.selector.split(","))
      .map((item) => item.trim())
      .filter((selector) => !selector.startsWith(".nv-panel "));

    expect(leaked, "面板选择器必须以 .nv-panel 作用域开头").toEqual([]);
  });
});

describe("敏感词高亮不改变正文排版", () => {
  it("高亮规则不改 display / 宽度 / 外边距 / 行高 / 字号 / 左右内边距", () => {
    const rules = parseRules(compile(EDITOR_SCSS)).filter((rule) =>
      rule.selector.includes("[data-sensitive-word]"),
    );
    expect(rules.length).toBeGreaterThan(0);

    const forbidden =
      /(^|;)\s*(display|width|min-width|max-width|margin[a-z-]*|line-height|font-size|font-weight|padding-inline[a-z-]*|letter-spacing)\s*:/;
    const offenders = rules.filter((rule) => forbidden.test(rule.body));

    expect(
      offenders.map((rule) => rule.selector),
      "高亮层只允许改 color / background / box-shadow / border-radius 一类不参与布局的属性",
    ).toEqual([]);
  });
});
