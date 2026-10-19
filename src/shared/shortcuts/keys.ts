/**
 * 快捷键的展示层辅助（渲染进程专用）
 *
 * 纯计算部分在 `keys-core.ts`（主进程也能用）；这里只补「怎么显示给人看」：
 * mac 用 ⌘⌥⇧ 符号串联，其他平台用 `Ctrl+Shift+B`。
 */
import { parseShortcut } from "./keys-core";

export {
  matchKeyEvent,
  normalizeKeyName,
  parseShortcut,
  shortcutFromEvent,
  specificity,
  toAccelerator,
  type KeyEventLike,
  type ParsedShortcut,
} from "./keys-core";

/** 展示用的按键别名 */
const KEY_DISPLAY_ALIAS: Record<string, string> = {
  Escape: "Esc",
  Space: "空格",
  Enter: "Enter",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/** 是否 macOS（仅用于展示符号） */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
      ?.platform ?? navigator.platform;
  return /mac/i.test(platform ?? "");
}

/**
 * 转成给人看的键位文案。
 * mac 用符号串联（⌘⇧B），其他平台用 `+` 串联（Ctrl+Shift+B）。
 */
export function formatShortcut(spec: string, mac: boolean = isMacPlatform()): string {
  const parsed = parseShortcut(spec);
  if (!parsed) return spec;
  const display = KEY_DISPLAY_ALIAS[parsed.key] ?? parsed.key;
  if (mac) {
    return `${parsed.mod ? "⌘" : ""}${parsed.alt ? "⌥" : ""}${
      parsed.shift ? "⇧" : ""
    }${display}`;
  }
  const parts: string[] = [];
  if (parsed.mod) parts.push("Ctrl");
  if (parsed.alt) parts.push("Alt");
  if (parsed.shift) parts.push("Shift");
  parts.push(display);
  return parts.join("+");
}
