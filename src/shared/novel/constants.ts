/**
 * 小说域跨窗口共享常量
 *
 * 行囊模块已迁至 `shared/components/CharacterPack`（由 NovelWindow 与
 * PackWindow 两个窗口共用，窗口之间禁止互相导入），它依赖的两个
 * novel-config 常量提升到这里；NovelWindow 侧的 `novel-config.ts`
 * 原地 re-export，原使用方零改动。
 */

/**
 * userDb config 表存储键（PRD v0.5 步骤一）
 *
 * 设置与续写位置都是「单用户、低频写、整读整写」的小数据，
 * 复用既有 config 表（key-value）而不是为它们建新表。
 */
export const STORAGE_KEYS = {
  /** 排版与写作设置（R5 持久化） */
  settings: "novel_editor_settings",
  /** 上次续写位置：作品 / 章节 / 光标 / 滚动（R6） */
  position: "novel_editor_position",
  /** 自定义要素类型（R23）：CustomEntityTypeDef[] 整读整写 */
  entityTypes: "novel_entity_types",
  /** 起名工具收藏夹（R18 ④）：NameFavorite[] 整读整写，按作品持久化 */
  namingFavorites: "novel_naming_favorites",
  /** 起名工具自定义用字池（R18 ①）：NamingCustomPool 整读整写 */
  namingCustomPools: "novel_naming_custom_pools",
  /** 右栏宽度（支撑面板改版）：单个数字整读整写，270ms 防抖后落库 */
  panelWidth: "novel_panel_width",
  /**
   * 行囊界面偏好（CharacterPack，PRD §8.6.2）：模块折叠 /
   * 物品栏视图 / 展示熟练度 / 自动保存 —— 全部「即改即存」，不进草稿。
   */
  packUi: "novel_pack_ui",
} as const;

/** 「当前境界」关联名（novel_links.relation，行囊境界模块与实体面板共用） */
export const LEVEL_RELATION = "当前境界";
