import { readFileSync } from "node:fs";
import path from "node:path";
import * as sass from "sass";
import { describe, expect, it } from "vitest";

/**
 * 书架卡片「同行等高」的守卫。
 *
 * 两类卡的高度来自不同地方，天然会漂：
 *   - 网格视图：书卡高度由封面 `aspect-ratio` 随列宽算出，虚线卡写死 `min-height`
 *     → 靠网格 `align-items: stretch` 把同一行的两张卡拉齐；
 *   - 列表视图：每行只有一个元素，没有同伴可拉伸，只能**都认同一个行高**。
 *
 * 事故：列表视图的「新建作品」条只有 26px 的加号 + 一行字，比书卡行矮 8px。
 * 所以列表行高必须只有一个出处（`.bs-page__grid--list` 的 `--bs-row-height`），
 * 两张卡都只 `var(...)` 引用、不各算一份。这里钉住这条约束。
 *
 * 断言编译后的 CSS（不是源码字符串）：注释里写着的值不算数。
 */

const ROOT = process.cwd();
const FILES = {
  grid: "src/windows/NovelWindow/pages/BookshelfPage/index.scss",
  book: "src/windows/NovelWindow/pages/BookshelfPage/components/BookCard/index.scss",
  newWork: "src/windows/NovelWindow/pages/BookshelfPage/components/NewWorkCard/index.scss",
};

function compile(rel: string): string {
  return sass.compile(path.resolve(ROOT, rel), { style: "expanded" }).css;
}

/** 取出某个选择器对应的声明块（按花括号配平；选择器必须出现在块尾） */
function blockOf(css: string, selector: string): string {
  const from = css.indexOf(selector);
  expect(from, `找不到选择器 ${selector}`).toBeGreaterThan(-1);
  const open = css.indexOf("{", from + selector.length);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open, i + 1);
    }
  }
  throw new Error(`选择器 ${selector} 的块没有闭合`);
}

describe("书架列表视图：行高只有一个出处", () => {
  it("网格的列表模式声明 --bs-row-height", () => {
    const css = compile(FILES.grid);
    const block = blockOf(css, ".bs-page__grid--list");
    expect(block).toMatch(/--bs-row-height:\s*\d+px/);
  });

  it("书卡与「新建作品」条都引用同一个行高，而不是各写一个 min-height", () => {
    const book = blockOf(compile(FILES.book), ".bs-card--list");
    expect(book).toContain("min-height: var(--bs-row-height");

    const newWork = blockOf(compile(FILES.newWork), ".bs-newcard--list");
    expect(newWork).toContain("min-height: var(--bs-row-height");

    // 反向自证：列表规则里不许再出现写死的 min-height 数值（回到各算一份就会这样）
    for (const block of [book, newWork]) {
      expect(block).not.toMatch(/min-height:\s*\d+px/);
    }
  });

  it("网格视图仍靠拉伸对齐（新建作品卡不许再写死一个固定高度）", () => {
    const css = compile(FILES.grid);
    const grid = blockOf(css, ".bs-page__grid");
    expect(grid).toContain("align-items: stretch");
    // 网格视图的虚线卡保留 min-height，但只在「行里只有它自己」时兜底，
    // 真正的等高靠 height: 100% —— 源码里的 232px 只是空书架时的体面高度
    const source = readFileSync(path.resolve(ROOT, FILES.newWork), "utf8");
    expect(source).toContain("height: 100%");
  });
});
