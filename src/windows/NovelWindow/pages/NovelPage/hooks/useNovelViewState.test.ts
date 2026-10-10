import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNovelViewState } from "./useNovelViewState";
import { registerPackCloser, registerPackPeek } from "../components/CharacterPack/pack-config";

/**
 * 行囊开关的三条路径（REQ-001）
 *
 * 这一组钉的是**「速览 ≠ 普通打开」**这条产品语义，以及一条安全约束：
 *
 *  - 普通点击是开关：开着就关（且必须经面板的受保护路径 —— 直接 `setPackOpen(false)`
 *    会跳过未保存拦截与草稿 flush，改动静默丢失）；
 *  - Alt+点击 = 速览：面板**仍然是开着的**，只是切成半透明浮层。
 *    它不写布局记忆（3 秒自动收起，不是一种形态偏好）。
 *  - 面板还没挂载时按 Alt+点击：先开出来，请求由桥记成待办自动生效 ——
 *    这里**不许自己 setTimeout 重试**（那是在赌 React 的提交时机）。
 */

beforeEach(() => {
  vi.stubGlobal("electronAPI", {
    novel: { configGet: vi.fn(async () => null), configSet: vi.fn(async () => true) },
    windowAPI: { on: vi.fn(), off: vi.fn(), broadcast: vi.fn(async () => true) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  registerPackCloser(null);
  registerPackPeek(null);
});

describe("useNovelViewState —— 行囊开关（REQ-001）", () => {
  it("普通点击：开着就关，且走受保护路径（面板未挂载时才自己关）", () => {
    const { result } = renderHook(() => useNovelViewState());
    expect(result.current.packOpen).toBe(false);

    act(() => result.current.togglePack());
    expect(result.current.packOpen).toBe(true);

    // 面板此刻注册了受保护关闭路径 → 开关把决定权交给它，自己不关
    let closed = 0;
    registerPackCloser(async () => {
      closed += 1;
    });
    act(() => result.current.togglePack());
    expect(closed).toBe(1);
    expect(result.current.packOpen).toBe(true);
  });

  it("Alt+点击（peek）只是换形态：不关面板，也不改开关状态", () => {
    const { result } = renderHook(() => useNovelViewState());
    act(() => result.current.togglePack());
    expect(result.current.packOpen).toBe(true);

    const peeked: number[] = [];
    registerPackPeek(() => peeked.push(1));

    act(() => result.current.togglePack(true));
    expect(peeked).toHaveLength(1);
    // 速览不是「关掉」——面板依然是开的
    expect(result.current.packOpen).toBe(true);
  });

  it("面板还没挂载时 Alt+点击：先把面板开出来，请求交给桥记待办", () => {
    const { result } = renderHook(() => useNovelViewState());
    registerPackPeek(null);
    expect(result.current.packOpen).toBe(false);

    // 桥那头没人接 → 请求被记下；这里不做任何重试，只负责把面板开出来
    act(() => result.current.togglePack(true));
    expect(result.current.packOpen).toBe(true);

    // 面板挂载后立刻消费待办（不是等一个定时器）
    const peeked: number[] = [];
    registerPackPeek(() => peeked.push(1));
    expect(peeked).toHaveLength(1);
  });

  it("无面板兜底关闭：桥返回 false 时自己收起来（否则图标点了没反应）", () => {
    const { result } = renderHook(() => useNovelViewState());
    registerPackCloser(null);
    act(() => result.current.togglePack());
    act(() => result.current.togglePack());
    expect(result.current.packOpen).toBe(false);
  });
});
