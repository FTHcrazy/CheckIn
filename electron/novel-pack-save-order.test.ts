/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 行囊「整文档保存」的**删除顺序**回归测试。
 *
 * 真实事故：`novel_pack_modifiers` 是多态表（只有 `owner_type` / `owner_id`，
 * 没有 `character_id`），只能靠子查询从 `novel_pack_items` / `novel_pack_skills`
 * 反查归属。一旦先删宿主再删加成，反查子查询立刻变成空集 → 加成一条也删不掉 →
 * 紧接着插入同 id 撞主键：
 *   `UNIQUE constraint failed: novel_pack_modifiers.id`
 * 而整个保存是一个事务，抛错即整体回滚 → 用户侧表现为「从第二次保存起必失败」。
 * 用模板行囊（固定 id `tpl-pm-*`）时必现。
 *
 * 为什么用源码断言而不是真跑一遍 SQL：better-sqlite3 的 native 模块是按 Electron
 * ABI 编译的，vitest（node 进程）下根本加载不了，所以把「顺序」这条不变量钉在源码上。
 */
const HANDLERS = readFileSync(
  path.resolve(process.cwd(), "electron/handlers/novel-pack-handlers.ts"),
  "utf8",
);

/** 截取 `novel-pack-save` 的处理函数体（到下一个 ipcMain.handle 为止） */
function saveBody(): string {
  const start = HANDLERS.indexOf('"novel-pack-save"');
  expect(start).toBeGreaterThan(-1);
  const end = HANDLERS.indexOf("ipcMain.handle", start + 1);
  return HANDLERS.slice(start, end === -1 ? undefined : end);
}

describe("行囊整文档保存 · 删除顺序", () => {
  it("加成先于它的宿主（items / skills）被删除", () => {
    const body = saveBody();
    const modIdx = body.indexOf("DELETE FROM novel_pack_modifiers");
    // 宿主表走统一循环删除：dbRun(`DELETE FROM ${table} WHERE character_id = ?`)
    const loopIdx = body.indexOf("DELETE FROM ${table}");
    expect(modIdx).toBeGreaterThan(-1);
    expect(loopIdx).toBeGreaterThan(-1);
    expect(modIdx).toBeLessThan(loopIdx);
  });

  it("宿主循环里确实包含 items 与 skills（顺序断言的前提）", () => {
    const body = saveBody();
    const loopArray = /for \(const table of \[([\s\S]*?)\]\)/.exec(body);
    expect(loopArray).not.toBeNull();
    const list = loopArray![1];
    expect(list).toContain("novel_pack_items");
    expect(list).toContain("novel_pack_skills");
  });

  it("加成删除覆盖 item / skill / status 三类 owner", () => {
    const body = saveBody();
    const start = body.indexOf("DELETE FROM novel_pack_modifiers");
    const stmt = body.slice(start, body.indexOf(";", start));
    expect(stmt).toContain("'item'");
    expect(stmt).toContain("'skill'");
    expect(stmt).toContain("'status'");
  });

  it("保留孤儿加成清理（宿主已不存在的历史残留）", () => {
    const body = saveBody();
    expect(body).toContain(
      "owner_type = 'item'  AND owner_id NOT IN (SELECT id FROM novel_pack_items)",
    );
    expect(body).toContain(
      "owner_type = 'skill' AND owner_id NOT IN (SELECT id FROM novel_pack_skills)",
    );
  });
});
