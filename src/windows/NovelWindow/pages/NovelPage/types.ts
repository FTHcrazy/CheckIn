/**
 * 小说编辑器领域模型
 *
 * 字段口径全部对齐 PRD v0.4 §7「工程落点」的数据层定义：
 * 要素统一叫 entity（容纳角色 / 地点 / 势力 / 物品 / 等级体系 / 自定义类型），
 * 要素之间用多态关联 novel_links 表达，fields 以 JSON 键值承载自定义字段。
 *
 * 这一层只放类型，不放实现；渲染层与 hooks 通过它解耦。
 */

// 要素 / 关联的类型定义已上提到 `@/shared/novel/entity-model`（R27 起关系图
// 独立窗口也要读同一份模型，窗口之间禁止互相导入）。此处 re-export 保住既有
// `../types` 导入路径不变。
import type {
  EntityType,
  NovelEntity,
  NovelLink,
} from "@/shared/novel/entity-model";

export type {
  BuiltinEntityType,
  CustomEntityTypeDef,
  EntityFields,
  EntityType,
  NovelEntity,
  NovelLink,
} from "@/shared/novel/entity-model";

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
  /** 小说设定：境界体系是 kind='realm' 的那一个分类，其余为自定义分类 */
  settings: SettingCategory[];
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
export type NotePatch = Partial<
  Pick<NovelNote, "content" | "pinned" | "foreshadowId">
>;

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

/** 伏笔可编辑字段（增删由专用动作承载，不放这里）；chapterId 空串 = 退回卷级 */
export type ForeshadowPatch = Partial<
  Pick<OutlineEntry, "title" | "note" | "chapterId">
>;

/** 新建伏笔时由调用方补齐 id 与时间戳的草稿 */
export type OutlineEntryDraft = Omit<OutlineEntry, "id" | "createdAt">;

// 要素 / 关联本体（EntityFields / NovelEntity / NovelLink）已在文件头从
// `@/shared/novel/entity-model` re-export，这里不再重复声明。

// ── 设定类型（1.4x：迁至 shared/novel 供两个设定窗口共用） ──
// 定义集中在 `@/shared/novel/setting-types`（跨窗口共享位，不含 React）；
// 此处 import + re-export，便于 service / hooks 沿用 `../types` 统一导入路径。
import type {
  CarryDirection,
  SettingCategory,
  SettingCategoryKind,
  SettingLevel,
} from "@/shared/novel/setting-types";

export type {
  CarryDirection,
  SettingCategory,
  SettingCategoryKind,
  SettingLevel,
};

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
      /**
       * 埋在本章的伏笔总数（含已回收），0 = 章节行不出标识。
       * 由 buildOutlineTree 派生 —— 组件不自己去翻伏笔列表。
       */
      foreshadows: number;
      /** 其中待回收条数：> 0 时章节行的标识转警示色 */
      openForeshadows: number;
    }
  | {
      kind: "foreshadow";
      id: string;
      /** 伏笔条目 id：编辑 / 删除 / 回收状态切换用 */
      entryId: string;
      /** 归属卷 id：编辑表单的埋设章节下拉按卷取选项 */
      volumeId: string;
      /** 绑定的章节 id，空串 = 卷级伏笔（编辑表单回填下拉用） */
      chapterId: string;
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
  /** 护眼纸质感：开启后正文叠低对比微颗粒（暗色主题无颗粒、只降文字对比） */
  paperTexture: boolean;
  /** 正文字体 family（空串 = 跟随系统默认）；字体下载后 @font-face 挂载生效 */
  paperFont: string;
  /**
   * 阅读模式：只读正文（禁编辑）+ 隐藏光标，滚动到章节首/尾时自动加载
   * 上一章 / 下一章（连续阅读，不打断）。默认关闭（写作态）。
   */
  readMode: boolean;
}

/**
 * 底部状态条所需的统计（PRD R4）
 *
 * `todayTotal` 是**今日累计净增**，与书架「今日新增」同源（UI-08）；
 * 不要再往这里加「会话内新增」之类的同义字段 —— 同一个「今日」两个数
 * 正是 UI-08 修掉的那个缺陷。
 */
export interface WritingStats {
  chapterWords: number;
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

// ── 敏感词检测（工具箱 → 敏感词检测）───────────────────────────────────
// 类型定义集中在 sensitive/types.ts（同「页面私有模块」原则），此处仅 re-export，
// 便于 service / hooks / 面板沿用 ../types 的统一导入路径。
export type {
  SensitiveConfig,
  SensitiveHit,
  SensitiveScanMode,
  SensitiveScanResult,
  SensitiveWord,
  SensitiveWordOrigin,
} from "./sensitive/types";
