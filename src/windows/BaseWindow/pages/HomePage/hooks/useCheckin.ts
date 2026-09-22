/**
 * 首页打卡按钮业务逻辑：状态查询 + 打卡提交 + 次日 5 点自动重置。
 *
 * - 业务日切分在主进程（凌晨 0-5 点归属前一天），本 hook 只消费 status/resetAt；
 * - 挂载时拉取一次状态，并按 resetAt 定时重拉，应用跨夜开着时按钮自动恢复可打卡；
 * - 打卡不跳转页面，结果经 message 反馈，同时触发首页统计刷新。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { App } from "antd";
import dayjs from "dayjs";
import {
  getCheckinStatus,
  submitCheckin,
} from "@/shared/services/checkin";
import type { CheckinStatusDTO } from "@/shared/types/electron";

export function useCheckin(onChecked?: () => void) {
  const { message } = App.useApp();
  const [status, setStatus] = useState<CheckinStatusDTO | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const loadStatus = useCallback(async (): Promise<void> => {
    try {
      const next = await getCheckinStatus();
      if (aliveRef.current) setStatus(next);
    } catch {
      // 打卡环境不可用（非客户端）：保持 null，按钮退化为不可用态
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // 次日五点重置：跨过 resetAt 后重查状态，已打卡按钮自动恢复为可打卡
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    if (!status) return;

    const delay = dayjs(status.resetAt).diff(dayjs(), "millisecond");
    if (delay <= 0) {
      void loadStatus();
      return;
    }
    resetTimerRef.current = setTimeout(() => {
      void loadStatus();
    }, delay);
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, [status, loadStatus]);

  const handleCheckin = useCallback(async (): Promise<void> => {
    if (status?.checkedIn || submitting) return;
    setSubmitting(true);
    try {
      const result = await submitCheckin();
      if (!aliveRef.current) return;
      if (result.created) {
        message.success("打卡成功，继续保持！");
        onChecked?.();
      } else {
        message.info("今天已经打过卡啦");
      }
      await loadStatus();
    } catch (error) {
      message.error("打卡失败，请重试");
      console.error(error);
    } finally {
      if (aliveRef.current) setSubmitting(false);
    }
  }, [loadStatus, message, onChecked, status?.checkedIn, submitting]);

  return {
    /** null = 状态未知（加载中或环境不可用），按钮禁用避免误触 */
    status,
    submitting,
    handleCheckin,
  };
}
