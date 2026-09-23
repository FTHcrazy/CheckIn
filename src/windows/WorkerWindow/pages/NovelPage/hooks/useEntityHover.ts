import { useEffect } from "react";
import { dismiss, registerHoverResolver } from "../store/useHoverStore";
import type { NovelEntity } from "../types";

/**
 * 悬浮资料卡的 hover 桥接（只做副作用，不返回状态）
 *
 * 状态本体在 `store/useHoverStore`：谁要显示卡片谁自己订阅（目前只有
 * HoverEntityCard），因此**这里不返回任何状态**——页面根组件调用它，
 * 不会让整棵树跟着 hover 一起重渲染。
 *
 * 只负责两件事：
 * 1. 注册 / 注销要素解析器（store 不认识 entities 数组）
 * 2. 挂全局关闭监听：输入 / 滚动 / 失焦立即收起，不等计时器
 */
export function useEntityHover(
  resolver: (entityId: string) => NovelEntity | null,
): void {
  useEffect(() => {
    registerHoverResolver(resolver);
    return () => registerHoverResolver(null);
  }, [resolver]);

  useEffect(() => {
    const handleDismiss = (): void => dismiss();
    window.addEventListener("keydown", handleDismiss);
    window.addEventListener("blur", handleDismiss);
    window.addEventListener("wheel", handleDismiss, { passive: true });
    window.addEventListener("scroll", handleDismiss, true);

    return () => {
      window.removeEventListener("keydown", handleDismiss);
      window.removeEventListener("blur", handleDismiss);
      window.removeEventListener("wheel", handleDismiss);
      window.removeEventListener("scroll", handleDismiss, true);
    };
  }, []);

  // 卸载时收起并清掉在途计时器
  useEffect(() => () => dismiss(), []);
}
