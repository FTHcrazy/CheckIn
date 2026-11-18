/**
 * 面试题库 IPC 通道守卫
 *
 * 这些不变量一破就**没有任何报错**，只是数据悄悄错：
 * - purge 少了 `action='new'` → 删掉墓碑后升级会把用户删掉的题复活；
 * - 列表把 payload 带出去 → 一屏几十道题的答案压成几百 KB 的 IPC 载荷；
 * - save 信客户端的 title → 列表显示 A、点开是 B；
 * - handler 自己开库连接 → 切用户时漏关，留下 -wal 残留与半截事务。
 *
 * 用源码断言而不是真跑 sqlite：better-sqlite3 的 native 按 Electron ABI 编译，
 * vitest（node 进程）下 require 直接抛。同先例 `map-db-guard.test.ts`。
 *
 * 规范：docs/spec/interview-db-ai-spec.md §4 / §5.3
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(relative: string): string {
  return readFileSync(path.resolve(process.cwd(), relative), "utf8");
}

const HANDLERS = read("electron/handlers/interview/interview-handlers.ts");
const INTERVIEW_DB = read("electron/interview/interview-db.ts");
const MAIN = read("electron/main.ts");
const PRELOAD = read("electron/preload.ts");
const DTS = read("src/shared/types/electron.d.ts");
const SHAPE = read("src/shared/interview/payload-shape.ts");

/** 契约里的全部通道（§4）。少一条 = 渲染层有按钮但点了没反应 */
const CHANNELS = [
  "interview-items-list",
  "interview-item-get",
  "interview-item-save",
  "interview-item-set-status",
  "interview-item-delete",
  "interview-item-restore",
  "interview-item-purge",
  "interview-item-revert-default",
  "interview-item-ack-base",
  "interview-taxonomy-list",
  "interview-taxonomy-save",
  "interview-taxonomy-delete",
  // 名词匹配负例（右键「这里不是这个词」）：位置级的误命中兜底
  "interview-hint-list",
  "interview-hint-add",
  "interview-hint-remove",
  "interview-export",
  "interview-import",
  "interview-meta-get",
] as const;

/** 取某个 handler 的函数体切片（用下一条通道名当右边界） */
function handlerBlock(channel: string): string {
  const start = HANDLERS.indexOf(`"${channel}"`);
  expect(start, `找不到通道 ${channel}`).toBeGreaterThan(-1);
  const nextChannel = CHANNELS[CHANNELS.indexOf(channel as (typeof CHANNELS)[number]) + 1];
  const end = nextChannel ? HANDLERS.indexOf(`"${nextChannel}"`) : HANDLERS.length;
  return HANDLERS.slice(start, end > start ? end : HANDLERS.length);
}

describe("通道契约（守卫）", () => {
  it("全部通道注册（守卫只认清单，条数变化无需改这里）", () => {
    for (const channel of CHANNELS) {
      expect(HANDLERS, `缺少通道 ${channel}`).toContain(`"${channel}"`);
    }
  });

  it("没有登记之外的通道（渲染层调用会找不到 handler）", () => {
    const declared = [...HANDLERS.matchAll(/ipcMain\.handle\(\s*\n?\s*"([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(new Set(declared)).toEqual(new Set(CHANNELS));
  });

  it("preload 暴露的每个方法都在白名单里（拼错通道名 = 静默 reject）", () => {
    for (const channel of CHANNELS) {
      expect(PRELOAD, `preload 缺少 ${channel}`).toContain(channel);
    }
    expect(PRELOAD).toContain("interview: {");
    expect(DTS).toContain("interview: {");
  });

  it("d.ts 声明了全套 DTO（渲染层没有第二个类型来源）", () => {
    for (const name of [
      "InterviewItemSummaryDTO",
      "InterviewItemDetailDTO",
      "InterviewTaxonomyDTO",
      "InterviewWriteResultDTO",
      "InterviewMetaDTO",
    ]) {
      expect(DTS, `d.ts 缺 ${name}`).toContain(name);
    }
  });
});

describe("写通道必跑结构校验（守卫）", () => {
  it("save 落库前过 payload-shape（挡住手构造与导入的脏 payload）", () => {
    const block = handlerBlock("interview-item-save");
    expect(block).toContain("validatePayloadShape");
  });

  it("set-status 采纳前复检（草稿可能是旧模板产出的，规则变过）", () => {
    const block = handlerBlock("interview-item-set-status");
    expect(block).toContain("payloadStillValid");
  });

  it("结构校验层不 import 任何页面代码（主进程从不 import 渲染层）", () => {
    // 只查真正的 import 语句：文件头注释里会提到 `@/windows` 来说明「为什么不这么做」
    expect(SHAPE).not.toMatch(/from\s+"@\/windows/);
    expect(SHAPE).not.toMatch(/from\s+"\.\.\/\.\.\/windows/);
    expect(HANDLERS).not.toMatch(/from\s+"@\/windows/);
  });

  it("列表标题从 payload 取，不信客户端传的 title（否则列表与详情会打架）", () => {
    expect(HANDLERS).toContain("titleOfPayload");
    const block = handlerBlock("interview-item-save");
    expect(block).toContain("titleOfPayload");
  });
});

describe("COW 语义在 handler 层不许退让（守卫）", () => {
  it("purge 的 SQL 必带 action='new'（否则删墓碑后升级会复活）", () => {
    const block = handlerBlock("interview-item-purge");
    expect(block).toMatch(/DELETE FROM interview_item WHERE id = \? AND action = 'new'/);
  });

  it("打到 override 行时返回 use_restore，让 UI 改叫「还原默认」", () => {
    expect(handlerBlock("interview-item-purge")).toContain("use_restore");
  });

  it("软删拒绝 override 行（基线题删除是写墓碑，不是进回收站）", () => {
    const block = handlerBlock("interview-item-delete");
    expect(block).toContain("use_revert");
    expect(block).toMatch(/action = 'new'/);
  });

  it("revert-default 只删 override 行，基线自然回落", () => {
    const block = handlerBlock("interview-item-revert-default");
    expect(block).toMatch(/DELETE FROM interview_item WHERE id = \? AND action = 'override'/);
    expect(block).toContain("not_overridden");
  });

  it("已存在的行不许改 action（改了会让 base_id=id 与 id LIKE 'u-%' 互相矛盾）", () => {
    const block = handlerBlock("interview-item-save");
    expect(block).toContain("existing.action !== payload.action");
  });

  it("隐藏基线题必须清空 payload（墓碑不许带内容副本）", () => {
    const block = handlerBlock("interview-item-save");
    // payloadJson 以 null 起手，只有「非隐藏」分支才会 JSON.stringify 出内容
    expect(block).toContain("let payloadJson: string | null = null");
    expect(block).toMatch(/if \(isHidden\) \{[\s\S]{0,300}?\} else \{/);
    expect(block).not.toMatch(/if \(isHidden\) \{[\s\S]{0,300}?JSON\.stringify/);
  });
});

describe("载荷体积与通道职责（守卫）", () => {
  it("列表默认返回摘要，只有 withPayload 为真才走 toDetail", () => {
    const block = handlerBlock("interview-items-list");
    // 三目的两支必须各就各位：默认（不含 payload）那一支是 toSummary。
    // 如果哪天有人把两支写反，一屏列表会悄悄带上几百 KB 的答案。
    expect(block).toMatch(/\? rows\.map\(toDetail\) : rows\.map\(toSummary\)/);
    expect(block).toContain("withPayload?: boolean");
  });

  it("preload 与 d.ts 都接受 withPayload（类型不收，合并视图拿不到详情）", () => {
    expect(PRELOAD).toContain("withPayload?: boolean");
    expect(DTS).toContain("withPayload?: boolean");
    // 详情重载：传 withPayload: true 时类型是 InterviewItemDetailDTO[]
    expect(DTS).toContain("withPayload: true");
  });

  it("payload 解析走 parseJson 兜底（坏一条不该让整页炸）", () => {
    expect(HANDLERS).toContain("function parseJson");
    expect(handlerBlock("interview-item-get")).toContain("toDetail");
  });
});

describe("数据访问边界（守卫）", () => {
  it("只用 interview-db 的封装，不碰 checkin.db 的写通道", () => {
    expect(HANDLERS).not.toMatch(/from\s+"\.\.\/\.\.\/core\/db"/);
    expect(HANDLERS).toMatch(/from\s+"\.\.\/\.\.\/interview\/interview-db"/);
  });

  it("不自己开库（切用户时会漏关，留下悬空连接）", () => {
    expect(HANDLERS).not.toContain("better-sqlite3");
    expect(HANDLERS).not.toContain("new Database(");
  });

  it("未就绪时读通道返回空、写通道返回 not_ready（不抛错）", () => {
    expect(HANDLERS).toContain("isInterviewDbReady");
    expect(HANDLERS).toContain('code: "not_ready"');
  });

  it("词条改动才 bump 词条版本（其余写入不该让行内词表重建）", () => {
    expect(HANDLERS).toContain('kind === "glossary" ? bumpGlossaryVersion()');
    expect(INTERVIEW_DB).toContain("glossary_version");
  });
});

describe("导出 / 导入（守卫）", () => {
  const TRANSFER = read("electron/interview/interview-transfer.ts");

  it("文件读写走 dialog + fs，不引入新依赖", () => {
    const exportBlock = handlerBlock("interview-export");
    const importBlock = handlerBlock("interview-import");
    expect(exportBlock).toContain("showSaveDialog");
    expect(importBlock).toContain("showOpenDialog");
    expect(exportBlock).toContain("fs.writeFileSync");
    expect(importBlock).toContain("fs.readFileSync");
  });

  it("full 模式的基线快照由渲染层传（主进程读不到题库常量）", () => {
    expect(handlerBlock("interview-export")).toContain("baselineItems");
    // 主进程侧不许出现对基线常量的 import
    expect(HANDLERS).not.toMatch(/from\s+"[^"]*InterviewPage/);
  });

  it("整包闸门先跑 validateExportDocument（format / schemaVersion 不对就整包拒绝）", () => {
    const block = handlerBlock("interview-import");
    expect(block).toContain("validateExportDocument");
    expect(block).toMatch(/validateExportDocument[\s\S]{0,200}checked\.ok/);
  });

  it("逐条分流交给纯函数 planImport（三分流与冲突策略不写进 IPC 回调）", () => {
    expect(handlerBlock("interview-import")).toContain("planImport");
    expect(TRANSFER).toContain('entry.action === "baseline"');
  });

  it("replace 只软删 action='new' 的行（override / hidden 是用户编辑，不许动）", () => {
    const block = handlerBlock("interview-import");
    expect(block).toMatch(/UPDATE interview_item SET status = 'deleted', deleted_at = \?, updated_at = \? WHERE action = 'new'/);
  });

  it("replace 后同一份文件能再导一次：被软删的 id 走 UPDATE 复活而不是 INSERT", () => {
    const block = handlerBlock("interview-import");
    expect(block).toContain("wipedIds");
    expect(block).toContain("revived");
  });

  it("导入整体包在一个事务里（失败整批回滚，不留半截数据）", () => {
    expect(handlerBlock("interview-import")).toContain("interviewTransaction");
  });

  it("导入成功才记 last_import_at / last_export_at", () => {
    expect(handlerBlock("interview-export")).toContain("lastExportAt");
    expect(handlerBlock("interview-import")).toContain("lastImportAt");
  });

  it("孤儿不许静默丢弃（结果里必须带 orphaned）", () => {
    expect(handlerBlock("interview-import")).toContain("orphaned");
    expect(TRANSFER).toContain("plan.orphaned.push");
  });
});

describe("主进程接线（守卫）", () => {
  it("handler 在 bridge 之后注册（否则首个请求打到未打开的库）", () => {
    const bridge = MAIN.indexOf("registerInterviewDbBridge();");
    const handlers = MAIN.indexOf("registerInterviewHandlers();");
    expect(bridge).toBeGreaterThan(-1);
    expect(handlers).toBeGreaterThan(bridge);
  });
});
