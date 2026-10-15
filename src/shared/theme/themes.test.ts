/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
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
  const stripComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  const collectScssFiles = (dir: string, acc: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!/node_modules|dist/.test(entry.name)) collectScssFiles(full, acc);
        continue;
      }
      if (entry.name.endsWith(".scss")) acc.push(full);
    }
    return acc;
  };

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

