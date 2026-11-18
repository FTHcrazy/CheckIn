/**
 * 面试题库独立库（interview.db）的架构守卫
 *
 * 本库与 novel.db / map.db 最大的不同：它装的是**用户增量**，题库本体在源码。
 * 所以这里额外守一类别处没有的不变量 —— 「增量不许退化成物化」：
 * 一旦有人把 243 道基线题也 INSERT 进来，COW 就名存实亡，下次发版必须写数据迁移。
 *
 * 为什么用源码断言而不是真跑 sqlite：better-sqlite3 的 native 按 Electron ABI
 * 编译，vitest（node 进程）下 require 直接抛。同先例 `map-db-guard.test.ts`。
 *
 * 规范：docs/spec/interview-db-ai-spec.md §3 / §12
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), "utf8");
}

const INTERVIEW_DB = read("electron/interview/interview-db.ts");
const MAIN = read("electron/main.ts");
const CHECKIN_DB = read("electron/core/db.ts");
const NOVEL_DB = read("electron/novel/novel-db.ts");
const MAP_DB = read("electron/map/map-db.ts");
const AI_DB = read("electron/ai/ai-db.ts");

/** 本库必须建齐的表（少一张 = 某类能力没有落点） */
const INTERVIEW_TABLES = ["interview_item", "interview_taxonomy", "interview_meta"] as const;

describe("interview.db 独立库（守卫）", () => {
  it("建齐三张表", () => {
    for (const table of INTERVIEW_TABLES) {
      expect(INTERVIEW_DB, `interview.db 缺少 ${table}`).toContain(
        `CREATE TABLE IF NOT EXISTS ${table}`,
      );
    }
  });

  it("库文件与其它三本同级（同一个 user-data/{hash} 目录）", () => {
    expect(INTERVIEW_DB).toContain("join(getUserDataDir(email), INTERVIEW_DB_FILE)");
    expect(INTERVIEW_DB).toContain('INTERVIEW_DB_FILE = "interview.db"');
  });

  it("跟随用户库开关（切用户 / 退出时不留悬空连接）", () => {
    expect(INTERVIEW_DB).toContain("registerUserDbLifecycle");
    expect(INTERVIEW_DB).toContain("onSwitched");
    expect(INTERVIEW_DB).toContain("onClosed");
    // 桥晚于 switchUserDb 注册时必须自己补开一次，否则首启首个请求打到空库
    expect(INTERVIEW_DB).toMatch(/getCurrentUserEmail\(\)[\s\S]{0,80}switchInterviewDb/);
  });

  it("建齐索引（列表按 kind+status、覆盖关系按 base_id 都要能走索引）", () => {
    for (const index of [
      "idx_item_action_status",
      "idx_item_base",
      "idx_item_kind_status",
      "idx_item_category",
      "idx_taxonomy_track",
    ]) {
      expect(INTERVIEW_DB, `缺少索引 ${index}`).toContain(index);
    }
  });

  it("主进程不碰渲染层（禁止 import @/windows 下的题库常量）", () => {
    // 基线数据在 src/windows/BaseWindow/pages/InterviewPage/data/，主进程从不 import
    // 渲染层。谁想「顺手读一下题库」都得走 IPC，不能在这里 require。
    expect(INTERVIEW_DB).not.toContain("@/windows");
    expect(INTERVIEW_DB).not.toMatch(/from\s+"\.\.\/\.\.\/src\//);
  });
});

describe("COW 状态机（CHECK 约束是唯一强制点）", () => {
  /**
   * 这些 CHECK 一旦被删，COW 就退化成「靠渲染层自觉」：
   * 重复 id 覆盖、墓碑带 payload、override 进回收站都会静默写进库，
   * 然后在合并视图里表现成「一道题同时是隐藏和已编辑」。
   */
  it("override 必须认领基线（base_id = id），不许另造 id", () => {
    expect(INTERVIEW_DB).toContain("CHECK (action <> 'override' OR base_id IS NOT NULL)");
    expect(INTERVIEW_DB).toContain("CHECK (action <> 'override' OR base_id = id)");
  });

  it("用户新建必须带 u- 前缀，且不认领基线", () => {
    expect(INTERVIEW_DB).toContain("CHECK (action <> 'new'      OR base_id IS NULL)");
    expect(INTERVIEW_DB).toContain("CHECK (action <> 'new'      OR id LIKE 'u-%')");
  });

  it("墓碑只允许隐身：payload 必须清空", () => {
    expect(INTERVIEW_DB).toContain(
      "CHECK (status <> 'hidden'   OR (action = 'override' AND payload_json IS NULL))",
    );
    expect(INTERVIEW_DB).toContain(
      "CHECK (action <> 'override' OR payload_json IS NOT NULL OR status = 'hidden')",
    );
  });

  it("回收站只收用户自建（override 删除叫还原默认，是删行不是进回收站）", () => {
    expect(INTERVIEW_DB).toContain("CHECK (status <> 'deleted'  OR action = 'new')");
  });

  it("新增分类排在基线之后（order_no >= 100，否则侧栏顺序插进既有分组）", () => {
    expect(INTERVIEW_DB).toContain("CHECK (order_no >= 100)");
  });
});

describe("各域独立库互不越界（守卫）", () => {
  it("其它四本库都不建 interview 域的表", () => {
    for (const source of [CHECKIN_DB, NOVEL_DB, MAP_DB, AI_DB]) {
      for (const table of INTERVIEW_TABLES) {
        expect(source, `别的库里出现了 ${table}`).not.toContain(
          `CREATE TABLE IF NOT EXISTS ${table}`,
        );
      }
    }
  });

  it("interview.db 不建 novel_* / map_* / checkin 域的表", () => {
    expect(INTERVIEW_DB).not.toMatch(/CREATE TABLE IF NOT EXISTS\s+novel_/);
    expect(INTERVIEW_DB).not.toMatch(/CREATE TABLE IF NOT EXISTS\s+map_/);
    expect(INTERVIEW_DB).not.toMatch(/CREATE TABLE IF NOT EXISTS\s+(todos?|memos?|checkins?)/);
  });

  it("连接只在本文件里建（handler 只许用 interviewAll/Get/Run 封装）", () => {
    // new Database( 只允许出现在 switchInterviewDb 里；handler 若自己拼路径开库，
    // 切用户 / 退出登录时就漏关，留下悬空连接与 -wal 残留。
    expect(INTERVIEW_DB.split("new Database(").length - 1).toBe(1);
  });
});

describe("主进程接线（守卫）", () => {
  it("bridge 在 app ready 之后、initDb 之后注册（早于 initDb 拿不到 userData 路径）", () => {
    const initDb = MAIN.indexOf("initDb();");
    const bridge = MAIN.indexOf("registerInterviewDbBridge();");
    expect(initDb).toBeGreaterThan(-1);
    expect(bridge).toBeGreaterThan(initDb);
  });

  it("novel 版整组跳过（该版本不打包 BaseWindow，题库页根本不存在）", () => {
    const bridge = MAIN.indexOf("registerInterviewDbBridge();");
    const block = MAIN.slice(Math.max(0, bridge - 500), bridge);
    expect(block).toMatch(/EDITION\s*!==\s*"novel"/);
  });

  it("baseline_version 由 app.getVersion() 写入（app 升级后首连自更新）", () => {
    expect(INTERVIEW_DB).toContain("app.getVersion()");
    expect(INTERVIEW_DB).toContain("baseline_version");
  });
});
