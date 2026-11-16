import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MapDocSummaryDTO } from "@/shared/types/electron";
import MapLibraryModal from "./index";

/**
 * 地图库弹窗（MapLibraryModal）行为用例。
 *
 * 钉的是「列表写操作之后真的要刷新、且删当前图不误关弹窗」这条链路上的静默缺陷：
 * 旧代码在删除当前图时 `onClose()`，弹窗一关，`await load()` 作用在已卸载组件上，
 * 用户看不到「被删图消失、新当前图带『当前』标记」，只能关掉再开才"刷新"。
 */

const mapApi = vi.hoisted(() => ({
  docsList: vi.fn(),
  workOptions: vi.fn(),
}));

/** 组件只通过 `window.electronAPI.map` 拉列表（listMapDocs/listMapWorkOptions 内部） */
function installMapApi(): void {
  (window as unknown as { electronAPI: unknown }).electronAPI = { map: mapApi };
}

const doc = (over: Partial<MapDocSummaryDTO> = {}): MapDocSummaryDTO => ({
  id: "doc_1",
  title: "东洲全图",
  workId: null,
  rev: 1,
  thumb: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  openedAt: 1_700_000_000_000,
  deletedAt: null,
  ...over,
});

const ACTIONS = {
  open: vi.fn(),
  create: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  purge: vi.fn(),
  bind: vi.fn(),
};

function renderModal(currentId: string | null, onClose = vi.fn()) {
  render(
    <App>
      <MapLibraryModal open currentId={currentId} onClose={onClose} actions={ACTIONS} />
    </App>,
  );
  return { onClose };
}

/** Popconfirm 的确认按钮挂在 body portal 上（容器里查不到） */
async function confirmPopconfirm(): Promise<void> {
  await waitFor(() => {
    expect(document.querySelector(".ant-popconfirm")).toBeTruthy();
  });
  const ok = document.querySelector<HTMLElement>(".ant-popconfirm .ant-btn-primary");
  expect(ok).toBeTruthy();
  await act(async () => {
    fireEvent.click(ok!);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mapApi.workOptions.mockResolvedValue([]);
  ACTIONS.remove.mockResolvedValue(undefined);
  installMapApi();
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("MapLibraryModal · 删除后刷新", () => {
  it("删除当前图：列表里该图消失、弹窗仍打开（onClose 不被调用）", async () => {
    // 初始三张；删除后 docsList 返回剩下的两张（模拟主进程删完再查）
    let docs: MapDocSummaryDTO[] = [
      doc({ id: "doc_1", title: "东洲全图" }),
      doc({ id: "doc_2", title: "北境详图" }),
      doc({ id: "doc_3", title: "南疆速写" }),
    ];
    mapApi.docsList.mockImplementation(async () => docs);
    ACTIONS.remove.mockImplementation(async (id: string) => {
      docs = docs.filter((d) => d.id !== id);
    });

    const { onClose } = renderModal("doc_1");
    await waitFor(() => expect(screen.getByText("东洲全图")).toBeTruthy());
    expect(screen.getByText("北境详图")).toBeTruthy();

    // 点当前图那行的「移入回收站」触发 Popconfirm
    const row = screen.getByText("东洲全图").closest(".map-library__row") as HTMLElement;
    const deleteBtn = within(row).getByRole("button", { name: "移入回收站" });
    fireEvent.click(deleteBtn);

    await confirmPopconfirm();

    // 删除后：被删图消失、其余图还在；弹窗未关（onClose 没被调，标题仍在）
    await waitFor(() => expect(screen.queryByText("东洲全图")).toBeNull());
    expect(screen.getByText("北境详图")).toBeTruthy();
    expect(screen.getByText("南疆速写")).toBeTruthy();
    expect(ACTIONS.remove).toHaveBeenCalledWith("doc_1");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("地图库")).toBeTruthy();
  });

  it("删除非当前图：同样不关弹窗，列表刷新", async () => {
    let docs: MapDocSummaryDTO[] = [
      doc({ id: "doc_1", title: "东洲全图" }),
      doc({ id: "doc_2", title: "北境详图" }),
    ];
    mapApi.docsList.mockImplementation(async () => docs);
    ACTIONS.remove.mockImplementation(async (id: string) => {
      docs = docs.filter((d) => d.id !== id);
    });

    const { onClose } = renderModal("doc_1");
    await waitFor(() => expect(screen.getByText("北境详图")).toBeTruthy());

    const row = screen.getByText("北境详图").closest(".map-library__row") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "移入回收站" }));
    await confirmPopconfirm();

    await waitFor(() => expect(screen.queryByText("北境详图")).toBeNull());
    expect(screen.getByText("东洲全图")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
