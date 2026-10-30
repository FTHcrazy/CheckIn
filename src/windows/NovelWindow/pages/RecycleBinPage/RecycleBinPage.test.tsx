import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NovelTrashItemDTO } from "@/shared/types/electron";

/**
 * 回收站页面：从「数据安全」弹窗里拆出来之后的独立页面。
 *
 * 钉的是「点了真的调到主进程那一层、且类型没串」：
 *   - 空态 / 列表 / 类型筛选 / 关键词（含所属作品）
 *   - 恢复 → restoreTrash(kind, id)（必须带 kind，否则主进程会按 id 去删错类型）
 *   - 彻底删除 → 按类型分派（work → deleteWork，volume / chapter → 各自的 purge）
 *   - 过期条目进入本页时自动清理，并按类型分派
 *   - 批量恢复 / 清空回收站
 *
 * 真 antd 组件 + 假服务层：外观不是这条链路的重点，服务调用与状态流转才是。
 */
const service = vi.hoisted(() => ({
  listTrash: vi.fn(),
  restoreTrash: vi.fn(),
  removeWork: vi.fn(),
  purgeChapter: vi.fn(),
  purgeVolume: vi.fn(),
}));

vi.mock("../NovelPage/services/novel-service", () => service);

import RecycleBinPage from "./RecycleBinPage";

const item = (over: Partial<NovelTrashItemDTO> = {}): NovelTrashItemDTO => ({
  kind: "work",
  id: "w1",
  name: "山海拾遗",
  deletedAt: new Date(2026, 9, 22, 21, 14).getTime(),
  workName: "",
  volumeName: "",
  volumes: 3,
  chapters: 15,
  words: 123456,
  daysLeft: 27,
  expired: false,
  ...over,
});

const THREE_ITEMS = [
  item({ kind: "work", id: "w1", name: "山海拾遗" }),
  item({ kind: "volume", id: "v1", name: "第二卷 · 潮汐之约", workName: "山海拾遗", chapters: 4, words: 8000, daysLeft: 3 }),
  item({ kind: "chapter", id: "c1", name: "夜行", workName: "山海拾遗", volumeName: "第二卷", words: 2100, daysLeft: 12 }),
];

function renderPage() {
  const onBack = vi.fn();
  render(
    <App>
      <RecycleBinPage onBack={onBack} />
    </App>,
  );
  return { onBack };
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
  service.listTrash.mockResolvedValue({ items: [], retentionDays: 30 });
  service.restoreTrash.mockResolvedValue(true);
  service.removeWork.mockResolvedValue(true);
  service.purgeChapter.mockResolvedValue(true);
  service.purgeVolume.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("回收站页面 · 列表", () => {
  it("空回收站给明确空态，并说明保留期与出口", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("回收站是空的")).toBeTruthy());
    expect(screen.getByText(/30 天内都可以原样找回/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "回到书架" })).toBeTruthy();
  });

  it("三类条目都带类型标签、归属与剩余天数", async () => {
    service.listTrash.mockResolvedValue({ items: THREE_ITEMS, retentionDays: 30 });
    renderPage();
    await waitFor(() => expect(screen.getByText("山海拾遗")).toBeTruthy());

    const kinds = Array.from(document.querySelectorAll(".rb-row__kind")).map(
      (node) => node.textContent,
    );
    expect(kinds).toEqual(["作品", "卷", "章节"]);
    expect(screen.getByText(/《山海拾遗》· 4 章 · 8,000 字/)).toBeTruthy();
    expect(screen.getByText(/《山海拾遗》· 第二卷 · 2,100 字/)).toBeTruthy();
    expect(screen.getByText("剩 27 天")).toBeTruthy();
    // 3 天内转警示档（与刚删的不能长得一样）
    expect(screen.getByText("剩 3 天").className).toContain("--soon");
  });

  it("类型筛选只留该类型（计数也跟着总数走）", async () => {
    service.listTrash.mockResolvedValue({ items: THREE_ITEMS, retentionDays: 30 });
    renderPage();
    await waitFor(() => expect(screen.getByText("全部 3")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByText("章节 1"));
    });
    expect(screen.getByText("夜行")).toBeTruthy();
    expect(screen.queryByText("第二卷 · 潮汐之约")).toBeNull();
    expect(screen.getByText("共 1 项")).toBeTruthy();
  });

  it("关键词同时搜条目名与所属作品名", async () => {
    service.listTrash.mockResolvedValue({
      items: [
        ...THREE_ITEMS,
        item({ kind: "chapter", id: "c9", name: "雾港", workName: "长夜将尽", words: 900 }),
      ],
      retentionDays: 30,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText("雾港")).toBeTruthy());

    const search = screen.getByPlaceholderText("搜索名称或所属作品");
    await act(async () => {
      fireEvent.change(search, { target: { value: "长夜" } });
    });
    expect(screen.getByText("雾港")).toBeTruthy();
    expect(screen.queryByText("夜行")).toBeNull();
  });
});

describe("回收站页面 · 单条操作", () => {
  it("恢复把 kind 一起传给主进程，并重新拉列表", async () => {
    service.listTrash.mockResolvedValue({ items: [THREE_ITEMS[2]!], retentionDays: 30 });
    renderPage();
    await waitFor(() => expect(screen.getByText("夜行")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /恢复$/ }));
    });
    await waitFor(() => {
      expect(service.restoreTrash).toHaveBeenCalledWith("chapter", "c1");
    });
    // 首次装载 + 操作后刷新
    expect(service.listTrash).toHaveBeenCalledTimes(2);
  });

  it("彻底删除按类型分派：卷走 purgeVolume，不走「删作品」那条级联", async () => {
    service.listTrash.mockResolvedValue({ items: [THREE_ITEMS[1]!], retentionDays: 30 });
    renderPage();
    await waitFor(() => expect(screen.getByText("第二卷 · 潮汐之约")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /彻底删除/ }));
    });
    await confirmPopconfirm();

    await waitFor(() => expect(service.purgeVolume).toHaveBeenCalledWith("v1"));
    expect(service.removeWork).not.toHaveBeenCalled();
  });

  it("作品条目的彻底删除仍走 novel-work-delete（唯一那条叶→根事务）", async () => {
    service.listTrash.mockResolvedValue({ items: [THREE_ITEMS[0]!], retentionDays: 30 });
    renderPage();
    await waitFor(() => expect(screen.getByText("山海拾遗")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /彻底删除/ }));
    });
    await confirmPopconfirm();

    await waitFor(() => expect(service.removeWork).toHaveBeenCalledWith("w1"));
    expect(service.purgeVolume).not.toHaveBeenCalled();
  });
});

describe("回收站页面 · 批量与过期清理", () => {
  it("全选后批量恢复：逐条带回，选中态清空", async () => {
    service.listTrash.mockResolvedValue({ items: THREE_ITEMS, retentionDays: 30 });
    renderPage();
    await waitFor(() => expect(screen.getByText("山海拾遗")).toBeTruthy());

    const boxes = screen.getAllByRole("checkbox");
    await act(async () => {
      fireEvent.click(boxes[0]!);
    });
    expect(screen.getByText("已选 3 项")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /批量恢复/ }));
    });
    await waitFor(() => expect(service.restoreTrash).toHaveBeenCalledTimes(3));
    expect(service.restoreTrash).toHaveBeenCalledWith("work", "w1");
    expect(service.restoreTrash).toHaveBeenCalledWith("volume", "v1");
    expect(service.restoreTrash).toHaveBeenCalledWith("chapter", "c1");
    await waitFor(() => expect(screen.queryByText(/已选 3 项/)).toBeNull());
  });

  it("清空回收站：确认后逐条彻底删除，列表落到空态", async () => {
    service.listTrash
      .mockResolvedValueOnce({ items: THREE_ITEMS, retentionDays: 30 })
      .mockResolvedValue({ items: [], retentionDays: 30 });
    renderPage();
    await waitFor(() => expect(screen.getByText("山海拾遗")).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /清空回收站/ }));
    });
    await confirmPopconfirm();

    await waitFor(() => expect(service.removeWork).toHaveBeenCalledWith("w1"));
    expect(service.purgeVolume).toHaveBeenCalledWith("v1");
    expect(service.purgeChapter).toHaveBeenCalledWith("c1");
    await waitFor(() => expect(screen.getByText("回收站是空的")).toBeTruthy());
  });

  it("已过保留期的条目在进入本页时自动彻底删除，并按类型分派", async () => {
    service.listTrash
      .mockResolvedValueOnce({
        items: [
          item({ kind: "volume", id: "v1", expired: true, daysLeft: 0 }),
          item({ kind: "chapter", id: "c1", expired: true, daysLeft: 0 }),
        ],
        retentionDays: 30,
      })
      .mockResolvedValue({ items: [], retentionDays: 30 });

    renderPage();
    await waitFor(() => expect(service.purgeVolume).toHaveBeenCalledWith("v1"));
    expect(service.purgeChapter).toHaveBeenCalledWith("c1");
    expect(service.removeWork).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText("回收站是空的")).toBeTruthy());
  });

  it("空回收站时「清空回收站」不可点（避免点出一次没有意义的确认框）", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText("回收站是空的")).toBeTruthy());
    const btn = screen.getByRole("button", { name: /清空回收站/ });
    expect(btn.hasAttribute("disabled") || btn.getAttribute("aria-disabled")).toBeTruthy();
  });

  it("返回书架交给上层（页面不自己动路由）", async () => {
    const { onBack } = renderPage();
    await waitFor(() => expect(screen.getByText("回收站是空的")).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "返回书架" }));
    });
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
