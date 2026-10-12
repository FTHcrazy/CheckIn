/**
 * 小说设定模块的源码级守卫
 *
 * 只能用源码断言：better-sqlite3 的 native 按 Electron ABI 编译，vitest（node）
 * 下 `require` 直接抛，这里三条不变量碰不到真实库，只能把「不该再出现的写法」
 * 钉死在源码上。同先例 `novel-pack-save-order.test.ts`。
 *
 * ⚠️ vitest 下 `import.meta.url` 不是 `file:` scheme，必须用 cwd 拼绝对路径。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HANDLERS = readFileSync(
  resolve(process.cwd(), "electron/handlers/novel-setting-handlers.ts"),
  "utf8",
);

/** 截取某个 ipcMain.handle 通道的回调体（到下一个 `ipcMain.handle` 为止） */
function channelBody(channel: string): string {
  const start = HANDLERS.indexOf(`"${channel}"`);
  if (start < 0) throw new Error(`未找到通道 ${channel}`);
  const next = HANDLERS.indexOf("ipcMain.handle(", start);
  return HANDLERS.slice(start, next < 0 ? HANDLERS.length : next);
}

describe("设定模块：写操作必须命中才返回成功", () => {
  const mustHit = [
    ["novel-setting-category-update", "UPDATE novel_setting_categories SET"],
    ["novel-setting-level-update", "UPDATE novel_setting_levels SET"],
  ] as const;

  for (const [channel, sql] of mustHit) {
    it(`${channel} 返回 changes > 0，命中 0 行不再谎报成功`, () => {
      const body = channelBody(channel);
      expect(body).toContain(sql);
      expect(body).toContain(".changes > 0");
      // 两个通道都是「按 patch 拼 SET」，没有任何 patch 时必须判失败而不是 return true
      expect(body).toContain("if (sets.length === 0) return false;");
    });
  }

  it("空名一律判失败：等级项 / 分类名是阶梯的唯一标识，空串会让阶梯出现无名行", () => {
    expect(channelBody("novel-setting-category-update")).toContain(
      "if (!trimmed) return false;",
    );
    expect(channelBody("novel-setting-level-update")).toContain(
      "if (!trimmed) return false;",
    );
  });

  it("kind 切换必须走事务并保证 realm 唯一（1.38.1）：升级为境界体系前先降级同作品原 realm", () => {
    const body = channelBody("novel-setting-category-update");
    // 先按 id 定位所属作品，拿不到行判失败
    expect(body).toContain("SELECT work_id FROM novel_setting_categories WHERE id = ?");
    expect(body).toContain("if (!row) return false;");
    // db.transaction 包裹，降级与升级同事务
    expect(body).toContain("db.transaction(");
    // 升级为 realm 时把同作品其余 realm 降级（id != ? 排除自身）
    expect(body).toContain(
      "WHERE work_id = ? AND kind = 'realm' AND id != ?",
    );
  });
});

describe("设定模块：删除必须按「关联 → 等级项 → 分类」的顺序级联", () => {
  it("删分类：先摘 to_type='level' 的关联，再删等级项，最后删分类", () => {
    const body = channelBody("novel-setting-category-delete");
    const links = body.indexOf("DELETE FROM novel_links");
    const levels = body.indexOf("DELETE FROM novel_setting_levels");
    const categories = body.indexOf("DELETE FROM novel_setting_categories");
    expect(links).toBeGreaterThan(-1);
    // 顺序反了会留悬空引用：等级项删掉后，靠子查询定位的关联就再也找不到目标
    expect(levels).toBeGreaterThan(links);
    expect(categories).toBeGreaterThan(levels);
  });

  it("删等级项：连同它的派生分段（parent_id 指向它的行）一起删", () => {
    const body = channelBody("novel-setting-level-delete");
    expect(body).toContain("DELETE FROM novel_setting_levels WHERE parent_id = ?");
    expect(body).toContain("DELETE FROM novel_setting_levels WHERE id = ?");
  });

  it("合并是拆分的逆操作：删派生段后要把 rank 前移，否则阶梯出现空位", () => {
    const body = channelBody("novel-setting-level-merge");
    expect(body).toContain("DELETE FROM novel_setting_levels WHERE parent_id = ?");
    expect(body).toContain("SET rank = rank - ?");
    expect(body).toContain("SET seg_from = NULL, seg_to = NULL");
  });
});

describe("设定模块：插入与拆分的序号口径", () => {
  it("插入要把落点及之后的 rank 全部 +1（不重排会出现两条同 rank 的行）", () => {
    const body = channelBody("novel-setting-level-add");
    expect(body).toContain("SET rank = rank + 1 WHERE category_id = ? AND rank >= ?");
  });

  it("落点按**行序**换算 rank，不用 max(rank) 当行数 —— 否则「在末尾插入」会插到中间", () => {
    const body = channelBody("novel-setting-level-add");
    // 行数用 COUNT(*)，末尾落点用 max(rank)+1；两者对 rank 空洞的旧数据必须分开算
    expect(HANDLERS).toContain("SELECT COUNT(*) AS n FROM novel_setting_levels");
    expect(HANDLERS).toContain("ORDER BY rank LIMIT 1 OFFSET ?");
    expect(body).toContain("at >= total ? maxRank(categoryId) + 1 : rankAt(categoryId, at)");
    // 回归：旧写法把 max(rank) 的行数语义直接当落点，rank 有空洞时必错
    expect(body).not.toContain("const total = maxRank(categoryId);");
  });

  it("新阶继承分类的小层数与小层命名，不再硬编码 1 层", () => {
    const body = channelBody("novel-setting-level-add");
    expect(body).toContain("SELECT sub_levels, sub_pattern FROM novel_setting_categories");
    expect(body).not.toContain("'[]', '', 1, NULL, NULL, NULL, NULL)");
  });

  it("拆分的第一段复用原 id —— 绑在这一阶上的「当前境界」因此不会失效", () => {
    const body = channelBody("novel-setting-level-split");
    // 第一段走 UPDATE 而不是 INSERT，才是「复用原 id」；
    // 段长要落进 sub_levels（1.37.0 起与渲染层 applySplit 同口径，
    // 否则重载后行囊境界换算把每段当 1 层算错）
    expect(body).toContain("UPDATE novel_setting_levels SET name = ?, seg_from = ?, seg_to = ?, sub_levels = ? WHERE id = ?");
    // 后续段新建并挂 parent_id
    expect(body).toContain("parent_id");
  });
});

describe("设定模块：作品隔离与 realm 唯一性", () => {
  it("所有分类查询都带 work_id 或 category_id 收口，不裸查整表", () => {
    // 不带范围会把另一部小说的设定捞回来，再经 novel-link-set 写出跨作品关联
    const naked = HANDLERS.match(
      /SELECT \* FROM novel_setting_categories(?!\s+WHERE)/g,
    );
    expect(naked).toBeNull();
  });

  it("新建分类时 realm 重复会被降级为 custom，而不是建出第二个境界体系", () => {
    const body = channelBody("novel-setting-category-add");
    expect(body).toContain("kind = 'realm'");
    expect(body).toContain("const finalKind = wanted === \"realm\" && !hasRealm ? \"realm\" : \"custom\";");
  });
});
