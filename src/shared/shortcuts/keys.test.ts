import { describe, expect, it } from "vitest";
import {
  formatShortcut,
  matchKeyEvent,
  normalizeKeyName,
  parseShortcut,
  shortcutFromEvent,
  specificity,
  toAccelerator,
  type KeyEventLike,
} from "./keys";

/** 构造一个键盘事件（默认全部修饰键关闭） */
function key(partial: Partial<KeyEventLike> & { key: string }): KeyEventLike {
  return {
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...partial,
  };
}

describe("快捷键解析", () => {
  it("Mod 是平台中立的 Ctrl/Cmd", () => {
    expect(parseShortcut("Mod+Shift+B")).toEqual({
      mod: true,
      alt: false,
      shift: true,
      key: "B",
    });
  });

  it("单字符键统一大写（Shift 下 event.key 本来就是大写）", () => {
    expect(parseShortcut("Ctrl+s")?.key).toBe("S");
    expect(parseShortcut("F11")).toEqual({
      mod: false,
      alt: false,
      shift: false,
      key: "F11",
    });
  });

  it("没有主键 / 只有修饰键 → 非法", () => {
    expect(parseShortcut("")).toBeNull();
    expect(parseShortcut("Ctrl")).toBeNull();
    expect(parseShortcut("Ctrl+Shift")).toBeNull();
  });

  it("别名归一：Esc → Escape", () => {
    expect(parseShortcut("Escape")?.key).toBe("Escape");
    expect(normalizeKeyName("Esc")).toBe("Escape");
  });
});

describe("快捷键匹配", () => {
  it("Ctrl+S 命中，Ctrl+Shift+S 不命中", () => {
    const ctrlS = key({ key: "s", ctrlKey: true });
    expect(matchKeyEvent(ctrlS, "Mod+S")).toBe(true);
    expect(matchKeyEvent(ctrlS, "Mod+Shift+S")).toBe(false);
  });

  it("Shift 组合必须精确匹配（曾经的高危点：Ctrl+Shift+S 被 Ctrl+S 吃掉）", () => {
    const ctrlShiftS = key({ key: "S", ctrlKey: true, shiftKey: true });
    expect(matchKeyEvent(ctrlShiftS, "Mod+Shift+S")).toBe(true);
    expect(matchKeyEvent(ctrlShiftS, "Mod+S")).toBe(false);
  });

  it("mac 的 Cmd（metaKey）与 Ctrl 等价", () => {
    expect(matchKeyEvent(key({ key: "s", metaKey: true }), "Mod+S")).toBe(true);
  });

  it("多了 Alt 就不算命中", () => {
    expect(
      matchKeyEvent(key({ key: "s", ctrlKey: true, altKey: true }), "Mod+S"),
    ).toBe(false);
  });

  it("F11 / Esc 这类无修饰键也能正确匹配", () => {
    expect(matchKeyEvent(key({ key: "F11" }), "F11")).toBe(true);
    expect(matchKeyEvent(key({ key: "Escape" }), "Escape")).toBe(true);
    expect(matchKeyEvent(key({ key: "Escape" }), "Esc")).toBe(true);
  });

  it("具体度：修饰键越多越具体（用于排序优先匹配）", () => {
    expect(specificity("Mod+Shift+S")).toBeGreaterThan(specificity("Mod+S"));
    expect(specificity("Mod+S")).toBeGreaterThan(specificity("F11"));
    expect(specificity("Mod+Alt+Shift+B")).toBeGreaterThan(
      specificity("Mod+Shift+B"),
    );
  });
});

describe("录制（事件 → 配置字符串）", () => {
  it("Ctrl+Shift+B → Mod+Shift+B", () => {
    expect(
      shortcutFromEvent(key({ key: "B", ctrlKey: true, shiftKey: true })),
    ).toBe("Mod+Shift+B");
  });

  it("只按修饰键 → null（继续等主键）", () => {
    expect(shortcutFromEvent(key({ key: "Control", ctrlKey: true }))).toBeNull();
    expect(shortcutFromEvent(key({ key: "Shift", shiftKey: true }))).toBeNull();
  });

  it("无修饰键的普通字符不单独成键（否则打字就触发）", () => {
    expect(shortcutFromEvent(key({ key: "a" }))).toBeNull();
    expect(shortcutFromEvent(key({ key: "1" }))).toBeNull();
  });

  it("F1–F12 与 Esc 可以无修饰键", () => {
    expect(shortcutFromEvent(key({ key: "F5" }))).toBe("F5");
    expect(shortcutFromEvent(key({ key: "Escape" }))).toBe("Escape");
  });

  it("Alt 单独作为修饰键也允许", () => {
    expect(shortcutFromEvent(key({ key: "w", altKey: true }))).toBe("Alt+W");
  });
});

describe("展示与 accelerator", () => {
  it("Windows 用 Ctrl 串联", () => {
    expect(formatShortcut("Mod+Shift+B", false)).toBe("Ctrl+Shift+B");
    expect(formatShortcut("F11", false)).toBe("F11");
    expect(formatShortcut("Escape", false)).toBe("Esc");
  });

  it("mac 用符号串联", () => {
    expect(formatShortcut("Mod+Shift+B", true)).toBe("⌘⇧B");
    expect(formatShortcut("Alt+W", true)).toBe("⌥W");
  });

  it("Electron accelerator 用 CommandOrControl", () => {
    expect(toAccelerator("Mod+Shift+B")).toBe("CommandOrControl+Shift+B");
    expect(toAccelerator("Alt+W")).toBe("Alt+W");
    expect(toAccelerator("")).toBe("");
  });
});
