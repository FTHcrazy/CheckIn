/**
 * 快捷键的核心纯逻辑（**主进程与渲染进程共用**）
 *
 * 与 `keys.ts` 的分工：这里只做字符串 ↔ 结构 ↔ 事件的纯计算，不碰任何 DOM /
 * Electron API，因此可以被主进程直接 import（`globalShortcut` 需要把配置里的
 * `Mod+Shift+B` 转成 `CommandOrControl+Shift+B`）。展示层（Ctrl / ⌘ 符号）留在
 * `keys.ts`，那边依赖 `navigator`。
 *
 * ⚠️ 主进程通常不 import `src/shared`（见 `novel-template.test.ts` 的说明）：
 * 怕把 DOM 依赖带进主进程构建。这个文件是明确的无 DOM 例外，改动时不要在这里
 * 引入 `window` / `navigator` / React。
 */

export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface ParsedShortcut {
  mod: boolean;
  alt: boolean;
  shift: boolean;
  /** 规范化后的主键（单字符统一大写） */
  key: string;
}

/** 只有修饰键本身时不算一个完整快捷键 */
const MODIFIER_KEYS = new Set([
  "Control",
  "Shift",
  "Alt",
  "Meta",
  "AltGraph",
  "CapsLock",
]);

/** 浏览器 / 旧语法里可能出现的键名 → 标准名 */
const KEY_NAME_ALIAS: Record<string, string> = {
  Esc: "Escape",
  Spacebar: "Space",
  " ": "Space",
};

export function normalizeKeyName(key: string): string {
  const alias = KEY_NAME_ALIAS[key];
  if (alias) return alias;
  return key.length === 1 ? key.toUpperCase() : key;
}

/** 解析配置字符串；格式非法（无主键）返回 null */
export function parseShortcut(spec: string): ParsedShortcut | null {
  if (!spec) return null;
  const parts = spec
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  let mod = false;
  let alt = false;
  let shift = false;
  let key = "";

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "mod" || lower === "ctrl" || lower === "cmd" || lower === "meta") {
      mod = true;
      continue;
    }
    if (lower === "alt" || lower === "option") {
      alt = true;
      continue;
    }
    if (lower === "shift") {
      shift = true;
      continue;
    }
    // 主键只认最后一个（避免 "Ctrl+S+S" 这类脏配置）
    key = normalizeKeyName(part);
  }

  if (!key || MODIFIER_KEYS.has(key)) return null;
  return { mod, alt, shift, key };
}

/** 键盘事件是否命中该配置 */
export function matchKeyEvent(event: KeyEventLike, spec: string): boolean {
  const parsed = parseShortcut(spec);
  if (!parsed) return false;
  // Mod 是「Ctrl 或 Cmd 任一」
  if (parsed.mod !== (event.ctrlKey || event.metaKey)) return false;
  if (parsed.alt !== event.altKey) return false;
  if (parsed.shift !== event.shiftKey) return false;
  return normalizeKeyName(event.key) === parsed.key;
}

/**
 * 把键盘事件转成配置字符串（录制用）。
 * 只按了修饰键时返回 null —— 录制中应当继续等主键。
 */
export function shortcutFromEvent(event: KeyEventLike): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const key = normalizeKeyName(event.key);
  if (!key) return null;
  // 无修饰键的普通字符不允许单独成键（否则打字就触发），F1–F12 / Esc 例外
  const isFunctionKey = /^F\d{1,2}$/.test(key);
  const hasModifier = event.ctrlKey || event.metaKey || event.altKey;
  if (!hasModifier && !isFunctionKey && key !== "Escape") return null;

  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("Mod");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

/** 配置里修饰键越多越具体，匹配时应排在前面（避免 Ctrl+S 吃掉 Ctrl+Shift+S） */
export function specificity(spec: string): number {
  const parsed = parseShortcut(spec);
  if (!parsed) return 0;
  return (parsed.mod ? 2 : 0) + (parsed.alt ? 1 : 0) + (parsed.shift ? 1 : 0);
}

/** Electron `globalShortcut` 用的 accelerator（Mod 在 mac 上是 Command） */
export function toAccelerator(spec: string): string {
  const parsed = parseShortcut(spec);
  if (!parsed) return "";
  const parts: string[] = [];
  if (parsed.mod) parts.push("CommandOrControl");
  if (parsed.alt) parts.push("Alt");
  if (parsed.shift) parts.push("Shift");
  parts.push(parsed.key);
  return parts.join("+");
}
