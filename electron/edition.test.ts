import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  buildExcludesMap,
  EDITION_WINDOW_ENTRIES,
  PRIMARY_WINDOW_ENTRY,
  RENDERER_ENTRY_PATHS,
  resolveEditionFromEnv,
  resolveWindowEntries,
  resolveWindowVariantFromEnv,
  variantExcludesMap,
  WINDOW_VARIANT_ENTRY_EXCLUSIONS,
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

  it("版本差异语义：lite 不含 novel/pack/globalSetting；novel 不含 base；full 最全；settings 全版本包含", () => {
    for (const edition of ["full", "lite", "novel"] as const) {
      expect(EDITION_WINDOW_ENTRIES[edition]).toContain("settings");
    }

    expect(EDITION_WINDOW_ENTRIES.lite).not.toContain("novel");
    expect(EDITION_WINDOW_ENTRIES.lite).not.toContain("pack");
    // 全局设定中心属 novel 域：lite 不登记（与 novel/pack 同口径）
    expect(EDITION_WINDOW_ENTRIES.lite).not.toContain("globalSetting");

    expect(EDITION_WINDOW_ENTRIES.novel).not.toContain("base");

    expect(EDITION_WINDOW_ENTRIES.full).toEqual(
      expect.arrayContaining<WindowEntryKey>([
        "base",
        "login",
        "novel",
        "pack",
        "settings",
        "globalSetting",
      ]),
    );
  });

  it("行囊独立窗口随小说域打包：full 与 novel 版都包含 pack 入口", () => {
    expect(EDITION_WINDOW_ENTRIES.full).toContain("pack");
    expect(EDITION_WINDOW_ENTRIES.novel).toContain("pack");
  });

  it("全局设定中心独立窗口随小说域打包：full 与 novel 版都包含 globalSetting，lite 不含", () => {
    expect(EDITION_WINDOW_ENTRIES.full).toContain("globalSetting");
    expect(EDITION_WINDOW_ENTRIES.novel).toContain("globalSetting");
    expect(EDITION_WINDOW_ENTRIES.lite).not.toContain("globalSetting");
  });

  it("地图编辑器窗口随小说域打包：full 与 novel 版都包含 map，lite 不含", () => {
    expect(EDITION_WINDOW_ENTRIES.full).toContain("map");
    expect(EDITION_WINDOW_ENTRIES.novel).toContain("map");
    expect(EDITION_WINDOW_ENTRIES.lite).not.toContain("map");
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

describe("resolveWindowVariantFromEnv（窗口变体后缀）", () => {
  it("缺省或空值回落空串（不剔除任何窗口）", () => {
    expect(resolveWindowVariantFromEnv({})).toBe("");
    expect(resolveWindowVariantFromEnv({ CHECKIN_WINDOW_VARIANT: "" })).toBe("");
  });

  it("识别合法值 nomap", () => {
    expect(resolveWindowVariantFromEnv({ CHECKIN_WINDOW_VARIANT: "nomap" })).toBe("nomap");
  });

  it("非法值回落空串", () => {
    expect(resolveWindowVariantFromEnv({ CHECKIN_WINDOW_VARIANT: "nonsense" })).toBe("");
  });
});

describe("resolveWindowEntries（变体叠加派生入口）", () => {
  it("空变体下与 EDITION_WINDOW_ENTRIES 完全一致（不传后缀行为不变）", () => {
    for (const edition of EDITIONS) {
      expect(resolveWindowEntries(edition, "")).toEqual(EDITION_WINDOW_ENTRIES[edition]);
    }
  });

  it("nomap 变体剔除 map 入口，其余保持不变", () => {
    for (const edition of EDITIONS) {
      const base = EDITION_WINDOW_ENTRIES[edition];
      const next = resolveWindowEntries(edition, "nomap");
      expect(next).toEqual(base.filter((key) => key !== "map"));
    }
  });

  it("nomap 对 lite 无影响（lite 本就不含 map）", () => {
    expect(resolveWindowEntries("lite", "nomap")).toEqual(EDITION_WINDOW_ENTRIES.lite);
  });

  it("变体只做减法、不新增窗口", () => {
    for (const edition of EDITIONS) {
      const base = new Set(EDITION_WINDOW_ENTRIES[edition]);
      for (const key of resolveWindowEntries(edition, "nomap")) {
        expect(base.has(key), `${edition}+nomap 出现了多余入口 ${key}`).toBe(true);
      }
    }
  });
});

describe("variantExcludesMap（变体剔除地图的判定）", () => {
  it("空变体不剔除 map，nomap 剔除 map", () => {
    expect(variantExcludesMap("")).toBe(false);
    expect(variantExcludesMap("nomap")).toBe(true);
  });
});

describe("buildExcludesMap（构建期地图可用性，edition + variant 双重口径）", () => {
  it("lite 版即便不带 nomap 后缀也不含地图（标题栏据此隐藏入口）", () => {
    expect(buildExcludesMap("lite", "")).toBe(true);
  });

  it("full / novel 版默认含地图", () => {
    expect(buildExcludesMap("full", "")).toBe(false);
    expect(buildExcludesMap("novel", "")).toBe(false);
  });

  it("nomap 变体让 full / novel 也不含地图", () => {
    expect(buildExcludesMap("full", "nomap")).toBe(true);
    expect(buildExcludesMap("novel", "nomap")).toBe(true);
    expect(buildExcludesMap("lite", "nomap")).toBe(true);
  });

  it("结论始终与窗口入口清单一致（清单有 map 即含地图）", () => {
    for (const edition of EDITIONS) {
      for (const variant of ["", "nomap"] as const) {
        expect(buildExcludesMap(edition, variant)).toBe(
          !resolveWindowEntries(edition, variant).includes("map"),
        );
      }
    }
  });
});

describe("WINDOW_VARIANT_ENTRY_EXCLUSIONS（可扩展性护栏）", () => {
  it("空变体剔除清单为空", () => {
    expect(WINDOW_VARIANT_ENTRY_EXCLUSIONS[""]).toEqual([]);
  });

  it("nomap 变体剔除清单精确等于 ['map']（新增窗口时须在此登记）", () => {
    expect(WINDOW_VARIANT_ENTRY_EXCLUSIONS.nomap).toEqual(["map"]);
  });

  it("每个变体剔除的入口 key 都是已登记的合法入口", () => {
    const knownKeys = new Set(Object.keys(RENDERER_ENTRY_PATHS));
    for (const [variant, keys] of Object.entries(WINDOW_VARIANT_ENTRY_EXCLUSIONS)) {
      for (const key of keys) {
        expect(knownKeys.has(key), `${variant} 引用了未登记入口 ${key}`).toBe(true);
      }
    }
  });
});
