import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import AuditDrawer from "./index";
import type { InterviewQuestion } from "../../data/interview-types";
import type { AuditIssue } from "../../hooks/useInterviewAudit";

function makeQuestion(id: string, title: string): InterviewQuestion {
  return {
    id,
    title,
    stem: "题干",
    answer: "参考答案",
    track: "foundation",
    categoryId: "foundation-js",
    difficulty: "medium",
    tags: [],
    topic: "测试",
    reviewedAt: "2026-11",
    heat: 50,
    updatedAt: "2026-11-18",
  };
}

const QUESTIONS: InterviewQuestion[] = [
  makeQuestion("q-1", "什么是闭包"),
  makeQuestion("q-2", "事件循环的执行顺序"),
];

const ISSUES: AuditIssue[] = [
  {
    id: "q-1",
    severity: "high",
    issues: ["答案把闭包说成了「函数嵌套」", "漏了「即使外层已返回」这一点"],
    suggestion: "补上变量保留的原因，别说成函数嵌套。",
  },
  { id: "q-2", severity: "low", issues: [], suggestion: "补一个微任务与宏任务的例子。" },
];

/**
 * 质检面板。
 *
 * 盯三件事：① 结论按严重程度展示且「去改」把题交回去（不是自己写库）；
 * ② 「忽略」只从报告里移除；③ 没跑过 / 没发现问题时的空态文案要能区分。
 */
function renderDrawer(overrides: Partial<Parameters<typeof AuditDrawer>[0]> = {}) {
  const onRun = vi.fn();
  const onDiscard = vi.fn();
  const onEdit = vi.fn();
  const props: Parameters<typeof AuditDrawer>[0] = {
    open: true,
    pool: QUESTIONS,
    questionOf: (id) => QUESTIONS.find((item) => item.id === id),
    available: true,
    unavailableText: "",
    running: false,
    error: null,
    issues: ISSUES,
    usedFallback: false,
    auditedCount: 2,
    onRun,
    onDiscard,
    onEdit,
    onClose: () => {},
  };
  render(<AuditDrawer {...props} {...overrides} />);
  return { onRun, onDiscard, onEdit };
}

describe("AuditDrawer", () => {
  afterEach(() => {
    cleanup();
  });

  it("逐条展示问题、建议与严重程度", () => {
    renderDrawer();
    const items = document.querySelectorAll(".interview-audit__item");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("什么是闭包");
    expect(items[0].textContent).toContain("必改");
    expect(items[0].textContent).toContain("漏了「即使外层已返回」这一点");
    expect(items[0].textContent).toContain("补上变量保留的原因");
    expect(items[1].textContent).toContain("可选");
  });

  it("「去改」把整道题交回去（质检自己不写库）", () => {
    const { onEdit } = renderDrawer();
    fireEvent.click(document.querySelector(".interview-audit__edit") as HTMLElement);
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "q-1" }));
  });

  it("题目在库里已经找不到时不给「去改」（只留忽略）", () => {
    renderDrawer({ questionOf: () => undefined });
    expect(document.querySelector(".interview-audit__edit")).toBeNull();
    expect(document.querySelectorAll(".interview-audit__discard").length).toBe(2);
  });

  it("「忽略」按题目 id 报上去", () => {
    const { onDiscard } = renderDrawer();
    fireEvent.click(document.querySelector(".interview-audit__discard") as HTMLElement);
    expect(onDiscard).toHaveBeenCalledWith("q-1");
  });

  it("送检范围与上限写清楚（用户要知道审的是哪一批）", () => {
    renderDrawer({ pool: QUESTIONS, auditedCount: 0 });
    const scope = document.querySelector(".interview-audit__scope")?.textContent ?? "";
    expect(scope).toContain("前");
    expect(scope).toContain("2");
    expect(scope).toContain("上限 20 道");
  });

  it("没跑过 vs 跑过但干净：空态文案不同", () => {
    renderDrawer({ issues: [], auditedCount: 0 });
    expect(document.querySelector(".interview-audit__empty")?.textContent).toContain("还没有质检过");

    cleanup();
    renderDrawer({ issues: [], auditedCount: 5 });
    expect(document.querySelector(".interview-audit__empty")?.textContent).toContain(
      "没有发现明显问题",
    );
  });

  it("AI 不可用时按钮禁用并把原因摆在面板上", () => {
    renderDrawer({ available: false, unavailableText: "还没配置模型服务" });
    const button = document.querySelector(".interview-audit__run") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    // 原因写在可见的提示里，不是塞进禁用按钮的 title（禁用元素根本不派发鼠标事件，
    // 浏览器浮层不会出现 —— 那是「看起来有说明，其实看不到」）
    expect(document.querySelector(".interview-audit__notice")?.textContent).toContain(
      "还没配置模型服务",
    );
  });

  it("正在质检时给出进度，而不是落回「还没有质检过」", () => {
    renderDrawer({ running: true, issues: [], auditedCount: 0 });
    expect(document.querySelector(".interview-audit__running")?.textContent).toContain("正在核对");
    expect(document.querySelector(".interview-audit__empty")).toBeNull();
  });

  it("点「开始质检」触发一次送检", () => {
    const { onRun } = renderDrawer({ issues: [], auditedCount: 0 });
    fireEvent.click(document.querySelector(".interview-audit__run") as HTMLElement);
    expect(onRun).toHaveBeenCalledTimes(1);
  });
});
