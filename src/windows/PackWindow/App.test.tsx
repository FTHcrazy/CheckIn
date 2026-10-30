import { act, cleanup, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ElectronAPI } from "@/shared/types/electron";

/**
 * PackWindow 的上下文 → 重挂载行为（P1-2）。
 *
 * 宿主（CharacterPackHost）整体 mock：这里只验证「key 什么时候变」——
 * 即作品切换 / 重置模板（同 workId，靠 nonce 区分）/ 作品删光三种输入下，
 * 宿主该不该重挂载。重挂载 = 重新装载 bundle，正是修复的核心。
 */
const hostMocks = vi.hoisted(() => ({ mounts: 0 }));
vi.mock("@/shared/components/CharacterPack", () => ({
  // 命名函数组件：rules-of-hooks 只认大写开头（匿名箭头会被判「在非组件里调 hook」）
  default: function PackHostStub({
    workId,
    chapterId,
  }: {
    workId: string;
    chapterId: string;
  }) {
    // useState 惰性初始化每个挂载实例只跑一次：重渲染不涨、重挂载才涨
    const [mountId] = useState(() => {
      hostMocks.mounts += 1;
      return hostMocks.mounts;
    });
    return (
      <div
        data-testid="pack-host"
        data-work={workId}
        data-chapter={chapterId}
        data-mount={mountId}
      />
    );
  },
}));

const { default: PackWindowApp } = await import("./App");

type Handler = (...args: unknown[]) => void;
let subscribers: Map<string, Set<Handler>>;

function fire(event: string, detail: unknown): void {
  for (const handler of [...(subscribers.get(event) ?? [])]) handler(detail);
}

beforeEach(() => {
  hostMocks.mounts = 0;
  subscribers = new Map();
  Object.defineProperty(window, "electronAPI", {
    writable: true,
    configurable: true,
    value: {
      windowAPI: {
        on: (event: string, handler: Handler) => {
          const set = subscribers.get(event) ?? new Set<Handler>();
          set.add(handler);
          subscribers.set(event, set);
        },
        off: (event: string, handler: Handler) => {
          subscribers.get(event)?.delete(handler);
        },
        broadcast: vi.fn(async () => {}),
        sendTo: vi.fn(async () => {}),
      },
      receive: () => () => {},
      send: vi.fn(),
    } as unknown as ElectronAPI,
  });
});

afterEach(() => {
  cleanup();
});

describe("PackWindow · 上下文 key（P1-2）", () => {
  it("首次下发上下文后才挂载宿主", () => {
    const { getByText, queryByTestId } = render(<PackWindowApp />);
    expect(getByText("正在打开行囊…")).toBeInTheDocument();
    expect(queryByTestId("pack-host")).toBeNull();

    act(() => {
      fire("pack-window-context", { workId: "tpl-w", chapterId: "c1", nonce: 0 });
    });
    expect(queryByTestId("pack-host")).not.toBeNull();
  });

  it("切章节不重挂载（同一 workId + 同一 nonce）", () => {
    const { getByTestId } = render(<PackWindowApp />);
    act(() => {
      fire("pack-window-context", { workId: "tpl-w", chapterId: "c1", nonce: 0 });
    });
    const first = getByTestId("pack-host");
    expect(first.dataset.mount).toBe("1");

    act(() => {
      fire("novel-work-changed", { workId: "tpl-w", chapterId: "c2", nonce: 0 });
    });
    const second = getByTestId("pack-host");
    expect(second.dataset.mount).toBe("1");
    expect(second.dataset.chapter).toBe("c2");
  });

  it("重置模板（同 workId、nonce+1）强制重挂载 → 重新装载重播种数据", () => {
    const { getByTestId } = render(<PackWindowApp />);
    act(() => {
      fire("pack-window-context", { workId: "tpl-w", chapterId: "c1", nonce: 0 });
    });
    expect(getByTestId("pack-host").dataset.mount).toBe("1");

    // 同 workId 同章节，只有 nonce 变了 —— 旧实现（key=workId）这里不会重挂载
    act(() => {
      fire("novel-work-changed", { workId: "tpl-w", chapterId: "c1", nonce: 1 });
    });
    expect(getByTestId("pack-host").dataset.mount).toBe("2");
  });

  it("切作品重挂载（key 的 workId 部分变化）", () => {
    const { getByTestId } = render(<PackWindowApp />);
    act(() => {
      fire("pack-window-context", { workId: "w1", chapterId: "c1", nonce: 0 });
    });
    act(() => {
      fire("novel-work-changed", { workId: "w2", chapterId: "c9", nonce: 0 });
    });
    const host = getByTestId("pack-host");
    expect(host.dataset.mount).toBe("2");
    expect(host.dataset.work).toBe("w2");
  });

  it("作品删光（空 workId）退占位态，不挂宿主、不触发装载", () => {
    const { getByText, queryByTestId } = render(<PackWindowApp />);
    act(() => {
      fire("pack-window-context", { workId: "w1", chapterId: "c1", nonce: 0 });
    });
    expect(queryByTestId("pack-host")).not.toBeNull();

    act(() => {
      fire("novel-work-changed", { workId: "", chapterId: "", nonce: 0 });
    });
    expect(queryByTestId("pack-host")).toBeNull();
    expect(getByText("当前没有作品，行囊暂无内容")).toBeInTheDocument();
  });

  it("负载缺 nonce（旧形状 / 主进程兜底重发）按 0 处理，不抖", () => {
    const { getByTestId } = render(<PackWindowApp />);
    act(() => {
      fire("pack-window-context", { workId: "w1", chapterId: "c1" });
    });
    act(() => {
      fire("pack-window-context", { workId: "w1", chapterId: "c1", nonce: 0 });
    });
    expect(getByTestId("pack-host").dataset.mount).toBe("1");
  });

  it("非上下文形状的负载被忽略", () => {
    const { queryByTestId, getByText } = render(<PackWindowApp />);
    act(() => {
      fire("novel-work-changed", { nope: true });
      fire("novel-work-changed", null);
    });
    expect(queryByTestId("pack-host")).toBeNull();
    expect(getByText("正在打开行囊…")).toBeInTheDocument();
  });
});
