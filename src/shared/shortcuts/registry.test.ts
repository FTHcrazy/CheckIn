import { describe, expect, it } from "vitest";
import {
  DEFAULT_BINDINGS,
  DEFAULT_GLOBALS,
  DEFAULT_SHORTCUT_CONFIG,
  SHORTCUTS,
  SHORTCUT_IDS,
  getShortcutDef,
  normalizeConfig,
  type ShortcutConfig,
} from "./registry";

describe("快捷键注册表", () => {
  it("id 唯一且都有默认键位", () => {
    expect(new Set(SHORTCUT_IDS).size).toBe(SHORTCUT_IDS.length);
    for (const item of SHORTCUTS) {
      expect(item.defaultKeys, item.id).toBeTruthy();
      expect(item.label, item.id).toBeTruthy();
    }
  });

  it("默认键位互不冲突（否则一按两响）", () => {
    const keys = SHORTCUTS.map((item) => item.defaultKeys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("Esc 是协议键：不可修改", () => {
    expect(getShortcutDef("escape")?.editable).toBe(false);
  });

  it("帮助中心默认 F1（窗口层监听读的就是这条）", () => {
    expect(DEFAULT_BINDINGS.help).toBe("F1");
  });

  it("只有「唤起窗口」类允许设为应用级（避免把 Ctrl+S 劫持成系统级）", () => {
    const globalEligible = SHORTCUTS.filter((item) => item.globalEligible).map(
      (item) => item.id,
    );
    expect(globalEligible).toEqual(["showNovelWindow"]);
    expect(DEFAULT_GLOBALS).toEqual(["showNovelWindow"]);
    expect(DEFAULT_BINDINGS.showNovelWindow).toBe("Alt+W");
  });
});

describe("配置规范化", () => {
  it("空配置回落全量默认值", () => {
    expect(normalizeConfig(null)).toEqual(DEFAULT_SHORTCUT_CONFIG);
    expect(normalizeConfig({})).toEqual(DEFAULT_SHORTCUT_CONFIG);
  });

  it("新增快捷键 id 后，旧配置缺的键自动补默认（不需要迁移脚本）", () => {
    const partial = {
      bindings: { save: "Mod+K" },
      globals: [],
    } as Partial<ShortcutConfig>;
    const normalized = normalizeConfig(partial);
    expect(normalized.bindings.save).toBe("Mod+K");
    expect(normalized.bindings.jump).toBe(DEFAULT_BINDINGS.jump);
  });

  it("丢弃未知 id 与不合格的应用级条目", () => {
    const normalized = normalizeConfig({
      bindings: { notExist: "Mod+Q", save: "Mod+K" },
      globals: ["notExist", "save", "showNovelWindow"],
    });
    expect(normalized.bindings.notExist).toBeUndefined();
    // save 不可全局；只有 showNovelWindow 保留
    expect(normalized.globals).toEqual(["showNovelWindow"]);
  });

  it("空白键位视为未设置，回落默认", () => {
    const normalized = normalizeConfig({ bindings: { save: "   " }, globals: [] });
    expect(normalized.bindings.save).toBe(DEFAULT_BINDINGS.save);
  });
});
