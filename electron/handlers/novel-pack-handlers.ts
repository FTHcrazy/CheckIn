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
 */
import { ipcMain } from "electron";
import { dbAll, dbGet, dbRun, getDb } from "../db";

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

interface PackAttributeRow {
  id: string;
  character_id: string;
  group_name: string;
  name: string;
  base_value: number;
  decimals: number;
  unit: string;
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
  source_chapter_id: string | null;
  updated_at: number;
}

interface PackSkillRow {
  id: string;
  character_id: string;
  name: string;
  desc: string;
  enabled: number;
  proficiency_raw: number;
  tags: string;
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
  target: string | null;
  trigger: string | null;
  condition: string | null;
  note: string;
  disabled: number;
  sort_order: number;
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

interface NovelLevelRow2 {
  id: string;
  system_id: string;
  name: string;
  rank: number;
  note: string | null;
  sub_levels: number;
  power: number | null;
}

interface NovelLevelSystemRow2 {
  id: string;
  work_id: string;
  name: string;
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

export interface PackAttributeDto {
  id: string;
  characterId: string;
  groupName: string;
  name: string;
  baseValue: number;
  decimals: number;
  unit: string;
  sortOrder: number;
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
  sourceChapterId: string;
  updatedAt: number;
}

export interface PackSkillDto {
  id: string;
  characterId: string;
  name: string;
  desc: string;
  enabled: boolean;
  proficiencyRaw: number;
  tags: string[];
  sortOrder: number;
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
  target: string;
  trigger: string;
  condition: string;
  note: string;
  disabled: boolean;
  sortOrder: number;
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
}

export interface PackLevelSystemDto {
  id: string;
  workId: string;
  name: string;
  rungs: PackLevelRungDto[];
}

export interface PackBundleDto {
  character: PackCharacterDto | null;
  attributes: PackAttributeDto[];
  slots: PackSlotDto[];
  items: PackItemDto[];
  skills: PackSkillDto[];
  modifiers: PackModifierDto[];
  unitSystems: PackUnitSystemDto[];
  layouts: PackLayoutDto[];
  records: PackRecordDto[];
  draft: PackDraftDto | null;
  /** R25 等级体系（境界模块直接复用，不建副本表 §9.7） */
  levelSystems: PackLevelSystemDto[];
  /** 主角绑定的实体当前的「当前境界」关联行（无则 null） */
  realmLink: PackRealmLinkDto | null;
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
  attributes: PackAttributeDto[];
  slots: PackSlotDto[];
  items: PackItemDto[];
  skills: PackSkillDto[];
  modifiers: PackModifierDto[];
  unitSystems: PackUnitSystemDto[];
  layouts: PackLayoutDto[];
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

// ── 行 → DTO ──

function toCharacterDto(row: PackCharacterRow): PackCharacterDto {
  return {
    id: row.id,
    workId: row.work_id,
    name: row.name,
    avatar: row.avatar ?? "",
    isProtagonist: row.is_protagonist === 1,
    entityId: row.entity_id ?? "",
    realmAt: row.realm_at ?? "",
    note: row.note,
    sortOrder: row.sort_order,
  };
}

function toAttributeDto(row: PackAttributeRow): PackAttributeDto {
  return {
    id: row.id,
    characterId: row.character_id,
    groupName: row.group_name,
    name: row.name,
    baseValue: row.base_value,
    decimals: row.decimals,
    unit: row.unit,
    sortOrder: row.sort_order,
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
    proficiencyRaw: row.proficiency_raw,
    tags: parseJsonArray(row.tags),
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

/** 读取某角色当前正式数据（供保存前的回退点快照使用） */
function readCharacterSnapshot(characterId: string): PackBundleDto {
  return {
    character:
      (dbGet("SELECT * FROM novel_pack_characters WHERE id = ?", [
        characterId,
      ]) as PackCharacterRow | undefined)?.id !== undefined
        ? toCharacterDto(
            dbGet("SELECT * FROM novel_pack_characters WHERE id = ?", [
              characterId,
            ]) as PackCharacterRow,
          )
        : null,
    attributes: (
      dbAll("SELECT * FROM novel_pack_attributes WHERE character_id = ? ORDER BY sort_order", [
        characterId,
      ]) as PackAttributeRow[]
    ).map(toAttributeDto),
    slots: (
      dbAll("SELECT * FROM novel_pack_slots WHERE character_id = ? ORDER BY sort_order", [
        characterId,
      ]) as PackSlotRow[]
    ).map(toSlotDto),
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
    draft: null,
    levelSystems: [],
    realmLink: null,
  };
}

/** 读取 R25 等级体系（含 sub_levels / power） */
function readLevelSystems(): PackLevelSystemDto[] {
  const systems = dbAll("SELECT * FROM novel_level_systems") as NovelLevelSystemRow2[];
  return systems.map((system) => ({
    id: system.id,
    workId: system.work_id,
    name: system.name,
    rungs: (
      dbAll("SELECT * FROM novel_levels WHERE system_id = ? ORDER BY rank", [
        system.id,
      ]) as NovelLevelRow2[]
    ).map((level) => ({
      id: level.id,
      name: level.name,
      rank: level.rank,
      subLevels: level.sub_levels ?? 1,
      power: level.power,
    })),
  }));
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
  return {
    id: row.id,
    fromType: row.from_type,
    fromId: row.from_id,
    toType: row.to_type,
    toId: row.to_id,
    relation: row.relation,
    note: row.note ?? "",
  };
}

/**
 * 取该作品的行囊主角行；不存在则播种一条并套上通用部位预设（PRD 附录 A）。
 *
 * 抽成公共函数是因为「首次使用」有两个入口：打开行囊面板，以及在右侧要素栏
 * 把某个角色设为主角。两个入口都必须能建出同一条骨架，否则从要素栏设主角
 * 会写到一个不存在的 character_id 上（静默丢绑定）。
 */
function ensurePackCharacterRow(workId: string): PackCharacterRow {
  const existing = dbGet(
    "SELECT * FROM novel_pack_characters WHERE work_id = ? ORDER BY sort_order LIMIT 1",
    [workId],
  ) as PackCharacterRow | undefined;
  if (existing) return existing;

  const id = createId("pc");
  dbRun(
    `INSERT INTO novel_pack_characters
       (id, work_id, name, is_protagonist, entity_id, realm_at, note, sort_order)
     VALUES (?, ?, '主角', 1, NULL, NULL, '', 1)`,
    [id, workId],
  );
  seedDefaultSlots(id);
  return dbGet("SELECT * FROM novel_pack_characters WHERE id = ?", [
    id,
  ]) as PackCharacterRow;
}

export function registerNovelPackHandlers(): void {
  // ── 全量装载 ──
  ipcMain.handle("novel-pack-load", (_event, workId: string): PackBundleDto => {
    const characterRow = ensurePackCharacterRow(workId);

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
      levelSystems: readLevelSystems(),
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

  // ── 整文档事务保存（写前先落回退点，成功后清草稿） ──
  ipcMain.handle("novel-pack-save", (_event, payload: PackSavePayloadDto): boolean => {
    const characterId = payload.character.id;
    if (!characterId) return false;
    const db = getDb();
    const now = Date.now();

    const apply = db.transaction(() => {
      // ① 写前快照：这是「撤销到上次保存」的回退点（REQ-042）
      const before = readCharacterSnapshot(characterId);
      const hasData =
        before.attributes.length > 0 ||
        before.slots.length > 0 ||
        before.items.length > 0 ||
        before.skills.length > 0 ||
        before.unitSystems.length > 0;
      if (hasData) {
        dbRun(
          `INSERT INTO novel_pack_records (id, character_id, chapter_id, taken_at, reason, payload)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            createId("pr"),
            characterId,
            payload.chapterId || null,
            now,
            payload.reason || "改动前自动存档",
            JSON.stringify(before),
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

      for (const table of [
        "novel_pack_attributes",
        "novel_pack_slots",
        "novel_pack_items",
        "novel_pack_skills",
        "novel_pack_unit_systems",
        "novel_pack_layouts",
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
           realm_at = excluded.realm_at, note = excluded.note, sort_order = excluded.sort_order`,
        [
          c.id,
          c.workId,
          c.name,
          c.avatar || null,
          toInt(c.isProtagonist),
          c.entityId || null,
          c.realmAt || null,
          c.note,
          c.sortOrder,
        ],
      );

      const attrStmt = db.prepare(
        `INSERT INTO novel_pack_attributes
           (id, character_id, group_name, name, base_value, decimals, unit, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const a of payload.attributes) {
        attrStmt.run(
          a.id,
          characterId,
          a.groupName,
          a.name,
          a.baseValue,
          a.decimals,
          a.unit,
          a.sortOrder,
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
          s.name,
          s.capacity,
          JSON.stringify(s.accepts),
          toInt(s.enabled),
          s.note,
          s.sortOrder,
        );
      }

      const itemStmt = db.prepare(
        `INSERT INTO novel_pack_items
           (id, character_id, name, category, qty, rarity, icon, desc, tags,
            equipped_slot_id, slot_index, source_chapter_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const i of payload.items) {
        itemStmt.run(
          i.id,
          characterId,
          i.name,
          i.category,
          i.qty,
          i.rarity,
          i.icon,
          i.desc,
          JSON.stringify(i.tags),
          i.equippedSlotId || null,
          i.slotIndex,
          i.sourceChapterId || null,
          i.updatedAt || now,
        );
      }

      const skillStmt = db.prepare(
        `INSERT INTO novel_pack_skills
           (id, character_id, name, desc, enabled, proficiency_raw, tags, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const s of payload.skills) {
        skillStmt.run(
          s.id,
          characterId,
          s.name,
          s.desc,
          toInt(s.enabled),
          s.proficiencyRaw,
          JSON.stringify(s.tags),
          s.sortOrder,
        );
      }

      const modStmt = db.prepare(
        `INSERT INTO novel_pack_modifiers
           (id, owner_type, owner_id, nature, name, target_attr_id, op, value, value_unit,
            scale_by_proficiency, active, default_on, cost, cooldown, duration, target,
            trigger, condition, note, disabled, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const m of payload.modifiers) {
        modStmt.run(
          m.id,
          m.ownerType,
          m.ownerId,
          m.nature,
          m.name,
          m.targetAttrId || null,
          m.op,
          m.value,
          m.valueUnit || null,
          toInt(m.scaleByProficiency),
          toInt(m.active),
          toInt(m.defaultOn),
          m.cost || null,
          m.cooldown,
          m.duration || null,
          m.target || null,
          m.trigger || null,
          m.condition || null,
          m.note,
          toInt(m.disabled),
          m.sortOrder,
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
          u.name,
          u.kind,
          u.levels,
          u.config,
          toInt(u.isDefault),
          u.sortOrder,
        );
      }

      const layoutStmt = db.prepare(
        `INSERT INTO novel_pack_layouts (character_id, module_key, enabled, sort_order)
         VALUES (?, ?, ?, ?)`,
      );
      for (const l of payload.layouts) {
        layoutStmt.run(characterId, l.moduleKey, toInt(l.enabled), l.sortOrder);
      }

      // ③ 提交成功 → 清空草稿（草稿只承载未提交中间态）
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
        dbRun(
          "DELETE FROM novel_links WHERE from_type = ? AND from_id = ? AND to_type = ? AND relation = ?",
          [link.fromType, link.fromId, link.toType, link.relation],
        );
        dbRun(
          "INSERT INTO novel_links (id, from_type, from_id, to_type, to_id, relation, note) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [
            link.id,
            link.fromType,
            link.fromId,
            link.toType,
            link.toId,
            link.relation,
            link.note ?? null,
          ],
        );
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

  // ── 等级项补列（§9.7.2 缺口①②：小层数 / 战力当量） ──
  ipcMain.handle(
    "novel-level-meta-set",
    (_event, id: string, meta: { subLevels?: number; power?: number | null }): boolean => {
      const current = dbGet("SELECT sub_levels, power FROM novel_levels WHERE id = ?", [
        id,
      ]) as { sub_levels: number; power: number | null } | undefined;
      if (!current) return false;
      const subLevels =
        meta.subLevels === undefined
          ? current.sub_levels
          : Math.max(1, Math.floor(meta.subLevels) || 1);
      const power = meta.power === undefined ? current.power : meta.power;
      dbRun("UPDATE novel_levels SET sub_levels = ?, power = ? WHERE id = ?", [
        subLevels,
        power,
        id,
      ]);
      return true;
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
