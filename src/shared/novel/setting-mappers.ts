/**
 * 设定 DTO → 领域对象的**唯一**映射实现（N-06）
 *
 * 背景：全局库 DTO（`NovelGlobalSettingCategoryDTO` / `NovelGlobalSettingLevelDTO`）
 * 转成渲染层 `SettingCategory` / `SettingLevel` 的字段映射，此前在渲染层写了两份：
 * - `NovelPage.tsx` 的 `refreshGlobalCategories`（「从全局库选择」选择器）—— 逐字段
 *   直传，**无任何兜底**：`note` 缺失就是 `undefined`、`levels` 非数组直接抛错；
 * - `GlobalSettingWindow` 的 `useGlobalSetting.toCategory` / `toLevel` —— 带
 *   `?? ""` / `?? 1` / `?? null` / `Array.isArray` 的防御。
 *
 * 同一套字段两份实现，加一列就会漏一处（走查 N-06）。两者对**合法 DTO** 输出一致，
 * 差异只在「缺字段 / 坏结构」时暴露 —— 而这恰恰是 IPC 边界最常见的输入形态。
 *
 * 本文件是这两份的合并实现，口径以**防御更完备**的那份（`useGlobalSetting`）为基准：
 * 缺字段一律回退默认值，非法结构（`levels` 非数组）回退空数组，**绝不抛错**。
 * 本书域 / 全局域的形态差异（作品归属、引用计数）通过 `options` 承载，不改函数体。
 *
 * 本文件是纯函数、不含 React / 不碰 IO（跨窗口共享位，见 `setting-types.ts` 同款约束）。
 */
import type { SettingCategory, SettingLevel } from "./setting-types";

/**
 * 等级 DTO 的结构化输入：本书 `NovelSettingLevelDTO` 与全局
 * `NovelGlobalSettingLevelDTO` 的字段交集，两边都能直接传入。
 * 除 `id` / `categoryId` / `name` / `rank` 外一律可缺省 —— 正是为兜底兜住的那些字段。
 */
export interface SettingLevelDTO {
  id: string;
  categoryId: string;
  name: string;
  rank: number;
  aliases?: string[] | null;
  note?: string | null;
  subLevels?: number | null;
  subPattern?: string | null;
  power?: number | null;
  parentId?: string | null;
  segFrom?: number | null;
  segTo?: number | null;
}

/**
 * 分类 DTO 的结构化输入：本书 `NovelSettingCategoryDTO`（多 `workId` /
 * `sourceGlobalId` / `detachedFromName`）与全局 `NovelGlobalSettingCategoryDTO`
 * （多 `refCount`、无 `workId`）的**并集**，互补字段做可选。
 */
export interface SettingCategoryDTO {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  /** 全局库与本书域都只可能是 'realm' | 'custom'；放宽为 string 以便坏数据也走兜底分支 */
  kind?: string | null;
  note?: string | null;
  subLevels?: number | null;
  /** 同上：正常只可能是 'asc' | 'desc' */
  carryDir?: string | null;
  subPattern?: string | null;
  levels?: SettingLevelDTO[] | null;
  /** 全局 DTO 才有：作品归属（本书域 DTO 带）；全局库无归属时由 options 传 "" */
  workId?: string | null;
  /** 全局 DTO 才有：被多少部书引用（仅全局域展示徽标） */
  refCount?: number | null;
  /** 本书 DTO 才有：引用自全局中心的镜像标记 */
  sourceGlobalId?: string | null;
  /** 本书 DTO 才有：原全局项已删除、已固化为本书副本 */
  detachedFromName?: string | null;
}

/** `toSettingCategory` 的形态开关（承载本书域 / 全局域的差异，不影响字段口径） */
export interface ToSettingCategoryOptions {
  /**
   * 分类归属作品 id。全局库与作品无关 —— 传 `""` 覆盖（全局 DTO 本就没有
   * `workId` 字段，缺省也会回退成 `""`）。本书域不传则沿用 DTO 自带值。
   */
  workId?: string;
  /**
   * 是否带上 `refCount`。全局域要（列表显示「N 部书引用」徽标）；
   * 本书域不需要，带上会给每行多一个无用字段。
   */
  withRefCount?: boolean;
}

/**
 * 等级 DTO → `SettingLevel`：字段一一对应，缺省值兜底（口径以全局域那份为基准）。
 *
 * `aliases` 用 `Array.isArray` 判定而非 `??`：坏数据里它可能是字符串等非数组值，
 * `??` 只兜 `null` / `undefined`，非数组会原样带下去、在调用方 `.map` / `.join`
 * 处才炸。这里统一收口成空数组。
 */
export function toSettingLevel(dto: SettingLevelDTO): SettingLevel {
  return {
    id: dto.id,
    categoryId: dto.categoryId,
    name: dto.name,
    rank: dto.rank,
    aliases: Array.isArray(dto.aliases) ? dto.aliases : [],
    note: dto.note ?? "",
    subLevels: dto.subLevels ?? 1,
    subPattern: dto.subPattern ?? "",
    power: dto.power ?? null,
    parentId: dto.parentId ?? null,
    segFrom: dto.segFrom ?? null,
    segTo: dto.segTo ?? null,
  };
}

/**
 * 分类 DTO → `SettingCategory`：字段一一对应 + 缺省值兜底（N-06 的唯一实现）。
 *
 * 兜底口径（与全局域旧 `toCategory` 一致，并把它的 `??` 升级为 `Array.isArray`）：
 * - `kind` 只认 `"realm"`，其余（含缺省 / 坏值）→ `"custom"`；
 * - `carryDir` 只认 `"desc"`，其余 → `"asc"`；
 * - `note` / `subPattern` → `""`；`subLevels` → `1`；`refCount` → `0`；
 *   `levels` 非数组 → `[]`；
 * - `workId` 先取 `options.workId`，再退 DTO 自带值，最后 `""`。
 *
 * 可选字段 `refCount` / `sourceGlobalId` / `detachedFromName` **按需写键**：
 * 全局域不带后两者（DTO 也无），本书域才带 —— 避免给全局输出平添两个 `undefined` 字段。
 */
export function toSettingCategory(
  dto: SettingCategoryDTO,
  options: ToSettingCategoryOptions = {},
): SettingCategory {
  const category: SettingCategory = {
    id: dto.id,
    workId: options.workId ?? dto.workId ?? "",
    name: dto.name,
    color: dto.color,
    kind: dto.kind === "realm" ? "realm" : "custom",
    sortOrder: dto.sortOrder,
    note: dto.note ?? "",
    subLevels: dto.subLevels ?? 1,
    carryDir: dto.carryDir === "desc" ? "desc" : "asc",
    subPattern: dto.subPattern ?? "",
    levels: Array.isArray(dto.levels) ? dto.levels.map(toSettingLevel) : [],
  };

  if (options.withRefCount) category.refCount = dto.refCount ?? 0;
  // 本书域镜像标记：仅当 DTO 真的带了这两个键才产出，全局域输出不受影响
  if (dto.sourceGlobalId !== undefined) {
    category.sourceGlobalId = dto.sourceGlobalId ?? null;
  }
  if (dto.detachedFromName !== undefined) {
    category.detachedFromName = dto.detachedFromName ?? null;
  }

  return category;
}
