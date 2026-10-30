import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ExtractPanel from ".";
import type { ExtractSession } from "../../utils/entity-extract";
import type { NovelChapter } from "../../types";

/**
 * 抽取设定面板的行为契约（R-AI-08）
 *
 * 钉四件最容易退化的东西：
 * 1. 「还没抽」与「抽了 0 条」是**两件事**（空态文案不能说反）；
 * 2. 已存在的条目**不可勾选**、不参与「勾选 N 条」计数（重名不覆盖是硬约束）；
 * 3. 同一章再点一次是「重新抽取」（带 `force`），换章则照常二次确认；
 * 4. AI 不可用时点按钮要说明原因，不能「点了没反应」。
 */

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function chapter(id: string, title: string, content = "正文"): NovelChapter {
  return {
    id,
    workId: "w1",
    volumeId: "v1",
    title,
    content,
    wordCount: content.length,
    status: "draft",
    sort: 0,
    updatedAt: 0,
  };
}

function session(over: Partial<ExtractSession> = {}): ExtractSession {
  return {
    chapterId: "c1",
    chapterTitle: "第一章",
    loading: false,
    error: null,
    usedFallback: false,
    applied: null,
    candidates: [
      {
        key: "李玄",
        name: "李玄",
        type: "character",
        summary: "青冥宗外门弟子",
        evidence: "李玄握紧了刀",
        existingId: null,
        selected: true,
      },
      {
        key: "青冥宗",
        name: "青冥宗",
        type: "faction",
        summary: "东域三宗之一",
        evidence: "青冥宗的山门",
        existingId: null,
        selected: true,
      },
      {
        key: "李玄刀",
        name: "李玄刀",
        type: "item",
        summary: "",
        evidence: "",
        existingId: "e9",
        selected: false,
      },
    ],
    ...over,
  };
}

function renderPanel(over: Partial<Parameters<typeof ExtractPanel>[0]> = {}) {
  const props = {
    chapterId: "c1",
    chapters: [chapter("c1", "第一章"), chapter("c2", "第二章")],
    session: null as ExtractSession | null,
    onRun: vi.fn(),
    onToggle: vi.fn(),
    onTypeChange: vi.fn(),
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    onNotify: vi.fn(),
    ...over,
  };
  const utils = render(<ExtractPanel {...props} />);
  return { ...utils, props };
}

describe("ExtractPanel", () => {
  it("还没抽过时只说「尚未抽取」，并明确结果不会自动入库", () => {
    renderPanel();
    expect(screen.getByText("尚未抽取")).toBeTruthy();
    expect(screen.getByText(/不会自动入库/)).toBeTruthy();
    expect(screen.queryByText("没有可建卡的条目")).toBeNull();
  });

  it("点「抽取本章设定」把来源章节交出去，同一章第一次不带 force", () => {
    const { props } = renderPanel();
    screen.getByText("抽取本章设定").click();
    expect(props.onRun).toHaveBeenCalledWith("c1", false);
  });

  it("同一章已有结果时按钮变「重新抽取」，且带上 force（不必再确认一次）", () => {
    const { props } = renderPanel({ session: session() });
    screen.getByText("重新抽取").click();
    expect(props.onRun).toHaveBeenCalledWith("c1", true);
  });

  it("换到别的来源章节再抽，仍然走二次确认（force = false）", () => {
    const { props } = renderPanel({ session: session() });
    // 面板下拉改选第二章（antd Select：先开弹层再点选项）
    const select = screen.getByLabelText("抽取来源章节");
    fireEvent.mouseDown(select);
    fireEvent.click(screen.getByTitle("第二章"));
    screen.getByText("重新抽取").click();
    expect(props.onRun).toHaveBeenCalledWith("c2", false);
  });

  it("勾选计数只算「会入库」的条目，已存在的单列且不可勾选", () => {
    const { container } = renderPanel({ session: session() });
    expect(screen.getByText(/勾选 2 条/)).toBeTruthy();
    expect(screen.getByText(/1 条已存在/)).toBeTruthy();

    // 已存在那条：打勾框禁用 + 有「已存在」标签（行结构来自共用 AiCandidateList）
    const existingRow = container.querySelector(".ai-cand__row.is-disabled");
    expect(existingRow).not.toBeNull();
    const checkbox = existingRow!.querySelector("input[type=checkbox]");
    expect(checkbox).toBeDisabled();
    expect(existingRow!.textContent).toContain("已存在");
  });

  it("候选的类型下拉显示中文标签（走 EntityTypeContext），不是类型 id", () => {
    const { container } = renderPanel({ session: session() });
    const types = [...container.querySelectorAll(".nv-xp__type")].map(
      (node) => node.getAttribute("title") ?? node.textContent?.trim(),
    );
    // 类型 id 是 character / faction，下拉里必须是中文展示名
    expect(types).toContain("角色");
    expect(types).toContain("势力");
    expect(types).not.toContain("character");
  });

  it("点勾选框回传 key（面板不自己改状态，由页面持有会话）", () => {
    const { props } = renderPanel({ session: session() });
    const checkbox = screen.getByLabelText("选中 青冥宗");
    fireEvent.click(checkbox);
    expect(props.onToggle).toHaveBeenCalledWith("青冥宗");
  });

  it("「建卡并入库」把确认交出去（勾选数为 0 时禁用）", () => {
    const { props: enabled } = renderPanel({ session: session() });
    fireEvent.click(screen.getByText("建卡并入库"));
    expect(enabled.onConfirm).toHaveBeenCalledTimes(1);

    cleanup();
    const noneSelected = session({
      candidates: session().candidates.map((item) => ({ ...item, selected: false })),
    });
    const { container } = renderPanel({ session: noneSelected });
    // 文字节点是按钮内的 span，「禁用」要看真正的 button
    const confirm = container.querySelector<HTMLButtonElement>(".nv-xp__confirm");
    expect(confirm).not.toBeNull();
    expect(confirm!.disabled).toBe(true);
  });

  it("建完卡且候选清空时说清「已建 N 张」，不留一个空列表", () => {
    renderPanel({ session: session({ candidates: [], applied: 2 }) });
    expect(screen.getByText("已建 2 张卡")).toBeTruthy();
    expect(screen.getByText(/本次候选已处理完/)).toBeTruthy();
  });

  it("抽取失败时把错误原文摊在面板上（不留永远转圈的加载态）", () => {
    renderPanel({
      session: session({ candidates: [], error: "服务商返回 401，密钥可能失效" }),
    });
    expect(screen.getByText("抽取没有完成")).toBeTruthy();
    expect(screen.getByText(/401/)).toBeTruthy();
  });

  it("AI 不可用时点按钮只说明原因，不发起请求", () => {
    const onNotify = vi.fn();
    const { props } = renderPanel({
      unavailableText: "AI 当前不可用，先在设置里配置模型",
      onNotify,
    });
    expect(screen.getByText(/先在设置里配置模型/)).toBeTruthy();
    screen.getByText("抽取本章设定").click();
    expect(props.onRun).not.toHaveBeenCalled();
    expect(String(onNotify.mock.calls[0][0])).toContain("配置模型");
  });

  it("「收起重来」清掉本次会话（回传 onClose，不在这里改状态）", () => {
    const { props } = renderPanel({ session: session() });
    fireEvent.click(screen.getByText("收起重来"));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
