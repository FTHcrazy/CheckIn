/**
 * AI 排阶梯弹窗（R-AI-18）
 *
 * 钉四件最容易退化的东西：
 * 1. 「还没生成」与「生成完 0 条」是**两件事**（空态文案不能说反）；
 * 2. 候选行必须带**阶梯序号**（顺序即阶梯序）与梯度说明，作者才能判断要不要；
 * 3. 一条没勾时「加入阶梯」不可点；重名行禁勾并标「已有」；
 * 4. 有禁止原因时必须**写在面板上**，而不是让选项变灰了却不说为什么。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import AiLevelGenModal from ".";
import type { LevelGenSession } from "../../hooks/useAiLevelGen";
import type { LevelCandidate } from "@/shared/novel/level-gen";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function candidate(over: Partial<LevelCandidate> = {}): LevelCandidate {
  return {
    key: "练气",
    name: "练气",
    note: "引气入体",
    sequence: 2,
    selected: true,
    duplicate: false,
    ...over,
  };
}

function session(over: Partial<LevelGenSession> = {}): LevelGenSession {
  return {
    categoryId: "cat-1",
    categoryName: "境界体系",
    mode: "extend",
    loading: false,
    error: null,
    candidates: [candidate()],
    usedFallback: false,
    applied: null,
    ...over,
  };
}

function renderModal(over: Partial<Parameters<typeof AiLevelGenModal>[0]> = {}) {
  const props = {
    open: true,
    categoryName: "境界体系",
    session: null as LevelGenSession | null,
    mode: "generate" as const,
    onModeChange: vi.fn(),
    countText: "9",
    onCountChange: vi.fn(),
    count: 9,
    pickedCount: 0,
    generateBlockedReason: null as string | null,
    unavailableText: null as string | null,
    onRun: vi.fn(),
    onToggle: vi.fn(),
    onApply: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<AiLevelGenModal {...props} />);
  return props;
}

describe("空态与加载", () => {
  it("还没生成时说明「候选不会自动入库」与当前条数", async () => {
    renderModal();
    expect(await screen.findByText(/候选不会自动入库/)).toBeTruthy();
    expect(screen.getByText(/共 9 级/)).toBeTruthy();
    // 不能把「还没生成」说成「这次没有候选」
    expect(screen.queryByText(/这次没有可用候选/)).toBeNull();
  });

  it("生成中显示正在推演，并禁掉再次触发的按钮", async () => {
    renderModal({ session: session({ loading: true, candidates: [] }) });
    expect(await screen.findByText(/正在按「境界体系」推演阶梯/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /生成中/ })).toBeDisabled();
  });

  it("失败把错误原文摊在弹窗上（不留永远转圈的加载态）", async () => {
    renderModal({ session: session({ candidates: [], error: "服务商返回 401，密钥可能失效" }) });
    expect(await screen.findByText(/401/)).toBeTruthy();
  });

  it("「生成完 0 条」与「还没生成」用不同文案", async () => {
    renderModal({ session: session({ candidates: [] }) });
    expect(await screen.findByText("这次没有可用候选，换一种方式或改改分类名再试")).toBeTruthy();
    expect(screen.queryByText(/候选不会自动入库/)).toBeNull();
  });
});

describe("候选行", () => {
  it("带阶梯序号与梯度说明（顺序即阶梯序，作者要能对着看）", () => {
    renderModal({ session: session() });
    expect(screen.getByText("2. 练气")).toBeTruthy();
    expect(screen.getByText("引气入体")).toBeTruthy();
  });

  it("重名项标「已有」且不可勾（勾了也会被过滤，禁勾是把话说在前面）", () => {
    renderModal({
      session: session({
        candidates: [candidate(), candidate({ key: "筑基", name: "筑基", duplicate: true, selected: false, sequence: 3 })],
      }),
    });
    // Modal 挂在 body portal 上，render() 的 container 里没有它
    const disabled = document.querySelector(".ai-cand__row.is-disabled");
    expect(disabled).not.toBeNull();
    expect(disabled!.textContent).toContain("已有");
    expect(disabled!.querySelector("input[type=checkbox]")).toBeDisabled();
  });

  it("勾选回调把 key 交出去", () => {
    const props = renderModal({ session: session() });
    fireEvent.click(screen.getByLabelText("加入 2. 练气"));
    expect(props.onToggle).toHaveBeenCalledWith("练气");
  });
});

describe("动作", () => {
  it("点「生成候选」发起请求", () => {
    const props = renderModal();
    fireEvent.click(screen.getByText("生成候选"));
    expect(props.onRun).toHaveBeenCalledTimes(1);
  });

  it("一条没勾时「加入阶梯」不可点", () => {
    renderModal({ session: session({ candidates: [candidate({ selected: false })] }) });
    expect(screen.getByRole("button", { name: "加入阶梯" })).toBeDisabled();
    expect(screen.getByText("还没勾选")).toBeTruthy();
  });

  it("有勾选时点「加入阶梯」把动作交出去，并显示已选条数", () => {
    const props = renderModal({ session: session(), pickedCount: 1 });
    fireEvent.click(screen.getByText("加入阶梯"));
    expect(props.onApply).toHaveBeenCalledTimes(1);
    expect(screen.getByText("已选 1 级")).toBeTruthy();
  });

  it("已加入后提示已写入，并说明可继续生成下一批", () => {
    renderModal({ session: session({ applied: 4, candidates: [] }) });
    expect(screen.getByText(/已加入 4 级/)).toBeTruthy();
  });
});

describe("门控与禁用原因", () => {
  it("「整理整套」被禁时，原因必须写在面板上（不能只变灰）", () => {
    const reason = "这套阶梯是「由高到低」排列，整套生成会与现有顺序相反";
    renderModal({ generateBlockedReason: reason });
    expect(screen.getByText(reason)).toBeTruthy();
    // antd Segmented 的禁用项带这个类（Modal 在 portal 里，查 document）
    expect(document.querySelector(".ant-segmented-item-disabled")).not.toBeNull();
  });

  it("AI 不可用时禁用生成按钮并说明原因", () => {
    renderModal({ unavailableText: "尚未配置模型名，请先在设置里填写" });
    expect(screen.getByText(/尚未配置模型名/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /生成候选/ })).toBeDisabled();
  });

  it("弹窗底部说明「只发分类名与现有阶梯，不发正文」，与 L3 授权口径一致", () => {
    renderModal();
    expect(screen.getByText(/不发送正文/)).toBeTruthy();
  });
});
