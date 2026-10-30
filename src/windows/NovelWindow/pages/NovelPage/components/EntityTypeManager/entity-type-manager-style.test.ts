import { describe, expect, it } from "vitest";
import * as sass from "sass";
import { resolve } from "node:path";

/**
 * 自定义要素类型弹框的取色控件样式守卫（R23）。
 *
 * 钉死的契约：**列表行里的圆点是一个 14px 的圆形可点按钮**。
 *
 * 为什么只能钉编译产物：`.nv-etm__dot` 是 antd Button，尺寸与圆角全靠
 * 组件级变量（`--ant-control-height` / `--ant-border-radius`）表达；
 * 而 `@include widget.ant-button-reset` 会把这些变量全部归零，
 * **覆盖必须写在该 mixin 之后**，且要靠「同规则内后声明胜出」生效。
 * 一旦有人把 `@include` 挪到覆盖之后，或删掉 `--ant-border-radius: 50%`，
 * 圆点就会退化成 antd 默认的圆角矩形 —— 只读源码很难看出这一点，
 * 编译后按「最后一次声明胜出」取值才看得准。
 *
 * 同 `pack-ui-kit.test.ts` 的手法：编译 SCSS 断言 CSS 产出。
 */

const css = sass.compile(
  resolve(
    __dirname,
    "index.scss",
  ),
  { loadPaths: [resolve(__dirname, "../../../../../../")] },
).css;

/**
 * 取某个选择器所在的顶层规则块，并按 CSS 语义归并「同属性后声明覆盖前声明」。
 *
 * 不能用 `/@include/` 那种简单切片：mixin 展开后的块里同一属性出现两次
 * （先归零、后覆盖），必须按 DOM 顺序取最后一次。
 * 块尾用花括号配平来找，不能用 `indexOf("}")` —— 块内嵌了 `color-mix(...)`。
 */
function effectiveDecls(selector: string): Record<string, string> {
  const at = css.indexOf(selector);
  expect(at, `编译产物里找不到选择器 ${selector}`).toBeGreaterThan(-1);

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

  const block = css.slice(at, end + 1);
  const decls: Record<string, string> = {};
  for (const raw of block.split("\n")) {
    const line = raw.trim().replace(/;$/, "");
    if (!line || line.startsWith("/*") || line.startsWith("*")) continue;
    const matched = /^(--[\w-]+|[a-z-]+)\s*:\s*(.+)$/.exec(line);
    if (matched) decls[matched[1]] = matched[2].trim();
  }
  return decls;
}

describe("EntityTypeManager 取色控件样式", () => {
  it("圆点是圆形（覆盖写在 ant-button-reset 之后，归零值不许反超）", () => {
    const dot = effectiveDecls(".nv-etm__dot.ant-btn");
    expect(dot["--ant-border-radius"]).toBe("50%");
  });

  it("圆点有确定的 14×14 尺寸，不靠内容撑开", () => {
    const dot = effectiveDecls(".nv-etm__dot.ant-btn");
    expect(dot["--ant-control-height"]).toBe("14px");
    expect(dot.width).toBe("14px");
    expect(dot.height).toBe("14px");
    // 行是 flex，不加 min-width 会被 flex 压缩成椭圆
    expect(dot["min-width"]).toBe("14px");
  });

  it("圆点看起来可点（有描边 + 指针）", () => {
    const dot = effectiveDecls(".nv-etm__dot.ant-btn");
    expect(dot["--ant-line-width"]).toBe("1px");
    expect(dot["--ant-button-default-border-color"]).toContain("color-mix");
    expect(dot.cursor).toBe("pointer");
  });

  it("取色触发器容器不额外占宽（ColorPicker 的 root 会撑开行）", () => {
    const pick = effectiveDecls(".nv-etm__pick.ant-color-picker-trigger, .nv-etm__pick");
    expect(pick["flex"]).toBe("none");
    expect(pick.width).toBe("auto");
  });

  it("旧的固定色板样式已彻底移除（取色改走 ColorPicker）", () => {
    expect(css).not.toContain(".nv-etm__palette");
    expect(css).not.toContain(".nv-etm__swatch");
  });
});
