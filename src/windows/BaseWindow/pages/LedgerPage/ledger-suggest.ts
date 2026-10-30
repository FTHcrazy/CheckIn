/**
 * 记账分类建议（R-AI-16a，纯本地规则版）
 *
 * 解决的是「记账时懒得选分类 → 全归『其他』→ 分类统计失去意义」。
 * R-AI-16 原本被写成 AI 功能，架构复核把它拆出 16a：分类建议**不需要推理**，
 * 记账备注高度重复（「地铁」「楼下星巴克」），关键词 + 历史共现就能做到七八成，
 * 且零 token、零授权、lite 版同样可用（不碰 ai.db 的 edition 门控）。
 *
 * 两条证据来源：
 * 1. **历史**（强）：同一备注以前记过什么；或备注有 ≥50% 的二字片段重合
 *    （bigram —— 中文没有分词器时这是零依赖的标准做法，与一致性校对同思路）。
 *    证据条数越多分越高。
 * 2. **关键词**（兜底）：首次记账 / 历史样本少时按内置词表猜（地铁 → 交通）。
 *
 * 边界：本文件不含 React、不读 IPC、不写库，全是纯函数。**建议只是建议**：
 * 采纳与否由用户点，绝不自动改用户已经选好的分类，也绝不自动写库。
 */

/** 建议的证据来源 */
export type SuggestReason = "history" | "keyword";

/** 参与建议的分类（只取需要的字段，便于单测直接构造） */
export interface SuggestCategory {
  id: string;
  name: string;
  type: "expense" | "income" | "both";
  archived?: boolean;
}

/** 一条历史流水（只取需要的字段） */
export interface SuggestHistoryItem {
  note: string;
  categoryId: string | null;
  type: "expense" | "income" | "transfer";
}

/** 归一化后的历史索引项（预建 bigram，避免每次按键重算整本流水） */
export interface SuggestHistoryEntry {
  categoryId: string;
  type: "expense" | "income" | "transfer";
  /** 去掉标点与空白后的备注 */
  note: string;
  /** 备注的二字片段集合 */
  grams: Set<string>;
}

/** 一条建议 */
export interface CategorySuggestion {
  categoryId: string;
  /** 0–1，越大越可信 */
  score: number;
  reason: SuggestReason;
  /** `keyword` 时是命中的词；`history` 时为空（UI 用 count 出文案） */
  word: string;
  /** `history` 时的证据条数 */
  count: number;
}

/** 低于这个分数不出建议（宁可不说，也不要给一条错的） */
const MIN_SCORE = 0.4;

/** 备注重合到什么程度才算「像同一件事」 */
const OVERLAP_RATIO = 0.5;

/** 最多给几条（多了就等于把分类表又摆一遍） */
const DEFAULT_LIMIT = 3;

/** 关键词命中的分数：按词长加权，越长越特异（0.66 ~ 0.9） */
function keywordScore(word: string): number {
  return Math.min(0.9, 0.5 + 0.08 * word.length);
}

/** 历史命中的分数：精确命中满分，部分重合按证据条数递增（0.55 ~ 0.85） */
function historyScore(exact: boolean, count: number): number {
  if (exact) return 1;
  return Math.min(0.85, 0.45 + 0.1 * count);
}

/**
 * 归一化备注：只留汉字 / 字母 / 数字，转小写。
 *
 * 标点与空白在记账备注里纯属噪声（「地铁 2 号线」与「地铁2号线」是同一条），
 * 归一后 bigram 才能对上。
 */
export function normalizeNote(note: string): string {
  return note.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, "");
}

/** 二字片段（长度 ≤2 时整串作为一个片段） */
function bigrams(text: string): string[] {
  if (text.length <= 2) return text ? [text] : [];
  const list: string[] = [];
  for (let i = 0; i + 2 <= text.length; i += 1) list.push(text.slice(i, i + 2));
  return list;
}

/**
 * 预建历史索引。
 *
 * 由调用方 `useMemo` 一次建好（依赖历史流水本身），按键时只算待建议备注的
 * bigram —— 否则每敲一个字都要对整本流水重新归一化 + 建集合。
 */
export function buildSuggestHistory(
  history: readonly SuggestHistoryItem[],
): SuggestHistoryEntry[] {
  const entries: SuggestHistoryEntry[] = [];
  for (const item of history) {
    if (!item.categoryId) continue;
    const note = normalizeNote(item.note);
    // 一字备注（「饭」「水」）对任何输入都能重合，是噪声源
    if (note.length < 2) continue;
    entries.push({
      categoryId: item.categoryId,
      type: item.type,
      note,
      grams: new Set(bigrams(note)),
    });
  }
  return entries;
}

/** 内置词表的一条规则 */
interface KeywordRule {
  /** 预设分类 id（`ledger.ts` 的 LEDGER_PRESET_CATEGORIES，改名字不影响） */
  ids: string[];
  /** 自定义分类的兜底：分类名包含这些词也算命中 */
  names: string[];
  keywords: string[];
}

/**
 * 内置于此的关键词表。
 *
 * 只收 **≥2 字**的词：单字（饭 / 水 / 药 / 书）在任何备注里都能撞上，
 * 与其猜错不如不猜。
 */
const KEYWORD_RULES: readonly KeywordRule[] = [
  {
    ids: ["food"],
    names: ["餐饮", "吃饭", "食品"],
    keywords: [
      "早餐", "早饭", "午餐", "午饭", "晚餐", "晚饭", "夜宵", "加餐",
      "外卖", "食堂", "餐厅", "饭店", "面馆", "火锅", "烧烤", "快餐",
      "奶茶", "咖啡", "星巴克", "瑞幸", "麦当劳", "肯德基", "零食", "水果",
      "买菜", "聚餐", "美团", "饿了么",
    ],
  },
  {
    ids: ["transport"],
    names: ["交通", "出行"],
    keywords: [
      "地铁", "公交", "巴士", "打车", "滴滴", "出租", "网约车", "高铁",
      "动车", "火车", "机票", "机场", "加油", "油费", "停车", "过路费",
      "高速", "单车", "充电桩", "船票",
    ],
  },
  {
    ids: ["shopping"],
    names: ["购物", "日用"],
    keywords: [
      "淘宝", "天猫", "京东", "拼多多", "网购", "衣服", "裤子", "外套",
      "鞋子", "包包", "化妆品", "护肤品", "日用品", "超市", "便利店",
      "家电", "数码", "手机", "耳机", "电脑", "快递",
    ],
  },
  {
    ids: ["housing"],
    names: ["居住", "住房", "房租"],
    keywords: [
      "房租", "租金", "水费", "电费", "燃气", "物业", "宽带", "话费",
      "流量", "家政", "维修", "押金",
    ],
  },
  {
    ids: ["fun"],
    names: ["娱乐", "休闲"],
    keywords: [
      "电影", "游戏", "充值", "会员", "视频", "音乐", "演唱会", "门票",
      "旅游", "酒店", "民宿", "健身", "桌游", "剧本杀", "密室", "网吧",
    ],
  },
  {
    ids: ["medical"],
    names: ["医疗", "看病"],
    keywords: [
      "医院", "看病", "挂号", "体检", "药店", "买药", "药费", "门诊",
      "牙科", "疫苗", "住院",
    ],
  },
  {
    ids: ["education"],
    names: ["教育", "学习"],
    keywords: [
      "学费", "课程", "网课", "培训", "考试", "报名", "教材", "文具",
      "书店", "买书", "教材费", "kindle",
    ],
  },
  {
    ids: ["salary"],
    names: ["工资", "收入", "薪水"],
    keywords: ["工资", "薪水", "薪资", "奖金", "绩效", "补贴", "报销", "兼职", "劳务"],
  },
  {
    ids: ["invest"],
    names: ["理财", "投资"],
    keywords: ["利息", "分红", "基金", "股票", "理财", "收益", "退税", "返现"],
  },
];

/**
 * 命中哪条规则：取**最长**的命中词。
 *
 * 「打车去机场」同时命中「打车」，取更长的那个更特异；同一备注里不会出现
 * 两条规则的词长完全相同的情况（词表本身按语义分组，冲突由长度决定）。
 */
function matchKeyword(text: string): { rule: KeywordRule; word: string } | null {
  let best: { rule: KeywordRule; word: string } | null = null;
  for (const rule of KEYWORD_RULES) {
    for (const word of rule.keywords) {
      if (!text.includes(word)) continue;
      if (!best || word.length > best.word.length) best = { rule, word };
    }
  }
  return best;
}

/** 规则命中的分类：优先预设 id，其次自定义分类名 */
function targetsOf(rule: KeywordRule, usable: Map<string, SuggestCategory>): string[] {
  const hits: string[] = [];
  for (const id of rule.ids) if (usable.has(id)) hits.push(id);
  if (hits.length > 0) return hits;
  for (const category of usable.values()) {
    if (rule.names.some((name) => category.name.includes(name))) hits.push(category.id);
  }
  return hits;
}

/**
 * 出建议。
 *
 * `index` 由 `buildSuggestHistory` 预建；空数组即「没有历史可参考」，
 * 此时只靠关键词表。
 */
export function suggestCategories(params: {
  note: string;
  type: "expense" | "income";
  categories: readonly SuggestCategory[];
  index: readonly SuggestHistoryEntry[];
  limit?: number;
}): CategorySuggestion[] {
  const text = normalizeNote(params.note);
  // 一进入输入框就弹建议是骚扰：至少要有两个字才看得出在记什么
  if (text.length < 2) return [];

  const usable = new Map<string, SuggestCategory>();
  for (const category of params.categories) {
    if (category.archived) continue;
    if (category.type !== params.type && category.type !== "both") continue;
    usable.set(category.id, category);
  }
  if (usable.size === 0) return [];

  const grams = bigrams(text);
  const gramSet = new Set(grams);
  const hits = new Map<string, { exact: boolean; count: number }>();

  for (const entry of params.index) {
    if (entry.type !== params.type) continue;
    if (!usable.has(entry.categoryId)) continue;

    const exact = entry.note === text;
    if (!exact) {
      let shared = 0;
      for (const gram of gramSet) if (entry.grams.has(gram)) shared += 1;
      const ratio = grams.length === 0 ? 0 : shared / grams.length;
      if (ratio < OVERLAP_RATIO) continue;
    }

    const bucket = hits.get(entry.categoryId) ?? { exact: false, count: 0 };
    bucket.exact = bucket.exact || exact;
    bucket.count += 1;
    hits.set(entry.categoryId, bucket);
  }

  const results: CategorySuggestion[] = [];
  const positions = new Map<string, number>();
  params.categories.forEach((category, at) => positions.set(category.id, at));

  for (const [categoryId, bucket] of hits) {
    results.push({
      categoryId,
      score: historyScore(bucket.exact, bucket.count),
      reason: "history",
      word: "",
      count: bucket.count,
    });
  }

  const matched = matchKeyword(text);
  if (matched) {
    const score = keywordScore(matched.word);
    for (const categoryId of targetsOf(matched.rule, usable)) {
      const existing = results.find((item) => item.categoryId === categoryId);
      // 同一个分类被两条证据同时指向时，取更高的分与更强的来源
      if (existing) {
        if (score > existing.score) {
          existing.score = score;
          existing.reason = "keyword";
          existing.word = matched.word;
        }
        continue;
      }
      results.push({ categoryId, score, reason: "keyword", word: matched.word, count: 0 });
    }
  }

  const limit = params.limit ?? DEFAULT_LIMIT;
  return results
    .filter((item) => item.score >= MIN_SCORE)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (positions.get(a.categoryId) ?? 0) - (positions.get(b.categoryId) ?? 0),
    )
    .slice(0, limit);
}

/** 便捷入口：没有预建索引时一步到位（单测与低样本场景用） */
export function suggestCategoriesFromHistory(params: {
  note: string;
  type: "expense" | "income";
  categories: readonly SuggestCategory[];
  history: readonly SuggestHistoryItem[];
  limit?: number;
}): CategorySuggestion[] {
  return suggestCategories({
    note: params.note,
    type: params.type,
    categories: params.categories,
    index: buildSuggestHistory(params.history),
    limit: params.limit,
  });
}
