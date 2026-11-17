/**
 * 题库分类体系（单一事实源）。
 *
 * 先写出 `CATEGORY_BY_ID`（`Record<CategoryId, CategoryNode>` 字面量，
 * 漏一项或多一项都会被 TypeScript 当场拦下），再由它派生 `CATEGORIES`。
 * 顺序由 `order` 字段**全局唯一**地给出（1-22 连续），不依赖对象键顺序，
 * 也不做任何类型断言 —— 这样侧栏顺序与分类表完全一致。
 */
import type {
  BaselineCategoryId,
  Difficulty,
  InterviewCategoryId,
  QuestionTrack,
} from "./interview-types";

interface TrackNode {
  id: QuestionTrack;
  label: string;
}

/** 一个分类节点 */
export interface CategoryNode {
  /**
   * 基线 22 个是字面量 id；`u-c-*` 来自 `interview_taxonomy`（用户在侧栏
   * 「分类管理」里新增的）。两者共用同一个字段，靠前缀区分。
   */
  id: InterviewCategoryId;
  label: string;
  track: QuestionTrack;
  /** 全局展示顺序：基线 1-22 连续，自定义分类从 100 起续排 */
  order: number;
}

export const TRACK_LABEL: Record<QuestionTrack, string> = {
  written: "笔试题",
  foundation: "基础知识库",
};

export const TRACKS: readonly TrackNode[] = [
  { id: "written", label: TRACK_LABEL.written },
  { id: "foundation", label: TRACK_LABEL.foundation },
];

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  basic: "初级",
  medium: "中级",
  hard: "高级",
};

/** 分类 id → 分类节点。`Record` 字面量保证 22 个分类一个不漏 */
export const CATEGORY_BY_ID: Record<BaselineCategoryId, CategoryNode> = {
  "written-coding": {
    id: "written-coding",
    label: "手写代码题",
    track: "written",
    order: 1,
  },
  "written-algorithm": {
    id: "written-algorithm",
    label: "算法题",
    track: "written",
    order: 2,
  },
  "written-design": {
    id: "written-design",
    label: "场景设计题",
    track: "written",
    order: 3,
  },
  "written-open": {
    id: "written-open",
    label: "逻辑与开放题",
    track: "written",
    order: 4,
  },
  "foundation-html": {
    id: "foundation-html",
    label: "HTML",
    track: "foundation",
    order: 5,
  },
  "foundation-css": {
    id: "foundation-css",
    label: "CSS",
    track: "foundation",
    order: 6,
  },
  "foundation-js": {
    id: "foundation-js",
    label: "JavaScript",
    track: "foundation",
    order: 7,
  },
  "foundation-ts": {
    id: "foundation-ts",
    label: "TypeScript",
    track: "foundation",
    order: 8,
  },
  "foundation-react": {
    id: "foundation-react",
    label: "React",
    track: "foundation",
    order: 9,
  },
  "foundation-vue": {
    id: "foundation-vue",
    label: "Vue",
    track: "foundation",
    order: 10,
  },
  "foundation-electron": {
    id: "foundation-electron",
    label: "Electron",
    track: "foundation",
    order: 11,
  },
  "foundation-node": {
    id: "foundation-node",
    label: "Node.js",
    track: "foundation",
    order: 12,
  },
  "foundation-mobile": {
    id: "foundation-mobile",
    label: "移动端与跨端",
    track: "foundation",
    order: 13,
  },
  "foundation-miniprogram": {
    id: "foundation-miniprogram",
    label: "小程序",
    track: "foundation",
    order: 14,
  },
  "foundation-browser": {
    id: "foundation-browser",
    label: "浏览器原理",
    track: "foundation",
    order: 15,
  },
  "foundation-network": {
    id: "foundation-network",
    label: "计算机网络",
    track: "foundation",
    order: 16,
  },
  "foundation-security": {
    id: "foundation-security",
    label: "HTTP / HTTPS 与安全",
    track: "foundation",
    order: 17,
  },
  "foundation-perf": {
    id: "foundation-perf",
    label: "性能优化",
    track: "foundation",
    order: 18,
  },
  "foundation-engineering": {
    id: "foundation-engineering",
    label: "工程化与构建",
    track: "foundation",
    order: 19,
  },
  "foundation-os": {
    id: "foundation-os",
    label: "操作系统与 Linux",
    track: "foundation",
    order: 20,
  },
  "foundation-database": {
    id: "foundation-database",
    label: "数据库基础",
    track: "foundation",
    order: 21,
  },
  "foundation-ai": {
    id: "foundation-ai",
    label: "AI 辅助开发",
    track: "foundation",
    order: 22,
  },
};

/** 全部分类，按 `order` 升序（侧栏直接消费这个数组） */
export const CATEGORIES: readonly CategoryNode[] = Object.values(
  CATEGORY_BY_ID,
).sort((left, right) => left.order - right.order);

export const CATEGORIES_BY_TRACK: Record<QuestionTrack, readonly CategoryNode[]> =
  {
    written: CATEGORIES.filter((node) => node.track === "written"),
    foundation: CATEGORIES.filter((node) => node.track === "foundation"),
  };

/** 基线分类查表（`id` 来自任意来源时用它，不要直接索引 `CATEGORY_BY_ID`） */
const BASELINE_LOOKUP = CATEGORY_BY_ID as Readonly<Record<string, CategoryNode | undefined>>;

/**
 * 按 id 取分类节点，查不到返回 `undefined`。
 *
 * 存在的理由：合并视图里的 `categoryId` 可能是 `u-c-*`（自定义分类），
 * 直接 `CATEGORY_BY_ID[id]` 会拿到 `undefined` 再读 `.label` 就是运行期崩溃。
 * 自定义分类不在这个函数的知识范围内 —— 调用方要把合并后的分类表一起传进来
 * （见 `categoryPath` / `categoryLabel`）。
 */
export function categoryNodeOf(
  id: string,
  extra?: readonly CategoryNode[],
): CategoryNode | undefined {
  const baseline = BASELINE_LOOKUP[id];
  if (baseline) return baseline;
  return extra?.find((node) => node.id === id);
}
