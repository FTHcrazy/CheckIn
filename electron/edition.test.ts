import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  EDITION_WINDOW_ENTRIES,
  PRIMARY_WINDOW_ENTRY,
  RENDERER_ENTRY_PATHS,
  resolveEditionFromEnv,
  type CheckInEdition,
  type WindowEntryKey,
} from "./edition";

/**
 * 版本清单护栏：vite input（EDITION_WINDOW_ENTRIES）、主进程加载路径
 * （RENDERER_ENTRY_PATHS）与主窗口语义（PRIMARY_WINDOW_ENTRY）三者必须
 * 互相一致，防止新增窗口时漏登记 / 漏打包。
 */

const EDITIONS: CheckInEdition[] = ["full", "lite", "novel"];

describe("edition manifest", () => {
  it("所有入口路径都指向磁盘上真实存在的 HTML", () => {
    for (const [key, relPath] of Object.entries(RENDERER_ENTRY_PATHS)) {
      const abs = path.resolve(process.cwd(), relPath);
      expect(fs.existsSync(abs), `入口 ${key} 的文件不存在: ${relPath}`).toBe(true);
    }
  });

  it("各版本入口清单只引用已登记的入口 key", () => {
    const knownKeys = new Set(Object.keys(RENDERER_ENTRY_PATHS));
    for (const edition of EDITIONS) {
      for (const key of EDITION_WINDOW_ENTRIES[edition]) {
        expect(knownKeys.has(key), `${edition} 引用了未登记入口 ${key}`).toBe(true);
      }
    }
  });

  it("每个版本都包含 login 入口（登录窗口在所有版本下存在）", () => {
    for (const edition of EDITIONS) {
      expect(EDITION_WINDOW_ENTRIES[edition]).toContain("login");
    }
  });

  it("主窗口入口必须在该版本的入口清单内", () => {
    for (const edition of EDITIONS) {
      const primary = PRIMARY_WINDOW_ENTRY[edition];
      expect(EDITION_WINDOW_ENTRIES[edition]).toContain(primary);
    }
  });

  it("版本差异语义：lite 不含 novel；novel 不含 base；full 最全；settings 全版本包含", () => {
    for (const edition of ["full", "lite", "novel"] as const) {
      expect(EDITION_WINDOW_ENTRIES[edition]).toContain("settings");
    }

    expect(EDITION_WINDOW_ENTRIES.lite).not.toContain("novel");

    expect(EDITION_WINDOW_ENTRIES.novel).not.toContain("base");

    expect(EDITION_WINDOW_ENTRIES.full).toEqual(
      expect.arrayContaining<WindowEntryKey>(["base", "login", "novel", "settings"]),
    );
  });

  it("主窗口归属：full/lite → base，novel → novel", () => {
    expect(PRIMARY_WINDOW_ENTRY.full).toBe("base");
    expect(PRIMARY_WINDOW_ENTRY.lite).toBe("base");
    expect(PRIMARY_WINDOW_ENTRY.novel).toBe("novel");
  });
});

describe("resolveEditionFromEnv", () => {
  it("缺省或空值回落 full", () => {
    expect(resolveEditionFromEnv({})).toBe("full");
    expect(resolveEditionFromEnv({ CHECKIN_EDITION: "" })).toBe("full");
  });

  it("识别合法值", () => {
    expect(resolveEditionFromEnv({ CHECKIN_EDITION: "full" })).toBe("full");
    expect(resolveEditionFromEnv({ CHECKIN_EDITION: "lite" })).toBe("lite");
    expect(resolveEditionFromEnv({ CHECKIN_EDITION: "novel" })).toBe("novel");
  });

  it("非法值回落 full", () => {
    expect(resolveEditionFromEnv({ CHECKIN_EDITION: "pro" })).toBe("full");
  });
});
