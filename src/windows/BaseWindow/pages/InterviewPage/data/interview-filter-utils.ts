/**
 * 题库筛选 / 排序 / 分页 / 高亮的纯函数集合。
 *
 * 页面里没有任何一段筛选逻辑写在组件中：组件只把动作交给 reducer，
 * 派生数据全部由这里的函数算出，因此这些行为可以脱离 React 直接单测。
 */
import { CATEGORIES, CATEGORY_BY_ID, TRACK_LABEL } from "./interview-taxonomy";
import type {
  CategoryId,
  CategoryKey,
  Difficulty,
  DifficultyKey,
  HighlightSegment,
  InterviewFilterState,
  InterviewQuestion,
  QuestionTrack,
  SortBy,
} from "./interview-types";

/** 每页条数：12 条既能铺满两行三列，又不会让首屏渲染过重 */
export const PAGE_SIZE = 12;

/** 难度权重，用于「按难度排序」与卡片角标配色 */
export const DIFFICULTY_WEIGHT: Record<Difficulty, number> = {
  basic: 1,
  medium: 2,
  hard: 3,
};

/** 初始筛选状态：默认落在基础知识库的「全部」，因为那是题量主体 */
export function createInitialFilterState(): InterviewFilterState {
  return {
    track: "foundation",
    categoryId: "all",
    keyword: "",
    difficulty: "all",
    tags: [],
    favoritesOnly: false,
    sortBy: "updated",
    page: 1,
  };
}

export type InterviewFilterAction =
  | { type: "setTrack"; track: QuestionTrack }
  | { type: "setCategory"; categoryId: CategoryKey }
  | { type: "setKeyword"; keyword: string }
  | { type: "setDifficulty"; difficulty: DifficultyKey }
  | { type: "toggleTag"; tag: string }
  | { type: "setTags"; tags: string[] }
  | { type: "clearTags" }
  | { type: "setFavoritesOnly"; favoritesOnly: boolean }
  | { type: "setSortBy"; sortBy: SortBy }
  | { type: "setPage"; page: number }
  | { type: "reset" };

/**
 * 筛选状态 reducer。
 *
 * 两条硬规则：**任一筛选变更都要把页码拉回第 1 页**（否则会停在一个空页），
 * 以及**切轨道时分类归零**（另一轨道的分类 id 在新轨道里必然无结果）。
 */
export function interviewFilterReducer(
  state: InterviewFilterState,
  action: InterviewFilterAction,
): InterviewFilterState {
  switch (action.type) {
    case "setTrack":
      if (state.track === action.track) return state;
      return { ...state, track: action.track, categoryId: "all", page: 1 };
    case "setCategory":
      if (state.categoryId === action.categoryId) return state;
      return { ...state, categoryId: action.categoryId, page: 1 };
    case "setKeyword": {
      const keyword = action.keyword.trim();
      if (state.keyword === keyword) return state;
      return { ...state, keyword, page: 1 };
    }
    case "setDifficulty":
      if (state.difficulty === action.difficulty) return state;
      return { ...state, difficulty: action.difficulty, page: 1 };
    case "toggleTag": {
      const tags = state.tags.includes(action.tag)
        ? state.tags.filter((tag) => tag !== action.tag)
        : [...state.tags, action.tag];
      return { ...state, tags, page: 1 };
    }
    case "setTags": {
      // 去重并保持选择顺序，便于 UI 稳定显示已选标签
      const tags = [...new Set(action.tags)];
      const unchanged =
        tags.length === state.tags.length &&
        tags.every((tag) => state.tags.includes(tag));
      if (unchanged) return state;
      return { ...state, tags, page: 1 };
    }
    case "clearTags":
      if (state.tags.length === 0) return state;
      return { ...state, tags: [], page: 1 };
    case "setFavoritesOnly":
      if (state.favoritesOnly === action.favoritesOnly) return state;
      return { ...state, favoritesOnly: action.favoritesOnly, page: 1 };
    case "setSortBy":
      if (state.sortBy === action.sortBy) return state;
      return { ...state, sortBy: action.sortBy, page: 1 };
    case "setPage": {
      const page = Math.max(1, Math.floor(action.page));
      if (state.page === page) return state;
      return { ...state, page };
    }
    case "reset":
      return createInitialFilterState();
    default:
      return state;
  }
}

/** 关键词是否命中：标题 / 题干 / 标签，忽略大小写；空关键词恒命中 */
export function matchesKeyword(
  question: InterviewQuestion,
  keyword: string,
): boolean {
  const needle = keyword.trim().toLowerCase();
  if (needle.length === 0) return true;
  return (
    question.title.toLowerCase().includes(needle) ||
    question.stem.toLowerCase().includes(needle) ||
    question.tags.some((tag) => tag.toLowerCase().includes(needle))
  );
}

/**
 * 按筛选状态过滤题库（不含排序与分页）。
 *
 * `favorites` 单独传入而不是塞进 state：收藏集合是可变的派生数据，
 * 放进 state 会让 reducer 每次收藏都重建整个筛选对象。
 */
export function filterQuestions(
  pool: readonly InterviewQuestion[],
  state: InterviewFilterState,
  favorites: ReadonlySet<string> = new Set<string>(),
): InterviewQuestion[] {
  return pool.filter((question) => {
    if (question.track !== state.track) return false;
    if (state.categoryId !== "all" && question.categoryId !== state.categoryId) {
      return false;
    }
    if (state.difficulty !== "all" && question.difficulty !== state.difficulty) {
      return false;
    }
    if (state.favoritesOnly && !favorites.has(question.id)) return false;
    // 多选标签取交集：勾两个标签表示「同时具备」，与主流题库的语义一致
    if (
      state.tags.length > 0 &&
      !state.tags.every((tag) => question.tags.includes(tag))
    ) {
      return false;
    }
    return matchesKeyword(question, state.keyword);
  });
}

export type CategoryCounts = Readonly<Partial<Record<CategoryKey, number>>>;

/**
 * 各分类的角标数。
 *
 * **计算时把分类维度本身排除**（其余筛选条件保留），这样角标数恒等于
 * 「点进去之后列表的条数」；否则会在已选中某分类时把其它分类全算成 0。
 */
export function countByCategory(
  pool: readonly InterviewQuestion[],
  state: InterviewFilterState,
  favorites: ReadonlySet<string> = new Set<string>(),
): CategoryCounts {
  const scoped = filterQuestions(pool, { ...state, categoryId: "all" }, favorites);
  const counts: Partial<Record<CategoryKey, number>> = { all: scoped.length };
  for (const question of scoped) {
    counts[question.categoryId] = (counts[question.categoryId] ?? 0) + 1;
  }
  return counts;
}

/** 排序：不修改入参，恒返回新数组 */
export function sortQuestions(
  items: readonly InterviewQuestion[],
  sortBy: SortBy,
): InterviewQuestion[] {
  const list = [...items];
  switch (sortBy) {
    case "hot":
      list.sort((left, right) => right.heat - left.heat);
      return list;
    case "difficulty":
      list.sort(
        (left, right) =>
          DIFFICULTY_WEIGHT[right.difficulty] -
            DIFFICULTY_WEIGHT[left.difficulty] || right.heat - left.heat,
      );
      return list;
    case "updated":
    default:
      // `YYYY-MM-DD` 定长字符串，按字典序倒排等价于按日期倒排
      list.sort((left, right) => {
        if (left.updatedAt === right.updatedAt) {
          return right.heat - left.heat;
        }
        return left.updatedAt < right.updatedAt ? 1 : -1;
      });
      return list;
  }
}

export interface PaginationResult<T> {
  items: T[];
  total: number;
  /** 夹紧后的页码（越界时回落到合法区间） */
  page: number;
  pageCount: number;
}

/**
 * 分页。
 *
 * 页码会被夹到 `[1, pageCount]`：筛选后总页数变少时，列表不会因为
 * 「停在旧页码」而空白 —— 这是列表页最常见的假空态来源。
 */
export function paginate<T>(
  items: readonly T[],
  page: number,
  pageSize: number = PAGE_SIZE,
): PaginationResult<T> {
  const size = pageSize > 0 ? Math.floor(pageSize) : PAGE_SIZE;
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const requested = Number.isFinite(page) ? Math.floor(page) : 1;
  const current = Math.min(Math.max(1, requested), pageCount);
  const start = (current - 1) * size;
  return {
    items: items.slice(start, start + size),
    total,
    page: current,
    pageCount,
  };
}

/**
 * 关键词切段，供 `<mark>` 高亮。
 *
 * 返回片段而非 HTML 字符串：渲染层只用 React 元素拼装，
 * 全程不碰 `dangerouslySetInnerHTML`，用户输入不可能变成标签。
 */
export function highlightSegments(
  text: string,
  keyword: string,
): HighlightSegment[] {
  if (text.length === 0) return [];
  const needle = keyword.trim();
  if (needle.length === 0) return [{ text, hit: false }];

  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  let index = lowerText.indexOf(lowerNeedle, cursor);

  while (index !== -1) {
    if (index > cursor) {
      segments.push({ text: text.slice(cursor, index), hit: false });
    }
    segments.push({ text: text.slice(index, index + needle.length), hit: true });
    cursor = index + needle.length;
    index = lowerText.indexOf(lowerNeedle, cursor);
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), hit: false });
  }
  return segments;
}

/** 分类 → 面包屑路径（轨道 / 分类），卡片与侧栏共用 */
export function categoryPath(categoryId: CategoryId): string[] {
  const node = CATEGORY_BY_ID[categoryId];
  return [TRACK_LABEL[node.track], node.label];
}

/**
 * 收集某一轨道下出现过的标签，按出现次数倒序取前 N 个。
 * 由题库现算而不是写死常量 —— 新增题目时筛选项自动跟着长出来。
 */
export function collectTags(
  pool: readonly InterviewQuestion[],
  track: QuestionTrack,
  limit = 10,
): string[] {
  const counter = new Map<string, number>();
  for (const question of pool) {
    if (question.track !== track) continue;
    for (const tag of question.tags) {
      counter.set(tag, (counter.get(tag) ?? 0) + 1);
    }
  }
  return [...counter.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([tag]) => tag);
}

/** 题库自检用：某轨道下各分类的题量分布（测试与维护时统计） */
export function countByCategoryId(
  pool: readonly InterviewQuestion[],
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const question of pool) {
    counts[question.categoryId] = (counts[question.categoryId] ?? 0) + 1;
  }
  return counts;
}

/** 分类节点的展示名（id 缺失时回落到 id 本身，避免渲染出 undefined） */
export function categoryLabel(categoryId: CategoryId): string {
  return CATEGORY_BY_ID[categoryId]?.label ?? categoryId;
}

/** 当前轨道下的全部分类（侧栏直接消费） */
export function categoriesOfTrack(
  track: QuestionTrack,
): readonly { id: CategoryId; label: string }[] {
  return CATEGORIES.filter((node) => node.track === track);
}
