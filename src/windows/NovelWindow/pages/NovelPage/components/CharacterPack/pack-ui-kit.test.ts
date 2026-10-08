import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import * as sass from "sass";
import { describe, expect, it } from "vitest";

/**
 * 行囊 UI 的「组件库优先」守卫（AGENTS.md §6.1.2）。
 *
 * 这一组断言钉死的是一类**会慢慢回潮**的退化：写页面时顺手敲一个原生 `<button>`
 * 或 `<input>`，功能照跑、类型也过，但它不跟随主题的组件级变量、没有组件库给的
 * 键盘与焦点可达性，还得额外手写一套 hover / active —— 改主题时总有一两处漏掉。
 * 等发现时已经散落十几个文件，所以把边界钉在源码上。
 *
 * 第二条防线是「自带造型的控件仍然由组件库按钮承载」：外观是自己定的，但
 * 必须先清零 antd 的组件级变量再声明（`styles/pack-widget.scss` 的 mixin）。
 * 这里**编译 SCSS 后断言产出 CSS**，而不是搜源码文本 —— 因为控件样式都写成
 * `&__xxx.ant-btn` 的嵌套形式，字面量在源码里根本不存在；编译后断言同时验证了
 * 「嵌套解析正确」与「清零点确实被展开进来」两件事。
 */

const ROOT = path.resolve(
  process.cwd(),
  "src/windows/NovelWindow/pages/NovelPage/components/CharacterPack",
);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** 去掉注释后再匹配：说明文字里会引用 `<button>` 这种标签名，不该算命中 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const files = walk(ROOT);
const tsxFiles = files.filter((file) => file.endsWith(".tsx"));
const componentScss = files.filter((file) =>
  /[\\/]components[\\/][^\\/]+[\\/]index\.scss$/.test(file),
);

const compiledCss = componentScss
  .map((file) => sass.compile(file, { style: "expanded" }).css)
  .join("\n");

const NATIVE_CONTROL = /<(button|input|textarea|select)(?=[\s/>])/;

describe("行囊 UI：原生表单控件清零", () => {
  it("编译到了组件样式（编译产物非空，否则下面的断言会全部假通过）", () => {
    expect(componentScss.length).toBeGreaterThan(10);
    expect(compiledCss.length).toBeGreaterThan(1000);
  });

  it("组件源码里没有任何原生表单控件", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles) {
      const source = stripComments(readFileSync(file, "utf8"));
      source.split("\n").forEach((line, index) => {
        if (NATIVE_CONTROL.test(line)) {
          offenders.push(`${path.relative(ROOT, file)}:${index + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("没有残留的自绘开关 DOM（.cpk-sw2__dot 只属于旧的 span 实现）", () => {
    const hit = tsxFiles.filter((file) =>
      readFileSync(file, "utf8").includes("cpk-sw2__dot"),
    );
    expect(hit).toEqual([]);
  });
});

describe("行囊 UI：组件必须引入自己的样式", () => {
  it("每个组件的 index.scss 都被同目录的 index.tsx 引入", () => {
    // 这一条是被真缺陷逼出来的：NoteModule / StatusModule / SummaryModule 三份样式
    // 长期没被任何地方引用（构建产物里连类名都不存在），即"改了样式但界面没反应"。
    const missing: string[] = [];
    for (const file of tsxFiles.filter((f) => /[\\/]components[\\/][^\\/]+[\\/]index\.tsx$/.test(f))) {
      const dir = path.dirname(file);
      if (!files.includes(path.join(dir, "index.scss"))) continue;
      if (!readFileSync(file, "utf8").includes('"./index.scss"')) {
        missing.push(path.relative(ROOT, file));
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("行囊 UI：自带造型的控件以 .ant-btn 承载", () => {
  /** 这些控件视觉是自己定的，但必须由组件库按钮承载、清零后重绘 */
  const WIDGET_CLASSES = [
    "cpk-mod__toggle",
    "cpk-eq__cand",
    "cpk-attrref",
    "cpk-castnote",
    "cpk-sum__row",
    "cpk-rlm__rung",
    "cpk-head__name",
    "cpk-fxmodal__pick",
    "cpk-ncard",
  ];

  it.each(WIDGET_CLASSES)("%s 的选择器带 .ant-btn 限定", (className) => {
    expect(compiledCss).toMatch(new RegExp(`\\.${className}\\.ant-btn\\s*\\{`));
  });

  it.each(WIDGET_CLASSES)("%s 先展开清零点再声明（含 --ant-control-height: auto）", (className) => {
    const at = compiledCss.search(new RegExp(`\\.${className}\\.ant-btn\\s*\\{`));
    expect(at).toBeGreaterThan(-1);
    // `auto` 是清零点 mixin 的签名声明；出现在同一规则块里 = mixin 确实被 include 了。
    // 少了它，antd 的组件级变量默认值会把下面的自定义值盖掉（两者特异性相同）。
    expect(compiledCss.slice(at, at + 600)).toContain("--ant-control-height: auto");
  });
});
