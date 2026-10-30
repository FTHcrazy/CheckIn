/**
 * 「新建关系」二次确认弹层（R27 / S3 / W-13）
 *
 * 验收口径就是「五项必须同时可见」，所以断言按内容而不是按 DOM 结构：
 * 起点、终点、关系名、重复判定、写入目标，缺一项用户就没法复核自己要写什么。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RelationCreateDialog, { RELATION_NAME_MAX } from "./index";
import type { DraftEndpoint } from "../../utils/relation-draft";

afterEach(cleanup);

const source: DraftEndpoint = {
  id: "e1",
  name: "林晚",
  type: "character",
  typeLabel: "角色",
  workId: "w1",
};

const target: DraftEndpoint = {
  id: "e2",
  name: "青云镇",
  type: "location",
  typeLabel: "地点",
  workId: "w1",
};

function renderDialog(over: Partial<Parameters<typeof RelationCreateDialog>[0]> = {}) {
  const props = {
    open: true,
    source,
    target,
    existingRelations: [] as string[],
    knownRelations: ["同门", "师徒"],
    workName: "长夜行",
    submitting: false,
    error: null,
    stale: false,
    onCancel: vi.fn(),
    onSubmit: vi.fn(),
    onReload: vi.fn(),
    ...over,
  };
  render(<RelationCreateDialog {...props} />);
  return props;
}

function relationInput(): HTMLInputElement {
  return screen.getByPlaceholderText("例如：师徒 / 宿敌 / 出身") as HTMLInputElement;
}

describe("五项内容契约", () => {
  it("起点 / 终点都带名称与类型", async () => {
    renderDialog();
    expect(await screen.findByText("林晚")).toBeTruthy();
    expect(screen.getByText("青云镇")).toBeTruthy();
    expect(screen.getByText("角色")).toBeTruthy();
    expect(screen.getByText("地点")).toBeTruthy();
  });

  it("写入目标作品可见（跨作品是硬阻断，但目标必须让用户看见）", async () => {
    renderDialog();
    expect(await screen.findByText(/长夜行/)).toBeTruthy();
  });

  it("关系名是必填输入，且限制长度", async () => {
    renderDialog();
    const input = await screen.findByPlaceholderText("例如：师徒 / 宿敌 / 出身");
    expect(input).toBeTruthy();
    expect(relationInput().maxLength).toBe(RELATION_NAME_MAX);
  });

  it("确认按钮文案就是「创建关系」", async () => {
    renderDialog();
    expect(await screen.findByRole("button", { name: "创建关系" })).toBeTruthy();
  });
});

describe("校验", () => {
  it("空名不能提交", async () => {
    renderDialog();
    const ok = (await screen.findByRole("button", { name: "创建关系" })) as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    expect(screen.getByText("关系名不能为空")).toBeTruthy();
  });

  it("输入后按钮可用，点确认把清洗后的关系名交出去", async () => {
    const props = renderDialog();
    const input = relationInput();
    fireEvent.change(input, { target: { value: "  师徒 " } });
    const ok = (await screen.findByRole("button", { name: "创建关系" })) as HTMLButtonElement;
    expect(ok.disabled).toBe(false);
    fireEvent.click(ok);
    expect(props.onSubmit).toHaveBeenCalledWith("师徒", false);
  });

  it("同关系名已存在：红字提示 + 「合并为 X +1」，但仍可提交", async () => {
    const props = renderDialog({ existingRelations: ["同门"] });
    fireEvent.change(relationInput(), { target: { value: "同门" } });

    expect(await screen.findByText(/这对要素已有「同门」关系/)).toBeTruthy();
    expect(screen.getByText("已存在同关系（合并为「同门 +1」）")).toBeTruthy();

    const ok = (await screen.findByRole("button", { name: "创建关系" })) as HTMLButtonElement;
    expect(ok.disabled).toBe(false);
    fireEvent.click(ok);
    expect(props.onSubmit).toHaveBeenCalledWith("同门", true);
  });

  it("没有重复时判定显示「将新建」", async () => {
    renderDialog();
    fireEvent.change(relationInput(), { target: { value: "师徒" } });
    expect(await screen.findByText("将新建")).toBeTruthy();
  });
});

describe("失败态", () => {
  it("错误展示在弹层内，弹层不关、按钮仍可点", async () => {
    renderDialog({ error: "创建失败：disk I/O error" });
    expect(await screen.findByText("创建失败：disk I/O error")).toBeTruthy();
    fireEvent.change(relationInput(), { target: { value: "师徒" } });
    const ok = (await screen.findByRole("button", { name: "创建关系" })) as HTMLButtonElement;
    expect(ok.disabled).toBe(false);
  });

  it("stale 时提供「重新载入」，且提交期间按钮进入 loading（不可重复点）", async () => {
    const props = renderDialog({ error: "这本书的图已在别处改过", stale: true });
    fireEvent.click(await screen.findByRole("button", { name: "重新载入" }));
    expect(props.onReload).toHaveBeenCalledTimes(1);
  });

  it("提交中按钮 loading（连点在组件层也不会重复触发）", async () => {
    const props = renderDialog({ submitting: true });
    fireEvent.change(relationInput(), { target: { value: "师徒" } });
    // loading 态的可访问名会带上 "loading"（antd 的 loading 图标 aria-label）
    const ok = (await screen.findByRole("button", { name: /创建关系/ })) as HTMLButtonElement;
    fireEvent.click(ok);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
});
