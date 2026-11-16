import { describe, expect, it } from "vitest";
import {
  parseInlineTokens,
  splitAnswerBlocks,
  stripInlineMarkup,
} from "./interview-answer-utils";

describe("splitAnswerBlocks", () => {
  it("纯文本答案只有一个文本块", () => {
    const blocks = splitAnswerBlocks("要点一\n要点二");
    expect(blocks).toEqual([{ kind: "text", lines: ["要点一", "要点二"] }]);
  });

  it("识别代码块并带出语言标记", () => {
    const blocks = splitAnswerBlocks("先看实现：\n```ts\nconst a = 1;\n```\n再解释");
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ kind: "text", lines: ["先看实现："] });
    expect(blocks[1]).toEqual({ kind: "code", lang: "ts", code: "const a = 1;" });
    expect(blocks[2]).toEqual({ kind: "text", lines: ["再解释"] });
  });

  it("代码块内的 ``` 之外的空行被保留，文本块首尾空行被裁掉", () => {
    const blocks = splitAnswerBlocks("\n\n第一段\n\n第二段\n\n");
    expect(blocks).toEqual([{ kind: "text", lines: ["第一段", "", "第二段"] }]);
  });

  it("未闭合的围栏按代码块收尾（不漏内容）", () => {
    const blocks = splitAnswerBlocks("说明\n```js\nconsole.log(1);");
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toEqual({ kind: "code", lang: "js", code: "console.log(1);" });
  });

  it("兼容 CRLF 换行", () => {
    const blocks = splitAnswerBlocks("A\r\n```js\r\nrun();\r\n```\r\nB");
    expect(blocks[1]).toEqual({ kind: "code", lang: "js", code: "run();" });
    expect(blocks[2]).toEqual({ kind: "text", lines: ["B"] });
  });

  it("空答案返回空数组", () => {
    expect(splitAnswerBlocks("")).toEqual([]);
    expect(splitAnswerBlocks("   \n  ")).toEqual([]);
  });
});

describe("parseInlineTokens", () => {
  it("识别加粗与行内代码", () => {
    expect(parseInlineTokens("用 **Fiber** 表示 `task`")).toEqual([
      { kind: "text", text: "用 " },
      { kind: "strong", text: "Fiber" },
      { kind: "text", text: " 表示 " },
      { kind: "code", text: "task" },
    ]);
  });

  it("落单的记号原样保留，不吞后文", () => {
    const tokens = parseInlineTokens("2 ** 3 与 ` 单独");
    expect(tokens.map((token) => token.text).join("")).toBe("2 ** 3 与 ` 单独");
  });

  it("空行返回空数组", () => {
    expect(parseInlineTokens("")).toEqual([]);
  });
});

describe("stripInlineMarkup", () => {
  it("去掉加粗与行内代码记号", () => {
    expect(stripInlineMarkup("**重点**：看 `render` 阶段")).toBe("重点：看 render 阶段");
  });
});
