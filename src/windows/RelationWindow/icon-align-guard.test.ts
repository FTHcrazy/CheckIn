/**
 * 纯图标按钮的对齐守卫（R27 视觉回归）
 *
 * `@include widget.ant-button-reset` 会把 antd 的 `justify-content: center` 改成
 * `normal`（= flex-start，整行文字要左贴）。纯图标按钮**必须自己补回 center**，
 * 否则 14px 的图标会贴在 24px 盒子的左沿、右侧空出 10px —— hover 时表现为
 * 「背景相对图标整体右偏」（真机报过：要素池行尾的上图 / 移出按钮）。
 *
 * 另一半坑是 hover 背景的清零：antd 会在 `.ant-btn-color-default.ant-btn-variant-text`
 * （0,2,0）上重新声明 `--ant-btn-bg-color-hover`，与 `.rel-xxx.ant-btn`（0,2,0）
 * 同特异性 —— 谁后注入谁赢。所以清零必须挂在**祖先类**上抬到 (0,3,0)，
 * 写在同级选择器里会时灵时不灵（图标区多出一块与行高亮不同色的圆角块）。
 *
 * 纯文本断言：jsdom 不加载 scss、量不出布局，只能把这两条写法约定钉住。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/** 取某个选择器的声明块（要求选择器独占行首，避免匹配到带祖先类的那条） */
function readBlock(relativePath: string, selector: string): string {
  const source = readFileSync(path.resolve(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped}\\s*\\{`, "m").exec(source);
  expect(match, `${relativePath} 里找不到选择器 ${selector}`).not.toBeNull();
  const start = match?.index ?? 0;
  const end = source.indexOf("\n}", start);
  expect(end, `${selector} 的声明块没有闭合`).toBeGreaterThan(start);
  return source.slice(start, end);
}

const ICON_BUTTONS = [
  {
    file: "src/windows/RelationWindow/components/EntityPool/components/PoolRow/index.scss",
    selector: ".rel-pool__act.ant-btn",
    why: "要素池行尾的上图 / 移出按钮",
  },
  {
    file: "src/windows/RelationWindow/components/EdgeDetailCard/index.scss",
    selector: ".rel-edge__close.ant-btn",
    why: "关系详情卡关闭按钮",
  },
  {
    file: "src/windows/RelationWindow/components/NodeDetailCard/index.scss",
    selector: ".rel-card__close.ant-btn",
    why: "节点详情卡关闭按钮",
  },
] as const;

describe("RelationWindow：纯图标按钮的清零后对齐", () => {
  for (const { file, selector, why } of ICON_BUTTONS) {
    it(`${why}：清零后自己补 justify-content: center`, () => {
      expect(readBlock(file, selector)).toContain("justify-content: center");
    });
  }

  it("池子行尾按钮的 hover 背景清零在祖先类上（同级声明压不过 antd 的 variant 规则）", () => {
    const file = "src/windows/RelationWindow/components/EntityPool/components/PoolRow/index.scss";
    expect(readBlock(file, ".rel-pool__row .rel-pool__act.ant-btn")).toContain(
      "--ant-btn-bg-color-hover: transparent",
    );
    // 同级选择器里不许再留一份（留着就是「看着清零了、实际被 antd 反超」的假象）
    expect(readBlock(file, ".rel-pool__act.ant-btn")).not.toContain("--ant-btn-bg-color-hover");
  });
});
