/**
 * 地图独立库（map.db）的架构守卫
 *
 * 这类不变量最容易在下一次改动里被悄悄回退：有人为了省事把地图行塞进 novel.db，
 * 或者让 map handler 直接 import `db.ts` 的写通道 —— 于是"地图库可单独备份"
 * "正文写入不被大文档拖慢"就同时失效，而且**没有任何报错**。
 *
 * 为什么用源码断言而不是真跑 sqlite：better-sqlite3 的 native 按 Electron ABI 编译，
 * vitest（node 进程）下 require 直接抛。同先例 `novel-db-split.test.ts`。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), "utf8");
}

const MAP_DB = read("electron/map-db.ts");
const MAP_HANDLERS = read("electron/handlers/map-handlers.ts");
const MAIN = read("electron/main.ts");
const PRELOAD = read("electron/preload.ts");
const DTS = read("src/shared/types/electron.d.ts");
const CHECKIN_DB = read("electron/db.ts");
const NOVEL_DB = read("electron/novel-db.ts");

/** map.db 必须建齐的表（少一张 = 某个能力没有落点） */
const MAP_TABLES = ["map_docs", "map_revisions", "map_assets", "map_config"] as const;

describe("map.db 独立库（守卫）", () => {
  it("建齐四张表", () => {
    for (const table of MAP_TABLES) {
      expect(MAP_DB, `map.db 缺少 ${table}`).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
  });

  it("库文件与 checkin.db / novel.db 同级（同一个 user-data/{hash} 目录）", () => {
    expect(MAP_DB).toContain("join(getUserDataDir(email), MAP_DB_FILE)");
    expect(MAP_DB).toContain('MAP_DB_FILE = "map.db"');
  });

  it("跟随用户库开关（切用户 / 退出时不留悬空连接）", () => {
    expect(MAP_DB).toContain("registerUserDbLifecycle");
    expect(MAP_DB).toContain("onSwitched");
    expect(MAP_DB).toContain("onClosed");
  });

  it("checkin.db 与 novel.db 都不建 map 域的表（三本库互不越界）", () => {
    for (const source of [CHECKIN_DB, NOVEL_DB]) {
      for (const table of MAP_TABLES) {
        expect(source, `别的库里出现了 ${table}`).not.toContain(
          `CREATE TABLE IF NOT EXISTS ${table}`,
        );
      }
    }
  });

  it("map.db 不建 novel_* / checkin 域的表", () => {
    expect(MAP_DB).not.toMatch(/CREATE TABLE IF NOT EXISTS\s+novel_/);
    expect(MAP_DB).not.toMatch(/CREATE TABLE IF NOT EXISTS\s+(todos?|memos?|checkins?)/);
  });
});

describe("map handlers 只写 map.db（守卫）", () => {
  it("不导入 checkin.db 的写通道", () => {
    // 唯一允许的跨库读取是 novel-db 的只读封装（绑定作品校验 / 作品下拉）
    expect(MAP_HANDLERS).not.toMatch(/from\s+"\.\.\/db"/);
    expect(MAP_HANDLERS).toMatch(/from\s+"\.\.\/map-db"/);
  });

  it("写通道只用 map-db 的封装（不自己 new Database / 不碰文件路径拼库）", () => {
    expect(MAP_HANDLERS).not.toContain("better-sqlite3");
    expect(MAP_HANDLERS).not.toContain("new Database(");
  });

  it("列表通道不返回 doc_json（一屏 20 张图拉几十 MB）", () => {
    const listBlock = MAP_HANDLERS.slice(
      MAP_HANDLERS.indexOf('"map-docs-list"'),
      MAP_HANDLERS.indexOf('"map-doc-get"'),
    );
    expect(listBlock.length).toBeGreaterThan(0);
    expect(listBlock).not.toContain("doc_json");
  });

  it("保存走乐观锁：先比 rev，冲突时回传最新版本", () => {
    expect(MAP_HANDLERS).toContain("isRevConflict");
    expect(MAP_HANDLERS).toContain("conflict: true");
  });

  it("彻底删除同时清历史版本与资源目录（不留孤儿）", () => {
    const purgeBlock = MAP_HANDLERS.slice(
      MAP_HANDLERS.indexOf('"map-doc-purge"'),
      MAP_HANDLERS.indexOf('"map-doc-bind"'),
    );
    expect(purgeBlock).toContain("DELETE FROM map_revisions");
    expect(purgeBlock).toContain("DELETE FROM map_assets");
    expect(purgeBlock).toContain("DELETE FROM map_docs");
    expect(purgeBlock).toContain("getMapAssetsDir");
  });
});

describe("主进程接线（守卫）", () => {
  it("注册顺序：bridge 早于 handler（否则首个请求打到未打开的库）", () => {
    const bridge = MAIN.indexOf("registerMapDbBridge()");
    const handlers = MAIN.indexOf("registerMapHandlers()");
    expect(bridge).toBeGreaterThan(-1);
    expect(handlers).toBeGreaterThan(bridge);
  });

  it("lite 版不注册地图域（该版本根本不打包 map 窗口）", () => {
    const block = MAIN.slice(
      MAIN.indexOf("registerNovelHandlers();"),
      MAIN.indexOf("registerNovelHandlers();") + 600,
    );
    expect(block).toMatch(/EDITION\s*!==\s*"lite"/);
    expect(block).toContain("registerMapDbBridge()");
  });

  it("关窗拦截存在，且有 1.5s 兜底（不允许关不掉窗口）", () => {
    expect(MAIN).toContain("MAP_FLUSH_TIMEOUT_MS");
    expect(MAIN).toMatch(/mapWin\.on\("close"/);
    expect(MAIN).toContain("event.preventDefault()");
    expect(MAIN).toContain('"map-doc-request-snapshot"');
    expect(MAIN).toContain('"map-doc-flush-done"');
    // 兜底必须真的调用 close：只发通知不关 = 窗口永远不消失
    expect(MAIN).toMatch(/MAP_FLUSH_TIMEOUT_MS\s*\)\s*;/);
  });

  it("flush 状态按窗口 id 存（模块级布尔会在重开窗口后失效）", () => {
    expect(MAIN).toContain("mapFlushStates");
    expect(MAIN).toContain("mapFlushStates.delete(winId)");
  });
});

describe("preload 白名单（守卫）", () => {
  it("map 命名空间暴露了存档所需的通道，并对齐 d.ts", () => {
    for (const name of [
      "docsList",
      "get:",
      "create:",
      "save:",
      "flush:",
      "rename:",
      "remove:",
      "restore:",
      "purge:",
      "bind:",
      "thumb:",
      "workOptions:",
    ]) {
      expect(PRELOAD, `preload 缺少 map.${name}`).toContain(name);
    }
    expect(DTS).toContain("map: {");
    expect(DTS).toContain("MapDocSummaryDTO");
  });

  it("关窗请求 / 回执都在白名单里（否则 flush 永远发不出、也回不来）", () => {
    const receiveBlock = PRELOAD.slice(PRELOAD.indexOf("receive: (channel"), PRELOAD.indexOf("// ── 跨窗口通信"));
    expect(receiveBlock).toContain("map-doc-request-snapshot");
    const sendBlock = PRELOAD.slice(PRELOAD.indexOf("send: (channel"), PRELOAD.indexOf("receive: (channel"));
    expect(sendBlock).toContain("map-doc-flush-done");
  });
});
