/**
 * 全局设定窗口 · 样式依赖守卫
 *
 * 起因（真机反馈「卡头挤在一起没边距」）：本窗口**不渲染** `<SettingCenter>`，
 * 只复用它的 hook，外壳是私有的 `GsBody` / `GsCategoryRow`。而共享的
 * `setting-primitives.scss` 只被 `SettingCenter/index.scss` `@use` —— `@use`
 * 是编译期行为，那条链走不到，零件层的 CSS 就一字节都不会进 bundle。
 *
 * 丢的恰恰是最不起眼、但决定版式的那几条：
 *   `.nv-sc__card`        display:flex / flex-direction:column（`gap` 全失效）
 *   `.nv-sc__card-head`   display:flex（标题 / 徽标 / 按钮只能行内挤着排）
 *   `.nv-sc__spacer`      flex:1（编辑 / 删除不再靠右）
 *   `.nv-sc__field`       表单标签与输入框竖排
 *   `.nv-sc__carry-example` display:flex（「进位示例」与正文粘死）
 *
 * 为什么必须用源码断言：这类缺失在 jsdom 里完全不可见（不排版），在原型页
 * 里也看不见（原型会 @use 零件层，正是它把问题掩盖了一轮）。只有校验
 * 「真实入口的 @use 链」才能拦住。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(path.resolve(process.cwd(), relative), "utf8");

/** 去掉 SCSS 注释：本文件与 index.scss 的说明文字里都引用了下面这些类名 /
 *  路径原文，不剥掉的话即使把 @use 删了、断言依然会通过。 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const WINDOW_INDEX = stripComments(read("src/windows/GlobalSettingWindow/index.scss"));
const PRIMITIVES = stripComments(
  read("src/shared/components/SettingCenter/setting-primitives.scss"),
);

const PRIMITIVES_USE = '@use "../../shared/components/SettingCenter/setting-primitives"';
const SKIN_USE = '@use "./gs-skin"';

/** 窗口版式依赖、但只由零件层提供的类（各有唯一的「存在性」声明） */
const REQUIRED_PRIMITIVES = [
  "&__card {",
  "&__card-head {",
  "&__spacer {",
  "&__field {",
  "&__carry-example {",
];

describe("全局设定窗口的样式依赖", () => {
  it("窗口入口自己引入共享零件层（不渲染 SettingCenter 就没有别的链能带进来）", () => {
    expect(WINDOW_INDEX).toContain(PRIMITIVES_USE);
  });

  it("零件层早于皮肤层：零件负责「存在」，皮肤只负责「改」", () => {
    const primitivesAt = WINDOW_INDEX.indexOf(PRIMITIVES_USE);
    const skinAt = WINDOW_INDEX.indexOf(SKIN_USE);
    expect(primitivesAt).toBeGreaterThanOrEqual(0);
    expect(skinAt).toBeGreaterThanOrEqual(0);
    expect(primitivesAt).toBeLessThan(skinAt);
  });

  it("零件层仍提供窗口依赖的那几条基座规则（搬走就得同步改引入）", () => {
    for (const selector of REQUIRED_PRIMITIVES) {
      expect(PRIMITIVES).toContain(selector);
    }
  });
});
