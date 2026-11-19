/**
 * 要素删除与回收站恢复（O-18 / O-13b）的架构守卫。
 *
 * 四条不变量，任何一条回退都会造成「删了找不回来」或「恢复出半张卡」：
 * 1. 删除是软删（deleted_at），物理删只发生在回收站的 purge；
 * 2. purge 先清两端关联再删本体，且走事务；
 * 3. restore 清标记后回传完整本体 + 关联（渲染层没有按 id 取要素的通道）；
 * 4. 装载过滤回收站要素及其悬空关联。
 *
 * 用源码断言：better-sqlite3 的 native 按 Electron ABI 编译，node 下起不了真库。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string): string =>
  readFileSync(path.resolve(process.cwd(), relative), "utf8");

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const DB = stripComments(read("electron/novel/novel-db.ts"));
const HANDLERS = stripComments(read("electron/handlers/novel/novel-handlers.ts"));
const SAFETY = stripComments(read("electron/handlers/novel/novel-safety-handlers.ts"));

describe("novel_entities.deleted_at（软删除字段）", () => {
  it("建表带列，老库靠 PRAGMA 探测 + ALTER 补列，并建索引", () => {
    expect(DB).toContain("deleted_at INTEGER");
    expect(DB).toContain('pragma("table_info(novel_entities)")');
    expect(DB).toContain("ALTER TABLE novel_entities ADD COLUMN deleted_at");
    expect(DB).toContain("idx_novel_entities_deleted");
  });
});

describe("要素三条 IPC（O-18 / O-13b）", () => {
  it("delete 只打标记，绝不直接 DELETE 本体", () => {
    expect(HANDLERS).toContain("novel-entity-delete");
    expect(HANDLERS).toMatch(
      /UPDATE novel_entities SET deleted_at = \? WHERE id = \? AND deleted_at IS NULL/,
    );
  });

  it("purge 在事务里先删两端关联、再删本体（不留悬空边）", () => {
    expect(HANDLERS).toContain("novel-entity-purge");
    expect(HANDLERS).toContain("db.transaction(");
    expect(HANDLERS).toContain(
      "DELETE FROM novel_links WHERE from_id = ? OR to_id = ?",
    );
    expect(HANDLERS).toContain("DELETE FROM novel_entities WHERE id = ?");
  });

  it("restore 清标记，并把完整本体与关联一起回传给所有窗口", () => {
    expect(HANDLERS).toContain("novel-entity-restore");
    expect(HANDLERS).toMatch(
      /UPDATE novel_entities SET deleted_at = NULL WHERE id = \? AND deleted_at IS NOT NULL/,
    );
    expect(HANDLERS).toContain("restored: [toEntityDto(row)]");
    expect(HANDLERS).toContain("broadcastEntitiesChanged(");
  });

  it("装载时过滤回收站要素，并剔除指向它们的悬空关联", () => {
    expect(HANDLERS).toMatch(
      /SELECT \* FROM novel_entities WHERE deleted_at IS NULL\s/,
    );
    expect(HANDLERS).toContain("trashedEntityIds");
    expect(HANDLERS).toContain('link.fromType === "entity" && trashedEntityIds.has');
    expect(HANDLERS).toContain('link.toType === "entity" && trashedEntityIds.has');
  });

  it("回收站列表纳入 entity，可逐条彻底删除", () => {
    expect(SAFETY).toContain("SELECT 'entity'");
    expect(SAFETY).toContain("e.deleted_at");
  });
});
