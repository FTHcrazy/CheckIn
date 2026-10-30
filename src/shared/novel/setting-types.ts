/**
 * 小说设定域的**纯类型**（本书域 / 全局域共用）
 *
 * 从 `NovelWindow/pages/NovelPage/types.ts` 迁入（N10）：设定类型要被**跨窗口**
 * 复用（本书设定中心与全局设定中心两个窗口都要用），而窗口之间禁止互相导入，
 * 所以提升到 `src/shared/novel/*`。原 `NovelPage/types.ts` 保留同名 re-export，
 * 既有 import 路径（`../types`）零改动。
 *
 * 本文件**不含 React**（跨窗口共享位，见 work-numbering 守卫同款约束）。
 */

/** 设定分类的性质：realm = 境界体系（每书/全库唯一，联动角色卡「当前境界」）；custom = 自定义分类 */
export type SettingCategoryKind = "realm" | "custom";

/**
 * 进位方向：
 * - `asc` 由低到高（引气 → 筑基 → 金丹）
 * - `desc` 由高到低（一品 → 二品 … 或倒序的「九品 → 一品」）
 */
export type CarryDirection = "asc" | "desc";

/** 设定等级项：一个分类下的阶梯节点（1.36.0 起取代 LevelRung） */
export interface SettingLevel {
  id: string;
  categoryId: string;
  name: string;
  /** 阶梯序号，从 1 起；同分类内唯一 */
  rank: number;
  /** 别名：写作里出现这些词也算引用了本阶（一致性检查据此识别「金丹期」） */
  aliases: string[];
  note: string;
  /** 本阶小层数（行囊境界换算按它展开） */
  subLevels: number;
  /** 本阶专属小层命名模板；空串 = 沿用分类的 subPattern（1.37.0） */
  subPattern: string;
  /** 战力当量：跨阶比较的可选基准 */
  power: number | null;
  /** 拆分层级后非 null：表示本行派生自 parentId，占据 [segFrom, segTo] 小层段 */
  parentId: string | null;
  segFrom: number | null;
  segTo: number | null;
}

/**
 * 批量追加的一条等级（`onBatchAddLevels` 的入参）。
 *
 * `note` 是**等级说明**：AI 排阶梯会给每级一句「这一级大致能做什么」，
 * 候选里看得见就必须能落进 `note` 列 —— 否则等于白生成（2.17.1 修）。
 * 小层数 / 小层命名不在这层给：不显式传时主进程回落到**分类默认**，
 * 与单条新增同口径。
 */
export interface LevelBatchItem {
  name: string;
  note?: string;
}

/**
 * 设定分类：境界体系 / 功法等级 / 丹药稀有度…一个分类挂一条等级序列。
 *
 * 1.4x 全局设定中心：`sourceGlobalId` 非空表示本分类是「引用自全局中心的镜像」
 * （只读，实时同步）；`detachedFromName` 非空表示原全局项已删除、已固化为本书副本。
 * 两者都是可选——全局库里的分类本就没有这两个概念。
 */
export interface SettingCategory {
  id: string;
  workId: string;
  name: string;
  /** 列表色点，纯展示 */
  color: string;
  kind: SettingCategoryKind;
  sortOrder: number;
  /** 分类说明 */
  note: string;
  /** 分类级默认小层数：新增等级项时继承 */
  subLevels: number;
  carryDir: CarryDirection;
  /** 小层命名模板，{n} 为层号占位符（如「第{n}层」「{n}品」） */
  subPattern: string;
  levels: SettingLevel[];
  /** 非空 = 引用自全局中心（只读镜像） */
  sourceGlobalId?: string | null;
  /** 非空 = 原全局项已删除，已固化为本书副本 */
  detachedFromName?: string | null;
  /**
   * 有多少部书正在引用这个分类（**仅全局域使用**，本书域恒为 undefined）。
   * 全局设定中心的分类列表据此显示「N 部书引用」徽标（REQ-041）。
   */
  refCount?: number;
}
