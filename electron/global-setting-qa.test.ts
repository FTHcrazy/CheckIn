/**
 * 全局设定中心 · **独立对抗性验证**（QA / P0-1 数据不变量）
 *
 * 本文件不复述实现者（工程师）已有的断言，而是从「证伪」角度另起一套核对：
 * - 引用只读的权威边界：**逐个点名** 10 个本书侧写通道，少一个即数据污染漏洞；
 * - 全局 realm 唯一性：应用层校验 + 部分唯一索引兜底是否都在；
 * - rank 三件套（COUNT(*) / maxRank+1 / rankAt）两个域是否同一口径，有没有偷用 max(rank)；
 * - 增量迁移是否真幂等（PRAGMA 探测 + ALTER）；
 * - D4 删除固化：source_global_id 是否清空（否则变幽灵引用）、novel_links 是否保住；
 * - 引用计数是否排除已脱离的书、是否按索引收口（不全表扫）。
 *
 * 为什么是源码断言：better-sqlite3 是 native 模块、按 Electron ABI 编译，vitest 的
 * node 进程加载不了它，真库跑不起来。所以主进程数据层只能「读源码逐条核对 + 纯函数边界」。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string): string =>
  readFileSync(resolve(process.cwd(), relative), "utf8");

const BOOK_HANDLERS = read("electron/handlers/novel-setting-handlers.ts");
const GLOBAL_HANDLERS = read("electron/handlers/novel-global-setting-handlers.ts");
const SHARED = read("electron/handlers/novel-setting-shared.ts");
const DB = read("electron/novel-db.ts");

/** 截取某个 ipcMain.handle 通道的回调体（从通道名到下一个 ipcMain.handle 为止） */
function channelBody(source: string, channel: string): string {
  const start = source.indexOf(`"${channel}"`);
  if (start < 0) throw new Error(`未找到通道 ${channel}`);
  const next = source.indexOf("ipcMain.handle(", start);
  return source.slice(start, next < 0 ? source.length : next);
}

/** 回调体里第一处「写库语句」的下标（找不到给 Infinity） */
function firstWriteIndex(body: string): number {
  const markers = [
    "dbRun(",
    "UPDATE novel_setting",
    "INSERT INTO novel_setting",
    "DELETE FROM novel_setting",
  ];
  const found = markers.map((mark) => body.indexOf(mark)).filter((i) => i >= 0);
  return found.length > 0 ? Math.min(...found) : Number.POSITIVE_INFINITY;
}

describe("P0-1.1 引用项只读：逐个点名 10 个本书侧写通道", () => {
  // [通道, 该通道必须出现的守卫调用]。任何一条缺失 = 该通道可绕过只读、污染全局镜像。
  const GUARDED: ReadonlyArray<readonly [string, string]> = [
    ["novel-setting-category-update", "isReferencedCategory(id)"],
    ["novel-setting-category-delete", "isReferencedCategory(id)"],
    ["novel-setting-category-order", "isReferencedCategory(update.id)"],
    ["novel-setting-level-add", "isReferencedCategory(categoryId)"],
    ["novel-setting-level-batch-add", "isReferencedCategory(categoryId)"],
    ["novel-setting-level-update", "isLevelInReferencedCategory(id)"],
    ["novel-setting-level-delete", "isLevelInReferencedCategory(id)"],
    ["novel-setting-level-order", "isLevelInReferencedCategory(update.id)"],
    ["novel-setting-level-split", "isLevelInReferencedCategory(levelId)"],
    ["novel-setting-level-merge", "isLevelInReferencedCategory(levelId)"],
  ];

  for (const [channel, guard] of GUARDED) {
    it(`${channel}：写入前调用 ${guard}（且守卫早于任何写语句）`, () => {
      const body = channelBody(BOOK_HANDLERS, channel);
      expect(body, `${channel} 未调用只读守卫 ${guard}`).toContain(guard);
      const guardAt = body.indexOf(guard);
      const writeAt = firstWriteIndex(body);
      expect(writeAt, `${channel} 竟然没有任何写语句？核对失败`).toBeLessThan(
        Number.POSITIVE_INFINITY,
      );
      // 守卫必须"前置"：命中的下标要早于第一处写库，否则写完再判等于没判
      expect(guardAt).toBeLessThan(writeAt);
    });
  }

  it("本书域恰好只有这 10 个「可写既有行」的通道命中守卫（多一个就是漏网）", () => {
    const channels = [
      ...BOOK_HANDLERS.matchAll(/ipcMain\.handle\(\s*"([^"]+)"/g),
    ].map((match) => match[1]);
    // category-add 是「新建本书自有分类」（source_global_id 恒 NULL），没有可命中的
    // 既有引用行，故不在只读守卫之列；其余每个 setting-(category|level)-* 都必须钉。
    const writeChannels = channels
      .filter(
        (c) =>
          /^novel-setting-(category|level)-(add|update|delete|order|batch-add|split|merge)$/.test(
            c,
          ) && c !== "novel-setting-category-add",
      )
      .sort();
    expect(writeChannels).toEqual([...GUARDED.map((g) => g[0])].sort());
  });

  it("category-add 是新建自有分类：写入列的 source_global_id 恒 NULL（无法伪装成镜像）", () => {
    const body = channelBody(BOOK_HANDLERS, "novel-setting-category-add");
    // 它不写 source_global_id 列 → 落库即 NULL → 永不成为只读引用项
    expect(body).not.toContain("source_global_id");
    expect(body).toContain("workId");
  });

  it("只读判据读的是主进程权威列 source_global_id（不是 UI 态）", () => {
    const isRef = SHARED.slice(
      SHARED.indexOf("export function isReferencedCategory"),
      SHARED.indexOf("// ── 引用模型"),
    );
    expect(isRef).toContain(
      "SELECT source_global_id AS sid FROM novel_setting_categories WHERE id = ?",
    );
    expect(isRef).toContain("row.sid !== null");
    // 等级级判据用 JOIN 回分类，因此派生段 / 任意等级行都受同一守卫覆盖
    expect(SHARED).toContain("JOIN novel_setting_categories c ON c.id = l.category_id");
  });
});

describe("P0-1.2 全局 realm 全库唯一（应用层 + 部分唯一索引兜底）", () => {
  it("DDL 有 kind='realm' 的部分唯一索引", () => {
    expect(DB).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_novel_global_setting_cat_realm",
    );
    expect(DB).toMatch(
      /ON novel_global_setting_categories\(kind\)\s+WHERE kind = 'realm'/,
    );
  });

  it("add 通道先查 hasGlobalRealm，已存在即降级 custom", () => {
    const body = channelBody(GLOBAL_HANDLERS, "novel-global-setting-category-add");
    expect(body).toContain("hasGlobalRealm()");
    expect(body).toContain(
      'wanted === "realm" && !hasGlobalRealm() ? "realm" : "custom"',
    );
  });

  it("category-update 切 kind 时先降级同库原 realm（同事务）", () => {
    const body = channelBody(GLOBAL_HANDLERS, "novel-global-setting-category-update");
    expect(body).toContain("db.transaction(");
    expect(body).toContain("SET kind = 'custom'");
    expect(body).toContain("WHERE kind = 'realm' AND id != ?");
  });

  it("上架 publishGlobal 也在事务内先查全局 realm（撞唯一索引即会炸）", () => {
    const publish = SHARED.slice(SHARED.indexOf("export function publishGlobal"));
    expect(publish).toContain("FROM novel_global_setting_categories WHERE kind = 'realm'");
    expect(publish).toContain('book.kind === "realm" && !hasRealm ? "realm" : "custom"');
  });
});

describe("P0-1.3 rank 三件套：全局域与本书域同一口径，禁 max(rank) 当行数", () => {
  it("全局 level-add 走 levelCount / rankAt / maxRank+1（与本书域逐字同口径）", () => {
    const body = channelBody(GLOBAL_HANDLERS, "novel-global-setting-level-add");
    expect(body).toContain('const total = levelCount("global", categoryId)');
    expect(body).toContain(
      'at >= total ? maxRank("global", categoryId) + 1 : rankAt("global", categoryId, at)',
    );
  });

  it("本书 level-add 用同一套口径（两个域不各写一份）", () => {
    const body = channelBody(BOOK_HANDLERS, "novel-setting-level-add");
    expect(body).toContain('const total = levelCount("book", categoryId)');
    expect(body).toContain(
      'at >= total ? maxRank("book", categoryId) + 1 : rankAt("book", categoryId, at)',
    );
  });

  it("全局 handler 绝不把 maxRank 当行数（反向断言）", () => {
    expect(GLOBAL_HANDLERS).not.toMatch(/const\s+total\s*=\s*maxRank\(/);
    expect(GLOBAL_HANDLERS).not.toMatch(/Math\.min\(index,\s*maxRank\(/);
  });

  it("shared 的两个域都用 COUNT(*) 当行数，maxRank 只算 MAX(rank)", () => {
    expect(SHARED).toContain(
      "SELECT COUNT(*) AS n FROM novel_setting_levels WHERE category_id = ?",
    );
    expect(SHARED).toContain(
      "SELECT COUNT(*) AS n FROM novel_global_setting_levels WHERE category_id = ?",
    );
    expect(SHARED).toContain(
      "SELECT COALESCE(MAX(rank), 0) AS max FROM novel_global_setting_levels WHERE category_id = ?",
    );
  });
});

describe("P0-1.4 增量迁移幂等（旧库补列 / 新库重跑都不炸）", () => {
  it("三个新列的 ALTER 各自包在 PRAGMA 探测守卫内", () => {
    expect(DB).toMatch(/pragma\(\s*"table_info\(novel_setting_categories\)"/);
    expect(DB).toContain(
      'if (!categoryColumns.some((column) => column.name === "source_global_id")) {',
    );
    expect(DB).toContain(
      'if (!categoryColumns.some((column) => column.name === "detached_from_name")) {',
    );
    expect(DB).toContain(
      'if (!levelColumns.some((column) => column.name === "source_global_id")) {',
    );
    expect(DB).toContain(
      '"ALTER TABLE novel_setting_categories ADD COLUMN source_global_id TEXT"',
    );
    expect(DB).toContain(
      '"ALTER TABLE novel_setting_categories ADD COLUMN detached_from_name TEXT"',
    );
    expect(DB).toContain(
      '"ALTER TABLE novel_setting_levels ADD COLUMN source_global_id TEXT"',
    );
  });

  it("全局两表用 CREATE TABLE IF NOT EXISTS（重跑幂等）", () => {
    expect(DB).toContain("CREATE TABLE IF NOT EXISTS novel_global_setting_categories");
    expect(DB).toContain("CREATE TABLE IF NOT EXISTS novel_global_setting_levels");
  });

  it("新增的普通索引全部 IF NOT EXISTS（重复启动不报 already exists）", () => {
    for (const idx of [
      "idx_novel_global_setting_cat_sort",
      "idx_novel_global_setting_lv_cat",
      "idx_novel_setting_cat_source",
      "idx_novel_setting_lv_source",
    ]) {
      expect(DB).toContain(`CREATE INDEX IF NOT EXISTS ${idx}`);
    }
    expect(DB).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_novel_global_setting_cat_realm",
    );
  });
});

describe("P0-1.5 D4 删除固化：引用书就地转副本、内容不丢、不留幽灵引用", () => {
  it("固化把分类与全部镜像行的 source_global_id 都置 NULL，并写下原全局名", () => {
    const fn = SHARED.slice(
      SHARED.indexOf("export function solidifyReferencesForCategory"),
    );
    expect(fn).toContain(
      "UPDATE novel_setting_levels SET source_global_id = NULL WHERE category_id = ?",
    );
    expect(fn).toContain("SET source_global_id = NULL, detached_from_name = ?");
    expect(fn).toContain("db.transaction(");
    // 固化不动 novel_links：镜像 id 未变 ⇒ 作者已有的「当前境界」不失效
    expect(fn).not.toContain("novel_links");
  });

  it("删除顺序：先固化（source_global_id 清空）→ 删全局等级 → 删全局分类", () => {
    const body = channelBody(GLOBAL_HANDLERS, "novel-global-setting-category-delete");
    const solidify = body.indexOf("solidifyReferencesForCategory(id, row.name)");
    const delLevels = body.indexOf("DELETE FROM novel_global_setting_levels");
    const delCats = body.indexOf("DELETE FROM novel_global_setting_categories");
    expect(solidify).toBeGreaterThan(-1);
    expect(delLevels).toBeGreaterThan(solidify);
    expect(delCats).toBeGreaterThan(delLevels);
  });

  it("confirm !== true 只回传 refCount、不删除（二次确认的权威在主进程）", () => {
    const body = channelBody(GLOBAL_HANDLERS, "novel-global-setting-category-delete");
    expect(body).toContain("if (confirm !== true) return { ok: false, refCount };");
    const confirmAt = body.indexOf("confirm !== true");
    const delCats = body.indexOf("DELETE FROM novel_global_setting_categories");
    expect(confirmAt).toBeLessThan(delCats);
  });

  it("固化置 NULL 后只读守卫天然放行（判据是 sid !== null，NULL 视为本书自有）", () => {
    // 逐个字符核对判据，防止有人把 !== null 改成 truthy 判定（会误伤合法空串）
    expect(SHARED).toMatch(/return !!row && row\.sid !== null;/);
    expect(SHARED).not.toMatch(/return !!row && row\.sid;/);
  });
});

describe("P0-1.6 引用计数：排除已脱离的书、按 source_global_id 收口（不全表扫）", () => {
  it("单个计数：COUNT(DISTINCT work_id) + WHERE source_global_id = ?（NULL 不计）", () => {
    const fn = SHARED.slice(
      SHARED.indexOf("export function countGlobalRefs("),
      SHARED.indexOf("export function countGlobalRefsBatch("),
    );
    expect(fn).toContain("COUNT(DISTINCT c.work_id)");
    expect(fn).toContain("WHERE c.source_global_id = ?");
  });

  it("批量计数：WHERE source_global_id IS NOT NULL + GROUP BY（一次分组统计，免 N+1）", () => {
    const fn = SHARED.slice(SHARED.indexOf("export function countGlobalRefsBatch("));
    expect(fn).toContain("WHERE c.source_global_id IS NOT NULL");
    expect(fn).toContain("GROUP BY c.source_global_id");
  });

  it("source_global_id 有索引（计数不全表扫）", () => {
    expect(DB).toMatch(/ON novel_setting_categories\(source_global_id\)/);
    expect(DB).toMatch(/ON novel_setting_levels\(source_global_id\)/);
  });
});

describe("范围外写通道：已逐条核对，非只读漏洞（诚实标注）", () => {
  it("novel-setting-import(replace)：先摘 novel_links 再删，破坏性但自洽", () => {
    const body = channelBody(BOOK_HANDLERS, "novel-setting-import");
    const links = body.indexOf("DELETE FROM novel_links");
    const levels = body.indexOf("DELETE FROM novel_setting_levels");
    expect(links).toBeGreaterThan(-1);
    expect(links).toBeLessThan(levels);
  });

  it("seedTemplateBook（重置为模板书）是显式整库重置，不属引用只读范围", () => {
    const seed = read("electron/handlers/novel-handlers.ts");
    const idx = seed.indexOf("function seedTemplateBook");
    expect(idx).toBeGreaterThan(-1);
    const block = seed.slice(idx, seed.indexOf("function ", idx + 10));
    expect(block).toContain("DELETE FROM novel_setting_levels");
    expect(block).toContain("DELETE FROM novel_setting_categories");
  });
});

describe("架构纪律（独立复核）", () => {
  it("shared/novel 新增的设定纯函数文件都不含 React", () => {
    for (const file of [
      "setting-utils.ts",
      "setting-types.ts",
      "setting-presets.ts",
      "setting-reference.ts",
      "number-label.ts",
      "setting-defaults.ts",
    ]) {
      expect(read(`src/shared/novel/${file}`), `${file} 混入了 react`).not.toMatch(
        /from ["']react["']/,
      );
    }
  });

  it("提升到 shared 的 SettingCenter 不 import src/windows/**（窗口隔离）", () => {
    const source = read("src/shared/components/SettingCenter/index.tsx");
    expect(source).not.toMatch(/from ["'][^"']*windows\//);
    expect(source).not.toMatch(/from ["']@\/windows/);
  });

  it("主进程两个域的 handler 都只走 novel-db 别名，不 import ../db", () => {
    for (const source of [BOOK_HANDLERS, GLOBAL_HANDLERS, SHARED]) {
      expect(source).not.toMatch(/from ["']\.\.\/db["']/);
    }
  });
});
