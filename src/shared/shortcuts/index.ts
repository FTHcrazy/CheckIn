/**
 * 快捷键域的统一出口（1.47.0）
 *
 * 只在 `src/shared/` 内部互相引用；窗口侧一律 `@/shared/shortcuts` 起手，
 * 避免各自记得住十来个文件名。
 */
export {
  DEFAULT_BINDINGS,
  DEFAULT_GLOBALS,
  DEFAULT_SHORTCUT_CONFIG,
  SHORTCUTS,
  SHORTCUT_GROUPS,
  SHORTCUT_IDS,
  getShortcutDef,
  normalizeConfig,
  type ShortcutConfig,
  type ShortcutDef,
  type ShortcutGroup,
} from "./registry";

export {
  formatShortcut,
  isMacPlatform,
  matchKeyEvent,
  normalizeKeyName,
  parseShortcut,
  shortcutFromEvent,
  specificity,
  toAccelerator,
  type KeyEventLike,
  type ParsedShortcut,
} from "./keys";

export {
  SHORTCUT_CHANGED_EVENT,
  bootstrapShortcutSync,
  getShortcutConfig,
  loadShortcutConfig,
  persistShortcutConfig,
  resetShortcutConfig,
  resetShortcutStoreForTest,
  setShortcutConfig,
  subscribeShortcutConfig,
  type SaveShortcutResult,
} from "./store";

export { useShortcutBindings, useShortcutConfig } from "./hooks";
