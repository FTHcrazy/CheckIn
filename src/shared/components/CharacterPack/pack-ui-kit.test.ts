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

const ROOT = path.resolve(process.cwd(), "src/shared/components/CharacterPack");

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
    "cpk-mod__pin",
    "cpk-eq__cand",
    "cpk-attrref",
    "cpk-castnote",
    "cpk-sum__row",
    "cpk-rlm__rung",
    "cpk-rlm__subnum",
    "cpk-head__name",
    "cpk-fxmodal__pick",
    "cpk-ncard",
    "cpk-emptyblock__cta",
    "cpk-board__changes",
    "cpk-board__entry",
    "cpk-board__attrrow",
    "cpk-board__modrow",
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

/**
 * 头部工具栏的图标尺寸（用户报障：图标太小、看着「不明显」）。
 *
 * 钉死的是一条**极容易静默退化**的约束：头部图标要比面板其它地方大一号。
 * 它靠 PackHeader 的局部覆盖实现，而覆盖对象 `.cpk-iconbtn` 是**跨模块公共原语**
 * —— 后人「顺手把基础档调大」或「把这条覆盖删掉当作冗余」，都会让头部图标
 * 悄悄缩回 13px，且**没有任何类型或构建错误**。
 *
 * 为什么覆盖必须写在头部而不是改基础档：`.cpk-iconbtn` 在面板里有十几处使用点
 * （每个模块标题行右侧并排 3~4 枚），调基础档等于改整个面板的密度。
 * 故这里同时断言**两侧**：头部有覆盖 + 基础档仍是模块密度。
 */
describe("行囊 UI：头部工具栏图标比面板其它地方大一号", () => {
  const headScssPath = path.resolve(
    ROOT,
    "components/PackHeader/index.scss",
  );
  const headCss = sass.compile(headScssPath, { style: "expanded" }).css;
  const commonCss = sass.compile(
    path.resolve(ROOT, "styles/pack-common.scss"),
    { style: "expanded" },
  ).css;

  /** 取某选择器规则块的正文 */
  function block(css: string, selector: string): string {
    const at = css.indexOf(selector);
    if (at < 0) throw new Error(`编译产物里找不到选择器：${selector}`);
    return css.slice(at, css.indexOf("}", at) + 1);
  }

  it("头部对图标按钮做了局部放大（16px 字形 / 28px 盒）", () => {
    const rule = block(headCss, ".cpk-head__tools .cpk-iconbtn.ant-btn");
    expect(rule).toContain("--ant-button-content-font-size: 16px");
    expect(rule).toContain("--ant-control-height: 28px");
    expect(rule).toContain("width: 28px");
  });

  it("窄档那枚「更多」入口也吃到同一档尺寸（它不在 __tools 里）", () => {
    // compact 时四枚工具收进 Dropdown，触发按钮是 __ops 的直接子元素
    expect(headCss).toMatch(
      /\.cpk-head__ops\s*>\s*\.cpk-iconbtn\.ant-btn[^{]*\{[^}]*--ant-button-content-font-size:\s*16px/,
    );
  });

  it("图标描边色提到 --app-text 一档（只有字号大、颜色仍淡一样不明显）", () => {
    const rule = block(headCss, ".cpk-head__tools .cpk-iconbtn.ant-btn");
    expect(rule).toContain("--ant-button-default-color: var(--app-text)");
  });

  it("基础档保持模块密度（24px 盒 / 13px 字形）—— 不许顺手调大", () => {
    const rule = block(commonCss, ".cpk-iconbtn.ant-btn");
    expect(rule).toContain("--ant-control-height: 24px");
    expect(rule).toContain("--ant-button-content-font-size: 13px");
  });

  it("基础档仍然可被缩小（.tiny 行内档存在且更小）", () => {
    const at = commonCss.indexOf(".cpk-iconbtn.ant-btn.tiny");
    expect(at).toBeGreaterThan(-1);
    const rule = commonCss.slice(at, commonCss.indexOf("}", at) + 1);
    expect(rule).toContain("--ant-button-content-font-size: 11px");
  });
});

/**
 * 头部文字动作按钮的描边形态。
 *
 * 设计稿里「全部已读 / 撤销全部」是浅描边按钮；面板其它地方的 `.cpk-btn.ghost`
 * 是**无框低强调**（模块头里的次级操作），那里不该被改成有框。
 * 所以这是一条**局部覆盖**，且必须靠 `.cpk-head` 多挂一个类来压过公共层 ——
 * 因为包顺序上 PackHeader 的样式先于 pack-common 加载，同特异性下后者胜出，
 * 3 个类的写法会被**静默吃掉**（不报错、只是没生效）。
 */
describe("行囊 UI：头部文字按钮按设计稿加描边", () => {
  const headScssPath = path.resolve(ROOT, "components/PackHeader/index.scss");
  // ⚠️ 必须先去注释：sass 的 expanded 产物**保留注释**，而说明文字里会引用
  // 选择器原文（`.cpk-head .cpk-head__ops > .cpk-btn.ghost`），
  // `indexOf` 会先命中注释里的那一段，取出来的「规则块」其实是注释。
  const headCss = stripComments(
    sass.compile(headScssPath, { style: "expanded" }).css,
  );

  it("覆盖选择器带 .cpk-head 前缀（4 个类，压得过公共层的 3 个类）", () => {
    const at = headCss.indexOf(".cpk-head .cpk-head__ops > .cpk-btn.ghost");
    expect(at).toBeGreaterThan(-1);
    const rule = headCss.slice(at, headCss.indexOf("}", at) + 1);
    expect(rule).toContain("--ant-button-default-border-color: var(--app-border-strong)");
    expect(rule).toContain("--ant-button-default-bg: var(--app-surface)");
  });

  it("公共层的 ghost 仍是无框低强调（模块头那边不受影响）", () => {
    const commonCss = stripComments(
      sass.compile(path.resolve(ROOT, "styles/pack-common.scss"), {
        style: "expanded",
      }).css,
    );
    const at = commonCss.indexOf(".cpk-btn.ant-btn.ghost");
    expect(at).toBeGreaterThan(-1);
    const rule = commonCss.slice(at, commonCss.indexOf("}", at) + 1);
    expect(rule).toContain("--ant-button-default-border-color: transparent");
  });
});

/**
 * 「刚改动」角标与「稀有度圆点」在形状上必须分得开（2026-10 用户报障）。
 *
 * 物品行首原本是「7px 稀有度圆点 + 6px 改动圆点」两个**同形状**的小圆点，
 * 读者只看到「每项前面有两个点」，分不出哪个是内容、哪个是状态
 * （用户直接把这一对圈出来问「不清楚干什么的」）。
 *
 * 修法是给两者定不同的形状：稀有度点是**内容**（有色阶含义、可点改），
 * 保持圆形；改动点是**状态提示**，改成竖条。这条守卫把「形状必须不同」
 * 钉死 —— 谁把 `.cpk-changed` 改回圆点，两个点又会糊在一起。
 */
describe("行囊 UI：改动角标与稀有度圆点形状可分", () => {
  const commonCss = stripComments(
    sass.compile(path.resolve(ROOT, "styles/pack-common.scss"), {
      style: "expanded",
    }).css,
  );

  function ruleOf(css: string, selector: string): string {
    const at = css.indexOf(selector);
    expect(at).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf("}", at) + 1);
  }

  it("改动角标是竖条（宽 < 高），不是圆点", () => {
    const rule = ruleOf(commonCss, ".cpk-changed");
    const width = /width:\s*(\d+)px/.exec(rule)?.[1];
    const height = /height:\s*(\d+)px/.exec(rule)?.[1];
    expect(width).toBeDefined();
    expect(height).toBeDefined();
    expect(Number(width)).toBeLessThan(Number(height));
    expect(rule).not.toContain("border-radius: 50%");
  });

  it("稀有度圆点仍是圆形（它是内容，有自己的色阶语义）", () => {
    const eqCss = stripComments(
      sass.compile(path.resolve(ROOT, "components/EquipmentModule/index.scss"), {
        style: "expanded",
      }).css,
    );
    const rule = ruleOf(eqCss, ".cpk-dot");
    expect(rule).toContain("border-radius: 50%");
  });
});
