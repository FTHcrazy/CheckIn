# map.db 数据层规范（地图独立库 + 作品可绑定）

> 状态：**已实施（2.20.0 / B0）**。本文件是活规范，实施后随代码演进改版；
> 落地实现在 `electron/map-db.ts`、`electron/handlers/map-handlers.ts`、
> `src/windows/MapWindow/pages/MapEditorPage/persistence/useMapPersistence.ts`，
> 架构不变量由 `electron/map-db-guard.test.ts` 钉住。
> 输入：[map-vs-reference-interaction-review.md](../review/map-vs-reference-interaction-review.md) §7 R-MAP-28、
> `electron/novel-db.ts`（双库范式先例）、`AGENTS.md` §2.1（SQL 只出现在 db 与 handlers）
> 基线：**2.18.0**（当时地图无任何持久化）

---

## 0. 结论

1. **新建 `map.db`，与 `checkin.db` / `novel.db` 同级**（`user-data/{email-hash}/map.db`），不并入 `novel.db`。
2. **地图是"世界容器"，不是"作品附件"**：`map_docs.work_id` **可空**，先建图、后绑定；解绑不删图；删作品不级联删图。
3. **不建跨库外键**：`map.db` 与 `novel.db` 之间用应用层校验（绑定前查作品是否存在 + 是否已进回收站）。
4. **文档整存**（`doc_json` 单列）+ **版本号乐观锁**，不做字段级拆表 —— 地图文档是一个整体（陆地/区块/素材/地名/样式互相关联），拆表只会让"保存一次改五张表"。
5. **自动保存**（防抖 800ms）+ **关窗 flush** + **回收站软删**，三条一起做，缺一条就会出现"改了半天没了"。

---

## 1. 为什么独立库（三条硬理由）

| 理由 | 说明 |
|---|---|
| **体积** | 地图文档是当前项目里**单条记录最大**的一类数据：陆地多边形 + 600 块区块 + 数百素材实例 + 地名，序列化后通常 **1~8 MB**。塞进 `novel.db` 会让正文读写（每次开章、每次保存）与地图文档共享 WAL 与页缓存，正文明显变慢 |
| **生命周期** | 地图窗口是**独立窗口、即关即销**，lite 版**根本不打包**（`EDITION_WINDOW_ENTRIES`）。独立库可以在 map 窗口未打开时完全不加载，内存与连接成本为零 |
| **演进边界** | 地图 schema 仍在快速变化（`regionSchema` / `MapSubmap` / 要素 / 折线在路上）。独立库允许"清库换代、不做迁移"（与 novel.db 1.33.0 同一策略），不会牵连作品与正文 |

**与 novel.db 的关系**：平级、并列、互不 import。**只有** `electron/db.ts` 的 `registerUserDbLifecycle` 是共用桥。

---

## 2. 目录与开关

```
user-data/{email-hash}/
├─ checkin.db   todo / memo / ledger / checkin / activities / config
├─ novel.db     novel_* 业务表 + novel_pack_* + novel_config + novel_usage_log
└─ map.db       map_docs + map_revisions + map_assets + map_config   ← 新增
```

- 文件：`electron/map-db.ts`（对标 `novel-db.ts`）
- 开关：`switchMapDb(email)` / `getMapDb()` / `isMapDbReady()` / `closeMapDb()`
- 桥接：`registerMapDbBridge()` → `registerUserDbLifecycle({ onSwitched: switchMapDb, onClosed: closeMapDb })`，
  注册时若已有 `getCurrentUserEmail()` 立即补开一次（与 `registerNovelDbBridge` 同范式）。
- **单例**：`map.db` 是主进程单连接，渲染进程永远不碰文件。
- `journal_mode = WAL`、时间戳统一毫秒整数、JSON 一律 TEXT。

---

## 3. 表结构

```sql
-- ── 地图文档（一行 = 一张地图）──
CREATE TABLE IF NOT EXISTS map_docs (
  id             TEXT PRIMARY KEY,          -- mp_<uuid>
  title          TEXT NOT NULL,             -- 地图名（列表展示）
  -- 作品绑定：NULL = 未绑定（独立地图 / 草稿）
  -- 不建外键：跨库无法约束；绑定关系由应用层校验（见 §5）
  work_id        TEXT,
  doc_json       TEXT NOT NULL,             -- MapDocument 全量（land/regions/elements/labels/polylines/style/regionSchema）
  schema_version INTEGER NOT NULL DEFAULT 1,-- 文档结构版本（≠ 当前版本时按 §7 处理）
  rev            INTEGER NOT NULL DEFAULT 0,-- 乐观锁：每次成功写入 +1
  thumb          BLOB,                      -- 列表缩略图（PNG，建议 ≤ 64KB，可为 NULL）
  last_viewport  TEXT,                      -- 上次视口 {x,y,scale}（"回到上次位置"）
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  opened_at      INTEGER,                   -- 最近打开时间（列表排序用，与 updated_at 分开）
  deleted_at     INTEGER                    -- 回收站：NULL = 在架
);
CREATE INDEX IF NOT EXISTS idx_map_docs_work  ON map_docs(work_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_map_docs_order ON map_docs(updated_at DESC);

-- ── 历史版本（可回退到"上一版"）──
-- 只保留最近 N 份（N=10），写入时按 id 顺序裁剪；不存全量历史，避免库膨胀
CREATE TABLE IF NOT EXISTS map_revisions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id     TEXT NOT NULL,
  rev        INTEGER NOT NULL,
  doc_json   TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_map_rev_doc ON map_revisions(doc_id, rev DESC);

-- ── 资源（底图 / 自定义符号）──
-- 本体走文件系统：user-data/{hash}/map-assets/{docId}/{assetId}.png
-- 表里只存索引，避免 BLOB 撑大主库（与既有"图片不进库"的取舍一致）
CREATE TABLE IF NOT EXISTS map_assets (
  id         TEXT PRIMARY KEY,              -- as_<uuid>
  doc_id     TEXT,                          -- NULL = 全局素材（跨图复用）
  kind       TEXT NOT NULL,                 -- 'basemap' | 'sprite'
  file_path  TEXT NOT NULL,                 -- 相对 user-data 的路径
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  meta_json  TEXT,                          -- 作者/来源/prompt（AI 生成需可审计，对齐素材红线）
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_map_assets_doc ON map_assets(doc_id, kind);

-- ── 键值配置（当前地图 id、面板折叠状态等）──
CREATE TABLE IF NOT EXISTS map_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**为什么 `doc_json` 整存**：地图文档内部高度耦合（区块挂子图、素材挂区块、地名挂素材、schema 被生成与手画共用）。拆表后每次编辑要跨 5 张表做事务，且读一份图要 5 次 JOIN —— 收益（局部更新）远小于成本。**真需要局部更新时，用 `rev` 做"整存 + 差异不落库"，因为写入频率只有 800ms 一次。**

---

## 4. IPC 通道契约

> 渲染层只经 `preload.ts` 白名单调用；SQL 只出现在 `handlers/map-handlers.ts` 与 `map-db.ts`。

| 通道 | 入参 | 返回 | 说明 |
|---|---|---|---|
| `map-docs-list` | `{ workId?: string; includeDeleted?: boolean }` | `{ id, title, workId, thumb, rev, createdAt, updatedAt, openedAt, deletedAt }[]` | **列表不返回 `doc_json`**（否则一屏 20 张图拉几十 MB）；`thumb` 为主进程转好的 PNG data URL |
| `map-doc-get` | `{ id }` | `{ id, title, workId, doc, rev, schemaVersion, viewport, corrupt }` | 打开/切换地图；顺带把 `opened_at` 推到最前 |
| `map-doc-create` | `{ title?, workId?, doc? }` | `{ id, rev }` | `doc` 缺省写 `"{}"`，**默认值只由渲染层 `migrateDoc` 补齐**（不在主进程复刻一份） |
| `map-doc-save` | `{ id, doc, baseRev, viewport? }` | `{ ok: true, rev } \| { ok: false, conflict: true, rev }` | **乐观锁**：`baseRev !== 当前 rev` → 拒绝并回传最新 rev |
| `map-doc-flush` | 同上 | 同上 | 关窗**强写**（忽略乐观锁，理由见 §6） |
| `map-doc-rename` | `{ id, title }` | `{ ok, title }` | 返回归一后的标题（渲染层以此更新列表） |
| `map-doc-delete` | `{ id }` | `{ ok }` | **软删**（写 `deleted_at`），可恢复 |
| `map-doc-restore` | `{ id }` | `{ ok }` | 清空 `deleted_at` |
| `map-doc-purge` | `{ id }` | `{ ok }` | 彻底删除（含 `map_revisions`、`map_assets` 行与 `map-assets/{id}/` 目录） |
| `map-doc-bind` | `{ id, workId: string \| null }` | `{ ok: true } \| { ok: false, reason }` | 绑定/解绑；`null` = 解绑 |
| `map-doc-thumb` | `{ id, png: Uint8Array }` | `{ ok }` | 缩略图（渲染层 `extract` 320px 后回传；>256KB 拒收） |
| `map-doc-revisions` | `{ id }` | `{ rev, createdAt }[]` | 历史列表（不含正文） |
| `map-doc-restore-rev` | `{ id, rev }` | `{ ok, rev }` | 回退到某版（生成新 rev，不覆盖历史） |
| `map-work-options` | — | `{ id, name }[]` | 绑定选择器的作品下拉 |
| `map-config-get/set` | `{ key }` / `{ key, value }` | `string \| null` / `boolean` | 键值（为「上次打开的地图」预留） |

> **两处与原计划的偏差（实施后记录，不是欠账）**
> 1. **`map-work-options` 是新增通道**：原计划「复用 novel-handlers 的作品列表」，
>    但现有通道只有 `novel-editor-load`（整本书的卷/章/要素全量，数百 KB）。
>    为拿一个标题拉整本书不值，改为在 map handler 里做一次只读 `SELECT id, name`。
> 2. **`map-config-*` 一并做掉**：`map.db` 已经有 `map_config` 表，接一个键值通道
>    成本极低，省得下次为了"记住上次打开哪张图"再动一次 schema。

---

## 5. 作品绑定语义（关键设计）

| 场景 | 行为 |
|---|---|
| 新建地图不选作品 | `work_id = NULL`，列表归入「未绑定」分区 |
| 地图绑定作品 | `map-doc-bind { id, workId }`；主进程先校验作品存在且 `deleted_at IS NULL`，否则返回 `reason: "work_not_found" / "work_deleted"` |
| 解绑 | `workId: null` → `work_id = NULL`；**不删图、不删内容** |
| 一作品多图 | 允许（`1:N`），符合 v1 PRD R-MAP-01「东洲全图 / 主角出生地详图」 |
| 作品进回收站 | **不动作**。地图 `work_id` 保留；列表侧由渲染层比对作品 `deleted_at`，显示「所属作品在回收站」灰标 |
| 作品被彻底删除 | **不级联删图**。地图降级为未绑定（应用层在作品 purge 后把 `work_id = NULL`），提示「原作品已删除，地图已转为独立地图」 |
| 反向入口 | 作品侧「为本书创建地图」= `map-doc-create { title, workId }`，需 novel 窗口 → map 窗口的上下文投递（沿用 `pack-window-context` 或 `sendTo` 深链范式） |

**为什么不做级联删除**：地图的制作成本远高于"重新绑定"，而误删作品的代价不该由地图承担。回收站兜底 + 降级为独立地图，是可逆的最小损失。

---

## 6. 自动保存与关窗 flush

```
编辑动作（commit 入撤销栈）
   └─ 800ms 防抖
        └─ map-doc-save { id, doc, baseRev }
             ├─ 成功 → rev 更新，内存 baseRev 同步
             └─ 冲突 → 提示「该地图已在别处修改」+ [载入最新] / [覆盖保存]

窗口关闭
   └─ 主进程 close 事件 e.preventDefault()
        ├─ 向渲染层发 map-doc-request-snapshot
        ├─ 收到快照 → map-doc-flush（同步写）→ 超时 1.5s 强制写内存最后一份
        └─ 关闭窗口
```

四条硬约束：

1. **防抖必须"最后一次必写"**：`debounce` 尾部要 flush，不允许"最后一次改动落在防抖窗口里被关窗吃掉"。
2. **`baseRev` 只增不减**：任何一次成功保存后，内存里的 `baseRev` 必须同步为返回值，否则第二次保存必冲突。
3. **关窗兜底**：1.5s 超时后无论如何关窗（宁可丢最后一次，也不允许关不掉窗口）；主进程在 `closed` 时再尝试写一次 `map_config` 的 `last_open_doc`。
4. **不写 `thumb` 到主线程同步路径**：缩略图在渲染层异步 `extract` 后再发 `map-doc-thumb`，失败静默（列表用占位图）。

**保存粒度**：一次 `map-doc-save` 写 `map_docs` + 若 `rev % 10 === 0` 追加一条 `map_revisions`（每 10 版留一档，避免栈被"调参数"吃光）。

---

## 7. 迁移策略

| 场景 | 处理 |
|---|---|
| 首次建库 | `CREATE TABLE IF NOT EXISTS` 全量建表，`map_config.schema_version = 1` |
| 文档结构升级（如加 `regionSchema`、`polylines`） | **不改表**，只升 `doc_json` 内部的 `schemaVersion`；读时 `migrateDoc` 补缺省（沿用现有"未知字段原样保留 + 缺省兜底"策略） |
| 结构大改（如 v1 的 `annotations` → v2 的 `elements`） | `schemaVersion !== CURRENT` → 视为**旧图不可读**，在列表标「旧版本，需重建」；**不写迁移代码**（未上线、个人项目，沿用 novel.db 1.33.0 的"清库换代"口径） |
| 当前已存在的内存地图 | 无（无持久化，无旧数据）→ **零迁移成本**，这是现在动手的最佳时机 |

---

## 8. 实施清单（B0，2.20.0 已交付）

| # | 文件 | 改动 | 状态 |
|---|---|---|---|
| 1 | `electron/map-db.ts` | 建库、开关、`mapAll/mapGet/mapRun/mapExec/mapTransaction`、`registerMapDbBridge`、`getMapAssetsDir` | ✅ |
| 2 | `electron/map-utils.ts` | 纯函数：标题归一 / rev 冲突 / 版本节奏 / 视口解析 / 缩略图 data URL（+ 单测 12 条） | ✅ |
| 3 | `electron/handlers/map-handlers.ts` | §4 全部通道 + 绑定校验 + 软删/恢复/强删 + `map-work-options` | ✅ |
| 4 | `electron/main.ts` | `registerMapDbBridge` → `registerMapHandlers` → `registerMapFlushGuard`（lite 版整组跳过）；`mapWin.on("close")` flush 拦截 + 1.5s 兜底 | ✅ |
| 5 | `electron/preload.ts` + `src/shared/types/electron.d.ts` | `map` 命名空间白名单 + 关窗请求/回执通道 + 全量 DTO | ✅ |
| 6 | `persistence/useMapPersistence.ts` + `store/useMapFileStore.ts` | 启动恢复最近一张（无则新建）/ 800ms 防抖保存 / 冲突三选一 / 关窗 flush / 切图前先存 | ✅ |
| 7 | `components/MapLibraryModal/` | 地图库：缩略图 + 名称 + 更新时间 + 所属作品 + 新建 / 改名 / 删除 / 回收站 / 绑定 | ✅ |
| 8 | `electron/map-db-guard.test.ts` | 源码守卫：三库互不越界、handler 不碰 checkin 写通道、列表不带 `doc_json`、关窗拦截与白名单存在 | ✅ |

**两处与计划的形态偏差**：

- **首屏不做「列表态」**：地图是画布工具，日常路径是「开窗 → 接着上次那张画」。
  首屏列表会让每次使用都多一次点击，而"换一张"是低频动作。改为
  启动直接打开最近一张 + 工具栏常驻「地图库」入口（弹窗）。
- **缩略图按需生成**：不在每次保存时抓（8MB 文档 + 800ms 频率，等于给画布加
  持续抖动），改为「打开地图库前抓一张 320px」+ 关窗时随 flush 一起写。没抓过的图
  在列表里显示占位图标。

**顺序铁律**：1 → 2 → 3 → 4 必须先于 5；否则会出现"渲染层调用了不存在的通道"且错误被吞。

---

## 9. 待确认（实施后仍开放）

1. **缩略图生成时机**：当前"开库前抓一张"，理想是关窗时也抓（走 flush 之后的
   短暂窗口，成本一次 extract）。若列表长期出现占位图，改这里。
2. **历史版本保留份数**：现为 10 份（`MAP_REVISION_KEEP`），每 10 版留一档
   （`MAP_REVISION_EVERY`）。`map_revisions` 暂无 UI 入口（通道已通），B1 之后再考虑"回到上一版"。
3. **`map_assets` 是否首期就做**：表已建、通道未开。B2（素材体系）时启用，
   避免届时再动一次 schema。
4. **删除作品后的降级**：当前 spec 写"作品 purge 后把 `work_id` 置 NULL"，
   该钩子还没接（novel 侧 purge 尚未调用 map 库）。在那之前，列表按
   `workId` 查不到作品名时显示「独立地图」，行为上等价，只是库里留着一个悬空 id。
