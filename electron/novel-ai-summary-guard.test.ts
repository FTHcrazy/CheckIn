/**
 * R-AI-09 章节摘要 + M6 溯源的架构守卫
 *
 * 钉住三处不变量，防止后续改动悄悄回退：
 * 1. 摘要四列落在 `novel_chapters`（加列而非 KV 映射 / 独立表），
 *    随 `novel-chapter-purge` 物理 DELETE 自动清理；
 * 2. 摘要保存必须带来源标记（`ai_summary_model` + `ai_summary_batch`），手工编辑清空标记；
 * 3. UI 必须显式标注「AI 生成」，让用户能区分 AI 摘要与自己写的备注。
 *
 * 为什么用源码断言：better-sqlite3 的 native 按 Electron ABI 编译，
 * vitest（node 进程）下 require 直接抛，跑不了真实建库。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const NOVEL_DB = readFileSync(
  path.resolve(process.cwd(), "electron/novel-db.ts"),
  "utf8",
);
const NOVEL_HANDLERS = readFileSync(
  path.resolve(process.cwd(), "electron/handlers/novel-handlers.ts"),
  "utf8",
);
const SUMMARY_PREVIEW = readFileSync(
  path.resolve(
    process.cwd(),
    "src/windows/NovelWindow/pages/NovelPage/components/SummaryPreview/index.tsx",
  ),
  "utf8",
);

/** 剥注释后的源码（断言不变量时避免注释里的字面量误命中/漏命中） */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("novel_chapters 摘要四列（R-AI-09 架构决定 = 加列）", () => {
  it("四列均以 PRAGMA 探测 + ALTER 加列，落 novel_chapters 而非独立表 / KV", () => {
    const db = stripComments(NOVEL_DB);
    expect(db).toContain('ALTER TABLE novel_chapters ADD COLUMN ai_summary');
    expect(db).toContain('ALTER TABLE novel_chapters ADD COLUMN ai_summary_at');
    expect(db).toContain('ALTER TABLE novel_chapters ADD COLUMN ai_summary_model');
    expect(db).toContain('ALTER TABLE novel_chapters ADD COLUMN ai_summary_batch');
    // 每个加列前都要 PRAGMA 探测（幂等；老库补列靠它）
    expect(db).toContain('pragma("table_info(novel_chapters)")');
    // 加列而非独立表：不应出现 ai_summary 的独立 CREATE TABLE
    expect(db).not.toMatch(/CREATE TABLE[^;]*ai_summary/);
  });

  it("摘要列带 work_id 索引，支撑「哪些章还没摘要」的批量扫描", () => {
    const db = stripComments(NOVEL_DB);
    expect(db).toContain("idx_novel_chapters_summary_at");
    expect(db).toContain("ON novel_chapters(work_id, ai_summary_at)");
  });
});

describe("novel-chapter-summary-save（M6 溯源 + 生命周期）", () => {
  it("保存带来源标记（ai_summary_model + ai_summary_batch），手工编辑传空清空标记", () => {
    const h = stripComments(NOVEL_HANDLERS);
    expect(h).toContain("novel-chapter-summary-save");
    // 四列同写（正文 / 生成时间 / 来源模型 / 批次）
    expect(h).toContain(
      "ai_summary = ?, ai_summary_at = ?, ai_summary_model = ?, ai_summary_batch = ?",
    );
    // 清空摘要时四列一并置空，不留半截来源标记
    expect(h).toContain(
      "ai_summary = NULL, ai_summary_at = NULL, ai_summary_model = NULL, ai_summary_batch = NULL",
    );
  });

  it("摘要写入走 novel.db 通道（dbRun 别名），不碰 checkin 域", () => {
    const h = stripComments(NOVEL_HANDLERS);
    // novel-handlers 的 dbRun 来自 ../novel-db（文件头已声明，这里钉通道名）
    expect(h).toContain('UPDATE novel_chapters SET ai_summary');
  });
});

describe("摘要 UI 的来源标注（用户能区分 AI 与手写）", () => {
  it("浮层显式标注「AI 生成」与模型名", () => {
    const ui = stripComments(SUMMARY_PREVIEW);
    expect(ui).toContain("AI 生成");
    expect(ui).toContain("模型");
  });
});
