/**
 * 「行囊」（CharacterPack）语义化 IPC handlers
 *
 * 需求来源：docs/character-pack-prd.md（v1.5）
 * 职责：
 * - 行囊全量装载（novel-pack-load）：一次拿齐 character / 属性 / 部位 / 物品 /
 *   技能 / 效果 / 量纲 / 模块布局 / 盘点记录 / 草稿，外加 R25 等级体系与当前境界绑定
 *   —— 面板自带数据装载，只依赖 workId 一个入参，便于未来迁移为独立窗口（§9.1）
 * - 整文档事务保存（novel-pack-save）：**写前先对原状态生成盘点记录**（§8.6 回退点），
 *   再整体替换，任一步失败整体回滚（REQ-045），成功后清空草稿
 * - 草稿读写（novel-pack-draft-get/set/clear）：草稿落主进程表，跨窗口一致、崩溃不丢（§8.6.2）
 * - 盘点记录（novel-pack-record-list）
 * - 境界幂等写入（novel-link-set）：避免前端自行判断 add/remove（§9.7.3）
 * - 等级项补列写入（novel-level-meta-set）：sub_levels / power（§9.7.2）
 *
 * 边界：SQL 只出现在本文件与 db.ts；不导入 main.ts。
 *
 * 存储：全部落在 **novel.db**（`electron/novel-db.ts`），与 checkin.db 分离。
 * 本文件的 `dbAll / dbGet / dbRun / getDb` 都是 novel.db 的封装别名 ——
 * 改动时不要从 checkin 的 `../db` 导入写通道，那会把数据写回 checkin 库里去。
 */
import { ipcMain } from "electron";
import {
  novelAll as dbAll,
  novelGet as dbGet,
  novelRun as dbRun,
  getNovelDb as getDb,
  isNovelDbReady,
} from "../novel-db";

// ── 行类型（snake_case） ──

interface PackCharacterRow {
  id: string;
  work_id: string;
  name: string;
  avatar: string | null;
  is_protagonist: number;
  entity_id: string | null;
  realm_at: string | null;
  note: string;
  sort_order: number;
}

/** 属性数值行（角色级实例）；定义在 `novel_pack_attr_defs`，见 novel-db.ts */
interface PackAttributeRow {
  id: string;
  character_id: string;
  def_id: string;
  base_value: number;
  updated_at: number;
}

/** 属性定义行（作品级预设，1.39.0 refactor 重构） */
interface PackAttrDefRow {
  id: string;
  work_id: string;
  key: string | null;
  name: string;
  group_name: string;
  unit: string;
  decimals: number;
  default_value: number;
  sort_order: number;
}

interface PackSlotRow {
  id: string;
  character_id: string;
  name: string;
  capacity: number;
  accepts: string;
  enabled: number;
  note: string;
  sort_order: number;
}

/**
 * 载体分组行（1.39.0 二期）：物品 / 技能的分类维度 + 能力开关。
 *
 * 能力开关决定条目编辑器渲染统一模板的哪几块：
 * can_equip=1 的组内物品才能显示穿戴块；can_enable=0 的组内条目没有载体开关；
 * prof_scheme_id 绑定该组的熟练度体系（可空 = 该组无熟练度，Phase 3 转正）。
 */
interface PackGroupRow {
  id: string;
  character_id: string;
  name: string;
  icon: string;
  can_equip: number;
  can_enable: number;
  prof_scheme_id: string | null;
  enabled: number;
  sort_order: number;
}

/**
 * 属性映射（1.35.0）：每 1 点 `source_attr_id` → `target_attr_id` 加算 `rate`。
 *
 * 没有 `enabled` 列：关掉一条映射就是把 `rate` 设成 0（见 novel-db.ts 的注释）。
 */
interface PackMappingRow {
  id: string;
  character_id: string;
  source_attr_id: string;
  target_attr_id: string;
  rate: number;
  note: string;
  sort_order: number;
  updated_at: number;
}

interface PackItemRow {
  id: string;
  character_id: string;
  name: string;
  category: string;
  qty: number;
  rarity: string;
  icon: string;
  desc: string;
  tags: string;
  equipped_slot_id: string | null;
  slot_index: number | null;
  /** 归属分组（novel_pack_groups.id）；'' = 未分组 */
  group_id: string;
  /** 体系品阶（1.40.0）：novel_setting_levels.id；'' = 未标注 */
  grade_id: string;
  source_chapter_id: string | null;
  updated_at: number;
}

interface PackSkillRow {
  id: string;
  character_id: string;
  name: string;
  desc: string;
  enabled: number;
  /** 归属分组（novel_pack_groups.id）；'' = 未分组 */
  group_id: string;
  proficiency_raw: number;
  /** 体系品阶（1.40.0）：novel_setting_levels.id；'' = 未标注 */
  grade_id: string;
  tags: string;
  sort_order: number;
  updated_at: number;
}

/** 物品分类管理（1.40.0）：可改名的分类行 + 可绑定的设定体系 */
interface PackCategoryRow {
  id: string;
  character_id: string;
  name: string;
  system_id: string;
  sort_order: number;
}

interface PackModifierRow {
  id: string;
  owner_type: string;
  owner_id: string;
  nature: string;
  name: string;
  target_attr_id: string | null;
  op: string;
  value: number;
  value_unit: string | null;
  scale_by_proficiency: number;
  active: number;
  default_on: number;
  cost: string | null;
  cooldown: number | null;
  duration: string | null;
  rounds_left: number | null;
  target: string | null;
  trigger: string | null;
  condition: string | null;
  note: string;
  disabled: number;
  sort_order: number;
}

interface PackPresetRow {
  id: string;
  character_id: string;
  name: string;
  payload: string;
  note: string;
  sort_order: number;
  updated_at: number;
}

interface PackUnitSystemRow {
  id: string;
  character_id: string;
  name: string;
  kind: string;
  levels: string;
  config: string;
  is_default: number;
  sort_order: number;
}

interface PackLayoutRow {
  character_id: string;
  module_key: string;
  enabled: number;
  sort_order: number;
}

interface PackRecordRow {
  id: string;
  character_id: string;
  chapter_id: string | null;
  taken_at: number;
  reason: string;
  payload: string;
}

interface PackDraftRow {
  character_id: string;
  payload: string;
  dirty_count: number;
  updated_at: number;
}

/**
 * 草稿 payload 的形状：与渲染层 `PackDoc` 同构。
 *
 * 索引签名是**刻意的**：新增字段（attributes / skills / …）会原样透传，
 * 快速记账不需要跟着改；但 `items` 必须显式声明，否则「往草稿里塞一件物品」
 * 这一步就失去了类型约束。
 */
interface PackDraftDoc {
  items?: PackItemDto[];
  [key: string]: unknown;
}

interface NovelSettingLevelRow2 {
  id: string;
  category_id: string;
  name: string;
  rank: number;
  sub_levels: number;
  power: number | null;
  /** 别名（JSON TEXT）：小层别名 chip 取首个别名（1.39.1） */
  aliases?: string;
  /** 本阶专属小层命名模板（1.37.0）；空串 = 沿用分类的 sub_pattern */
  sub_pattern?: string;
  /** 拆分子层级（1.38.1）：非空 = 本行是某个父阶的派生段 */
  parent_id?: string | null;
  seg_from?: number | null;
  seg_to?: number | null;
}

interface NovelSettingCategoryRow2 {
  id: string;
  work_id: string;
  name: string;
  /** 分类级小层命名模板（1.36.0 建列时默认 '第{n}层'） */
  sub_pattern?: string;
}

interface NovelLinkRow2 {
  id: string;
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  relation: string;
  note: string | null;
}

// ── DTO（camelCase，IPC 线格式） ──

export interface PackCharacterDto {
  id: string;
  workId: string;
  name: string;
  /**
   * 展示名 —— **绑定了主角实体时以实体的名字为准**（单一事实源在要素库）。
   *
   * 为什么不让渲染层自己拼：`name` 是播种时写死的 `'主角'`，只有「未绑定」
   * 时才代表什么。绑定后真实名字在 `novel_entities` 里，渲染层没有那条查询，
   * 让它自己拼就得把实体表暴露到窗口侧。
   *
   * 未绑定时 `displayName === name`（即 `'主角'` 或作者在行囊里改的名）。
   */
  displayName: string;
  avatar: string;
  isProtagonist: boolean;
  /** 绑定的 EntityPanel 实体（novel_entities.id）；空串 = 仅行囊内使用 */
  entityId: string;
  /** 未绑定实体时的行囊内境界（JSON 字符串 `{levelId, sub}`） */
  realmAt: string;
  note: string;
  sortOrder: number;
}

/** 主角绑定读数：`entityId` 为空串表示尚未指定主角 */
export interface PackProtagonistDto {
  characterId: string;
  entityId: string;
}

/** 属性数值（角色级实例）。展示字段（name / unit / …）一律从定义读 —— 见 `PackAttrDefDto` */
export interface PackAttributeDto {
  id: string;
  characterId: string;
  /** 指向 `novel_pack_attr_defs.id`；按「一角色一属性至多一行」的约定，id 恒等于 defId */
  defId: string;
  baseValue: number;
  /** 最近一次改动的落点时刻（REQ-028 本章变动角标）；0 = 从无改动记录 */
  updatedAt: number;
}

/** 属性定义（作品级预设）：效果 / 映射 / 其它系统引用这里的 id */
export interface PackAttrDefDto {
  id: string;
  workId: string;
  /** 机器名（可空）：导入导出与跨系统按名解析用 */
  key: string;
  name: string;
  groupName: string;
  unit: string;
  decimals: number;
  /** 新建角色实例时的初始 baseValue */
  defaultValue: number;
  sortOrder: number;
}

/**
 * 属性映射（1.35.0）。
 *
 * `rate` 为 0 视同「这条关着」—— 汇总里不算，也不报警告（用户是主动关的，
 * 不是配错了）。因此没有 `enabled` 字段。
 */
export interface PackMappingDto {
  id: string;
  characterId: string;
  sourceAttrId: string;
  targetAttrId: string;
  /** 每 1 点源属性给目标属性加多少（可小数） */
  rate: number;
  note: string;
  sortOrder: number;
  /** 最近一次改动的落点时刻（REQ-028 本章变动角标）；0 = 从无改动记录 */
  updatedAt: number;
}

export interface PackSlotDto {
  id: string;
  characterId: string;
  name: string;
  capacity: number;
  accepts: string[];
  enabled: boolean;
  note: string;
  sortOrder: number;
}

/** 载体分组（1.39.0 二期）：条目分类维度 + 能力开关；条目行上的 groupId 指向这里的 id */
export interface PackGroupDto {
  id: string;
  characterId: string;
  name: string;
  icon: string;
  /** 组内条目可穿戴（接入 slots；部位 accepts 按组匹配） */
  canEquip: boolean;
  /** 组内条目有载体级启停开关 */
  canEnable: boolean;
  /** 绑定的熟练度体系（novel_pack_unit_systems.id）；'' = 该组无熟练度 */
  profSchemeId: string;
  /** 组停用 = 闸门 0：组内全部条目的效果不计入汇总 */
  enabled: boolean;
  sortOrder: number;
}

export interface PackItemDto {
  id: string;
  characterId: string;
  name: string;
  category: string;
  qty: number;
  rarity: string;
  icon: string;
  desc: string;
  tags: string[];
  equippedSlotId: string;
  slotIndex: number | null;
  /** 归属分组（novel_pack_groups.id）；'' = 未分组 */
  groupId: string;
  /** 体系品阶（1.40.0）：novel_setting_levels.id；'' = 未标注 */
  gradeId: string;
  sourceChapterId: string;
  updatedAt: number;
}

export interface PackSkillDto {
  id: string;
  characterId: string;
  name: string;
  desc: string;
  enabled: boolean;
  /** 归属分组（novel_pack_groups.id）；'' = 未分组 */
  groupId: string;
  proficiencyRaw: number;
  /** 体系品阶（1.40.0）：novel_setting_levels.id；'' = 未标注 */
  gradeId: string;
  tags: string[];
  sortOrder: number;
  /** 最近一次改动的落点时刻（REQ-028 本章变动角标）；0 = 从无改动记录 */
  updatedAt: number;
}

/** 物品分类管理（1.40.0）：物品栏分类行，可绑定小说设定的等级体系 */
export interface PackCategoryDto {
  id: string;
  characterId: string;
  name: string;
  /** 绑定的设定分类（novel_setting_categories.id）；'' = 未绑定 */
  systemId: string;
  sortOrder: number;
}

/** 体系品阶投影（1.40.0）：设定域分类 → 行囊选品阶要的精简视图 */
export interface PackGradeSystemDto {
  id: string;
  name: string;
  /** 只投影根阶（parent_id 为空），按 rank 升序 */
  levels: Array<{ id: string; name: string }>;
}

export type PackNature = "passive" | "sustained" | "cast";
export type PackOp = "add" | "percent" | "mul" | "override";
export type PackOwnerType = "item" | "skill" | "status";

export interface PackModifierDto {
  id: string;
  ownerType: PackOwnerType;
  ownerId: string;
  nature: PackNature;
  name: string;
  /** 空串 = 不指向属性（cast 型） */
  targetAttrId: string;
  op: PackOp;
  value: number;
  valueUnit: string;
  scaleByProficiency: boolean;
  active: boolean;
  defaultOn: boolean;
  cost: string;
  cooldown: number | null;
  duration: string;
  /** 剩余回合数（REQ-025）；null = 不限时 */
  roundsLeft: number | null;
  target: string;
  trigger: string;
  condition: string;
  note: string;
  disabled: boolean;
  sortOrder: number;
}

export interface PackPresetDto {
  id: string;
  characterId: string;
  name: string;
  /** 穿戴映射 JSON `[{itemId, slotId, slotIndex}]`（只搬不解释） */
  payload: string;
  note: string;
  sortOrder: number;
  updatedAt: number;
}

export interface PackUnitSystemDto {
  id: string;
  characterId: string;
  name: string;
  kind: "ladder" | "ratio" | "threshold";
  levels: string;
  config: string;
  isDefault: boolean;
  sortOrder: number;
}

export interface PackLayoutDto {
  characterId: string;
  moduleKey: string;
  enabled: boolean;
  sortOrder: number;
}

/** R25 等级项（含 v1.4 补的 subLevels / power） */
export interface PackLevelRungDto {
  id: string;
  name: string;
  rank: number;
  subLevels: number;
  power: number | null;
  /** 已拆出子层级：父阶是组，小层数由子层级决定（阶设置里不可改） */
  hasChildren: boolean;
}

export interface PackLevelSystemDto {
  id: string;
  workId: string;
  name: string;
  rungs: PackLevelRungDto[];
}

export interface PackBundleDto {
  character: PackCharacterDto | null;
  /** 属性定义（作品级）：这条 bundle 的「属性模型」 */
  attrDefs: PackAttrDefDto[];
  /** 属性数值（角色级实例，defId 引用 attrDefs） */
  attributes: PackAttributeDto[];
  /** 属性映射（1.35.0） */
  mappings: PackMappingDto[];
  slots: PackSlotDto[];
  /** 载体分组（1.39.0 二期）：条目 groupId 引用这里的 id */
  groups: PackGroupDto[];
  /** 物品分类管理（1.40.0）：item.category 按名字引用这里的行 */
  categories: PackCategoryDto[];
  items: PackItemDto[];
  skills: PackSkillDto[];
  modifiers: PackModifierDto[];
  unitSystems: PackUnitSystemDto[];
  layouts: PackLayoutDto[];
  records: PackRecordDto[];
  draft: PackDraftDto | null;
  /** R25 等级体系（境界模块直接复用，不建副本表 §9.7） */
  levelSystems: PackLevelSystemDto[];
  /** 体系品阶投影（1.40.0）：设定域全部分类的根阶清单，物品 / 技能选品阶用 */
  gradeSystems: PackGradeSystemDto[];
  /** 主角绑定的实体当前的「当前境界」关联行（无则 null） */
  realmLink: PackRealmLinkDto | null;
  /** 换装方案（REQ-032），与其它表一样属于整文档 */
  presets: PackPresetDto[];
}

export interface PackRecordDto {
  id: string;
  characterId: string;
  chapterId: string;
  takenAt: number;
  reason: string;
  /** 与正式表同构的深拷贝 JSON */
  payload: string;
}

export interface PackDraftDto {
  characterId: string;
  payload: string;
  dirtyCount: number;
  updatedAt: number;
}

export interface PackRealmLinkDto {
  id: string;
  fromType: string;
  fromId: string;
  toType: string;
  toId: string;
  relation: string;
  note: string;
}

/** 保存入参：整文档（草稿同构） */
export interface PackSavePayloadDto {
  character: PackCharacterDto;
  /** 属性定义（作品级）：整文档随草稿走，保存时按 work_id 整体替换 */
  attrDefs: PackAttrDefDto[];
  /** 属性数值（角色级实例） */
  attributes: PackAttributeDto[];
  /** 属性映射（1.35.0）：与属性同属「设定数据」，整文档一起走草稿与盘点 */
  mappings: PackMappingDto[];
  slots: PackSlotDto[];
  /** 载体分组（1.39.0 二期） */
  groups: PackGroupDto[];
  /** 物品分类管理（1.40.0）：与其它表一样属于整文档 */
  categories: PackCategoryDto[];
  items: PackItemDto[];
  skills: PackSkillDto[];
  modifiers: PackModifierDto[];
  unitSystems: PackUnitSystemDto[];
  layouts: PackLayoutDto[];
  presets: PackPresetDto[];
  /**
   * 「当前境界」关联行（随整文档保存一起提交）。
   *
   * ⚠️ 必须与文档写在同一事务里 —— 境界真实值住在跨作品的 `novel_links`，
   * 早期实现是「文档事务提交成功后再单独走 `novel-link-set`」，于是出现半保存态：
   * 文档/物品/属性全部落库了，但此刻写 link 失败 → 渲染层拿到 false 报「保存失败」，
   * 用户以为整单回滚、继续重试或丢弃，实际数据已半提交（右侧栏显示旧境界、
   * 行囊显示新境界，直到下次重载）。
   *
   * `null` = 本次不需要改动关联行（未绑定主角 / 与上次保存态无差异）；
   * 传对象 = 幂等 upsert（同 (from,to_type,relation) 先清后插）。
   */
  realmLink: PackRealmLinkDto | null;
  /** 盘点记录原因（如「改动前自动存档：手动保存」） */
  reason: string;
  /** 记录归属章节（切换章节 / 退出时说明改动属于哪一章） */
  chapterId: string;
}

/** 盘点记录滚动保留条数（存档滚动保留 20 条，与章节快照口径一致） */
const RECORD_KEEP = 20;

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function toInt(value: boolean): number {
  return value ? 1 : 0;
}

/**
 * 幂等写入一行 `novel_links`（同一 (from_type, from_id, to_type, relation) 先清后插）。
 *
 * **只搬数据不解释数据**：调用方已把 note 归一化为 `{"sub":N}`。
 * 两个消费方共用本函数，禁各写一份 —— `novel-pack-save`（与文档同事务）与
 * `novel-link-set`（独立通道），实现分叉会让两条路径的幂等语义悄悄不一致。
 *
 * ⚠️ 必须在调用方的事务上下文里跑（`novel-pack-save` 的 `apply` 事务内）：
 * 用全局 `dbRun` 而非 `db.prepare`，才能加入外层事务而不是自开一个。
 */
function upsertRealmLinkRow(link: PackRealmLinkDto): void {
  dbRun(
    "DELETE FROM novel_links WHERE from_type = ? AND from_id = ? AND to_type = ? AND relation = ?",
    [link.fromType, link.fromId, link.toType, link.relation],
  );
  dbRun(
    "INSERT INTO novel_links (id, from_type, from_id, to_type, to_id, relation, note) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [link.id, link.fromType, link.fromId, link.toType, link.toId, link.relation, link.note ?? null],
  );
}

/**
 * 解析草稿 payload（与 `PackDoc` 同构的 JSON）。
 *
 * 只做「解得出且是对象」这一层校验：草稿是**渲染层自己写进来的中间态**，
 * 字段残缺时不该顺手丢掉整份草稿（里面有作者还没保存的全部改动）——
 * 调用方按需 `Array.isArray` 兜底即可。
 */
function parseDraftDoc(raw: string): PackDraftDoc | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as PackDraftDoc;
  } catch {
    return null;
  }
}

// ── 行 → DTO ──

/**
 * 读绑定实体的名字。
 *
 * 绑定的主角是「要素库里的一个实体」，它的名字（如「陆长安」）只存在
 * `novel_entities.name` 里；行囊自己那格 `name` 是播种时的 `'主角'`，
 * 绑定后就不该再用了（否则界面显示「主角」而要素库里是「陆长安」）。
 *
 * 查不到实体（被删了 / entityId 悬空）时返回空串，由调用方回退到行囊内的名字 ——
 * 不抛错：一条悬空绑定不该让整个行囊装载失败。
 */
function readEntityName(entityId: string): string {
  if (!entityId) return "";
  const row = dbGet("SELECT name FROM novel_entities WHERE id = ?", [entityId]) as
    | { name: string }
    | undefined;
  return row?.name ?? "";
}

function toCharacterDto(row: PackCharacterRow): PackCharacterDto {
  const entityId = row.entity_id ?? "";
  const entityName = readEntityName(entityId);
  return {
    id: row.id,
    workId: row.work_id,
    name: row.name,
    // 绑定了实体就显示实体名；实体被删 / 名称为空时回退到行囊内的名字
    displayName: entityName || row.name,
    avatar: row.avatar ?? "",
    isProtagonist: row.is_protagonist === 1,
    entityId,
    // 未绑定时的行囊自持境界也换算回父阶口径（旧数据可能记着子层级 id，
    // 阶梯投影后找不到行会静默回落到首阶）
    realmAt: normalizeRealmRaw(row.realm_at ?? ""),
    note: row.note,
    sortOrder: row.sort_order,
  };
}

function toAttributeDto(row: PackAttributeRow): PackAttributeDto {
  return {
    id: row.id,
    characterId: row.character_id,
    defId: row.def_id,
    baseValue: row.base_value,
    updatedAt: row.updated_at ?? 0,
  };
}

function toAttrDefDto(row: PackAttrDefRow): PackAttrDefDto {
  return {
    id: row.id,
    workId: row.work_id,
    key: row.key ?? "",
    name: row.name,
    groupName: row.group_name,
    unit: row.unit,
    decimals: row.decimals,
    defaultValue: row.default_value,
    sortOrder: row.sort_order,
  };
}

function toMappingDto(row: PackMappingRow): PackMappingDto {
  return {
    id: row.id,
    characterId: row.character_id,
    sourceAttrId: row.source_attr_id,
    targetAttrId: row.target_attr_id,
    rate: row.rate ?? 0,
    note: row.note ?? "",
    sortOrder: row.sort_order,
    updatedAt: row.updated_at ?? 0,
  };
}

function toSlotDto(row: PackSlotRow): PackSlotDto {
  return {
    id: row.id,
    characterId: row.character_id,
    name: row.name,
    capacity: row.capacity,
    accepts: parseJsonArray(row.accepts),
    enabled: row.enabled === 1,
    note: row.note,
    sortOrder: row.sort_order,
  };
}

function toGroupDto(row: PackGroupRow): PackGroupDto {
  return {
    id: row.id,
    characterId: row.character_id,
    name: row.name,
    icon: row.icon ?? "",
    canEquip: row.can_equip === 1,
    canEnable: row.can_enable === 1,
    profSchemeId: row.prof_scheme_id ?? "",
    enabled: row.enabled === 1,
    sortOrder: row.sort_order,
  };
}

function toItemDto(row: PackItemRow): PackItemDto {
  return {
    id: row.id,
    characterId: row.character_id,
    name: row.name,
    category: row.category,
    qty: row.qty,
    rarity: row.rarity,
    icon: row.icon,
    desc: row.desc,
    tags: parseJsonArray(row.tags),
    equippedSlotId: row.equipped_slot_id ?? "",
    slotIndex: row.slot_index,
    groupId: row.group_id ?? "",
    gradeId: row.grade_id ?? "",
    sourceChapterId: row.source_chapter_id ?? "",
    updatedAt: row.updated_at,
  };
}

function toSkillDto(row: PackSkillRow): PackSkillDto {
  return {
    id: row.id,
    characterId: row.character_id,
    name: row.name,
    desc: row.desc,
    enabled: row.enabled === 1,
    groupId: row.group_id ?? "",
    proficiencyRaw: row.proficiency_raw,
    gradeId: row.grade_id ?? "",
    tags: parseJsonArray(row.tags),
    sortOrder: row.sort_order,
    updatedAt: row.updated_at ?? 0,
  };
}

function toCategoryDto(row: PackCategoryRow): PackCategoryDto {
  return {
    id: row.id,
    characterId: row.character_id,
    name: row.name,
    systemId: row.system_id ?? "",
    sortOrder: row.sort_order,
  };
}

const NATURES: PackNature[] = ["passive", "sustained", "cast"];
const OPS: PackOp[] = ["add", "percent", "mul", "override"];
const OWNER_TYPES: PackOwnerType[] = ["item", "skill", "status"];

function toModifierDto(row: PackModifierRow): PackModifierDto {
  return {
    id: row.id,
    ownerType: OWNER_TYPES.includes(row.owner_type as PackOwnerType)
      ? (row.owner_type as PackOwnerType)
      : "item",
    ownerId: row.owner_id,
    nature: NATURES.includes(row.nature as PackNature) ? (row.nature as PackNature) : "passive",
    name: row.name,
    targetAttrId: row.target_attr_id ?? "",
    op: OPS.includes(row.op as PackOp) ? (row.op as PackOp) : "add",
    value: row.value,
    valueUnit: row.value_unit ?? "",
    scaleByProficiency: row.scale_by_proficiency === 1,
    active: row.active === 1,
    defaultOn: row.default_on === 1,
    cost: row.cost ?? "",
    cooldown: row.cooldown,
    duration: row.duration ?? "",
    roundsLeft: row.rounds_left ?? null,
    target: row.target ?? "",
    trigger: row.trigger ?? "",
    condition: row.condition ?? "",
    note: row.note,
    disabled: row.disabled === 1,
    sortOrder: row.sort_order,
  };
}

function toUnitSystemDto(row: PackUnitSystemRow): PackUnitSystemDto {
  return {
    id: row.id,
    characterId: row.character_id,
    name: row.name,
    kind: (["ladder", "ratio", "threshold"] as const).includes(
      row.kind as PackUnitSystemDto["kind"],
    )
      ? (row.kind as PackUnitSystemDto["kind"])
      : "ratio",
    levels: row.levels,
    config: row.config,
    isDefault: row.is_default === 1,
    sortOrder: row.sort_order,
  };
}

function toLayoutDto(row: PackLayoutRow): PackLayoutDto {
  return {
    characterId: row.character_id,
    moduleKey: row.module_key,
    enabled: row.enabled === 1,
    sortOrder: row.sort_order,
  };
}

function toRecordDto(row: PackRecordRow): PackRecordDto {
  return {
    id: row.id,
    characterId: row.character_id,
    chapterId: row.chapter_id ?? "",
    takenAt: row.taken_at,
    reason: row.reason,
    payload: row.payload,
  };
}

function toDraftDto(row: PackDraftRow): PackDraftDto {
  return {
    characterId: row.character_id,
    payload: row.payload,
    dirtyCount: row.dirty_count,
    updatedAt: row.updated_at,
  };
}

function toPresetDto(row: PackPresetRow): PackPresetDto {
  return {
    id: row.id,
    characterId: row.character_id,
    name: row.name,
    payload: row.payload,
    note: row.note,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at ?? 0,
  };
}

/** 读取某角色当前正式数据（供保存前的回退点快照使用） */
function readCharacterSnapshot(characterId: string): PackBundleDto {
  // 查一次就够：此前为了判空先 `dbGet` 一遍、再为转 DTO 查第二遍，
  // 同一行被读了两次（SQL 是同步的，等于白跑一趟 prepare + 查询）
  const characterRow = dbGet("SELECT * FROM novel_pack_characters WHERE id = ?", [
    characterId,
  ]) as PackCharacterRow | undefined;
  return {
    character: characterRow ? toCharacterDto(characterRow) : null,
    // 属性定义是作品级的：角色行不在时无从取 work_id，只能给空（调用方不会
    // 在没有角色行的情况下消费 defs —— 快照只服务于「已有角色」的保存 / 对比）
    attrDefs: characterRow
      ? (
          dbAll("SELECT * FROM novel_pack_attr_defs WHERE work_id = ? ORDER BY sort_order", [
            characterRow.work_id,
          ]) as PackAttrDefRow[]
        ).map(toAttrDefDto)
      : [],
    attributes: (
      dbAll("SELECT * FROM novel_pack_attributes WHERE character_id = ? ORDER BY rowid", [
        characterId,
      ]) as PackAttributeRow[]
    ).map(toAttributeDto),
    mappings: (
      dbAll("SELECT * FROM novel_pack_mappings WHERE character_id = ? ORDER BY sort_order", [
        characterId,
      ]) as PackMappingRow[]
    ).map(toMappingDto),
    slots: (
      dbAll("SELECT * FROM novel_pack_slots WHERE character_id = ? ORDER BY sort_order", [
        characterId,
      ]) as PackSlotRow[]
    ).map(toSlotDto),
    groups: (
      dbAll("SELECT * FROM novel_pack_groups WHERE character_id = ? ORDER BY sort_order", [
        characterId,
      ]) as PackGroupRow[]
    ).map(toGroupDto),
    categories: (
      dbAll("SELECT * FROM novel_pack_categories WHERE character_id = ? ORDER BY sort_order", [
        characterId,
      ]) as PackCategoryRow[]
    ).map(toCategoryDto),
    items: (
      dbAll("SELECT * FROM novel_pack_items WHERE character_id = ?", [
        characterId,
      ]) as PackItemRow[]
    ).map(toItemDto),
    skills: (
      dbAll("SELECT * FROM novel_pack_skills WHERE character_id = ? ORDER BY sort_order", [
        characterId,
      ]) as PackSkillRow[]
    ).map(toSkillDto),
    modifiers: (
      dbAll(
        `SELECT * FROM novel_pack_modifiers
          WHERE (owner_type = 'item'   AND owner_id IN (SELECT id FROM novel_pack_items  WHERE character_id = ?))
             OR (owner_type = 'skill'  AND owner_id IN (SELECT id FROM novel_pack_skills WHERE character_id = ?))
             OR (owner_type = 'status' AND owner_id = ?)`,
        [characterId, characterId, characterId],
      ) as PackModifierRow[]
    ).map(toModifierDto),
    unitSystems: (
      dbAll("SELECT * FROM novel_pack_unit_systems WHERE character_id = ? ORDER BY sort_order", [
        characterId,
      ]) as PackUnitSystemRow[]
    ).map(toUnitSystemDto),
    layouts: (
      dbAll("SELECT * FROM novel_pack_layouts WHERE character_id = ? ORDER BY sort_order", [
        characterId,
      ]) as PackLayoutRow[]
    ).map(toLayoutDto),
    records: [],
    presets: (
      dbAll("SELECT * FROM novel_pack_presets WHERE character_id = ? ORDER BY sort_order", [
        characterId,
      ]) as PackPresetRow[]
    ).map(toPresetDto),
    draft: null,
    levelSystems: [],
    // 快照只服务于「保存前的回退点」：gradeSystems 是设定域的只读投影，
    // 不随文档走（真正的投影只在 novel-pack-load 里算）
    gradeSystems: [],
    realmLink: null,
  };
}

/**
 * 把作品的**境界阶梯**投影成行囊要的形状（含 sub_levels / power）。
 *
 * 数据源是统一设定域里 `kind='realm'` 的那一条分类（1.36.0 起）。
 * 行囊只消费「一部作品的境界阶梯」这一个视图，不关心设定中心还有多少别的
 * 分类 —— 所以这里做投影而不是把 `novel_setting_categories` 整张搬过来。
 *
 * **只投影根阶（1.38.1）**：拆分出的子层级（parent_id 非空）是「父阶内的层」，
 * 不是独立的新阶 —— 平铺进阶梯会让行囊的台阶行出现「练气、第1层…第9层」
 * 同一层的假象。父阶 = 组，子层级折算成它的阶内层数（subLevels）。
 *
 * 两处必须这么写：
 * - **带 `workId`**：`novel_setting_categories.work_id` 是 NOT NULL，设定按作品
 *   私有。不带过滤时两部作品都建过境界体系就会把另一部小说的阶梯返回过来，
 *   再经 `novel-link-set` 写出跨作品的 `novel_links`，界面上看不出来。
 * - **等级项一次取回后分组**：每个分类一条 SQL 就是 N+1。
 */
function readLevelSystems(workId: string): PackLevelSystemDto[] {
  const categories = dbAll(
    "SELECT * FROM novel_setting_categories WHERE work_id = ? AND kind = 'realm' ORDER BY sort_order",
    [workId],
  ) as NovelSettingCategoryRow2[];
  if (categories.length === 0) return [];

  const categoryIds = categories.map((category) => category.id);
  const levels = dbAll(
    `SELECT * FROM novel_setting_levels
      WHERE category_id IN (${categoryIds.map(() => "?").join(", ")})
      ORDER BY category_id, rank`,
    categoryIds,
  ) as NovelSettingLevelRow2[];

  // 先归组子层级，再投影根阶 —— 子层级不占阶梯位，只贡献阶内层数
  const childrenByParent = new Map<string, NovelSettingLevelRow2[]>();
  for (const level of levels) {
    if (!level.parent_id) continue;
    const list = childrenByParent.get(level.parent_id) ?? [];
    list.push(level);
    childrenByParent.set(level.parent_id, list);
  }
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  const rungsByCategory = new Map<string, PackLevelSystemDto["rungs"]>();
  for (const level of levels) {
    if (level.parent_id) continue;
    const children = (childrenByParent.get(level.id) ?? []).sort(
      (a, b) => (a.seg_from ?? 0) - (b.seg_from ?? 0),
    );
    // 小层总数取 max 兜底两代数据：新模型父阶 sub_levels 即整阶总数（拆分时写入）；
    // 旧模型父阶只留第一段的层数 —— 用「子段小层和 / 子段最大层号」找回真实总数。
    const childSum = children.reduce((sum, child) => sum + (child.sub_levels ?? 1), 0);
    const childMaxSeg = children.reduce(
      (max, child) => Math.max(max, child.seg_to ?? 0),
      0,
    );
    const total = Math.max(level.sub_levels ?? 1, childSum, childMaxSeg);
    // 本阶生效的小层命名模板：自己的为空沿用分类的（与渲染层
    // setting-utils.effectiveSubPattern 同一口径；两端各写一份是因为
    // 主进程不能 import 渲染层模块）
    const pattern =
      (level.sub_pattern ?? "").trim() ||
      (categoryById.get(level.category_id)?.sub_pattern ?? "").trim();
    const list = rungsByCategory.get(level.category_id) ?? [];
    list.push({
      id: level.id,
      name: level.name,
      rank: level.rank,
      subLevels: total,
      power: level.power,
      hasChildren: children.length > 0,
      // 小层别名表（1.39.1，1.40.0 扩）：下标 = 阶内层号 - 1。两个来源——
      // ① 拆出子层级的阶：段内各层共用该段的显示名（首个别名优先，回落段名）；
      // ② 未拆分但配了**固定名单**命名模板的阶（「初期,中期,后期,圆满」）：
      //    按名单逐层取名。{n} 模板（「第{n}层」）只是编号不是名字，不生成。
      ...((children.length > 0 || fixedNameList(pattern).length > 0)
        ? { subLabels: buildSubLabels(children, total, pattern) }
        : {}),
    });
    rungsByCategory.set(level.category_id, list);
  }

  return categories.map((category) => ({
    id: category.id,
    workId: category.work_id,
    name: category.name,
    rungs: rungsByCategory.get(category.id) ?? [],
  }));
}

/**
 * 体系品阶投影（1.40.0）：设定域**全部分类**（境界 + 功法品阶 + 丹药品阶…）
 * → 行囊「选品阶」要的精简视图。只投影根阶（parent_id 为空）—— 派生段是
 * 境界阶内的进度，不是可标注的品阶名。
 */
function readGradeSystems(workId: string): PackGradeSystemDto[] {
  const categories = dbAll(
    "SELECT * FROM novel_setting_categories WHERE work_id = ? ORDER BY sort_order",
    [workId],
  ) as NovelSettingCategoryRow2[];
  if (categories.length === 0) return [];
  const categoryIds = categories.map((category) => category.id);
  const levels = dbAll(
    `SELECT id, category_id, name, rank, parent_id FROM novel_setting_levels
      WHERE category_id IN (${categoryIds.map(() => "?").join(", ")})
      ORDER BY category_id, rank`,
    categoryIds,
  ) as Array<Pick<NovelSettingLevelRow2, "id" | "category_id" | "name" | "rank" | "parent_id">>;
  const levelsByCategory = new Map<string, Array<{ id: string; name: string }>>();
  for (const level of levels) {
    if (level.parent_id) continue;
    const list = levelsByCategory.get(level.category_id) ?? [];
    list.push({ id: level.id, name: level.name });
    levelsByCategory.set(level.category_id, list);
  }
  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    levels: levelsByCategory.get(category.id) ?? [],
  }));
}

/**
 * 小层别名表（1.39.1，1.40.0 扩）：阶内层号 → 该层的显示别名。
 *
 * 两个来源，拆出子层级的优先：
 * - 子层级行占据 `[seg_from, seg_to]` 层段，段内每一小层都显示该段的名字
 *   （别名的第一条优先 —— 别名是「正文里怎么叫它」，比结构名更像人称；
 *   没写别名就回落段名）；
 * - 没拆子层级时看**固定名单**命名模板（「初期,中期,后期,圆满」）逐层取名；
 *   `{n}` 编号模板不算名字，返回全空表（调用方据此不生成 subLabels）。
 * 空段填空串，渲染层据此不显示 chip 而不是显示空白。
 */
function buildSubLabels(
  children: NovelSettingLevelRow2[],
  total: number,
  pattern: string,
): string[] {
  const labels: string[] = new Array(total).fill("");
  if (children.length === 0) {
    const names = fixedNameList(pattern);
    for (let sub = 1; sub <= total; sub += 1) {
      labels[sub - 1] = names[sub - 1] ?? "";
    }
    return labels;
  }
  for (const child of children) {
    const from = Math.max(1, child.seg_from ?? 1);
    const to = Math.min(total, Math.max(from, child.seg_to ?? from));
    const label = subLabelOf(child);
    for (let sub = from; sub <= to; sub += 1) {
      labels[sub - 1] = label;
    }
  }
  return labels;
}

/** 固定名单命名模板（含顿号 / 中英文逗号才算名单）：拆成逐层名字 */
function fixedNameList(pattern: string): string[] {
  const trimmed = pattern.trim();
  if (!trimmed || !/[、,，]/.test(trimmed)) return [];
  return trimmed
    .split(/[、,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 子层级的显示名：首个别名优先（脏 JSON 静默回落段名，别让它炸投影） */
function subLabelOf(row: NovelSettingLevelRow2): string {
  try {
    const aliases = JSON.parse(row.aliases ?? "[]") as unknown;
    if (Array.isArray(aliases) && typeof aliases[0] === "string" && aliases[0]) {
      return aliases[0];
    }
  } catch {
    // 别名列是脏数据时回落段名 —— 投影不能因为展示层信息中断
  }
  return row.name;
}

/**
 * 子层级绑定换算回父阶口径（1.38.1）。
 *
 * 阶梯投影只出根阶后，行囊的坐标系里没有子层级 id —— 绑定若落在拆分产物上
 * （实体面板点选某个子层），原样返回会让 `toPosition` 找不到行而回落到首阶
 * （「明明绑在第 4 层，行囊却显示第一阶」）。这里统一换算：
 * toId → 父阶 id，sub → 该段在父阶内的起始层号（新模型每段 1 层，二者相等）。
 */
function normalizeRealmTarget(
  levelId: string,
  sub: number,
): { levelId: string; sub: number } {
  const level = dbGet(
    "SELECT parent_id, seg_from FROM novel_setting_levels WHERE id = ?",
    [levelId],
  ) as { parent_id: string | null; seg_from: number | null } | undefined;
  if (!level || !level.parent_id) return { levelId, sub };
  return {
    levelId: level.parent_id,
    sub: Math.max(1, level.seg_from ?? sub),
  };
}

/** 读取主角实体当前境界关联行（§9.7.3 唯一事实源） */
function readRealmLink(entityId: string): PackRealmLinkDto | null {
  if (!entityId) return null;
  const row = dbGet(
    `SELECT * FROM novel_links
      WHERE from_type = 'character' AND from_id = ? AND to_type = 'level' AND relation = '当前境界'
      LIMIT 1`,
    [entityId],
  ) as NovelLinkRow2 | undefined;
  if (!row) return null;
  // note 只写 {sub}（等级由 to_id 承载）—— 绑定落在子层级上时先换算回父阶
  const fallbackSub = parseSubFromNote(row.note);
  const target = normalizeRealmTarget(row.to_id, fallbackSub);
  return {
    id: row.id,
    fromType: row.from_type,
    fromId: row.from_id,
    toType: row.to_type,
    toId: target.levelId,
    relation: row.relation,
    note: JSON.stringify({ sub: target.sub }),
  };
}

/** 从 novel_links.note / realm_at JSON 里读 sub（读不到回落 1） */
function parseSubFromNote(raw: string | null): number {
  if (!raw) return 1;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return 1;
    const sub = Number((parsed as { sub?: unknown }).sub);
    return Number.isFinite(sub) && sub >= 1 ? Math.floor(sub) : 1;
  } catch {
    return 1;
  }
}

/** 行囊自持境界 JSON（{levelId, sub}）里的子层级 id 换算回父阶；原样不合法时原样返回 */
function normalizeRealmRaw(raw: string): string {
  if (!raw) return raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return raw;
    const record = parsed as { levelId?: unknown; sub?: unknown };
    if (typeof record.levelId !== "string") return raw;
    const sub = Number(record.sub);
    const target = normalizeRealmTarget(
      record.levelId,
      Number.isFinite(sub) && sub >= 1 ? Math.floor(sub) : 1,
    );
    if (target.levelId === record.levelId) return raw;
    return JSON.stringify({ levelId: target.levelId, sub: target.sub });
  } catch {
    return raw;
  }
}

/** 首次使用的默认物品分类（与渲染层 ITEM_CATEGORIES 同一套产品口径） */
const DEFAULT_PACK_CATEGORIES = ["装备", "丹药", "材料", "消耗品", "杂物"] as const;

/**
 * 给角色播种默认物品分类（1.40.0），幂等：已有一律不补 ——
 * 「一条都没有」才算没初始化过，作者删光的分类不该被悄悄长回来。
 *
 * 两个调用时机：新建角色行（ensurePackCharacterRow）与每次装载
 * （novel-pack-load，兜住 1.40.0 之前就存在的老角色）。
 */
function ensureDefaultCategories(characterId: string): void {
  const row = dbGet(
    "SELECT COUNT(*) AS count FROM novel_pack_categories WHERE character_id = ?",
    [characterId],
  ) as { count: number };
  if (row.count > 0) return;
  DEFAULT_PACK_CATEGORIES.forEach((name, index) => {
    dbRun(
      `INSERT INTO novel_pack_categories (id, character_id, name, system_id, sort_order)
       VALUES (?, ?, ?, '', ?)`,
      [createId("pcat"), characterId, name, index + 1],
    );
  });
}

/**
 * 取该作品的行囊主角行；不存在则播种一条并套上通用部位预设（PRD 附录 A）。
 *
 * 抽成公共函数是因为「首次使用」有两个入口：打开行囊面板，以及在右侧要素栏
 * 把某个角色设为主角。两个入口都必须能建出同一条骨架，否则从要素栏设主角
 * 会写到一个不存在的 character_id 上（静默丢绑定）。
 */
function ensurePackCharacterRow(workId: string): PackCharacterRow {
  // 空 workId 直接拒绝（P2-5）：放行的话会种出 work_id='' 的角色行，
  // 行囊窗口关掉重开仍复用这份空壳，且没有 UI 入口能删掉它。
  // 调用方（protagonist-set / rename / quick-add）各自有 try/catch 兜底，
  // novel-pack-load 的渲染层也有 loadError 分支，抛错不会变成未处理异常。
  if (!workId) throw new Error("[novel-pack] workId 不能为空，拒绝播种角色行");
  const existing = dbGet(
    "SELECT * FROM novel_pack_characters WHERE work_id = ? ORDER BY sort_order LIMIT 1",
    [workId],
  ) as PackCharacterRow | undefined;
  if (existing) return existing;

  /**
   * 播种走 `immediate` 事务，且**进入事务后再查一次**。
   *
   * 两个入口（打开行囊面板 / 右侧要素栏设主角）可能并发首次触发，而表里没有
   * `work_id` 的唯一约束 —— 默认事务是 deferred（BEGIN），写锁要到第一条
   * INSERT 才拿，两个调用会各自查到「没有」然后各插一条，同一部书出现两个主角。
   * `immediate` 让写锁在事务开始就拿，配合事务内的第二次查询即可收敛成一条。
   */
  const create = getDb().transaction((): PackCharacterRow => {
    const again = dbGet(
      "SELECT * FROM novel_pack_characters WHERE work_id = ? ORDER BY sort_order LIMIT 1",
      [workId],
    ) as PackCharacterRow | undefined;
    if (again) return again;

    const id = createId("pc");
    dbRun(
      `INSERT INTO novel_pack_characters
         (id, work_id, name, is_protagonist, entity_id, realm_at, note, sort_order)
       VALUES (?, ?, '主角', 1, NULL, NULL, '', 1)`,
      [id, workId],
    );
    seedDefaultSlots(id);
    ensureDefaultCategories(id);
    return dbGet("SELECT * FROM novel_pack_characters WHERE id = ?", [
      id,
    ]) as PackCharacterRow;
  });
  return create.immediate();
}

export function registerNovelPackHandlers(): void {
  // ── 全量装载 ──
  ipcMain.handle("novel-pack-load", (_event, workId: string): PackBundleDto => {
    const characterRow = ensurePackCharacterRow(workId);
    // 老角色（1.40.0 之前建的）没有分类行：装载时兜底播种一次
    ensureDefaultCategories(characterRow.id);

    const character = toCharacterDto(characterRow);
    const snapshot = readCharacterSnapshot(character.id);
    const records = (
      dbAll(
        "SELECT * FROM novel_pack_records WHERE character_id = ? ORDER BY taken_at DESC LIMIT ?",
        [character.id, RECORD_KEEP],
      ) as PackRecordRow[]
    ).map(toRecordDto);
    const draftRow = dbGet("SELECT * FROM novel_pack_drafts WHERE character_id = ?", [
      character.id,
    ]) as PackDraftRow | undefined;

    return {
      ...snapshot,
      records,
      draft: draftRow ? toDraftDto(draftRow) : null,
      levelSystems: readLevelSystems(workId),
      gradeSystems: readGradeSystems(workId),
      realmLink: readRealmLink(character.entityId),
    };
  });

  // ── 主角绑定（右侧要素栏「设为主角」与行囊面板「绑定实体」共用同一条通道） ──
  //
  // 「谁是主角」的唯一事实源就是 `novel_pack_characters.entity_id`：不另建表、
  // 不另加列（v1 行囊只承载一条主角，`is_protagonist` 已按多角色预留）。
  // 设为主角 = 把该角色实体绑成行囊主角；换一个即改写同一格；
  // 传空串即解除绑定（境界退回「仅在本面板内使用」）。
  ipcMain.handle("novel-pack-protagonist-get", (_event, workId: string): PackProtagonistDto | null => {
    // 读取不建行：作者可能压根没打开过行囊，此时右侧要素栏就不该有主角角标
    const row = dbGet(
      "SELECT id, entity_id FROM novel_pack_characters WHERE work_id = ? ORDER BY sort_order LIMIT 1",
      [workId],
    ) as { id: string; entity_id: string | null } | undefined;
    if (!row) return null;
    return { characterId: row.id, entityId: row.entity_id ?? "" };
  });

  ipcMain.handle(
    "novel-pack-protagonist-set",
    (_event, workId: string, entityId: string): boolean => {
      try {
        const row = ensurePackCharacterRow(workId);
        dbRun("UPDATE novel_pack_characters SET entity_id = ? WHERE id = ?", [
          entityId || null,
          row.id,
        ]);
        return true;
      } catch {
        return false;
      }
    },
  );

  /**
   * 改主角名（行囊头部的「改名」入口）。
   *
   * 名字的单一事实源是**要素库的实体**（见 `toCharacterDto` 的 displayName）：
   * 绑定了实体就改实体名，未绑定才改行囊自己那格。于是在行囊里改名 =
   * 在要素库改名，两处永远是同一个名字 —— 这正是用户要的「改任一处两边都变」。
   *
   * 为什么单开一条通道而不用现成的 `novel-entity-save`：那条要整份 DTO
   * （type / summary / content / fields / aliases…），行囊只拿得到名字，
   * 传个残缺 DTO 过去会把其余字段一起覆盖成空。窄通道只动 name 一列。
   *
   * 返回真实落点（实体名 / 行囊名），让调用方据此渲染，不靠本地猜测。
   */
  ipcMain.handle(
    "novel-pack-rename",
    (
      _event,
      workId: string,
      name: string,
    ): { ok: boolean; displayName: string; target: "entity" | "character" } => {
      const trimmed = name.trim();
      try {
        const row = ensurePackCharacterRow(workId);
        if (!trimmed) {
          const fallback = readEntityName(row.entity_id ?? "") || row.name;
          return { ok: false, displayName: fallback, target: "character" };
        }
        const entityId = row.entity_id ?? "";
        if (entityId) {
          // 绑定了实体：改实体名（行囊那格不动，它已经不再被显示了）
          dbRun("UPDATE novel_entities SET name = ?, updated_at = ? WHERE id = ?", [
            trimmed,
            Date.now(),
            entityId,
          ]);
          return { ok: true, displayName: trimmed, target: "entity" };
        }
        dbRun("UPDATE novel_pack_characters SET name = ? WHERE id = ?", [trimmed, row.id]);
        return { ok: true, displayName: trimmed, target: "character" };
      } catch {
        return { ok: false, displayName: "", target: "character" };
      }
    },
  );

  // ── 快速记账（REQ-027）：正文选区 → 记入背包 ──
  //
  // 这是**面板没挂载时**的落库路径（面板开着时由渲染层直接改内存文档，见
  // `registerPackQuickAdd`）。两件事必须一起做，否则是纯静默的数据丢失：
  //
  // ① 草稿优先于正式行（`applyBundle` 的合并顺序），所以**有草稿就并入草稿**。
  //    若只往正式表插一行而草稿里还留着改动前那份快照，下次打开面板时草稿整个
  //    盖上来 —— 刚记下的物品凭空消失，没有任何报错。
  // ② 草稿不存在时才直插正式表，并把 `source_chapter_id` 带上（记账的价值有一半
  //    在「这东西是哪一章捡的」）。
  ipcMain.handle(
    "novel-pack-quick-add",
    (
      _event,
      workId: string,
      name: string,
      chapterId: string,
      category: string,
    ): { id: string; characterId: string } | null => {
      const trimmed = (name ?? "").trim();
      if (!workId || !trimmed) return null;
      try {
        const character = ensurePackCharacterRow(workId);
        const now = Date.now();
        const item: PackItemDto = {
          id: createId("pi"),
          characterId: character.id,
          name: trimmed,
          category: category || "杂物",
          qty: 1,
          rarity: "common",
          icon: "",
          desc: "",
          tags: [],
          equippedSlotId: "",
          slotIndex: null,
          groupId: "",
          gradeId: "",
          sourceChapterId: chapterId || "",
          updatedAt: now,
        };

        const draftRow = dbGet(
          "SELECT * FROM novel_pack_drafts WHERE character_id = ?",
          [character.id],
        ) as PackDraftRow | undefined;
        const draft = draftRow ? parseDraftDoc(draftRow.payload) : null;

        if (draft) {
          draft.items = Array.isArray(draft.items) ? draft.items : [];
          draft.items.push(item);
          dbRun(
            `UPDATE novel_pack_drafts
               SET payload = ?, dirty_count = dirty_count + 1, updated_at = ?
             WHERE character_id = ?`,
            [JSON.stringify(draft), now, character.id],
          );
        } else {
          dbRun(
            `INSERT INTO novel_pack_items
               (id, character_id, name, category, qty, rarity, icon, desc, tags,
                equipped_slot_id, slot_index, source_chapter_id, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              item.id,
              item.characterId,
              item.name,
              item.category,
              item.qty,
              item.rarity,
              item.icon,
              item.desc,
              JSON.stringify(item.tags),
              null,
              null,
              item.sourceChapterId || null,
              item.updatedAt,
            ],
          );
        }
        return { id: item.id, characterId: character.id };
      } catch (error) {
        console.error("[novel-pack-quick-add] 记账失败：", error);
        return null;
      }
    },
  );

  // ── 整文档事务保存（写前先落回退点，成功后清草稿） ──
  ipcMain.handle("novel-pack-save", (_event, payload: PackSavePayloadDto): boolean => {
    const characterId = payload.character.id;
    if (!characterId) return false;
    // 库未就绪（未登录 / 正在退出 / 已关闭）必须**优雅拒绝**而不是抛错：
    // getDb() 在 try 块外抛「尚未初始化 novel 数据」会变成渲染层无法理解的
    // 异常（退出瞬间曾因此刷屏）。返回 false 让渲染层走它自己的失败分支
    // —— 草稿还在主进程表里，数据不会丢。
    if (!isNovelDbReady()) {
      console.error("[novel-pack-save] novel.db 未就绪（未登录或正在退出），拒绝保存");
      return false;
    }
    const db = getDb();
    const now = Date.now();

    const apply = db.transaction(() => {
      // ① 写前快照：这是「撤销到上次保存」的回退点（REQ-042）
      const before = readCharacterSnapshot(characterId);
      const hasData =
        before.attrDefs.length > 0 ||
        before.attributes.length > 0 ||
        before.mappings.length > 0 ||
        before.slots.length > 0 ||
        before.groups.length > 0 ||
        before.items.length > 0 ||
        before.skills.length > 0 ||
        before.unitSystems.length > 0;
      if (hasData) {
        /**
         * 额外把**当时的境界关联行**一并存进 payload（REQ-029）。
         *
         * 境界的真实值住在 `novel_links`（主角绑定了实体时），而它不随行囊文档走，
         * 记录里的 `character.realm_at` 在绑定状态下是空的 —— 不存这一格，
         * 「本章初」的境界就永久丢了，「与本章初对比」会永远少掉
         * 「境界 筑基六层 → 筑基七层」这一行。
         *
         * 这里只**搬数据**、不解释数据：关联行原样存，解析与小层换算仍归渲染层的
         * `pack-realm.ts`（在 main 里重写一遍就是第二个真相源）。
         */
        const beforeRealmLink = before.character
          ? readRealmLink(before.character.entityId)
          : null;
        dbRun(
          `INSERT INTO novel_pack_records (id, character_id, chapter_id, taken_at, reason, payload)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            createId("pr"),
            characterId,
            payload.chapterId || null,
            now,
            payload.reason || "改动前自动存档",
            JSON.stringify({ ...before, realmLink: beforeRealmLink }),
          ],
        );
        dbRun(
          `DELETE FROM novel_pack_records WHERE character_id = ? AND id IN (
             SELECT id FROM novel_pack_records WHERE character_id = ?
             ORDER BY taken_at DESC LIMIT -1 OFFSET ?
           )`,
          [characterId, characterId, RECORD_KEEP],
        );
      }

      // ② 整体替换（任一语句抛错 → better-sqlite3 自动回滚整事务，不留中间态）

      // ⚠️ 顺序是硬约束：**加成必须先于它的宿主删**。
      // `novel_pack_modifiers` 是多态表（只有 owner_type/owner_id，没有 character_id），
      // 只能靠子查询从 items/skills 反查归属。若先把 items/skills 删掉，反查子查询
      // 立刻变成空集 → 一条加成也删不掉 → 紧接着重新插入同 id 就撞主键：
      //   `UNIQUE constraint failed: novel_pack_modifiers.id`
      // 而整个保存是一个事务，抛错即整体回滚 → 用户侧表现为「行囊存不上」。
      // 用模板行囊（固定 id `tpl-pm-*`）时必现，因为 id 每次保存都完全一样。
      dbRun(
        `DELETE FROM novel_pack_modifiers
          WHERE (owner_type = 'item'   AND owner_id IN (SELECT id FROM novel_pack_items  WHERE character_id = ?))
             OR (owner_type = 'skill'  AND owner_id IN (SELECT id FROM novel_pack_skills WHERE character_id = ?))
             OR (owner_type = 'status' AND owner_id = ?)`,
        [characterId, characterId, characterId],
      );
      // 顺手清孤儿：宿主已经不存在的加成。历史上正因为上面那段顺序写反而残留下来，
      // 它们既不显示也不参与汇总，只会越攒越多、并在将来某次 id 复用时突然报主键冲突。
      // 限定 item / skill 两类（status 的 owner_id 就是 character_id，不参与本清理）。
      dbRun(
        `DELETE FROM novel_pack_modifiers
          WHERE (owner_type = 'item'  AND owner_id NOT IN (SELECT id FROM novel_pack_items))
             OR (owner_type = 'skill' AND owner_id NOT IN (SELECT id FROM novel_pack_skills))`,
      );

      // 属性定义按作品整体替换（v1 一书一主角；多角色时需改为「以 payload 里的
      // defs 为准做增量」，当前结构下整体替换最直白也最少出错的路径）
      dbRun("DELETE FROM novel_pack_attr_defs WHERE work_id = ?", [payload.character.workId]);
      for (const table of [
        "novel_pack_attributes",
        "novel_pack_mappings",
        "novel_pack_slots",
        "novel_pack_groups",
        "novel_pack_categories",
        "novel_pack_items",
        "novel_pack_skills",
        "novel_pack_unit_systems",
        "novel_pack_layouts",
        "novel_pack_presets",
      ]) {
        dbRun(`DELETE FROM ${table} WHERE character_id = ?`, [characterId]);
      }

      const c = payload.character;
      // ⚠️ 保存**不回写 `entity_id`**：主角绑定是跨模块共享的一格数据，写入口
      // 唯一（`novel-pack-protagonist-set`）。若让整文档保存也参与写它，草稿里
      // 那份可能已经过期的快照就会在保存时把右侧栏刚设的主角覆盖掉——
      // 「行囊里显示未指定、右侧卡上却戴着皇冠」正是这么来的。
      dbRun(
        `INSERT INTO novel_pack_characters
           (id, work_id, name, avatar, is_protagonist, entity_id, realm_at, note, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           work_id = excluded.work_id, name = excluded.name, avatar = excluded.avatar,
           is_protagonist = excluded.is_protagonist,
           realm_at = excluded.realm_at, note = excluded.note,
           sort_order = excluded.sort_order`,
        [
          c.id,
          c.workId,
          c.name ?? "主角",
          c.avatar || null,
          toInt(c.isProtagonist),
          c.entityId || null,
          c.realmAt || null,
          c.note ?? "",
          c.sortOrder ?? 1,
        ],
      );

      const attrDefStmt = db.prepare(
        `INSERT INTO novel_pack_attr_defs
           (id, work_id, key, name, group_name, unit, decimals, default_value, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const d of payload.attrDefs) {
        // 每一格都兜底：better-sqlite3 对 undefined 绑定直接抛错 → 整事务回滚，
        // 用户侧只有一句「保存失败」。草稿是跨版本 JSON，任何一个字段缺省
        // 都不该让整份文档存不进去（历史报障「使用属性模板后保存失败」）。
        attrDefStmt.run(
          d.id,
          payload.character.workId,
          d.key || null,
          d.name ?? "",
          d.groupName ?? "基础属性",
          d.unit ?? "",
          d.decimals ?? 0,
          d.defaultValue ?? 0,
          d.sortOrder ?? 0,
        );
      }

      // 数值行 id 恒等于 defId（一角色一属性至多一行）—— 渲染层组合视图时
      // 直接以 defId 为行身份，效果 / 映射引用的也是 defId，三方同键不分叉
      const attrStmt = db.prepare(
        `INSERT INTO novel_pack_attributes
           (id, character_id, def_id, base_value, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const a of payload.attributes) {
        attrStmt.run(a.id, characterId, a.defId, a.baseValue ?? 0, a.updatedAt || 0);
      }

      const mappingStmt = db.prepare(
        `INSERT INTO novel_pack_mappings
           (id, character_id, source_attr_id, target_attr_id, rate, note, sort_order, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const m of payload.mappings ?? []) {
        mappingStmt.run(
          m.id,
          characterId,
          m.sourceAttrId ?? "",
          m.targetAttrId ?? "",
          m.rate || 0,
          m.note ?? "",
          m.sortOrder ?? 0,
          m.updatedAt || 0,
        );
      }

      const slotStmt = db.prepare(
        `INSERT INTO novel_pack_slots
           (id, character_id, name, capacity, accepts, enabled, note, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const s of payload.slots) {
        slotStmt.run(
          s.id,
          characterId,
          s.name ?? "",
          s.capacity ?? 1,
          JSON.stringify(s.accepts ?? []),
          toInt(s.enabled),
          s.note ?? "",
          s.sortOrder ?? 0,
        );
      }

      const groupStmt = db.prepare(
        `INSERT INTO novel_pack_groups
           (id, character_id, name, icon, can_equip, can_enable, prof_scheme_id, enabled, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const g of payload.groups ?? []) {
        groupStmt.run(
          g.id,
          characterId,
          g.name ?? "",
          g.icon ?? "",
          toInt(g.canEquip),
          toInt(g.canEnable),
          g.profSchemeId || null,
          toInt(g.enabled),
          g.sortOrder ?? 0,
        );
      }

      const categoryStmt = db.prepare(
        `INSERT INTO novel_pack_categories
           (id, character_id, name, system_id, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
      );
      for (const cat of payload.categories ?? []) {
        categoryStmt.run(
          cat.id,
          characterId,
          cat.name ?? "",
          cat.systemId ?? "",
          cat.sortOrder ?? 0,
        );
      }

      const itemStmt = db.prepare(
        `INSERT INTO novel_pack_items
           (id, character_id, name, category, qty, rarity, icon, desc, tags,
            equipped_slot_id, slot_index, group_id, grade_id, source_chapter_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const i of payload.items) {
        itemStmt.run(
          i.id,
          characterId,
          i.name ?? "",
          i.category ?? "misc",
          i.qty ?? 1,
          i.rarity ?? "common",
          i.icon ?? "",
          i.desc ?? "",
          JSON.stringify(i.tags ?? []),
          i.equippedSlotId || null,
          i.slotIndex ?? null,
          i.groupId || "",
          i.gradeId || "",
          i.sourceChapterId || null,
          i.updatedAt || now,
        );
      }

      const skillStmt = db.prepare(
        `INSERT INTO novel_pack_skills
           (id, character_id, name, desc, enabled, group_id, proficiency_raw, grade_id, tags, sort_order, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const s of payload.skills) {
        skillStmt.run(
          s.id,
          characterId,
          s.name ?? "",
          s.desc ?? "",
          toInt(s.enabled),
          s.groupId || "",
          s.proficiencyRaw ?? 0,
          s.gradeId || "",
          JSON.stringify(s.tags ?? []),
          s.sortOrder ?? 0,
          s.updatedAt || 0,
        );
      }

      const modStmt = db.prepare(
        `INSERT INTO novel_pack_modifiers
           (id, owner_type, owner_id, nature, name, target_attr_id, op, value, value_unit,
            scale_by_proficiency, active, default_on, cost, cooldown, duration, rounds_left,
            target, trigger, condition, note, disabled, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const m of payload.modifiers) {
        modStmt.run(
          m.id,
          m.ownerType,
          m.ownerId,
          m.nature,
          m.name ?? "",
          m.targetAttrId || null,
          m.op,
          m.value ?? 0,
          m.valueUnit || null,
          toInt(m.scaleByProficiency),
          toInt(m.active),
          toInt(m.defaultOn),
          m.cost || null,
          m.cooldown ?? null,
          m.duration || null,
          m.roundsLeft ?? null,
          m.target || null,
          m.trigger || null,
          m.condition || null,
          m.note ?? "",
          toInt(m.disabled),
          m.sortOrder ?? 0,
        );
      }

      const unitStmt = db.prepare(
        `INSERT INTO novel_pack_unit_systems
           (id, character_id, name, kind, levels, config, is_default, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const u of payload.unitSystems) {
        unitStmt.run(
          u.id,
          characterId,
          u.name ?? "",
          u.kind,
          u.levels ?? "[]",
          u.config ?? "{}",
          toInt(u.isDefault),
          u.sortOrder ?? 0,
        );
      }

      const layoutStmt = db.prepare(
        `INSERT INTO novel_pack_layouts (character_id, module_key, enabled, sort_order)
         VALUES (?, ?, ?, ?)`,
      );
      for (const l of payload.layouts) {
        layoutStmt.run(characterId, l.moduleKey, toInt(l.enabled), l.sortOrder ?? 0);
      }

      const presetStmt = db.prepare(
        `INSERT INTO novel_pack_presets
           (id, character_id, name, payload, note, sort_order, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const p of payload.presets ?? []) {
        presetStmt.run(
          p.id,
          characterId,
          p.name ?? "",
          p.payload ?? "[]",
          p.note ?? "",
          p.sortOrder ?? 0,
          p.updatedAt || 0,
        );
      }

      // ③ 境界关联行（novel_links）—— 与文档同事务写入。
      // ⚠️ 顺序与原子性是硬要求：境界真实值住在 novel_links，早期实现把它拆成
      // 「文档事务提交后再单独 novel-link-set」，两步之间失败即半保存态。
      // 放在同一事务里，任一语句抛错 → better-sqlite3 整体回滚，渲染层拿到的
      // false 才是真的「什么都没写」。
      if (payload.realmLink) {
        upsertRealmLinkRow(payload.realmLink);
      }

      // ④ 提交成功 → 清空草稿（草稿只承载未提交中间态）
      dbRun("DELETE FROM novel_pack_drafts WHERE character_id = ?", [characterId]);
    });

    try {
      apply();
      return true;
    } catch (error) {
      console.error("[novel-pack-save] 事务失败，已整体回滚：", error);
      return false;
    }
  });

  // ── 草稿（跨窗口一份；编辑防抖写入，崩溃不丢 §8.6.2） ──
  ipcMain.handle(
    "novel-pack-draft-set",
    (_event, characterId: string, payload: string, dirtyCount: number): boolean => {
      if (!characterId) return false;
      dbRun(
        `INSERT INTO novel_pack_drafts (character_id, payload, dirty_count, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(character_id) DO UPDATE SET
           payload = excluded.payload, dirty_count = excluded.dirty_count,
           updated_at = excluded.updated_at`,
        [characterId, payload, dirtyCount, Date.now()],
      );
      return true;
    },
  );

  ipcMain.handle("novel-pack-draft-get", (_event, characterId: string): PackDraftDto | null => {
    const row = dbGet("SELECT * FROM novel_pack_drafts WHERE character_id = ?", [
      characterId,
    ]) as PackDraftRow | undefined;
    return row ? toDraftDto(row) : null;
  });

  ipcMain.handle("novel-pack-draft-clear", (_event, characterId: string): boolean => {
    dbRun("DELETE FROM novel_pack_drafts WHERE character_id = ?", [characterId]);
    return true;
  });

  ipcMain.handle(
    "novel-pack-record-list",
    (_event, characterId: string, limit = RECORD_KEEP): PackRecordDto[] =>
      (
        dbAll(
          "SELECT * FROM novel_pack_records WHERE character_id = ? ORDER BY taken_at DESC LIMIT ?",
          [characterId, limit],
        ) as PackRecordRow[]
      ).map(toRecordDto),
  );

  // ── 境界幂等写入（§9.7.3：避免前端自行判断 add 还是 remove） ──
  ipcMain.handle(
    "novel-link-set",
    (
      _event,
      link: {
        id: string;
        fromType: string;
        fromId: string;
        toType: string;
        toId: string;
        relation: string;
        note?: string;
      },
    ): boolean => {
      if (!link.fromId || !link.toId || !link.relation) return false;
      const db = getDb();
      const apply = db.transaction(() => {
        // 同一 (来源, 目标类型, 关系) 只保留一行：先清后插即幂等
        // （与 `novel-pack-save` 内联写入共用同一实现，禁各写一份）
        upsertRealmLinkRow({
          id: link.id,
          fromType: link.fromType,
          fromId: link.fromId,
          toType: link.toType,
          toId: link.toId,
          relation: link.relation,
          note: link.note ?? "",
        });
      });
      try {
        apply();
        return true;
      } catch (error) {
        console.error("[novel-link-set] 失败：", error);
        return false;
      }
    },
  );
}

/** 首次使用播种通用装备部位（PRD 附录 A） */
function seedDefaultSlots(characterId: string): void {
  const presets: Array<{ name: string; capacity: number }> = [
    { name: "武器", capacity: 1 },
    { name: "头盔", capacity: 1 },
    { name: "上衣", capacity: 1 },
    { name: "护腕", capacity: 1 },
    { name: "手套", capacity: 1 },
    { name: "腰带", capacity: 1 },
    { name: "下装", capacity: 1 },
    { name: "靴子", capacity: 1 },
    { name: "项链", capacity: 1 },
    { name: "戒指", capacity: 2 },
    { name: "饰品", capacity: 1 },
    { name: "坐骑", capacity: 1 },
  ];
  presets.forEach((preset, index) => {
    dbRun(
      `INSERT INTO novel_pack_slots (id, character_id, name, capacity, accepts, enabled, note, sort_order)
       VALUES (?, ?, ?, ?, '[]', 1, '', ?)`,
      [createId("ps"), characterId, preset.name, preset.capacity, index + 1],
    );
  });
}
