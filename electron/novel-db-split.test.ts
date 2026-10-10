/**
 * novel 域存储独立（novel.db）的架构守卫
 *
 * 1.33.0 把 novel_* / novel_pack_* / 埋点 / 领域设置从 checkin.db 摘到了
 * `electron/novel-db.ts`。这类拆分最容易被下一次改动悄悄回退：有人要加一张
 * 表，顺手在 `db.ts` 里补一段 `CREATE TABLE`，于是 novel 的数据又开始一分为二，
 * 而「备份整部书」「单独拷贝小说库」这些能力从此失效且无人察觉。
 *
 * 为什么用源码断言：better-sqlite3 的 native 按 Electron ABI 编译，vitest
 * （node 进程）下 require 直接抛，跑不了真实建库，只能把不变量钉在源码上。
 * 同先例 `novel-pack-save-order.test.ts`。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CHECKIN_DB = readFileSync(
  path.resolve(process.cwd(), "electron/db.ts"),
  "utf8",
);
const NOVEL_DB = readFileSync(
  path.resolve(process.cwd(), "electron/novel-db.ts"),
  "utf8",
);
const NOVEL_HANDLERS = readFileSync(
  path.resolve(process.cwd(), "electron/handlers/novel-handlers.ts"),
  "utf8",
);
const PACK_HANDLERS = readFileSync(
  path.resolve(process.cwd(), "electron/handlers/novel-pack-handlers.ts"),
  "utf8",
);

/** novel 域必须住在 novel.db 的表（缺一张就是拆分不彻底） */
const NOVEL_TABLES = [
  "novel_works",
  "novel_volumes",
  "novel_chapters",
  "novel_snapshots",
  "novel_notes",
  "novel_outline_entries",
  "novel_entities",
  "novel_links",
  "novel_level_systems",
  "novel_levels",
  "novel_level_conversions",
  "novel_pack_characters",
  "novel_pack_attributes",
  "novel_pack_slots",
  "novel_pack_items",
  "novel_pack_skills",
  "novel_pack_modifiers",
  "novel_pack_presets",
  "novel_pack_unit_systems",
  "novel_pack_layouts",
  "novel_pack_records",
  "novel_pack_drafts",
  // 领域设置与埋点：跟着小说走，而不是跟着待办走
  "novel_config",
  "novel_usage_log",
] as const;

describe("novel 域存储独立（守卫）", () => {
  it("checkin.db 不再建任何 novel 域的表", () => {
    for (const table of NOVEL_TABLES) {
      expect(CHECKIN_DB, `checkin.db 里又出现了 ${table}`).not.toContain(
        `CREATE TABLE IF NOT EXISTS ${table}`,
      );
    }
    // 埋点整表迁走后，checkin 库也不该再有 usage_log
    expect(CHECKIN_DB).not.toContain("CREATE TABLE IF NOT EXISTS usage_log");
  });

  it("novel.db 建齐全部 novel 域表", () => {
    for (const table of NOVEL_TABLES) {
      expect(NOVEL_DB, `novel.db 缺少 ${table}`).toContain(
        `CREATE TABLE IF NOT EXISTS ${table}`,
      );
    }
  });

  it("novel.db 独立于 checkin.db 文件，且与用户数据目录同级", () => {
    expect(NOVEL_DB).toContain('join(getUserDataDir(email), "novel.db")');
    // 不能复用 checkin.db 的库实例：novel 的 CRUD 必须走自己的连接
    expect(NOVEL_DB).toContain("function switchNovelDb");
    expect(NOVEL_DB).toContain("function getNovelDb");
  });

  it("novel.db 跟随用户库开关（切用户 / 退出时不留悬空连接）", () => {
    expect(NOVEL_DB).toContain("registerUserDbLifecycle");
    expect(NOVEL_DB).toContain("onSwitched");
    expect(NOVEL_DB).toContain("onClosed");
  });
});

describe("novel handlers 只写 novel.db（守卫）", () => {
  for (const [name, source] of [
    ["novel-handlers", NOVEL_HANDLERS],
    ["novel-pack-handlers", PACK_HANDLERS],
  ] as const) {
    it(`${name} 不导入 checkin.db 的写通道`, () => {
      // 唯一允许的形态是 `from "../novel-db"`；`from "../db"` 会把数据写回 checkin 库
      expect(source).not.toMatch(/from\s+"\.\.\/db"/);
      expect(source).toContain('from "../novel-db"');
    });
  }

  it("领域设置与埋点走 novel.db 自己的表，不再蹭 checkin 的 config / usage_log", () => {
    expect(NOVEL_HANDLERS).not.toMatch(/INSERT INTO config\b/);
    expect(NOVEL_HANDLERS).not.toMatch(/FROM config\b/);
    expect(NOVEL_HANDLERS).not.toMatch(/INSERT INTO usage_log\b/);
    expect(NOVEL_HANDLERS).not.toMatch(/FROM usage_log\b/);
    expect(NOVEL_HANDLERS).toContain("INSERT INTO novel_config");
    expect(NOVEL_HANDLERS).toContain("INSERT INTO novel_usage_log");
  });
});

describe("行囊级联清单不漏表（守卫）", () => {
  /** 截取 novel-handlers 里 PACK_CHILD_TABLES 数组的内容 */
  function packChildTables(): string {
    const start = NOVEL_HANDLERS.indexOf("const PACK_CHILD_TABLES");
    expect(start).toBeGreaterThan(-1);
    const open = NOVEL_HANDLERS.indexOf("[", start);
    const close = NOVEL_HANDLERS.indexOf("]", open);
    return NOVEL_HANDLERS.slice(open, close);
  }

  it("删作品的级联覆盖每一张按 character_id 挂载的行囊表", () => {
    const list = packChildTables();
    for (const table of [
      "novel_pack_items",
      "novel_pack_skills",
      "novel_pack_attributes",
      "novel_pack_slots",
      // 换装方案挂在 character_id 上：漏掉它，删作品后方案永远查不到也删不掉
      "novel_pack_presets",
      "novel_pack_unit_systems",
      "novel_pack_layouts",
      "novel_pack_records",
      "novel_pack_drafts",
    ]) {
      expect(list, `级联清单漏了 ${table}`).toContain(table);
    }
  });

  it("重置模板书的清库复用同一份清单（不另抄一份，避免两边漂移）", () => {
    const body = NOVEL_HANDLERS.slice(
      NOVEL_HANDLERS.indexOf("function seedTemplateBook"),
      NOVEL_HANDLERS.indexOf("// ── 一键重置为模板书籍"),
    );
    expect(body).toContain("for (const table of PACK_CHILD_TABLES)");
    expect(body).toContain("DELETE FROM novel_pack_characters");
    expect(body).toContain("DELETE FROM novel_pack_modifiers");
  });
});
