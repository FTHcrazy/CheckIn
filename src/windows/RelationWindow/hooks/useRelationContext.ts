/**
 * 关系图窗口上下文（作品 id）
 *
 * 两条投递路径，负载形状相同：
 * - `relation-window-context`：主进程在新窗口 did-finish-load 后下发（打开时携带）；
 * - `novel-work-changed`：主窗口切换作品后广播（与行囊窗口同范式）。
 *
 * 区别在**第一次**与**之后**：第一次收到上下文是「绑定」，直接采纳；此后
 * 任何换书消息（含主窗口重复唤起窗口时补发的那次）一律先挂起 —— 由横幅让
 * 用户决定（S2 的「切书不静默」）。自动跟随看起来更顺，但会让正在摆图的人
 * 一抬头发现画布已经换了一本书；关窗守卫也来不及问「未确认的连线怎么办」。
 *
 * ⚠️ `relation-window-context` 不只在新建窗口时发：`createRelationWindow()`
 * 对已存在的窗口会直接再投一次（raise 到前台）。若把它当成「绑定」，用户
 * 在主窗口换了书再点开图窗口，画布就会静默换书 —— 与上面那条口径冲突。
 *
 * 空 workId 也照收（作品被删光）：App 侧据此显示空态，而不是继续画已删作品的图。
 */
import { useCallback, useEffect, useState } from "react";

export interface RelationWindowContext {
  /** 本窗口当前正在看的作品；null = 还没收到任何上下文 */
  workId: string | null;
  /** 主窗口已切到、但用户尚未确认的作品；null = 没有待确认的切换 */
  pendingWorkId: string | null;
}

function readWorkId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const workId = (value as { workId?: unknown }).workId;
  return typeof workId === "string" ? workId : null;
}

export function useRelationContext(): RelationWindowContext & {
  adoptPending: () => void;
  dismissPending: () => void;
} {
  const [state, setState] = useState<RelationWindowContext>({ workId: null, pendingWorkId: null });

  useEffect(() => {
    const api = window.electronAPI?.windowAPI;
    if (!api) return undefined;

    /**
     * 两条通道同一套反应：第一次绑定，之后只挂起。
     *
     * 合并成一份实现的原因：`relation-window-context` 既可能是「打开时携带」
     * 也可能是「重复唤起时补发」，靠事件名区分不出用户意图，只能靠「当前是否
     * 已经绑定过」来判断。
     */
    const handleContext = (...args: unknown[]): void => {
      const workId = readWorkId(args[0]);
      if (workId === null) return;
      setState((current) => {
        if (current.workId === null) return { workId, pendingWorkId: null };
        if (current.workId === workId) return { workId: current.workId, pendingWorkId: null };
        return { workId: current.workId, pendingWorkId: workId };
      });
    };

    api.on("relation-window-context", handleContext);
    api.on("novel-work-changed", handleContext);
    return () => {
      api.off("relation-window-context", handleContext);
      api.off("novel-work-changed", handleContext);
    };
  }, []);

  const adoptPending = useCallback(() => {
    setState((current) =>
      current.pendingWorkId ? { workId: current.pendingWorkId, pendingWorkId: null } : current,
    );
  }, []);

  const dismissPending = useCallback(() => {
    setState((current) =>
      current.pendingWorkId ? { workId: current.workId, pendingWorkId: null } : current,
    );
  }, []);

  return { ...state, adoptPending, dismissPending };
}
