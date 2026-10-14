/**
 * Tour 目标探测
 *
 * 单独成文件的原因：组件目录下的 `index.tsx` 按规范只导出组件
 * （fast-refresh 规则），这两个函数还要被守卫测试直接引用来做单测。
 *
 * 可见性判据是三道关口，缺一会把卡片定位到看不见的地方：
 * 1. **布局盒**：祖先 `display:none`（如未激活的视图容器
 *    `.novel-view.is-hidden`）会让 `getClientRects()` 返回空列表，
 *    比 `offsetParent` 可靠，也不受目标自身 `position:fixed` 干扰；
 * 2. **视口交集**：侧栏折叠是 `width:0 + overflow:hidden`，元素仍有布局盒、
 *    rect 不为空，位置却被推出可见区域——只查盒子会误放行；
 * 3. **透明/隐藏祖先**：折叠侧栏同时带 `opacity:0`，盒子和坐标都在，
 *    但整条链都不可见，必须顺着祖先链查计算样式。
 */

import type { TourStepCopy } from "@/shared/novel/guide-copy";

/** 探测目标是否真实可见（无布局盒 / 零尺寸 / 视口外 / 透明或隐藏祖先都算不可见） */
export function isElementVisible(element: HTMLElement | null): boolean {
  if (!element) return false;
  // 关口 1：display:none 的祖先 → 无布局盒
  if (element.getClientRects().length === 0) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  // 关口 2：与视口全无交集（整块在左/上/右/屏幕外）
  if (
    rect.right < 0 ||
    rect.bottom < 0 ||
    rect.left > window.innerWidth ||
    rect.top > window.innerHeight
  ) {
    return false;
  }
  // 关口 3：祖先链上有 visibility:hidden / opacity:0 一律不可见。
  // getComputedStyle 每帧只调几次，且前两道关口已挡掉绝大多数情况
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (style.visibility === "hidden" || style.opacity === "0") return false;
  }
  return true;
}

/** 取单个锚点的元素（不存在返回 null） */
export function queryTourTarget(value: string): HTMLElement | null {
  if (!value) return null;
  return document.querySelector<HTMLElement>(`[data-tour-target="${value}"]`);
}

/** 按「主锚点 → 备选锚点」顺序取第一个可见目标；都不可见返回 null */
export function resolveStepTarget(step: TourStepCopy): HTMLElement | null {
  for (const value of [step.target, ...step.fallbacks]) {
    const element = queryTourTarget(value);
    if (isElementVisible(element)) return element;
  }
  return null;
}
