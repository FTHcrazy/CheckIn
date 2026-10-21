/**
 * 关系图跳转 + 主窗口视图的单一事实源（zustand）。
 *
 * 为什么用 store 而不是组件 state + ref：这条链路横跨「IPC 监听（只注册一次）×
 * 视图切换 × 编辑器句柄生命周期」，曾经散落在 App 的三份 ref + 两个 state 里，
 * 闭包陷阱与时序竞态就是它的症状（只唤起不弹窗 / 返回书架却切书 / 书架页冒出
 * 确认框）。状态机收进 store 后：
 *
 * - 判定永远读**当下**的状态（zustand 的 `get()`），不存在过期闭包；
 * - IPC 监听只注册一次，handler 只做一件事：`handoff(payload)`；
 * - 「回到书架」在动作里**同步**作废挂起 / 待确认的跳转，不等 effect。
 *
 * 状态机（判定纯函数见 `../utils/entity-jump`）：
 *
 * | 动作      | 含义                                                         |
 * |-----------|--------------------------------------------------------------|
 * | `shelf`   | 编辑器挂载过 → 书架直切；没挂载过 → 先恢复编辑器再重判        |
 * | `open`    | 同一本书 / 空态：直接开卡                                     |
 * | `confirm` | 另一本书：只弹确认框，确认后才保存 → 切书 → 开卡              |
 * | `defer`   | 句柄缺席 / 数据未就绪：挂起，由兜底重试（App 的 300ms 定时）重判 |
 * | `ignore`  | 负载无效，什么都不做                                          |
 */
import { create } from "zustand";
import type { GuideView } from "@/shared/novel/guide-copy";
import type { OpenWorkRequest } from "../pages/NovelPage/NovelPage";
import {
  ENTITY_JUMP_REPLAY_MS,
  resolveEntityJumpAction,
  type EntityOpenPayload,
  type NovelEditorBridge,
} from "../utils/entity-jump";

interface EntityJumpState {
  /** 视图：书架主页 / 编辑器（整个 NovelWindow 的显隐开关都在这） */
  view: GuideView;
  /** 编辑器是否挂载过（懒挂载；一旦挂载就常驻，只切显隐） */
  editorMounted: boolean;
  /** 书架 → 编辑器的打开请求（幂等 token，NovelPage 消费） */
  openRequest: OpenWorkRequest | null;
  /** 编辑器空书架空态的「导入书籍」请求 */
  importRequest: number | null;

  /** 编辑器能力句柄（NovelPage 经 onEditorBridge 交上来；卸载 / 重挂载会置 null） */
  bridge: NovelEditorBridge | null;
  /** 挂起中的跳转：还没法判定（句柄缺席 / 未就绪），等重试或重判 */
  deferred: EntityOpenPayload | null;
  /** 待确认的跳转：非 null 即弹确认框 */
  pending: EntityOpenPayload | null;
  /** 「保存后跳转」进行中（防连点） */
  saving: boolean;
  /** 去重：最近处理过的负载（通道重放只处理一次） */
  lastKey: string | null;
  lastAt: number;

  setBridge: (bridge: NovelEditorBridge | null) => void;
  /** IPC 入口：去重后判定并派发（监听只此一处，handler 只调这个） */
  handoff: (payload: EntityOpenPayload) => void;
  /** 兜底重试：取走挂起的跳转重判一次（还没就绪会再次挂起） */
  retryDeferred: () => void;
  /** 「保存后跳转」：先落当前书的草稿，成功才切；失败留在原处 */
  confirmEntityJump: () => Promise<void>;
  cancelEntityJump: () => void;

  openWork: (workId: string, chapterId?: string, entityId?: string) => void;
  consumeOpenRequest: () => void;
  backToShelf: () => void;
  goToView: (target: GuideView) => void;
  requestImport: () => void;
  consumeImportRequest: () => void;
}

/** 判定并派发一条跳转（读 get() 的当下状态，无闭包） */
function decide(
  set: (partial: Partial<EntityJumpState>) => void,
  get: () => EntityJumpState,
  payload: EntityOpenPayload,
): void {
  const state = get();
  const bridge = state.bridge;
  // 判定用一份快照：bridge 的 getter 在这一拍内是自洽的
  const current = bridge ? bridge.activeWorkId() : "";
  const action = resolveEntityJumpAction({
    onShelf: state.view === "shelf",
    hasBridge: bridge !== null,
    editorReady: bridge ? bridge.ready() : false,
    activeWorkId: current,
    targetWorkId: payload.workId,
  });

  if (action === "ignore") return;
  if (action === "defer") {
    // 新意图到达时，旧确认框作废：最新意图优先
    set({ deferred: payload, pending: null });
    return;
  }
  if (action === "shelf") {
    if (!state.editorMounted) {
      // 主窗口是刚被这条跳转拉起来的：视图停在书架只因编辑器还没挂载，
      // **不代表用户上次停在书架**。先挂载编辑器按上次位置恢复「当前书」，
      // 跳转挂起重判 —— 同书直开卡，异书照常弹确认框。
      set({
        deferred: payload,
        pending: null,
        editorMounted: true,
        view: "editor",
      });
      return;
    }
    set({ pending: null, deferred: null });
    state.openWork(payload.workId, undefined, payload.entityId);
    return;
  }
  if (action === "confirm") {
    // 只挂起，绝不先切书 —— 切书与开卡都在确认之后
    set({ pending: payload, deferred: null });
    return;
  }
  // open：快照里是同一本，或编辑器空态（没有可保存的东西）→ 允许直切
  if (!bridge) return;
  set({ pending: null, deferred: null });
  if (current !== payload.workId) bridge.switchWork(payload.workId);
  bridge.openEntity(payload.entityId);
}

export const useEntityJumpStore = create<EntityJumpState>((set, get) => ({
  view: "shelf",
  editorMounted: false,
  openRequest: null,
  importRequest: null,
  bridge: null,
  deferred: null,
  pending: null,
  saving: false,
  lastKey: null,
  lastAt: 0,

  setBridge: (bridge) => {
    set({ bridge });
    // 句柄就绪 / 更换时立即重判挂起的跳转（300ms 定时只是兜底）：
    // 「数据装载完成」这个时刻只有句柄重登记能感知到
    if (bridge && get().deferred) get().retryDeferred();
  },

  handoff: (payload) => {
    const state = get();
    const key = `${payload.workId}\u0000${payload.entityId}`;
    const now = Date.now();
    // 同一条跳转可能经两条路到达（收件箱补投 + 实时投递）：只处理一次
    if (state.lastKey === key && now - state.lastAt < ENTITY_JUMP_REPLAY_MS) return;
    set({ lastKey: key, lastAt: now });
    decide(set, get, payload);
  },

  retryDeferred: () => {
    const deferred = get().deferred;
    if (!deferred) return;
    set({ deferred: null });
    decide(set, get, deferred);
  },

  confirmEntityJump: async () => {
    const bridge = get().bridge;
    const target = get().pending;
    if (!target || !bridge) return;
    set({ saving: true });
    try {
      const saved = await bridge.flushSave();
      if (!saved) {
        bridge.toast("保存失败，已留在当前作品（草稿仍在本地，稍后会自动重试）", "warning");
        return;
      }
      // 先关确认框、再切书：用户看到的是「弹窗消失 → 书切过去了」
      set({ pending: null });
      bridge.switchWork(target.workId);
      bridge.openEntity(target.entityId);
    } finally {
      set({ saving: false });
    }
  },

  cancelEntityJump: () => set({ pending: null }),

  openWork: (workId, chapterId, entityId) => {
    // 用户主动打开 = 新意图：残留的跳转全部作废
    set({
      editorMounted: true,
      openRequest: { workId, chapterId, entityId, token: Date.now() },
      view: "editor",
      pending: null,
      deferred: null,
    });
  },

  consumeOpenRequest: () => set({ openRequest: null }),

  backToShelf: () => {
    // 返回书架 = 明确放弃挂起 / 待确认的跳转。**同步**清（不等 effect）：
    // 否则残留消息在书架态被重判，就是真机复现过的「返回书架却切书」
    set({ view: "shelf", pending: null, deferred: null });
  },

  goToView: (target) => {
    if (target === "shelf") {
      set({ view: "shelf", pending: null, deferred: null });
      return;
    }
    set({ view: target });
  },

  requestImport: () => {
    set({ view: "shelf", pending: null, deferred: null, importRequest: Date.now() });
  },

  consumeImportRequest: () => set({ importRequest: null }),
}));

/** 测试隔离用：把状态机拨回初始态 */
export function resetEntityJumpStore(): void {
  useEntityJumpStore.setState({
    view: "shelf",
    editorMounted: false,
    openRequest: null,
    importRequest: null,
    bridge: null,
    deferred: null,
    pending: null,
    saving: false,
    lastKey: null,
    lastAt: 0,
  });
}
