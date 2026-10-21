/**
 * 要素领域模型（跨窗口单一真相源）
 *
 * 为什么提到 shared：R27 把「人物关系网络」升级为独立窗口（RelationWindow），
 * 它需要读同一份要素 / 关联数据。窗口之间禁止互相导入（见 AGENTS.md 的分层约定），
 * 所以实体与关联这两个**纯类型**上提到 shared，NovelPage 的 `types.ts` 原地
 * re-export，既有导入路径零改动。
 *
 * 这里只放类型，不放实现；也不依赖任何窗口层模块。
 */

/** 内置要素类型：预置五类 + custom 兜底（用户自建类型删除时的迁移落点） */
export type BuiltinEntityType =
  | "character"
  | "location"
  | "faction"
  | "item"
  | "level_system"
  | "custom";

/**
 * 要素类型（R23 开放化）：内置六类 + 用户自建类型（id 固定 ct- 前缀）。
 * `(string & {})` 保住内置字面量的自动补全，同时放行任意自建 id；
 * 自建类型的展示 meta 由 EntityTypeContext 派生，不要直接查 ENTITY_TYPE_META。
 */
export type EntityType = BuiltinEntityType | (string & {});

/** 用户自建要素类型定义（R23）：整读整写存 config 键 novel_entity_types */
export interface CustomEntityTypeDef {
  id: string;
  name: string;
  /** 主色（具体色值，色板提供）；弱色由 color-mix 在使用处派生 */
  color: string;
}

/** 要素自定义扩展字段 */
export type EntityFields = Record<string, string>;

/** 要素实体（原「设定卡」，PRD v0.4 R23） */
export interface NovelEntity {
  id: string;
  workId: string;
  type: EntityType;
  name: string;
  aliases: string[];
  summary: string;
  content: string;
  fields: EntityFields;
  sort: number;
}

/** 要素多态关联（PRD R24）：任意两个要素互相关联 */
export interface NovelLink {
  id: string;
  fromType: EntityType;
  fromId: string;
  toType: EntityType;
  toId: string;
  relation: string;
  note?: string;
}
