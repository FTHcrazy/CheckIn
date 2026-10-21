/**
 * 关系图提交通道的源码守卫（R27 / S3）
 *
 * 为什么只能做源码断言：better-sqlite3 的 native 按 Electron ABI 编译，vitest
 * （node）下 require 直接抛，跑不了真实事务。同先例 `novel-write-guard.test.ts` /
 * `novel-db-split.test.ts`。
 *
 * 这里钉的是四条**改错了不会报错、只会静默丢数据**的约束：
 * ① 写通道必须来自 novel.db（不是 checkin 的 db.ts）；
 * ② 四类写在一个事务里（事务外补补偿 = 半成品）；
 * ③ 建边用 `ON CONFLICT(id) DO NOTHING`，**绝不按四元组 DELETE**（会误删平行边）；
 * ④ 端点归属校验必须排在任何 INSERT 之前（novel_links 没有 work_id）。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HANDLER = readFileSync(
  resolve(process.cwd(), "electron/handlers/novel-graph-handlers.ts"),
  "utf8",
);
/**
 * 剥掉注释后的源码，专供「不许出现 X」这类否定断言用。
 * 文件头注释里点名了 `novel-link-set` 是为了解释**为什么不复用它**，
 * 那是要保留的信息，不能因为字符串出现就判定违规。
 */
const HANDLER_CODE = HANDLER.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /(^|[^:])\/\/[^\n]*/g,
  "$1",
);
const PRELOAD = readFileSync(resolve(process.cwd(), "electron/preload.ts"), "utf8");
const MAIN = readFileSync(resolve(process.cwd(), "electron/main.ts"), "utf8");
/** 反向同步（S4）：广播实现下沉到 events 模块，加法在这里 */
const EVENTS = readFileSync(resolve(process.cwd(), "electron/novel-links-events.ts"), "utf8");
const HANDLERS = readFileSync(
  resolve(process.cwd(), "electron/handlers/novel-handlers.ts"),
  "utf8",
);

describe("存储归属", () => {
  it("写通道只从 novel-db 取，不 import checkin 的 db.ts", () => {
    expect(HANDLER).toContain('from "../novel-db"');
    expect(HANDLER).not.toMatch(/from "\.\.\/db"/);
  });

  it("库未就绪时返回失败码而不是抛错（退出流程中仍可能发来一次提交）", () => {
    expect(HANDLER).toContain("isNovelDbReady()");
    expect(HANDLER).toContain('code: "db"');
  });
});

describe("单事务", () => {
  it("四类写全部包在 getDb().transaction 里", () => {
    expect(HANDLER).toContain("db.transaction(");
    const body = HANDLER.slice(HANDLER.indexOf("db.transaction("));
    expect(body).toContain("INSERT INTO novel_links");
    expect(body).toContain("UPDATE novel_links SET note");
    expect(body).toContain("INSERT INTO novel_config");
  });

  it("端点归属校验排在第一条 INSERT 之前", () => {
    const validate = HANDLER.indexOf("loadWorkEntityIds(workId)");
    const firstInsert = HANDLER.indexOf("INSERT INTO novel_links");
    expect(validate).toBeGreaterThan(-1);
    expect(firstInsert).toBeGreaterThan(-1);
    expect(validate).toBeLessThan(firstInsert);
  });

  it("非法端点显式回滚并回传具体 id", () => {
    expect(HANDLER).toContain('code: "invalid-target"');
    expect(HANDLER).toContain("invalid: [...new Set(invalid)]");
  });
});

describe("建边语义", () => {
  it("按 id 幂等插入，绝不按四元组先删后插（否则同端点同关系名会丢平行边）", () => {
    expect(HANDLER).toContain("ON CONFLICT(id) DO NOTHING");
    expect(HANDLER_CODE).not.toMatch(/DELETE\s+FROM\s+novel_links/i);
    // 复用境界绑定那条 -set 通道正是当年被否掉的做法（注释里解释原因可以，代码里出现不行）
    expect(HANDLER_CODE).not.toContain("novel-link-set");
    expect(HANDLER_CODE).not.toContain("upsertRealmLinkRow");
  });

  it("事务内按四元组 SELECT 去重，命中归入 merged 而不是新增", () => {
    expect(HANDLER).toContain("AND relation = ?");
    expect(HANDLER).toContain("merged.push(existing.id)");
  });

  it("去重是**无向**判定：正反向同关系名算同一对（否则弹层说合并、库里新插一行）", () => {
    const select = HANDLER.slice(HANDLER.indexOf("SELECT id FROM novel_links"));
    expect(select).toContain("(from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)");
    expect(select).toContain("[link.relation, link.fromId, link.toId, link.toId, link.fromId]");
  });

  it("自环 / 空关系名在写入路径上挡住（不依赖渲染层的 checkDraft）", () => {
    const guard = HANDLER.indexOf('code: "invalid-link"');
    const firstInsert = HANDLER.indexOf("INSERT INTO novel_links");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(firstInsert);
    expect(HANDLER).toContain("fromId === toId");
    expect(HANDLER).toContain("关系名不能为空");
    // 上限与渲染层同值，且超长直接拒绝而不是静默截断
    expect(HANDLER).toContain("RELATION_NAME_MAX = 24");
    expect(HANDLER).toContain("relation.length > RELATION_NAME_MAX");
  });

  it("备注只改 note 一列，expectedNote 不一致时保留库里较新的值", () => {
    expect(HANDLER).toContain("UPDATE novel_links SET note = ? WHERE id = ?");
    expect(HANDLER).toContain("note-changed");
    expect(HANDLER).toContain("slice(0, 200)");
  });
});

describe("乐观锁", () => {
  it("rev 由主进程接管（expectedRev + 1），不一致即 stale 整体回滚", () => {
    expect(HANDLER).toContain("rev = expectedRev + 1");
    expect(HANDLER).toContain("storedRev !== expectedRev");
    expect(HANDLER).toContain('code: "stale"');
  });
});

describe("事件链", () => {
  it("事务成功后广播细粒度 delta（带 created / merged / notes），并排除发送者", () => {
    const txEnd = HANDLER.indexOf("return run();");
    const broadcast = HANDLER.indexOf("broadcastLinksChanged(");
    expect(broadcast).toBeGreaterThan(txEnd);
    expect(HANDLER).toContain("created: result.created");
    expect(HANDLER).toContain("notes: result.notes");
    // 排除发送者这件事下沉到 events 模块（两个生产者共用一份实现）
    expect(HANDLER).toContain("broadcastLinksChanged(event.sender");
    expect(EVENTS).toContain('windowManager.broadcast("novel-links-changed"');
    expect(EVENTS).toContain("windowManager.getNameOf");
    expect(EVENTS).toContain("BrowserWindow.fromWebContents");
  });

  it("main.ts 注册了这条 handler", () => {
    expect(MAIN).toContain("registerNovelGraphHandlers()");
  });
});

describe("反向同步（S4 / W-16）", () => {
  it("主窗口建关系 / 删关系后都广播同一条通道，且排除发送者", () => {
    const add = HANDLERS.indexOf('ipcMain.handle("novel-link-add"');
    const remove = HANDLERS.indexOf('ipcMain.handle("novel-link-remove"');
    expect(add).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(add);

    const addBody = HANDLERS.slice(add, remove);
    const removeBody = HANDLERS.slice(remove, remove + 900);
    expect(addBody).toContain("broadcastLinksChanged(event.sender");
    expect(addBody).toContain("created:");
    expect(removeBody).toContain("broadcastLinksChanged(event.sender");
    expect(removeBody).toContain("removed: [id]");
  });

  it("删关系必须先读出端点再删（novel_links 没有 work_id，删完就查不到本书）", () => {
    const remove = HANDLERS.indexOf('ipcMain.handle("novel-link-remove"');
    const body = HANDLERS.slice(remove, remove + 900);
    const read = body.indexOf("SELECT from_type, from_id FROM novel_links");
    const del = body.indexOf("DELETE FROM novel_links WHERE id = ?");
    expect(read).toBeGreaterThan(-1);
    expect(del).toBeGreaterThan(read);
  });

  it("workId 反查失败不阻断主操作（catch 成 null，广播照发）", () => {
    expect(EVENTS).toContain("export function workIdOfEntity");
    expect(EVENTS).toMatch(/catch\s*\{\s*return null;/);
  });
});

describe("preload 通路", () => {
  it("graphCommit 转发到 novel-graph-commit", () => {
    expect(PRELOAD).toContain("graphCommit: (request: unknown)");
    expect(PRELOAD).toContain("'novel-graph-commit'");
  });

  it("sendTo 支持 raise（「去右栏删除」要把主窗口抬起来，否则看起来像没反应）", () => {
    expect(PRELOAD).toContain("sendTo: (target: string, event: string, data?: unknown, raise?: boolean)");
  });
});
