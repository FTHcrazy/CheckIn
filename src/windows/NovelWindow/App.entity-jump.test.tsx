/**
 * 窗口根 × 关系图跳转（R27 / S6.2）
 *
 * 这条链路连续翻车过两次，两次都发生在「判定发生在哪一份状态上」：
 *
 * ① 书架页与编辑器页各挂一个 `rel-open-entity` 监听 → 窗口根先把书切了，
 *    编辑器那张确认框才弹出来（用户看到「先切书，再问要不要切」）。
 * ② 编辑器页正在重挂载（HMR / StrictMode）时能力句柄短暂为 null，窗口根
 *    兜底成「直接切过去开卡」→ 又一次「先切书」，而这一步连确认框都没有。
 *
 * 所以这里不测「某段源码长什么样」（源码守卫两次都放过了故障），而是把
 * **真实的 App 组件**渲染出来，用可控的编辑器桩驱动：
 * - 异书 → 只弹确认，一个 `switchWork` 都不许发生；
 * - 确认后 → 先保存、再切书、最后开卡；
 * - 句柄缺席 → 挂起，句柄回来后用真实作品 id 重判。
 */
import { act, cleanup, render } from "@testing-library/react";
import { Button } from "antd";
import { useEffect, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ElectronAPI } from "@/shared/types/electron";

/** 编辑器桩与测试之间共享的可变状态（句柄读的是 getter，必须是最新值） */
const harness = vi.hoisted(() => ({
  activeWorkId: "w1",
  ready: true,
  calls: [] as string[],
  flushResult: true,
}));

vi.mock("./pages/BookshelfPage/BookshelfPage", () => ({
  default: function BookshelfStub({ onOpenWork }: { onOpenWork: (id: string) => void }) {
    return (
      <Button onClick={() => onOpenWork("w1")}>打开 w1</Button>
    );
  },
}));

interface EditorStubProps {
  onEditorBridge?: (bridge: unknown) => void;
  entityJump?: { workId: string; entityId: string } | null;
  onConfirmEntityJump?: () => void;
  onCancelEntityJump?: () => void;
  onBackToShelf?: () => void;
}

/**
 * 编辑器桩：只保留窗口根依赖的三件事 —— 交出能力句柄、渲染确认框、
 * 把确认 / 取消回传。真实页有上百个依赖，把它们拉进来测不出这条链路。
 */
vi.mock("./pages/NovelPage/NovelPage", () => ({
  default: function NovelPageStub(props: EditorStubProps) {
    const [attached, setAttached] = useState(true);
    /** 递增一次 = 模拟「数据装载完成、句柄重新登记」（真实页随 loading 翻转重登记） */
    const [gen, setGen] = useState(0);
    const attachRef = useRef(props.onEditorBridge);
    attachRef.current = props.onEditorBridge;

    useEffect(() => {
      const register = attachRef.current;
      if (!register) return undefined;
      // 「摘掉句柄」= 模拟编辑器正在重挂载的那一小段：窗口根手里是真的没有句柄
      if (!attached) {
        register(null);
        return undefined;
      }
      register({
        ready: () => harness.ready,
        // getter：与真实页一致，句柄跨多次渲染存活
        activeWorkId: () => harness.activeWorkId,
        workNameOf: () => "另一本书",
        switchWork: (workId: string) => {
          harness.calls.push(`switch:${workId}`);
          harness.activeWorkId = workId;
        },
        openEntity: (entityId: string) => harness.calls.push(`open:${entityId}`),
        flushSave: async () => harness.flushResult,
        toast: () => harness.calls.push("toast"),
      });
      return () => register(null);
    }, [attached, gen]);

    return (
      <div>
        <Button
          onClick={() => {
            attachRef.current?.(null);
            setAttached(false);
          }}
        >
          摘掉句柄
        </Button>
        <Button onClick={() => setAttached(true)}>交回句柄</Button>
        <Button
          onClick={() => {
            harness.ready = true;
            setGen((value) => value + 1);
          }}
        >
          数据就绪
        </Button>
        <div data-testid="jump">{props.entityJump?.workId ?? ""}</div>
        <Button onClick={props.onConfirmEntityJump}>保存后跳转</Button>
        <Button onClick={props.onCancelEntityJump}>取消</Button>
        <Button onClick={props.onBackToShelf}>返回书架</Button>
      </div>
    );
  },
}));

const { default: NovelWindowApp } = await import("./App");
const { resetEntityJumpStore } = await import("./store/useEntityJumpStore");

type Handler = (...args: unknown[]) => void;
let subscribers: Map<string, Set<Handler>>;

function fire(event: string, detail: unknown): void {
  act(() => {
    for (const handler of [...(subscribers.get(event) ?? [])]) handler(detail);
  });
}

beforeEach(() => {
  resetEntityJumpStore();
  harness.activeWorkId = "w1";
  harness.ready = true;
  harness.calls = [];
  harness.flushResult = true;
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
        sendTo: vi.fn(async () => ({ delivered: true, queued: false })),
      },
      receive: () => () => {},
      send: vi.fn(),
    } as unknown as ElectronAPI,
  });
});

afterEach(() => {
  cleanup();
});

/** 进编辑器：书架桩点一下，编辑器才会挂载并交出能力句柄 */
function enterEditor(getByText: (text: string) => HTMLElement): void {
  act(() => {
    getByText("打开 w1").click();
  });
}

describe("窗口根 · 关系图跳主窗口", () => {
  it("另一本书：只弹确认框，绝不先切书", () => {
    const { getByText, getByTestId } = render(<NovelWindowApp />);
    enterEditor(getByText);

    fire("rel-open-entity", { workId: "w2", entityId: "e1" });

    expect(getByTestId("jump").textContent).toBe("w2");
    expect(harness.calls).toEqual([]);
  });

  it("确认后才「保存 → 切书 → 开卡」，顺序固定", async () => {
    const { getByText, getByTestId } = render(<NovelWindowApp />);
    enterEditor(getByText);
    fire("rel-open-entity", { workId: "w2", entityId: "e1" });

    await act(async () => {
      getByText("保存后跳转").click();
    });

    expect(harness.calls).toEqual(["switch:w2", "open:e1"]);
    expect(getByTestId("jump").textContent).toBe("");
  });

  it("保存失败：留在原处，一个字都不切", async () => {
    harness.flushResult = false;
    const { getByText } = render(<NovelWindowApp />);
    enterEditor(getByText);
    fire("rel-open-entity", { workId: "w2", entityId: "e1" });

    await act(async () => {
      getByText("保存后跳转").click();
    });

    expect(harness.calls).toEqual(["toast"]);
  });

  it("同一本书：直接开卡，不打扰", () => {
    const { getByText, getByTestId } = render(<NovelWindowApp />);
    enterEditor(getByText);

    fire("rel-open-entity", { workId: "w1", entityId: "e9" });

    expect(harness.calls).toEqual(["open:e9"]);
    expect(getByTestId("jump").textContent).toBe("");
  });

  it("句柄缺席（编辑器重挂载）：挂起，不猜着切书；句柄回来后按真实作品 id 重判", () => {
    const { getByText, getByTestId } = render(<NovelWindowApp />);
    enterEditor(getByText);

    act(() => {
      getByText("摘掉句柄").click();
    });
    fire("rel-open-entity", { workId: "w2", entityId: "e1" });
    expect(harness.calls).toEqual([]);
    expect(getByTestId("jump").textContent).toBe("");

    // 句柄回来：这时才知道「当前是 w1、目标是 w2」→ 只弹确认框
    act(() => {
      getByText("交回句柄").click();
    });
    expect(harness.calls).toEqual([]);
    expect(getByTestId("jump").textContent).toBe("w2");
  });

  it("数据没装载完：空 id 不能当「空态直开」，就绪后按真实作品重判", () => {
    harness.ready = false;
    const { getByText, getByTestId } = render(<NovelWindowApp />);
    enterEditor(getByText);

    // 此刻 activeWorkId() 是 ""：曾被判成「编辑器空态」直接切书
    fire("rel-open-entity", { workId: "w2", entityId: "e1" });
    expect(harness.calls).toEqual([]);
    expect(getByTestId("jump").textContent).toBe("");

    // 装载完成、句柄重新登记：当前是 w1、目标是 w2 → 弹确认框
    act(() => {
      getByText("数据就绪").click();
    });
    expect(harness.calls).toEqual([]);
    expect(getByTestId("jump").textContent).toBe("w2");
  });

  it("窗口是刚被这条跳转拉起来的：先按上次位置恢复编辑器，再重判（异书弹确认，不直切）", () => {
    // 主窗口上一轮还关着：上次在编辑 w1（lastPosition 会恢复出来），
    // drain 到达时视图虽然停在书架，但那只是「编辑器还没挂载」
    harness.ready = false;
    harness.activeWorkId = ""; // 装载完成前就是空
    const { getByText, getByTestId } = render(<NovelWindowApp />);

    fire("rel-open-entity", { workId: "w2", entityId: "e1" });
    // 编辑器被挂载了（走恢复路径），但一个字都没切、也没开卡
    expect(getByText("数据就绪")).toBeTruthy();
    expect(harness.calls).toEqual([]);
    expect(getByTestId("jump").textContent).toBe("");

    // 数据装载完成、句柄重新登记：当前是 w1 ≠ 目标 w2 → 弹确认框
    harness.activeWorkId = "w1";
    act(() => {
      getByText("数据就绪").click();
    });
    expect(harness.calls).toEqual([]);
    expect(getByTestId("jump").textContent).toBe("w2");

    // 确认后才切
    return act(async () => {
      getByText("保存后跳转").click();
    }).then(() => {
      expect(harness.calls).toEqual(["switch:w2", "open:e1"]);
    });
  });

  it("同一条消息被重复投递：只处理一次（不做第二遍切书 / 第二个弹窗）", async () => {
    const { getByText, getByTestId } = render(<NovelWindowApp />);
    enterEditor(getByText);

    fire("rel-open-entity", { workId: "w2", entityId: "e1" });
    fire("rel-open-entity", { workId: "w2", entityId: "e1" });

    await act(async () => {
      getByText("保存后跳转").click();
    });

    expect(harness.calls).toEqual(["switch:w2", "open:e1"]);
    expect(getByTestId("jump").textContent).toBe("");
  });

  it("负载不合法：什么都不做（不跳到空书的资料卡）", () => {
    const { getByText, getByTestId } = render(<NovelWindowApp />);
    enterEditor(getByText);

    fire("rel-open-entity", { workId: "w2" });
    fire("rel-open-entity", null);

    expect(harness.calls).toEqual([]);
    expect(getByTestId("jump").textContent).toBe("");
  });

  it("确认框没处理就返回书架：跳转同步作废，不切书、书架不再冒确认框", () => {
    const { getByText, getByTestId } = render(<NovelWindowApp />);
    enterEditor(getByText);
    fire("rel-open-entity", { workId: "w2", entityId: "e1" });
    expect(getByTestId("jump").textContent).toBe("w2");

    // 用户不理确认框，直接点「返回书架」
    act(() => {
      getByText("返回书架").click();
    });
    expect(harness.calls).toEqual([]);
    expect(getByTestId("jump").textContent).toBe("");

    // 回编辑器后残留消息也不会再执行（已在回书架时作废）
    enterEditor(getByText);
    expect(harness.calls).toEqual([]);
    expect(getByTestId("jump").textContent).toBe("");
  });
});
