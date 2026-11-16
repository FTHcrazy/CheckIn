import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App as AntApp } from "antd";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MapDocSummaryDTO } from "@/shared/types/electron";
import MapLibraryModal from "./index";
import { useMapPersistence } from "../../persistence/useMapPersistence";
import { resetMapDocStore } from "../../store/useMapDocStore";
import { useMapFileStore } from "../../store/useMapFileStore";
import { createEmptyDocument } from "../../types";

/**
 * 地图库删除链路（复现用）。
 *
 * 与 `index.test.tsx` 的区别：那边把 `actions` 换成 `vi.fn()`，只钉弹窗自己的
 * 刷新逻辑；这边接**真的 `useMapPersistence`**，走 deleteDoc → reset → 切图 →
 * 重新拉列表的完整链路 —— 也就是用户在窗口里实际跑的那条。
 */

const docsStore: MapDocSummaryDTO[] = [];

const summary = (id: string, title: string): MapDocSummaryDTO => ({
  id,
  title,
  workId: null,
  rev: 1,
  thumb: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  openedAt: 1_700_000_000_000,
  deletedAt: null,
});

const mapApi = {
  docsList: vi.fn(async () => docsStore.filter((d) => d.deletedAt === null)),
  get: vi.fn(async (id: string) => ({
    id,
    title: docsStore.find((d) => d.id === id)?.title ?? "",
    workId: null,
    doc: { version: 2, land: null, labels: [] },
    rev: 1,
    schemaVersion: 1,
    viewport: null,
    corrupt: false,
  })),
  create: vi.fn(async () => ({ id: "doc_new", rev: 0 })),
  save: vi.fn(async () => ({ ok: true, rev: 2 })),
  flush: vi.fn(async () => ({ ok: true, rev: 2 })),
  rename: vi.fn(async () => ({ ok: true })),
  remove: vi.fn(async (id: string) => {
    const target = docsStore.find((d) => d.id === id);
    if (target) target.deletedAt = Date.now();
    return { ok: true };
  }),
  restore: vi.fn(async () => ({ ok: true })),
  purge: vi.fn(async () => ({ ok: true })),
  bind: vi.fn(async () => ({ ok: true })),
  thumb: vi.fn(async () => ({ ok: true })),
  workOptions: vi.fn(async () => []),
  revisions: vi.fn(async () => []),
  restoreRev: vi.fn(async () => ({ ok: true })),
};

function Harness() {
  const persistence = useMapPersistence();
  const [open, setOpen] = useState(true);
  // 页面里的 mounting 顺序：装载完成前 currentId 可能是 null
  useEffect(() => {}, [persistence.docId]);
  return (
    <MapLibraryModal
      open={open}
      currentId={persistence.docId}
      onClose={() => setOpen(false)}
      actions={{
        open: (id) => persistence.openDoc(id),
        create: (options) => persistence.createDoc(options),
        rename: (id, title) => persistence.renameDoc(id, title),
        remove: (id) => persistence.deleteDoc(id),
        restore: (id) => persistence.restoreDoc(id),
        purge: (id) => persistence.purgeDoc(id),
        bind: (id, workId) => persistence.bindWork(id, workId),
      }}
    />
  );
}

beforeEach(() => {
  docsStore.length = 0;
  docsStore.push(summary("doc_1", "东洲全图"), summary("doc_2", "北境详图"));
  resetMapDocStore(createEmptyDocument());
  useMapFileStore.getState().reset();
  vi.clearAllMocks();
  (window as unknown as { electronAPI: unknown }).electronAPI = { map: mapApi };
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("地图库 · 删除当前图（真实存档链路）", () => {
  it("确认后：该图消失、弹窗与二次确认都收起、当前图切到剩下那张", async () => {
    // `<AntApp>` 必须在最外层：`useMapPersistence` 自己也 `AntApp.useApp()`，
    // 少了它拿到的是 antd 的兜底空对象（message.success 直接 TypeError）——
    // 这正是线上「删完不刷新、确认框不关」的成因（见 MapWindow/app-shell.test.ts）
    render(
      <AntApp>
        <Harness />
      </AntApp>,
    );

    await waitFor(() => expect(screen.getByText("东洲全图")).toBeTruthy());
    await waitFor(() => expect(useMapFileStore.getState().docId).toBe("doc_1"));

    const row = screen.getByText("东洲全图").closest(".map-library__row") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "移入回收站" }));

    await waitFor(() => expect(document.querySelector(".ant-popconfirm")).toBeTruthy());
    const ok = document.querySelector<HTMLElement>(".ant-popconfirm .ant-btn-primary");
    await act(async () => {
      fireEvent.click(ok!);
    });

    // 列表刷新
    await waitFor(() => expect(screen.queryByText("东洲全图")).toBeNull(), { timeout: 3000 });
    // 二次确认收起
    await waitFor(() => expect(document.querySelector(".ant-popconfirm")).toBeNull(), {
      timeout: 3000,
    });
    // 当前图切走
    await waitFor(() => expect(useMapFileStore.getState().docId).toBe("doc_2"));
    expect(screen.getByText("地图库")).toBeTruthy();
  });
});
