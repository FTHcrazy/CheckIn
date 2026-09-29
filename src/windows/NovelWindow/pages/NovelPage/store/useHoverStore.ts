/**
 * 悬浮资料卡的 hover 意图（模块级 Zustand store）
 *
 * 为什么抽到全局：此前 `useEntityHover` 的 `target` 是页面根组件的 useState，
 * 而触发点在最深处的 `EditorPane` 的 `mousemove` 上——鼠标停在高亮词上移动时，
 * 每个 mousemove 事件都会 `setTarget({...current, x, y})` 产生新对象，
 * 于是「扫过一段正文」= 每秒数十次把 NovelPage 整棵树（章节树 / 右栏五面板 /
 * 顶栏 / 四个抽屉）全部重渲染一遍。
 *
 * 放在 store 后：谁都不用把 target 往下传，`HoverEntityCard` 自己订阅，
 * enter / leave / dismiss 成为模块级稳定函数——EditorPane 的 props 不再因
 * hover 变化，父层怎么动都不会连带重渲染。
 *
 * 边界（与 useSearchStore 同一范式）：store 不认识 `entities` 数组，
 * 要素对象由页面注册的 resolver 在「真正浮现的那一刻」解析一次并快照；
 * 悬停是短生命周期交互，快照足够，不需要跟着要素编辑实时刷新。
 *
 * 行为约定（沿用原 useEntityHover，不做语义变更）：
 * - 指针停留满 `hoverOpenMs` 才浮现，移开 `hoverCloseMs` 才消失，防止扫过时闪烁
 * - 已浮现时移动只改坐标；坐标没变就不写入（消除 1px 抖动带来的无谓通知）
 * - 从上一个词直接滑到另一个词：按新词重新计时，不再沿用旧 entityId
 *   （原实现会保留旧 id 只改坐标，跨词时卡片会显示错要素）
 */

import { create } from "zustand";
import { ANNOTATION } from "../novel-config";
import type { NovelEntity } from "../types";

/** 悬停目标：要素 id + 相对码字区容器的坐标 */
export interface HoverTarget {
  entityId: string;
  x: number;
  y: number;
}

export interface HoverState {
  /** null = 当前没有悬浮卡 */
  target: HoverTarget | null;
  /** 目标要素快照（解析失败为 null，卡片不渲染） */
  entity: NovelEntity | null;
  enter: (entityId: string, x: number, y: number) => void;
  leave: () => void;
  /** 立即关闭（键盘输入 / 滚动 / 失焦 / 跳章 / 打开详情） */
  dismiss: () => void;
}

/** 要素解析器，由页面在挂载时注册、卸载时注销（注册不触发任何请求） */
let resolver: ((entityId: string) => NovelEntity | null) | null = null;

/** 浮现 / 消失计时器 */
let openTimer: number | null = null;
let closeTimer: number | null = null;

export function registerHoverResolver(
  fn: ((entityId: string) => NovelEntity | null) | null,
): void {
  resolver = fn;
}

/** 清空计时器：进入与离开互斥，后发生者取消前者 */
function clearTimers(): void {
  if (openTimer !== null) {
    window.clearTimeout(openTimer);
    openTimer = null;
  }
  if (closeTimer !== null) {
    window.clearTimeout(closeTimer);
    closeTimer = null;
  }
}

export const useHoverStore = create<HoverState>()((set, get) => ({
  target: null,
  entity: null,

  enter: (entityId, x, y) => {
    clearTimers();

    const current = get().target;
    if (current && current.entityId === entityId) {
      // 同一要素内移动：只跟随指针。坐标未变则不写入，避免抖动刷屏
      if (current.x === x && current.y === y) return;
      set({ target: { ...current, x, y } });
      return;
    }

    // 新要素（或首次进入）：重新计时，停留满阈值才浮现
    openTimer = window.setTimeout(() => {
      openTimer = null;
      set({
        target: { entityId, x, y },
        entity: resolver ? resolver(entityId) : null,
      });
    }, ANNOTATION.hoverOpenMs);
  },

  leave: () => {
    clearTimers();
    closeTimer = window.setTimeout(() => {
      closeTimer = null;
      set({ target: null, entity: null });
    }, ANNOTATION.hoverCloseMs);
  },

  dismiss: () => {
    clearTimers();
    // 已经关着就不通知，避免高频 dismiss（跳章 / 打开详情）刷出空提交
    if (get().target === null && get().entity === null) return;
    set({ target: null, entity: null });
  },
}));

/** 顶层便捷函数：身份稳定，编排层可直接调用（跳章 / 打开详情时收起卡片） */
export const dismiss = (): void => {
  useHoverStore.getState().dismiss();
};

/**
 * 稳定动作引用：身份永不变化，可直接当 props 透传给 EditorPane，
 * 这样「父层重渲染 → 回调身份变 → 子组件 memo 失效」这条链就断了。
 */
export const hoverActions = {
  enter: (entityId: string, x: number, y: number): void => {
    useHoverStore.getState().enter(entityId, x, y);
  },
  leave: (): void => {
    useHoverStore.getState().leave();
  },
  dismiss,
};
