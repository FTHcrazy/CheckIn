/**
 * 引用态文案常量（全局设定中心，N12）
 *
 * 引用徽标、引用计数、固化提示的文案集中在这里，避免散落多份导致口径漂移
 * （与 work-numbering 的「单一口径」同思路）。UI 只渲染，不自己拼字符串。
 *
 * 本文件**不含 React**（跨窗口共享位）。
 */

/** 本书分类引用自全局中心时的徽标：提醒它只读 / 自动同步 */
export const SETTING_REF_SYNC_BADGE = "全局 · 自动同步";

/** 全局分类被多少部书引用时的徽标（0 部 → 「暂无引用」） */
export function formatReferenceCountLabel(count: number): string {
  const safe = Math.max(0, Math.floor(count) || 0);
  return safe > 0 ? `${safe} 部书引用` : "暂无引用";
}

/** 原全局项被删除、本书已就地固化为副本时的提示（D4） */
export const SETTING_REF_DETACHED_HINT = "原全局项已删除，已转为本书副本";

/** 上架到全局时命中同名分类，渲染层二次确认的文案 */
export const SETTING_PUBLISH_CONFLICT_HINT =
  "全局库已有同名设定，可新建副本或取消";
