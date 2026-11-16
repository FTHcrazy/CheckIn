/**
 * 关系图装载 hook 单测（R27 / S1）
 *
 * 钉三件事：① 只拉元数据（includeContent=false），不把全书正文拖过 IPC；
 * ② 自建类型配置坏掉时退化成空表而不是整窗白屏；③ 作品已被删 → 明确错误态。
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCustomTypes, useRelationData } from "./useRelationData";
import type { ElectronAPI } from "@/shared/types/electron";

function installApi(overrides?: {
  bundle?: unknown;
  typesRaw?: string | null;
  editorLoad?: ReturnType<typeof vi.fn>;
}) {
  const editorLoad = overrides?.editorLoad ?? vi.fn();
  /** 事件总线桩：preload 的 on/off 按引用配对，这里也一样（按引用删） */
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const windowAPI = {
    on: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
      const list = listeners.get(channel) ?? [];
      list.push(handler);
      listeners.set(channel, list);
    }),
    off: vi.fn((channel: string, handler: (...args: unknown[]) => void) => {
      listeners.set(
        channel,
        (listeners.get(channel) ?? []).filter((item) => item !== handler),
      );
    }),
  };
  const api = {
    novel: {
      editorLoad,
      configGet: vi.fn(async () => overrides?.typesRaw ?? null),
    },
    windowAPI,
  };
  (window as unknown as { electronAPI?: unknown }).electronAPI = api;
  const emit = (channel: string, payload: unknown) => {
    for (const handler of listeners.get(channel) ?? []) handler(payload);
  };
  return { api, editorLoad, emit, windowAPI };
}

const bundle = {
  works: [{ id: "w1", name: "测试书", createdAt: 1 }],
  volumes: [],
  chapters: [],
  entities: [
    {
      id: "e1",
      workId: "w1",
      type: "character",
      name: "林晚",
      aliases: [],
      summary: "",
      content: "",
      fields: {},
      sort: 1,
    },
    {
      id: "e2",
      workId: "w1",
      type: "location",
      name: "青云镇",
      aliases: [],
      summary: "",
      content: "",
      fields: {},
      sort: 2,
    },
  ],
  links: [
    {
      id: "l1",
      fromType: "character",
      fromId: "e1",
      toType: "location",
      toId: "e2",
      relation: "出身",
    },
  ],
  settings: [],
  notes: [],
  outlineEntries: [],
  recovery: null,
};

afterEach(() => {
  delete (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;
});

describe("parseCustomTypes", () => {
  it("空值 / 坏 JSON / 非数组一律退化成空表", () => {
    expect(parseCustomTypes(null)).toEqual([]);
    expect(parseCustomTypes("")).toEqual([]);
    expect(parseCustomTypes("not-json")).toEqual([]);
    expect(parseCustomTypes("{}")).toEqual([]);
  });

  it("只保留结构完整的条目，缺色的给一个可用默认色", () => {
    const parsed = parseCustomTypes(
      JSON.stringify([
        { id: "ct-a", name: "宗门", color: "#123456" },
        { id: "ct-b", name: "功法" },
        { name: "缺 id" },
        null,
      ]),
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ id: "ct-a", name: "宗门", color: "#123456" });
    expect(parsed[1].color).toMatch(/^#/);
  });
});

describe("useRelationData", () => {
  it("装载时显式要求不拉正文（includeContent=false）", async () => {
    const { editorLoad } = installApi();
    editorLoad.mockResolvedValue(bundle);

    const { result } = renderHook(() => useRelationData("w1"));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    expect(editorLoad).toHaveBeenCalledWith(false);
    if (result.current.state.status !== "ready") return;
    expect(result.current.state.data.workName).toBe("测试书");
    expect(result.current.state.data.baseDoc.diagnostics.nodeCount).toBe(2);
    expect(result.current.state.data.baseDoc.diagnostics.edgeCount).toBe(1);
  });

  it("作品已不存在 → 明确错误态（不是空白图）", async () => {
    const { editorLoad } = installApi();
    editorLoad.mockResolvedValue(bundle);

    const { result } = renderHook(() => useRelationData("w-deleted"));
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    if (result.current.state.status !== "error") return;
    expect(result.current.state.message).toContain("已不存在");
  });

  it("没有 workId 时停在 idle，不发起 IPC", () => {
    const { editorLoad } = installApi();
    renderHook(() => useRelationData(null));
    expect(editorLoad).not.toHaveBeenCalled();
  });
});

describe("反向同步（S4 / W-16）", () => {
  async function ready(workId = "w1") {
    const helpers = installApi();
    helpers.editorLoad.mockResolvedValue(bundle);
    const { result } = renderHook(() => useRelationData(workId));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    return { ...helpers, result };
  }

  it("订阅 novel-links-changed（不是轮询、不是重载）", async () => {
    const { windowAPI } = await ready();
    expect(windowAPI.on).toHaveBeenCalledWith("novel-links-changed", expect.any(Function));
  });

  it("removed：那条边消失，其它边原样保留", async () => {
    const { emit, result } = await ready();
    if (result.current.state.status !== "ready") return;
    expect(result.current.state.data.links).toHaveLength(1);

    act(() => emit("novel-links-changed", { workId: "w1", removed: ["l1"] }));

    if (result.current.state.status !== "ready") return;
    expect(result.current.state.data.links).toHaveLength(0);
    // 关掉监听后不留悬挂
    expect(result.current.state.data.entities).toHaveLength(2);
  });

  it("created：按 id 幂等并入（重复投递不会变成两条）", async () => {
    const { emit, result } = await ready();
    const fresh = {
      id: "l2",
      fromType: "character",
      fromId: "e1",
      toType: "character",
      toId: "e2",
      relation: "师徒",
    };
    act(() => emit("novel-links-changed", { workId: "w1", created: [fresh] }));
    act(() => emit("novel-links-changed", { workId: "w1", created: [fresh] }));

    if (result.current.state.status !== "ready") return;
    expect(result.current.state.data.links.filter((link) => link.id === "l2")).toHaveLength(1);
  });

  it("relations：改关系名只换字，不新增行", async () => {
    const { emit, result } = await ready();
    act(() => emit("novel-links-changed", { workId: "w1", relations: [{ id: "l1", relation: "故乡" }] }));

    if (result.current.state.status !== "ready") return;
    const links = result.current.state.data.links;
    expect(links).toHaveLength(1);
    expect(links[0].relation).toBe("故乡");
  });

  it("别的作品的 delta 被挡掉（有 workId 时按作品过滤）", async () => {
    const { emit, result } = await ready();
    act(() => emit("novel-links-changed", { workId: "other", removed: ["l1"] }));

    if (result.current.state.status !== "ready") return;
    expect(result.current.state.data.links).toHaveLength(1);
  });

  it("缺省 workId 也照 id 合并（境界绑定反查不到作品时不能把消息丢掉）", async () => {
    const { emit, result } = await ready();
    act(() => emit("novel-links-changed", { removed: ["l1"] }));

    if (result.current.state.status !== "ready") return;
    expect(result.current.state.data.links).toHaveLength(0);
  });

  it("卸载时摘掉监听（off 传同一个 handler 引用）", async () => {
    const helpers = installApi();
    helpers.editorLoad.mockResolvedValue(bundle);
    const { unmount } = renderHook(() => useRelationData("w1"));
    await waitFor(() => expect(helpers.windowAPI.on).toHaveBeenCalled());
    unmount();
    expect(helpers.windowAPI.off).toHaveBeenCalledWith("novel-links-changed", expect.any(Function));
  });
});
