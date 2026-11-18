import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import QuestionEditDrawer from "./index";
import { QUESTION_BANK } from "../../data/interview-bank";
import { CATEGORIES } from "../../data/interview-taxonomy";
import type { InterviewQuestion } from "../../data/interview-types";
import type { QuestionWriteOutcome } from "../../hooks/useQuestionOverride";

/**
 * 编辑抽屉的装配测试（T08-A）。
 *
 * 数据校验由主进程与结构层各自守（`payload-shape.ts`），这里只钉三件
 * `tsc` 抓不到的事：
 * 1. **预填**用的是当前这道题（`override` 时是用户版本，不是基线原文）；
 * 2. **保存**把表单值与不可编辑字段（id / track / heat）拼成一道完整的题；
 * 3. **失败不关抽屉** —— 关掉抽屉等于把用户刚敲的几百字一起关掉。
 *
 * 查询一律走 `getByLabelText`（antd 的 Form.Item 用 `htmlFor` 关联）而不是
 * `getByDisplayValue`：后者会对 value 做空白归一，长答案里的换行被折叠成空格，
 * 断言永远匹配不上，看起来像「预填坏了」。
 * 按钮名同理用正则：antd 6 会在两个汉字之间插一个空格（"保 存"）。
 */
const BASELINE: InterviewQuestion = QUESTION_BANK[0];

const SAVE_BUTTON = /保\s*存/;
const CANCEL_BUTTON = /取\s*消/;

function field(label: string): HTMLElement {
  return screen.getByLabelText(label);
}

function textArea(label: string): HTMLTextAreaElement {
  return field(label) as HTMLTextAreaElement;
}

function renderDrawer(
  saveOverride: (question: InterviewQuestion) => Promise<QuestionWriteOutcome>,
  handlers: { onSaved?: () => void; onClose?: () => void } = {},
): void {
  render(
    <QuestionEditDrawer
      open
      question={BASELINE}
      origin="baseline"
      categories={CATEGORIES}
      onClose={handlers.onClose ?? (() => {})}
      onSaved={handlers.onSaved ?? (() => {})}
      saveOverride={saveOverride}
    />,
  );
}

/** 点「保存」并让 Form 的异步校验 + 保存流程跑起来 */
async function clickSave(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: SAVE_BUTTON }));
    await Promise.resolve();
  });
}

describe("QuestionEditDrawer", () => {
  afterEach(() => {
    cleanup();
  });

  it("打开时用当前这道题预填，标题按来源给出", () => {
    renderDrawer(async () => ({ ok: true, errors: [] }));

    expect(screen.getByText("编辑默认题")).not.toBeNull();
    expect(field("标题")).toHaveValue(BASELINE.title);
    expect(textArea("题干")).toHaveValue(BASELINE.stem);
    expect(textArea("参考答案")).toHaveValue(BASELINE.answer);
    expect(field("来源主题")).toHaveValue(BASELINE.topic);
    expect(textArea("题干代码")).toHaveValue(BASELINE.stemCode ?? "");
  });

  it("保存把改过的内容交给通道，成功后回调 onSaved", async () => {
    const saveOverride = vi.fn(
      async (_question: InterviewQuestion): Promise<QuestionWriteOutcome> => {
        void _question;
        return { ok: true, errors: [] };
      },
    );
    const onSaved = vi.fn();
    renderDrawer(saveOverride, { onSaved });

    fireEvent.change(textArea("参考答案"), { target: { value: "我重写过的一版答案" } });
    await clickSave();

    await waitFor(() => expect(saveOverride).toHaveBeenCalledTimes(1));
    const saved = saveOverride.mock.calls[0][0];
    expect(saved.answer).toBe("我重写过的一版答案");
    // id / 轨道 / 热度这些不在表单里的字段必须原样带过去
    expect(saved.id).toBe(BASELINE.id);
    expect(saved.track).toBe(BASELINE.track);
    expect(saved.heat).toBe(BASELINE.heat);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("保存失败：errors 摆在抽屉里，不关抽屉", async () => {
    const saveOverride = vi.fn(
      async (): Promise<QuestionWriteOutcome> => ({
        ok: false,
        errors: ["保存被拒绝：CHECK constraint failed"],
      }),
    );
    const onSaved = vi.fn();
    renderDrawer(saveOverride, { onSaved });

    await clickSave();

    await waitFor(() => expect(screen.getByText("没有保存成功")).not.toBeNull());
    expect(screen.getByText("保存被拒绝：CHECK constraint failed")).not.toBeNull();
    // 抽屉没关：用户敲的内容还在，可以照着错误提示直接改
    expect(onSaved).not.toHaveBeenCalled();
    expect(field("标题")).toHaveValue(BASELINE.title);
  });

  it("标题清空时不提交（前端先挡一次，不必等主进程报错）", async () => {
    const saveOverride = vi.fn(
      async (_question: InterviewQuestion): Promise<QuestionWriteOutcome> => {
        void _question;
        return { ok: true, errors: [] };
      },
    );
    renderDrawer(saveOverride);

    fireEvent.change(field("标题"), { target: { value: "" } });
    await clickSave();

    expect(saveOverride).not.toHaveBeenCalled();
  });

  it("取消按钮走 onClose（抽屉自己不改页面状态）", () => {
    const onClose = vi.fn();
    renderDrawer(async () => ({ ok: true, errors: [] }), { onClose });

    fireEvent.click(screen.getByRole("button", { name: CANCEL_BUTTON }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
