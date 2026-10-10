/// <reference types="node" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 「绝不自动播种模板书籍」的回归测试。
 *
 * 历史事故（两轮，方向相反）：
 * 1. 最初判据是 `works.length === 0` → 用户删光作品后下次装载会重跑
 *    `seedTemplateBook()`，而它是**清库重播种**，把用户原创灵感
 *    （`work_id = ''` 的全局池）与行囊草稿一起抹掉；
 * 2. 修法加 `novel_seeded` 标记，但**老版本升级上来的用户没有这个键** ——
 *    他们删光作品的下一刻仍会撞上一次清库，表现为「删掉的书全回来了，
 *    还多出一本模板书」。
 *
 * 最终口径：**新用户默认空书架**，装载路径**完全不播种**；模板书只能经
 * 「重置为模板书籍」显式获取。
 *
 * 为什么用源码断言而不是真跑一遍 SQL：better-sqlite3 的 native 模块按
 * Electron ABI 编译，vitest（node 进程）下加载不了，所以把不变量钉在源码上。
 */
const HANDLERS = readFileSync(
  path.resolve(process.cwd(), "electron/handlers/novel-handlers.ts"),
  "utf8",
);

/**
 * 截取 `novel-editor-load` 的处理函数体（下一个 ipcMain.handle 为止）。
 *
 * 注意：说明性注释（「不做任何自动播种」那段）写在 `ipcMain.handle(...)` 的
 * **上方**，所以必须把紧邻的前导注释块一起纳入，否则断言会看空。
 */
function loadBody(): string {
  const marker = HANDLERS.indexOf('"novel-editor-load"');
  expect(marker).toBeGreaterThan(-1);

  // 从 `ipcMain.handle` 起向上吃掉紧邻的 `//` 注释块
  const handleLineStart = HANDLERS.lastIndexOf("ipcMain.handle", marker);
  let start = handleLineStart === -1 ? marker : handleLineStart;
  let cursor = HANDLERS.lastIndexOf("\n", start - 1);
  while (cursor > 0) {
    const prevLineStart = HANDLERS.lastIndexOf("\n", cursor - 1) + 1;
    const prevLine = HANDLERS.slice(prevLineStart, cursor).trimStart();
    if (!prevLine.startsWith("//")) break;
    start = prevLineStart;
    cursor = HANDLERS.lastIndexOf("\n", start - 1);
  }

  const end = HANDLERS.indexOf("ipcMain.handle", marker + 1);
  return HANDLERS.slice(start, end === -1 ? undefined : end);
}

/** 截取 seedTemplateBook 的函数体（到下一个顶层声明为止） */
function seedBody(): string {
  const start = HANDLERS.indexOf("function seedTemplateBook");
  expect(start).toBeGreaterThan(-1);
  return HANDLERS.slice(start, start + 4000);
}

/** 剥掉整行 `//` 注释与块注释行，只留可执行代码 */
function stripComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
    })
    .join("\n");
}

describe("装载路径：绝不自动播种模板书籍", () => {
  it("novel-editor-load 不调用 seedTemplateBook", () => {
    // 注释里会提到这个函数名（说明历史实现），只断言可执行代码
    const body = stripComments(loadBody());
    expect(body).not.toContain("seedTemplateBook()");
  });

  it("不再依赖 novel_seeded 判据（旧键已废弃）", () => {
    // 判据本身不可靠（老用户没有这个键），所以整条移除而不是保留
    expect(HANDLERS).not.toContain("const SEEDED_KEY");
    const body = loadBody();
    expect(body).not.toContain("SEEDED_KEY");
  });

  it("装载里不做「works 为空就播种」的分支", () => {
    const body = loadBody();
    // 允许在注释里提到 works 为空，但不允许出现「空 → 播种」的可执行分支
    expect(body).not.toMatch(/if\s*\([^)]*works\.length === 0[^)]*\)\s*\{[^}]*seedTemplateBook/);
  });

  it("装载注释写明了移除自动播种的两条原因", () => {
    const body = loadBody();
    expect(body).toContain("不做任何自动播种");
    expect(body).toContain("清库重播种");
    // 老用户没有 novel_seeded 键这条必须留痕，否则后来者会「顺手加回来」
    expect(body).toContain("老版本升级");
  });
});

describe("模板书籍：只剩「重置」一条显式通道", () => {
  it("seedTemplateBook 仅被 novel-editor-reset-template 调用", () => {
    // 抓所有 `seedTemplateBook()` 出现点，逐行判定
    const calls = [...HANDLERS.matchAll(/seedTemplateBook\(\)/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const at = call.index ?? 0;
      const lineStart = HANDLERS.lastIndexOf("\n", at) + 1;
      const lineEnd = HANDLERS.indexOf("\n", at);
      const line = HANDLERS.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
      // 跳过函数定义行：`function seedTemplateBook()` 也匹配 `seedTemplateBook\(\)`
      if (line.includes("function ")) continue;
      // 跳过注释行：说明文字里提到函数名不算调用
      if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) continue;
      // 只允许出现在 ipcMain.handle("novel-editor-reset-template", () => seedTemplateBook()) 这一行
      expect(line).toContain("novel-editor-reset-template");
    }
  });

  it("重置入口仍在（用户手动取回模板书的唯一途径）", () => {
    expect(HANDLERS).toContain('"novel-editor-reset-template"');
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
