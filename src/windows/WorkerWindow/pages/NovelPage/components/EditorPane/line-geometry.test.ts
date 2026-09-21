import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * EditorPane 样式契约（CodeMirror 几何约束，1.9.4 修复的防回归）
 *
 * 背景：正文段距曾用 `.cm-line { margin-bottom }` 实现，而 CodeMirror 6
 * 的行高测量（heightMap）不含 margin——「文档位置估算 ↔ DOM 实际位置」
 * 的偏差随行数线性累积，表现为文档开头选中/点击正常、滚动到下方后
 * 选中高亮 / 点击落点 / 光标错位。段距必须走 padding-bottom（计入
 * border-box 高度，被测量捕获）。
 */

// vitest 4 的模块转换层里 import.meta.url 不是 file: 协议，用项目根相对路径
const scss = readFileSync(
  resolve(
    process.cwd(),
    "src/windows/WorkerWindow/pages/NovelPage/components/EditorPane/index.scss",
  ),
  "utf8",
);

/** 提取 &__host 内唯一的 .cm-line 规则块 */
function cmLineBlock(): string {
  const match = scss.match(/\.cm-line\s*\{([^}]*)\}/);
  if (!match) {
    throw new Error("index.scss 中找不到 .cm-line 规则块");
  }
  return match[1];
}

describe("EditorPane 样式契约（CodeMirror 几何约束）", () => {
  it("cm-line 禁止垂直 margin（heightMap 不含 margin，会累积选区/点击偏移）", () => {
    const block = cmLineBlock();
    expect(block).not.toMatch(/margin-(top|bottom)\s*:/);
  });

  it("段距必须用 padding-bottom 承载（--nv-paragraph-spacing）", () => {
    const block = cmLineBlock();
    expect(block).toMatch(
      /padding-bottom:\s*var\(--nv-paragraph-spacing/,
    );
  });
});
