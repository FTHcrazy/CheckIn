import { useCallback, useEffect, useRef, useState } from "react";
import { ANNOTATION } from "../novel-config";

export interface HoverTarget {
  entityId: string;
  /** 相对于码字区容器的坐标，用于定位资料卡 */
  x: number;
  y: number;
}

/**
 * 悬浮资料卡的 hover 意图管理（设计方案 §05 ④）
 *
 * - 指针停留满 200ms 才浮现，移开 100ms 才消失，防止扫过正文时闪烁
 * - 键盘输入 / 滚动 / 窗口失焦立即关闭，不等计时器
 * - 组件本身不获取焦点、不劫持滚轮，这里只负责「什么时候显示」
 */
export function useEntityHover() {
  const [target, setTarget] = useState<HoverTarget | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimers();
    setTarget(null);
  }, [clearTimers]);

  const enter = useCallback(
    (entityId: string, x: number, y: number) => {
      clearTimers();
      setTarget((current) => (current ? { ...current, x, y } : null));
      openTimerRef.current = window.setTimeout(() => {
        openTimerRef.current = null;
        setTarget({ entityId, x, y });
      }, ANNOTATION.hoverOpenMs);
    },
    [clearTimers],
  );

  const leave = useCallback(() => {
    clearTimers();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setTarget(null);
    }, ANNOTATION.hoverCloseMs);
  }, [clearTimers]);

  useEffect(() => {
    const handleKeyDown = () => dismiss();
    const handleBlur = () => dismiss();
    const handleWheel = () => dismiss();
    const handleScroll = () => dismiss();

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("wheel", handleWheel, { passive: true });
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [dismiss]);

  useEffect(() => clearTimers, [clearTimers]);

  return { target, enter, leave, dismiss };
}
