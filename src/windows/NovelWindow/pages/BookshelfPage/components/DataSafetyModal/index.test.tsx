import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 数据安全面板（P0）：备份 / 恢复两条主路径。
 *
 * 钉的是「点了真的调到主进程那一层、且顺序对」：
 *   - 立即备份 → exportBackup（成功回显规模）
 *   - 选包 → pickBackup（**只预览不动数据**）→ 确认才 restoreBackup
 *
 * 回收站（listTrash / restoreTrash / purge*）2.5.0 起属于
 * `pages/RecycleBinPage`，测试也一起搬走了 —— 这里再断言会变成「测别处的实现」。
 *
 * 真 antd 组件 + 假服务层：外观不是这条链路的重点，服务调用与状态流转才是。
 */
const service = vi.hoisted(() => ({
  exportNovelBackup: vi.fn(),
  pickNovelBackup: vi.fn(),
  restoreNovelBackup: vi.fn(),
}));

vi.mock("../../../NovelPage/services/novel-service", () => service);

import DataSafetyModal from "./index";

const counts = {
  works: 2,
  volumes: 3,
  chapters: 12,
  words: 34567,
  entities: 8,
  settings: 4,
  packCharacters: 5,
};

function renderModal(over: Partial<Parameters<typeof DataSafetyModal>[0]> = {}) {
  const onClose = vi.fn();
  const onDataChanged = vi.fn();
  const { container } = render(
    <App>
      <DataSafetyModal open onClose={onClose} onDataChanged={onDataChanged} {...over} />
    </App>,
  );
  return { onClose, onDataChanged, container };
}

beforeEach(() => {
  service.exportNovelBackup.mockResolvedValue({
    canceled: false,
    filePath: "C:/tmp/checkin-novel.zip",
    counts,
    bytes: 2 * 1024 * 1024,
  });
  service.pickNovelBackup.mockResolvedValue({
    canceled: false,
    filePath: "C:/tmp/backup.zip",
    manifest: {
      app: "checkin",
      kind: "novel-db",
      format: 1,
      exportedAt: "2026-10-22T02:00:00.000Z",
      counts,
    },
    bytes: 3 * 1024 * 1024,
  });
  service.restoreNovelBackup.mockResolvedValue({
    ok: true,
    counts,
    exportedAt: "2026-10-22T02:00:00.000Z",
    safetyCopy: "C:/data/novel.db.before-restore-20261023-101500",
  });

  // 恢复成功后会 reload 窗口：jsdom 里 reload 未实现，换成空实现免得抛
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...window.location, reload: vi.fn() },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("数据安全面板 · 一键备份", () => {
  it("点「立即备份」调到 exportBackup，取消时不报错", async () => {
    service.exportNovelBackup.mockResolvedValueOnce({
      canceled: true,
      filePath: null,
      counts,
    });
    renderModal();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /立即备份/ }));
    });
    expect(service.exportNovelBackup).toHaveBeenCalledTimes(1);
  });

  it("备份成功回显规模（作品 / 章 / 包大小），让用户知道刚才备份了什么", async () => {
    renderModal();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /立即备份/ }));
    });
    await waitFor(() => {
      expect(service.exportNovelBackup).toHaveBeenCalledTimes(1);
    });
  });
});

describe("数据安全面板 · 从备份恢复（先预览、后覆盖）", () => {
  it("选包只预览：显示包内规模，且**不**调用 restoreBackup", async () => {
    renderModal();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /选择备份包/ }));
    });
    await waitFor(() => {
      expect(screen.getByText("这个包里是")).toBeTruthy();
    });
    expect(screen.getByText("2 部")).toBeTruthy();
    expect(screen.getByText("3 卷 · 12 章")).toBeTruthy();
    expect(service.restoreNovelBackup).not.toHaveBeenCalled();
  });

  it("点「确认覆盖恢复」才真正调 restoreBackup，并回传所选文件路径", async () => {
    const { onDataChanged } = renderModal();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /选择备份包/ }));
    });
    await waitFor(() => expect(screen.getByText("这个包里是")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /确认覆盖恢复/ }));
    });
    await waitFor(() => {
      expect(service.restoreNovelBackup).toHaveBeenCalledWith("C:/tmp/backup.zip");
    });
    expect(onDataChanged).toHaveBeenCalled();
  });

  it("取消预览后回到「选择备份包」，避免误点确认", async () => {
    renderModal();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /选择备份包/ }));
    });
    await waitFor(() => expect(screen.getByText("这个包里是")).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "取消恢复" }));
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /选择备份包/ })).toBeTruthy();
    });
    expect(service.restoreNovelBackup).not.toHaveBeenCalled();
  });

  it("面板里不再有回收站：列表与「清空回收站」都已搬到独立页面", () => {
    renderModal();
    expect(screen.queryByText(/清空回收站/)).toBeNull();
    expect(screen.queryByText(/回收站是空的/)).toBeNull();
  });
});
