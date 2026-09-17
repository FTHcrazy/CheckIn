import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME, THEME_STORAGE_KEY } from "./themes";
import {
  applyThemeToDocument,
  initThemeFromStorage,
  readStoredTheme,
  writeStoredTheme,
} from "./theme-storage";

describe("theme-storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = "";
  });

  it("无存储记录时读取返回 null", () => {
    expect(readStoredTheme()).toBeNull();
  });

  it("写入后可原样读回", () => {
    writeStoredTheme("cream");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("cream");
    expect(readStoredTheme()).toBe("cream");
  });

  it("存储值非法时回退为 null，避免脏数据把主题卡死", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "not-a-theme");
    expect(readStoredTheme()).toBeNull();
  });

  it("localStorage 不可用时不抛错（隐私模式/配额耗尽场景）", () => {
    const spy = vi
      .spyOn(window.localStorage, "getItem")
      .mockImplementation(() => {
        throw new Error("storage disabled");
      });

    expect(() => readStoredTheme()).not.toThrow();
    expect(readStoredTheme()).toBeNull();
    spy.mockRestore();
  });

  it("applyThemeToDocument 写入 data-theme，并同步 color-scheme", () => {
    applyThemeToDocument("midnight");
    expect(document.documentElement.dataset.theme).toBe("midnight");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    applyThemeToDocument("mint");
    expect(document.documentElement.dataset.theme).toBe("mint");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("initThemeFromStorage 落默认主题（无记录时）", () => {
    expect(initThemeFromStorage()).toBe(DEFAULT_THEME);
    expect(document.documentElement.dataset.theme).toBe(DEFAULT_THEME);
  });

  it("initThemeFromStorage 复用已保存主题（首帧防闪烁）", () => {
    writeStoredTheme("midnight");
    expect(initThemeFromStorage()).toBe("midnight");
    expect(document.documentElement.dataset.theme).toBe("midnight");
  });
});
