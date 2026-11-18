import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, renderHook } from "@testing-library/react";
import { DIAGRAMS } from "../../data/interview-diagrams";
import { GLOSSARY_TERMS } from "../../data/interview-glossary";
import { QUESTION_BANK } from "../../data/interview-bank";
import InterviewBankProvider from "./index";
import { useInterviewBankContext } from "./context";

/**
 * Provider 的两条契约（T06-A）。
 *
 * ① **没有 Provider 时 `useInterviewBankContext()` 返回 `null`**：
 *    `persistence/` 之外的现有组件测试大多不包 Provider（`TermText` 有 5 条、
 *    `DiagramFigure` / `KnowledgeDrawer` 也各有），返回 null 才能让消费方
 *    走「回落基线函数」的老路。这里若抛错，那些测试会全红。
 * ② **只透传 children，不产生额外 DOM**：Provider 套在页面根上，
 *    多一个 `<div>` 就会打断 `.interview-page > *` 这类布局选择器。
 */
describe("InterviewBankProvider", () => {
  afterEach(() => {
    cleanup();
    window.electronAPI = undefined;
  });

  it("没有 Provider 时返回 null（不抛错）", () => {
    const { result } = renderHook(() => useInterviewBankContext());

    expect(result.current).toBeNull();
  });

  it("有 Provider 时透传合并视图的数据", () => {
    const { result } = renderHook(() => useInterviewBankContext(), {
      wrapper: ({ children }) => <InterviewBankProvider>{children}</InterviewBankProvider>,
    });

    expect(result.current).not.toBeNull();
    // 测试环境没有 IPC 通道 → 回落基线，题目数必须与常量一致（不是空数组）
    expect(result.current?.questions).toHaveLength(QUESTION_BANK.length);
    expect(result.current?.glossary).toHaveLength(GLOSSARY_TERMS.length);
    expect(result.current?.diagramsById[DIAGRAMS[0].id]).toBe(DIAGRAMS[0]);
    expect(result.current?.glossaryIndex.byId(GLOSSARY_TERMS[0].id)).toBe(GLOSSARY_TERMS[0]);
    expect(typeof result.current?.reload).toBe("function");
  });

  it("只透传 children，不产生额外 DOM 节点", () => {
    const { container } = render(
      <InterviewBankProvider>
        <div id="probe" />
      </InterviewBankProvider>,
    );

    expect(container.children).toHaveLength(1);
    expect((container.firstElementChild as HTMLElement).id).toBe("probe");
  });
});
