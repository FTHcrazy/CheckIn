/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as sass from "sass";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  THEME_LIST,
  getThemeMeta,
  isThemeId,
} from "./themes";

/**
 * 主题 CSS 变量文件：与主题清单必须一一对应，缺一套就是换肤后变量回落。
 * 用 node 直接读取（Vite 的 ?raw 对 .scss 会走样式编译管线，取到的是空串）。
 */
const THEME_SCSS = readFileSync(
  path.resolve(process.cwd(), "src/shared/styles/themes.scss"),
  "utf8",
);
const SRC_ROOT = path.resolve(process.cwd(), "src");

/* ── 扫描 SCSS 的公共零件（下面两组守卫都要用） ── */

/** 去块注释与行注释：注释里常引用被删掉的写法，参与匹配会误判 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** 同上，但块注释按原行数换成空行 —— 报错时行号要对得上真实文件 */
function stripCommentsKeepLines(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => "\n".repeat(block.split("\n").length - 1))
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** 递归收集 src 下的 SCSS（跳过 node_modules / dist） */
function collectScssFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!/node_modules|dist/.test(entry.name)) collectScssFiles(full, acc);
      continue;
    }
    if (entry.name.endsWith(".scss")) acc.push(full);
  }
  return acc;
}

/** `[data-theme="x"] { … }` 拆成 id → 声明块（aurora 与 :root 共用一条规则） */
const THEME_BLOCKS = (() => {
  const parts = THEME_SCSS.split(/\[data-theme="([a-z]+)"\]/);
  const map = new Map<string, string>();
  map.set(DEFAULT_THEME, parts[2] ?? "");
  for (let i = 1; i < parts.length; i += 2) map.set(parts[i], parts[i + 1]);
  return map;
})();

/** 只认 6 位 hex（分层 token 都是纯色，渐变 / rgba 不参与亮度断言） */
const readVar = (block: string, name: string): string => {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block);
  return match?.[1]?.toLowerCase() ?? "";
};

/** WCAG 相对亮度 */
const luminance = (hex: string): number => {
  const lin = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};

/** 对比度比（≥1，1 表示两色完全同亮度） */
const ratio = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("isThemeId", () => {
  it("合法主题 id 返回 true", () => {
    expect(isThemeId("aurora")).toBe(true);
    expect(isThemeId("cream")).toBe(true);
    expect(isThemeId("mint")).toBe(true);
    expect(isThemeId("midnight")).toBe(true);
  });

  it("非法值返回 false（不抛错，供存储回退使用）", () => {
    expect(isThemeId("dark")).toBe(false);
    expect(isThemeId("")).toBe(false);
    expect(isThemeId(undefined)).toBe(false);
    expect(isThemeId(null)).toBe(false);
    expect(isThemeId(1)).toBe(false);
  });
});

describe("getThemeMeta", () => {
  it("已知 id 返回对应主题", () => {
    expect(getThemeMeta("midnight").label).toBe("月夜暗色");
    expect(getThemeMeta("midnight").isDark).toBe(true);
  });

  it("未知 id 回退到默认主题，避免渲染层拿到 undefined", () => {
    expect(getThemeMeta("nope" as never).id).toBe(DEFAULT_THEME);
  });
});

describe("THEME_LIST", () => {
  it("id 不重复且默认主题在清单内", () => {
    const ids = THEME_LIST.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_THEME);
  });

  it("每个主题都提供了完整的 antd 色板（具体色值，不能是 var()）", () => {
    THEME_LIST.forEach((theme) => {
      Object.values(theme.antd).forEach((color) => {
        expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
      });
    });
  });

  it("每个主题在 themes.scss 中都有对应的 data-theme 定义", () => {
    THEME_LIST.forEach((theme) => {
      // 默认主题写在 :root 上，其余用属性选择器
      const pattern =
        theme.id === DEFAULT_THEME
          ? /:root,/
          : new RegExp(`\\[data-theme="${theme.id}"\\]`);
      expect(THEME_SCSS).toMatch(pattern);
    });
  });

  it("四套主题共用同一组变量名（缺变量会导致换肤后局部掉色）", () => {
    const collectVars = (block: string) =>
      [...block.matchAll(/(--app-[a-z-]+):/g)].map((match) => match[1]).sort();

    // 第 0 段是文件头注释 + `:root,` 前缀，真正的属性选择器块从第 1 段开始
    const blocks = THEME_SCSS.split(/\[data-theme=/).slice(1);
    expect(blocks).toHaveLength(THEME_LIST.length);

    const expected = collectVars(blocks[0]);
    expect(expected.length).toBeGreaterThan(20);

    blocks.forEach((block) => {
      expect(collectVars(block)).toEqual(expected);
    });
  });
});

/**
 * 面板分层不变量。
 *
 * 浅色主题里 `--app-surface` 与 `--app-surface-elevated` 曾经**都是 #ffffff**：
 * 结果是卡片、面板、下拉 / 弹窗 / 抽屉同色，只剩描边和阴影分家 —— 行囊看板
 * 卡「浮在正文之上」的意图完全落空（用户截图反馈过）。
 *
 * 这里用相对亮度（WCAG）把「分层」写成可数值校验的不变量，而不是靠人眼比对截图：
 *   - 方向：elevated 必须比内容面更靠近观察者（暗色更亮、浅色趋纯白）；
 *   - 幅度：相邻两层至少差一档可感知的量级；
 *   - 一致性：antd 的容器色板必须与 themes.scss 的对应 token 逐值相等。
 */
describe("面板分层（浅色也不能与浮层同色）", () => {
  const themeBlocks = THEME_BLOCKS;

  it("四套主题都能解析出分层色值", () => {
    expect(themeBlocks.size).toBe(THEME_LIST.length);
    THEME_LIST.forEach((theme) => {
      const block = themeBlocks.get(theme.id) ?? "";
      expect(block.length).toBeGreaterThan(200);
      expect(readVar(block, "app-surface")).toMatch(/^#[0-9a-f]{6}$/);
      expect(readVar(block, "app-surface-elevated")).toMatch(/^#[0-9a-f]{6}$/);
    });
  });

  it("elevated 恒为最贴近观察者的一层，且与内容面拉开可感知的一档", () => {
    THEME_LIST.forEach((theme) => {
      const block = themeBlocks.get(theme.id)!;
      const surface = readVar(block, "app-surface");
      const elevated = readVar(block, "app-surface-elevated");
      // 方向：浮层比内容面更亮（浅色趋纯白、暗色提亮）
      expect(luminance(elevated)).toBeGreaterThan(luminance(surface));
      // 幅度：浅色回归 #ffffff vs #ffffff 时此处必红
      expect(ratio(surface, elevated)).toBeGreaterThanOrEqual(1.025);
    });
  });

  it("内容面与页面底 / 次级面色都分得开（不能靠描边硬撑）", () => {
    THEME_LIST.forEach((theme) => {
      const block = themeBlocks.get(theme.id)!;
      const surface = readVar(block, "app-surface");
      expect(ratio(readVar(block, "app-bg"), surface)).toBeGreaterThanOrEqual(1.02);
      expect(ratio(readVar(block, "app-surface-alt"), surface)).toBeGreaterThanOrEqual(1.02);
    });
  });

  it("antd 容器色板与 themes.scss 对应 token 逐值同步（防同屏两套底色）", () => {
    THEME_LIST.forEach((theme) => {
      const block = themeBlocks.get(theme.id)!;
      expect(theme.antd.colorBgContainer).toBe(readVar(block, "app-surface"));
      expect(theme.antd.colorBgElevated).toBe(readVar(block, "app-surface-elevated"));
      expect(theme.antd.colorBgLayout).toBe(readVar(block, "app-bg"));
    });
  });

  it("正文纸面色 theme.paper 与 themes.scss 的 --app-paper 逐值同步", () => {
    THEME_LIST.forEach((theme) => {
      const block = themeBlocks.get(theme.id)!;
      const paper = readVar(block, "app-paper");
      expect(paper).toMatch(/^#[0-9a-f]{6}$/);
      expect(theme.paper.toLowerCase()).toBe(paper);
    });
  });

  it("纸面色与内容面分得开（纸面是内容区 elevated 一档，不能与 surface 同色）", () => {
    THEME_LIST.forEach((theme) => {
      const block = themeBlocks.get(theme.id)!;
      const surface = readVar(block, "app-surface");
      const paper = readVar(block, "app-paper");
      expect(paper).not.toBe(surface);
    });
  });

  /**
   * 顶栏 chip 的层次（UI-07）同样靠 token 值撑起来：
   * 默认底要从顶栏底色里「浮」出来，hover 再沉一档，持久激活换主色弱底。
   * 任一处调平（例如把 surface-hover 改回与 header-bg 同值）就退化成
   * 「一排灰点看不出可点」，这里用同一套亮度判据钉住。
   */
  it("顶栏 chip 底色三档（顶栏底 / 默认 / hover 与按下）逐档可分辨", () => {
    THEME_LIST.forEach((theme) => {
      const block = themeBlocks.get(theme.id)!;
      const header = readVar(block, "app-header-bg");
      const hover = readVar(block, "app-surface-hover");
      const active = readVar(block, "app-surface-active");
      expect(ratio(header, hover)).toBeGreaterThanOrEqual(1.05);
      expect(ratio(hover, active)).toBeGreaterThanOrEqual(1.03);

      // 激活态：主色弱底与默认底都是「极浅底」，允许亮度相近（激活与否另由
      // 主色图标 + 1px 主色内描边表达，见 NovelTopBar/index.scss），
      // 但**绝不能是同一支色**，否则等于底色没变、只剩图标换色。
      const on = readVar(block, "app-primary-weak");
      expect(on).not.toBe(hover);
      expect(on).not.toBe(active);
    });
  });
});

/**
 * 未定义 token 守卫。
 *
 * `var(--app-typo)` 不会报错、不会编译失败 —— 浏览器直接当它不存在，
 * 于是那一条声明静默失效（圆角变 0、颜色继承父级），肉眼很难发现。
 * 本仓已经踩过三次（--app-radius-sm / --app-text-primary / --app-primary-bg），
 * 所以这里反向扫一遍：SCSS 里引用的每个 --app-* 必须在 themes.scss 里定义。
 *
 * 例外：
 * - 带 fallback 的 `var(--x, …)` 允许未定义（fallback 即是设计意图）；
 * - 注释里的提及不算引用（`stripComments` 先剔注释再匹配）。
 */
describe("--app-* token 引用完整性（防静默失效）", () => {
  it("src 下所有 SCSS 引用的 --app-* 都在 themes.scss 里有定义", () => {
    const defined = new Set(
      [...THEME_SCSS.matchAll(/(--app-[a-z0-9-]+)\s*:/g)].map((m) => m[1]),
    );
    // 先自证 token 池非空，避免正则写错导致本用例 vacuous 通过
    expect(defined.size).toBeGreaterThan(50);

    const files = collectScssFiles(path.resolve(process.cwd(), "src"));
    // 同理：扫不到文件说明路径写错了，别让它静默通过
    expect(files.length).toBeGreaterThan(20);

    const offenders: string[] = [];
    for (const file of files) {
      const source = stripComments(readFileSync(file, "utf8"));
      // `var(--app-x, fallback)` —— 带 fallback 的引用是设计意图，放行
      const withoutFallback = source.replace(
        /var\(\s*--app-[a-z0-9-]+\s*,[^)]*\)/g,
        "",
      );
      for (const match of withoutFallback.matchAll(/var\(\s*(--app-[a-z0-9-]+)/g)) {
        if (!defined.has(match[1])) {
          offenders.push(`${path.relative(process.cwd(), file)} → ${match[1]}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

/**
 * 静态色块不许拿「按下态」色当填充。
 *
 * `--app-surface-hover` / `--app-surface-active` 是**相对所在面的交互态**
 * （hover 加深、按下更深），不是色阶里的一档。拿它们做常驻填充会连出两个后果：
 *   1. 常驻块直接跳过全站色阶 —— cream 下 `surface-active` 是 **1.20**，而同主题
 *      最重的常驻弱底 `--app-primary-weak` 才 1.13、凹槽 `--app-surface-alt` 只有
 *      1.05（数值依据见下一条用例）。大面积铺开后整屏比别的界面重一档 ——
 *      真机反馈就是行囊「已展开的模块行」那一块深棕。
 *   2. 中性加深在暖色主题下会变成浑浊的棕黄：没有语义，只剩重量。
 *
 * 规矩：**静态中性底按基面取差一档的 token**——贴在 `--app-surface` 上的槽走
 * `--app-surface-alt`（状态条 / 书架的进度条轨道即此类）；贴在浮层
 * `--app-surface-elevated` 上的槽走 `--app-surface`；只有贴在页面底 `--app-bg`
 * 上的槽才走 `--app-surface-hover`（alt 与 bg 近乎同色会消失）。
 * `--app-surface-active` 只允许出现在交互态 ——
 * 最近的祖先选择器带 `:hover / :active / :focus`，或属性名本身就叫
 * `--ant-*-hover-bg` / `*-active-bg`。
 *
 * 禁用态（`--ant-button-default-bg-disabled`）算常驻，一并受管：禁用应该更**弱**，
 * 而不是更深。
 */
describe("静态色块不用按下态色（--app-surface-active 只留给交互态）", () => {
  /** 声明所在块的「最近祖先选择器头」：往上找第一个让花括号净深度转正的行 */
  const enclosingHead = (lines: string[], from: number): string => {
    let depth = 0;
    for (let i = from - 1; i >= 0; i -= 1) {
      depth += (lines[i].match(/\{/g)?.length ?? 0) - (lines[i].match(/\}/g)?.length ?? 0);
      if (depth > 0) return lines[i].split("{")[0].trim();
    }
    return "";
  };

  const INTERACTIVE_SELECTOR = /:hover|:active|:focus/;
  /** 属性名自带状态后缀：`--ant-button-default-hover-bg` 这类本身就是交互态声明 */
  const INTERACTIVE_PROP = /--?[a-z-]*(hover|active)/i;

  it("没有任何常驻填充引用 --app-surface-active", () => {
    const files = collectScssFiles(SRC_ROOT);
    // 扫不到文件说明路径写错，别让它静默通过
    expect(files.length).toBeGreaterThan(20);

    const offenders: string[] = [];
    let interactiveUses = 0;
    for (const file of files) {
      const lines = stripCommentsKeepLines(readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, index) => {
        if (!line.includes("var(--app-surface-active)")) return;
        const prop = line.split(":")[0].trim();
        const head = enclosingHead(lines, index);
        if (INTERACTIVE_SELECTOR.test(head) || INTERACTIVE_PROP.test(prop)) {
          interactiveUses += 1;
          return;
        }
        offenders.push(
          `${path.relative(process.cwd(), file)}:${index + 1} → ${prop}` +
            `（所在选择器 ${head || "?"} 不是交互态，静态中性底请用 --app-surface-alt）`,
        );
      });
    }

    expect(offenders).toEqual([]);
    // 反向自证：token 仍在被真实使用 —— 否则「零违规」可能只是因为全仓没人用它
    expect(interactiveUses).toBeGreaterThan(3);
  });

  it("数值依据：浅色主题下 surface-active 确实落在常驻色阶之外", () => {
    // 三个浅色主题的常驻弱底阶梯：surface-alt → surface-hover → primary-weak，
    // surface-active 必须严格高于最重的 primary-weak，才配得上「不在色阶里」这条结论。
    // 暗色主题不参与：暗底需要更大的亮度差才可感知，hover/active 天然更重。
    for (const theme of ["aurora", "cream", "mint"]) {
      const block = THEME_BLOCKS.get(theme) ?? "";
      expect(block.length).toBeGreaterThan(200);
      const surface = readVar(block, "app-surface");
      const heaviestStatic = ratio(readVar(block, "app-primary-weak"), surface);
      const pressed = ratio(readVar(block, "app-surface-active"), surface);
      expect(heaviestStatic).toBeLessThan(1.15);
      expect(pressed).toBeGreaterThan(heaviestStatic);
    }
  });

  /**
   * 「差多少档」取决于**基面**，不取决于 token —— 这条用数值钉住。
   *
   * 底色 token 全是绝对色：同一支 `--app-surface-alt` 贴内容面只差一档（1.03~1.05），
   * 贴纯白浮层就跨过 surface 一整层（1.06~1.09），比同屏兄弟块重一倍还丢色相。
   * 这就是「浮层里必须改用 --app-surface」的数值依据；反过来贴页面底 `--app-bg`
   * 又会几乎同色消失（1.01），故页面底的槽只能用 `--app-surface-hover`。
   */
  it("数值依据：alt 贴纯白浮层会跨过 surface 一整层，贴页面底则几乎消失", () => {
    for (const theme of ["aurora", "cream", "mint"]) {
      const block = THEME_BLOCKS.get(theme) ?? "";
      expect(block.length).toBeGreaterThan(200);
      const surface = readVar(block, "app-surface");
      const alt = readVar(block, "app-surface-alt");
      const elevated = readVar(block, "app-surface-elevated");
      const bg = readVar(block, "app-bg");

      const altOnSurface = ratio(alt, surface);
      // 贴内容面 = 正确的一档
      expect(altOnSurface).toBeLessThan(1.06);
      // 贴纯白浮层 = 跨层，明显更重（浮层里的槽应改用 surface）
      expect(ratio(alt, elevated)).toBeGreaterThan(altOnSurface + 0.02);
      // 浮层里的槽改用 surface 后，正好是一档
      expect(ratio(surface, elevated)).toBeLessThan(1.06);
      // 贴页面底会几乎同色消失（页面底的槽只能用 surface-hover）
      expect(ratio(alt, bg)).toBeLessThan(1.02);
    }
  });
});

/**
 * 色块阶梯的两条硬规矩（都由真机反馈逼出来）：
 *   1. 窗口 / 页面根不许铺 `--app-surface` —— 那是内容面。铺上去等于把「页面底」
 *      抬高一整档，之后每张卡片都少一档、只剩描边撑着（先例：行囊窗口 `.cpk`
 *      铺了 surface，导致 L1 模块 1.00、看板卡被迫借浮层 token）。
 *   2. `--app-surface-elevated` 是**浮层专用**。流内卡片借它会与同排卡片不同重量
 *      （先例：行囊看板卡）。全仓只有下面这张白名单里的文件（都是下拉 / 弹窗 /
 *      抽屉 / 悬浮卡 / portal 浮层）允许用它 —— 新增一处就会红，逼一次复核。
 */
describe("色块阶梯：页面根铺 bg、浮层底只给浮层用", () => {
  /** 取「最外层规则」的声明块：第一个 `{` 起、到同层 `}` 止之间的文本 */
  const firstTopLevelBlock = (source: string): string => {
    const lines = stripCommentsKeepLines(source).split("\n");
    let depth = 0;
    let started = false;
    const picked: string[] = [];
    for (const line of lines) {
      if (started && depth === 1) {
        picked.push(line);
        if (/^\s*\}/.test(line)) break;
      }
      if (!started && depth === 0 && line.includes("{")) started = true;
      depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
      if (started && depth === 0) break;
    }
    return picked.join("\n");
  };

  /** 取某个具体规则的声明块：从 `needle`（含 `{`）到配对的 `}` */
  const blockOf = (source: string, needle: string): string => {
    const clean = stripCommentsKeepLines(source);
    const from = clean.indexOf(needle);
    if (from < 0) return "";
    let depth = 0;
    for (let i = from; i < clean.length; i += 1) {
      if (clean[i] === "{") depth += 1;
      else if (clean[i] === "}") {
        depth -= 1;
        if (depth === 0) return clean.slice(from, i + 1);
      }
    }
    return "";
  };

  /** 允许铺 `--app-surface-elevated` 的文件：每一处都是浮层 */
  const ELEVATED_ALLOWED = new Set([
    "src/shared/components/CharacterPack/components/PackToast/index.scss", // 提示条
    "src/shared/components/CharacterPack/styles/pack-common.scss", // .cpk-dropdown
    "src/shared/components/ThemeSwitcher/index.scss", // 主题下拉
    "src/windows/BaseWindow/pages/LedgerPage/components/LedgerTrendChart/index.scss", // 图表气泡
    "src/windows/BaseWindow/pages/LedgerPage/components/QuickAddBar/index.scss", // 快捷记账浮层
    "src/windows/NovelWindow/pages/NovelPage/components/ChapterJumpPalette/index.scss", // 跳章面板
    "src/windows/NovelWindow/pages/NovelPage/components/ChapterTree/index.scss", // 拖拽随动 chip（portal）
    "src/windows/NovelWindow/pages/NovelPage/components/EntityContextMenu/index.scss", // 右键菜单
    "src/windows/NovelWindow/pages/NovelPage/components/HoverEntityCard/index.scss", // 悬浮卡
    "src/windows/NovelWindow/pages/NovelPage/components/PolishPreview/index.scss", // AI 润色预览浮层
    "src/windows/NovelWindow/pages/NovelPage/components/InspirationPanel/index.scss", // 灵感卡片 hover 操作条（浮在 surface 卡之上）
    "src/windows/NovelWindow/pages/NovelPage/components/SettingsDrawer/index.scss", // 排版抽屉
    "src/windows/NovelWindow/pages/NovelPage/components/SnapshotDrawer/index.scss", // 快照抽屉
    "src/windows/GlobalSettingWindow/components/GsRefsDrawer/index.scss", // 引用方名单抽屉
    // 关系图窗口：画布浮层工具条 / 节点卡 / 右侧详情卡都是「浮在画布之上」的一层
    "src/windows/RelationWindow/index.scss",
    "src/windows/RelationWindow/components/EntityNode/index.scss", // 画布节点卡
    "src/windows/RelationWindow/components/NodeDetailCard/index.scss", // 右侧详情卡
    "src/windows/RelationWindow/components/RelationCanvas/index.scss", // 画布工具条 / 缩放按钮
    "src/windows/RelationWindow/components/RelationCreateDialog/index.scss", // 新建关系确认弹层
    "src/windows/RelationWindow/components/EdgeDetailCard/index.scss", // 边详情卡
  ]);

  it("窗口 / 页面根一律铺 --app-bg（铺 surface 会把页面底抬高一档）", () => {
    // 页面骨架 + 行囊窗口内容根（后者的根不在 pages/ 下）
    const roots = [
      ...collectScssFiles(path.resolve(SRC_ROOT, "windows")).filter((f) =>
        /[\\/]pages[\\/][^\\/]+[\\/]index\.scss$/.test(f),
      ),
      path.resolve(SRC_ROOT, "shared/components/CharacterPack/index.scss"),
    ];
    // 反向自证：扫不到页面骨架说明路径规则写错了
    expect(roots.length).toBeGreaterThanOrEqual(8);

    const offenders: string[] = [];
    for (const file of roots) {
      const block = firstTopLevelBlock(readFileSync(file, "utf8"));
      expect(block.length).toBeGreaterThan(20);
      const match = /background(?:-color)?:\s*([^;]+);/.exec(block);
      // 不写也可以（窗口壳 window-shell.scss 已经铺了 bg），写了就必须是 bg
      if (match && !match[1].includes("var(--app-bg)")) {
        offenders.push(`${path.relative(process.cwd(), file)} → ${match[1].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("--app-surface-elevated 只出现在白名单里的浮层文件", () => {
    const files = collectScssFiles(SRC_ROOT);
    expect(files.length).toBeGreaterThan(20);

    const offenders: string[] = [];
    let usedFiles = 0;
    for (const file of files) {
      const source = stripComments(readFileSync(file, "utf8"));
      if (!/background(?:-color)?:[^;]*var\(--app-surface-elevated/.test(source)) continue;
      const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
      usedFiles += 1;
      if (!ELEVATED_ALLOWED.has(rel)) offenders.push(rel);
    }

    expect(offenders).toEqual([]);
    // 反向自证：白名单不能空转 —— 至少要有几个文件真的在用
    expect(usedFiles).toBeGreaterThan(5);
  });

  it("浮层（elevated 白底）里的槽位一律用 --app-surface，不借 alt / antd 出厂灰", () => {
    /** [文件, 规则开头（含 `{`）, 必须出现的声明] */
    const recesses: Array<[string, string, string[]]> = [
      // 设定中心弹窗里的「进位规则条」
      [
        "src/shared/components/SettingCenter/components/CategoryCard/index.scss",
        "&__carry {",
        ["background: var(--app-surface);"],
      ],
      // 行囊两个弹窗里的行 / 空态
      [
        "src/shared/components/CharacterPack/components/SourceDetailDrawer/index.scss",
        "&__row {",
        ["background: var(--app-surface);"],
      ],
      [
        "src/shared/components/CharacterPack/components/RecordDrawer/index.scss",
        "&__row {",
        ["background: var(--app-surface);"],
      ],
      [
        "src/shared/components/CharacterPack/components/RecordDrawer/index.scss",
        "&__empty {",
        ["background: var(--app-surface);"],
      ],
      [
        "src/shared/components/CharacterPack/components/CategoryManager/index.scss",
        ".cpk-catmgr__guide {",
        ["background: var(--app-surface);"],
      ],
      // 排版抽屉：antd 组件级槽位必须显式指回（出厂是黑透明 / colorBgLayout）
      [
        "src/windows/NovelWindow/pages/NovelPage/components/SettingsDrawer/index.scss",
        ".nv-setting {",
        [
          "--ant-slider-rail-bg: var(--app-surface);",
          "--ant-segmented-track-bg: var(--app-surface);",
        ],
      ],
    ];

    for (const [rel, needle, required] of recesses) {
      const block = blockOf(readFileSync(path.resolve(process.cwd(), rel), "utf8"), needle);
      expect(block, `${rel} 找不到规则 ${needle}`).not.toBe("");
      for (const decl of required) {
        expect(block, `${rel} 的 ${needle} 缺少 ${decl}`).toContain(decl);
      }
      // 反面：浮层里的槽不许再退回「相对内容面」的 alt 档。
      // 只看该规则**自身**的声明 —— 嵌套子规则（如 SourceDetailDrawer 的
      // `&.is-base`，那是 surface 上的 alt，属合法的一档）不在检查范围内。
      const own = block
        .split("\n")
        .reduce<{ depth: number; out: string[] }>(
          (acc, line) => {
            if (acc.depth <= 1) acc.out.push(line);
            acc.depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
            return acc;
          },
          { depth: 0, out: [] },
        )
        .out.join("\n");
      expect(own, `${rel} 的 ${needle} 不该用 alt`).not.toContain(
        "background: var(--app-surface-alt)",
      );
    }
  });

  it("antd 边框色与 --app-border 同步（缺省会落到中性灰 #d9d9d9）", () => {
    THEME_LIST.forEach((theme) => {
      const block = THEME_BLOCKS.get(theme.id) ?? "";
      expect(block.length).toBeGreaterThan(200);
      // --app-border-strong / -secondary 之类的兄弟变量不会误匹配（正则要求紧跟冒号）
      expect(theme.antd.colorBorder).toBe(readVar(block, "app-border"));
      expect(theme.antd.colorBorder).not.toBe("d9d9d9");
    });
  });

  it("ThemeAntdTokens 的每个字段都被 ThemeProvider 透传（防加了 token 忘接线）", () => {
    const provider = readFileSync(
      path.resolve(process.cwd(), "src/shared/theme/ThemeProvider.tsx"),
      "utf8",
    );
    const keys = Object.keys(THEME_LIST[0].antd);
    // 反向自证：token 表非空，否则本用例空转
    expect(keys.length).toBeGreaterThan(12);
    keys.forEach((key) => {
      expect(provider, `ThemeProvider 未透传 antd.${key}`).toContain(`antd.${key}`);
    });
  });
});

/**
 * 特定「常驻中性底」的回潮守卫（N-08，1.45.1）。
 *
 * `--app-surface-hover` 与 `--app-surface-active` 的本义都是**相对所在面的交互态**
 * （见上面「静态色块不用按下态色」的说明），但那条守卫只扫 `--app-surface-active`，
 * `--app-surface-hover` 一直没有红灯 —— 于是下面这 6 处常驻中性底误用了它：
 * 贴在 `--app-surface` 上的槽本该取 `--app-surface-alt`，浮层内的槽本该取
 * `--app-surface`，而 `--app-surface-hover` 一铺开就等于把整屏按「hover」压重一档。
 *
 * 这里用**显式文件 + 选择器清单**（不扫全仓，避免把合法的交互态 `:hover` 误伤）
 * 把 6 处逐一钉住：任一处改回 hover 档即红。断言落在**编译产物**上——BEM 的
 * `&__bar` 在源码里不是完整选择器，只搜文本会漏（同 novel-ui-kit.test.ts 的做法）。
 *
 * ── 复核后**判定为合法、刻意不纳入清单**的常驻底（免得下一轮又当缺口翻出来）──
 *
 * 判据不是「用了 hover 档就是错」，而是**相对它真正贴着的那一面的档位差**：
 * - `NovelTopBar/index.scss` 的 `&__icon.ant-btn` `--ant-button-default-bg`：
 *   顶栏底 `--app-header-bg` 与 `--app-surface` 同值，若取 `--app-surface-alt`
 *   差的只有 1.027~1.052（四主题实测），六颗图标又会退回「扫过去一团灰点」——
 *   正是 1.42.0 要修的问题。此处取 hover 档（1.081~1.216）是**有意决策**，
 *   且已被上面「顶栏 chip 底色三档」用例钉死。
 * - 分段轨道 / 加载骨架一类**落在 `--app-surface-alt` 基面上的凹槽**：
 *   `.nv-panel`（SupportPanel/index.scss:32）本身就是 alt 档，所以
 *   `NvSegmented/index.scss` 的 `--ant-segmented-track-bg`（右栏五 Tab 与
 *   所有子分段共用）、`SearchPanel/index.scss` 的骨架条(:48)、
 *   `EntityDetail/index.scss` 的 `&__tag`(:277) 取 hover 档恰好是「比基面再深
 *   一档」的凹槽，方向正确。反之它们若改用 `--app-surface-alt` 会与基面同色而消失。
 */
describe("常驻中性底：槽位不借交互态 token（N-08 精确清单）", () => {
  /** 花括号配平取规则块体（块内可能嵌着 `&.is-*` 子规则） */
  const ruleBlock = (css: string, selector: string) => {
    const at = css.indexOf(`${selector} {`);
    expect(at, `缺少规则 ${selector}`).toBeGreaterThan(-1);
    const open = css.indexOf("{", at);
    let depth = 0;
    let end = open;
    for (; end < css.length; end += 1) {
      if (css[end] === "{") depth += 1;
      else if (css[end] === "}" && --depth === 0) break;
    }
    return css.slice(open + 1, end);
  };

  /** 取规则块内最后一条 `background:` 声明（不吃 `background-color` / `-image`） */
  const bgOf = (block: string) => {
    const matches = [...block.matchAll(/(?:^|[\s;])background:\s*([^;]+);/g)];
    return matches.at(-1)?.[1]?.trim() ?? "";
  };

  /** [文件, 编译后选择器, 期望 background]；每条的「最近画底祖先」写在上面 */
  const cases: Array<[string, string, string]> = [
    // 基面 .settings-section（index.scss:37 = surface）→ 标题条取 alt
    ["src/windows/SettingsWindow/index.scss", ".settings-section__title", "var(--app-surface-alt)"],
    // 基面 .memo-editor-card .ant-card-body（MemoPage/index.scss:40 = surface）→ 斑马纹取 alt（与同表 th 统一）
    [
      "src/windows/BaseWindow/pages/MemoPage/components/MemoPreview/index.scss",
      ".memo-preview table tr:nth-child(even)",
      "var(--app-surface-alt)",
    ],
    // 基面 .nv-pop（HoverEntityCard/index.scss:11 = elevated 浮层）→ 标签取 surface
    [
      "src/windows/NovelWindow/pages/NovelPage/components/HoverEntityCard/index.scss",
      ".nv-pop__tag",
      "var(--app-surface)",
    ],
    // 基面 .nv-status（StatusBar/index.scss:15 = surface）→ 进度槽取 alt
    [
      "src/windows/NovelWindow/pages/NovelPage/components/StatusBar/index.scss",
      ".nv-status__bar",
      "var(--app-surface-alt)",
    ],
    // 基面 .bs-hero（ContinueHero/index.scss:7 = surface）→ 进度槽取 alt
    [
      "src/windows/NovelWindow/pages/BookshelfPage/components/ContinueHero/index.scss",
      ".bs-hero__bar",
      "var(--app-surface-alt)",
    ],
    // 基面 .nv-tools__card.ant-btn.is-planned（ToolLauncher/index.scss:64 = alt）→ 状态 chip 取 surface
    [
      "src/windows/NovelWindow/pages/NovelPage/components/SupportPanel/components/ToolLauncher/index.scss",
      ".nv-tools__state",
      "var(--app-surface)",
    ],
  ];

  it("6 处常驻中性底都取到与基面差一档的 token，且不含 hover / active 档", () => {
    expect(cases.length).toBe(6);
    for (const [rel, selector, expected] of cases) {
      const css = sass
        .compile(path.resolve(process.cwd(), rel), { style: "expanded" })
        .css.replace(/\/\*[\s\S]*?\*\//g, "");
      const got = bgOf(ruleBlock(css, selector));
      expect(got, `${rel} ${selector} 的 background 应为 ${expected}`).toBe(expected);
      // 反面：不许退回相对所在面的交互态 token
      expect(got).not.toContain("--app-surface-hover");
      expect(got).not.toContain("--app-surface-active");
    }
  });
});

