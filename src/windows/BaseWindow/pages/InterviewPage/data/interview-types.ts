/**
 * 前端面试题页面的公共类型。
 *
 * 题库是「静态数据 + 纯函数筛选」的形态：组件只负责渲染，
 * 所有筛选 / 排序 / 分页 / 高亮逻辑都落在 `interview-filter-utils.ts`，
 * 这样行为可以脱离 React 单测（见同目录 `*.test.ts`）。
 */

/** 题库轨道：笔试题（按题型分）与基础知识库（按知识域分） */
export type QuestionTrack = "written" | "foundation";

/** 难度：初级 / 中级 / 高级 */
export type Difficulty = "basic" | "medium" | "hard";

/** 排序维度：最近校对 / 热度 / 难度从高到低 */
export type SortBy = "updated" | "hot" | "difficulty";

/**
 * 分类 id。
 *
 * 笔试题按「题型」切，基础知识库按「知识域」切；
 * 两侧 id 前缀不同（`written-` / `foundation-`），避免同一标签页串类。
 */
export type CategoryId =
  // 笔试题（按题型）
  | "written-coding"
  | "written-algorithm"
  | "written-design"
  | "written-open"
  // 基础知识库（按知识域）
  | "foundation-html"
  | "foundation-css"
  | "foundation-js"
  | "foundation-ts"
  | "foundation-react"
  | "foundation-vue"
  | "foundation-electron"
  | "foundation-node"
  | "foundation-mobile"
  | "foundation-miniprogram"
  | "foundation-browser"
  | "foundation-network"
  | "foundation-security"
  | "foundation-perf"
  | "foundation-engineering"
  | "foundation-os"
  | "foundation-database"
  | "foundation-ai";

/**
 * 基线分类 id（22 个，源码常量里的字面量联合）。
 *
 * 静态文件（`interview-taxonomy.ts` / `interview-knowledge.ts` /
 * `MIN_PER_CATEGORY` 这类穷尽性表）**只能**用它：`Record<BaselineCategoryId, …>`
 * 的穷尽性守卫是「新增分类漏了哪一处」的唯一保障，一旦把动态分类混进来就全废。
 */
export type BaselineCategoryId = CategoryId;

/**
 * 用户 / AI 新建的分类 id（只存在于 `interview_taxonomy`）。
 *
 * 前缀 `u-c-` 与 22 个基线字面量不可能重合，所以两种 id 可以安全并存于同一字段。
 */
export type CustomCategoryId = `u-c-${string}`;

/**
 * 合并视图里的分类 id：基线 22 个 ∪ 库里的自定义分类。
 *
 * 只有「合并视图 / 渲染 / 筛选」这条链用它；`CATEGORY_BY_ID[id]` 查不到自定义
 * 分类，必须走 `categoryNodeOf()` / 传入合并后的分类表（见 `categoryPath`）。
 */
export type InterviewCategoryId = BaselineCategoryId | CustomCategoryId;

/** 「不限分类」的哨兵值，与具体分类同放一处便于类型收窄 */
export type CategoryKey = InterviewCategoryId | "all";

/** 「不限难度」的哨兵值 */
export type DifficultyKey = Difficulty | "all";

/** 题目出处：只记能对上的来源，不确定就不写 */
export interface QuestionSource {
  label: string;
  url?: string;
  license?: string;
}

/** 一道面试题。字段一旦发布不再改名，新增只追加可选字段 */
export interface InterviewQuestion {
  /** 稳定唯一 id（如 `js-event-loop`），发布后不改，收藏记录按它落盘 */
  id: string;
  title: string;
  /** 题干 */
  stem: string;
  /**
   * 题干代码。
   *
   * 「读代码说输出」「找错」「这段代码有什么问题」这类题的代码是**题目本身**，
   * 必须和题干一起常显；放进 `answer` 会让人先看到答案再看代码，
   * 思考过程被跳过。要写代码的题（手写 / 算法）不要用这个字段。
   */
  stemCode?: string;
  /** 题干代码的语言标记，仅用于展示提示（如 `js` / `ts` / `vue`） */
  stemCodeLang?: string;
  /** 参考答案：纯文本 + ```lang 代码块，要点式 */
  answer: string;
  /**
   * 关联图解的 id（见 `interview-diagrams.ts`）。
   *
   * 图放在**答案区顶部**而不是题干下面：解题步骤本身就是答案的一部分，
   * 提前摆在题干里等于给提示。没有合适图解的题不要硬塞。
   */
  diagramId?: string;
  track: QuestionTrack;
  /**
   * 所属分类。基线题是 22 个字面量之一；用户 / AI 新增的题可能挂在
   * `u-c-*` 自定义分类下 —— 所以这里是放宽后的 `InterviewCategoryId`，
   * 静态表的穷尽性仍由 `BaselineCategoryId` 守住。
   */
  categoryId: InterviewCategoryId;
  difficulty: Difficulty;
  tags: string[];
  /** 来源主题（如「React 渲染原理」），用于标注与后续维护 */
  topic: string;
  source?: QuestionSource;
  /** 校对时间，`2026-01` 形式 */
  reviewedAt: string;
  /** 热度 0-100，只用于排序，不代表真实访问量 */
  heat: number;
  /** 最近更新日期，`2026-01-15` 形式 */
  updatedAt: string;
}

/** 页面唯一的筛选状态（`useReducer` 持有） */
export interface InterviewFilterState {
  track: QuestionTrack;
  categoryId: CategoryKey;
  keyword: string;
  difficulty: DifficultyKey;
  tags: string[];
  favoritesOnly: boolean;
  sortBy: SortBy;
  page: number;
}

/** 关键词高亮片段：命中段与普通段交替出现 */
export interface HighlightSegment {
  text: string;
  hit: boolean;
}
