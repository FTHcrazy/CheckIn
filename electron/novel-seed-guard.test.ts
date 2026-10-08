/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 「自动播种」与「灵感归属」的回归测试。
 *
 * 真实事故：播种判据原本是 `works.length === 0`。用户把所有作品删光后，下一次
 * 装载会再次判定为空库并跑一遍 `seedTemplateBook()` —— 而它是**清库重播种**，
 * 内部有一条 `DELETE FROM novel_notes`（全表）。灵感里 `work_id = ''` 是合法状态
 * （`novel-note-move(id, '')` = 退回未归属的全局池），与任何作品都无关，
 * 于是用户原创的灵感被静默清空，行囊草稿与盘点记录同样不保。
 *
 * 为什么用源码断言而不是真跑一遍 SQL：better-sqlite3 的 native 模块按 Electron ABI
 * 编译，vitest（node 进程）下加载不了，所以把这两条不变量钉在源码上。
 */
const HANDLERS = readFileSync(
  path.resolve(process.cwd(), "electron/handlers/novel-handlers.ts"),
  "utf8",
);

/** 截取 `novel-editor-load` 的处理函数体（下一个 ipcMain.handle 为止） */
function loadBody(): string {
  const start = HANDLERS.indexOf('"novel-editor-load"');
  expect(start).toBeGreaterThan(-1);
  const end = HANDLERS.indexOf("ipcMain.handle", start + 1);
  return HANDLERS.slice(start, end === -1 ? undefined : end);
}

/** 截取 seedTemplateBook 的函数体（到下一个顶层声明为止） */
function seedBody(): string {
  const start = HANDLERS.indexOf("function seedTemplateBook");
  expect(start).toBeGreaterThan(-1);
  return HANDLERS.slice(start, start + 4000);
}

describe("模板书籍播种 · 不得在用户删光作品后重跑", () => {
  it("引入了 SEEDED_KEY 作为「确凿的首次使用」判据", () => {
    expect(HANDLERS).toContain('const SEEDED_KEY = "novel_seeded";');
  });

  it("装载时的播种条件同时要求 SEEDED_KEY 未落过", () => {
    const body = loadBody();
    expect(body).toContain("seedTemplateBook()");
    // 只判 works.length === 0 是不够的：那是「书架此刻为空」，不是「从未用过」
    expect(body).toContain("getConfig(SEEDED_KEY) === null");
  });

  it("播种后立刻落 SEEDED_KEY，防止下次装载重复播种", () => {
    const body = loadBody();
    const seedIdx = body.indexOf("seedTemplateBook()");
    const markIdx = body.indexOf("setConfig(SEEDED_KEY");
    expect(markIdx).toBeGreaterThan(seedIdx);
  });

  it("SEEDED_KEY 的声明处写明了不用 works.length 当判据的原因", () => {
    const start = HANDLERS.indexOf("模板书籍「已播种过」标记");
    expect(start).toBeGreaterThan(-1);
    const decl = HANDLERS.slice(start, start + 600);
    expect(decl).toContain("播种判据不能用");
    expect(decl).toContain("删光");
    expect(decl).toContain('const SEEDED_KEY = "novel_seeded"');
  });
});

describe("灵感：归属作品的才随清库删除，未归属的全局池必须保留", () => {
  it("DELETE novel_notes 带 work_id 过滤", () => {
    const body = seedBody();
    const stmt = body.slice(
      body.indexOf("DELETE FROM novel_notes"),
      body.indexOf(";", body.indexOf("DELETE FROM novel_notes")),
    );
    // 全表 DELETE 会连 work_id = '' 的全局灵感池一起清掉
    expect(stmt).toContain("WHERE work_id <> ''");
  });

  it("不得残留裸的全表 DELETE FROM novel_notes", () => {
    const body = seedBody();
    expect(body).not.toContain('dbRun("DELETE FROM novel_notes")');
    expect(body).not.toContain("dbRun('DELETE FROM novel_notes')");
  });
});
