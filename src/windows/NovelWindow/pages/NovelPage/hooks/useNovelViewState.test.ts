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

describe("useNovelViewState · 本书设定 toggle（REQ-050 修法 ③）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("连点两次回落：关 → 开 → 关", () => {
    const { result } = renderHook(() => useNovelViewState());

    expect(result.current.settingCenterOpen).toBe(false);
    act(() => result.current.toggleSettingCenter());
    expect(result.current.settingCenterOpen).toBe(true);
    act(() => result.current.toggleSettingCenter());
    expect(result.current.settingCenterOpen).toBe(false);
  });

  it("带聚焦分类打开后再 toggle 收起：focusId 一并清空", () => {
    const { result } = renderHook(() => useNovelViewState());

    act(() => result.current.openSettingCenter("ls1"));
    expect(result.current.settingCenterOpen).toBe(true);
    expect(result.current.settingFocusId).toBe("ls1");

    act(() => result.current.toggleSettingCenter());
    expect(result.current.settingCenterOpen).toBe(false);
    expect(result.current.settingFocusId).toBeNull();
  });

  it("从顶栏 toggle 重新打开时不带聚焦分类（通用入口不停在某个分类）", () => {
    const { result } = renderHook(() => useNovelViewState());

    act(() => result.current.openSettingCenter("ls1"));
    act(() => result.current.toggleSettingCenter()); // 关闭，顺带清 focus
    act(() => result.current.toggleSettingCenter()); // 再开

    expect(result.current.settingCenterOpen).toBe(true);
    expect(result.current.settingFocusId).toBeNull();
  });
});

/**
 * REQ-053：带遮罩的页内浮层（设定中心 / 类型管理 Modal）开着时，点击顶栏
 * 「行囊 / 小说设定」第一击被 `.ant-modal-wrap` 收走 —— 页面侧靠两件事修：
 * ① `pageOverlayOpen` 决定顶栏是否抬到 wrap 之上（`.nv-page.is-overlay`）；
 * ② 顶栏 click 捕获阶段调 `dismissPageOverlays` 让浮层让位。
 * 这里钉 ① 的数据源与 ② 的收口函数。
 */
describe("useNovelViewState · 页内浮层收口（REQ-053）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pageOverlayOpen 覆盖「设定中心」与「类型管理」两颗 Modal，抽屉不算", () => {
    const { result } = renderHook(() => useNovelViewState());
    expect(result.current.pageOverlayOpen).toBe(false);

    act(() => result.current.openSnapshot());
    expect(result.current.pageOverlayOpen, "无遮罩抽屉不该抬顶栏").toBe(false);
    act(() => result.current.closeSnapshot());

    act(() => result.current.openTypeManager());
    expect(result.current.pageOverlayOpen).toBe(true);
    act(() => result.current.closeTypeManager());

    act(() => result.current.openSettingCenter("ls1"));
    expect(result.current.pageOverlayOpen).toBe(true);
  });

  it("dismissPageOverlays 一次收干净：设定中心 + 聚焦分类 + 类型管理", () => {
    const { result } = renderHook(() => useNovelViewState());

    act(() => result.current.openSettingCenter("ls1"));
    act(() => result.current.dismissPageOverlays());

    expect(result.current.settingCenterOpen).toBe(false);
    expect(result.current.settingFocusId).toBeNull();
    expect(result.current.pageOverlayOpen).toBe(false);
  });

  it("浮层没开时调它也不动别的视图状态（抽屉照样开着）", () => {
    const { result } = renderHook(() => useNovelViewState());

    act(() => result.current.openSettings());
    act(() => result.current.dismissPageOverlays());

    expect(result.current.settingsOpen, "排版抽屉不是页内浮层").toBe(true);
    expect(result.current.pageOverlayOpen).toBe(false);
  });
});
