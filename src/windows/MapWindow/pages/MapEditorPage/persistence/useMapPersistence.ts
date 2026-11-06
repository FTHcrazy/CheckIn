/**
 * 地图存档编排（启动恢复 / 自动保存 / 关窗 flush / 切图 / 改名 / 删除）。
 *
 * 一张地图的生命周期只有四种状态，本 hook 负责把它们串起来：
 *
 *   启动 ──→ 列表里有图？ ──有──→ 打开最近一张
 *          └─没有──→ 新建「未命名地图」
 *   编辑 ──→ 800ms 防抖 ──→ map-doc-save（乐观锁）
 *   关窗 ──→ 主进程请求快照 ──→ map-doc-flush（强写）──→ 回执放行关闭
 *
 * 三条不能省的细节（改动前先读）：
 * 1. **装载期间不保存**：`resetMapDocStore` 会触发订阅，若不禁用，打开一张旧图
 *    会立刻以"新图 rev=0"的身份把它覆盖成同一份内容（rev 还少一次）。
 * 2. **rev 只增不减**：每次成功保存后把返回的 rev 写回 store；漏一次，下一次保存必冲突。
 * 3. **关窗必须回执**：无论 flush 成功、失败还是超时，都要回 `map-doc-flush-done`，
 *    否则用户点了关闭，窗口要干等 1.5s 才消失（看起来像卡死）。
 */
import { App as AntApp } from "antd";
import { useCallback, useEffect, useRef } from "react";
import type { MapDocSummaryDTO } from "@/shared/types/electron";
import { migrateDoc, type MapDocument } from "../types";
import { resetMapDocStore, useMapDocStore } from "../store/useMapDocStore";
import { resetMapSelectionStore } from "../store/useMapSelectionStore";
import { useMapViewportStore } from "../store/useMapViewportStore";
import { useMapFileStore } from "../store/useMapFileStore";
import type { Viewport } from "../coords";

/**
 * 自动保存防抖。
 *
 * 800ms 是"一次连续操作差不多结束"的经验值：拖一个素材会连发几十次 doc 变更，
 * 太短等于每帧写一次库（单条 1~8MB，会明显卡顿），太长则关窗前丢改动的概率上升
 * （关窗还有 flush 兜底，所以这里可以偏保守）。
 */
const SAVE_DEBOUNCE_MS = 800;

/** 渲染层唯一的地图 API 入口（无 electronAPI 的环境下为 undefined） */
function mapApi() {
  return window.electronAPI?.map;
}

/**
 * 启动装载的**共享 promise**（模块级，跨组件重挂载存活）。
 *
 * 【为什么必须有】窗口入口开了 `<React.StrictMode>`：effect 会「挂载 → 卸载 → 再挂载」。
 * 若两次都跑装载，第一次的 `docsList()` 还没回来、store 里的 `loaded` 还是 false，
 * 第二次会**再建一张空地图**——用户首次打开地图窗口就看到两张「未命名地图」。
 * 模块级 promise 让两次挂载等同一份结果（同时也不会因为卸载而中止真正的装载）。
 */
let startupPromise: Promise<void> | null = null;

export interface MapPersistenceApi {
  /** 当前地图 id（`null` = 还没装载） */
  docId: string | null;
  title: string;
  workId: string | null;
  status: "idle" | "dirty" | "saving" | "saved" | "conflict" | "error";
  loaded: boolean;
  /** 打开某张图（会先 flush 当前图） */
  openDoc: (id: string) => Promise<void>;
  /** 新建并打开（缺省名由主进程兜底成「未命名地图」） */
  createDoc: (options?: { title?: string; workId?: string | null }) => Promise<void>;
  /** 改名（`id` 未必是当前图：地图库列表里可直接改任意一张） */
  renameDoc: (id: string, title: string) => Promise<void>;
  /** 软删（进回收站）；删的是当前图时自动切到另一张 / 新建 */
  deleteDoc: (id: string) => Promise<void>;
  restoreDoc: (id: string) => Promise<void>;
  purgeDoc: (id: string) => Promise<void>;
  /** 绑定 / 解绑作品（`null` = 解绑，不删图） */
  bindWork: (id: string, workId: string | null) => Promise<void>;
  /** 立刻写一次（不等防抖） */
  saveNow: () => Promise<void>;
  /** 取走"这次打开要落位的视口"（null = 没有存档视口，调用方走「适应窗口」） */
  takePendingViewport: () => Viewport | null;
  /** 当前图缩略图回传（列表卡片用；失败静默） */
  saveThumb: (png: Uint8Array) => Promise<void>;
}

/**
 * @param onLibraryChanged 库内容变化（新建 / 删除 / 改名 / 缩略图更新）时的通知，
 *   由页面刷新列表弹窗用。hook 本身不持有列表，避免"两处各存一份列表"。
 */
export function useMapPersistence(onLibraryChanged?: () => void): MapPersistenceApi {
  const { message, modal } = AntApp.useApp();
  const docId = useMapFileStore((s) => s.docId);
  const title = useMapFileStore((s) => s.title);
  const workId = useMapFileStore((s) => s.workId);
  const status = useMapFileStore((s) => s.status);
  const loaded = useMapFileStore((s) => s.loaded);

  /** 装载中：这段时间内的文档变更**不**触发保存（见文件头第 1 条） */
  const hydratingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 打开时该落位的视口；页面在 docId 变化后取走 */
  const pendingViewportRef = useRef<Viewport | null>(null);
  /** 冲突弹窗是否已开着（避免每 800ms 弹一个） */
  const conflictOpenRef = useRef(false);
  /** 互相引用的动作（doSave ↔ openDoc ↔ 冲突弹窗 ↔ 启动装载）走 ref，避免循环依赖 */
  const actionsRef = useRef<{
    save: (options?: { force?: boolean }) => Promise<void>;
    open: (id: string) => Promise<void>;
    create: (options?: { title?: string; workId?: string | null }) => Promise<void>;
  } | null>(null);

  const notifyLibrary = useCallback(() => {
    onLibraryChanged?.();
  }, [onLibraryChanged]);

  /* ───────────────── 写盘 ───────────────── */

  const doSave = useCallback(
    async (options?: { force?: boolean }) => {
      const api = mapApi();
      const file = useMapFileStore.getState();
      if (!api || !file.docId) return;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const doc = useMapDocStore.getState().doc;
      const viewport = useMapViewportStore.getState().viewport;
      const payload = { id: file.docId, doc, baseRev: file.rev, viewport };
      useMapFileStore.getState().setStatus("saving");
      try {
        const result = options?.force ? await api.flush(payload) : await api.save(payload);
        if (result.ok) {
          useMapFileStore.getState().setRev(result.rev);
          useMapFileStore.getState().setStatus("saved");
          return;
        }
        if (result.conflict) {
          // 冲突：把内存里的 baseRev 对齐到库里的最新值，保证"覆盖保存"能成功
          useMapFileStore.getState().setRev(result.rev);
          useMapFileStore.getState().setStatus("conflict");
          if (conflictOpenRef.current) return;
          conflictOpenRef.current = true;
          const targetId = file.docId;
          modal.confirm({
            title: "这张地图已在别处修改",
            content:
              "当前画面上的改动还没有保存，而库里的版本比它新。可以载入库里的最新版本，或把当前画面覆盖上去。",
            okText: "覆盖保存",
            cancelText: "载入最新",
            onOk: async () => {
              conflictOpenRef.current = false;
              await actionsRef.current?.save({ force: true });
            },
            onCancel: async () => {
              conflictOpenRef.current = false;
              await actionsRef.current?.open(targetId);
            },
          });
          return;
        }
        useMapFileStore.getState().setStatus("error");
      } catch {
        useMapFileStore.getState().setStatus("error");
      }
    },
    [modal],
  );

  /* ───────────────── 打开 / 新建 ───────────────── */

  const openDoc = useCallback(
    async (id: string) => {
      const api = mapApi();
      if (!api) return;
      // 切图前先把上一张写完：否则"切走再切回"会拿到旧版本，看起来像丢改动
      if (useMapFileStore.getState().docId && useMapFileStore.getState().status !== "saved") {
        await actionsRef.current?.save();
      }
      hydratingRef.current = true;
      try {
        const payload = await api.get(id);
        if (!payload) {
          message.error("这张地图打不开了（可能已被删除）");
          return;
        }
        const doc = migrateDoc(payload.doc);
        resetMapDocStore(doc);
        resetMapSelectionStore();
        pendingViewportRef.current = payload.viewport;
        useMapFileStore.getState().openFile({
          id: payload.id,
          title: payload.title,
          workId: payload.workId,
          rev: payload.rev,
        });
        if (payload.corrupt) {
          message.warning("这张地图的存档已损坏，已按空白地图打开");
        }
      } catch {
        message.error("打开地图失败");
      } finally {
        hydratingRef.current = false;
      }
    },
    [message],
  );

  const createDoc = useCallback(
    async (options?: { title?: string; workId?: string | null }) => {
      const api = mapApi();
      if (!api) return;
      if (useMapFileStore.getState().docId && useMapFileStore.getState().status !== "saved") {
        await actionsRef.current?.save();
      }
      hydratingRef.current = true;
      try {
        const created = await api.create({ title: options?.title, workId: options?.workId ?? null });
        if (!created || "ok" in created) {
          // 作品校验被拒（作品已删 / 在回收站）：退化成独立地图，不让建图失败
          const fallback = await api.create({ title: options?.title, workId: null });
          if (!fallback || "ok" in fallback) {
            message.error("新建地图失败");
            return;
          }
          message.warning("所选作品不可用，已按独立地图新建");
          await openDoc(fallback.id);
        } else {
          await openDoc(created.id);
        }
        notifyLibrary();
      } catch {
        message.error("新建地图失败");
      } finally {
        hydratingRef.current = false;
      }
    },
    [message, notifyLibrary, openDoc],
  );

  /* ───────────────── 元信息 ───────────────── */

  const renameDoc = useCallback(
    async (id: string, next: string) => {
      const api = mapApi();
      if (!api) return;
      const result = await api.rename(id, next);
      if (!result?.ok) {
        message.error("改名失败");
        return;
      }
      // 改的是当前打开的这张时，顺带同步工具栏标题（store 是单一事实源）
      if (useMapFileStore.getState().docId === id) {
        useMapFileStore.getState().setTitle(result.title);
      }
      notifyLibrary();
    },
    [message, notifyLibrary],
  );

  const bindWork = useCallback(
    async (id: string, nextWorkId: string | null) => {
      const api = mapApi();
      if (!api) return;
      const result = await api.bind(id, nextWorkId);
      if (!result?.ok) {
        // 失败原因是**枚举**，文案在这一层拼（主进程不产出面向用户的句子）
        const reason = "reason" in result ? result.reason : "work_not_found";
        message.error(
          reason === "work_deleted"
            ? "这部作品在回收站里，先把作品恢复再绑定"
            : reason === "doc_not_found"
              ? "这张地图已经不存在了"
              : "找不到这部作品",
        );
        return;
      }
      if (useMapFileStore.getState().docId === id) {
        useMapFileStore.getState().setWorkId(nextWorkId);
      }
      notifyLibrary();
    },
    [message, notifyLibrary],
  );

  /* ───────────────── 删除 ───────────────── */

  const deleteDoc = useCallback(
    async (id: string) => {
      const api = mapApi();
      if (!api) return;
      const wasCurrent = useMapFileStore.getState().docId === id;
      const result = await api.remove(id);
      if (!result?.ok) {
        message.error("删除失败");
        return;
      }
      notifyLibrary();
      if (!wasCurrent) {
        message.success("已移入回收站");
        return;
      }
      // 删的是当前图：先断开 file（避免自动保存往已删的图里写），再找下一张
      useMapFileStore.getState().reset();
      const remaining = (await api.docsList()) ?? [];
      if (remaining.length > 0) {
        await openDoc(remaining[0].id);
      } else {
        await createDoc();
      }
      message.success("已移入回收站（在「地图库 → 回收站」可恢复）");
    },
    [createDoc, message, notifyLibrary, openDoc],
  );

  const restoreDoc = useCallback(
    async (id: string) => {
      const api = mapApi();
      if (!api) return;
      const result = await api.restore(id);
      if (!result?.ok) {
        message.error("恢复失败");
        return;
      }
      notifyLibrary();
      message.success("已恢复到地图列表");
    },
    [message, notifyLibrary],
  );

  const purgeDoc = useCallback(
    async (id: string) => {
      const api = mapApi();
      if (!api) return;
      const result = await api.purge(id);
      if (!result?.ok) {
        message.error("彻底删除失败");
        return;
      }
      notifyLibrary();
      message.success("已彻底删除");
    },
    [message, notifyLibrary],
  );

  const saveThumb = useCallback(async (png: Uint8Array) => {
    const api = mapApi();
    const file = useMapFileStore.getState();
    if (!api || !file.docId || !png?.length) return;
    try {
      await api.thumb(file.docId, png);
    } catch {
      // 缩略图是锦上添花：失败就继续用占位图，绝不打扰用户
    }
  }, []);

  const saveNow = useCallback(async () => {
    await doSave();
  }, [doSave]);

  const takePendingViewport = useCallback(() => {
    const viewport = pendingViewportRef.current;
    pendingViewportRef.current = null;
    return viewport;
  }, []);

  /*
    【动作互引为什么放 effect 而不是渲染期赋值】doSave ↔ openDoc 互相调用
    （保存失败要重开、切换文档要先存），声明顺序不可能两全，用 ref 打断。
    但 ref 的写入必须发生在渲染之后 —— 渲染期改 ref 会让 React 的"渲染是纯函数"
    前提失效（eslint 的 react-hooks/refs 直接报错）。放在 effect 里同样"总是最新"，
    因为这些回调只在事件 / effect 之后被调用。
  */
  useEffect(() => {
    actionsRef.current = { save: doSave, open: openDoc, create: createDoc };
  }, [doSave, openDoc, createDoc]);

  /* ───────────────── 自动保存订阅 ───────────────── */

  useEffect(() => {
    const unsubscribe = useMapDocStore.subscribe((state, prev) => {
      if (state.doc === prev.doc) return;
      // 装载期间的 doc 变更来自 resetMapDocStore，不是用户编辑
      if (hydratingRef.current) return;
      if (!useMapFileStore.getState().docId) return;
      useMapFileStore.getState().setStatus("dirty");
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void actionsRef.current?.save();
      }, SAVE_DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  /* ───────────────── 启动装载 ───────────────── */

  useEffect(() => {
    if (useMapFileStore.getState().loaded) return;
    const api = mapApi();
    if (!api) {
      // 无 electronAPI（单测 / 浏览器预览）：直接当成"已装载"，界面照常可画
      useMapFileStore.getState().markLoaded();
      return;
    }
    if (!startupPromise) {
      startupPromise = (async () => {
        try {
          const list = (await api.docsList()) ?? [];
          const recent = list[0];
          if (recent) await actionsRef.current?.open(recent.id);
          else await actionsRef.current?.create();
        } catch {
          // 库没就绪（未登录）时也要让界面可用：保持空文档，只是保存会失败
          message.warning("地图存档暂不可用，本次修改不会被保存");
        } finally {
          useMapFileStore.getState().markLoaded();
        }
      })();
    }
    void startupPromise;
  }, [message]);

  /* ───────────────── 关窗 flush ───────────────── */

  useEffect(() => {
    const electron = window.electronAPI;
    if (!electron?.receive) return;
    const off = electron.receive("map-doc-request-snapshot", () => {
      void (async () => {
        try {
          await actionsRef.current?.save({ force: true });
        } finally {
          // 无论成败都要回执：不回就是"点了关闭，窗口愣 1.5 秒才消失"
          electron.send?.("map-doc-flush-done", null);
        }
      })();
    });
    return off;
  }, []);

  return {
    docId,
    title,
    workId,
    status,
    loaded,
    openDoc,
    createDoc,
    renameDoc,
    deleteDoc,
    restoreDoc,
    purgeDoc,
    bindWork,
    saveNow,
    takePendingViewport,
    saveThumb,
  };
}

/** 列表拉取（弹窗自己管刷新，避免 hook 持有第二份列表） */
export async function listMapDocs(options?: {
  workId?: string | null;
  includeDeleted?: boolean;
}): Promise<MapDocSummaryDTO[]> {
  const api = mapApi();
  if (!api) return [];
  try {
    return (await api.docsList(options?.workId ?? null, options?.includeDeleted ?? false)) ?? [];
  } catch {
    return [];
  }
}

/** 作品下拉（供绑定选择器；novel.db 未就绪时返回空数组） */
export async function listMapWorkOptions(): Promise<Array<{ id: string; name: string }>> {
  const api = mapApi();
  if (!api) return [];
  try {
    return (await api.workOptions()) ?? [];
  } catch {
    return [];
  }
}

/**
 * 取一张图的**完整文档**（路径 A′「绑定已有子图」用）。
 *
 * 【为什么在这里而不是选择器组件里做】`migrateDoc` 归一是装载管线的职责
 * （与 `openDoc` 同一条规则），选择器保持纯展示；打不开（已删 / 未就绪）返回 null，
 * 由调用方决定提示文案。
 */
export async function loadMapDocById(
  id: string,
): Promise<{ doc: MapDocument; title: string } | null> {
  const api = mapApi();
  if (!api) return null;
  try {
    const payload = await api.get(id);
    if (!payload) return null;
    return { doc: migrateDoc(payload.doc), title: payload.title };
  } catch {
    return null;
  }
}
