import { act, renderHook } from "@testing-library/react";
import { App } from "antd";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NovelChapterDTO, NovelVolumeDTO } from "@/shared/types/electron";
import type { WorkCardView, ShelfNumberStyle } from "../bookshelf-utils";

/**
 * 书架右键五项动作的行为守卫（2.56.0）。
 *
 * 服务层整体 mock，只钉「点一下真的落到哪条通道、数据补丁带什么」：
 * 重命名 / 题材 / 删除走与编辑器同名的 IPC，封面只把成品 data URL
 * 回灌书架，导出必须与编辑器「导出整本」共用 shared 的文本拼装口径。
 */
const service = vi.hoisted(() => ({
  exportShelfTextFile: vi.fn(),
  fetchShelfWorkContent: vi.fn(),
  pickShelfWorkCover: vi.fn(),
  renameShelfWork: vi.fn(),
  setShelfWorkGenre: vi.fn(),
  trashShelfWork: vi.fn(),
}));

vi.mock("../services/bookshelf-service", () => service);

const { useShelfWorkActions } = await import("./useShelfWorkActions");

const card: WorkCardView = {
  id: "w1",
  name: "山海拾遗",
  genre: "仙侠",
  createdAt: 1,
  totalWords: 1200,
  chapterCount: 1,
  doneCount: 0,
  volumeCount: 1,
  updatedAt: 2,
  status: "ongoing",
};

const style: ShelfNumberStyle = {
  numberStyle: "chinese",
  chapterSuffix: "章",
  volumeSuffix: "卷",
  dailyGoal: 3000,
  paragraphIndent: true,
};

const volume: NovelVolumeDTO = { id: "v1", workId: "w1", name: "未命名卷", sort: 1 };
const chapter: NovelChapterDTO = {
  id: "c1",
  workId: "w1",
  volumeId: "v1",
  title: "灵潮起",
  content: "潮起东海。\n第二段。",
  wordCount: 10,
  status: "draft",
  sort: 1,
  updatedAt: 2,
};

const wrapper = ({ children }: { children: ReactNode }) => <App>{children}</App>;

function setup() {
  const patchWork = vi.fn();
  const removeWork = vi.fn();
  const refresh = vi.fn(async () => undefined);
  const onTrashed = vi.fn();
  const { result } = renderHook(
    () =>
      useShelfWorkActions({
        cards: [card],
        style,
        numberingMap: {},
        patchWork,
        removeWork,
        refresh,
        onTrashed,
      }),
    { wrapper },
  );
  return { result, patchWork, removeWork, refresh, onTrashed };
}

/** 打开菜单后再调动作：activeWork 依赖 target 存在 */
async function openMenu(result: { current: ReturnType<typeof useShelfWorkActions> }) {
  act(() => result.current.openMenu("w1", 100, 120));
}

beforeEach(() => {
  vi.clearAllMocks();
  service.renameShelfWork.mockResolvedValue(true);
  service.setShelfWorkGenre.mockResolvedValue(true);
  service.pickShelfWorkCover.mockResolvedValue("data:image/jpeg;base64,AAA");
  service.trashShelfWork.mockResolvedValue(true);
  service.fetchShelfWorkContent.mockResolvedValue({
    volumes: [volume],
    chapters: [chapter],
  });
  service.exportShelfTextFile.mockResolvedValue({ path: "D:/books/山海拾遗.txt" });
});

describe("useShelfWorkActions：右键动作", () => {
  it("打开菜单能定位到那本书；Esc 之外由菜单组件负责收起", () => {
    const { result } = setup();
    act(() => result.current.openMenu("w1", 100, 120));

    expect(result.current.menuVisible).toBe(true);
    expect(result.current.activeWork?.name).toBe("山海拾遗");
  });

  it("重命名走 novel-work-rename，并回灌书名 + 广播", async () => {
    const { result, patchWork } = setup();
    await openMenu(result);
    act(() => result.current.openRename());
    act(() => result.current.setNameDraft("  山海拾遗·修订版  "));
    await act(async () => {
      await result.current.confirmName();
    });

    expect(service.renameShelfWork).toHaveBeenCalledWith("w1", "山海拾遗·修订版");
    expect(patchWork).toHaveBeenCalledWith("w1", { name: "山海拾遗·修订版" });
    expect(result.current.menuVisible).toBe(false);
  });

  it("空书名不落库、留在弹框里报错", async () => {
    const { result, patchWork } = setup();
    await openMenu(result);
    act(() => result.current.openRename());
    act(() => result.current.setNameDraft("   "));
    await act(async () => {
      await result.current.confirmName();
    });

    expect(service.renameShelfWork).not.toHaveBeenCalled();
    expect(patchWork).not.toHaveBeenCalled();
    expect(result.current.nameError).not.toBe("");
  });

  it("题材留空保存 = 清除题材", async () => {
    const { result, patchWork } = setup();
    await openMenu(result);
    act(() => result.current.openGenre());
    act(() => result.current.setGenreDraft(""));
    await act(async () => {
      await result.current.confirmGenre();
    });

    expect(service.setShelfWorkGenre).toHaveBeenCalledWith("w1", "");
    expect(patchWork).toHaveBeenCalledWith("w1", { genre: undefined });
  });

  it("导入封面只回灌主进程压好的 data URL；取消选图不提示失败", async () => {
    const { result, patchWork } = setup();
    await openMenu(result);
    await act(async () => {
      await result.current.pickCover();
    });

    expect(service.pickShelfWorkCover).toHaveBeenCalledWith("w1");
    expect(patchWork).toHaveBeenCalledWith("w1", {
      cover: "data:image/jpeg;base64,AAA",
    });

    service.pickShelfWorkCover.mockResolvedValueOnce(null);
    patchWork.mockClear();
    await openMenu(result);
    await act(async () => {
      await result.current.pickCover();
    });
    expect(patchWork).not.toHaveBeenCalled();
  });

  it("导出当前作品：只拉单书卷章，文本与编辑器整本导出同源", async () => {
    const { result } = setup();
    await openMenu(result);
    await act(async () => {
      await result.current.exportWork();
    });

    expect(service.fetchShelfWorkContent).toHaveBeenCalledWith("w1");
    const [defaultName, content] = service.exportShelfTextFile.mock.calls[0] as [
      string,
      string,
    ];
    expect(defaultName).toBe("山海拾遗.txt");
    expect(content).toContain("《山海拾遗》");
    expect(content).toContain("第一章 灵潮起");
    expect(content).toContain("\u3000\u3000潮起东海。");
  });

  it("空作品不弹保存框，只提示还没章节", async () => {
    service.fetchShelfWorkContent.mockResolvedValueOnce({ volumes: [], chapters: [] });
    const { result } = setup();
    await openMenu(result);
    await act(async () => {
      await result.current.exportWork();
    });

    expect(service.exportShelfTextFile).not.toHaveBeenCalled();
  });

  it("删除 = 移入回收站，摘掉书卡后刷新整包", async () => {
    const { result, removeWork, refresh } = setup();
    await openMenu(result);
    act(() => result.current.openDelete());
    await act(async () => {
      await result.current.confirmDelete();
    });

    expect(service.trashShelfWork).toHaveBeenCalledWith("w1");
    expect(removeWork).toHaveBeenCalledWith("w1");
    expect(refresh).toHaveBeenCalledWith(true);
  });

  /* 2.57.1：页脚角标不再「进一次回收站才更新」——删成功当场通知一次 */
  it("删除成功后通知回收站角标重算（不必等页面重新可见）", async () => {
    const { result, onTrashed } = setup();
    await openMenu(result);
    act(() => result.current.openDelete());
    await act(async () => {
      await result.current.confirmDelete();
    });

    expect(onTrashed).toHaveBeenCalledTimes(1);
  });

  it("删除失败时不动角标（数字只跟真实结果走）", async () => {
    service.trashShelfWork.mockResolvedValue(false);
    const { result, onTrashed, removeWork } = setup();
    await openMenu(result);
    act(() => result.current.openDelete());
    await act(async () => {
      await result.current.confirmDelete();
    });

    expect(removeWork).not.toHaveBeenCalled();
    expect(onTrashed).not.toHaveBeenCalled();
  });
});
