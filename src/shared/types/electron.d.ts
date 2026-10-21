// Electron API 类型声明

interface ActivityAddParams {
  id: string
  date: string
  startTime: string
  endTime: string
  name: string
  color: string
}

interface ActivityUpdateParams {
  date?: string
  startTime?: string
  endTime?: string
  name?: string
  color?: string
}

interface ActivityRow {
  id: string
  date: string
  start_time: string
  end_time: string
  name: string
  color: string
}

interface TodoRow {
  id: number
  parent_id: number | null
  content: string
  done: number
  note: string | null
  important: number
  work_hour: number | null
  created_at: string
  done_at: string | null
}

// ── 小说编辑器 DTO（与 electron/handlers/novel-handlers.ts 的 Dto 定义保持一致） ──
// 本文件因 export interface ElectronAPI 已是模块环境：DTO 必须显式 export，
// 渲染进程各页面（NovelPage / BookshelfPage 等）才能 import type 共用同一契约。

export interface NovelWorkDTO {
  id: string
  name: string
  createdAt: number
}

export interface NovelVolumeDTO {
  id: string
  workId: string
  name: string
  sort: number
}

export interface NovelChapterDTO {
  id: string
  workId: string
  volumeId: string
  title: string
  content: string
  wordCount: number
  status: "draft" | "done"
  sort: number
  updatedAt: number
  outlineNote?: string
}

export interface NovelSnapshotDTO {
  id: string
  chapterId: string
  content: string
  deltaWords: number
  createdAt: number
}

export interface NovelNoteDTO {
  id: string
  workId: string
  content: string
  createdAt: number
  pinned: boolean
  foreshadowId?: string
}

export interface NovelOutlineEntryDTO {
  id: string
  workId: string
  kind: "foreshadow"
  volumeId: string
  chapterId?: string
  title: string
  note: string
  status: "open" | "resolved"
  createdAt: number
}

export interface NovelEntityDTO {
  id: string
  workId: string
  type: NovelEntityTypeDTO
  name: string
  aliases: string[]
  summary: string
  content: string
  fields: Record<string, string>
  sort: number
}

export interface NovelLinkDTO {
  id: string
  fromType: NovelEntityTypeDTO
  fromId: string
  toType: NovelEntityTypeDTO
  toId: string
  relation: string
  note?: string
}

/**
 * 关系图提交（R27 / S3）：一次连线、一次备注修改都走 `novel-graph-commit`
 * 单事务。**不要**复用 `novel-link-add`（无事务、无 rev、无去重）或
 * `novel-link-set`（按四元组先删后插，会误删平行边）。
 */
export interface NovelGraphCommitLink {
  id: string
  fromType: NovelEntityTypeDTO
  fromId: string
  toType: NovelEntityTypeDTO
  toId: string
  relation: string
}

export interface NovelGraphCommitNote {
  id: string
  /** null = 清空备注 */
  note: string | null
  /** 打开边详情时看到的备注；与库里不一致 → 归入 rejected（不覆盖主窗口刚改的值） */
  expectedNote?: string | null
}

export interface NovelGraphCommitRequest {
  workId: string
  /** 客户端装载时的 rev；与库里不一致 → `stale`，整体回滚 */
  expectedRev: number
  /** 序列化后的画布文档（成员 + 坐标 + 视口）。null = 本次不改画布 */
  doc?: string | null
  addLinks?: NovelGraphCommitLink[]
  noteUpdates?: NovelGraphCommitNote[]
}

export type NovelGraphCommitResult =
  | {
      ok: true
      /** 提交后的新 rev（= expectedRev + 1） */
      rev: number
      created: NovelLinkDTO[]
      /** 已存在同一四元组 / 同一 id 已存在（重试幂等）→ 未新增 */
      merged: string[]
      notes: Array<{ id: string; note: string | null }>
      rejected: Array<{ id: string; reason: "missing" | "note-changed"; note?: string | null }>
    }
  | {
      ok: false
      code: "stale" | "invalid-target" | "invalid-link" | "db"
      message?: string
      /** code=invalid-target：不在本书 / 已被删除的端点 id */
      invalid?: string[]
      /** code=stale：库里的当前 rev */
      rev?: number
    }

/**
 * `novel-links-changed` 的载荷（R27：S3 写回 / S4 反向同步共用）。
 *
 * 三个数组都是**增量**：接收方按 id 幂等合并，不重载 bundle。
 * `workId` 可能缺省（`novel_links` 没有 work_id，境界绑定的 from 端点反查不到
 * 本书）——此时接收方按 id 合并即可，id 全局唯一。
 */
export interface NovelLinksDelta {
  workId?: string
  /** 画布文档 rev（只有 `novel-graph-commit` 会带） */
  rev?: number
  created?: NovelLinkDTO[]
  /** 已存在同一四元组 / 同一 id（重试幂等）→ 未新增 */
  merged?: string[]
  notes?: Array<{ id: string; note: string | null }>
  /** 被删掉的行 id（主窗口「解除关联」→ 图窗口那条边消失） */
  removed?: string[]
  /** 关系名被改的行（主窗口当前无改名入口，契约先留好） */
  relations?: Array<{ id: string; relation: string }>
}

/**
 * 导出 PNG 的取景矩形（R27 / S5）：`capturePage(rect)` 的单位是 DIP（= CSS px），
 * 不是设备像素 —— 像素尺寸由主进程从 PNG 头回读（= CSS × DPR）。
 */
export interface RelationCaptureRect {
  x: number
  y: number
  width: number
  height: number
}

export type RelationCaptureResult =
  | { ok: true; png: Uint8Array; width: number; height: number }
  | { ok: false; code: "empty" | "invalid" | "unavailable" | "db"; message: string }

/** 设定分类下的一条等级项 */
export interface NovelSettingLevelDTO {
  id: string
  categoryId: string
  name: string
  rank: number
  /** 别名：正文里同一阶的其它叫法，一致性检查靠它归并 */
  aliases: string[]
  note: string
  /** 本阶小层数 */
  subLevels: number
  /** 战力当量（可空） */
  power: number | null
  /** 拆分层级：非空表示派生自 parentId，占据 [segFrom, segTo] 小层段 */
  parentId: string | null
  segFrom: number | null
  segTo: number | null
  /** 本阶专属小层命名模板；空串 = 沿用分类的 subPattern（1.37.0） */
  subPattern: string
}

/** 设定分类：kind='realm' 的那一条即「境界体系」 */
export interface NovelSettingCategoryDTO {
  id: string
  workId: string
  name: string
  color: string
  kind: 'realm' | 'custom'
  sortOrder: number
  note: string
  /** 进位规则 */
  subLevels: number
  /** asc 由低到高；desc 由高到低（承载「九品 → 一品」这类倒序序列） */
  carryDir: 'asc' | 'desc'
  subPattern: string
  levels: NovelSettingLevelDTO[]
  /** 非空 = 引用自全局中心（只读镜像，实时同步；1.4x） */
  sourceGlobalId: string | null
  /** 非空 = 原全局项已删除，已固化为本书副本（徽标文案用；1.4x） */
  detachedFromName: string | null
}

export interface NovelSettingCategoryPatch {
  name?: string
  color?: string
  note?: string
  subLevels?: number
  carryDir?: 'asc' | 'desc'
  subPattern?: string
  /** 切换分类种类。设为 realm 时主进程保证唯一：同作品原境界体系自动降级为 custom */
  kind?: 'realm' | 'custom'
}

export interface NovelSettingLevelPatch {
  name?: string
  aliases?: string[]
  note?: string
  subLevels?: number
  power?: number | null
  /** 本阶专属小层命名模板；空串 = 沿用分类（1.37.0） */
  subPattern?: string
}

/** 导入导出的分类快照（去掉 workId，便于跨作品搬运） */
export interface NovelSettingSnapshot {
  name: string
  color: string
  kind: 'realm' | 'custom'
  sortOrder: number
  note: string
  subLevels: number
  carryDir: 'asc' | 'desc'
  subPattern: string
  levels: Array<{
    name: string
    rank: number
    aliases: string[]
    note: string
    subLevels: number
    power: number | null
    /** 本阶专属小层命名模板；空串 = 沿用分类。旧版快照缺省按空串处理 */
    subPattern: string
  }>
}

export interface NovelSettingExportPayload {
  version: number
  exportedAt: string
  categories: NovelSettingSnapshot[]
}

export interface NovelSettingTemplateDTO {
  id: string
  name: string
  createdAt: number
  categories: NovelSettingSnapshot[]
}

// ── 全局设定中心 DTO（1.4x，与 electron/handlers/novel-global-setting-handlers.ts 一致） ──

/** 全局设定等级项（结构对齐 NovelSettingLevelDTO） */
export interface NovelGlobalSettingLevelDTO {
  id: string
  categoryId: string
  name: string
  rank: number
  aliases: string[]
  note: string
  subLevels: number
  power: number | null
  parentId: string | null
  segFrom: number | null
  segTo: number | null
  subPattern: string
}

/** 全局设定分类：无 workId；带引用计数（列表徽标） */
export interface NovelGlobalSettingCategoryDTO {
  id: string
  name: string
  color: string
  kind: 'realm' | 'custom'
  sortOrder: number
  note: string
  subLevels: number
  carryDir: 'asc' | 'desc'
  subPattern: string
  levels: NovelGlobalSettingLevelDTO[]
  /** 有多少部书正在引用它（0 = 暂无引用） */
  refCount: number
}

export interface NovelGlobalSettingCategoryPatch {
  name?: string
  color?: string
  note?: string
  subLevels?: number
  carryDir?: 'asc' | 'desc'
  subPattern?: string
  /** 切换分类种类：设为 realm 时全局原境界体系自动降级为 custom（全库至多一个） */
  kind?: 'realm' | 'custom'
}

export interface NovelGlobalSettingLevelPatch {
  name?: string
  aliases?: string[]
  note?: string
  subLevels?: number
  power?: number | null
  subPattern?: string
}

/** D4 删除的返回载荷 */
export interface GlobalCategoryDeleteResult {
  ok: boolean
  /** confirm=false 时回传，供渲染层弹二次确认 */
  refCount: number
}

/** R12 引用方名单的一行：哪部书在引用某全局分类 */
export interface GlobalCategoryRef {
  workId: string
  workName: string
}

/** D3 上架的返回载荷 */
export interface PublishToGlobalResult {
  ok: boolean
  globalCategoryId?: string
  /** 命中同名分类：渲染层据此弹「新建副本 / 取消」 */
  conflict?: boolean
}

export interface NovelBundleDTO {
  works: NovelWorkDTO[]
  volumes: NovelVolumeDTO[]
  chapters: NovelChapterDTO[]
  entities: NovelEntityDTO[]
  links: NovelLinkDTO[]
  /** 小说设定：分类 + 其下的等级序列（kind='realm' 即境界体系） */
  settings: NovelSettingCategoryDTO[]
  notes: NovelNoteDTO[]
  outlineEntries: NovelOutlineEntryDTO[]
  recovery: { snapshotTime: number; deltaWords: number } | null
}

// ── 行囊 CharacterPack DTO（与 electron/handlers/novel-pack-handlers.ts 保持一致） ──

export type PackNatureDTO = "passive" | "sustained" | "cast"
export type PackOpDTO = "add" | "percent" | "mul" | "override"
export type PackOwnerTypeDTO = "item" | "skill" | "status"

export interface PackCharacterDTO {
  id: string
  workId: string
  name: string
  /**
   * 展示名 —— 绑定了主角实体时以实体的名字为准（单一事实源在要素库）。
   *
   * `name` 是播种时写死的 `'主角'`，只有「未绑定」时才代表什么。绑定后真实
   * 名字在 `novel_entities.name` 里，由主进程解析好下发，窗口侧直接用
   * `displayName` 渲染即可 —— 不必自己查实体表，也不会两边不一致。
   */
  displayName: string
  avatar: string
  isProtagonist: boolean
  /** 绑定的 EntityPanel 实体 id；空串 = 仅行囊内使用（不写 novel_links） */
  entityId: string
  /** 未绑定实体时的行囊内境界 JSON `{levelId, sub}` */
  realmAt: string
  note: string
  sortOrder: number
}

/**
 * 主角绑定读数。
 *
 * 「谁是主角」的唯一事实源就是 `novel_pack_characters.entity_id`：右侧要素栏的
 * 「设为主角」与行囊面板的「绑定实体」是两个入口，写的是同一格。
 */
export interface PackProtagonistDTO {
  characterId: string
  /** 空串表示尚未指定主角 */
  entityId: string
}

/** 属性定义（作品级预设，1.39.0 refactor 重构）：效果 / 映射 / 其它系统引用这里的 id */
export interface PackAttrDefDTO {
  id: string
  workId: string
  /** 机器名（空串 = 未设）：导入导出与跨系统按名解析用 */
  key: string
  name: string
  groupName: string
  unit: string
  decimals: number
  /** 新建角色实例时的初始 baseValue */
  defaultValue: number
  sortOrder: number
}

/** 属性数值（角色级实例）：展示字段一律从 `PackAttrDefDTO` 读 */
export interface PackAttributeDTO {
  id: string
  characterId: string
  /** 指向 `PackAttrDefDTO.id`；按「一角色一属性至多一行」的约定，id 恒等于 defId */
  defId: string
  baseValue: number
  /** 最近一次改动的落点时刻（REQ-028 本章变动角标）；0 = 从无改动记录 */
  updatedAt: number
}

/**
 * 属性映射（1.35.0）：每 1 点源属性 → 目标属性加算 `rate`
 * （「加 1 点力量，血量 +100」这类成长换算）。
 *
 * `rate` 为 0 视同「这条关着」—— 汇总里不算，也不报警告。因此**没有 enabled**：
 * 两种「关」（开关 + 系数 0）会让脏计数与「与本章初对比」都说不清哪个才是作者的意思。
 */
export interface PackMappingDTO {
  id: string
  characterId: string
  sourceAttrId: string
  targetAttrId: string
  /** 每 1 点源属性给目标属性加多少（可小数，如 0.5） */
  rate: number
  note: string
  sortOrder: number
  /** 最近一次改动的落点时刻（REQ-028 本章变动角标）；0 = 从无改动记录 */
  updatedAt: number
}

export interface PackSlotDTO {
  id: string
  characterId: string
  name: string
  capacity: number
  accepts: string[]
  enabled: boolean
  note: string
  sortOrder: number
}

/** 载体分组（1.39.0 二期）：条目分类维度 + 能力开关；条目 groupId 引用这里的 id */
export interface PackGroupDTO {
  id: string
  characterId: string
  name: string
  icon: string
  /** 组内条目可穿戴（接入 slots；部位 accepts 按组匹配） */
  canEquip: boolean
  /** 组内条目有载体级启停开关 */
  canEnable: boolean
  /** 绑定的熟练度体系（novel_pack_unit_systems.id）；'' = 该组无熟练度 */
  profSchemeId: string
  /** 组停用 = 闸门 0：组内全部条目的效果不计入汇总 */
  enabled: boolean
  sortOrder: number
}

export interface PackItemDTO {
  id: string
  characterId: string
  name: string
  category: string
  qty: number
  rarity: string
  icon: string
  desc: string
  tags: string[]
  equippedSlotId: string
  slotIndex: number | null
  /** 归属分组（PackGroupDTO.id）；'' = 未分组 */
  groupId: string
  /** 体系品阶（1.40.0）：novel_setting_levels.id；'' = 未标注 */
  gradeId: string
  sourceChapterId: string
  updatedAt: number
}

export interface PackSkillDTO {
  id: string
  characterId: string
  name: string
  desc: string
  enabled: boolean
  /** 归属分组（PackGroupDTO.id）；'' = 未分组 */
  groupId: string
  proficiencyRaw: number
  /** 体系品阶（1.40.0）：novel_setting_levels.id；'' = 未标注 */
  gradeId: string
  tags: string[]
  sortOrder: number
  /** 最近一次改动的落点时刻（REQ-028 本章变动角标）；0 = 从无改动记录 */
  updatedAt: number
}

/** 物品分类管理（1.40.0）：物品栏分类行，可绑定小说设定的等级体系 */
export interface PackCategoryDTO {
  id: string
  characterId: string
  name: string
  /** 绑定的设定分类（novel_setting_categories.id）；'' = 未绑定 */
  systemId: string
  sortOrder: number
}

/** 体系品阶投影（1.40.0）：设定域分类 → 行囊选品阶要的精简视图 */
export interface PackGradeSystemDTO {
  id: string
  name: string
  /** 只投影根阶（parent_id 为空），按 rank 升序 */
  levels: Array<{ id: string; name: string }>
}

export interface PackModifierDTO {
  id: string
  ownerType: PackOwnerTypeDTO
  ownerId: string
  nature: PackNatureDTO
  name: string
  /** 空串 = 不指向属性（cast 型） */
  targetAttrId: string
  op: PackOpDTO
  value: number
  valueUnit: string
  scaleByProficiency: boolean
  active: boolean
  defaultOn: boolean
  cost: string
  cooldown: number | null
  duration: string
  /** 剩余回合数（REQ-025 状态时效）；null = 不限时。到 0 即不再计入汇总 */
  roundsLeft: number | null
  target: string
  trigger: string
  condition: string
  note: string
  disabled: boolean
  sortOrder: number
}

/**
 * 换装方案（REQ-032）。
 *
 * `payload` 是 JSON 字符串，内容为穿戴映射
 * `[{ itemId, slotId, slotIndex }]` —— **只记「谁穿在哪个部位的哪一格」**，
 * 不挂物品快照：物品被删或改名之后方案仍然可读，套用时跳过错失的那几件并如实报数。
 * 保持字符串（而不是在这一层解析成对象数组）的理由同 `realmLink`：主进程只搬数据、
 * 不解释数据，条目结构将来要长字段时不必回来改两处。
 */
export interface PackPresetDTO {
  id: string
  characterId: string
  name: string
  payload: string
  note: string
  sortOrder: number
  updatedAt: number
}

export interface PackUnitSystemDTO {
  id: string
  characterId: string
  name: string
  kind: "ladder" | "ratio" | "threshold"
  /** JSON 字符串：三种模型各自的 level 列表 */
  levels: string
  config: string
  isDefault: boolean
  sortOrder: number
}

export interface PackLayoutDTO {
  characterId: string
  moduleKey: string
  enabled: boolean
  sortOrder: number
}

export interface PackRecordDTO {
  id: string
  characterId: string
  chapterId: string
  takenAt: number
  reason: string
  payload: string
}

export interface PackDraftDTO {
  characterId: string
  payload: string
  dirtyCount: number
  updatedAt: number
}

export interface PackRealmLinkDTO {
  id: string
  fromType: string
  fromId: string
  toType: string
  toId: string
  relation: string
  note: string
}

/** R25 等级项（含 v1.4 补的 subLevels / power，PRD §9.7.2） */
export interface PackLevelRungDTO {
  id: string
  name: string
  rank: number
  subLevels: number
  power: number | null
  /** 已拆出子层级：父阶是组，小层数由子层级决定（阶设置里不可改） */
  hasChildren?: boolean
  /**
   * 小层别名表（1.39.1）：下标 = 阶内层号 - 1，取子层级的首个别名（缺省回落段名）。
   * 仅拆出子层级的阶才有；空串表示该层没有可显示的别名。
   */
  subLabels?: string[]
  /**
   * 本阶生效的小层命名模板（1.4x）：自己的为空则沿用分类的。主进程对 `{n}` 模板
   * **不**生成 subLabels（编号不是名字），渲染层据此现场渲染「第七层」这类小层名。
   */
  subPattern?: string
}

export interface PackLevelSystemDTO {
  id: string
  workId: string
  name: string
  rungs: PackLevelRungDTO[]
}

export interface PackBundleDTO {
  character: PackCharacterDTO | null
  /** 属性定义（作品级）：这条 bundle 的「属性模型」 */
  attrDefs: PackAttrDefDTO[]
  /** 属性数值（角色级实例，defId 引用 attrDefs） */
  attributes: PackAttributeDTO[]
  /** 属性映射（1.35.0） */
  mappings: PackMappingDTO[]
  slots: PackSlotDTO[]
  /** 载体分组（1.39.0 二期）：条目 groupId 引用这里的 id */
  groups: PackGroupDTO[]
  /** 物品分类管理（1.40.0）：item.category 按名字引用这里的行 */
  categories: PackCategoryDTO[]
  items: PackItemDTO[]
  skills: PackSkillDTO[]
  modifiers: PackModifierDTO[]
  unitSystems: PackUnitSystemDTO[]
  layouts: PackLayoutDTO[]
  presets: PackPresetDTO[]
  records: PackRecordDTO[]
  draft: PackDraftDTO | null
  levelSystems: PackLevelSystemDTO[]
  /** 体系品阶投影（1.40.0）：设定域全部分类的根阶清单，物品 / 技能选品阶用 */
  gradeSystems: PackGradeSystemDTO[]
  realmLink: PackRealmLinkDTO | null
}

export interface PackSavePayloadDTO {
  character: PackCharacterDTO
  /** 属性定义（作品级）：整文档随草稿走，保存时按 workId 整体替换 */
  attrDefs: PackAttrDefDTO[]
  /** 属性数值（角色级实例） */
  attributes: PackAttributeDTO[]
  /** 属性映射（1.35.0）：与属性同属「设定数据」，整文档一起走草稿与盘点 */
  mappings: PackMappingDTO[]
  slots: PackSlotDTO[]
  /** 载体分组（1.39.0 二期） */
  groups: PackGroupDTO[]
  /** 物品分类管理（1.40.0）：与其它表一样属于整文档 */
  categories: PackCategoryDTO[]
  items: PackItemDTO[]
  skills: PackSkillDTO[]
  modifiers: PackModifierDTO[]
  unitSystems: PackUnitSystemDTO[]
  layouts: PackLayoutDTO[]
  presets: PackPresetDTO[]
  /**
   * 「当前境界」关联行，随整文档保存同事务写入（避免半保存态）。
   * `null` = 本次不改动关联行（未绑定主角 / 与上次保存态无差异）。
   */
  realmLink: PackRealmLinkDTO | null
  reason: string
  chapterId: string
}

// ── 备份包 DTO（todo/memo zip 备份导出导入，与 electron/backup-utils.ts 一致） ──

export interface BackupExportResult {
  /** 用户在保存框点取消时为 true */
  canceled: boolean;
  /** 取消时为 null */
  filePath: string | null;
  /** 实际打包的条数（待办条数 / 备忘篇数） */
  count: number;
}

export interface BackupImportResult {
  /** 用户在打开框点取消时为 true */
  canceled: boolean;
  /** 实际写入的条数（追加合并） */
  count: number;
  /** 包内存在但未能写入的条目名（备忘重名自动改写不算跳过） */
  skipped: string[];
}

// ── 打卡 DTO（与 electron/handlers/checkin-handlers.ts 保持一致） ──

/** 当前业务日打卡状态；凌晨 0-5 点归属前一个业务日，跨过 5 点自动重置 */
export interface CheckinStatusDTO {
  /** 当前业务日（YYYY-MM-DD） */
  date: string;
  /** 当前业务日是否已打卡 */
  checkedIn: boolean;
  /** 下一次重置时刻（本地 ISO 字符串，恒为将来某个 5:00 整） */
  resetAt: string;
}

/** 打卡结果：created 为 false 表示当前业务日已打过（幂等） */
export interface CheckinResultDTO {
  /** 本次打卡归属的业务日（YYYY-MM-DD） */
  date: string;
  created: boolean;
}

// ── 记账 DTO（与 electron/handlers/ledger-handlers.ts 保持一致） ──

/** v1 仅暴露支出 / 收入；transfer 为数据模型预留，UI 不提供入口 */
export type LedgerTxTypeDTO = "expense" | "income" | "transfer";

export interface LedgerTransactionDTO {
  id: string;
  type: LedgerTxTypeDTO;
  /** 金额恒为正数（元），方向由 type 决定 */
  amount: number;
  currency: string;
  categoryId: string | null;
  accountId: string | null;
  toAccountId: string | null;
  note: string;
  /** 本地时间 `YYYY-MM-DD HH:mm:ss` */
  happenedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerCategoryDTO {
  id: string;
  name: string;
  /** antd 图标名，渲染进程映射为组件 */
  icon: string;
  /** `--app-*` 变量名，四主题自动跟随 */
  color: string;
  type: "expense" | "income" | "both";
  /** 内置预设分类不可删除 */
  builtin: boolean;
  sort: number;
  archived: boolean;
}

/** 周期查询区间（YYYY-MM-DD，闭区间） */
export interface LedgerRangeDTO {
  start?: string;
  end?: string;
}

export interface ElectronAPI {
  /** 网络会话配置（一次性）：写入认证 Cookie 到 session jar */
  httpSession: {
    setCookie: (url: string, cookie: string) => Promise<boolean>
  }

  // ── 活动管理 ──
  activity: {
    list: () => Promise<ActivityRow[]>
    listByDate: (date: string) => Promise<ActivityRow[]>
    activeDates: (start: string, end: string) => Promise<string[]>
    add: (params: ActivityAddParams) => Promise<ActivityAddParams>
    update: (params: { id: string; updates: ActivityUpdateParams }) => Promise<void>
    delete: (id: string) => Promise<void>
  }

  // ── Todo 管理 ──
  todo: {
    list: () => Promise<TodoRow[]>
    add: (content: string, workHour: number | null) => Promise<{ lastInsertRowid: number }>
    addChild: (parentId: number, content: string, workHour: number | null) => Promise<void>
    delete: (id: number) => Promise<void>
    updateContent: (id: number, content: string, workHour: number | null) => Promise<void>
    updateNote: (id: number, note: string | null) => Promise<void>
    deleteNote: (id: number) => Promise<void>
    updateWorkHour: (id: number, workHour: number | null) => Promise<void>
    deleteWorkHour: (id: number) => Promise<void>
    toggleImportant: (id: number, important: number) => Promise<void>
    toggle: (id: number, checked: boolean) => Promise<void>
    toggleChild: (id: number, checked: boolean) => Promise<void>
    toggleParent: (id: number, checked: boolean) => Promise<void>
    // ── 备份包（zip：manifest + todos.json，追加合并导入） ──
    exportBackup: () => Promise<BackupExportResult>
    importBackup: () => Promise<BackupImportResult>
  }

  user: {
    get: () => Promise<{ id: number; email: string } | null>
    login: (email: string) => Promise<boolean>
    update: (email: string) => Promise<boolean>
  }

  // ── 小说编辑器（数据存 userDb 的 novel_* 表） ──
  novel: {
    /** includeContent=false 时不返回章节正文（书架只要元数据，避免拉全书正文过 IPC） */
    editorLoad: (includeContent?: boolean) => Promise<NovelBundleDTO>
    /** 开启编辑器会话：崩溃恢复标记的唯一写入口（只有真正进入编辑器才调） */
    sessionOpen: () => Promise<boolean>
    /** 读取 userDb config（R5 设置持久化 / R6 位置记忆共用；键不存在返回 null） */
    configGet: (key: string) => Promise<string | null>
    configSet: (key: string, value: string) => Promise<boolean>
    addWork: (work: NovelWorkDTO) => Promise<boolean>
    renameWork: (id: string, name: string) => Promise<boolean>
    deleteWork: (id: string) => Promise<boolean>
    /** 一键重置为模板书籍（调试）：清空全部 novel_* 表并重新播种，返回摘要 */
    resetTemplate: () => Promise<{ volumes: number; chapters: number; words: number; entities: number }>
    saveChapter: (id: string, content: string, wordCount: number) => Promise<boolean>
    listSnapshots: (chapterId: string) => Promise<NovelSnapshotDTO[]>
    addChapter: (chapter: NovelChapterDTO) => Promise<boolean>
    renameChapter: (id: string, title: string) => Promise<boolean>
    deleteChapter: (id: string) => Promise<boolean>
    setChapterStatus: (id: string, status: "draft" | "done") => Promise<boolean>
    saveChapterOutline: (id: string, note: string) => Promise<boolean>
    saveChapterOrder: (updates: Array<{ id: string; sort: number; volumeId: string }>) => Promise<boolean>
    addVolume: (volume: NovelVolumeDTO) => Promise<boolean>
    renameVolume: (id: string, name: string) => Promise<boolean>
    saveVolumeOrder: (updates: Array<{ id: string; sort: number }>) => Promise<boolean>
    deleteVolume: (id: string) => Promise<boolean>
    saveEntity: (entity: NovelEntityDTO) => Promise<boolean>
    addLink: (link: NovelLinkDTO) => Promise<boolean>
    removeLink: (id: string) => Promise<boolean>
    /**
     * 关系图提交（R27 / S3）：新建关系 + 改备注 + 画布文档，**单事务**。
     * 任一步失败整体回滚，返回 `ok:false` 与失败码（stale / invalid-target / db）。
     */
    graphCommit: (request: NovelGraphCommitRequest) => Promise<NovelGraphCommitResult>
    /**
     * 取景：把当前窗口的某一块截成 PNG（R27 / S5）。
     * rect 单位是 DIP（= CSS px），像素尺寸由主进程从 PNG 头回读（= CSS × DPR）。
     */
    captureWindow: (rect: RelationCaptureRect) => Promise<RelationCaptureResult>
    /**
     * 二进制落盘：只收字节（PNG 等），取消返回 null。
     * ⚠️ 不要换成 `exportFile` —— 那条按 utf8 写，写 PNG 会损坏且不报错。
     */
    exportBinary: (
      defaultName: string,
      data: Uint8Array,
      ext?: string,
      filterName?: string,
    ) => Promise<{ path: string } | null>
    saveNote: (note: NovelNoteDTO) => Promise<boolean>
    removeNote: (id: string) => Promise<boolean>
    /** 灵感归属迁移（书架全局灵感库）：归档到作品；workId 传 '' 退回未归属池 */
    moveNote: (id: string, workId: string) => Promise<boolean>
    saveOutlineEntry: (entry: NovelOutlineEntryDTO) => Promise<boolean>
    removeOutlineEntry: (id: string) => Promise<boolean>
    // ── 小说设定（1.36.0：统一取代原等级体系管理） ──
    /** 新建分类。作品已有境界体系时 kind='realm' 会被降级为 'custom'（每书至多一个） */
    settingCategoryAdd: (workId: string, id: string, name: string, kind: 'realm' | 'custom', color?: string) =>
      Promise<{ id: string; kind: 'realm' | 'custom' } | null>
    settingCategoryUpdate: (id: string, patch: NovelSettingCategoryPatch) => Promise<boolean>
    settingCategoryDelete: (id: string) => Promise<boolean>
    settingCategoryOrder: (updates: Array<{ id: string; sortOrder: number }>) => Promise<boolean>
    /** index 为插入位置（0-based）；-1 追加到末尾。原位置及之后的 rank 自动 +1 */
    settingLevelAdd: (categoryId: string, id: string, name: string, index: number) =>
      Promise<{ id: string; rank: number } | null>
    /** 批量新增等级项：全部追加到末尾，返回实际插入条数（1.37.0） */
    settingLevelBatchAdd: (categoryId: string, items: Array<{ id: string; name: string; subLevels?: number; subPattern?: string }>) =>
      Promise<number>
    settingLevelUpdate: (id: string, patch: NovelSettingLevelPatch) => Promise<boolean>
    settingLevelDelete: (id: string) => Promise<boolean>
    settingLevelOrder: (updates: Array<{ id: string; rank: number }>) => Promise<boolean>
    /** 拆分层级：第一段复用原 id（绑定不失效），其余新建并挂 parent_id */
    settingLevelSplit: (levelId: string, segments: Array<{ name: string; from: number; to: number }>) => Promise<boolean>
    /** 合并：拆分的逆操作，删掉全部派生段、层段还给本体 */
    settingLevelMerge: (levelId: string) => Promise<boolean>
    settingExport: (workId: string) => Promise<NovelSettingExportPayload>
    settingImport: (workId: string, payload: unknown, mode: 'merge' | 'replace') =>
      Promise<{ imported: number; skipped: number }>
    settingTemplateList: () => Promise<NovelSettingTemplateDTO[]>
    settingTemplateSave: (id: string, name: string, workId: string, categoryIds: string[]) => Promise<boolean>
    settingTemplateApply: (templateId: string, workId: string) => Promise<number>
    settingTemplateDelete: (id: string) => Promise<boolean>
    // ── 全局设定中心（1.4x）：全局库 CRUD + 导出 ──
    globalSettingLoad: () => Promise<{ categories: NovelGlobalSettingCategoryDTO[] }>
    globalCategoryAdd: (id: string, name: string, kind: 'realm' | 'custom', color?: string) =>
      Promise<{ id: string; kind: 'realm' | 'custom' } | null>
    globalCategoryUpdate: (id: string, patch: NovelGlobalSettingCategoryPatch) => Promise<boolean>
    /** confirm 缺省 / 非 true 时只回传 refCount 供二次确认，不删除（D4） */
    globalCategoryDelete: (id: string, confirm?: boolean) => Promise<GlobalCategoryDeleteResult>
    globalCategoryOrder: (updates: Array<{ id: string; sortOrder: number }>) => Promise<boolean>
    globalLevelAdd: (categoryId: string, id: string, name: string, index: number) =>
      Promise<{ id: string; rank: number } | null>
    globalLevelBatchAdd: (categoryId: string, items: Array<{ id: string; name: string; subLevels?: number; subPattern?: string }>) =>
      Promise<number>
    globalLevelUpdate: (id: string, patch: NovelGlobalSettingLevelPatch) => Promise<boolean>
    globalLevelDelete: (id: string) => Promise<boolean>
    globalLevelOrder: (updates: Array<{ id: string; rank: number }>) => Promise<boolean>
    globalLevelSplit: (levelId: string, segments: Array<{ name: string; from: number; to: number }>) => Promise<boolean>
    globalLevelMerge: (levelId: string) => Promise<boolean>
    globalSettingExport: () => Promise<NovelSettingExportPayload>
    /** 某全局分类被哪几部书引用（只读；preload 缺通道时渲染层要按空名单兜底） */
    globalCategoryRefs: (categoryId: string) => Promise<GlobalCategoryRef[]>
    // ── 全局设定中心：本书「引用 / 上架」 ──
    /** 本书引用一个全局分类（建立镜像，实时同步）；已引用幂等返回 true */
    referenceGlobal: (workId: string, globalCategoryId: string) => Promise<boolean>
    /** 本书分类上架到全局（复制快照）；同名冲突由 conflict 决定 */
    publishGlobal: (workId: string, categoryId: string, conflict: 'duplicate' | 'cancel') =>
      Promise<PublishToGlobalResult>
    // ── 书籍导入（TXT）：主进程只负责选文件 + 读字节 / 批量落库 ──
    /** 弹文件选择框并读回字节；用户取消返回 null */
    importPickFile: () => Promise<{ fileName: string; bytes: ArrayBuffer; size: number } | null>
    /** 解析结果单事务落库（作品 + 卷 + 章）；失败返回 { ok: false, error } */
    importBook: (payload: {
      work: NovelWorkDTO
      volumes: Array<{ id: string; name: string; sort: number }>
      chapters: Array<{
        id: string
        volumeId: string
        title: string
        content: string
        wordCount: number
        sort: number
      }>
    }) => Promise<{ ok: boolean; chapterCount: number; wordCount: number } | { ok: false; error: string }>
    // ── 导出（R13 / 行囊 REQ-030）：主进程弹保存框 + 写盘；用户取消返回 null ──
    /** ext 缺省为 txt；传 "md" + 「Markdown」即导出 .md（同一通道，不再另开一条） */
    exportFile: (
      defaultName: string,
      content: string,
      ext?: string,
      filterName?: string,
    ) => Promise<{ path: string } | null>
    // ── 使用埋点（R14） ──
    /** 今日新增字数（chapter_save 事件 delta 净增）、保存次数与连续码字天数，0 点按主进程本地时间 */
    usageToday: () => Promise<{ todayWords: number; saveCount: number; streakDays: number }>
    usageLog: (event: string, payload: Record<string, unknown>) => Promise<boolean>
    // ── 行囊 CharacterPack（PRD v1.5，文档已归档） ──
    pack: {
      load: (workId: string) => Promise<PackBundleDTO>
      /** 整文档事务保存：写前先落回退点、成功后清空草稿；false 表示已整体回滚 */
      save: (payload: PackSavePayloadDTO) => Promise<boolean>
      draftSet: (characterId: string, payload: string, dirtyCount: number) => Promise<boolean>
      draftClear: (characterId: string) => Promise<boolean>
      recordList: (characterId: string, limit?: number) => Promise<PackRecordDTO[]>
      /** 境界幂等写入（同一来源+关系只保留一行） */
      linkSet: (link: {
        id: string
        fromType: string
        fromId: string
        toType: string
        toId: string
        relation: string
        note?: string
      }) => Promise<boolean>
      /** 主角绑定读数：null 表示该作品还没建过行囊角色 */
      protagonistGet: (workId: string) => Promise<PackProtagonistDTO | null>
      /** 设为主角 / 解除主角：entityId 传空串即解绑 */
      protagonistSet: (workId: string, entityId: string) => Promise<boolean>
      /**
       * 改主角名 —— 绑定了实体就改实体名，未绑定才改行囊内那格。
       * 返回真实落点，调用方据此渲染（不靠本地猜测）。
       */
      rename: (
        workId: string,
        name: string,
      ) => Promise<{ ok: boolean; displayName: string; target: "entity" | "character" }>
      /**
       * 快速记账（REQ-027）：正文选区 → 记入背包，供**面板未挂载**时使用。
       * 主进程按「有草稿并入草稿、没有才直插正式表」落库（草稿优先于正式行）。
       */
      quickAdd: (
        workId: string,
        name: string,
        chapterId: string,
        category: string,
      ) => Promise<{ id: string; characterId: string } | null>
    }
  }

  send: (channel: string, data: unknown) => void
  /** 返回取消订阅函数，用于组件卸载时移除监听 */
  receive: (channel: string, func: (...args: unknown[]) => void) => () => void

  // ── 跨窗口通信 ──
  windowAPI: {
    broadcast: (event: string, data?: unknown) => Promise<void>
    /**
     * 向指定窗口投递消息。目标窗口不存在时可 `create`（先拉起）或 `queue`
     * （入队，窗口起来后由 preload 补投）。`delivered=false` = 既送不到也拉不起来。
     */
    sendTo: (
      target: string,
      event: string,
      data?: unknown,
      raise?: boolean,
      options?: { create?: boolean; queue?: boolean },
    ) => Promise<{ delivered: boolean; queued: boolean }>
    on: (event: string, handler: (...args: unknown[]) => void) => void
    off: (event: string, handler: (...args: unknown[]) => void) => void
    /** 关闭守卫：有未保存改动时武装本窗口（`electron/close-guard.ts`） */
    setCloseGuard: (enabled: boolean) => void
    /** 答复主进程的关闭询问（true = 放行，可以关闭 / 退出） */
    respondClose: (allow: boolean) => void
  }

  memo: {
    list: () => Promise<{ name: string; updatedAt: string }[]>
    read: (filename: string) => Promise<string>
    write: (filename: string, content: string) => Promise<boolean>
    rename: (oldFilename: string, newFilename: string) => Promise<boolean>
    delete: (filename: string) => Promise<boolean>
    openInExplorer: (filename: string) => Promise<boolean>
    import: () => Promise<string[]>
    exportFile: (filename: string, format: "txt" | "docx") => Promise<boolean>
    // ── 备份包（zip：manifest + memos/*.md，追加合并导入、重名自动改写） ──
    exportBackup: () => Promise<BackupExportResult>
    importBackup: () => Promise<BackupImportResult>
  }

  findInPage: (value?: string) => Promise<boolean>

  // ── 记账 ──
  ledger: {
    /** 列出流水；传区间时按发生日期过滤，倒序返回 */
    listTransactions: (range?: LedgerRangeDTO) => Promise<LedgerTransactionDTO[]>
    /** 记一笔，返回写库后的完整记录 */
    addTransaction: (tx: LedgerTransactionDTO) => Promise<LedgerTransactionDTO | null>
    /** 局部更新，键见 handler 白名单（type/amount/categoryId/note/happenedAt…） */
    updateTransaction: (id: string, updates: Record<string, unknown>) => Promise<boolean>
    deleteTransaction: (id: string) => Promise<boolean>
    listCategories: () => Promise<LedgerCategoryDTO[]>
    upsertCategory: (category: LedgerCategoryDTO) => Promise<boolean>
    /** 删除分类，历史流水重指派到 fallbackId（「其他」） */
    deleteCategory: (id: string, fallbackId: string) => Promise<boolean>
  }

  // ── 打卡 ──
  checkin: {
    /** 查询当前业务日打卡状态（含下次重置时刻 resetAt） */
    status: () => Promise<CheckinStatusDTO>
    /** 为当前业务日打卡（幂等；重复打卡返回 created: false） */
    today: () => Promise<CheckinResultDTO>
    /** 区间内已打卡的业务日列表（闭区间，YYYY-MM-DD 升序） */
    dates: (start: string, end: string) => Promise<string[]>
  }

  // ── 本地日志（渲染层上报 → 主进程按「用户 × 窗口」落盘） ──
  log: {
    /** 写一条日志；窗口名由主进程从 webContents 反查，渲染层不传 */
    write: (entry: {
      level: "debug" | "info" | "warn" | "error"
      module: string
      message: string
      meta?: unknown
    }) => Promise<boolean>
    getConfig: () => Promise<LogSettingsDTO>
    setConfig: (patch: Partial<LogSettingsDTO>) => Promise<LogSettingsDTO>
    /** 用系统文件管理器打开日志目录（传窗口名则打开该窗口的子目录） */
    openDir: (windowName?: string) => Promise<boolean>
    /** 身份变化后重算目录（登录 / 改邮箱 / 登出），返回新的根目录 */
    switchUser: (reason: string) => Promise<string>
  }

  // ── 快捷键（配置存 userDb config 表；应用级键由主进程 globalShortcut 注册） ──
  shortcut: {
    get: () => Promise<ShortcutConfigDTO>
    set: (config: ShortcutConfigDTO) => Promise<{
      config: ShortcutConfigDTO
      /** 注册失败（被系统或其他应用占用）的应用级快捷键 id */
      globalFailures: string[]
    }>
  }
}

/** 快捷键持久化载荷（键 novel_shortcuts） */
export interface ShortcutConfigDTO {
  /** 快捷键 id → 平台中立键位（`Mod+Shift+B`） */
  bindings: Record<string, string>
  /** 已启用「应用外也生效」的 id 列表 */
  globals: string[]
}

/** 日志配置（存 userDb 的 config 表，键 log_settings） */
export interface LogSettingsDTO {
  /** 主日志文件的最低级别；ipc.log 不受它限制 */
  level: "debug" | "info" | "warn" | "error"
  /** 是否记录 IPC 失败 / 慢调用 */
  ipc: boolean
  /** 日志保留天数（1–90） */
  retentionDays: number
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
