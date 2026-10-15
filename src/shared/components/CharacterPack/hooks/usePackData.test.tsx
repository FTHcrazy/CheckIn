import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PACK_QUICK_ADDED_EVENT } from "../pack-config";
import type { PackBundleDTO, PackItem, PackRealmLink } from "../types";
import type { ElectronAPI } from "@/shared/types/electron";

/**
 * usePackData 的跨窗口行为测试（P1-1 快速记账合并 / P1-3 换主角境界同步）。
 *
 * 服务层整体 mock：这里只验证 hook 的状态编排（装载 / 合并 / 同步），
 * IPC 与 SQL 的正确性由各自 handler 的守卫测试负责。
 */
const serviceMocks = vi.hoisted(() => ({
  loadPackBundle: vi.fn(),
  putPackDraft: vi.fn(),
  clearPackDraft: vi.fn(),
  savePackDocument: vi.fn(),
  fetchPackRecords: vi.fn(),
  writeRealmLink: vi.fn(),
}));
vi.mock("../services/pack-service", () => serviceMocks);

const { usePackData } = await import("./usePackData");

// ──  fixtures ──

function makeItem(id: string): PackItem {
  return {
    id,
    characterId: "ch-1",
    name: `物品-${id}`,
    category: "杂物",
    qty: 1,
    rarity: "common",
    icon: "",
    desc: "",
    tags: [],
    equippedSlotId: "",
    groupId: "",
    gradeId: "",
    slotIndex: null,
    sourceChapterId: "c1",
    updatedAt: 100,
  };
}

function makeLink(fromId: string, toId: string): PackRealmLink {
  return {
    id: `lk-${fromId}-${toId}`,
    fromType: "character",
    fromId,
    toType: "level",
    toId,
    relation: "当前境界",
    note: JSON.stringify({ sub: 1 }),
  };
}

interface BundleOverrides {
  entityId?: string;
  realmLink?: PackRealmLink | null;
  items?: PackItem[];
  /** 传了就用这份 items 造一份草稿（模拟主进程「有草稿并草稿」路径） */
  draftItems?: PackItem[];
}

function makeBundle(overrides: BundleOverrides = {}): PackBundleDTO {
  const { entityId = "e1", realmLink = null, items = [], draftItems } = overrides;
  return {
    character: {
      id: "ch-1",
      workId: "w1",
      name: "主角",
      displayName: "沈青梧",
      avatar: "",
      isProtagonist: true,
      entityId,
      realmAt: "",
      note: "",
      sortOrder: 1,
    },
    attributes: [],
    attrDefs: [],
    mappings: [],
    slots: [],
    groups: [],
    categories: [],
    items,
    skills: [],
    modifiers: [],
    unitSystems: [],
    layouts: [],
    presets: [],
    records: [],
    levelSystems: [],
    gradeSystems: [],
    realmLink,
    draft: draftItems
      ? {
          characterId: "ch-1",
          // 草稿 payload 只需 character.id 完整（parseDraft 的判据），
          // 其余表缺失时由 parseDraft 兜底成空数组
          payload: JSON.stringify({
            character: { id: "ch-1" },
            items: draftItems,
          }),
          dirtyCount: 1,
          updatedAt: 1,
        }
      : null,
  };
}

// ──  跨窗口广播替身：记录 on/off，按事件名派发（负载即第一个参数） ──

type Handler = (...args: unknown[]) => void;
let subscribers: Map<string, Set<Handler>>;

function fireBroadcast(event: string, detail: unknown): void {
  for (const handler of [...(subscribers.get(event) ?? [])]) handler(detail);
}

beforeEach(() => {
  subscribers = new Map();
  // mockReset 会连 once 队列一起清空 —— 必须做，否则上一个用例用剩的
  // `mockResolvedValueOnce`（装载 bundle）会泄漏到下一个用例，让装载读到错的书
  serviceMocks.loadPackBundle.mockReset();
  serviceMocks.putPackDraft.mockReset();
  serviceMocks.clearPackDraft.mockReset();
  serviceMocks.savePackDocument.mockReset();
  serviceMocks.fetchPackRecords.mockReset();
  serviceMocks.writeRealmLink.mockReset();
  serviceMocks.putPackDraft.mockResolvedValue(true);
  serviceMocks.clearPackDraft.mockResolvedValue(true);
  serviceMocks.savePackDocument.mockResolvedValue(true);
  serviceMocks.fetchPackRecords.mockResolvedValue([]);
  serviceMocks.writeRealmLink.mockResolvedValue(true);
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
    } as unknown as ElectronAPI,
  });
});

afterEach(() => {
  cleanup();
});

/** 装载完成的 hook（loadPackBundle 首次返回值由调用方给定） */
async function mountPack(bundle: PackBundleDTO) {
  serviceMocks.loadPackBundle.mockResolvedValueOnce(bundle);
  const rendered = renderHook(() => usePackData("w1", "c1"));
  await waitFor(() => expect(rendered.result.current.doc).not.toBeNull());
  return rendered;
}

// ─────────────────────────────────────────────────────────────
// P1-1 跨窗口快速记账合并
// ─────────────────────────────────────────────────────────────

describe("P1-1 跨窗口快速记账合并", () => {
  it("主进程直插正式表的那条，按 itemId 合并进文档并计一处未保存", async () => {
    const { result } = await mountPack(makeBundle({ items: [makeItem("pi-1")] }));

    // 模拟主进程落库后的新读数：正式表里多出 pi-9
    serviceMocks.loadPackBundle.mockResolvedValueOnce(
      makeBundle({ items: [makeItem("pi-1"), makeItem("pi-9")] }),
    );
    await act(async () => {
      fireBroadcast(PACK_QUICK_ADDED_EVENT, { workId: "w1", itemId: "pi-9" });
    });

    await waitFor(() =>
      expect(result.current.doc?.items.map((item) => item.id)).toEqual(["pi-1", "pi-9"]),
    );
    // 合并进来的物品是「未保存改动」：保存时才会随整文档落库
    expect(result.current.dirty).toBe(1);
  });

  it("合并幂等：重复广播不重复 append，也不再拉取 bundle", async () => {
    const { result } = await mountPack(makeBundle({ items: [makeItem("pi-1")] }));
    serviceMocks.loadPackBundle.mockResolvedValue(
      makeBundle({ items: [makeItem("pi-1"), makeItem("pi-9")] }),
    );

    await act(async () => {
      fireBroadcast(PACK_QUICK_ADDED_EVENT, { workId: "w1", itemId: "pi-9" });
    });
    await waitFor(() => expect(result.current.doc?.items).toHaveLength(2));
    const callsAfterFirst = serviceMocks.loadPackBundle.mock.calls.length;

    // 第二次广播（双通道各发一次时会真实发生）：文档里已有 → 直接跳过
    await act(async () => {
      fireBroadcast(PACK_QUICK_ADDED_EVENT, { workId: "w1", itemId: "pi-9" });
    });
    expect(result.current.doc?.items).toHaveLength(2);
    expect(serviceMocks.loadPackBundle.mock.calls.length).toBe(callsAfterFirst);
  });

  it("草稿路径：主进程把物品并进草稿，也从草稿里合并", async () => {
    const { result } = await mountPack(
      makeBundle({ items: [], draftItems: [makeItem("pi-d1")] }),
    );
    expect(result.current.doc?.items.map((item) => item.id)).toEqual(["pi-d1"]);

    // 主进程「有草稿并草稿」：正式表仍然为空，新物品在草稿 payload 里
    serviceMocks.loadPackBundle.mockResolvedValueOnce(
      makeBundle({ items: [], draftItems: [makeItem("pi-d1"), makeItem("pi-9")] }),
    );
    await act(async () => {
      fireBroadcast(PACK_QUICK_ADDED_EVENT, { workId: "w1", itemId: "pi-9" });
    });

    await waitFor(() =>
      expect(result.current.doc?.items.map((item) => item.id)).toEqual(["pi-d1", "pi-9"]),
    );
  });

  it("别的作品的广播被忽略（多窗口各开各的书）", async () => {
    const { result } = await mountPack(makeBundle({ items: [makeItem("pi-1")] }));
    serviceMocks.loadPackBundle.mockResolvedValue(
      makeBundle({ items: [makeItem("pi-1"), makeItem("pi-9")] }),
    );

    await act(async () => {
      fireBroadcast(PACK_QUICK_ADDED_EVENT, { workId: "other", itemId: "pi-9" });
    });
    // 同步判据即返回：不该触发任何一次额外装载
    expect(result.current.doc?.items).toHaveLength(1);
    expect(serviceMocks.loadPackBundle).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────
// P1-3 换主角后境界绑定同步
// ─────────────────────────────────────────────────────────────

describe("P1-3 换主角后境界绑定同步（syncMeta）", () => {
  it("换绑主角：realmLink 换成新主角的那一份，并计一处未保存", async () => {
    const { result } = await mountPack(
      makeBundle({ entityId: "e1", realmLink: makeLink("e1", "lvl-1") }),
    );
    expect(result.current.doc?.realmLink?.toId).toBe("lvl-1");

    // 库里绑定已换成 e2（主进程 writeProtagonistBinding 之后的新读数）
    serviceMocks.loadPackBundle.mockResolvedValueOnce(
      makeBundle({ entityId: "e2", realmLink: makeLink("e2", "lvl-5") }),
    );
    await act(async () => {
      await result.current.syncMeta();
    });

    // 落点换了人 → 整体替换；否则 realmState.link 优先取 doc 会显示旧主角境界
    expect(result.current.doc?.realmLink?.fromId).toBe("e2");
    expect(result.current.doc?.realmLink?.toId).toBe("lvl-5");
    // 绑定差异是未保存改动：下次保存才会写进 novel_links 并广播
    expect(result.current.dirty).toBe(1);
    expect(result.current.meta.realmLink?.fromId).toBe("e2");
  });

  it("解绑主角：库内没有关系行，realmLink 显式置空", async () => {
    const { result } = await mountPack(
      makeBundle({ entityId: "e1", realmLink: makeLink("e1", "lvl-1") }),
    );

    serviceMocks.loadPackBundle.mockResolvedValueOnce(
      makeBundle({ entityId: "", realmLink: null }),
    );
    await act(async () => {
      await result.current.syncMeta();
    });

    expect(result.current.doc?.realmLink).toBeNull();
  });

  it("同一主角时不动 realmLink（外部改境界走专门的事件，不在这里被冲掉）", async () => {
    const { result } = await mountPack(
      makeBundle({ entityId: "e1", realmLink: makeLink("e1", "lvl-1") }),
    );

    // 落点人没变（只是境界本身在别处被改）：syncMeta 不碰文档里的 link
    serviceMocks.loadPackBundle.mockResolvedValueOnce(
      makeBundle({ entityId: "e1", realmLink: makeLink("e1", "lvl-9") }),
    );
    await act(async () => {
      await result.current.syncMeta();
    });

    expect(result.current.doc?.realmLink?.toId).toBe("lvl-1");
    expect(result.current.dirty).toBe(0);
    // 元数据（库内真值）仍然刷新
    expect(result.current.meta.realmLink?.toId).toBe("lvl-9");
  });
});

// ─────────────────────────────────────────────────────────────
// TX-01 境界关联写入原子化（不再单独写 novel_links）
// ─────────────────────────────────────────────────────────────

describe("TX-01 境界绑定随保存同事务提交", () => {
  it("换绑主角后保存：realmLink 随 payload 一次提交，不再单独调 writeRealmLink", async () => {
    const { result } = await mountPack(
      makeBundle({ entityId: "e1", realmLink: makeLink("e1", "lvl-1") }),
    );

    // 换绑到 e2 → 文档里 realmLink 变 e2 的那份（一处未保存改动）
    serviceMocks.loadPackBundle.mockResolvedValueOnce(
      makeBundle({ entityId: "e2", realmLink: makeLink("e2", "lvl-5") }),
    );
    await act(async () => {
      await result.current.syncMeta();
    });
    expect(result.current.dirty).toBe(1);

    await act(async () => {
      await result.current.save();
    });

    // ① 只发一次 IPC（不再有第二步 writeRealmLink）
    expect(serviceMocks.savePackDocument).toHaveBeenCalledTimes(1);
    expect(serviceMocks.writeRealmLink).not.toHaveBeenCalled();
    // ② realmLink 被合进保存 payload（主进程同事务写 novel_links）
    const payload = serviceMocks.savePackDocument.mock.calls[0][0];
    expect(payload.realmLink).toMatchObject({ fromId: "e2", toId: "lvl-5" });
    // ③ 保存后脏计数归零
    expect(result.current.dirty).toBe(0);
  });

  it("无境界改动时保存：payload.realmLink 为 null（主进程不碰 novel_links）", async () => {
    const { result } = await mountPack(
      makeBundle({ entityId: "e1", realmLink: makeLink("e1", "lvl-1") }),
    );

    // 只改物品（不碰境界）→ 需先制造一处改动
    await act(async () => {
      result.current.mutate((doc) => ({
        ...doc,
        items: [...doc.items, makeItem("pi-new")],
      }));
    });
    await waitFor(() => expect(result.current.dirty).toBe(1));

    await act(async () => {
      await result.current.save();
    });

    // realmLink 与上次保存态一致 → 不带（null）；主进程不碰 novel_links
    const payload = serviceMocks.savePackDocument.mock.calls.at(-1)![0];
    expect(payload.realmLink).toBeNull();
    expect(serviceMocks.writeRealmLink).not.toHaveBeenCalled();
  });

  it("保存失败时不广播境界变更（无中间态）", async () => {
    serviceMocks.savePackDocument.mockResolvedValue(false);
    const { result } = await mountPack(
      makeBundle({ entityId: "e1", realmLink: makeLink("e1", "lvl-1") }),
    );
    serviceMocks.loadPackBundle.mockResolvedValueOnce(
      makeBundle({ entityId: "e2", realmLink: makeLink("e2", "lvl-5") }),
    );
    await act(async () => {
      await result.current.syncMeta();
    });

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.save();
    });

    expect(ok).toBe(false);
    expect(result.current.saveFailed).toBe(true);
    // 文档都没写成功 → 境界广播也不该发（同事务语义）
    expect(window.electronAPI?.windowAPI.broadcast).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// TX-13 保存期间卸载 flush 不得覆盖已保存文档
// ─────────────────────────────────────────────────────────────

describe("TX-13 保存中卸载 flush 闸门", () => {
  it("save 在途时 flushDraft 跳过（不写脏草稿覆盖已保存文档）", async () => {
    // 让保存挂在 pending，模拟 await 期间组件卸载
    let resolveSave: ((v: boolean) => void) | undefined;
    serviceMocks.savePackDocument.mockImplementation(
      () => new Promise<boolean>((resolve) => {
        resolveSave = resolve;
      }),
    );

    const { result } = await mountPack(makeBundle({ items: [makeItem("pi-1")] }));
    await act(async () => {
      result.current.mutate((doc) => ({
        ...doc,
        items: [...doc.items, makeItem("pi-2")],
      }));
    });
    await waitFor(() => expect(result.current.dirty).toBe(1));

    // 发起保存（不 await，保存仍挂在 pending）
    let savePromise: Promise<boolean> | undefined;
    await act(async () => {
      savePromise = result.current.save();
    });

    // 保存期间调用 flushDraft：应被 savingRef 闸门拦下，不写草稿
    serviceMocks.putPackDraft.mockClear();
    await act(async () => {
      await result.current.flushDraft();
    });
    expect(serviceMocks.putPackDraft).not.toHaveBeenCalled();

    // 收尾：放行保存，避免悬挂 Promise
    await act(async () => {
      resolveSave?.(true);
      await savePromise;
    });
  });
});
