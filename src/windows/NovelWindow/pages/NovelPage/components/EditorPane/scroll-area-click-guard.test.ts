import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 「点查找面板的上一个 / 下一个，被当成点正文下方空白区」的守卫。
 *
 * 事故：`.nv-editor__scroll` 挂着 handleScrollAreaClick —— 正文只占文档实际
 * 高度，点在其下方时命中的是容器本身，这里兜底 `posAtCoords` 把光标放上去。
 * 它靠 `target instanceof HTMLElement` 排除正文 / 面板，而查找面板的导航按钮里
 * 是 SVG 图标：点到箭头时 `event.target` 是 SVGPathElement，属于 Element 却**不**
 * 属于 HTMLElement → 排除判断整段落空 → 按钮 click 冒泡到这里被当成点空白区，
 * `dispatch({ selection })` 把刚跳过去的选区又抢回原处。
 *
 * 于是「下一个」看着像没反应、计数与高亮跳着走；点在按钮 padding（HTMLElement）
 * 上又一切正常，时好时坏。修法是判定改用 `Element`，并把 `.nv-find` 显式列进
 * 排除选择器（面板脱离 .cm-panels 挂载时也能兜住）。
 *
 * 为什么钉源码：EditorPane 是 CodeMirror 宿主，jsdom 没有真实布局，
 * `posAtCoords` 量不到坐标，组件级测试观测不到这条冒泡路径
 * （同 scroll-reset-guard.test.ts 的取舍）。
 */

const root = resolve(__dirname, "../../../../../../..");
const EDITOR = readFileSync(
  resolve(
    root,
    "src/windows/NovelWindow/pages/NovelPage/components/EditorPane/index.tsx",
  ),
  "utf8",
).replace(/\r\n/g, "\n");

/** 取出 handleScrollAreaClick 的函数体（到下一个 `};` 为止） */
function handlerBody(): string {
  const start = EDITOR.indexOf("const handleScrollAreaClick");
  expect(start, "找不到 handleScrollAreaClick").toBeGreaterThan(-1);
  const end = EDITOR.indexOf("\n  };", start);
  expect(end, "handleScrollAreaClick 没有闭合").toBeGreaterThan(start);
  return EDITOR.slice(start, end);
}

describe("查找面板导航按钮不被当成点正文空白区", () => {
  it("根因事实：SVG 图标是 Element、但不是 HTMLElement", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svg.appendChild(path);
    expect(path instanceof Element).toBe(true);
    expect(path instanceof HTMLElement).toBe(false);

    // SVG 元素同样能用 closest；Element 判定下按钮点击才能一路找到面板容器
    const panels = document.createElement("div");
    panels.className = "cm-panels";
    panels.appendChild(svg);
    expect(path.closest(".cm-panels")).toBe(panels);
  });

  it("排除判定用 Element，不许退回 HTMLElement", () => {
    const body = handlerBody();
    // 只钉类型字面量，不钉整行（格式化可能拆行）
    expect(body).toMatch(/instanceof\s+Element/);
    expect(body).not.toMatch(/instanceof\s+HTMLElement/);
  });

  it("排除选择器同时含 cm-content / cm-panels / nv-find", () => {
    const body = handlerBody();
    // 取 closest(...) 调用本身，避开注释里也提到的这些词
    const closestAt = body.indexOf("target.closest(");
    expect(closestAt, "找不到 target.closest").toBeGreaterThan(-1);
    const call = body.slice(closestAt, body.indexOf(")", closestAt) + 1);
    expect(call).toContain(".cm-content");
    expect(call).toContain(".cm-panels");
    expect(call).toContain(".nv-find");
  });
});
