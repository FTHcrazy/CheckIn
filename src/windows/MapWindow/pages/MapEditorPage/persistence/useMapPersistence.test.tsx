import { act, cleanup, render, waitFor } from "@testing-library/react";
import { App as AntApp } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMapPersistence, type MapPersistenceApi } from "./useMapPersistence";
import { resetMapDocStore, useMapDocStore } from "../store/useMapDocStore";
import { useMapFileStore } from "../store/useMapFileStore";
import { createEmptyDocument } from "../types";

/**
 * 存档编排的行为用例（不 mock React，直接跑真 hook）。
 *
 * 钉住三件"只在特定时序下错、且静默"的事：
 * 1. 装载**不触发保存**（否则打开旧图会立刻以新图身份覆盖它）；
 * 2. 保存成功后 `rev` 同步（漏一次，下一次保存必冲突）；
 * 3. 关窗请求必须**回执**（不回执，窗口要干等 1.5s 超时才消失）。
 */

const mapApi = {
  docsList: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  save: vi.fn(),
  flush: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  purge: vi.fn(),
  bind: vi.fn(),
  thumb: vi.fn(),
  workOptions: vi.fn(),
  revisions: vi.fn(),
  restoreRev: vi.fn(),
};

/** 主进程「取快照」请求的接收器（hook 在 effect 里注册） */
let snapshotHandler: (() => void) | null = null;
/** 渲染层发出的消息（验证 flush 回执） */
const sentMessages: Array<{ channel: string; data: unknown }> = [];

const SUMMARY = {
  id: "mp_1",
  title: "东洲全图",
  workId: null,
  rev: 7,
  thumb: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  openedAt: 1_700_000_000_000,
  deletedAt: null,
};

function Harness({ onReady }: { onReady: (api: MapPersistenceApi) => void }) {
  const api = useMapPersistence();
  onReady(api);
  return null;
}

function renderHarness(onReady: (api: MapPersistenceApi) => void) {
  return render(
    <AntApp>
      <Harness onReady={onReady} />
    </AntApp>,
  );
}

beforeEach(() => {
  resetMapDocStore(createEmptyDocument());
  useMapFileStore.getState().reset();
  snapshotHandler = null;
  sentMessages.length = 0;
  vi.clearAllMocks();
  mapApi.docsList.mockResolvedValue([]);
  mapApi.save.mockResolvedValue({ ok: true, rev: 1 });
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    map: mapApi,
    receive: (channel: string, handler: () => void) => {
      if (channel === "map-doc-request-snapshot") snapshotHandler = handler;
      return () => {
        if (channel === "map-doc-request-snapshot") snapshotHandler = null;
      };
    },
    send: (channel: string, data: unknown) => {
      sentMessages.push({ channel, data });
    },
  };
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe("地图存档编排", () => {
  /**
   * ⚠️ 这个用例必须排在第一个：启动装载是模块级单例（`startupPromise`），
   * 跑过之后同一文件内的后续用例不会再触发装载。
   */
  it("启动：打开最近一张，且装载本身不触发保存", async () => {
    mapApi.docsList.mockResolvedValue([SUMMARY]);
    mapApi.get.mockResolvedValue({
      id: SUMMARY.id,
      title: SUMMARY.title,
      workId: null,
      doc: {
        version: 2,
        land: null,
        labels: [{ id: "lb_1", text: "沧澜国", x: 1, y: 2, size: 12, level: null }],
      },
      rev: SUMMARY.rev,
      schemaVersion: 1,
      viewport: { x: 10, y: 20, scale: 1.5 },
      corrupt: false,
    });

    let api: MapPersistenceApi | null = null;
    renderHarness((next) => {
      api = next;
    });

    await waitFor(() => expect(useMapFileStore.getState().docId).toBe("mp_1"));
    expect(useMapDocStore.getState().doc.labels).toHaveLength(1);
    expect(useMapFileStore.getState().rev).toBe(7);
    expect(useMapFileStore.getState().status).toBe("saved");
    expect(useMapFileStore.getState().loaded).toBe(true);
    // 装载期间 resetMapDocStore 会触发订阅：这里必须**没有**任何写盘
    expect(mapApi.save).not.toHaveBeenCalled();
    expect(mapApi.create).not.toHaveBeenCalled();
    // 存档视口交给页面落位（hook 只负责取走一次）
    expect(api!.takePendingViewport()).toEqual({ x: 10, y: 20, scale: 1.5 });
    expect(api!.takePendingViewport()).toBeNull();
  });

  it("编辑后 800ms 防抖写一次，并把新 rev 同步进 store", async () => {
    useMapFileStore.getState().markLoaded();
    useMapFileStore.getState().openFile({ id: "mp_2", title: "北境", workId: null, rev: 3 });
    mapApi.save.mockResolvedValue({ ok: true, rev: 4 });

    renderHarness(() => {});

    act(() => {
      useMapDocStore.getState().addLabel({ x: 0, y: 0, text: "云梦泽", level: null });
    });
    expect(useMapFileStore.getState().status).toBe("dirty");

    await waitFor(() => expect(mapApi.save).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(mapApi.save.mock.calls[0][0]).toMatchObject({ id: "mp_2", baseRev: 3 });
    // rev 没有同步的话，第二次保存必然"冲突"（且用户完全不知道原因）
    await waitFor(() => expect(useMapFileStore.getState().rev).toBe(4));
    expect(useMapFileStore.getState().status).toBe("saved");
  });

  it("关窗请求：不冲突时走 save，且一定回执 flush-done", async () => {
    useMapFileStore.getState().markLoaded();
    useMapFileStore.getState().openFile({ id: "mp_3", title: "南疆", workId: null, rev: 1 });
    mapApi.save.mockResolvedValue({ ok: true, rev: 2 });

    renderHarness(() => {});
    // 请求接收器是在 effect 里注册的：等它出现再触发
    await waitFor(() => expect(snapshotHandler).not.toBeNull());

    act(() => {
      snapshotHandler?.();
    });

    await waitFor(() => expect(mapApi.flush).toHaveBeenCalledTimes(1));
    // 关窗路径是**强写**（用 flush 而不是 save）：不能把用户卡在"选择框"里
    expect(mapApi.flush.mock.calls[0][0]).toMatchObject({ id: "mp_3", baseRev: 1 });
    await waitFor(() =>
      expect(sentMessages.some((item) => item.channel === "map-doc-flush-done")).toBe(true),
    );
  });
});
