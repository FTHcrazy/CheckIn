import path from "node:path";
import * as sass from "sass";
import { describe, expect, it } from "vitest";

/**
 * 查找浮层「跟着视口、不跟着正文」的守卫。
 *
 * 事故（2.36.2）：浮层写成 `position: absolute; inset: 0 0 auto 0`。绝对定位的
 * 参照物是最近的**定位祖先**，而 CodeMirror 给 `.cm-editor` 上了
 * `position: relative !important`——于是浮层钉在「整篇文档的顶端」，而不是
 * 「编辑区视口的顶端」。点搜索结果跳转（滚动 `.nv-editor__scroll`）时，浮层
 * 跟着正文一起滚出视野（实测滚动 600px，浮层正好上移 600px）。
 *
 * 正解是两件事同时成立，缺一不可：
 *   ① 容器留在 `position: sticky`（CodeMirror 的默认定位，参照「最近的滚动
 *      祖先」= `.nv-editor__scroll`）→ 跳到命中处也不被滚走；
 *   ② 又不许占排版（sticky 仍在普通流里，一打开会把正文顶下去一行）→ 容器收成
 *      `height: 0` + `overflow: visible`，卡片自己绝对定位到这条零高度线上。
 *
 * 事故（2.36.4）：sticky 的「静态位置」由祖先的内边距决定，纸面层顶部的 8px
 * 内边距让卡片起点比钉住位置低 8px —— 开始滚动的那 8px 里卡片一路往上滑
 * （实测 top 18px → 10px），肉眼看就是「滚动一开始浮层抖一下」。修法是把这段
 * 留白挪进内容层（.cm-content 的 padding-top），纸面顶部内边距归零。
 *
 * 这里钉编译后的 CSS（不搜源码字符串：注释里恰好写着这些词，会假红）。
 */

const ROOT = process.cwd();
const SCSS = "src/windows/NovelWindow/pages/NovelPage/components/EditorPane/index.scss";

function compile(): string {
  return sass.compile(path.resolve(ROOT, SCSS), { style: "expanded" }).css;
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

describe("章节内查找浮层：钉在视口上，不跟正文滚走", () => {
  it("面板容器必须是 sticky（改成 absolute 就会被 `.cm-editor` 的 relative 吃掉）", () => {
    const panels = blockOf(compile(), ".nv-editor__host .cm-panels.cm-panels-top");
    expect(panels).toMatch(/position:\s*sticky/);
    expect(panels).toMatch(/top:\s*0/);
    // 反向自证：绝对定位正是那个 bug 的写法
    expect(panels).not.toMatch(/position:\s*absolute/);
    expect(panels).not.toMatch(/inset:/);
  });

  it("容器不占排版：零高度 + 不裁剪，卡片浮在正文之上", () => {
    const css = compile();
    const panels = blockOf(css, ".nv-editor__host .cm-panels.cm-panels-top");
    // sticky 仍在普通流里，不压成 0 高度就会把正文顶下去一行
    expect(panels).toMatch(/height:\s*0;/);
    expect(panels).toMatch(/overflow:\s*visible/);
    // flex 子项默认 min-height: auto 会把 0 高度撑回去
    expect(panels).toMatch(/flex:\s*none/);
    // 卡片以外的空白要透给正文
    expect(panels).toMatch(/pointer-events:\s*none/);

    const card = blockOf(css, ".nv-editor__host .nv-find");
    // 卡片自己绝对定位到那条零高度 sticky 线上（sticky 也算定位元素）
    expect(card).toMatch(/position:\s*absolute/);
    expect(card).toMatch(/top:\s*10px/);
    expect(card).toMatch(/pointer-events:\s*auto/);
  });

  it("纸面顶部不许有内边距：sticky 的静态位置必须等于钉住位置", () => {
    const paper = blockOf(compile(), ".nv-editor__paper");
    // 顶部内边距记 0（首行留白由 .cm-content 的 padding-top 承担）
    expect(paper).toMatch(/padding:\s*0\s/);
    // 反向自证：顶部一旦有正的内边距，滚动初期卡片就会一路滑上去
    expect(paper).not.toMatch(/padding:\s*(?!0\s)[1-9]\d*px/);
  });

  it("横向贴编辑区视口右缘，而不是缩在纸面栏里", () => {
    const css = compile();
    const card = blockOf(css, ".nv-editor__host .nv-find");
    // sticky 容器只有纸面栏宽，靠容器查询单位把居中留白补回去
    expect(card).toMatch(/right:\s*calc\([^)]*100cqw/);
    // cqw 全靠 `.nv-editor` 自己是容器；丢了这行浮层会跑到纸面栏外算错。
    // Sass 会把同一个选择器的声明拆成多段（嵌套规则切开），所以按块逐个找。
    const hasContainer = [...css.matchAll(/\.nv-editor\s*\{([^}]*)\}/g)].some((match) =>
      /container-type:\s*inline-size/.test(match[1]),
    );
    expect(hasContainer).toBe(true);
  });
});
