import { useCallback, useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import { getActiveDates } from "@/shared/services/daily";
import { fetchGitWebhookLogs } from "@/shared/services/code";

export interface HomeOverview {
  /** 未完成的一级待办数 */
  todoCount: number | null;
  /** 备忘文件数 */
  memoCount: number | null;
  /** 本月打卡（有活动的）天数 */
  checkinDays: number | null;
  /** 今日代码有效产出（新增行 + 删除行 × 0.3） */
  codeLines: number | null;
  /** 当前登录邮箱 */
  email: string;
}

const EMPTY_OVERVIEW: HomeOverview = {
  todoCount: null,
  memoCount: null,
  checkinDays: null,
  codeLines: null,
  email: "",
};

/** 单条提交的有效产出，口径与代码页保持一致 */
function calcLines(insertions: string, deletions: string): number {
  return (Number(insertions) || 0) + (Number(deletions) || 0) * 0.3;
}

/**
 * 首页数据概览：待办 / 备忘 / 打卡 / 代码四项。
 *
 * 说明：
 * - 前三项走本地 IPC，代码行数要发网络请求且依赖外部服务，
 *   任一项失败都只把该项置 null（页面渲染为「—」），不影响其余数据展示。
 */
export function useHomeOverview() {
  const [overview, setOverview] = useState<HomeOverview>(EMPTY_OVERVIEW);
  const [loading, setLoading] = useState(true);
  // 卸载标记：异步回调回来时组件可能已销毁，避免 setState 警告与竞态写入
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);

    const api = window.electronAPI;
    const today = dayjs().startOf("day");

    const [todoResult, memoResult, checkinResult, userResult] =
      await Promise.allSettled([
        api?.todo.list() ?? Promise.reject(new Error("todo API 不可用")),
        api?.memo.list() ?? Promise.reject(new Error("memo API 不可用")),
        getActiveDates(
          today.startOf("month").format("YYYY-MM-DD"),
          today.format("YYYY-MM-DD"),
        ),
        api?.user.get() ?? Promise.reject(new Error("user API 不可用")),
      ]);

    if (!aliveRef.current) return;

    const email =
      userResult.status === "fulfilled" && userResult.value?.email
        ? String(userResult.value.email).trim()
        : "";

    const next: HomeOverview = {
      todoCount:
        todoResult.status === "fulfilled"
          ? todoResult.value.filter(
              (item) => item.parent_id === null && item.done === 0,
            ).length
          : null,
      memoCount:
        memoResult.status === "fulfilled" ? memoResult.value.length : null,
      checkinDays:
        checkinResult.status === "fulfilled" ? checkinResult.value.size : null,
      codeLines: null,
      email,
    };

    setOverview(next);
    setLoading(false);

    // 代码行数是网络请求，且不阻塞上面三项本地数据的展示，单独异步补齐
    if (!email) return;

    try {
      const res = await fetchGitWebhookLogs(
        email,
        today.format("YYYY/M/D HH:mm:ss"),
        today.endOf("day").format("YYYY/M/D HH:mm:ss"),
      );
      const list = res.gitwebhooklog?.pageInfo?.list ?? [];
      const lines = list.reduce(
        (sum, item) => sum + calcLines(item.insertions, item.deletions),
        0,
      );

      if (!aliveRef.current) return;
      setOverview((prev) => ({ ...prev, codeLines: Math.round(lines) }));
    } catch {
      // 外部服务不可用：保持 null，页面渲染为「—」
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { overview, loading, reload };
}
