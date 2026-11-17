import { describe, expect, it } from "vitest";
import { isTermCandidate, normalizeSelection } from "./useSelectionTerms";

/**
 * 划词的**判定口径**（纯函数部分）。
 *
 * 这两条规则决定「划一下会不会弹浮层」，是用户体感最直接的地方：
 * - 收得太松：选个标点、选半行代码都弹，浮层成了噪音；
 * - 收得太紧：正常的名词选不中，功能等于不存在。
 *
 * 拖选事件本身（pointerdown / pointerup / rAF 读取）在 jsdom 里拿不到真实的
 * 选区矩形，只能靠手工验证，所以这里把可单测的那一半钉死。
 */
describe("normalizeSelection", () => {
  it("合并连续空白并去首尾空白", () => {
    expect(normalizeSelection("  event   loop \n")).toBe("event loop");
  });

  it("去掉选中时顺手带上的标点", () => {
    expect(normalizeSelection("「事件循环」")).toBe("事件循环");
    expect(normalizeSelection("（闭包）")).toBe("闭包");
    expect(normalizeSelection("Fiber,")).toBe("Fiber");
  });

  it("只剥首尾：中间的连字符与斜杠要保留（如 JS/TS、micro-task）", () => {
    expect(normalizeSelection("micro-task")).toBe("micro-task");
    expect(normalizeSelection("JS/TS 区别")).toBe("JS/TS 区别");
  });
});

describe("isTermCandidate", () => {
  it("中文取 2–12 字", () => {
    expect(isTermCandidate("闭包")).toBe(true);
    expect(isTermCandidate("事")).toBe(false);
    expect(isTermCandidate("事件循环里的微任务队列与宏任务队列的区别")).toBe(false);
    expect(isTermCandidate("事件循环")).toBe(true);
  });

  it("ASCII 取 3–24 字符", () => {
    expect(isTermCandidate("map")).toBe(true);
    expect(isTermCandidate("js")).toBe(false);
    expect(isTermCandidate("structuredClone")).toBe(true);
  });

  it("含换行的选区一律不收（跨行选中的是段落，不是名词）", () => {
    expect(isTermCandidate("事件\n循环")).toBe(false);
  });

  it("空串与纯空白不收", () => {
    expect(isTermCandidate("")).toBe(false);
    expect(isTermCandidate("   ")).toBe(false);
  });
});
