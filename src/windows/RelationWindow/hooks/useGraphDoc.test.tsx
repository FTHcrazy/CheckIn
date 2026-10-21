/**
 * 画布记忆 hook 单测（R27 / S2）
 *
 * 钉的是四件**会静默丢用户劳动**的事：
 * ① 首次打开只播种一次、且立刻写回（否则每次打开都重排一遍，用户摆的位置白摆）；
 * ② 已有记忆时不写库、且按成员集合裁画布（不是把全部要素又铺一遍）；
 * ③ 拖入 / 移出立刻落库，拖动去抖但松手必写；
 * ④ 写前剔除已删除要素（键不会随删卡无限增长）。
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useGraphDoc, type GraphSource } from "./useGraphDoc";
import { buildRelationGraph } from "@/shared/novel/relation-graph";
import type { NovelEntity, NovelLink } from "@/shared/novel/entity-model";
import type { ElectronAPI } from "@/shared/types/electron";

const WORK = "w1";
const KEY = `novel_rel_graph_v1:${WORK}:g1`;

const entities: NovelEntity[] = [
  {
    id: "e1",
    workId: WORK,
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
    workId: WORK,
    type: "location",
    name: "青云镇",
    aliases: [],
    summary: "",
    content: "",
    fields: {},
    sort: 2,
  },
];

const links: NovelLink[] = [
  {
    id: "l1",
    fromType: "character",
    fromId: "e1",
    toType: "location",
    toId: "e2",
    relation: "出身",
  },
];

function source(): GraphSource {
  return {
    workId: WORK,
    entities,
    links,
    settings: [],
    baseDoc: buildRelationGraph({ workId: WORK, entities, links, settings: [] }),
  };
}

function installApi(raw: string | null) {
  const configGet = vi.fn(async () => raw);
  const configSet = vi.fn(async () => true);
  const api = {
    novel: { configGet, configSet },
    windowAPI: {
      on: vi.fn(),
      off: vi.fn(),
      setCloseGuard: vi.fn(),
      respondClose: vi.fn(),
    },
  };
  (window as unknown as { electronAPI?: unknown }).electronAPI = api;
  return { api, configGet, configSet };
}

function readWritten(configSet: ReturnType<typeof vi.fn>, callIndex = 0) {
  const [, value] = configSet.mock.calls[callIndex] as unknown as [string, string];
  return JSON.parse(value) as {
    v: number;
    rev: number;
    autoSeeded: 0 | 1;
    members: Record<string, [number, number, 0 | 1]>;
  };
}

afterEach(() => {
  delete (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;
});

describe("首次打开：自动铺开并写回一次", () => {
  it("把有关系的要素播种成成员，坐标一并落库（autoSeeded=1）", async () => {
    const { configSet } = installApi(null);
    const { result } = renderHook(() => useGraphDoc(source()));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    await waitFor(() => expect(configSet).toHaveBeenCalledTimes(1));

    const [key, value] = configSet.mock.calls[0] as unknown as [string, string];
    expect(key).toBe(KEY);
    const written = JSON.parse(value) as { members: Record<string, unknown>; autoSeeded: number };
    expect(Object.keys(written.members).sort()).toEqual(["e1", "e2"]);
    expect(written.autoSeeded).toBe(1);

    expect(result.current.doc?.nodes).toHaveLength(2);
    expect(result.current.positions.size).toBe(2);
  });

  it("一本书一条关联都没有时也标记完成，避免每次打开重跑播种", async () => {
    const { configSet } = installApi(null);
    const emptyBase = buildRelationGraph({
      workId: WORK,
      entities,
      links: [],
      settings: [],
    });
    const { result } = renderHook(() =>
      useGraphDoc({ workId: WORK, entities, links: [], settings: [], baseDoc: emptyBase }),
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    await waitFor(() => expect(configSet).toHaveBeenCalledTimes(1));
    const written = readWritten(configSet);
    expect(Object.keys(written.members)).toEqual([]);
    expect(written.autoSeeded).toBe(1);
  });
});

describe("已有记忆：按成员集合裁画布，不重复写库", () => {
  it("只把成员放上图，其余进池子", async () => {
    const { configSet } = installApi(
      JSON.stringify({ v: 2, members: { e1: [10, 20, 1] }, rev: 5, autoSeeded: 1 }),
    );
    const { result } = renderHook(() => useGraphDoc(source()));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.doc?.nodes.map((node) => node.id)).toEqual(["e1"]);
    expect(result.current.doc?.pool.map((node) => node.id)).toEqual(["e2"]);
    // 有一条边但一端不在图上 → 边上不了画布
    expect(result.current.doc?.edges).toHaveLength(0);
    // 已播种过就不写：打开只读，不产生无意义写入
    expect(configSet).not.toHaveBeenCalled();
  });

  it("成员为空数组 = 用户把图清空了，不再退化成自动铺开", async () => {
    installApi(JSON.stringify({ v: 2, members: {}, rev: 2, autoSeeded: 1 }));
    const { result } = renderHook(() => useGraphDoc(source()));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.doc?.nodes).toHaveLength(0);
    expect(result.current.doc?.pool).toHaveLength(2);
  });
});

describe("拖入 / 移出：离散动作立刻落库", () => {
  it("拖入池中要素 → 成员多一个、坐标取落点、写回一次", async () => {
    const { configSet } = installApi(
      JSON.stringify({ v: 2, members: { e1: [10, 20, 1] }, rev: 5, autoSeeded: 1 }),
    );
    const { result } = renderHook(() => useGraphDoc(source()));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => result.current.addNode("e2", { x: 33.4, y: 44.6 }));

    await waitFor(() => expect(configSet).toHaveBeenCalledTimes(1));
    const written = readWritten(configSet);
    expect(written.members.e2).toEqual([33, 45, 1]);
    // rev 以写回值为准：5 → 6
    expect(written.rev).toBe(6);
    await waitFor(() => expect(result.current.doc?.nodes).toHaveLength(2));
  });

  it("移出画布只删成员，不碰关系数据", async () => {
    const { configSet } = installApi(
      JSON.stringify({ v: 2, members: { e1: [10, 20, 1], e2: [30, 40, 1] }, rev: 1, autoSeeded: 1 }),
    );
    const { result } = renderHook(() => useGraphDoc(source()));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => result.current.removeNode("e2"));

    await waitFor(() => expect(configSet).toHaveBeenCalledTimes(1));
    expect(Object.keys(readWritten(configSet).members)).toEqual(["e1"]);
    // 关系还在（派生层用原始 links，不因为移出而删）
    expect(source().links).toHaveLength(1);
    await waitFor(() => expect(result.current.doc?.pool.map((node) => node.id)).toEqual(["e2"]));
  });

  it("写前剔除已删除的要素（键不会随删卡无限增长）", async () => {
    const { configSet } = installApi(
      JSON.stringify({
        v: 2,
        members: { e1: [10, 20, 1], ghost: [0, 0, 0] },
        rev: 1,
        autoSeeded: 1,
      }),
    );
    const { result } = renderHook(() => useGraphDoc(source()));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => result.current.addNode("e2", { x: 1, y: 2 }));

    await waitFor(() => expect(configSet).toHaveBeenCalledTimes(1));
    expect(Object.keys(readWritten(configSet).members).sort()).toEqual(["e1", "e2"]);
  });
});

describe("拖动：去抖写库，松手一定会写", () => {
  it("连续移动不逐次写，静默后写最后一次坐标", async () => {
    const { configSet } = installApi(
      JSON.stringify({ v: 2, members: { e1: [10, 20, 0] }, rev: 1, autoSeeded: 1 }),
    );
    const { result } = renderHook(() => useGraphDoc(source()));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => {
      result.current.moveNode("e1", { x: 100, y: 100 });
      result.current.moveNode("e1", { x: 140, y: 120 });
    });

    // 去抖窗口内一次都没写
    expect(configSet).not.toHaveBeenCalled();
    await waitFor(() => expect(configSet).toHaveBeenCalledTimes(1), { timeout: 1500 });

    const written = readWritten(configSet);
    expect(written.members.e1).toEqual([140, 120, 1]);
    expect(result.current.positions.get("e1")).toEqual({ x: 140, y: 120 });
  });

  it("未上图的 id 拖不动（不会凭空变成成员）", async () => {
    const { configSet } = installApi(
      JSON.stringify({ v: 2, members: { e1: [10, 20, 0] }, rev: 1, autoSeeded: 1 }),
    );
    const { result } = renderHook(() => useGraphDoc(source()));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => result.current.moveNode("e2", { x: 1, y: 1 }));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(configSet).not.toHaveBeenCalled();
  });
});

describe("视口记忆（W-03 / RG-I-25b）", () => {
  it("装载后暴露库里的 view，并在缩放 / 平移结束时写回同一份文档", async () => {
    const { configSet } = installApi(
      JSON.stringify({
        v: 2,
        members: { e1: [10, 20, 1] },
        rev: 3,
        autoSeeded: 1,
        view: { k: 0.8, tx: -40, ty: 12 },
      }),
    );
    const { result } = renderHook(() => useGraphDoc(source()));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    expect(result.current.viewport).toEqual({ k: 0.8, tx: -40, ty: 12 });

    act(() => result.current.saveViewport({ k: 1.4, tx: 30, ty: -8 }));

    await waitFor(() => expect(configSet).toHaveBeenCalledTimes(1));
    const written = JSON.parse(
      (configSet.mock.calls[0] as unknown as [string, string])[1],
    ) as {
      view: { k: number; tx: number; ty: number };
    };
    expect(written.view).toEqual({ k: 1.4, tx: 30, ty: -8 });
  });
});

describe("读失败：按空白打开，且不覆盖库里的记忆", () => {
  it("configGet 抛错时不播种、不写回，flush 也只给提示", async () => {
    const configGet = vi.fn(async () => {
      throw new Error("channel down");
    });
    const configSet = vi.fn(async () => true);
    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      novel: { configGet, configSet },
      windowAPI: {
        on: vi.fn(),
        off: vi.fn(),
        setCloseGuard: vi.fn(),
        respondClose: vi.fn(),
      },
    };
    const { result } = renderHook(() => useGraphDoc(source()));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    // 空白画布 + 全部进池子：用户可以继续看，但没有任何自动写
    expect(result.current.doc?.nodes).toHaveLength(0);
    expect(result.current.notice).toContain("没能读到");

    await act(async () => {
      await result.current.flush();
    });
    expect(configSet).not.toHaveBeenCalled();
  });
});
