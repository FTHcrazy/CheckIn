/**
 * 小说编辑器领域模型
 *
 * 字段口径全部对齐 PRD v0.4 §7「工程落点」的数据层定义：
 * 要素统一叫 entity（容纳角色 / 地点 / 势力 / 物品 / 等级体系 / 自定义类型），
 * 要素之间用多态关联 novel_links 表达，fields 以 JSON 键值承载自定义字段。
 *
 * 这一层只放类型，不放实现；渲染层与 hooks 通过它解耦。
 */

/** 要素类型：预置五类 + 用户自建类型统一走 custom */
export type EntityType =
  | "character"
  | "location"
  | "faction"
  | "item"
  | "level_system"
  | "custom";

/** 章节状态：草稿 / 完稿（PRD R1） */
export type ChapterStatus = "draft" | "done";

/** 保存状态机（设计方案 §06：idle → pending → saving → saved / failed） */
export type SaveState = "idle" | "pending" | "saving" | "saved" | "failed";

/** 字数口径：默认含标点，可在设置里切纯汉字（PRD R4） */
export type WordCountMode = "withPunctuation" | "hanOnly";

/** 序号数字样式：阿拉伯数字（第1章）/ 中文数字（第一章） */
export type LabelNumberStyle = "arabic" | "chinese";

/** 作品 */
export interface NovelWork {
  id: string;
  name: string;
  createdAt: number;
}

/** 分卷（PRD R9） */
export interface NovelVolume {
  id: string;
  workId: string;
  name: string;
  sort: number;
}

/** 章节 */
export interface NovelChapter {
  id: string;
  workId: string;
  volumeId: string;
  title: string;
  content: string;
  wordCount: number;
  status: ChapterStatus;
  sort: number;
  updatedAt: number;
}

/** 章节快照：每章环形保留 20 版（PRD R3） */
export interface NovelSnapshot {
  id: string;
  chapterId: string;
  content: string;
  /** 相对上一版的增量字数，用于「+512 字」展示 */
  deltaWords: number;
  createdAt: number;
}

/** 灵感速记（PRD R7） */
export interface NovelNote {
  id: string;
  workId: string;
  content: string;
  createdAt: number;
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

/** 等级项，rank 即顺序（PRD R25） */
export interface LevelRung {
  id: string;
  name: string;
  rank: number;
  note?: string;
}

/** 等级体系 */
export interface LevelSystem {
  id: string;
  workId: string;
  name: string;
  rungs: LevelRung[];
}

/** 关联要素的展示视图（由 NovelLink + 要素表派生） */
export interface EntityRelationView {
  id: string;
  /** out = 我指向谁；in = 谁指向我 */
  direction: "out" | "in";
  targetId: string;
  targetName: string;
  targetType: EntityType;
  relation: string;
  note?: string;
}

/** 标注层词条：一个要素可能贡献多个词条（名称 + 别名） */
export interface EntityTerm {
  term: string;
  entityId: string;
  type: EntityType;
}

/** 资料卡出场章节引用：可点击跳转，label 为派生序号标签（第3章 / 第三章…） */
export interface EntityAppearance {
  chapterId: string;
  title: string;
  label: string;
}

/** 标注层命中片段 */
export interface TermMatch {
  from: number;
  to: number;
  term: string;
  entityId: string;
  type: EntityType;
}

/** 大纲节点：卷 → 章 → 伏笔，三级 */
export interface OutlineNode {
  id: string;
  kind: "volume" | "chapter" | "foreshadow";
  title: string;
  /** 一句话梗概 / 伏笔说明 */
  note?: string;
  /** 伏笔标签 */
  tag?: string;
  children?: OutlineNode[];
}

/** 全书检索命中（PRD R10） */
export interface SearchHit {
  id: string;
  chapterId: string;
  chapterTitle: string;
  count: number;
  snippet: string;
}

/** 带高亮切片的文本片段，供检索结果渲染 */
export interface TextSegment {
  text: string;
  hit: boolean;
}

/** 编辑器排版与写作设置（PRD R5 / R4） */
export interface EditorSettings {
  fontSize: number;
  lineHeight: number;
  /** 段间距，单位 em */
  paragraphSpacing: number;
  /** 首行缩进两格 */
  indent: boolean;
  dailyGoal: number;
  wordCountMode: WordCountMode;
  /** 参与正文高亮的要素类型；空数组 = 关闭标注层 */
  annotationTypes: EntityType[];
  /** 序号数字样式（阿拉伯 / 中文），与后缀解耦可自由组合 */
  numberStyle: LabelNumberStyle;
  /** 章节后缀（章 / 张 / 回 / 节…），支持自定义，标签形如「第{n}后缀」 */
  chapterSuffix: string;
  /** 卷后缀（卷 / 部 / 篇 / 集…），支持自定义 */
  volumeSuffix: string;
  /** 防误触排序：拖拽后先弹确认框展示序号变更，确认才应用（默认开启） */
  confirmReorder: boolean;
}

/** 底部状态条所需的统计（PRD R4） */
export interface WritingStats {
  chapterWords: number;
  todayAdded: number;
  speed: number;
  todayTotal: number;
  dailyGoal: number;
}
