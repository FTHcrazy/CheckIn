import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SummaryPreview from "./index";

/**
 * 大纲回流（R-AI-09）的浮层行为：
 * 一句话梗概展示 / 已填入的确认 / 手写冲突时的「覆盖为这句」。
 * 落库与 IPC 都在 hook 层，这里只钉「给不给用户看、点了回调有没有发出去」。
 */

const baseProps = {
  loading: false,
  error: null,
  onRegenerate: () => {},
  onClose: () => {},
};

afterEach(cleanup);

describe("SummaryPreview · 大纲回流", () => {
  it("本次没产出一句话梗概时，整块不渲染（不留空盒子）", () => {
    render(<SummaryPreview {...baseProps} result="一段摘要。" />);
    expect(screen.queryByText("一句话梗概")).toBeNull();
    expect(screen.queryByText("覆盖为这句")).toBeNull();
  });

  it("已自动填入大纲：显示一句话 + 已填入提示，不给覆盖按钮", () => {
    render(
      <SummaryPreview
        {...baseProps}
        result="一段摘要。"
        oneLiner="主角入门，领了杂役牌子。"
        noteApplied
      />,
    );
    expect(screen.getByText("一句话梗概")).toBeTruthy();
    expect(screen.getByText("主角入门，领了杂役牌子。")).toBeTruthy();
    expect(screen.getByText(/已填入大纲/)).toBeTruthy();
    expect(screen.queryByText("覆盖为这句")).toBeNull();
  });

  it("本章已有手写梗概：显示原文 + 覆盖按钮，点击回调一次", () => {
    const onApplyNote = vi.fn();
    render(
      <SummaryPreview
        {...baseProps}
        result="一段摘要。"
        oneLiner="主角入门，领了杂役牌子。"
        noteConflict="我自己写的一句话"
        onApplyNote={onApplyNote}
      />,
    );
    expect(screen.getByText(/我自己写的一句话/)).toBeTruthy();
    // 冲突态下不能声称「已填入」——此时一个字都没写进去
    expect(screen.queryByText(/已填入大纲/)).toBeNull();

    fireEvent.click(screen.getByText("覆盖为这句"));
    expect(onApplyNote).toHaveBeenCalledTimes(1);
  });

  it("加载中不展示一句话区块（结果还没到）", () => {
    render(<SummaryPreview {...baseProps} loading result={null} />);
    expect(screen.getByText("正在生成摘要…")).toBeTruthy();
    expect(screen.queryByText("一句话梗概")).toBeNull();
  });
});

describe("SummaryPreview · 按批次撤销（M6）", () => {
  it("有批次时给出撤销入口，点击回调一次", () => {
    const onUndoBatch = vi.fn();
    render(
      <SummaryPreview
        {...baseProps}
        result="一段摘要。"
        batch="b1"
        onUndoBatch={onUndoBatch}
      />,
    );
    fireEvent.click(screen.getByText("撤销本批次"));
    expect(onUndoBatch).toHaveBeenCalledTimes(1);
  });

  it("没有批次（手写摘要 / 老数据）不显示撤销入口", () => {
    render(
      <SummaryPreview {...baseProps} result="一段摘要。" onUndoBatch={() => {}} />,
    );
    expect(screen.queryByText("撤销本批次")).toBeNull();
  });

  it("加载中不给撤销入口：此刻还没写库，撤的是一场空", () => {
    render(
      <SummaryPreview
        {...baseProps}
        loading
        result={null}
        batch="b1"
        onUndoBatch={() => {}}
      />,
    );
    expect(screen.queryByText("撤销本批次")).toBeNull();
  });

  it("生成失败时不显示撤销入口（失败路径没写任何摘要）", () => {
    render(
      <SummaryPreview
        {...baseProps}
        result={null}
        error="调用失败"
        batch="b1"
        onUndoBatch={() => {}}
      />,
    );
    expect(screen.queryByText("撤销本批次")).toBeNull();
  });
});
