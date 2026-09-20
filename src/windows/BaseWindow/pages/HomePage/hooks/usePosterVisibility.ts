/**
 * 首页右下角报纸提醒的展示状态机。
 *
 * 展示生命周期（每个"周期"展示一次）：
 * - 应用启动后：探测成功（live）即展示一次；
 * - 隔天 9 点：周期 key 翻转，展示/点击状态自动重置，重新探测成功后再展示一次；
 * - 点击跳转资讯页：本周期内不再展示，次日起恢复。
 * - 探测失败保持隐藏（不打扰首页），下次进入首页或下个周期重试。
 *
 * 周期定义：今天 9 点前仍属于"昨天"的周期（未到重置时刻不算新的一天）。
 * 状态放在模块级：窗口生命周期 = 应用会话生命周期，路由切换/StrictMode
 * 重挂载不重置；探测用"进行中 Promise 缓存"去重（StrictMode 双挂载各持
 * 独立订阅，防止 1.4.7 的"首挂载回调被判死 + 重挂载跳过订阅"陷阱）。
 */

import { useEffect, useState } from "react";
import { fetchDailyNews } from "@/shared/services/news";
import type { DailyNewsPayload } from "@/shared/services/news";

/** 每日重置时刻：早上 9 点 */
export const POSTER_RESET_HOUR = 9;
/** 周期检查间隔：60s（只做 key 比对，成本可忽略） */
const TICK_MS = 60_000;

/** 当前周期标识：9 点前返回昨天日期，9 点起返回今天日期（如 "2026-09-20"） */
export function currentCycleKey(now = new Date()): string {
  const d = new Date(now);
  if (d.getHours() < POSTER_RESET_HOUR) d.setDate(d.getDate() - 1);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// 模块级状态（应用会话生命周期）
let shownCycleKey: string | null = null;
let dismissedCycleKey: string | null = null;
let pendingProbe: { cycle: string; promise: Promise<DailyNewsPayload> } | null =
  null;

/** 供测试重置模块状态 */
export function __resetPosterStateForTest(): void {
  shownCycleKey = null;
  dismissedCycleKey = null;
  pendingProbe = null;
}

export function usePosterVisibility(): {
  showPoster: boolean;
  dismissPoster: () => void;
} {
  const [showPoster, setShowPoster] = useState(false);

  useEffect(() => {
    let mounted = true;

    const probe = (cycle: string) => {
      if (shownCycleKey === cycle) return;
      // 同周期进行中的探测复用（StrictMode 双挂载去重），但各自独立订阅结果
      let promise: Promise<DailyNewsPayload>;
      if (pendingProbe?.cycle === cycle) {
        promise = pendingProbe.promise;
      } else {
        promise = fetchDailyNews();
        pendingProbe = { cycle, promise };
      }
      promise
        .then((payload) => {
          if (pendingProbe?.promise === promise) pendingProbe = null;
          if (!mounted || !payload.live) return; // 失败保持隐藏，下次进入首页重试
          if (currentCycleKey() !== cycle) return; // 周期已翻转，结果作废
          if (dismissedCycleKey === cycle) return; // 用户已点击，不再打扰
          shownCycleKey = cycle;
          setShowPoster(true);
        })
        .catch(() => {
          if (pendingProbe?.promise === promise) pendingProbe = null;
        });
    };

    const run = (cycle: string) => {
      if (shownCycleKey === cycle) {
        // 本周期已展示且未点击：恢复展示（路由往返回到首页的场景）
        if (dismissedCycleKey !== cycle) setShowPoster(true);
        return;
      }
      // 新周期（或尚未展示）：先隐藏，探测成功才展示
      setShowPoster(false);
      probe(cycle);
    };

    let lastCycle: string | null = null;
    const tick = () => {
      const cycle = currentCycleKey();
      if (cycle === lastCycle) return;
      lastCycle = cycle;
      run(cycle);
    };

    tick();
    const timer = window.setInterval(tick, TICK_MS);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  // 点击海报：本周期内不再展示，隔天 9 点随周期重置恢复
  const dismissPoster = () => {
    dismissedCycleKey = currentCycleKey();
    setShowPoster(false);
  };

  return { showPoster, dismissPoster };
}
