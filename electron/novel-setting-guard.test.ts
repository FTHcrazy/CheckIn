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

/**
 * 1.4x：本书域 / 全局域共用的内核（rank 三件套、引用模型、只读守卫）。
 * 两个域列名与口径一致，工具下沉到这里 —— 断言口径也要跟着读这个文件。
 */
const SETTING_SHARED = readFileSync(
  resolve(process.cwd(), "electron/handlers/novel-setting-shared.ts"),
  "utf8",
);

/** 全局域 handler：与本书域同一套 rank / 拆分口径，拆分层级守卫要一起钉住 */
const GLOBAL_HANDLERS = readFileSync(
  resolve(process.cwd(), "electron/handlers/novel-global-setting-handlers.ts"),
  "utf8",
);

/** 截取某个 ipcMain.handle 通道的回调体（到下一个 `ipcMain.handle` 为止） */
function channelBody(channel: string, source: string = HANDLERS): string {
  const start = source.indexOf(`"${channel}"`);
  if (start < 0) throw new Error(`未找到通道 ${channel}`);
  const next = source.indexOf("ipcMain.handle(", start);
  return source.slice(start, next < 0 ? source.length : next);
}

/** 去掉注释再匹配：说明文字里会引用被改掉的写法，不该算命中 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
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
    // 行数用 COUNT(*)，末尾落点用 max(rank)+1；两者对 rank 空洞的旧数据必须分开算。
    // 1.4x：rank 三件套按域参数化后落在共享内核（本书 / 全局同一口径）。
    expect(SETTING_SHARED).toContain("SELECT COUNT(*) AS n FROM novel_setting_levels");
    expect(SETTING_SHARED).toContain("ORDER BY rank LIMIT 1 OFFSET ?");
    expect(body).toContain(
      'at >= total ? maxRank("book", categoryId) + 1 : rankAt("book", categoryId, at)',
    );
    // 回归：旧写法把 max(rank) 的行数语义直接当落点，rank 有空洞时必错
    expect(body).not.toContain("const total = maxRank(categoryId);");
  });

  it("新阶继承分类的小层数与小层命名，不再硬编码 1 层", () => {
    const body = channelBody("novel-setting-level-add");
    // 钉语义不钉一行：SQL 后续可能加 carry_dir 等列（2.17.1），
    // 只要还从分类行取这两个字段就算没退化
    expect(body).toMatch(/SELECT[\s\S]{0,80}sub_levels[\s\S]{0,40}sub_pattern[\s\S]{0,40}FROM novel_setting_categories/);
    expect(body).not.toContain("'[]', '', 1, NULL, NULL, NULL, NULL)");
  });

  it("批量新增与单条同口径：等级说明写入、小层数回落分类默认（两个域）", () => {
    const channels = [
      ["novel-setting-level-batch-add", HANDLERS],
      ["novel-global-setting-level-batch-add", GLOBAL_HANDLERS],
    ] as const;
    for (const [channel, source] of channels) {
      const body = stripComments(channelBody(channel, source));
      // AI 排阶梯会给每级一句说明：候选里看得见，落库就必须跟着走
      expect(body).toMatch(/note:\s*typeof item\?\.note === "string"/);
      // 未显式给出小层时回落到**分类默认**，不是硬编码 1（「每阶小三层」的体系
      // 批量加进来的阶会缺小层，与单条新增不一致）
      expect(body).toContain("categorySubLevels");
      expect(body).not.toMatch(/subLevels:\s*1\s*,/);
      // INSERT 的说明占位用 item.note，不是空串
      expect(body).toContain("item.note");
      expect(body).not.toContain("'[]', '', ?, NULL, NULL, NULL, NULL)");
    }
  });

  it("批量追加落到**显示末尾**：desc 下现有整体上移、条目整块反转（两个域）", () => {
    const channels = [
      ["novel-setting-level-batch-add", HANDLERS],
      ["novel-global-setting-level-batch-add", GLOBAL_HANDLERS],
    ] as const;
    for (const [channel, source] of channels) {
      const body = stripComments(channelBody(channel, source));
      // desc：显示末尾是 rank 最小的一端 ⇒ 先整体上移，新条目占住低端
      expect(body).toContain("SET rank = rank + ?");
      // 反转只在**已有阶梯**时做：空阶梯整块就是全部内容，反转会把强弱颠倒
      expect(body).toMatch(/isDesc && total > 0 \? \[\.\.\.cleaned\]\.reverse\(\) : cleaned/);
      expect(body).toContain("for (const item of ordered)");
    }
  });

  it("拆分（1.38.1）：原阶降级为分组、id 不变 —— 绑在这一阶上的「当前境界」不失效", () => {
    const body = channelBody("novel-setting-level-split");
    /*
      1.38.1 起父阶是**纯分组**：自己不占任何小层段。原阶那一行保留 id、
      把 seg_from / seg_to 置 NULL、sub_levels 落**整阶总数**；各段全部新建
      行并挂 parent_id。

      「绑定不失效」这条意图因此更强：绑定统一落 (根阶, note.sub)，而根阶
      正是原阶那一行、id 没动 —— 拆分前后「当前境界」指的是同一个阶，
      只是进度改由 note.sub 表达，不再依赖某个段 id 是否存在。
    */
    expect(body).toContain(
      "UPDATE novel_setting_levels SET seg_from = NULL, seg_to = NULL, sub_levels = ? WHERE id = ?",
    );
    // 各段新建：段长落 sub_levels，段区间落 seg_from / seg_to，全部挂 parent_id
    expect(body).toContain("parent_id, seg_from, seg_to, sub_pattern");
    // 反面：不许退回「第一段复用原 id、父阶自己占第一段」的旧模型
    expect(stripComments(body)).not.toContain(
      "UPDATE novel_setting_levels SET name = ?, seg_from = ?, seg_to = ?, sub_levels = ? WHERE id = ?",
    );
  });

  it("拆分只允许根阶：子层级（parent_id 非空）不能再拆，否则出现三层嵌套（1.39.1）", () => {
    const body = channelBody("novel-setting-level-split");
    // 行必须把 parent_id 查出来，才能判「是不是子层级」
    expect(body).toContain(
      "SELECT category_id, rank, sub_pattern, parent_id FROM novel_setting_levels WHERE id = ?",
    );
    // 权威拒绝：子层级再拆即造出「初级·第1段·第1段」第三层
    expect(body).toContain("if (row.parent_id !== null) return false;");
  });

  it("全局域同口径：拆分只允许根阶，子层级不能再拆（1.39.1）", () => {
    const body = channelBody("novel-global-setting-level-split", GLOBAL_HANDLERS);
    expect(body).toContain(
      "SELECT category_id, rank, sub_pattern, parent_id FROM novel_global_setting_levels WHERE id = ?",
    );
    expect(body).toContain("if (row.parent_id !== null) return false;");
  });

  it("拆分拒绝已有子行的根阶：组阶继续拆只会再造第二层（1.4x 收口）", () => {
    const body = channelBody("novel-setting-level-split");
    // 必须在 parent_id 校验之后，再查「有没有行挂在本行下」并据此拒绝
    expect(body).toContain(
      "SELECT COUNT(*) AS count FROM novel_setting_levels WHERE parent_id = ?",
    );
    expect(body).toContain("if (childCount.count > 0) return false;");
  });

  it("全局域同口径：拆分拒绝已有子行的根阶（1.4x 收口）", () => {
    const body = channelBody("novel-global-setting-level-split", GLOBAL_HANDLERS);
    expect(body).toContain(
      "SELECT COUNT(*) AS count FROM novel_global_setting_levels WHERE parent_id = ?",
    );
    expect(body).toContain("if (childCount.count > 0) return false;");
  });
});

describe("设定模块：作品隔离与 realm 唯一性", () => {
  it("所有分类查询都带 work_id 或 category_id 收口，不裸查整表", () => {
    // 不带范围会把另一部小说的设定捞回来，再经 novel-link-set 写出跨作品关联。
    // 1.4x：本书查询部分下沉到共享内核，两个文件一起查（模板拼接 WHERE 会绕过断言）
    const naked = `${HANDLERS}\n${SETTING_SHARED}`.match(
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
