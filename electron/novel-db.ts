/**
 * 小说域本地数据库（novel.db）
 *
 * novel 窗口与行囊窗口的**全部**持久化数据都在本库，与 checkin.db 完全分离：
 *
 *   user-data/{email-hash}/
 *   ├─ checkin.db   todo / memo / ledger / checkin / activities / config
 *   └─ novel.db     novel_* 业务表 + novel_pack_* 行囊表 + novel_config + novel_usage_log
 *
 * 分离的三个理由：
 * 1. **体积**：正文与快照是量级最大的数据（快照是正文的整份拷贝），把它们从
 *    每日高频读写的 checkin.db 里摘出去，待办 / 日程的读写不再被正文库体积拖累；
 * 2. **备份**：novel.db 可单独拷贝 / 恢复（一部书的迁移不该带上账本和待办）；
 * 3. **边界**：novel 域的 schema 演进不再触碰 checkin 的表结构，两个模块彻底解耦。
 *
 * ⚠️ 本库是 1.33.0 按 §6.7 `refactor` 口径**从零重设**的结果：
 * checkin.db 里历史遗留的 novel_* / novel_pack_* / usage_log 表**不再被读取**
 * （建表语句已从 db.ts 移除），也没有任何运行时迁移 / 兼容层。老数据需要
 * 重建时走「导入书籍」入口，而不是写一段「新旧都能读」的适配代码。
 *
 * 边界：SQL 只出现在本文件与 handlers/novel-*.ts；不导入 main.ts。
 */
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { getCurrentUserEmail, getUserDataDir, registerUserDbLifecycle } from "./db";

let novelDb: Database.Database | null = null;

/**
 * 编辑器会话标记键（崩溃恢复）：running = 会话进行中；非 running = 上次正常关闭。
 *
 * 与业务表同库是刻意的 —— 会话标记必须与「它守护的那批正文」同生共死，
 * 放在 checkin.db 里会出现「换了用户库但标记还在」的错配。
 */
export const NOVEL_SESSION_KEY = "novel_editor_session";

export function getNovelDbPath(email: string): string {
  return path.join(getUserDataDir(email), "novel.db");
}

/**
 * novel.db 的初始 schema（一次性建库）。
 *
 * 历史增量迁移（`ALTER TABLE` 补列）在这里**直接写进 CREATE TABLE**：本库从零
 * 建立，没有需要就地升级的老库；将来加列仍按 §6.5 走增量迁移。
 *
 * 时间戳统一毫秒整数（渲染层 `Date.now()` 口径）；JSON 字段统一 TEXT。
 */
function initializeNovelDb(database: Database.Database): void {
  database.pragma("journal_mode = WAL");
  database.exec(`
    -- ── 领域设置（替代 checkin.db 的 config 的 novel_* 键）──
    CREATE TABLE IF NOT EXISTS novel_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    -- ── 埋点（R14 北极星漏斗：editor_open / chapter_save / snapshot / book_import）──
    CREATE TABLE IF NOT EXISTS novel_usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL,
      payload TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_novel_usage_event ON novel_usage_log(event, created_at);

    -- ── 作品 / 卷 / 章 / 快照 ──
    -- deleted_at：回收站（删除兜底）。NULL = 正常在架；有值 = 已移入回收站
    -- 的时间戳（ms）。删除只打标记、不动子表，恢复就是把这一列清空 ——
    -- 卷章正文 / 要素 / 设定 / 行囊全都还在原处，不需要任何重建逻辑。
    --
    -- 卷与章同样带这一列（2.4.0 起）。**删卷时卷与其内章节打同一个时间戳**，
    -- 这个相同值就是「同一批」的判据（见 novel-safety-handlers 的恢复逻辑）：
    -- 恢复卷只带回这一批，删卷之前单独删掉的章节仍留在回收站里，各归各的。
    CREATE TABLE IF NOT EXISTS novel_works (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      deleted_at INTEGER,
      -- 题材（2.7.1 起）：AI 起名 / 润色的风格锚点。
      -- **可空且非必填** —— 建书时可以跳过；为空时由 AI 层按书名 + 要素弱兜底。
      -- 存中文自由文本（「仙侠」「赛博朋克」…），不做枚举约束：网络分类一直在变，
      -- 用 CHECK 限制只会让作者填不进自己想写的类型。
      genre TEXT
    );
    CREATE TABLE IF NOT EXISTS novel_volumes (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '未命名卷',
      sort INTEGER NOT NULL DEFAULT 1,
      deleted_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_novel_volumes_work ON novel_volumes(work_id, sort);
    CREATE TABLE IF NOT EXISTS novel_chapters (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL,
      volume_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '未命名',
      content TEXT NOT NULL DEFAULT '',
      word_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'done')),
      sort INTEGER NOT NULL DEFAULT 1,
      outline_note TEXT,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_novel_chapters_work
      ON novel_chapters(work_id, volume_id, sort);
    CREATE TABLE IF NOT EXISTS novel_snapshots (
      id TEXT PRIMARY KEY,
      chapter_id TEXT NOT NULL,
      content TEXT NOT NULL,
      word_count INTEGER NOT NULL DEFAULT 0,
      delta_words INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_novel_snapshots_chapter
      ON novel_snapshots(chapter_id, created_at);
    -- 崩溃恢复按「时间倒序找第一条与正文不一致的快照」查库（见 buildRecovery）。
    -- 上面那条 (chapter_id, created_at) 复合索引无法用于全局 ORDER BY created_at，
    -- 没有这条就得全表扫 + 临时 B-tree 排序，而每次打开书架都会跑一遍。
    CREATE INDEX IF NOT EXISTS idx_novel_snapshots_created
      ON novel_snapshots(created_at);

    -- ── 灵感速记 / 伏笔（大纲条目）──
    -- 灵感 work_id = '' 表示「未归属的全局池」，是合法值（novel-note-move 的目标）
    CREATE TABLE IF NOT EXISTS novel_notes (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      foreshadow_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_novel_notes_work ON novel_notes(work_id);
    CREATE TABLE IF NOT EXISTS novel_outline_entries (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'foreshadow',
      volume_id TEXT NOT NULL,
      chapter_id TEXT,
      title TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_novel_outline_work ON novel_outline_entries(work_id);

    -- ── 要素库（实体 + 多态关联）──
    CREATE TABLE IF NOT EXISTS novel_entities (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'custom',
      name TEXT NOT NULL,
      aliases TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      fields TEXT NOT NULL DEFAULT '{}',
      sort INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_novel_entities_work ON novel_entities(work_id, sort);
    -- 多态关联：from/to 各自带 type，可指向要素 / 等级项 / 章节
    CREATE TABLE IF NOT EXISTS novel_links (
      id TEXT PRIMARY KEY,
      from_type TEXT NOT NULL,
      from_id TEXT NOT NULL,
      to_type TEXT NOT NULL,
      to_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_novel_links_from ON novel_links(from_type, from_id);
    CREATE INDEX IF NOT EXISTS idx_novel_links_to ON novel_links(to_type, to_id);

    -- ── 小说设定（1.36.0 重构：统一取代 R25 的 novel_level_systems / novel_levels）──
    -- 一部作品的**全部**等级序列都在这里，不再区分「境界体系」与「其它序列」：
    -- 境界体系只是 kind='realm' 的一个分类（每部作品至多一个），功法等级 /
    -- 丹药稀有度 / 法宝品阶是 kind='custom' 的其它分类。三张旧表在本次重构中删除，
    -- 没有迁移脚本——老数据经「导入书籍 / 应用模板」重建。
    CREATE TABLE IF NOT EXISTS novel_setting_categories (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#5B8DEF',
      -- realm = 境界体系：角色卡「当前境界」与行囊境界换算只认这一个分类
      kind TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('realm', 'custom')),
      sort_order INTEGER NOT NULL DEFAULT 1,
      note TEXT NOT NULL DEFAULT '',
      -- 进位规则：每阶小层数 + 进位方向 + 小层命名
      -- carry_dir='desc' 承载「九品 → 一品」这类倒序序列（rank 递增而层级递减）
      sub_levels INTEGER NOT NULL DEFAULT 1,
      carry_dir TEXT NOT NULL DEFAULT 'asc' CHECK (carry_dir IN ('asc', 'desc')),
      sub_pattern TEXT NOT NULL DEFAULT '第{n}层'
    );
    CREATE INDEX IF NOT EXISTS idx_novel_setting_cat_work
      ON novel_setting_categories(work_id, sort_order);
    CREATE TABLE IF NOT EXISTS novel_setting_levels (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,
      name TEXT NOT NULL,
      rank INTEGER NOT NULL,
      -- 别名数组（JSON TEXT）：正文用词不一致时靠它归并，也是一致性检查的词表来源
      aliases TEXT NOT NULL DEFAULT '[]',
      note TEXT NOT NULL DEFAULT '',
      -- 小层数与战力当量：行囊境界换算依赖这两列
      sub_levels INTEGER NOT NULL DEFAULT 1,
      power REAL,
      -- 拆分层级：parent_id 非空表示本条派生自它，并占据 [seg_from, seg_to] 小层段。
      -- 合并即反向：删子级、把层段还给父级。不建外键——删父级要能连带清理而非失败。
      parent_id TEXT,
      seg_from INTEGER,
      seg_to INTEGER,
      -- 1.37.0：本阶专属的小层命名模板；空串 = 沿用分类的 sub_pattern。
      -- 固定名单（如「初期,中期,后期,圆满」）与 {n} 模板都合法，语义见 setting-utils
      sub_pattern TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_novel_setting_lv_cat
      ON novel_setting_levels(category_id, rank);
    -- 设定模板：跨作品复用的分类快照（「另存为模板」/「从模板导入」）。
    -- 刻意不带 work_id —— 模板存在的意义就是换书复用；设定数据本身仍按作品隔离。
    CREATE TABLE IF NOT EXISTS novel_setting_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- ── 全局设定（跨书共享设定库，D1，REQ-040）─────────────────────────
    -- 结构与 novel_setting_categories 对齐，**去掉 work_id**：全局设定的生命周期
    -- 独立于任何作品（REQ-040 ③「删光作品后仍在」）。书侧引用它时，把全局的等级
    -- 「镜像」成本书的 novel_setting_levels 行（全新 id，靠 source_global_id 一一对应），
    -- 因此两个域的列名 / 约束 / rank 口径完全一致，handler 工具可共用同一套。
    CREATE TABLE IF NOT EXISTS novel_global_setting_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#5B8DEF',
      -- realm = 全局唯一的境界体系；其余为 custom
      kind TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('realm', 'custom')),
      sort_order INTEGER NOT NULL DEFAULT 1,
      note TEXT NOT NULL DEFAULT '',
      sub_levels INTEGER NOT NULL DEFAULT 1,
      carry_dir TEXT NOT NULL DEFAULT 'asc' CHECK (carry_dir IN ('asc', 'desc')),
      sub_pattern TEXT NOT NULL DEFAULT '第{n}层'
    );
    CREATE INDEX IF NOT EXISTS idx_novel_global_setting_cat_sort
      ON novel_global_setting_categories(sort_order);
    -- 全局 realm 唯一性：应用层校验为主，部分唯一索引兜底（防并发 / 脚本直写）
    CREATE UNIQUE INDEX IF NOT EXISTS idx_novel_global_setting_cat_realm
      ON novel_global_setting_categories(kind) WHERE kind = 'realm';
    CREATE TABLE IF NOT EXISTS novel_global_setting_levels (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,
      name TEXT NOT NULL,
      rank INTEGER NOT NULL,
      aliases TEXT NOT NULL DEFAULT '[]',
      note TEXT NOT NULL DEFAULT '',
      sub_levels INTEGER NOT NULL DEFAULT 1,
      power REAL,
      parent_id TEXT,
      seg_from INTEGER,
      seg_to INTEGER,
      sub_pattern TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_novel_global_setting_lv_cat
      ON novel_global_setting_levels(category_id, rank);

    -- ── 行囊 CharacterPack（PRD v1.5 §9.2，文档已归档）──
    -- v1 只承载 1 条主角，模型按多角色预留（全部表带 character_id）
    -- 数值统一 REAL、布尔统一 INTEGER 0/1、JSON 字段统一 TEXT
    CREATE TABLE IF NOT EXISTS novel_pack_characters (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '主角',
      avatar TEXT,
      is_protagonist INTEGER NOT NULL DEFAULT 1,
      -- 绑定 EntityPanel 实体（novel_entities.id）：缺失会导致境界同步静默失效（§9.7.5）
      entity_id TEXT,
      -- 未绑定实体时的「仅行囊内使用」境界（JSON {levelId, sub}）；绑定时以 novel_links 为准
      realm_at TEXT,
      note TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_pack_char_work ON novel_pack_characters(work_id, sort_order);
    -- 属性字典（作品级预设，1.39.0 refactor 重构）：作者一次定义「这本书有哪些属性」，
    -- 效果 / 映射 / 未来其它系统统一引用这里的 id；角色只存数值（见下表）。
    -- key 可空：机器名，供导入导出与跨系统按名解析用。
    CREATE TABLE IF NOT EXISTS novel_pack_attr_defs (
      id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL,
      key TEXT,
      name TEXT NOT NULL,
      group_name TEXT NOT NULL DEFAULT '基础属性',
      unit TEXT NOT NULL DEFAULT '',
      decimals INTEGER NOT NULL DEFAULT 0,
      -- 新建角色实例时的初始 base_value
      default_value REAL NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_pack_attrdef_work ON novel_pack_attr_defs(work_id, sort_order);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pack_attrdef_key
      ON novel_pack_attr_defs(work_id, key) WHERE key IS NOT NULL;
    -- 属性数值（角色级实例）：纯数值表，一条 = 某角色某属性定义的当前基础值。
    -- id 恒等于 def_id（一角色一属性至多一行），effect / mapping 的 target_attr_id
    -- 指向属性定义 id。没有 name / unit 列 —— 展示信息只从 defs 读，单一真相源。
    CREATE TABLE IF NOT EXISTS novel_pack_attributes (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      def_id TEXT NOT NULL,
      base_value REAL NOT NULL DEFAULT 0,
      -- 最近一次改动的落点时刻（REQ-028 本章变动角标）；0 = 不算变动
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_pack_attr_char ON novel_pack_attributes(character_id);
    -- 属性映射（1.35.0）：每 1 点源属性 → 目标属性加算 rate（「加 1 点力量，血量 +100」）
    -- 关掉一条映射 = 把 rate 设成 0：**不另设 enabled**，两种「关」会让脏计数与
    -- 「与本章初对比」都说不清哪一份才是作者的意思（rate 为 0 时汇总视同关闭，且不报警告）
    CREATE TABLE IF NOT EXISTS novel_pack_mappings (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      -- 源属性 / 目标属性都指向 novel_pack_attr_defs.id；定义被删后这两格可能悬空，
      -- 由汇总层报 missing（不建外键：删定义时要能连带清理，而不是让删除失败）
      source_attr_id TEXT NOT NULL,
      target_attr_id TEXT NOT NULL,
      rate REAL NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 1,
      -- 最近一次改动的落点时刻（REQ-028 本章变动角标）；0 = 不算变动
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_pack_mapping_char ON novel_pack_mappings(character_id, sort_order);
    CREATE TABLE IF NOT EXISTS novel_pack_slots (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      name TEXT NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 1,
      -- 仅接受物品类型（多选）；空数组 = 不限
      accepts TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      note TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_pack_slot_char ON novel_pack_slots(character_id, sort_order);
    -- 载体分组（1.39.0 二期，refactor 口径）：物品 / 技能的分类维度（功法 / 武器…），
    -- 携带能力开关决定条目编辑器渲染模板的哪几块；组可停用 = 汇总管线的闸门 0。
    -- prof_scheme_id 指向 novel_pack_unit_systems.id（绑定该组的熟练度体系，可空）。
    CREATE TABLE IF NOT EXISTS novel_pack_groups (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '',
      -- 能力开关：可穿戴（接入 slots）/ 有载体级启停开关
      can_equip INTEGER NOT NULL DEFAULT 0,
      can_enable INTEGER NOT NULL DEFAULT 1,
      prof_scheme_id TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_pack_group_char ON novel_pack_groups(character_id, sort_order);
    -- 物品分类管理（1.40.0）：物品栏的「分类」从写死的五个常量升级为可管理的行。
    -- item.category 仍存**分类名字符串**（compat：老数据零迁移），改名时由渲染层
    -- 传播到物品行；system_id 指向 novel_setting_categories.id —— 绑定后，归属该
    -- 分类的物品可从这套体系里选品阶（小刀 · 神器）。无外键：设定分类被删后
    -- system_id 悬空，渲染层按「未绑定」处理。
    CREATE TABLE IF NOT EXISTS novel_pack_categories (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      name TEXT NOT NULL,
      system_id TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_pack_cat_char
      ON novel_pack_categories(character_id, sort_order);
    CREATE TABLE IF NOT EXISTS novel_pack_items (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'misc',
      qty INTEGER NOT NULL DEFAULT 1,
      rarity TEXT NOT NULL DEFAULT 'common',
      icon TEXT NOT NULL DEFAULT '',
      desc TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      -- 穿戴位置：equipped_slot_id 非空即视为佩戴；slot_index 为部位内第几个槽位
      equipped_slot_id TEXT,
      slot_index INTEGER,
      -- 归属分组（novel_pack_groups.id）；'' = 未分组
      group_id TEXT NOT NULL DEFAULT '',
      -- 体系品阶（1.40.0）：指向 novel_setting_levels.id，物品标注「小刀 · 神器」
      -- 这类体系等级；'' = 未标注。等级名不落本地（单一事实源在设定域）
      grade_id TEXT NOT NULL DEFAULT '',
      source_chapter_id TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pack_item_char ON novel_pack_items(character_id);
    CREATE TABLE IF NOT EXISTS novel_pack_skills (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      name TEXT NOT NULL,
      desc TEXT NOT NULL DEFAULT '',
      -- 载体开关（技能级总开关）：停用则全部效果（被动+持续）不参与汇总
      enabled INTEGER NOT NULL DEFAULT 1,
      -- 归属分组（novel_pack_groups.id）；'' = 未分组
      group_id TEXT NOT NULL DEFAULT '',
      proficiency_raw REAL NOT NULL DEFAULT 0,
      -- 体系品阶（1.40.0）：同 items.grade_id，技能标注「神通 · 天阶」
      grade_id TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_pack_skill_char ON novel_pack_skills(character_id, sort_order);
    CREATE TABLE IF NOT EXISTS novel_pack_modifiers (
      id TEXT PRIMARY KEY,
      owner_type TEXT NOT NULL CHECK (owner_type IN ('item', 'skill', 'status')),
      owner_id TEXT NOT NULL,
      -- 效果性质（§9.2.1）：passive 被动 / sustained 持续 / cast 释放
      nature TEXT NOT NULL DEFAULT 'passive' CHECK (nature IN ('passive', 'sustained', 'cast')),
      name TEXT NOT NULL DEFAULT '',
      -- 可空：cast 型不指向任何属性
      target_attr_id TEXT,
      op TEXT NOT NULL DEFAULT 'add' CHECK (op IN ('add', 'percent', 'mul', 'override')),
      value REAL NOT NULL DEFAULT 0,
      value_unit TEXT,
      scale_by_proficiency INTEGER NOT NULL DEFAULT 0,
      -- 仅 sustained：效果自己的独立开关（与载体开关分离）
      active INTEGER NOT NULL DEFAULT 0,
      default_on INTEGER NOT NULL DEFAULT 0,
      cost TEXT,
      cooldown REAL,
      duration TEXT,
      -- 剩余回合数（REQ-025 状态效果时效）：NULL = 不限时。到 0 即视为已过期
      rounds_left INTEGER,
      target TEXT,
      trigger TEXT,
      condition TEXT,
      note TEXT NOT NULL DEFAULT '',
      disabled INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_pack_mod_owner ON novel_pack_modifiers(owner_type, owner_id);
    -- 换装方案（REQ-032）：payload 只存「谁穿在哪个部位的哪一格」，不存物品本身
    CREATE TABLE IF NOT EXISTS novel_pack_presets (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      name TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '[]',
      note TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_pack_preset_char ON novel_pack_presets(character_id, sort_order);
    CREATE TABLE IF NOT EXISTS novel_pack_unit_systems (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('ladder', 'ratio', 'threshold')),
      levels TEXT NOT NULL DEFAULT '[]',
      config TEXT NOT NULL DEFAULT '{}',
      is_default INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_pack_unit_char ON novel_pack_unit_systems(character_id, kind);
    -- 模块拼装：只承载「这本小说要哪些模块、什么顺序」这类设定数据。
    -- 折叠状态 / 面板宽度 / 列表视图属于界面偏好，走 novel_config 的 novel_pack_ui
    CREATE TABLE IF NOT EXISTS novel_pack_layouts (
      character_id TEXT NOT NULL,
      module_key TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (character_id, module_key)
    );
    CREATE TABLE IF NOT EXISTS novel_pack_records (
      id TEXT PRIMARY KEY,
      character_id TEXT NOT NULL,
      chapter_id TEXT,
      taken_at INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pack_records_char
      ON novel_pack_records(character_id, taken_at DESC);
    -- 草稿（§8.6）：payload 与正式表同构，提交成功后清空
    CREATE TABLE IF NOT EXISTS novel_pack_drafts (
      character_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      dirty_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
  `);

  // ── 增量迁移（§6.5）───────────────────────────────────────────────
  // 2.2.x 回收站（删除兜底）：老库的 novel_works 没有 deleted_at，补一列可空
  // 时间戳。可空即「全部作品都在架」，老数据语义天然正确、无需回填。
  const workColumns = database.pragma("table_info(novel_works)") as Array<{
    name: string;
  }>;
  if (!workColumns.some((column) => column.name === "deleted_at")) {
    database.exec("ALTER TABLE novel_works ADD COLUMN deleted_at INTEGER");
  }
  // 2.7.1 题材：可空列，老作品一律视为「未设置」（AI 层按书名 + 要素弱兜底），
  // 因此不需要任何回填 / 默认值 —— 只有当用户真的在「新建作品」时选了才写。
  if (!workColumns.some((column) => column.name === "genre")) {
    database.exec("ALTER TABLE novel_works ADD COLUMN genre TEXT");
  }
  // 在架作品列表是启动即跑的热查询，回收站面板也按删除时间倒序扫
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_novel_works_deleted
      ON novel_works(deleted_at);
  `);

  // 2.4.0 回收站扩展到卷 / 章：同样只补可空时间戳列，老数据全部视为在架。
  // ⚠️ 必须逐表 pragma 探测再 ALTER —— `CREATE TABLE IF NOT EXISTS` 对**已存在**
  // 的表是空操作，光改建表语句不会给老库补列（表现为查 deleted_at 直接报错）。
  for (const table of ["novel_volumes", "novel_chapters"]) {
    const columns = database.pragma(`table_info(${table})`) as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "deleted_at")) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN deleted_at INTEGER`);
    }
    database.exec(
      `CREATE INDEX IF NOT EXISTS idx_${table}_deleted ON ${table}(deleted_at)`,
    );
  }

  // R-AI-09（2.10.0）：章节 AI 摘要加三列。加列而非 KV 映射 / 独立表——随
  // `novel-chapter-purge` 的物理 DELETE 自动清理，零孤儿、零额外删除逻辑。
  // 老章节三列均为 NULL = 未生成过摘要。
  {
    const chapterColumns = database.pragma("table_info(novel_chapters)") as Array<{
      name: string;
    }>;
    if (!chapterColumns.some((column) => column.name === "ai_summary")) {
      database.exec("ALTER TABLE novel_chapters ADD COLUMN ai_summary TEXT");
    }
    if (!chapterColumns.some((column) => column.name === "ai_summary_at")) {
      database.exec("ALTER TABLE novel_chapters ADD COLUMN ai_summary_at INTEGER");
    }
    if (!chapterColumns.some((column) => column.name === "ai_summary_model")) {
      database.exec("ALTER TABLE novel_chapters ADD COLUMN ai_summary_model TEXT");
    }
    if (!chapterColumns.some((column) => column.name === "ai_summary_batch")) {
      database.exec("ALTER TABLE novel_chapters ADD COLUMN ai_summary_batch TEXT");
    }
    database.exec(
      `CREATE INDEX IF NOT EXISTS idx_novel_chapters_summary_at
        ON novel_chapters(work_id, ai_summary_at)`,
    );
  }

  // 1.36.0 建的 novel.db 没有 sub_pattern 列（1.37.0 逐级小层命名）：
  // PRAGMA 探测后再 ALTER，幂等可重复执行。
  const levelColumns = database.pragma("table_info(novel_setting_levels)") as Array<{
    name: string;
  }>;
  if (!levelColumns.some((column) => column.name === "sub_pattern")) {
    database.exec(
      "ALTER TABLE novel_setting_levels ADD COLUMN sub_pattern TEXT NOT NULL DEFAULT ''",
    );
  }

  // 1.39.0 下线「负重 / 容量」（REQ-033 / F-5）：老库里的三列直接删掉。
  // 这是**破坏性**清列 —— 旧的重量与上限数值不保留、不迁移（§6.7 `refactor` 口径，
  // 该功能已从产品中移除，留着列只会让下一次重构再犹豫一次）。
  dropColumnIfExists(database, "novel_pack_characters", "weight_limit");
  dropColumnIfExists(database, "novel_pack_characters", "capacity_limit");
  dropColumnIfExists(database, "novel_pack_items", "weight");

  // 1.40.0 物品 / 技能体系品阶：老库补 grade_id 列（增量可重复执行）。
  // 新库 CREATE TABLE 里已带，pragma 探测保证幂等。
  const itemColumns = database.pragma("table_info(novel_pack_items)") as Array<{
    name: string;
  }>;
  if (!itemColumns.some((column) => column.name === "grade_id")) {
    database.exec(
      "ALTER TABLE novel_pack_items ADD COLUMN grade_id TEXT NOT NULL DEFAULT ''",
    );
  }
  const skillColumns = database.pragma("table_info(novel_pack_skills)") as Array<{
    name: string;
  }>;
  if (!skillColumns.some((column) => column.name === "grade_id")) {
    database.exec(
      "ALTER TABLE novel_pack_skills ADD COLUMN grade_id TEXT NOT NULL DEFAULT ''",
    );
  }

  // 1.4x 全局设定中心（D1 / D5）：**纯增量**，全部可空列，老库语义即「本书自有」。
  // 本书侧引用一整个全局分类时，用 source_global_id 建立「镜像行 ↔ 全局行」映射；
  // 全局项被删除后引用方就地固化，写 detached_from_name 记下原全局名（D4 徽标文案）。
  const categoryColumns = database.pragma(
    "table_info(novel_setting_categories)",
  ) as Array<{ name: string }>;
  if (!categoryColumns.some((column) => column.name === "source_global_id")) {
    database.exec(
      "ALTER TABLE novel_setting_categories ADD COLUMN source_global_id TEXT",
    );
  }
  if (!categoryColumns.some((column) => column.name === "detached_from_name")) {
    database.exec(
      "ALTER TABLE novel_setting_categories ADD COLUMN detached_from_name TEXT",
    );
  }
  // levelColumns 已在上方（sub_pattern 迁移）读入，复用它判断等级项的引用列
  if (!levelColumns.some((column) => column.name === "source_global_id")) {
    database.exec(
      "ALTER TABLE novel_setting_levels ADD COLUMN source_global_id TEXT",
    );
  }
  // 引用计数 / 级联同步都要按 source_global_id 收口，两条索引一次建齐（幂等）
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_novel_setting_cat_source
      ON novel_setting_categories(source_global_id);
    CREATE INDEX IF NOT EXISTS idx_novel_setting_lv_source
      ON novel_setting_levels(source_global_id);
  `);
}

/**
 * 删除历史遗留列（幂等）。
 *
 * `DROP COLUMN` 需要 SQLite ≥ 3.35，且该列不能出现在索引 / 视图 / 触发器里；
 * 这里三列都是裸列，正常路径不会抛。仍然 try/catch 兜一层：老库若是被手工改过
 * 的奇怪形态，不该把「少一个已下线的功能」升级成「整个行囊打不开」。
 */
function dropColumnIfExists(
  database: Database.Database,
  table: string,
  column: string,
): void {
  const columns = database.pragma(`table_info(${table})`) as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === column)) return;
  try {
    database.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  } catch (error) {
    console.warn(
      `[novel-db] 删除历史列 ${table}.${column} 失败（该字段已下线，可忽略）：`,
      error,
    );
  }
}

/** 打开（或切换到）当前用户的 novel.db */
export function switchNovelDb(email: string): void {
  if (novelDb) {
    novelDb.close();
    novelDb = null;
  }
  const dbPath = getNovelDbPath(email);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  novelDb = new Database(dbPath);
  initializeNovelDb(novelDb);
  console.log(`[novel-db] 已就绪: ${dbPath}`);
}

/** 获取 novel.db 实例（用户库未初始化时抛错） */
export function getNovelDb(): Database.Database {
  if (!novelDb) throw new Error("尚未初始化 novel 数据");
  return novelDb;
}

/** novel.db 是否已就绪（供「未登录 / 未切换用户」时静默跳过） */
export function isNovelDbReady(): boolean {
  return novelDb !== null;
}

/**
 * 把 novel.db 挂到用户库生命周期上。
 *
 * 必须在 `switchUserDb` 之前或之后都能生效：注册时若已有当前用户，立即补一次
 * 打开（启动流程是 `switchUserDb` 在前、`registerNovelHandlers` 在后）。
 */
export function registerNovelDbBridge(): void {
  registerUserDbLifecycle({
    onSwitched: switchNovelDb,
    onClosed: closeNovelDb,
  });
  const email = getCurrentUserEmail();
  if (email) switchNovelDb(email);
}

/** 关闭 novel.db */
export function closeNovelDb(): void {
  if (!novelDb) return;
  novelDb.close();
  novelDb = null;
  console.log("[novel-db] 已关闭");
}

// ── CRUD 封装（与 db.ts 同签名，便于 handlers 平移）──

export function novelAll(sql: string, params: unknown[] = []): unknown[] {
  return getNovelDb().prepare(sql).all(...params);
}

export function novelGet(sql: string, params: unknown[] = []): unknown {
  return getNovelDb().prepare(sql).get(...params);
}

export function novelRun(
  sql: string,
  params: unknown[] = [],
): { changes: number; lastInsertRowid: number } {
  const result = getNovelDb().prepare(sql).run(...params);
  return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid) };
}

export function novelExec(sql: string): void {
  getNovelDb().exec(sql);
}
