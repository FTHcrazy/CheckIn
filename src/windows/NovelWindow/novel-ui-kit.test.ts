import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import * as sass from "sass";
import { describe, expect, it } from "vitest";

/**
 * Novel 窗口的「组件库优先」守卫（AGENTS.md §6.1.2）。
 *
 * 与行囊那份 `CharacterPack/pack-ui-kit.test.ts` 的关系：那份钉的是行囊内部，
 * 这一份钉的是**整个窗口**——迁移完 105 处原生 `<button>` 之后，回潮的入口
 * 从「行囊内部新增」变成了「窗口里任何一个新面板顺手写一个原生按钮」。
 *
 * 三条断言各自对应一类**不会自己报错**的退化：
 * 1. 原生表单控件：功能照跑、类型也过，但不跟随主题的组件级变量、没有键盘与
 *    焦点可达性，改主题时总有一两处漏掉；
 * 2. `<Button>` 嵌套 `<Button>`：浏览器会把结构拆坏，只有打开 DOM 才看得见；
 * 3. 只换了标签、没在样式里补「清零点」：按钮会带上 antd 默认的高度 / 内边距 /
 *    圆角 / 边框，视觉全乱——而这一步**没有任何类型或构建错误**提示你漏了。
 *
 * 第 3 条因此编译全部 SCSS 后断言 `.类名.ant-btn` 规则存在且带清零点签名
 * `--ant-control-height`，而不是搜源码文本（BEM 嵌套的字面量在源码里不存在）。
 */

const ROOT = path.resolve(process.cwd(), "src/windows/NovelWindow");

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
const scssFiles = files.filter((file) => file.endsWith(".scss"));

const compiledCss = scssFiles
  .map((file) => sass.compile(file, { style: "expanded" }).css)
  .join("\n");

const NATIVE_CONTROL = /<(button|input|textarea|select)(?=[\s/>])/;

/**
 * 扫出所有 `<Button` 开标签（含自闭合），返回它们在源码里的位置与是否自闭合。
 * 必须手写到「匹配的 `>`」为止：属性里有 `onClick={() => ...}` 这种带 `>` 的箭头，
 * 用正则 `<Button[^>]*>` 会在箭头处提前截断。
 */
function scanButtonTags(source: string) {
  const tokens: Array<{ type: "open" | "self" | "close"; line: number }> = [];
  const re = /<Button\b|<\/Button>/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(source))) {
    if (m[0] === "</Button>") {
      tokens.push({ type: "close", line: 0 });
      continue;
    }
    let j = m.index + "<Button".length;
    let brace = 0;
    let quote: string | null = null;
    while (j < source.length) {
      const c = source[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === "`") {
        quote = c;
      } else if (c === "{") brace++;
      else if (c === "}") brace--;
      else if (c === ">" && brace === 0) break;
      j++;
    }
    tokens.push({
      type: source[j - 1] === "/" ? "self" : "open",
      line: source.slice(0, m.index).split("\n").length,
    });
  }
  return tokens;
}

/** 从 `<Button>` 开标签里取出业务类名（模板字符串里的条件后缀会被剥掉） */
function buttonClasses(source: string): Set<string> {
  const out = new Set<string>();
  const stripped = stripComments(source);
  const re = /<Button\b/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(stripped))) {
    let j = m.index + "<Button".length;
    let brace = 0;
    let quote: string | null = null;
    while (j < stripped.length) {
      const c = stripped[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'" || c === "`") {
        quote = c;
      } else if (c === "{") brace++;
      else if (c === "}") brace--;
      else if (c === ">" && brace === 0) break;
      j++;
    }
    const tag = stripped.slice(m.index, j + 1);
    const cm = tag.match(/className=(?:"([^"]*)"|\{([\s\S]*)\})/);
    if (!cm) continue;
    const raw = (cm[1] ?? cm[2] ?? "").replace(/\$\{[\s\S]*?\}/g, "");
    for (const token of raw.split(/[\s+"]/)) {
      const cls = token.replace(/[^A-Za-z0-9_-]/g, "");
      if (/^(nv|bs|cpk|novel)-/.test(cls)) out.add(cls);
    }
  }
  return out;
}

/**
 * 刻意走组件库自带造型、不需要清零点的按钮类。
 * `bs-hero__cta` 用的是 `type="primary"` + `size="large"`，清零反而会破坏它。
 */
const NO_RESET_NEEDED = new Set(["bs-hero__cta"]);

describe("Novel 窗口：原生表单控件清零", () => {
  it("编译到了窗口全部样式（产物非空，否则下面的断言会全部假通过）", () => {
    expect(scssFiles.length).toBeGreaterThan(30);
    expect(compiledCss.length).toBeGreaterThan(10000);
  });

  it("窗口内没有任何原生表单控件", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles) {
      stripComments(readFileSync(file, "utf8"))
        .split("\n")
        .forEach((line, index) => {
          if (NATIVE_CONTROL.test(line)) {
            offenders.push(`${path.relative(ROOT, file)}:${index + 1}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it("没有 Button 嵌 Button（浏览器会拆坏 DOM）", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles) {
      const source = stripComments(readFileSync(file, "utf8"));
      let depth = 0;
      for (const token of scanButtonTags(source)) {
        if (token.type === "open") {
          depth++;
          if (depth > 1) {
            offenders.push(`${path.relative(ROOT, file)}:${token.line}`);
          }
        } else if (token.type === "close" && depth > 0) {
          depth--;
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("Novel 窗口：自带造型的按钮都配了清零点", () => {
  const classes = new Set<string>();
  for (const file of tsxFiles) {
    for (const cls of buttonClasses(readFileSync(file, "utf8"))) {
      classes.add(cls);
    }
  }

  it("样本非空（扫不到类说明解析失效，下面的断言会假通过）", () => {
    expect(classes.size).toBeGreaterThan(40);
  });

  /**
   * 编译产物里的规则（选择器 → 声明块）。清零块常常写成
   * `.a.ant-btn, .b.ant-btn { @include ... }`，按类名逐个搜会把这种合并写法漏掉，
   * 所以按「规则」而不是「选择器字符串」来判。
   */
  const rules: Array<{ selector: string; body: string }> = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let rm: RegExpExecArray | null;
  while ((rm = ruleRe.exec(compiledCss))) {
    rules.push({ selector: rm[1], body: rm[2] });
  }

  const hasRule = (cls: string): boolean =>
    rules.some((rule) => rule.selector.includes(`.${cls}.ant-btn`));

  /** 该类所在的规则块里是否有清零点 mixin 的签名声明 */
  const hasReset = (cls: string): boolean =>
    rules.some(
      (rule) =>
        rule.selector.includes(`.${cls}.ant-btn`) &&
        rule.body.includes("--ant-control-height"),
    );

  it.each([...classes].sort())("%s 有 .ant-btn 规则（换标签后没漏清零）", (cls) => {
    if (NO_RESET_NEEDED.has(cls)) return;
    // `--x` 修饰符可以只挂基类（如 `nv-mini--warn` 靠 `.nv-mini.ant-btn`）
    const base = cls.includes("--") ? cls.split("--")[0] : cls;
    expect(hasRule(cls) || hasRule(base)).toBe(true);
  });

  it.each([...classes].sort())("%s 的清零点里带 --ant-control-height", (cls) => {
    if (NO_RESET_NEEDED.has(cls)) return;
    const base = cls.includes("--") ? cls.split("--")[0] : cls;
    // `--x` 修饰符可以只挂基类（如 `nv-mini--warn` 靠 `.nv-mini.ant-btn`）
    expect(hasReset(cls) || hasReset(base)).toBe(true);
  });
});

describe("Novel 窗口：角标走组件库", () => {
  const supportPanel = stripComments(
    readFileSync(
      path.join(ROOT, "pages/NovelPage/components/SupportPanel/index.tsx"),
      "utf8",
    ),
  );

  it("右栏 tab 角标用 antd Badge（不再手搓 <i> 角标）", () => {
    expect(supportPanel).toContain("<Badge");
    // 旧实现是自绘的 `<i className="nv-panel__badge">`：位置 / 圆角 / 描边
    // 全靠自己算，面板拖窄时会压住图标。类名不得回潮
    expect(supportPanel).not.toContain("nv-panel__badge");
    expect(compiledCss).not.toContain(".nv-panel__badge");
  });

  it("角标只调组件级变量（编译产物里能查到 .nv-panel__tab-badge.ant-badge）", () => {
    expect(compiledCss).toContain(".nv-panel__tab-badge.ant-badge");
    expect(compiledCss).toContain("--ant-badge-indicator-height");
  });
});

describe("Novel 窗口：主题变量", () => {
  it("样式里不引用不存在的 --app-danger（真名是 --app-error）", () => {
    const offenders = scssFiles.filter((file) =>
      stripComments(readFileSync(file, "utf8")).includes("var(--app-danger"),
    );
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});
