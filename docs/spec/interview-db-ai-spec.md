# 面试题库独立库 + AI 拓展规范（interview.db）

> 状态：**草案**（待实施，B0 批次）
> 输入：[map-db-spec.md](map-db-spec.md)（独立库范式）、[AGENTS.md](../../AGENTS.md) §2.1、现行 AI 基建 `prompt/{registry,collector,sections}.ts`
> 基线：243 题 / 24 图 / 约 100 词条 / 22 静态分类 / 16 知识主题 / 17 个 seed 文件（源码 322 KB）
> 代码落点：`electron/interview/`、`src/shared/interview/`、`pages/InterviewPage/persistence/`、
> `src/shared/ai/context/prompt/domains/`

---

## 0. 结论

1. **新建第四本库 `interview.db`**，只存**用户增量**（AI 产出、手工编辑、划词词条、导入内容、自定义分类）；243 题 / 100 词条 / 24 图 / 22 分类继续留在源码作**只读基线**。
2. **写时复制（COW）**：基线常驻源码只读，**用户动哪道才复制哪道**（编辑生成 `override` 行、删除生成 `hidden` 墓碑）。因此基线题**可以改、可以删**，而未动过的题永远跟随版本更新 —— 升级 = 换常量，不是用户数据迁移。
3. **合并视图**：渲染层永远读「基线 ∪ 增量」的合并结果。**基线是默认值，`override` 优先**（不是「基线优先」）；`hidden` 的题不出现且升级不复活。
4. **一键导出/导入**：`delta`（只导增量，几 KB，用于换机/分享）与 `full`（含基线快照，用于完整备份）双形态，`id` / `created_at` / `origin` / **覆盖关系**原样往返。

---

## 1. 为什么独立库

| 理由 | 说明 |
|---|---|
| **写频与隔离** | 划词转词条是高频小写入（一次划词 = 1 条 INSERT）。挂在 `checkin.db` 会让待办/日程与题库增量共享 WAL 与页缓存 |
| **可整包搬运** | 「一键导出导入」在独立库下有第二条路径：直接复制 `interview.db`（含索引与状态机）。localStorage / 内存 overlay 做不到 |
| **schema 演进边界** | taxonomy 与产物表仍在首次落地，允许「清库换代、不写迁移」（与 novel.db 1.33.0、map.db 同策略），不牵连三本既有库 |
| **lifecycle 成本实测为低** | `registerUserDbLifecycle` 只是回调集合的加删（`core/db.ts:37`），照抄 `novel-db.ts` 骨架即可，**不动 `core/db.ts` 一行** |
| **与 map.db 的差异** | map.db 是「作品级」数据（库内即全部，删作品才删图）；interview.db 是「基线 + 个人增量」的叠加层（库内只是 delta，基线在源码）。所以本库**不做** `work_id` 绑定，也**不承担**「导出即可完整迁移」的承诺——`full` 模式导出的是「基线快照 + 增量」的只读副本，导入端只接 `u-` 前缀条目 |

**体量不作为理由**：seed 源码 322 KB，`delta` 增量通常几 KB，`full` 导出约 300 KB 量级。取舍依据是「谁是用户资产、谁随版本走」，不是体积。

**与上一版方案的差异**：早前结论是「增量挂 `checkin.db` 的 overlay 表、不建第四本库」，理由是避免动 lifecycle 与三库守卫。该理由作废 —— 用户已接受成本，且「一键导出导入」是更硬的第二理由。三库守卫的**语义**从「只有三本」改为「四本互不越界」。

---

## 2. 目录与生命周期

```
user-data/{email-hash}/
├─ checkin.db     todo / memo / ledger / checkin / activities / config
├─ novel.db       novel_* + novel_pack_* + novel_config
├─ map.db         map_*
└─ interview.db   interview_item + interview_taxonomy + interview_meta   ← 新增
```

- 文件：`electron/interview/interview-db.ts`（对标 `novel-db.ts`）
- 导出：`switchInterviewDb(email)` / `getInterviewDb()` / `isInterviewDbReady()` / `closeInterviewDb()`
- 桥接：`registerInterviewDbBridge()` → `registerUserDbLifecycle({ onSwitched, onClosed })`；注册时若 `getCurrentUserEmail()` 已有值，**立即补开一次**（与 novel 桥同处理，否则首启无库）。
- 单连接在主进程；渲染进程永不碰文件。`journal_mode = WAL`，时间戳统一**毫秒整数**，JSON 一律 TEXT。
- 与 `ai.db` **平级、互不 import**：`interview_item.ai_log_id` 只存整数，跨库按值引用、不建外键。

---

## 3. 表结构

```sql
-- ── 内容产物：题 / 词条 / 图解三类共用，差异全在 payload_json ──
CREATE TABLE IF NOT EXISTS interview_item (
  id             TEXT PRIMARY KEY,              -- 见下方「id 硬规则」
  kind           TEXT NOT NULL,                 -- question | glossary | diagram
  action         TEXT NOT NULL DEFAULT 'new',   -- new（用户自建）| override（作用于基线某条）
  base_id        TEXT,                          -- override：必须 = id（基线 id）；new：NULL
  status         TEXT NOT NULL DEFAULT 'draft', -- draft | adopted | rejected | hidden | deleted
  origin         TEXT NOT NULL,                 -- ai | manual | seed-import（往返原样保留）
  category_id    TEXT,                          -- u-c-… 或 22 个基线 id；图解为 NULL
  track          TEXT,                          -- written | foundation；图解为 NULL
  title          TEXT NOT NULL,                 -- 列表与去重用；hidden 行也存基线 title
  payload_json   TEXT,                          -- hidden 行为 NULL；override / new 必须非空
  base_stamp     TEXT,                          -- 覆盖时基线题的 updatedAt（"你基于 2026-01 版修改"）
  base_hash      TEXT,                          -- 覆盖时基线 payload 指纹（判「基线已更新」）
  ack_base_hash  TEXT,                          -- 用户点过「沿用我的」时的指纹（抑制重复提示）
  errors_json    TEXT,                          -- 采纳前校验 errors（draft 也落，供红字展示）
  source_intent  TEXT,                          -- interviewDraft:question 等，与 ai_event 口径一致
  ai_log_id      INTEGER,                       -- ai.db.ai_log.id（按值引用）
  reviewed_at    INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  deleted_at     INTEGER,                       -- 回收站：NULL = 在架
  CHECK (action IN ('new','override')),
  CHECK (status IN ('draft','adopted','rejected','hidden','deleted')),
  CHECK (action <> 'override' OR base_id IS NOT NULL),
  CHECK (action <> 'override' OR base_id = id),
  CHECK (action <> 'new'      OR base_id IS NULL),
  CHECK (action <> 'new'      OR id LIKE 'u-%'),
  CHECK (status <> 'hidden'   OR (action = 'override' AND payload_json IS NULL)),
  CHECK (status <> 'deleted'  OR action = 'new'),
  CHECK (action <> 'override' OR payload_json IS NOT NULL OR status = 'hidden')
);
CREATE INDEX IF NOT EXISTS idx_item_action_status ON interview_item(action, status);
CREATE INDEX IF NOT EXISTS idx_item_base          ON interview_item(base_id);
CREATE INDEX IF NOT EXISTS idx_item_kind_status   ON interview_item(kind, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_item_category      ON interview_item(category_id, status);

-- ── 分类体系：只存新增分类，不镜像 22 个基线 ──
CREATE TABLE IF NOT EXISTS interview_taxonomy (
  id          TEXT PRIMARY KEY,               -- u-c-<slug>，与基线字面量不可能重合
  label       TEXT NOT NULL,                  -- 侧栏展示名（≤12 字）
  track       TEXT NOT NULL,                  -- 只能挂 written / foundation 之一
  order_no    INTEGER NOT NULL,               -- 基线之后续排（>= 100）
  status      TEXT NOT NULL DEFAULT 'draft',  -- draft | adopted（仅 adopted 进侧栏）
  origin      TEXT NOT NULL,
  note        TEXT,                           -- 一句话「这块考什么」
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_taxonomy_track ON interview_taxonomy(track, status, order_no);

-- ── 名词匹配负例：用户右键「这里不是这个词」的位置级判定 ──
-- 词表匹配是纯文本的（「字节流」里的「节流」会命中），中文没有分词器判不出对错，
-- 所以把判定权交给用户：存**位置**而不是删词条/删别名 ——
-- 同一段文字在别处出现时该词条照常可点。
CREATE TABLE IF NOT EXISTS interview_match_hint (
  id         TEXT PRIMARY KEY,   -- u-n-*
  term_id    TEXT NOT NULL,      -- 被解除的词条 id（基线 id 或 u-）
  key        TEXT NOT NULL,      -- 当时命中的键（小写归一）
  left_text  TEXT NOT NULL,      -- 命中左侧最多 6 字
  right_text TEXT NOT NULL,      -- 命中右侧最多 6 字
  created_at INTEGER NOT NULL,
  UNIQUE (term_id, key, left_text, right_text)  -- 同一处解除两次不留两行
);
CREATE INDEX IF NOT EXISTS idx_hint_term ON interview_match_hint(term_id);

-- ── 库级元信息 ──
CREATE TABLE IF NOT EXISTS interview_meta (
  key        TEXT PRIMARY KEY,  -- schema_version | baseline_version | last_import_at | last_export_at
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

**id 硬规则（决定用户收藏是否存活）**

| 行类型 | `id` | 为什么 |
|---|---|---|
| 用户新建 | `u-q-*` / `u-g-*` / `u-d-*` | 与基线 id 空间隔离，纯新增 |
| **覆盖基线题 / 隐藏基线题** | **等于基线 id**（如 `js-event-loop`） | 收藏是 `localStorage` 里的 `string[]`（`favorites-storage.ts`，`QuestionCard` 直接 `onToggleFavorite(question.id)`）。换 id = 用户收藏全丢。`id` 同时是 React `key` 与 `expandedId` 标识 |
| 词条 / 图解覆盖 | 同上，**不许换 id** | 词条 id 被 `related` 引用、图解 id 被 `diagramId` 引用，换 id 会制造悬空引用 |

**状态语义矩阵（一个用户动作只对应一个合法状态）**

| 用户动作 | 行 | 后效 |
|---|---|---|
| 编辑基线题 | `action='override'`, `id=base_id`, `status='adopted'`, 存 `base_stamp`/`base_hash` | 显示我的版本；基线已变则打「基线已更新」标 |
| 删除基线题 | `action='override'`, `id=base_id`, `status='hidden'`, `payload_json=NULL` | 该题不出现，**升级不复活** |
| 还原默认 | **删除该行** | 合并时自然回落到基线，无需特殊逻辑 |
| 删除我自己的题 | `action='new'`, `status='deleted'`, `deleted_at` | 进回收站，可 purge |
| AI 草稿 | `action='new'`, `status='draft'` | 只在草稿箱 / 工作台 |

**为什么 3 张内容表 + 1 张匹配负例表**：切分依据是**读法**不是类型。题 / 词条 / 图的访问模式同构（按 `kind+status` 翻列表、按 `id` 取一条、按 `status='adopted'` 全量导出），合成 `interview_item` 可避免 40+ 列大宽表。taxonomy 单独建是因为它**被引用且不可删**（删分类会让题悬空），且要参与合并视图的分类白名单计算。`interview_match_hint` 也不进 `interview_item`：它描述的是「用户对**匹配结果**的判定」，与词条内容无关，也不参与导出 / 合并（换机后误命中可以重新标）。

| 表 | 写 | 读 | 时机 |
|---|---|---|---|
| `interview_item` | 仅 `handlers/interview/*` | 经 IPC → 渲染层 | AI 草稿落地（`draft`）、用户采纳（`adopted` + `reviewed_at`）、划词转词条、导入 |
| `interview_taxonomy` | 同上 | 同上 + 分类白名单计算 | AI 建议分类 → 用户确认 → `adopted`；导入 |
| `interview_match_hint` | 同上 | 同上（建匹配器时作为 `muted` 规则） | 正文里右键「这里不是这个词」；撤销时删行 |
| `interview_meta` | 同上 | 同上（启动读 `schema_version` / `baseline_version`） | 建库、每次导入/导出成功后 |

**`baseline_version` 的写入时机**：主进程在 `interview-db.ts` 的 `initializeInterviewDb()` 里用 `app.getVersion()` 写入（`INSERT OR REPLACE`）。app 升级后首次建连即更新，用于导出时标注「这份增量是基于哪个基线导出的」，**不参与合并逻辑**。

---

## 4. IPC 通道契约

> 渲染层只经 `preload.ts` 白名单；SQL 只出现在 `interview-db.ts` 与 `handlers/interview/*`。

| 通道 | 状态 | 入参 | 返回 |
|---|---|---|---|
| `interview-items-list` | 新增 | `{ kind: "question"\|"glossary"\|"diagram"\|"all"; status?: "draft"\|"adopted"\|"all"; categoryId?: string; includeDeleted?: boolean }` | `{ id, kind, status, origin, categoryId, track, title, errors: string[], updatedAt }[]`（**不返回 payload**） |
| `interview-item-get` | 新增 | `{ id }` | `{ id, kind, status, origin, payload, errors, sourceIntent, aiLogId, createdAt, updatedAt } \| null` |
| `interview-item-save` | 新增 | `{ id, kind, action, baseId?, payload, status, categoryId?, track?, title, errors?, sourceIntent?, aiLogId?, baseStamp?, baseHash? }` | `{ ok: true; id } \| { ok: false; errors: string[] }`（主进程**再跑一次**结构校验才落库，见 §11） |
| `interview-item-set-status` | 新增 | `{ id, status: "draft"\|"adopted"\|"rejected" }` | `{ ok: true; glossaryVersion: number } \| { ok: false; errors: string[] }`（`adopted` 前必须校验通过；版本号供 §10.4） |
| `interview-item-delete` / `-restore` / `-purge` | 新增 | `{ id }` | `{ ok: boolean }`（软删 / 恢复 / 彻底删）。**purge 的 SQL 必带 `action='new'`**；目标是 override 行时返回 `{ ok: false, code: "use_restore" }`，UI 该按钮直接叫「还原默认」（见 §5.2） |
| `interview-item-revert-default` | 新增 | `{ id }`（基线 id） | `{ ok: true } \| { ok: false; code: "not_overridden" }`（删除 override 行，基线自然回落） |
| `interview-item-ack-base` | 新增 | `{ id, baseHash }` | `{ ok: true }`（写 `ack_base_hash`，抑制「基线已更新」提示，内容不动） |
| `interview-taxonomy-list` | 新增 | `{ track?, status? }` | `{ id, label, track, orderNo, status, note }[]` |
| `interview-taxonomy-save` | 新增 | `{ id, label, track, orderNo?, status, note? }` | `{ ok: true; id } \| { ok: false; errors: string[] }` |
| `interview-hint-list` | 新增 | — | `{ id, termId, key, left, right, createdAt }[]`（一次全读：渲染层要拿它建匹配器） |
| `interview-hint-add` | 新增 | `{ termId, key, left, right }` | `{ ok: true; id } \| { ok: false; errors }`（同 `(term_id, key, left, right)` 幂等；**左右都空**直接拒：那是「改词条」不是「这里不绑定」） |
| `interview-hint-remove` | 新增 | `{ id }` | `{ ok: boolean }`（撤销一次解除） |
| `interview-export` | 新增 | `{ mode: "delta"\|"full"; kinds?: (...)*[]; categoryIds?: string[] }` | `{ ok: true; path: string; counts: Record<string, number> } \| null`（内部 `dialog.showSaveDialog`） |
| `interview-import` | 新增 | `{ path?: string; mode: "merge"\|"replace"; conflict: "skip"\|"overwrite" }` | `{ ok: true; added, updated, skipped: number; orphaned: { id, title, baseStamp }[]; errors: string[] } \| null`（内部 `dialog.showOpenDialog`；`replace` 需渲染层二次确认；`orphaned` 非空时必须显式弹一次） |
| `interview-meta-get` | 新增 | — | `{ schemaVersion, baselineVersion, lastImportAt, lastExportAt }` |
| `ai-generate` / `ai-event-log` | **复用** | 现有 DTO | 现有 DTO（零改动） |

导出/导入的文件读写一律走 `dialog` + `fs`（既有范式：`handlers/checkin/memo-handlers.ts:164/215/277/301`），**不新增依赖**。

### 4.1 导出文件的边界（与 §1「可整包搬运」的关系）

「可整包搬运」指**库文件本身可拷贝**，不指导出文件可当完整题库使用：

| 文件 | 内容 | 能否独立使用 |
|---|---|---|
| `interview.db` | 只有增量（`u-` 前缀条目） | **不能**：没有基线就只有一个空壳增量 |
| `delta` 导出 | 增量条目 | **不能**：必须配合当前 app 的基线 |
| `full` 导出 | 基线快照（`action: "baseline"`）+ 增量与覆盖行 | **只能自用**：导入端一律 skip `action: "baseline"` 的条目（源码里已有） |

想「把整个题库给别人」的正确路径是**分享 app 版本**，不是分享导出文件。导出解决的是「我的拓展不丢、换机能带走」，不是「题库可分发」。

---

## 5. 双层数据语义

| 维度 | 基线（源码） | 增量（interview.db） |
|---|---|---|
| 内容 | 243 题 / ~100 词条 / 24 图 / 22 分类 / 16 知识主题 | 覆盖行（`override`）、隐藏墓碑（`hidden`）、用户新建（`u-`）、导入内容、自定义分类 |
| 谁改 | 随 app 版本更新 | 用户（编辑 / 删除 / 采纳 / 导入） |
| 能否删 | 用户可隐藏（墓碑）；源码只能改文件 | 我的题软删进回收站；覆盖行可「还原默认」 |
| 升级时 | **覆盖为最新**（未被动过的题） | **完全不动**（动过的题保持我的版本） |
| 冲突 | **基线是默认值，`override` 优先** | `hidden` 跳过；孤儿覆盖不渲染但保留 |

### 5.1 写时复制（COW）语义

基线常驻源码只读，用户**动哪道才复制哪道**：

- **编辑**基线题 → 建一行 `action='override'`、`id = base_id = 基线 id`，存当时的 `base_stamp` 与 `base_hash`；
- **删除**基线题 → 建一行 `status='hidden'`、`payload_json=NULL` 的墓碑；
- **还原默认** → 删掉那一行，基线自然回落（不需要任何特殊分支）；
- **新建**题 → `action='new'`、`id = u-q-*`。

**为什么不做「物化」**（首次启动把 243 题全写进库、此后库为唯一事实源）：

| 问题 | COW | 物化 + `is_dirty` |
|---|---|---|
| 用户误删 `interview.db` | 回到干净基线（丢增量，可预期） | 题库**全空**，还要区分「首次安装」与「误删」 |
| 基线新增题 | 什么都不做，源码加了就有 | 每次升级跑 `INSERT OR IGNORE` 并重排 |
| 基线修正某题 | 未覆盖的题自动拿到新版 | 未 dirty 的行要 upsert，dirty 行要做三路合并（需另存旧基线快照才能做字段级） |
| 删基线题 | 一行墓碑，升级不动它 | 行被删 + 升级注入会复活 → 还是得加墓碑列，绕回 COW |
| 库体积 | 只装增量（几十 KB） | 基线副本 + 指纹列（≈ 双份） |

一句话：**COW 把「升级」变成「换常量」，物化把「升级」变成「用户数据迁移」。**

### 5.2 合并算法（`mergeInterviewBank(baseline, rows, hashOf)`，纯函数可单测）

输入：基线常量 + 库内全量行 + 基线指纹函数；输出 `{ questions, glossary, diagrams, categories, warnings }`。

1. **建索引**：`linked = Map<base_id, row>`（仅 `action='override'` 且 `status ∈ {adopted, hidden}`；同 `base_id` 多行视为脏数据，保留 `updated_at` 最大的并记 warning）；`added = rows.filter(action='new' && status='adopted')`。
2. **遍历基线**：对每条 `b`
   - `linked` 命中且 `status='hidden'` → **跳过**（不出现），`hiddenCount++`；
   - `linked` 命中且 `status='adopted'` → 用行内 `payload`，并**强制 `payload.id = b.id`**（防导入文件改过 id）；`baseChanged = hashOf(b) !== row.base_hash`，若 `baseChanged && row.ack_base_hash !== hashOf(b)` → 打 `staleBase` 并收 warning；
   - 未命中 → 用基线 `b`。
3. **追加**：`added` 逐条解析后追加到尾部。顺序 = 基线保持源码顺序在前（不重排，避免升级后老题跳位）+ 新增按 `updatedAt` 倒序在后。
4. **词条 / 图解同构**：覆盖行**替换**同 id 基线条目；其 `term/en/aliases` 构建 matcher 时**不参与「键冲突」判定**（同 id 的替换不是冲突）；`hidden` 词条从 matcher 键表剔除。
5. **分类白名单**：22 基线 + `adopted` 的自定义分类；override 行的 `category_id` 指向已删分类 → 回落基线 `categoryId` + warning。
6. **孤儿覆盖**：`linked` 里 `base_id` 在当前基线中不存在（新版本删了该题）→ **不参与渲染**、不占 id，但**保留在库**；warning 给 `{ id, title, baseStamp }` 供维护面板一次性处理（转存为我的新建题 / 丢弃）。**不静默迁移** —— 转存要用户点，因为改 id 会重置该题在收藏里的语义。
7. **不变式断言**（出结果前）：`id` 全局唯一；`hidden` 行不得出现在结果里；`new` 行的 id 必须 `u-` 前缀。三条同时写进单测与源码守卫。

### 5.3 墓碑不可 purge

1. `interview-item-purge` 的 SQL **一律带 `AND action='new'`**；请求打到 override 行时返回 `{ ok: false, code: "use_restore" }`，UI 把该按钮改名为「还原默认」。
2. `status='hidden'` 的墓碑**不进回收站** —— 回收站只放 `action='new' && status='deleted'`；墓碑进「已隐藏的默认题」分区，动作只有「恢复显示」（= 删行）。
3. 守卫钉住：`DELETE FROM interview_item` 出现处必须带 `action='new'`；`mergeInterviewBank` 必须跳过 `hidden` 行（喂一条进去，断言该题不出现）。

**为什么不做「purge 时降级为恢复默认」**：那等于把「彻底删除」和「还原默认」两个相反意图合并 —— 用户点「彻底删除」后题却回来了，比不给 purge 更糟。

### 5.4 升级提示（三动作，绝不静默）

| 判定 | 条件 |
|---|---|
| 需要提示 | `base_hash !== hashOf(当前基线条)` **且** `ack_base_hash !== hashOf(当前基线条)` |
| 已确认，不再提示 | `ack_base_hash === hashOf(当前基线条)` |

- 卡片角标「基线已更新」+ 副文案「你改的这题基于 `base_stamp` 版，新版已修订」；
- 展开后三个动作：**沿用我的**（写 `ack_base_hash`，提示消失，内容不动）／**看新版**（只读双栏，只展示不改库）／**用新版覆盖**（删 override 行 = 还原默认，记 `interview_meta.last_baseline_merge_at`）；
- 批量入口：题库页顶部条「N 道你改过的题在新版有更新」；
- **合并算法不自动挑边**：5.2 步骤 2 明确用用户版并打 `staleBase`，选择权交还用户。

### 5.5 UI 语义（文案不骗人）

| 对象 | 动作名 | 后效文案 |
|---|---|---|
| 基线题 | **编辑** | 「已保存，本题改为你的版本（升级不会覆盖）」 |
| 基线题 | **删除**（不叫「隐藏」） | 「已从题库移除**且升级不会还原**；可在「已隐藏的默认题」里恢复」 |
| 基线题（改过） | **还原默认** | 「已还原为新版默认答案」 |
| 我的题（`u-`） | **删除** | 「已移入回收站」 |

两个分区标题必须分开，否则用户会以为「删除」有统一后效：**「已隐藏的默认题（可恢复，不会被升级还原）」** / **「回收站（我的题目，可彻底删除）」**。动作名顺从用户心智（他想的确实是「这题我不要」），但要用一句后效说明它不是临时视图操作。

**为什么不让 243 题入库**：入轨即双向困境 —— 覆盖则用户改动丢、保留则新版本修正的知识点进不来。COW 下这个困境不存在：**覆盖是按题发生的，未覆盖的题永远拿新版**。且基线留源码后，20+ 个纯函数测试（`MIN_PER_CATEGORY`、图解双向引用、知识体系覆盖）继续对基线生效，不需要改成「先开库再测」。

---

## 6. 导出 / 导入格式

```json
{
  "schemaVersion": 1,
  "format": "checkin-interview",
  "kind": "delta",
  "exportedAt": "2026-11-20T10:31:02.411Z",
  "source": { "appVersion": "2.41.0", "edition": "full", "device": "win32" },
  "baseline": { "version": "2.41.0", "questions": 243, "glossary": 101, "diagrams": 24, "categories": 22 },
  "counts": { "questions": 2, "glossary": 1, "diagrams": 0, "taxonomy": 1 },
  "items": {
    "questions": [
      {
        "id": "js-event-loop",
        "kind": "question",
        "action": "override",
        "baseId": "js-event-loop",
        "status": "adopted",
        "origin": "manual",
        "baseStamp": "2026-01",
        "baseHash": "sha1:9f2c41ab",
        "ackBaseHash": null,
        "categoryId": "foundation-js",
        "track": "foundation",
        "sourceIntent": null,
        "reviewedAt": "2026-11-19T08:12:40.000Z",
        "createdAt": "2026-11-19T08:05:11.000Z",
        "updatedAt": "2026-11-19T08:12:40.000Z",
        "payload": {
          "id": "js-event-loop",
          "title": "事件循环里微任务与宏任务的执行顺序",
          "stem": "同步代码 → Promise.then → setTimeout，输出顺序是什么？",
          "answer": "同步 → 微任务 → 宏任务。**每个宏任务结束后**都会清空一次微任务队列……（我的版本：补了 Node 与浏览器差异）",
          "track": "foundation",
          "categoryId": "foundation-js",
          "difficulty": "medium",
          "tags": ["事件循环", "微任务"],
          "topic": "JS 异步模型",
          "reviewedAt": "2026-11",
          "heat": 88,
          "updatedAt": "2026-11-19"
        }
      },
      {
        "id": "u-q-react-effect-double-7f3a",
        "kind": "question",
        "action": "new",
        "baseId": null,
        "status": "adopted",
        "origin": "ai",
        "baseStamp": null,
        "baseHash": null,
        "ackBaseHash": null,
        "categoryId": "foundation-react",
        "track": "foundation",
        "sourceIntent": "interviewDraft:question",
        "reviewedAt": "2026-11-19T08:12:40.000Z",
        "createdAt": "2026-11-19T08:05:11.000Z",
        "updatedAt": "2026-11-19T08:12:40.000Z",
        "payload": {
          "id": "u-q-react-effect-double-7f3a",
          "title": "StrictMode 下 useEffect 为什么执行两次",
          "stem": "开发环境打开 StrictMode 后，挂载时的副作用执行了两次，这是 bug 吗？",
          "answer": "不是。StrictMode 在开发环境会**故意**多跑一次 mount→unmount→mount……",
          "track": "foundation",
          "categoryId": "foundation-react",
          "difficulty": "medium",
          "tags": ["StrictMode", "useEffect"],
          "topic": "React 渲染与副作用",
          "reviewedAt": "2026-11",
          "heat": 50,
          "updatedAt": "2026-11-19"
        }
      }
    ],
    "glossary": [
      {
        "id": "u-g-render-phase-4c81",
        "kind": "glossary",
        "action": "new",
        "baseId": null,
        "status": "adopted",
        "origin": "manual",
        "baseStamp": null,
        "baseHash": null,
        "ackBaseHash": null,
        "categoryId": "foundation-react",
        "createdAt": "2026-11-19T09:00:00.000Z",
        "updatedAt": "2026-11-19T09:00:00.000Z",
        "payload": {
          "id": "u-g-render-phase-4c81",
          "term": "render 阶段",
          "en": "Render Phase",
          "domain": "react",
          "short": "React 计算「要改什么」的那一段，可被打断、不产生可见副作用。",
          "detail": [
            "只做 Fiber 树构建与 diff，结果写进副作用队列，不直接改 DOM。",
            "因此这里不能放订阅 / 计时器 / 改全局变量；StrictMode 会重跑它。"
          ],
          "related": ["dg-fiber"]
        }
      }
    ],
    "diagrams": [],
    "taxonomy": [
      {
        "id": "u-c-react-server-components",
        "action": "new",
        "status": "adopted",
        "origin": "ai",
        "label": "RSC 与服务端组件",
        "track": "foundation",
        "orderNo": 101,
        "note": "服务端组件边界、序列化限制、与客户端组件的组合方式。",
        "createdAt": "2026-11-19T09:20:00.000Z",
        "updatedAt": "2026-11-19T09:20:00.000Z"
      }
    ]
  }
}
```

**往返保真硬约束**

- `id` **永不因导入而改**；时间字段导出用 ISO（人可读），导入 `Date.parse` 回毫秒。
- `origin` / `status` / `action` / `baseId` / `baseStamp` / `baseHash` / `ackBaseHash` **原样保留**（导入的 `draft` 仍是草稿；覆盖关系必须能重建）。
- `kind: "full"` 时 `items` 额外含基线条目，其 **`action: "baseline"`**（导出文件专有值，库内 CHECK 不允许，永远不会入库）。
- **导入按 `action` 三分流，不看 id 前缀**（`override` 行的 id 与基线 id 相同，用前缀判会误杀用户编辑）：
  - `baseline` → 一律 skip 并计入 `skipped`（源码里已有）；
  - `new` → 必须 `u-` 前缀，否则整条记 error 并 skip；
  - `override` → 必须 `baseId === id`，否则整条记 error 并 skip。
- 校验三层：① `format` + `schemaVersion` 不匹配 → 整包拒绝；② 逐条跑结构校验（§11）；③ 分类白名单（`categoryId` 既不在基线也不在本包 taxonomy → 该条记 error 并 skip）。

**冲突策略**

| 场景 | 默认 `conflict: "skip"` | 可选 `"overwrite"` |
|---|---|---|
| 导入 `action='baseline'` 的条目 | 一律 skip（源码已有） | 同左，**无条件** |
| 导入 id 已存在于增量库 | 跳过，`skipped++` | 覆盖 `payload/title/updatedAt/baseHash`，保留库内 `createdAt` |
| 导入 `override`，目标机基线**有**该 id 且 `baseHash` 相同 | 正常覆盖 | 同左 |
| 导入 `override`，目标机基线**有**该 id 但 `baseHash` 不同 | 正常导入，之后自动进 §5.4「基线已更新」流程 | 同左 |
| 导入 `override`，目标机基线**没有**该 id | 转**孤儿**：入库但不参与渲染，导入报告 `orphaned` 列出 | 同左（孤儿不存在覆盖冲突） |
| 词条匹配键与库内另一条冲突 | 跳过并记 error | 同左（键冲突不能靠覆盖解决） |
| 分类 id 已存在 | 跳过 | 覆盖 `label/note/orderNo` |

**孤儿处理**：`orphaned` 非空时导入后必须弹一次，列出 `{id, title, baseStamp}`，每个可选「转存为我的新建题」（此时才发新 id `u-q-*`）或「丢弃」。**绝不静默改 id 或静默丢弃** —— 前者丢收藏语义，后者丢用户内容。

**导入模式**：`merge`（默认，只增改不删）与 `replace`（**只软删 `action='new'` 的行**再导入；`override` / `hidden` 一行不动 —— 那是用户对基线题的编辑，不是"导入的内容"。二次确认文案：「将清空 N 条你新增的内容，**你对默认题的修改与隐藏会保留**」）。**不提供 rename 策略** —— id 是收藏与引用的锚，重命名等于制造悬空引用。

**分片导出**：`kinds` / `categoryIds` 两维过滤，支持「只导 React 分类的词条」。过滤后 `kind` 仍写 `delta`，`counts` 给实际条数（导入端不假设全集）。

---

## 7. 迁移与版本升级

| 场景 | 处理 |
|---|---|
| 首次建库 | `CREATE TABLE IF NOT EXISTS` 全量 + `schema_version=1`、`baseline_version=<appVersion>` |
| 基线升级（243 → 260 题） | **不迁移**：基线不在库里。仅更新 `baseline_version`；合并视图自然变长；未被动过的题自动拿新版，被 `override` / `hidden` 的题保持用户状态 |
| 基线题被新版本删除（但用户改过） | 该 `override` 行进**孤儿**（§5.2 步骤 6）：保留在库、不参与渲染、`warnings` 列出，等用户在维护面板处理。**不自动迁移 id** |
| 产物 schema 升级（`InterviewQuestion` 加字段） | 不改表；读时 `migratePayload(kind, payload)` 补缺省（与 map.db 的 `migrateDoc` 同策） |
| 表结构大改 | `schema_version` 不匹配 → 旧库标「需重建」，**不写迁移代码**（未上线、个人项目，沿用 novel.db 1.33.0 的「清库换代」）。本轮新增 `action` / `base_id` 与 7 条 `CHECK`，**SQLite 不能给已存在的表追加 CHECK**：本地已有 v1 开发库时，删 `interview.db` / `-wal` / `-shm` 重建（推荐，未上线成本为零）；要保数据则只 `ALTER TABLE ADD COLUMN` 五列并放弃 CHECK（护栏改由 validate + 守卫测试兜） |
| 基线题需修订 | 不入库、不改基线：以 `u-q-…` 为**新 id** 的「修订候选」草稿存在，人工 review 后合入源码（避免基线与增量同 id 不同内容） |

---

## 8. Prompt 架构泛化

目标可判定：**新增一个业务域 = 新增 4 个文件 + 改 1 行登记，不碰任何既有域的文件**。

### 8.1 现状为什么不满足

| 障碍 | 现状 |
|---|---|
| 上下文类型写死 | `buildPromptSpec(intent, context: AiBookContext, payload)` —— 小说语境是 `shared/ai` 顶层公共类型 |
| 登记表单文件聚合 | `PROMPT_BUILDERS` / `AI_INTENT_LABELS` / `PROMPT_VERSIONS` 三张表都在 `registry.ts`，加域必须改它 |
| 采集器单域 | `collector.ts` 的 `LIMITS: Record<PromptIntent, …>` 与 `collectBookContext` 混在一个文件 |
| 段落层混装 | `sections.ts` 里 `roleBlock/requirementBlock/constraintBlock/outputBlock/composePrompt` 通用，`workBlock/entityBlock/realmBlock/characterBlock` 吃 `AiBookContext` |

### 8.2 目标形态

```
src/shared/ai/context/prompt/
├─ kit/            # 跨域通用：composePrompt / roleBlock / requirementBlock /
│                  #   constraintBlock / outputBlock / kvBlock / jsonArrayFormat
├─ types.ts        # PromptSpec / PromptDomainModule / PromptPayloadOf
├─ domains/
│  ├─ index.ts     # DOMAINS = [novelPromptDomain, interviewPromptDomain]   ← 唯一登记处
│  ├─ novel/
│  │  ├─ types.ts        # AiBookContext（从 collector.ts 迁入，小说私有）
│  │  ├─ sections.ts     # workBlock / entityBlock / realmBlock / characterBlock
│  │  ├─ collector.ts    # collectBookContext + NOVEL_LIMITS
│  │  └─ builders/{naming,polish,transform,continuation,summary,extract,relation,level-gen}.ts
│  └─ interview/
│     ├─ types.ts        # InterviewPromptContext
│     ├─ sections.ts     # categoryBlock / focusBlock / siblingTitlesBlock / coverageBlock
│     ├─ collector.ts    # collectInterviewContext（含 30/60 限流）
│     └─ builders/{explain,draft,audit}.ts
└─ index.ts        # buildPromptSpec 由 DOMAINS 折叠（对调用方签名不变）
```

```ts
export interface PromptDomainModule<Ids extends string, Ctx> {
  domain: string;                          // 'novel' | 'interview' | 'ledger' …
  intents: readonly Ids[];
  build<K extends Ids>(intent: K, ctx: Ctx, payload: PromptPayloadOf<K>): PromptSpec;
  labels: Record<Ids, string>;
  versions: Record<Ids, string>;
  /** 该域合法数据分级；不许出现域外分级（面试域只能 L1/L2） */
  allowedLevels: readonly AiDataLevel[];
}
export const DOMAINS = [novelPromptDomain, interviewPromptDomain] as const;
```

`DOMAINS` **折叠**出三张全局表 + `intent → context` 类型映射；域内 `ctx` 类型由域自己定，跨域误传在编译期就红。

### 8.3 可扩展性判据（六条，全部可判定）

1. **文件隔离**：域内 builder 不 import 其它域（除 `kit/` 与 `shared/ai/types.ts`）。
2. **登记成本**：新域只改 `domains/index.ts` 一行 import + 一行数组项（≤2 行），不改任何 `Record<PromptIntent,…>` 字面量。
3. **上下文归域**：域自定并采集上下文；`shared/ai` 顶层不再出现 `AiBookContext`（降级为 `domains/novel/types.ts` 私有）。
4. **段落复用规则**：`kit/` 只放「参数是字符串/数组」的段落；一旦某段落要吃某个域的上下文类型，它就属于那个域。第三个域想复用小说段落 → 说明它引用了小说语义，**必须**自写，或把该段落重构成 `kvBlock(title, rows: [string,string][])` 后进 `kit/`。
5. **守卫换遍历源**：`prompt.test.ts` 从「遍历 `PROMPT_BUILDERS`」改为「遍历 `DOMAINS`」：意图名全局唯一、label / version 全量、`outputFormat` 字段全在 `string|number`、`allowedLevels` 不含域外分级。
6. **dry-run 验收（硬）**：造一个假想域 `ledger`（2 个 builder），只允许新增 `domains/ledger/**` 与 `domains/index.ts` 两行；`git diff --stat` **不得**出现 `domains/novel/**`、`kit/**`、其它域文件。做不到即判据 2 或 4 被破坏。

### 8.4 迁移动作

| 动作 | 文件 | 说明 |
|---|---|---|
| 迁类型 | `collector.ts` → `domains/novel/{types,collector}.ts` | 8 个 builder 的 `import type` 改路径（纯位移） |
| 迁段落 | `sections.ts` 拆成 `kit/sections.ts` + `domains/novel/sections.ts` | 4 个小说段落位移 |
| 折叠注册 | `registry.ts` → `prompt/index.ts`；`registry.ts` 保留为 re-export 薄壳 | 避免 30+ 调用点同时改，兼容一个版本 |
| 加域 | `domains/interview/*` | 3 个 intent |
| 守卫 | `prompt.test.ts` | 遍历源改 `DOMAINS` + 新增 4 条断言 |

成本：一次性位移 12 个文件、改约 30 处 import、改 1 个测试遍历源；收益：第三个域零侵入。`shared/ai` 属 B 类，必须全量。

---

## 9. AI 拓展「试题类型」

**可行性：可做，但必须把「分类」从类型系统解耦成数据。**

硬阻塞点：`CategoryId` 是 22 个字面量联合，`CATEGORY_BY_ID: Record<CategoryId, CategoryNode>` 与 `MIN_PER_CATEGORY: Record<CategoryId, number>` 都依赖其穷尽性。**AI 动态分类绝不能进 `CategoryId`**，否则穷尽性守卫全部失效。

**方案：基线分类与自定义分类各自类型化，用模板字面量共存。**

```ts
// interview-types.ts
export type BaselineCategoryId = CategoryId;              // 22 个，不动
export type CustomCategoryId = `u-c-${string}`;           // 只在数据库里
export type InterviewCategoryId = BaselineCategoryId | CustomCategoryId;
export type CategoryKey = InterviewCategoryId | "all";
```

- 静态文件（`interview-taxonomy.ts`、`interview-knowledge.ts`、`MIN_PER_CATEGORY`）**继续用 `BaselineCategoryId`**，穷尽性守卫原样有效。
- 只有「合并视图 / 渲染 / 筛选」链用 `InterviewCategoryId`：`countByCategory` / `CategorySidebar` / `KnowledgeDrawer` 的 key 放宽，`CATEGORY_BY_ID[id]` 查不到时回落增量分类表。

**三层闸门（避免 AI 直接改结构）**

| 闸门 | 行为 |
|---|---|
| ① AI 只产**建议** | 输出字段固定为 `label` / `track` / `note` / `sampleTitles`（3 条示例题名），写 `interview_taxonomy.status='draft'`，**不进侧栏** |
| ② 用户确认才 `adopted` | 侧栏「新增分类（草稿）」入口展示 label + note + 3 条示例；采纳后同时把 3 条示例落成 `draft` 题目（否则出现 0 题空分类） |
| ③ 基线不可动 | 22 个基线分类不在 `interview_taxonomy` 里、不可删、不可改名；校验断言 `id` 必须以 `u-c-` 开头 |

**需同步的守卫**：`order_no >= 100` 且 track 内唯一；`label` ≤12 字且与 22 基线 label 及增量 label 归一后不重复；`adopted` 分类下 `adopted` 题数 ≥1，否则侧栏标灰；`CategorySidebar` 角标总数等于合并视图 total。

**知识体系不强制**：自定义分类允许没有 `KnowledgeTopic`（AI 造一个分类就要求写 16 个主题的 `upstream/downstream/links` 是荒谬的），`KnowledgeDrawer` 空态给「该分类暂无学习路径」。

---

## 10. 划词转词条

### 10.1 交互时序

```
拖选文本（≥2 中文 / ≥3 ASCII，不在代码块内）
  └─ pointerup（延迟 1 帧读选区）
       └─ 浮层「加为词条」/「问 AI」（portal 到 body，fixed 定位）
            ├─【问 AI】→ interviewExplain（不入库，纯解释气泡）
            └─【加为词条】
                 ├─ 命中已有键 → 提示「已是词条」+ 滚动定位高亮
                 └─ 未命中 → AI 补全（term/short/detail/aliases，count=1）
                      └─ 用户可改 → 入库 interview_item(status='draft')
                           └─ 采纳 → status='adopted' + reviewed_at
                                └─ 词表版本号 bump → matcher 重建 → 全页立即变可点划线
```

### 10.2 选区检测

| 点 | 决策 | 理由 |
|---|---|---|
| 事件 | `pointerup` 为主（覆盖鼠标与触屏）+ `keyup`（Shift+方向键）；`selectionchange` **仅用于关闭浮层** | `selectionchange` 拖选期间触发几十次，用它弹浮层会闪 |
| 读取时机 | `pointerup` 后 `requestAnimationFrame` 再读 `getSelection()` | 部分浏览器在 `click` 默认行为里清空选区，同步读拿到空串 |
| 过滤 | `isCollapsed` → 不弹；`range.startContainer.closest("pre,code")` → 不弹；含 `\n` → 不弹；trim 后长度不在 `[2,12]`（中文）/ `[3,24]`（ASCII）→ 不弹 | 与词典「只收需要解释的名词」同口径；代码片段不能变词条 |
| 定位 | `range.getBoundingClientRect()`（多行取**最后一个** rect 下沿）；浮层 `position: fixed` + `createPortal(document.body)` | 列表容器 `overflow: auto`，不 portal 会被裁；fixed 免滚动补偿 |
| 翻转 | 下沿 + 浮层高 > `innerHeight - 8` → 翻到选区上方；左边界夹在 `[8, innerWidth - 浮层宽 - 8]` | 列表底部几道题是真场景 |
| 与 `TermChip` 冲突 | `pointerdown` 记起点；`pointerup` 位移 < 4px **且** `isCollapsed` → 判单击交给 `TermChip`；否则判拖选，置 `suppressChipClickUntil = now + 300`，`TermChip` 的 `onClick` 首行检查该时间戳 | 只靠「选区是否为空」判会错：拖选后选区被程序清掉会误开词条弹层 |
| 清理 | 动作执行后 `selection.removeAllRanges()` + 关浮层 | 否则浮层跟着旧选区重复触发 |

**偏移定位（关键）**：`GlossarySegment` 目前只有 `{ text, term }`，**没有偏移量**，而 `TermText` 把文本切成多个 `<span>` / `<button>` / `<mark>`，选区会跨节点。做法：

1. `GlossarySegment` 增加 `start` / `end`（可选字段，不影响现有 30+ 调用点）；
2. 渲染时每个片段挂 `data-text-start` / `data-text-end`；
3. 选区时从 `range.startContainer` / `endContainer` 向上找最近的 `[data-text-start]` 祖先，用 `start + range.startOffset` 反算原文 `[start, end)`，再 `text.slice(start, end)` 取词。

只靠 `getSelection().toString()` 会在跨高亮词的选区上错位（如划选 `weak map` 时把相邻词算进来）。

### 10.3 词条键冲突

| 情况 | 处理 |
|---|---|
| 命中基线 100 词条任意键（含 `aliases`、大小写/全半角归一） | **不新建**：提示「已是词条」，滚动定位；给「补充释义」入口（新建 `u-g-…` 并在 payload 的 `related` 指向基线词条 id） |
| 命中已采纳的增量词条键 | 同上（并入同一条 `aliases`，需用户确认） |
| 与**草稿**词条键冲突 | 允许并存，但两条采纳前校验都报 error「键与草稿 X 重复」，先处理一条 |
| 同名但**领域不同**（「节流」在浏览器性能 / RxJS） | **允许新建**：两条都留下，正文弹层里并列展示、按领域区分（§10.6）。只挡同领域的重复 |
| 归一后不冲突但语义近义（「事件循环」vs「Event Loop」） | 不自动合并：`mergeGlossary` 把归一键集交给 AI 判近义仅作**提示**（一次点击的「可能是同一个词，合并？」） |

**覆盖基线词条**走同一套 COW 规则（§5.1）：`action='override'`、`id` **保持基线词条 id**（否则 `related` 引用会断），`term/en/aliases` 照常参与行内高亮，但**不参与「键冲突」判定** —— 同一 id 的替换不是两条词条抢同一个键。`hidden` 的词条从 matcher 键表里剔除，正文里不再变蓝。

### 10.4 trie 重建：版本号 + `useMemo`，不引 zustand

- 事实：`TERM_TRIE` 是 IIFE 一次性单例（`interview-glossary.ts:2034`），约 100 键 → 几百节点，**整棵重建是微秒级**。所以**不做增量插入/删除**（那要处理 fail 链重算，真复杂且易错）。
- 实现：`createGlossaryMatcher(terms)` 返回 `segmentsOf(text)`；`useGlossaryVocabulary()` 从 `InterviewVocabProvider`（极简 context，不引 zustand）拿 `{ terms, version }`，`useMemo(() => createGlossaryMatcher(terms), [version])`。
- `version` 产地：主进程在 `interview-item-set-status(adopted)` / `import` / `purge` 成功后返回新版本号（`interview_meta.glossary_version` 单调整数），渲染层直接用它比较 —— 不自造递增计数，避免多窗口漂移。
- **兼容**：`splitByGlossary` 签名不变（内部用默认实例 = 基线词表），现有调用点与单测零改动；新路径（`TermText` 走 context 注入的 matcher）才用动态词表。

### 10.5 数据流

```
getSelection → 文本归一（trim / 去首尾标点 / 全半角）
  → useInterviewAi.suggestTerm(text)                     [A 类 hook]
      → buildPromptSpec("interviewDraft", ctx, {kind:"glossary", seed: text})
      → aiGenerateStructured(count:1) → assembleGlossaryTerm(entries)
      → validateGlossaryTerm(候选, 合并后键集) → errors
  → 草稿卡（可编辑）→ 采纳
  → interview-item-save {status:"draft"} → interview-item-set-status {adopted}
      → handler 返回 { ok, glossaryVersion }
  → InterviewVocabProvider.setVersion(glossaryVersion)   // 唯一触发点
  → useMemo 重建 matcher → TermText 全页重渲染 → 新词变可点
```

---

### 10.6 误命中的三个兜底阀门

纯文本匹配必然有误命中（「字节流」里的「节流」）。这一层**不猜**，只给三个确定性阀门：

| 阀门 | 判据 | 作用范围 | 落地 |
|---|---|---|---|
| 单字汉字键不进索引 | `/^[\u3400-\u9fff]$/` | 全库 | `buildGlossaryIndex` 建索引时跳过 |
| 位置级负例 | 词条 id + 匹配键 + 左右各 6 字 | **一处** | 右键「这里不是「X」」→ `interview-hint-add` |
| 同键多词条并列 | 同键即 `variants` | 一条命中的弹层 | 弹层按领域列出并允许切换 |

**为什么不按领域自动消歧**：正文里没有「这句话属于哪个领域」的信息，靠猜只会把错误从「点开是另一个意思」变成「点开什么都没有」。同名不同义的正确做法是**并列展示**（用户看到领域标签就知道是不是自己要的），默认取词表顺序（基线优先）。

**为什么负例存位置而不是「删掉这条别名」**：删别名是全库生效（那是「改词条」，用于别名本来就记错）；「字节流里的节流」这条命中是文本层面的偶然，词条与别名都没问题 —— 只该解除这一处。反之，如果命中键是别名且用户确认「这个词条本来就不该有这种叫法」，右键菜单也提供「删掉别名」。

**同名不同领域允许共存**（与 §10.3 的关系）：键冲突校验只挡**同领域**的重复；同名不同领域的候选可以采纳，两条词条在弹层里并列。领域取不到（草稿条目）时仍按冲突处理，避免造出一条被先出现者遮蔽的隐形词条。

```
右键可点名词
  → buildTermMenu（纯函数）：「这里不是「X」」/「编辑词条」/「删掉别名」
  → useTermHints.unbind → muteContextOf(text, start, end)   // 与匹配器同一份实现
  → interview-hint-add → reload → buildGlossaryIndex(terms, { muted })
  → 该处退回普通文字；「已解除 N 处」面板可一键恢复
```

### 10.7 词条维护：编辑、删除、选优偏好

**编辑**（`GlossaryEditDrawer` + `useGlossaryEdit`）改的是词条本身：词名 / 英文名 / 领域 / 分类 / 一句话定义 / 展开细节 / 别名。落库仍是整条 payload 的 `itemSave`：

| 词条来源 | action | 判据 |
|---|---|---|
| 基线词条 | `override`（`baseId === id`） | 编译期常量 `glossaryById(id)` 命中 |
| 自建词条（`u-`） | `new` | 前缀 + `glossaryById` 未命中 |

- **可选字段必须能被清空**：payload 由 `toGlossaryShape` 逐字段判定后拼装，不用 `{...term}` —— 否则用户删掉的 `en` / `aliases` 会在保存后「失而复得」。
- **改词名不会自动补别名**：词表按整词命中，改名后正文里原来的说法不再点亮。界面提示用户自行决定是否把旧说法加进别名，而不是替他改全库匹配结果。
- **删除只收自建词条**：走 `interview-item-delete`（软删，`status='deleted'`），合并视图只收 `adopted`，正文立刻不再点亮。内置词条删了会被下次升级重新合回来，属假象，故不提供入口。

**选优偏好**（同名不同义的主匹配）：

- `buildGlossaryIndex(terms, { prefer })` 与 `index.withPrefer(prefer)` 共用同一份词表 / trie / 负例，只换 `pickTerm` 的入参 —— 切分类不重扫词表。
- 页面按 `filter.categoryId`（`all` 时省略）与 `filter.track` 派生偏好，通过 `GlossaryMatchIndexContext` 覆盖合并视图的默认实例，`TermText` 优先读它。
- 命中顺序：① 分类精确命中 → ② 同轨道（`categoryNodeOf` 反查）→ ③ 词表顺序（基线在前）。形态变化（谁点亮）不影响 `variants`：弹层里始终列出全部同名词条。

### 10.8 题目质检（`interviewAudit` 的 UI 出口）

- 入口：顶栏「题目质检」，与 AI 拓展同一套可用性口径（总开关关着整块不渲染、没配全则禁用并说明原因）。
- 范围：`useInterviewPage().filteredQuestions`（当前筛选 + 排序后的全量，不分页），由 `INTERVIEW_LIMITS.auditTargets`（20）截断 —— 只拿当前页会漏题，拿整库会跑偏筛选。
- 写库为零：结论只进内存。每条结论两个动作 ——「去改」关面板并打开该题的 `QuestionEditDrawer`（与手动改题同一条写入路径），「忽略」只从报告里移除。
- id 校验：模型抄错 / 发明 id 的条目一律丢弃（落到别的题上比丢掉更糟）；同一题多条结论合并 `issues`。
- 严重程度只认 `AUDIT_SEVERITIES`（`high / medium / low`），中文档位归一，认不出按 `medium`。

---

## 11. 校验单一产地与跨进程落点

**约束**：主进程**从未** import 渲染层（`electron/**` 对 `@/windows` 零引用），因此 `pages/InterviewPage/data/` 下的校验函数**不能**被 `handlers/interview/*` 复用。而「渲染层校验 + 主进程二次校验」如果各写一份，必然漂移。

**解法：按「结构」与「领域」分层，结构层放进 `src/shared/`。**

```
src/shared/interview/
├─ payload-shape.ts        # 纯结构校验，不依赖 CategoryId 白名单
│                          #   isValidQuestionShape / isValidGlossaryShape / isValidDiagramShape
│                          #   + 挡 "[object Object]"、挡超长、挡缺失必填
└─ payload-shape.test.ts
```

| 层 | 位置 | 谁调 | 查什么 |
|---|---|---|---|
| 结构校验 | `src/shared/interview/payload-shape.ts` | 主进程 handler（防绕过）+ 渲染层 | 字段存在、类型、长度、`[object Object]`、JSON 残片 |
| 领域校验 | `pages/InterviewPage/data/interview-validation.ts` | 仅渲染层 | 分类白名单、图解 id 引用、词条键唯一、题目 id 与基线不撞 |

- 主进程落库前只跑**结构校验**（它能挡住手构造的非法 payload、导入的脏文件）；
- 渲染层采纳前跑**结构 + 领域**两级，领域错误红字展示、采纳按钮禁用；
- 源码守卫（`interview-bank.test.ts` 等）调同一份领域校验，保证「AI 采信了但测试没覆盖」的缝不存在。
- `src/shared/interview/` 属跨窗口 shared → 改动是 **B 类，需全量**。

---

## 12. 实施清单

| # | 任务 | 文件 | 依赖 | 测试范围 |
|---|---|---|---|---|
| **T01** | 独立库地基 | `electron/interview/interview-db.ts` + `interview-db-guard.test.ts`（三库守卫改写为四库互不越界）、`main.ts` 挂桥 | — | **B 全量** |
| **T02** | Prompt 域泛化 | `prompt/kit/*`、`prompt/domains/{index,novel/*,interview/*}`、`prompt/index.ts`、`prompt.test.ts` | T01 | **B 全量** |
| **T03** | 结构校验 + 产物通道 | `src/shared/interview/payload-shape.ts`(+test)、`handlers/interview/interview-handlers.ts`（§4 除 export/import）、`preload.ts`、`src/shared/types/electron.d.ts` | T01 | **B 全量** |
| **T04** | 导出 / 导入 | `handlers/interview/interview-transfer.ts`、`interview-transfer-utils.ts`(+test)（序列化 + 冲突裁决，纯函数）、`src/shared/interview/payload-shape.ts` 补逐条校验、两个 dialog 通道 | T03 | **B 全量** |
| **T05** | 合并视图 + 词典 matcher | `persistence/merge-*.ts`(+test)（含 `mergeInterviewBank` 四类产物 + 7 条不变式）、`interview-glossary.ts` 加 `createGlossaryMatcher`（`splitByGlossary` 不变）、`persistence/InterviewVocabProvider.tsx`、`useInterviewPage` 接合并视图、`interview-types.ts` 加 `InterviewCategoryId` | T03 | **A 目录** |
| **T06** | 划词 + 出题/出图/出词 + taxonomy UI | `components/SelectionTermPopover/`、`AiDraftDrawer/`、`DraftReviewDrawer/`、`TaxonomyDraftList/`、`hooks/useSelectionTerms.ts`、`hooks/useInterviewAi.ts`、`TermText`、`CategorySidebar` | T02、T05 | **A 目录** |
| **T07** | 文档与索引 | 本文、`docs/README.md`（`docs/spec/` 表格加一行）、`AGENTS.md:629`「合计 50 篇 md」→ **51**、`AGENTS.md:631`「活规范 5 篇」→ **6**、`CHANGELOG.md` | T08 | **B 全量**（docs 守卫） |
| **T08** | 基线题编辑 / 删除 / 还原 + 升级提示 | `components/QuestionCard`（编辑入口、`基线已更新` 角标、三动作）、`components/HiddenBaselineDrawer/`（已隐藏的默认题）、`components/OrphanPanel/`（孤儿处理）、`hooks/useQuestionOverride.ts`（`override` / `hidden` / `revert` / `ack` 四个动作） | T05 | **A 目录** |

**顺序铁律**：T01 → T03 → T05/T06；T02 与 T03 可并行但必须先于 T06。否则会出现「渲染层调用不存在的通道」或「prompt 域未注册即被引用」，错误被 IPC 层吞掉。

---

## 13. 已知未决（不阻塞 B0）

| # | 事项 | 现状判断 | 触发条件 |
|---|---|---|---|
| 1 | AI 判近义词合并（§10.3 第四行） | 只做提示、不自动合并 | 若用户反馈「提示太吵」则关掉该提示；若「漏合并太多」再做半自动 |
| 2 | `full` 导入时基线快照是否参与「题库完整性」校验 | 当前只 skip，不比对内容差异 | 出现「导出的基线比当前 app 新」场景时再做差异报告 |
| 3 | 自定义分类的生命周期（删除时题目怎么办） | 软删分类 + 题目 `category_id` 悬空，合并视图回落到「未分类」 | 用户抱怨「删了分类题不见了」时补「删除前迁移到目标分类」 |
| 4 | 导出的基线条目体积 | `full` 约 300 KB，走 JSON 单文件 | 超过 5 MB 时改 zip 或分片 |
| 5 | 用户改过的题与新版基线的**字段级** diff | 只做只读双栏整段对比（§5.4 的「看新版」） | 用户反馈「整段对比看不出改了什么」时再做逐字段高亮 |
| 6 | 孤儿覆盖的批量处理 UI | 先做单条（转存 / 丢弃），`warnings.orphans` 一次性列出 | 孤儿超过 10 条时补多选批量 |
| 7 | 「还原全部修改」批量入口 | 只有单题「还原默认」 | 用户一次改过 20+ 道且想全部回退时再补 |

---

## 14. 与早期方案的差异（为什么不是另一种设计）

本规范定稿前有九条结论被推翻，记录在此避免以后再绕回去。

| # | 早期结论 | 现行结论 | 为什么改 |
|---|---|---|---|
| 1 | 增量挂 `checkin.db` 的 overlay 表，不建第四本库 | **建 `interview.db`** | 「一键导出导入」需要库文件可整包复制；且划词是高频小写入，不该与待办/日程共享 WAL |
| 2 | 「增量必须带 `u-` 前缀」 | **`action` 两分**：`new` 带前缀、`override` 用基线 id | 收藏按 `question.id` 存 localStorage，覆盖时换 id = 收藏全丢；`id` 还是 React `key` 与 `expandedId` |
| 3 | 「同 id 基线优先、增量丢弃」 | **基线是默认值、`override` 优先** | 原规则让用户对基线题的任何修改无处存放（写进去也会被丢弃），等于题库永远不可编辑 |
| 4 | 基线题只读、不可删 | **可改可删**（COW + 墓碑） | 用户明确要解除「无法删除」这个限制；COW 让升级变成「换常量」而不是数据迁移 |
| 5 | 图解不接 AI | **接 AI**（`interviewDraft:diagram`） | 用户要「AI 拓展试题类型」，图型属于可拓展的结构 |
| 6 | AI 造的题只能在弹层列表里躺着 | **参与行内高亮**（matcher 按版本号重建） | 用户要的就是「划词后变成划线词」；实测 trie 整棵重建是微秒级 |
| 7 | 单向「导出 TS 片段供开发者合入」 | **双向 JSON 导出导入** | 用户要「一键导出导入数据」；TS 片段降级为开发者回流工具 |
| 8 | `PromptContextMap` 加一张映射表即够 | **`PromptDomainModule` + `DOMAINS` 折叠注册** | 加映射表仍是「每加一域改 N 处 `Record` 字面量」，做不到「新域只改 2 行」 |
| 9 | 校验只在渲染层做 | **主进程再做一次结构校验**（`src/shared/interview/payload-shape.ts`） | 有独立库与导入通道后，渲染层不再是唯一写入方；且主进程从未 import 渲染层，领域校验不能共用 |
