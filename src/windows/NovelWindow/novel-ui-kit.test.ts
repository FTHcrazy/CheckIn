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

/** 可访问名签名：任一 `aria-*` 或 `title=`（例外组件的原生控件必须自带） */
const A11Y = /aria-[a-z]+=|title=/;

/**
 * 「超长虚拟化列表行」例外白名单（AGENTS.md §6.1.2，1.32.0 新增）。
 *
 * 这些组件在**已被虚拟化、行数可达数千**的列表里，滚动时会被反复
 * mount / unmount。用 antd 组件承载行内控件时，每行都带 Context + Portal +
 * 状态机，滚动一次要反复创建/销毁上万个组件 —— 这正是「切章卡、滚动卡」的源头。
 *
 * 例外**只**放开「必须用组件库组件」一条；下面三条仍然由本测试守护：
 * - 语义化标签与键盘可达（原生 `<button>` / `<input>` 本身即满足，
 *   且必须带 `aria-*` 或 `title`）
 * - 不得 `<Button>` 嵌 `<Button>`（对原生标签同样成立，见下方嵌套检查）
 * - 外观必须走 `var(--app-*)`（由 §6.1.1 的主题守卫与本文件的 scss 断言覆盖）
 *
 * 白名单是**路径后缀**匹配，新增条目必须同时在本文件的说明与 AGENTS.md 里
 * 补上理由 —— 别把它当成绕过守卫的快捷键。
 */
const VIRTUALIZED_ROW_EXCEPTION = [
  "components/ChapterTreeItem/index.tsx",
  "components/VolumeNode/index.tsx",
];

const isExemptFromComponentLibrary = (file: string): boolean => {
  // 路径分隔符在 Windows 上是 `\`，先归一化成 `/` 再比对后缀
  const normalized = file.replace(/\\/g, "/");
  return VIRTUALIZED_ROW_EXCEPTION.some((suffix) => normalized.endsWith(suffix));
};

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

  it("窗口内没有任何原生表单控件（虚拟化列表行白名单除外）", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles) {
      // 白名单组件豁免「必须用组件库组件」，但下面的可访问性断言仍会检查它们
      if (isExemptFromComponentLibrary(file)) continue;
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

  /**
   * 白名单组件的**补偿性**守卫：放开组件库不等于放开可访问性。
   * 每个原生控件都必须自带可访问名（aria-label / aria-selected / title /
   * aria-current / aria-expanded / aria-pressed 之一），否则它就是
   * 「看不见的按钮」—— 键盘用户与屏幕阅读器完全无法理解。
   *
   * 只看开标签本身（到该标签的 `>` 为止），不设置行窗口：
   * 可访问名与控件之间隔着几行属性是**写法差异**，不是可访问性差异，
   * 用「向下看 N 行」当判据既会漏（属性写远了）也会误放行（下一行的邻居
   * 控件带了 aria-label）。取真开标签才是这条断言的语义。
   */
  it("例外组件里的原生控件仍带可访问名（aria-* / title）", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles) {
      if (!isExemptFromComponentLibrary(file)) continue;
      const lines = stripComments(readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, index) => {
        const start = NATIVE_CONTROL.exec(line);
        if (!start) return;
        // 从 `<` 起花括号配平地找到真开标签的 `>`，把整段属性当作可访问名的搜索域
        const source = lines.slice(index).join("\n");
        let j = start.index;
        let brace = 0;
        let quote: string | null = null;
        while (j < source.length) {
          const ch = source[j];
          if (quote) {
            if (ch === quote) quote = null;
          } else if (ch === '"' || ch === "'" || ch === "`") {
            quote = ch;
          } else if (ch === "{") brace++;
          else if (ch === "}") brace--;
          else if (ch === ">" && brace === 0) break;
          j++;
        }
        const openTag = source.slice(start.index, j + 1);
        if (!A11Y.test(openTag)) {
          offenders.push(`${path.relative(ROOT, file)}:${index + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  /**
   * 例外组件必须**自带完整造型**：这是它换掉组件库之后要付的账。
   *
   * 走 antd `Button` 时，高度 / 内边距 / 圆角 / 边框 / 背景全由组件库给，
   * 清零只需覆盖差异项。换成原生标签后这些基础样式**全部消失**——
   * 浏览器会给出 `buttonface` 灰底 + 原生边框 + 默认字体，
   * 而这一步没有任何类型或构建错误提示你漏了。
   *
   * 因此对白名单文件反过来提要求：它们的 index.scss 必须真的声明外观，
   * 而不是靠"反正 antd 会给"的空壳。否则白名单就成了"少写样式也没人管"的后门。
   */
  it("例外组件的样式自带完整造型（height/border/padding 不能靠组件库兜底）", () => {
    const offenders: string[] = [];
    for (const suffix of VIRTUALIZED_ROW_EXCEPTION) {
      const dir = path.join(ROOT, "pages/NovelPage", path.dirname(suffix));
      const scss = path.join(dir, "index.scss");
      const source = stripComments(readFileSync(scss, "utf8"));
      // 原生控件的"看得见"三件套：盒子尺寸、可见边界、内边距
      const missing = (["height", "border", "padding"] as const).filter(
        (prop) => !new RegExp(`(^|[\\s;{(])${prop}\\s*:`, "m").test(source),
      );
      if (missing.length > 0) {
        offenders.push(`${path.relative(ROOT, scss)} 缺少 ${missing.join(" / ")}`);
      }
      // 豁免组件不得再残留指向组件库的清零规则：那是死 CSS，
      // 会让人误以为"这里还是 antd 按钮"而照抄回组件库写法
      if (/ant-btn/.test(source)) {
        offenders.push(`${path.relative(ROOT, scss)} 残留 .ant-btn 规则（已是原生标签）`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * 白名单只准收「已被虚拟化、行数可达数千」的**行组件**。
   * 后缀匹配很容易写宽（比如误写成 `components/`），一旦放宽，
   * 整个目录的组件都会失去组件库优先约束而不自知。
   * 这里反向钉两条：条目必须是具体文件、且确实处在虚拟化列表路径下。
   */
  it("白名单收得很紧（具体文件 + 虚拟化列表行，不会误放行整目录）", () => {
    expect(VIRTUALIZED_ROW_EXCEPTION.length).toBeGreaterThan(0);
    for (const suffix of VIRTUALIZED_ROW_EXCEPTION) {
      // 必须精确到某个组件的 index.tsx，不能是目录前缀
      expect(suffix.endsWith("/index.tsx")).toBe(true);
      expect(suffix.startsWith("components/")).toBe(true);
      // 必须真实存在，避免改名后留下一条永远匹配不到的僵尸条目
      const abs = path.join(ROOT, "pages/NovelPage", suffix);
      expect(statSync(abs).isFile()).toBe(true);
      // 反向验证：匹配必须落在该文件上，且不会顺带命中同目录的兄弟文件
      expect(isExemptFromComponentLibrary(abs)).toBe(true);
      // 兄弟文件（同目录的 index.scss）不得被后缀顺带命中 ——
      // 注意 path.join 在 Windows 上给的是 `\`，替换时要先把分隔符归一化
      const sibling = abs.replace(/[\\/]index\.tsx$/, "/index.scss");
      expect(sibling.endsWith("index.scss")).toBe(true);
      expect(isExemptFromComponentLibrary(sibling)).toBe(false);
    }
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

/**
 * 虚拟化列表容器的**尺寸守卫**。
 *
 * 起因是一个真实事故：出场章节列表的 Virtuoso 容器写了 `max-height: 240px`
 * 却没有确定高度。Virtuoso 的行是**绝对定位**、不参与父级尺寸计算，容器高度
 * 因此由 auto 塌成 0 —— 列表整个不可见，只剩标题上的章数。
 * 这个 bug 不会报错、不会抛异常、测试也查不到「元素缺失」（行确实渲染了，
 * 只是渲染在一个 0 高的盒子里），只能靠人眼看出来。
 *
 * 所以对每个用到 Virtuoso 的组件反过来提要求：承载它的那条规则必须给出
 * **确定高度**（`height` 或 flex 的 `flex: 1` + `min-height: 0`），
 * 只写 `max-height` 一律视为违规。
 */
describe("Novel 窗口：虚拟化列表容器必须有确定高度", () => {
  /** 用到 Virtuoso 的组件目录（相对 ROOT） */
  const VIRTUALIZED_DIRS = [
    "pages/NovelPage/components/ChapterTree",
    "pages/NovelPage/components/EntityDetail",
    "pages/NovelPage/components/OutlinePanel",
    "pages/NovelPage/components/InspirationPanel",
  ];

  it("每个虚拟列表的样式都给了确定高度（不能只写 max-height）", () => {
    const offenders: string[] = [];
    for (const dir of VIRTUALIZED_DIRS) {
      const tsx = readFileSync(path.join(ROOT, dir, "index.tsx"), "utf8");
      // 目录里没用 Virtuoso 就跳过（清单比实现先列出来时不假红）
      if (!tsx.includes("Virtuoso")) continue;

      const scss = stripComments(
        readFileSync(path.join(ROOT, dir, "index.scss"), "utf8"),
      );
      // 确定高度 = 显式 height，或 flex: 1 配合 min-height: 0
      const hasDefiniteHeight = /\bheight\s*:/.test(scss) || /\bflex\s*:\s*1/.test(scss);
      const hasMinHeightZero = /min-height\s*:\s*0/.test(scss);

      if (!hasDefiniteHeight) {
        offenders.push(`${dir}/index.scss 没有任何确定高度（height / flex: 1）`);
      } else if (!hasMinHeightZero && /flex\s*:\s*1/.test(scss)) {
        // flex: 1 单独用不足以收缩：父级 flex 项的默认 min-height 是 auto，
        // 长内容会把容器顶高而不是内部滚动
        offenders.push(`${dir}/index.scss 用了 flex: 1 但缺 min-height: 0`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("清单本身有效（目录存在，避免路径写错导致整段空转）", () => {
    for (const dir of VIRTUALIZED_DIRS) {
      expect(statSync(path.join(ROOT, dir)).isDirectory()).toBe(true);
    }
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
