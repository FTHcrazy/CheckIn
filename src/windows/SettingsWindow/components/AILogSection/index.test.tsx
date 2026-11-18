/**
 * AI 记录页的复制按钮（系统提示词 / 用户输入 / 模型输出）。
 *
 * 只钉三件事：
 * 1. 三个块各自复制**自己的原文**（复制错块的话，用户拿去调 prompt 会污染另一段）；
 * 2. 空内容的按钮禁用（避免把「（空）」这个占位符粘到别处）；
 * 3. 剪贴板失败要有提示，不能静默无反应。
 */
import { App } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiLogRowDTO } from "@/shared/types/electron";
import AILogSection from "./index";

const ROW: AiLogRowDTO = {
  id: 1,
  intent: "naming",
  provider: "deepseek",
  model: "deepseek-v4",
  system_prompt: "你是起名助手",
  user_prompt: "给主角起五个名字",
  raw_output: '[{"name":"凌霜","meaning":"清冷"}]',
  parsed_output: null,
  error_code: null,
  error_message: null,
  duration_ms: 1200,
  prompt_version: "v1",
  created_at: "2026-11-18 15:00:00",
};

let writeText: ReturnType<typeof vi.fn>;
let listLogs: ReturnType<typeof vi.fn>;
let originalAPI: typeof window.electronAPI;

beforeEach(() => {
  writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  listLogs = vi.fn(async () => ({ items: [ROW], total: 1 }));
  originalAPI = window.electronAPI;
  window.electronAPI = { ai: { listLogs } } as unknown as typeof window.electronAPI;
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  window.electronAPI = originalAPI;
});

/** 展开第一条记录（Collapse 的 header 是个 button） */
async function expandFirstRow(): Promise<void> {
  render(
    <App>
      <AILogSection />
    </App>,
  );
  fireEvent.click(await screen.findByRole("button", { name: /起名/ }));
  // 展开完成的信号用「面板里的复制按钮」，不要用某段正文：空字段的用例里
  // 那段正文是占位符，按正文等会等不到
  await screen.findByRole("button", { name: "复制用户输入" });
}

describe("AI 记录页：一键复制", () => {
  it("三个块各自复制自己的原文", async () => {
    await expandFirstRow();

    fireEvent.click(screen.getByRole("button", { name: "复制系统提示词" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("你是起名助手"));

    fireEvent.click(screen.getByRole("button", { name: "复制用户输入" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("给主角起五个名字"));

    fireEvent.click(screen.getByRole("button", { name: "复制模型输出" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith('[{"name":"凌霜","meaning":"清冷"}]'),
    );
    expect(writeText).toHaveBeenCalledTimes(3);
  });

  it("复制成功后按钮短暂变成「已复制」", async () => {
    await expandFirstRow();

    fireEvent.click(screen.getByRole("button", { name: "复制系统提示词" }));
    expect(await screen.findByRole("button", { name: "已复制系统提示词" })).toBeTruthy();
  });

  it("空内容的块禁用按钮", async () => {
    listLogs.mockResolvedValue({
      items: [{ ...ROW, system_prompt: null, raw_output: "" }],
      total: 1,
    });
    await expandFirstRow();

    expect(
      (screen.getByRole("button", { name: "复制系统提示词" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "复制模型输出" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "复制用户输入" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("剪贴板失败时给出提示，而不是毫无反应", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    await expandFirstRow();

    fireEvent.click(screen.getByRole("button", { name: "复制用户输入" }));
    expect(await screen.findByText("复制失败，请手动选中文本复制")).toBeTruthy();
    // 失败不能把按钮留在「已复制」
    expect(screen.getByRole("button", { name: "复制用户输入" })).toBeTruthy();
  });
});
