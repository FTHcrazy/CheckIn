import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { InterviewItemDetailDTO } from "@/shared/types/electron";
import { CATEGORIES } from "../../data/interview-taxonomy";
import DraftBoxDrawer from "./index";

/** 一条草稿（DTO 的最小合法形状） */
function draftOf(overrides: Partial<InterviewItemDetailDTO>): InterviewItemDetailDTO {
  return {
    id: "u-g-event-loop-1",
    kind: "glossary",
    action: "new",
    baseId: null,
    status: "draft",
    origin: "ai",
    categoryId: "foundation-js",
    track: null,
    title: "事件循环",
    errors: [],
    updatedAt: new Date(2026, 10, 17).getTime(),
    payload: { term: "事件循环" },
    sourceIntent: "interviewDraft:glossary",
    aiLogId: null,
    baseStamp: null,
    baseHash: null,
    ackBaseHash: null,
    reviewedAt: null,
    createdAt: 0,
    deletedAt: null,
    ...overrides,
  };
}

/**
 * 草稿箱的装配测试。
 *
 * 草稿不进合并视图，所以这个抽屉是它们唯一的出口：标题、分类路径、校验红字
 * 三样缺一样，用户就只能盲采纳 —— 那正是草稿箱要避免的事。
 */
describe("DraftBoxDrawer", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("列出草稿的标题、分类路径与校验红字", () => {
    render(
      <DraftBoxDrawer
        open
        items={[
          draftOf({}),
          draftOf({
            id: "u-q-1",
            kind: "question",
            title: "手写 debounce",
            categoryId: "foundation-react",
            errors: ["键与草稿「事件循环」重复"],
          }),
        ]}
        categories={CATEGORIES}
        pendingId={null}
        error={null}
        onClearError={() => undefined}
        onAdopt={() => undefined}
        onDiscard={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByText("事件循环")).not.toBeNull();
    expect(screen.getByText("手写 debounce")).not.toBeNull();
    // 分类路径走合并后的分类表（不是裸 id）
    expect(screen.getByText(/基础知识库 \/ JavaScript/)).not.toBeNull();
    expect(screen.getByText("键与草稿「事件循环」重复")).not.toBeNull();
  });

  it("采纳与丢弃各自回调对应那条草稿", () => {
    const onAdopt = vi.fn();
    const onDiscard = vi.fn();
    const item = draftOf({});
    render(
      <DraftBoxDrawer
        open
        items={[item]}
        categories={CATEGORIES}
        pendingId={null}
        error={null}
        onClearError={() => undefined}
        onAdopt={onAdopt}
        onDiscard={onDiscard}
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /采纳/ }));
    expect(onAdopt).toHaveBeenCalledWith(item);

    fireEvent.click(screen.getByRole("button", { name: /丢弃/ }));
    expect(onDiscard).toHaveBeenCalledWith(item);
  });

  it("空态给出说明而不是一片空白", () => {
    render(
      <DraftBoxDrawer
        open
        items={[]}
        categories={CATEGORIES}
        pendingId={null}
        error={null}
        onClearError={() => undefined}
        onAdopt={() => undefined}
        onDiscard={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText("没有待处理的草稿")).not.toBeNull();
  });
});
