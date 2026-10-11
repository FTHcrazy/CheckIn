import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 宽度持久化走 IPC，测试里不需要真实现
vi.mock("../services/novel-service", () => ({
  fetchPanelWidth: vi.fn(async () => null),
  savePanelWidth: vi.fn(async () => true),
}));

const { useNovelViewState } = await import("./useNovelViewState");

describe("useNovelViewState · 打开要素详情时切回「要素」tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("右栏停在别的 tab 时，openEntityDetail 把它切回 entity", () => {
    const { result } = renderHook(() => useNovelViewState());

    act(() => result.current.selectPanelTab("note"));
    expect(result.current.panelTab).toBe("note");

    act(() => result.current.openEntityDetail("e1"));

    // 这三件事必须一起发生：tab 切回、详情有值、右栏打开
    expect(result.current.panelTab).toBe("entity");
    expect(result.current.detailEntityId).toBe("e1");
    expect(result.current.rightOpen).toBe(true);
  });

  it("搜索 / 工具 tab 同理（正文高亮点了就有反应）", () => {
    const { result } = renderHook(() => useNovelViewState());

    for (const tab of ["outline", "search", "tools"] as const) {
      act(() => result.current.selectPanelTab(tab));
      act(() => result.current.openEntityDetail("e2"));
      expect(result.current.panelTab, tab).toBe("entity");
      expect(result.current.detailEntityId).toBe("e2");
      expect(result.current.rightOpen).toBe(true);
    }
  });

  it("换成另一个要素时也保持在要素 tab", () => {
    const { result } = renderHook(() => useNovelViewState());

    act(() => result.current.openEntityDetail("e1"));
    act(() => result.current.selectPanelTab("tools"));
    act(() => result.current.openEntityDetail("e2"));

    expect(result.current.panelTab).toBe("entity");
    expect(result.current.detailEntityId).toBe("e2");
  });

  it("closeEntityDetail 只清详情，不动 tab 与右栏开关", () => {
    const { result } = renderHook(() => useNovelViewState());

    act(() => result.current.openEntityDetail("e1"));
    act(() => result.current.closeEntityDetail());

    expect(result.current.detailEntityId).toBeNull();
    expect(result.current.panelTab).toBe("entity");
    expect(result.current.rightOpen).toBe(true);
  });
});
