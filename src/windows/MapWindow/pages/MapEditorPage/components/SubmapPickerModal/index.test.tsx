/**
 * SubmapPickerModal（路径 A′ 跨图选择器）的组件用例。
 *
 * 钉三件事：当前图不出现（不能绑自己）、回收站里的图不出现（随时会被彻底删）、
 * 点「绑定」把**摘要**交给 onPick（拉全量与落库是页面的事，本组件不越界）。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MapDocSummaryDTO } from "@/shared/types/electron";

const listMapDocs = vi.fn();
vi.mock("../../persistence/useMapPersistence", () => ({
  listMapDocs: (...args: unknown[]) => listMapDocs(...args),
}));

import SubmapPickerModal from "./index";

// vitest 未开 globals，RTL 的自动 cleanup 不生效：弹窗挂 body portal，
// 不清的话下一个用例会查到上一个的「绑定」按钮（Found multiple）
afterEach(() => cleanup());

function summary(overrides: Partial<MapDocSummaryDTO>): MapDocSummaryDTO {
  return {
    id: "doc_x",
    title: "某张图",
    workId: null,
    rev: 1,
    thumb: null,
    createdAt: 0,
    updatedAt: 1730000000000,
    openedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

describe("SubmapPickerModal", () => {
  it("排除当前图与回收站里的图，其余按库序展示", async () => {
    listMapDocs.mockResolvedValue([
      summary({ id: "doc_cur", title: "当前图" }),
      summary({ id: "doc_a", title: "小溪村" }),
      summary({ id: "doc_b", title: "回收站里的图", deletedAt: 1730000000000 }),
      summary({ id: "doc_c", title: "县城" }),
    ]);

    render(
      <SubmapPickerModal open currentDocId="doc_cur" onClose={() => {}} onPick={() => {}} />,
    );

    await waitFor(() => expect(screen.getByText("小溪村")).toBeTruthy());
    expect(screen.getByText("县城")).toBeTruthy();
    expect(screen.queryByText("当前图")).toBeNull();
    expect(screen.queryByText("回收站里的图")).toBeNull();
  });

  it("点「绑定」回调对应图的摘要；空库给空态提示", async () => {
    const onPick = vi.fn();
    listMapDocs.mockResolvedValue([summary({ id: "doc_a", title: "小溪村" })]);

    const { rerender } = render(
      <SubmapPickerModal open currentDocId="doc_cur" onClose={() => {}} onPick={onPick} />,
    );
    await waitFor(() => expect(screen.getByText("小溪村")).toBeTruthy());

    // antd 按钮两个汉字间会自动插一个空格（可访问名是「绑 定」），用正则匹配
    fireEvent.click(screen.getByRole("button", { name: /绑\s*定/ }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0]).toMatchObject({ id: "doc_a", title: "小溪村" });

    // 空库：Empty 占位，不渲染任何行
    listMapDocs.mockResolvedValue([]);
    rerender(
      <SubmapPickerModal open={false} currentDocId="doc_cur" onClose={() => {}} onPick={onPick} />,
    );
    rerender(
      <SubmapPickerModal open currentDocId="doc_cur" onClose={() => {}} onPick={onPick} />,
    );
    await waitFor(() => expect(screen.getByText(/地图库里还没有其他地图/)).toBeTruthy());
  });
});
