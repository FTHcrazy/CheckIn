/**
 * 「从正文推断关系」弹层（R-AI-15）
 *
 * 钉四件最容易退化的东西：
 * 1. 「还没推断」与「推断完 0 条」是**两件事**（空态文案不能说反）；
 * 2. 候选行必须同时给出**两端 + 关系名 + 出处句**，作者才能判断对错；
 * 3. 一条没勾时「写入关系图」不可点（低置信默认不勾，很容易一条都没有）；
 * 4. 模型丢掉的条目要如实说，不能静默（作者会以为模型漏读）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import RelationSuggestDialog from ".";
import type { RelationSuggestSession, SuggestChapter } from "../../hooks/useRelationSuggest";
import type { RelationCandidate } from "@/shared/novel/relation-suggest";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const CHAPTERS: SuggestChapter[] = [
  { id: "c1", title: "第一章 山门", content: "李玄拜入青冥宗。" },
  { id: "c2", title: "第二章 拜师", content: "苏棠跪下行礼。" },
];

function candidate(over: Partial<RelationCandidate> = {}): RelationCandidate {
  return {
    key: "e1|e2|师徒",
    fromId: "e1",
    fromName: "李玄",
    toId: "e2",
    toName: "苏棠",
    relation: "师徒",
    confidence: "high",
    evidence: "苏棠拜李玄为师",
    selected: true,
    ...over,
  };
}

function session(over: Partial<RelationSuggestSession> = {}): RelationSuggestSession {
  return {
    chapterId: "c1",
    chapterTitle: "第一章 山门",
    loading: false,
    error: null,
    candidates: [candidate()],
    usedFallback: false,
    dropped: { unknown: 0, selfLoop: 0, invalid: 0, duplicate: 0 },
    applied: null,
    ...over,
  };
}

function renderDialog(over: Partial<Parameters<typeof RelationSuggestDialog>[0]> = {}) {
  const props = {
    open: true,
    chapters: CHAPTERS,
    chaptersLoading: false,
    chapterId: "c1",
    onChapterChange: vi.fn(),
    session: null as RelationSuggestSession | null,
    onSubmit: vi.fn(),
    onToggle: vi.fn(),
    onApply: vi.fn(),
    onReset: vi.fn(),
    onClose: vi.fn(),
    pickedCount: 0,
    ...over,
  };
  render(<RelationSuggestDialog {...props} />);
  return props;
}

describe("空态", () => {
  it("还没推断时只说「尚未推断」，并明确结果不会自动画进图", async () => {
    renderDialog();
    expect(await screen.findByText("尚未推断")).toBeTruthy();
    expect(screen.getByText(/不会自动画进图/)).toBeTruthy();
    expect(screen.queryByText("没有可写入的关系")).toBeNull();
  });

  it("推断中显示读的是哪一章", async () => {
    renderDialog({ session: session({ loading: true, candidates: [] }) });
    expect(await screen.findByText("正在推断")).toBeTruthy();
    // 章名在来源下拉与提示里都出现，按提示句定位（断言的是「说清了读哪一章」）
    expect(screen.getByText(/读完把候选关系列在这里/)).toBeTruthy();
  });

  it("推断失败把错误原文摊在弹层上（不留永远转圈的加载态）", async () => {
    renderDialog({
      session: session({ candidates: [], error: "服务商返回 401，密钥可能失效" }),
    });
    expect(await screen.findByText("推断没有完成")).toBeTruthy();
    expect(screen.getByText(/401/)).toBeTruthy();
  });

  it("「推断完 0 条」与「已写入」用不同文案（别让作者以为已经存过了）", async () => {
    renderDialog({ session: session({ candidates: [] }) });
    expect(await screen.findByText("没有可写入的关系")).toBeTruthy();

    cleanup();
    document.body.innerHTML = "";
    renderDialog({ session: session({ candidates: [], applied: 3 }) });
    expect(await screen.findByText("已写入 3 条")).toBeTruthy();
  });
});

describe("候选行", () => {
  it("同时给出两端、关系名与出处句（作者据此判断对错）", async () => {
    renderDialog({ session: session() });
    expect(await screen.findByText("李玄 → 苏棠")).toBeTruthy();
    expect(screen.getByText("关系：师徒")).toBeTruthy();
    expect(screen.getByText("「苏棠拜李玄为师」")).toBeTruthy();
  });

  it("置信度以中文标签呈现（高 / 中 / 低，不是 high / medium）", async () => {
    renderDialog({
      session: session({
        candidates: [
          candidate(),
          candidate({ key: "b", relation: "同门", confidence: "medium" }),
          candidate({ key: "c", relation: "宿敌", confidence: "low", selected: false }),
        ],
      }),
    });
    expect(await screen.findByText("高置信")).toBeTruthy();
    expect(screen.getByText("中置信")).toBeTruthy();
    expect(screen.getByText("低置信")).toBeTruthy();
  });

  it("点勾选框回传 key（弹层不自己改状态）", async () => {
    const props = renderDialog({ session: session() });
    fireEvent.click(await screen.findByLabelText("写入 李玄 → 苏棠"));
    expect(props.onToggle).toHaveBeenCalledWith("e1|e2|师徒");
  });
});

describe("写入", () => {
  it("勾选数来自 props（一条没勾时按钮不可点）", async () => {
    renderDialog({ session: session() });
    const button = (await screen.findByRole("button", { name: "写入关系图" })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("有勾选时点按钮把确认交出去", async () => {
    const props = renderDialog({ session: session(), pickedCount: 1 });
    fireEvent.click(await screen.findByRole("button", { name: "写入关系图" }));
    expect(props.onApply).toHaveBeenCalledTimes(1);
  });

  it("提交中按钮不可重按", async () => {
    const props = renderDialog({ session: session(), pickedCount: 1, submitting: true });
    fireEvent.click(await screen.findByRole("button", { name: /写入关系图/ }));
    expect(props.onApply).not.toHaveBeenCalled();
  });
});

describe("如实说明", () => {
  it("模型给的条目端点没建卡时，把丢弃条数说出来", async () => {
    renderDialog({
      session: session({
        dropped: { unknown: 3, selfLoop: 0, invalid: 0, duplicate: 0 },
      }),
    });
    expect(await screen.findByText(/另有 3 条提到的人物还没建卡/)).toBeTruthy();
  });

  it("走了兜底解析时明确提示（结果可能不全）", async () => {
    renderDialog({ session: session({ usedFallback: true }) });
    expect(await screen.findByText(/兜底解析/)).toBeTruthy();
  });

  it("AI 不可用时按钮禁用并给出原因（点了也不会没反应）", async () => {
    const props = renderDialog({ unavailableText: "尚未填写 API Key，请先在设置里配置" });
    expect(await screen.findByText(/先在设置里配置/)).toBeTruthy();
    const run = (await screen.findByRole("button", { name: /从正文推断关系/ })) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    fireEvent.click(run);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("已有结果时按钮变「重新推断」，「收起重来」清会话", async () => {
    const props = renderDialog({ session: session(), pickedCount: 1 });
    expect(await screen.findByRole("button", { name: /重新推断/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "收起重来" }));
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });
});
