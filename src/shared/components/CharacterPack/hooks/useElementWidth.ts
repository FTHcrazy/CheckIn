import { useEffect, useRef, useState } from "react";

/**
 * 观察某个元素的**内容宽度**，返回实时像素值（未观测到之前返回 0）。
 *
 * 为什么需要它：行囊窗口要「边写边对记」，作者会把窗口拉窄；九模块的排布
 * 必须跟着宽度分档降级（宽档双栏 / 窄档折叠），而 CSS 容器查询在 jsdom 里
 * 测不到、也无法把档位喂给 JS 侧的折叠决策 —— 折叠真值要写进 `prefs`，
 * 就必须在 JS 里判定。所以用 ResizeObserver 把宽度**提升成状态**。
 *
 * 之所以观察元素而不是 `window.innerWidth`：窗口壳自带边框与内边距，
 * 用 innerWidth 会把边框算进可用宽度，断点在临界值上抖动（同一窗口宽度
 * 可能一会儿判双栏一会儿判单栏）。
 *
 * 用 `contentRect.width`（不含 padding/border）而不是 `offsetWidth`：
 * 断点判据是「装得下多少内容」，padding 属于容器自己的呼吸空间。
 *
 * jsdom 不实现 ResizeObserver：那时返回 0，调用方按 0 走最保守的窄档，
 * 不会误判成宽档去排双栏。这是有意的降级方向。
 */
export function useElementWidth<T extends HTMLElement>(): {
  ref: React.RefObject<T | null>;
  width: number;
} {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;

    // 先同步量一次：ResizeObserver 的首次回调要等下一帧，
    // 中间那一帧会用 width=0（窄档）渲染，宽窗口下会出现一次可见的跳变。
    setWidth(node.clientWidth);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      // 取整：亚像素抖动会让档位判定在临界值上反复横跳
      setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}
