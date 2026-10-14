/**
 * 行囊体系品阶 / 分类管理（1.40.0）与小层别名模板（1.39.1 扩）的源码级守卫
 *
 * 只能用源码断言：better-sqlite3 的 native 按 Electron ABI 编译，vitest（node）
 * 下 `require` 直接抛，这里的不变量碰不到真实库（同先例 `novel-setting-guard.test.ts`）。
 *
 * ⚠️ vitest 下 `import.meta.url` 不是 `file:` scheme，必须用 cwd 拼绝对路径。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DB = readFileSync(resolve(process.cwd(), "electron/novel-db.ts"), "utf8");
const PACK_HANDLERS = readFileSync(
  resolve(process.cwd(), "electron/handlers/novel-pack-handlers.ts"),
  "utf8",
);
const NOVEL_HANDLERS = readFileSync(
  resolve(process.cwd(), "electron/handlers/novel-handlers.ts"),
  "utf8",
);

/** 去掉注释再匹配：说明文字里会引用被检查的写法，不该算命中 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("体系品阶 / 分类管理：表与迁移必须齐全", () => {
  it("novel_pack_categories 建表 + 索引（漏了 = 保存事务直接抛 no such table）", () => {
    const body = stripComments(DB);
    expect(body).toContain("CREATE TABLE IF NOT EXISTS novel_pack_categories");
    expect(body).toContain(
      "CREATE INDEX IF NOT EXISTS idx_pack_cat_char",
    );
  });

  it("items / skills 的 grade_id 列：新库建表自带，老库 ALTER 兜底（两处缺一不可）", () => {
    const body = stripComments(DB);
    expect(body).toContain("grade_id TEXT NOT NULL DEFAULT ''");
    // ALTER 的幂等写法：pragma 探测后才 ADD COLUMN
    expect(body).toContain('table_info(novel_pack_items)');
    expect(body).toContain(
      "ALTER TABLE novel_pack_items ADD COLUMN grade_id",
    );
    expect(body).toContain(
      "ALTER TABLE novel_pack_skills ADD COLUMN grade_id",
    );
  });

  it("PACK_CHILD_TABLES 必须登记 novel_pack_categories（漏一张删作品就清不掉）", () => {
    const start = NOVEL_HANDLERS.indexOf("const PACK_CHILD_TABLES");
    const end = NOVEL_HANDLERS.indexOf("] as const", start);
    const list = NOVEL_HANDLERS.slice(start, end);
    expect(list).toContain('"novel_pack_categories"');
  });

  it("保存事务要写 categories 与 grade_id（整文档保存漏字段 = 改动静默丢失）", () => {
    const start = PACK_HANDLERS.indexOf('"novel-pack-save"');
    const body = stripComments(PACK_HANDLERS.slice(start));
    expect(body).toContain("novel_pack_categories");
    expect(body).toContain("grade_id");
    // 渲染层没传 categories（旧版渲染层 / 快照路径）时不得整体炸掉
    expect(body).toContain("payload.categories ?? []");
  });
});

describe("小层别名模板投影（1.39.1 扩：未拆分但配了固定名单的阶）", () => {
  it("readLevelSystems 要读本阶 / 分类两级 sub_pattern（只读一级会漏掉沿用分类的阶）", () => {
    const body = stripComments(PACK_HANDLERS);
    expect(body).toContain("level.sub_pattern ?? \"\"");
    expect(body).toContain("categoryById");
  });

  it("固定名单才算名字：buildSubLabels 必须经 fixedNameList 过滤 {n} 编号模板", () => {
    const body = stripComments(PACK_HANDLERS);
    expect(body).toContain("function fixedNameList");
    // 调用点：children 为空也要能落到 pattern 分支
    expect(body).toMatch(/children\.length > 0 \|\| fixedNameList\(pattern\)\.length > 0/);
  });

  it("体系品阶投影只出根阶（派生段不是可标注的品阶名）", () => {
    const body = stripComments(PACK_HANDLERS);
    expect(body).toContain("function readGradeSystems");
    expect(body).toContain("novel_setting_categories WHERE work_id = ?");
  });
});
