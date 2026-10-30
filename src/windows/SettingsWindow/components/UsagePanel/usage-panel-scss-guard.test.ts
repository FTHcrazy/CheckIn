/**
 * REQ-064 守卫：intent 分布行的左右内边距必须与指标卡内文对齐。
 *
 * 缺陷形态是纯视觉的：`.settings-usage__row` 原先是 `padding: 8px 0`，而上方
 * `.settings-usage__metric` 是 `padding: 12px 14px` —— 于是分布行的标签左缘
 * 紧贴卡片边框、右侧「采纳 N」顶到边，看上去「这行缺边距」。
 *
 * jsdom 不做布局计算，量不出「看起来缺边距」，所以按项目既有手法**编译 SCSS
 * 再断言产出**：两处水平内边距必须相等（否则下一次改指标卡会再次错位，
 * 而错位只体现在肉眼上）。断言前先剥注释，块定位用「选择器 + `{`」。
 */
import * as sass from "sass";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SCSS_PATH = resolve(__dirname, "index.scss");

const css = sass
  .compile(SCSS_PATH, { loadPaths: [resolve(process.cwd(), "src")] })
  .css.replace(/\/\*[\s\S]*?\*\//g, "");

/** 取某选择器的声明块（按「选择器 + {」定位，块尾用花括号配平） */
function blockOf(selector: string): string {
  const pattern = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`,
  );
  const matched = pattern.exec(css);
  expect(matched, `编译产物里找不到规则 ${selector}`).not.toBeNull();
  const at = matched ? matched.index : 0;

  let depth = 0;
  let end = at;
  for (let i = at; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  return css.slice(at, end + 1);
}

/** 从声明块里取 padding 的左右值（`12px 14px` → 14px；`8px 14px 8px 14px` → 14px） */
function horizontalPaddingOf(block: string): string {
  const matched = /(?:^|[{;\s])padding:\s*([^;]+);/.exec(block);
  expect(matched, "找不到 padding 声明").not.toBeNull();
  const parts = (matched?.[1] ?? "").trim().split(/\s+/);
  // 1 值：四边同值；2 值：上下 / 左右；3 值：上 / 左右 / 下；4 值：上右下左
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[1];
  if (parts.length === 3) return parts[1];
  return parts[1];
}

describe("用量页 intent 分布行的左右边距（REQ-064）", () => {
  it("左右内边距与指标卡内文一致（对齐的唯一判据）", () => {
    const metric = horizontalPaddingOf(blockOf(".settings-usage__metric"));
    const row = horizontalPaddingOf(blockOf(".settings-usage__row"));
    expect(metric).toBe("14px");
    expect(row, "分布行与指标卡的水平内边距不一致 → 标签/次数贴边").toBe(metric);
  });

  it("反向断言：不许再是左右 0（那正是缺陷形态）", () => {
    const row = blockOf(".settings-usage__row");
    expect(row).not.toMatch(/padding:\s*8px\s+0\s*;/);
    expect(horizontalPaddingOf(row)).not.toBe("0");
  });

  it("行间分隔线保留，且末行不画（末行下方紧跟卡片下沿，多一条线像多出一行）", () => {
    const row = blockOf(".settings-usage__row");
    expect(row).toMatch(/border-bottom:\s*1px solid var\(--app-border\)/);
    // 末行规则必须是 border-bottom: none，不能靠 opacity / 白色线糊过去
    const lastChild = blockOf(".settings-usage__row:last-child");
    expect(lastChild).toMatch(/border-bottom:\s*none/);
  });

  it("列表顶部分隔线仍在（把指标区与分布区分开）", () => {
    expect(blockOf(".settings-usage__breakdown")).toMatch(
      /border-top:\s*1px solid var\(--app-border\)/,
    );
  });
});
