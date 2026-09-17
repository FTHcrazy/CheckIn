import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { App } from "antd";
import dayjs from "dayjs";

const WEEK_LABELS = [
  "星期日",
  "星期一",
  "星期二",
  "星期三",
  "星期四",
  "星期五",
  "星期六",
];

function buildGreeting(): string {
  const hour = dayjs().hour();
  if (hour < 6) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

/**
 * 首页交互：路由跳转 + 快捷新建待办。
 *
 * 快捷新建直接在首页调 todo IPC，省掉「进待办页 → 找输入框」两步操作；
 * 新建备忘/代码没有可省略的输入项，仍走跳转。
 */
export function useHomeActions(onTodoAdded?: () => void) {
  const navigate = useNavigate();
  const { message } = App.useApp();

  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddValue, setQuickAddValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const greeting = useMemo(() => buildGreeting(), []);

  const todayText = useMemo(() => {
    const now = dayjs();
    return `${now.format("YYYY年M月D日")} · ${WEEK_LABELS[now.day()]}`;
  }, []);

  const openQuickAdd = useCallback(() => {
    setQuickAddValue("");
    setQuickAddOpen(true);
  }, []);

  const closeQuickAdd = useCallback(() => {
    setQuickAddOpen(false);
  }, []);

  const submitQuickAdd = useCallback(async () => {
    const content = quickAddValue.trim();
    if (!content) {
      message.warning("请输入待办内容");
      return;
    }

    setSubmitting(true);
    try {
      await window.electronAPI!.todo.add(content, null);
      message.success("已添加待办");
      setQuickAddOpen(false);
      onTodoAdded?.();
    } catch {
      message.error("添加失败，请重试");
    } finally {
      setSubmitting(false);
    }
  }, [message, onTodoAdded, quickAddValue]);

  return {
    greeting,
    todayText,
    navigate,
    quickAddOpen,
    quickAddValue,
    submitting,
    openQuickAdd,
    closeQuickAdd,
    setQuickAddValue,
    submitQuickAdd,
  };
}
