import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import GlossaryEditDrawer from "./index";
import type { GlossaryTerm } from "../../data/interview-glossary";
import { CATEGORIES } from "../../data/interview-taxonomy";
import type { GlossaryWriteOutcome } from "../../hooks/useGlossaryEdit";

function makeTerm(id: string, term: string, extra: Partial<GlossaryTerm> = {}): GlossaryTerm {
  return {
    id,
    term,
    domain: "browser",
    short: "一句话定义。",
    detail: ["展开细节。"],
    ...extra,
  };
}

/**
 * 词条编辑抽屉。
 *
 * 盯三件事：
 * ① 表单回填的是**当前词条**（抽屉常驻，残留上一条会让用户改错词）；
 * ② 键冲突在本层就拦住，不白跑一次写通道；
 * ③ 内置词条不给删除按钮（删了也会被下次合并带回来，是假象）。
 */
function renderDrawer(overrides: Partial<Parameters<typeof GlossaryEditDrawer>[0]> = {}) {
  // 显式给 mock 一个带参签名：断言要读 `save.mock.calls[0][0]`（写进去的词条）
  const save = vi.fn<(term: GlossaryTerm) => Promise<GlossaryWriteOutcome>>(async () => ({
    ok: true,
    errors: [],
  }));
  const onDelete = vi.fn();
  const onSaved = vi.fn();
  const props: Parameters<typeof GlossaryEditDrawer>[0] = {
    open: true,
    term: makeTerm("u-g-throttle", "节流"),
    categories: CATEGORIES,
    holders: [],
    pendingId: null,
    error: null,
    onClearError: () => {},
    onClose: () => {},
    onSaved,
    save,
    onDelete,
  };
  const merged = { ...props, ...overrides };
  const view = render(<GlossaryEditDrawer {...merged} />);
  return { ...view, save: merged.save as typeof save, onDelete, onSaved };
}

describe("GlossaryEditDrawer", () => {
  afterEach(() => {
    cleanup();
  });

  it("打开时回填当前词条", () => {
    renderDrawer({
      term: makeTerm("u-g-throttle", "节流", { en: "Throttle", aliases: ["限流"] }),
    });
    const termInput = document.querySelector<HTMLInputElement>("#term");
    expect(termInput?.value).toBe("节流");
    expect(document.querySelector<HTMLInputElement>("#en")?.value).toBe("Throttle");
  });

  it("保存时把改后的词条交给写通道（id 不变）", async () => {
    const { save, onSaved } = renderDrawer();
    fireEvent.change(document.querySelector<HTMLInputElement>("#term") as HTMLInputElement, {
      target: { value: "节流（throttle）" },
    });
    fireEvent.click(document.querySelector(".interview-gedit__save") as HTMLElement);

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const written = save.mock.calls[0][0] as GlossaryTerm;
    expect(written.id).toBe("u-g-throttle");
    expect(written.term).toBe("节流（throttle）");
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("键冲突在本层拦住：不调写通道，并指出撞了谁", async () => {
    const { save } = renderDrawer({
      holders: [makeTerm("u-g-other", "节流")],
    });
    fireEvent.click(document.querySelector(".interview-gedit__save") as HTMLElement);

    await waitFor(() =>
      expect(document.querySelector(".interview-gedit__failures")?.textContent).toContain("重复"),
    );
    expect(save).not.toHaveBeenCalled();
  });

  it("内置词条（基线 id）不给删除按钮", () => {
    renderDrawer({ term: makeTerm("throttle", "节流") });
    expect(document.querySelector(".interview-gedit__delete")).toBeNull();
  });

  it("自建词条（u- 前缀）给删除按钮，点了把要删的词条报上去", () => {
    const { onDelete } = renderDrawer();
    const button = document.querySelector(".interview-gedit__delete") as HTMLElement;
    expect(button).not.toBeNull();
    fireEvent.click(button);
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "u-g-throttle" }));
  });

  it("写失败时不关抽屉，错误原样摆出来", async () => {
    const { onSaved } = renderDrawer({
      save: vi.fn(async (): Promise<GlossaryWriteOutcome> => ({
        ok: false,
        errors: ["保存被拒绝：database is locked"],
      })),
    });
    fireEvent.click(document.querySelector(".interview-gedit__save") as HTMLElement);
    await waitFor(() =>
      expect(document.querySelector(".interview-gedit__failures")?.textContent).toContain(
        "database is locked",
      ),
    );
    expect(onSaved).not.toHaveBeenCalled();
  });
});
