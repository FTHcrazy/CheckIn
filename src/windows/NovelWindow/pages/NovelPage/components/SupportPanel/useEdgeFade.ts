import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

interface EdgeFadeState {
  left: boolean;
  right: boolean;
}

/**
 * 横向溢出边缘渐隐（配合 panel-primitives.scss 的 .nv-chips 使用）
 *
 * chips 行是隐藏滚动条的横向滚动容器，溢出内容只能靠 Shift+滚轮到达，
 * 用户完全看不出「右边还有」。本 hook 按滚动位置探测两端是否还有不可见
 * 内容，返回开关类名所需的状态；遮罩本体（mask-image 渐变）在 SCSS 里。
 *
 * 探测时机：scroll（用户滚动）、容器尺寸变化（ResizeObserver）、
 * chips 增删/文案变化（MutationObserver，数量徽标变宽也算溢出变化）。
 * 状态无变化时直接复用旧引用，不触发多余渲染。
 */
export function useEdgeFade<T extends HTMLElement>(): {
  ref: RefObject<T | null>;
  fadeLeft: boolean;
  fadeRight: boolean;
} {
  const ref = useRef<T | null>(null);
  const [fade, setFade] = useState<EdgeFadeState>({ left: false, right: false });

  const measure = useCallback((): void => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const left = el.scrollLeft > 1;
    const right = max > 1 && el.scrollLeft < max - 1;
    setFade((prev) => {
      if (prev.left === left && prev.right === right) return prev;
      return { left, right };
    });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();

    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // 容器自身宽度由面板决定，chips 数量变化只改 scrollWidth，
    // ResizeObserver 感知不到，需要 MutationObserver 兜底
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true, characterData: true, subtree: true });

    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
      mo.disconnect();
    };
  }, [measure]);

  return { ref, fadeLeft: fade.left, fadeRight: fade.right };
}
