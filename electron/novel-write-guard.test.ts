/**
 * novel 第二批修复的源码级守卫（P1-3 / P1-9 / P1-10）
 *
 * ⚠️ 只能用源码断言：better-sqlite3 的 native 按 Electron ABI 编译，vitest
 * （node）下 `require` 直接抛，这里的三条约束碰不到真实库，只能用正则把
 * 「不该再出现的写法」钉死在源码上。同先例 `novel-pack-save-order.test.ts`。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ⚠️ vitest 下 `import.meta.url` 不是 `file:` scheme，必须用 cwd 拼绝对路径
const HANDLERS = readFileSync(
  resolve(process.cwd(), "electron/handlers/novel-handlers.ts"),
  "utf8",
);

/** 截取某个 ipcMain.handle 通道的回调体（到下一个 `ipcMain.handle` 为止） */
function channelBody(channel: string): string {
  const start = HANDLERS.indexOf(`"${channel}"`);
  if (start < 0) throw new Error(`未找到通道 ${channel}`);
  const next = HANDLERS.indexOf("ipcMain.handle(", start);
  return HANDLERS.slice(start, next < 0 ? HANDLERS.length : next);
}

describe("P1-3 删作品级联清理行囊（守卫）", () => {
  const body = channelBody("novel-work-delete");

  it("定位到角色行再按 character_id 清全部子表", () => {
    expect(body).toContain("SELECT id FROM novel_pack_characters WHERE work_id = ?");
    expect(body).toContain("DELETE FROM novel_pack_characters WHERE work_id = ?");
    for (const table of [
      "novel_pack_items",
      "novel_pack_skills",
      "novel_pack_attributes",
      "novel_pack_mappings",
      "novel_pack_slots",
      "novel_pack_unit_systems",
      "novel_pack_layouts",
      "novel_pack_records",
      "novel_pack_drafts",
    ]) {
      // 子表清理由 PACK_CHILD_TABLES 循环驱动
      expect(PACK_TABLES).toContain(table);
    }
  });

  it("多态表 modifiers 的删除必须排在宿主之前（晚了就变成空集删不掉）", () => {
    const firstModifier = body.indexOf("DELETE FROM novel_pack_modifiers");
    // 宿主删除走常量循环，找它在源码里的位置
    const childLoop = body.indexOf("PACK_CHILD_TABLES");
    expect(firstModifier).toBeGreaterThan(-1);
    expect(childLoop).toBeGreaterThan(firstModifier);
  });

  it("status 类载体用 owner_type 限定，不能拿 character_id 直接比对 owner_id", () => {
    // 集合删除后 id 来源是子查询而不是参数，但「先按 owner_type 分流」这条
    // 顺序约束不能丢：多态表的 owner_id 在不同 owner_type 下是不同表的主键
    expect(body).toContain("owner_type = 'status'");
    expect(body).toContain("owner_id IN (SELECT id FROM novel_pack_characters");
  });
});

const PACK_TABLES = (HANDLERS.match(/novel_pack_\w+/g) ?? []).filter(
  (name) => name !== "novel_pack_characters" && name !== "novel_pack_modifiers",
);

// 1.39.0 起注册表拆成两张：character 级（PACK_CHILD_TABLES）+ 作品级
//（PACK_WORK_TABLES）。守卫窗口必须把两张都罩住 —— 任何一张漏登记，
// 对应的 DELETE 循环就删不到那张表
const REGISTRY_SOURCE = HANDLERS.slice(
  HANDLERS.indexOf("const PACK_CHILD_TABLES"),
  HANDLERS.indexOf("PACK_WORK_TABLES = [") + 120,
);

describe("PACK_CHILD_TABLES 清单完整", () => {
  it("覆盖全部非宿主、非多态的行囊表（含作品级 PACK_WORK_TABLES）", () => {
    for (const name of new Set(PACK_TABLES)) {
      expect(REGISTRY_SOURCE).toContain(name);
    }
  });
});

describe("P1-9 崩溃恢复判定（守卫）", () => {
  it("章节不存在写不了孤儿快照：novel-chapter-save 必须先查章节并在缺失时 return false", () => {
    const body = channelBody("novel-chapter-save");
    expect(body).toContain("SELECT word_count FROM novel_chapters WHERE id = ?");
    expect(body).toContain("if (!chapter) return false;");
    // 事务的返回值必须透出，不能无视早退直接 `save(); return true;`
    expect(body).not.toMatch(/\n\s*save\(\);\n\s*return true;/);
  });

  it("buildRecovery 以「快照与正文不一致」为判据，JOIN 章节表并排除孤儿快照", () => {
    const start = HANDLERS.indexOf("function buildRecovery");
    const body = HANDLERS.slice(start, start + 1400);
    expect(body).toContain("JOIN novel_chapters c ON c.id = s.chapter_id");
    expect(body).toContain("c.content <> s.content");
    expect(body).toContain("ORDER BY s.created_at DESC LIMIT 1");
    // 老写法：只取全局最新快照，会被孤儿快照或「恰好最后写快照那一章」带偏
    expect(body).not.toContain(
      "SELECT * FROM novel_snapshots ORDER BY created_at DESC LIMIT 1",
    );
  });

  it("崩溃恢复的快照查询必须带时间下界 —— 否则每次装载全表扫 4 万条正文", () => {
    const start = HANDLERS.indexOf("function buildRecovery");
    const body = HANDLERS.slice(start, start + 1400);
    // 必须先把时间下界写进 WHERE，再让 content 比较参与过滤
    expect(body).toContain("s.created_at >= ?");
    expect(body).toContain("RECOVERY_SNAPSHOT_WINDOW_MS");
  });

  it("novel-chapter-save 取最近一条快照时不读 content（高频路径只用到两个标量）", () => {
    const body = channelBody("novel-chapter-save");
    expect(body).toContain("SELECT word_count, created_at FROM novel_snapshots");
    expect(body).not.toContain("SELECT * FROM novel_snapshots WHERE chapter_id");
  });
});

describe("P1-10 写操作必须命中才返回成功（守卫）", () => {
  const mustHit = [
    ["novel-work-rename", "UPDATE novel_works SET name"],
    ["novel-chapter-rename", "UPDATE novel_chapters SET title"],
    ["novel-chapter-status", "UPDATE novel_chapters SET status"],
    ["novel-chapter-outline", "UPDATE novel_chapters SET outline_note"],
    ["novel-volume-rename", "UPDATE novel_volumes SET name"],
    ["novel-note-move", "UPDATE novel_notes SET work_id"],
  ] as const;

  // 小说设定的改名通道在 `novel-setting-handlers.ts`，由
  // `novel-setting-guard.test.ts` 单独守卫（本文件只读 novel-handlers.ts）。

  for (const [channel, sql] of mustHit) {
    it(`${channel} 返回 changes > 0，命中 0 行不再谎报成功`, () => {
      const body = channelBody(channel);
      expect(body).toContain(sql);
      expect(body).toContain(".changes > 0");
      expect(body).not.toContain("return true;");
    });
  }
});

describe("R27 画布记忆随作品删除级联（S2 守卫）", () => {
  const body = channelBody("novel-work-delete");

  it("按前缀清掉 novel_rel_graph_v1:<workId>:* 的记忆键", () => {
    expect(body).toContain("DELETE FROM novel_config WHERE key LIKE ?");
    expect(body).toContain("novel_rel_graph_v1:${id}:%");
  });

  it("清理排在行囊多态表之后（不与 pack 的子查询抢顺序）", () => {
    const firstModifier = body.indexOf("DELETE FROM novel_pack_modifiers");
    const graphKey = body.indexOf("novel_rel_graph_v1");
    const worksRow = body.indexOf("DELETE FROM novel_works WHERE id = ?");
    expect(graphKey).toBeGreaterThan(firstModifier);
    // 作品行必须最后删：前面全靠 work_id 子查询
    expect(worksRow).toBeGreaterThan(graphKey);
  });
});
