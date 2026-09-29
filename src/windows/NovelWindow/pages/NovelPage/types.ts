/**
 * 小说编辑器领域模型
 *
 * 字段口径全部对齐 PRD v0.4 §7「工程落点」的数据层定义：
 * 要素统一叫 entity（容纳角色 / 地点 / 势力 / 物品 / 等级体系 / 自定义类型），
 * 要素之间用多态关联 novel_links 表达，fields 以 JSON 键值承载自定义字段。
 *
 * 这一层只放类型，不放实现；渲染层与 hooks 通过它解耦。
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

/** 章节状态：草稿 / 完稿（PRD R1） */
export type ChapterStatus = "draft" | "done";

/** 保存状态机（设计方案 §06：idle → pending → saving → saved / failed） */
export type SaveState = "idle" | "pending" | "saving" | "saved" | "failed";

/** 字数口径：默认含标点，可在设置里切纯汉字（PRD R4） */
export type WordCountMode = "withPunctuation" | "hanOnly";

/** 序号数字样式：阿拉伯数字（第1章）/ 中文数字（第一章） */
export type LabelNumberStyle = "arabic" | "chinese";

/** 崩溃恢复信息（PRD R3 ③：主进程会话标记 + 最近快照派生） */
export interface NovelRecovery {
  snapshotTime: number;
  deltaWords: number;
}

/** 编辑器全量数据包（novel-editor-load 的返回形态） */
export interface NovelBundle {
  works: NovelWork[];
  volumes: NovelVolume[];
  chapters: NovelChapter[];
  entities: NovelEntity[];
  links: NovelLink[];
  levelSystems: LevelSystem[];
  notes: NovelNote[];
  outlineEntries: OutlineEntry[];
  recovery: NovelRecovery | null;
}

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
  /**
   * 大纲梗概：一句话剧情（R7 大纲板行内编辑）。
   * 增量迁移列，历史数据缺失时按空串处理；空串表示尚未填写。
   */
  outlineNote?: string;
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
  /** 置顶：重要的灵感恒定排在列表最前（排序见 sortNotes） */
  pinned: boolean;
  /** 由该灵感一键转出的伏笔条目 id；转出后卡片展示「已转为伏笔」 */
  foreshadowId?: string;
}

/** 灵感可编辑字段（内容 / 置顶 / 已转伏笔标记） */
export type NotePatch = Partial<Pick<NovelNote, "content" | "pinned" | "foreshadowId">>;

/**
 * 大纲条目（PRD R7 大纲板）
 *
 * 大纲骨架（卷 / 章）永远由真实卷章派生，不落库；只有用户手写的伏笔
 * 需要独立存储，即本类型。kind 预留多态（后续「支线 / 时间线」同表扩展）。
 */
export interface OutlineEntry {
  id: string;
  workId: string;
  kind: "foreshadow";
  /** 归属卷：决定在大纲板哪一段下展示 */
  volumeId: string;
  /** 埋设章节（缺省 = 卷级伏笔，不绑定具体章） */
  chapterId?: string;
  title: string;
  note: string;
  /** 待回收 / 已回收 */
  status: "open" | "resolved";
  createdAt: number;
}

/** 伏笔可编辑字段（增删由专用动作承载，不放这里） */
export type ForeshadowPatch = Partial<Pick<OutlineEntry, "title" | "note">>;

/** 新建伏笔时由调用方补齐 id 与时间戳的草稿 */
export type OutlineEntryDraft = Omit<OutlineEntry, "id" | "createdAt">;

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
  /**
   * 自定义类型（ct-*）的注入主色：decoration 以 inline style 写
   * --nv-mark-color（CSS 内置六类选择器不覆盖 ct-*，见 EditorPane/index.scss）
   */
  color?: string;
}

/** 资料卡出场章节引用：可点击跳转，label 为派生序号标签（第3章 / 第三章…） */
export interface EntityAppearance {
  chapterId: string;
  title: string;
  label: string;
}

/** 资料卡详情页编辑保存的开放字段（R23） */
export type EntitySavePatch = Partial<
  Pick<NovelEntity, "name" | "type" | "aliases" | "summary" | "fields">
>;

/** 标注层命中片段 */
export interface TermMatch {
  from: number;
  to: number;
  term: string;
  entityId: string;
  type: EntityType;
}

/**
 * 大纲节点（展示模型，判别联合）
 *
 * 由真实卷 / 章 + 用户手写的伏笔条目派生（见 buildOutlineTree），本身就是
 * 骨架：卷章永远与左栏章节树一致（点章节即真跳转），伏笔来自 OutlineEntry。
 * 判别联合而非「一堆可选字段」，保证卷才有 children、章节才有 chapterId。
 */
export type OutlineNode =
  | {
      kind: "volume";
      id: string;
      /** 序号标签（第一卷 / 第2部…），随序号配置派生 */
      title: string;
      /** 自定义卷名，未命名时为空串 */
      note: string;
      /** 未回收伏笔数，卷头计数点 */
      openForeshadows: number;
      children: OutlineNode[];
    }
  | {
      kind: "chapter";
      id: string;
      /** 真实章节 id：点击即跳转该章 */
      chapterId: string;
      title: string;
      /** 序号标签（第3章 / 第三章…） */
      label: string;
      /** 一句话梗概，空串表示未填 */
      note: string;
      wordCount: number;
      status: ChapterStatus;
    }
  | {
      kind: "foreshadow";
      id: string;
      /** 伏笔条目 id：编辑 / 删除 / 回收状态切换用 */
      entryId: string;
      title: string;
      note: string;
      resolved: boolean;
      /**
       * 埋点标签：绑定了具体章时是「第三章 断碑」，卷级伏笔为空串。
       * 由 buildOutlineTree 派生（伏笔视图的来源 chip 要用），组件不自己拼。
       */
      source: string;
    };

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

// ── 起名工具（R18 / 步骤三）──────────────────────────────────────────────
// 类型定义集中在 naming/types.ts（按 AGENTS「页面私有模块」原则留在子目录），
// 此处仅做 re-export，便于 service / hooks 沿用 ../types 统一导入路径。
export type {
  NameFavorite,
  NamingCustomPool,
  NamingKind,
  NameStyle,
  NameStyleFamily,
  NameGender,
  NamingOptions,
  NamingResult,
  NamingPool,
  NamingDictionary,
  NameStyleMeta,
  NamingKindMeta,
} from "./naming/types";
