/// <reference types="node" />
import { readFileSync } from "node:fs";
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
