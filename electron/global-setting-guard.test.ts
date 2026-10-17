/**
 * 全局设定中心的源码级守卫（1.4x，T01 数据层 + 主进程全局设定域）
 *
 * ⚠️ 只能用源码断言：better-sqlite3 的 native 按 Electron ABI 编译，vitest（node）
 * 下 `require` 直接抛，这里的不变量碰不到真实库（同先例 novel-setting-guard.test.ts）。
 *
 * 覆盖：两张全局表 DDL 幂等；老库增量迁移列；全局 handler 不裸查整表；rank 三件套
 * 两个域同一口径；引用项只读守卫（主进程权威）；引用建立 → 同步 → 固化 三链路；
 * 以及 preload / main 的接线（白名单、注册）。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 读源文件并把行尾统一成 LF。
 *
 * ⚠️ Windows 上 `core.autocrlf=true` 会把签出的工作区文件写成 CRLF，而本文件里有
 * **跨行 SQL 片段**的断言（`UPDATE novel_setting_categories` + `\n` + `SET …`）——
 * 不归一化就是「本机必红、别人机器可能绿」的假失败。守卫钉的是 SQL 语义而非行尾。
 */
const readText = (relative: string): string =>
  readFileSync(resolve(process.cwd(), relative), "utf8").replace(/\r\n/g, "\n");

const DB = readText("electron/novel-db.ts");
const BOOK_HANDLERS = readText("electron/handlers/novel-setting-handlers.ts");
const GLOBAL_HANDLERS = readText(
  "electron/handlers/novel-global-setting-handlers.ts",
);
const SHARED = readText("electron/handlers/novel-setting-shared.ts");
const PRELOAD = readText("electron/preload.ts");
const MAIN = readText("electron/main.ts");
/**
 * 书窗口编辑器数据层（1.45.1 P0-1）：引用实时同步的**订阅侧**落点。
 *
 * ⚠️ 只订阅不刷新（或反过来）都是静默失效：主进程镜像行是对的、书窗口内存快照
 * 是旧的，界面显示旧值且零报错。渲染层这条链路没法用 node 跑起来（要 BrowserWindow
 * 与真实 IPC），所以按本仓「源码路径断言型守卫」的先例钉住落点。
 */
const NOVEL_PAGE_DATA = readText(
  "src/windows/NovelWindow/pages/NovelPage/hooks/useNovelData.ts",
);

/** 去掉注释再匹配：说明文字里会引用被检查的写法，不该算命中 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** 截取某个 ipcMain.handle 通道的回调体（到下一个 `ipcMain.handle` 为止） */
function bodyIn(source: string, channel: string): string {
  const start = source.indexOf(`"${channel}"`);
  if (start < 0) throw new Error(`未找到通道 ${channel}`);
  const next = source.indexOf("ipcMain.handle(", start);
  return source.slice(start, next < 0 ? source.length : next);
}

const bookBody = (channel: string): string => bodyIn(BOOK_HANDLERS, channel);
const globalBody = (channel: string): string => bodyIn(GLOBAL_HANDLERS, channel);

describe("数据层：两张全局表 DDL（D1，幂等）", () => {
  it("全局分类 / 等级表建齐，且与本书表结构对齐（无 work_id）", () => {
    expect(DB).toContain("CREATE TABLE IF NOT EXISTS novel_global_setting_categories");
    expect(DB).toContain("CREATE TABLE IF NOT EXISTS novel_global_setting_levels");
    // 全局设定与任一作品无关：分类表里不应出现 work_id 列
    const tableBlock = DB.slice(
      DB.indexOf("CREATE TABLE IF NOT EXISTS novel_global_setting_categories"),
      DB.indexOf("CREATE TABLE IF NOT EXISTS novel_global_setting_levels"),
    );
    expect(tableBlock).not.toContain("work_id");
  });

  it("索引齐全：排序 + 等级 + 全局 realm 部分唯一索引（兜底并发 / 脚本直写）", () => {
    expect(DB).toContain("CREATE INDEX IF NOT EXISTS idx_novel_global_setting_cat_sort");
    expect(DB).toContain("CREATE INDEX IF NOT EXISTS idx_novel_global_setting_lv_cat");
    expect(DB).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_novel_global_setting_cat_realm",
    );
    expect(DB).toContain("WHERE kind = 'realm'");
  });

  it("老库增量迁移：本书侧补三列（全部可空）+ 两条 source 索引，幂等探测", () => {
    const body = stripComments(DB);
    expect(body).toContain(
      "ALTER TABLE novel_setting_categories ADD COLUMN source_global_id",
    );
    expect(body).toContain(
      "ALTER TABLE novel_setting_categories ADD COLUMN detached_from_name",
    );
    expect(body).toContain(
      "ALTER TABLE novel_setting_levels ADD COLUMN source_global_id",
    );
    // 幂等：pragma 探测列名后才 ADD COLUMN
    expect(body).toContain("table_info(novel_setting_categories)");
    expect(body).toContain("source_global_id");
    expect(body).toContain("CREATE INDEX IF NOT EXISTS idx_novel_setting_cat_source");
    expect(body).toContain("CREATE INDEX IF NOT EXISTS idx_novel_setting_lv_source");
  });
});

describe("全局 handler：不裸查整表 + rank 口径", () => {
  it("全局分类查询不裸查整表（WHERE 写成字面量，不可模板拼接绕过）", () => {
    // 1.4x：readSnapshots 落在共享内核，两个文件一起查（与本书域同口径）
    const naked = `${GLOBAL_HANDLERS}\n${SHARED}`.match(
      /SELECT \* FROM novel_global_setting_categories(?!\s+WHERE)/g,
    );
    expect(naked).toBeNull();
  });

  it("全局等级查询不裸查整表（SELECT * 必带字面量 WHERE，与本书域同口径）", () => {
    // 与本书域同一口径：不裸查整表。按 id / parent_id 定位是合法的，断言只针对
    // 「SELECT * 无 WHERE」这一种写法；book guard 亦只钉这一种。
    // 1.4x：readSnapshots 落在共享内核，两个文件一起查（模板拼接 WHERE 会绕过断言）
    const naked = `${GLOBAL_HANDLERS}\n${SHARED}`.match(
      /SELECT \* FROM novel_global_setting_levels(?!\s+WHERE)/g,
    );
    expect(naked).toBeNull();
  });

  it("rank 三件套两个域同一口径：行数 COUNT(*) / 末尾 maxRank+1 / 中间 rankAt", () => {
    expect(SHARED).toContain("SELECT COUNT(*) AS n FROM novel_global_setting_levels");
    expect(SHARED).toContain(
      "SELECT rank FROM novel_global_setting_levels WHERE category_id = ? ORDER BY rank LIMIT 1 OFFSET ?",
    );
    const body = globalBody("novel-global-setting-level-add");
    expect(body).toContain(
      'at >= total ? maxRank("global", categoryId) + 1 : rankAt("global", categoryId, at)',
    );
  });

  it("全局 realm 全库唯一：新建降级 + 切换时降级原 realm（同事务）", () => {
    expect(GLOBAL_HANDLERS).toContain(
      "const finalKind = wanted === \"realm\" && !hasGlobalRealm() ? \"realm\" : \"custom\";",
    );
    const body = globalBody("novel-global-setting-category-update");
    expect(body).toContain("db.transaction(");
    expect(body).toContain("WHERE kind = 'realm' AND id != ?");
  });
});

describe("引用项只读：主进程权威（D2）", () => {
  it("本书侧每个写通道都有引用只读前置校验", () => {
    for (const channel of [
      "novel-setting-category-update",
      "novel-setting-category-delete",
      "novel-setting-category-order",
      "novel-setting-level-add",
      "novel-setting-level-batch-add",
      "novel-setting-level-update",
      "novel-setting-level-delete",
      "novel-setting-level-order",
      "novel-setting-level-split",
      "novel-setting-level-merge",
    ]) {
      expect(
        bookBody(channel),
        `${channel} 缺少引用项只读守卫`,
      ).toMatch(/isReferencedCategory\(|isLevelInReferencedCategory\(/);
    }
  });

  it("守卫判据是 source_global_id 非空（落库列，UI 只是第二层）", () => {
    expect(SHARED).toContain("function isReferencedCategory");
    expect(SHARED).toContain("function isLevelInReferencedCategory");
    expect(SHARED).toContain("source_global_id AS sid");
  });
});

describe("引用模型：建立 → 同步 → 固化", () => {
  it("建立引用：镜像分类写 source_global_id；等级两趟写入回填 parent_id", () => {
    expect(SHARED).toContain("function referenceGlobal");
    // 分类 INSERT 明确带 source_global_id 与 detached_from_name
    expect(SHARED).toContain("source_global_id, detached_from_name");
    // 两趟写 parent_id
    expect(SHARED).toContain(
      "UPDATE novel_setting_levels SET parent_id = ? WHERE id = ?",
    );
  });

  it("实时同步：按 source_global_id upsert 镜像（id 不变），并清掉全局已删的镜像行", () => {
    expect(SHARED).toContain("function syncReferences");
    // 命中更新 / 未命中插入：都按 source_global_id 定位
    expect(SHARED).toContain("SET name = ?, rank = ?, aliases = ?, note = ?, sub_levels = ?, power = ?");
    // 清理悬空镜像前先摘 novel_links
    expect(SHARED).toContain(
      "DELETE FROM novel_links WHERE to_type = 'level' AND to_id = ?",
    );
  });

  it("固化（D4）：只置空 source_global_id + 写 detached_from_name，novel_links 不动", () => {
    expect(SHARED).toContain("function solidifyReferencesForCategory");
    expect(SHARED).toContain(
      "UPDATE novel_setting_categories\n            SET source_global_id = NULL, detached_from_name = ?",
    );
  });

  it("引用计数按书去重、已脱离（source_global_id 为 NULL）不计入（U4）", () => {
    expect(SHARED).toContain("COUNT(DISTINCT c.work_id)");
    expect(SHARED).toContain("WHERE c.source_global_id IS NOT NULL");
  });

  it("全局删除是二次确认 + 先固化后删除（D4）", () => {
    const body = globalBody("novel-global-setting-category-delete");
    expect(body).toContain("if (confirm !== true) return { ok: false, refCount };");
    expect(body).toContain("solidifyReferencesForCategory(");
    expect(body).toContain("DELETE FROM novel_global_setting_categories WHERE id = ?");
  });

  it("本书域两条通道落在 novel-setting-handlers（写目标含本书镜像行）", () => {
    expect(BOOK_HANDLERS).toContain('"novel-setting-reference-global"');
    expect(BOOK_HANDLERS).toContain('"novel-setting-publish-global"');
    // 上架是复制快照（新建 gsc/gsl），不建立引用
    expect(SHARED).toContain("function publishGlobal");
    expect(SHARED).toContain("createSettingId(\"gsc\")");
  });
});

describe("接线：广播 / preload / main 注册", () => {
  it("每次全局写成功后广播 global-setting-changed（经 windowManager，payload 带 kinds）", () => {
    expect(GLOBAL_HANDLERS).toContain(
      'windowManager.broadcast("global-setting-changed", { kinds })',
    );
    expect(GLOBAL_HANDLERS).toContain('"category" | "level"');
  });

  it("书侧引用 / 上架成功后也广播 global-setting-changed（REQ-041 计数可见），且排除发送窗口防回声", () => {
    // 两条通道的消息体里都必须出现 broadcast 调用（经 notifyGlobalRefsChanged 收口）
    expect(bookBody("novel-setting-reference-global")).toContain(
      "notifyGlobalRefsChanged(event,",
    );
    expect(bookBody("novel-setting-publish-global")).toContain(
      "notifyGlobalRefsChanged(event,",
    );
    // 收口函数本身：同一事件名 + 显式按事件来源窗口名排除（防回声）
    const body = stripComments(BOOK_HANDLERS);
    expect(body).toContain("function notifyGlobalRefsChanged");
    expect(body).toContain(
      'windowManager.broadcast("global-setting-changed", { kinds }, exclude)',
    );
    expect(body).toContain("BrowserWindow.fromWebContents(event.sender)");
    expect(body).toContain("windowManager.getNameOf(senderWin)");
  });

  it("preload：全局设定一族 invoke + send 白名单含 global-setting-window-open", () => {
    expect(PRELOAD).toContain("globalSettingLoad:");
    expect(PRELOAD).toContain("globalCategoryAdd:");
    expect(PRELOAD).toContain("globalLevelSplit:");
    expect(PRELOAD).toContain("referenceGlobal:");
    expect(PRELOAD).toContain("publishGlobal:");
    expect(PRELOAD).toContain("'novel-global-setting-load'");
    expect(PRELOAD).toContain("'global-setting-window-open'");
  });

  it("main.ts 注册全局设定 handler", () => {
    expect(MAIN).toContain("registerNovelGlobalSettingHandlers");
  });

  /**
   * R12 引用方名单：`countGlobalRefs` 只给数字，这条通道负责**反查**被哪几部书引用。
   * 渲染层碰不到 novel 库，所以从渲染层到 SQL 的整条链路只能靠源码钉：
   * 少一处接线 UI 就静静空着，多一点写语句则展示通道变成数据污染源。
   */
  it("preload 接线含只读通道 novel-global-setting-refs", () => {
    expect(PRELOAD).toContain("'novel-global-setting-refs'");
  });

  it("novel-global-setting-refs 是只读通道（不写库）", () => {
    // ⚠️ 先剥注释：说明文字里常照抄 SQL 关键词，不剥会误命中反向断言
    const body = stripComments(globalBody("novel-global-setting-refs"));
    expect(body).not.toMatch(/\bINSERT\b/i);
    expect(body).not.toMatch(/\bUPDATE\b/i);
    expect(body).not.toMatch(/\bDELETE\b/i);
  });
});

describe("书窗口订阅侧：引用镜像就地刷新（1.45.1 P0-1）", () => {
  // 说明文字里会引用被检查的写法，先剥注释再匹配
  const body = stripComments(NOVEL_PAGE_DATA);

  it("书窗口数据层订阅 global-setting-changed（此前只有全局窗口自己订阅）", () => {
    expect(body).toContain("const api = window.electronAPI?.windowAPI;");
    expect(body).toContain('api.on("global-setting-changed", handler)');
  });

  it("退订用同一 handler 引用（preload 的 on/off 按引用配对）", () => {
    // ⚠️ 传新箭头函数等于没摘掉监听，每次重订阅都会多积一条
    expect(body).toContain('api.off("global-setting-changed", handler)');
  });

  it("刷新只重读设定、只换 settings 一张表（不碰 chapters = 正文基线）", () => {
    const start = body.indexOf("const refreshSettingMirror");
    expect(start).toBeGreaterThan(-1);
    const refreshBody = body.slice(start, body.indexOf("useEffect(() => {", start));
    // 只换 settings 一张表：整体重装会把正在编辑的正文基线冲回库内旧值
    expect(refreshBody).toContain("settings: current.settings.map(");
    expect(refreshBody).not.toContain("chapters");
    // 只换「引用态」行：书内自建分类的编辑不受影响
    expect(refreshBody).toContain("category.sourceGlobalId");
    // 重读走元数据通道（includeContent=false），不把全书正文拉一遍
    expect(readText("src/windows/NovelWindow/pages/NovelPage/services/novel-service.ts")).toContain(
      "window.electronAPI!.novel.editorLoad(false)",
    );
  });

  it("跟随判据是「本书真有引用项」，且装载在途时跳过", () => {
    const start = body.indexOf("const handler = (): void => {");
    const handlerBody = body.slice(start, body.indexOf("const api = window.electronAPI", start));
    expect(handlerBody).toContain("sourceGlobalId");
    expect(handlerBody).toContain("loadInFlightRef.current");
  });
});
