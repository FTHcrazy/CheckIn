import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AiRescueDrawer, { type AiRescueContext, type AiRescueDrawerProps } from "./index";
import type { RescueSegment } from "../../utils/rescue";

/**
 * 卡文救援浮层（R-AI-11）
 *
 * 钉四条产品硬约束：
 * 1. 未授权时**只**弹授权，不发任何生成请求（验收 §2.1-2）；
 * 2. 已授权时打开即生成一次，且不因重渲染重复烧额度；
 * 3. 勾选顺序 = 采纳顺序，空勾选不能插入；
 * 4. 流式期间插入锁定（作者不能在结果还在变的时候按插入）。
 */
const CONTEXT: AiRescueContext = {
  anchor: { workId: "w1", chapterId: "c1", cursorOrNodeId: "cursor:12" },
  scope: "chapter",
  estimatedChars: 1200,
  // 正文里有明确光标：「插入光标处」可选且是默认落点
  cursorKnown: true,
  availability: "ready",
};

const SEGMENTS: RescueSegment[] = [
  { title: "当场翻脸", conflict: "为玉佩对峙", consequence: "师徒名分撕破" },
  { title: "按下不表", conflict: "暗中查证", consequence: "错失先机" },
];

function buildProps(overrides: Partial<AiRescueDrawerProps> = {}): AiRescueDrawerProps {
  return {
    open: true,
    context: CONTEXT,
    segments: SEGMENTS,
    phase: "done",
    error: null,
    undoCount: 0,
    onRequestConsent: vi.fn(),
    onGenerate: vi.fn(),
    onAdopt: vi.fn(),
    onUndo: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe("AiRescueDrawer", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("未授权：显示「授权并生成」，点了只走授权链路，不发起生成", () => {
    const onRequestConsent = vi.fn();
    const onGenerate = vi.fn();
    render(
      <AiRescueDrawer
        {...buildProps({
          context: { ...CONTEXT, availability: "needsConsent" },
          segments: [],
          phase: "idle",
          onRequestConsent,
          onGenerate,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "授权并生成" }));
    expect(onRequestConsent).toHaveBeenCalledTimes(1);
    // 授权弹窗点「取消」时不会有任何请求 —— 所以这里绝不能先发一次
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it("已授权：打开即生成一次，重渲染不再重复请求", () => {
    const onGenerate = vi.fn();
    const props = buildProps({ onGenerate, segments: [], phase: "loading" });
    const { rerender } = render(<AiRescueDrawer {...props} />);
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onGenerate.mock.calls[0][0]).toMatchObject({ style: "default" });

    rerender(<AiRescueDrawer {...props} segments={SEGMENTS} phase="done" />);
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("卡片按 B1..Bn 编号，勾选按勾选顺序交给采纳", async () => {
    const onAdopt = vi.fn();
    render(<AiRescueDrawer {...buildProps({ onAdopt })} />);

    expect(screen.getByText("B1")).toBeTruthy();
    expect(screen.getByText("B2")).toBeTruthy();

    // 先勾第二条、再勾第一条：采纳顺序必须是 2 → 1
    const second = screen.getByLabelText("选择走向 2：按下不表");
    const first = screen.getByLabelText("选择走向 1：当场翻脸");
    fireEvent.click(second);
    fireEvent.click(first);

    await waitFor(() => expect(screen.getByText("已选 2 条")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /插\s*入/ }));

    const adopt = onAdopt.mock.calls[0][0];
    expect(adopt.segments.map((item: RescueSegment) => item.title)).toEqual([
      "按下不表",
      "当场翻脸",
    ]);
    expect(adopt.landing).toBe("cursor");
  });

  it("没有勾选时插入不可点（空批次拒绝的 UI 侧）", () => {
    render(<AiRescueDrawer {...buildProps()} />);
    const insert = screen.getByRole("button", { name: /插\s*入/ }) as HTMLButtonElement;
    expect(insert.disabled).toBe(true);
  });

  it("流式期间插入锁定（流式 + 已勾选也不给插入）", async () => {
    render(<AiRescueDrawer {...buildProps({ phase: "streaming" })} />);
    fireEvent.click(screen.getByLabelText("选择走向 1：当场翻脸"));
    await waitFor(() => expect(screen.getByText("已选 1 条")).toBeTruthy());
    const insert = screen.getByRole("button", { name: /插\s*入/ }) as HTMLButtonElement;
    expect(insert.disabled).toBe(true);
  });

  it("有可撤记录时才出现「撤销本批次」", () => {
    const onUndo = vi.fn();
    const { rerender } = render(<AiRescueDrawer {...buildProps({ onUndo })} />);
    expect(screen.queryByRole("button", { name: /撤销本批次/ })).toBeNull();

    rerender(<AiRescueDrawer {...buildProps({ onUndo, undoCount: 2 })} />);
    fireEvent.click(screen.getByRole("button", { name: /撤销本批次/ }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it("AI 不可用：说明原因且不给生成入口", () => {
    render(
      <AiRescueDrawer
        {...buildProps({
          context: { ...CONTEXT, availability: "unavailable" },
          segments: [],
          phase: "idle",
          unavailableText: "还没配置模型服务",
        })}
      />,
    );
    expect(screen.getByText("还没配置模型服务")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "授权并生成" })).toBeNull();
  });

  it("失败时给出错误文案，但已落卡的走向仍然保留（可以先用手上的）", () => {
    render(
      <AiRescueDrawer
        {...buildProps({ phase: "error", error: "生成超时，已保留已生成的走向" })}
      />,
    );
    expect(screen.getByText("生成超时，已保留已生成的走向")).toBeTruthy();
    expect(screen.getByText("当场翻脸")).toBeTruthy();
  });
});
