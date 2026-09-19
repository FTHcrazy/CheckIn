import type {
  EntityTerm,
  EntityType,
  NovelChapter,
  NovelEntity,
  NovelVolume,
  TermMatch,
  TextSegment,
  WordCountMode,
} from "./types";

/**
 * 小说编辑器纯函数工具
 *
 * 全部为「参数进、结果出」的可测函数：字数统计、词库构建、标注层匹配、
 * 模糊检索、片段高亮。IME 与 CodeMirror 交互留在 hooks / 编辑器扩展层。
 */

/** 中日韩统一表意文字 + 扩展 A + 兼容表意文字 */
const HAN_PATTERN = /[㐀-䶿一-鿿豈-﫿]/g;

/** 统计字数。默认口径含标点（与主流平台一致），可切纯汉字 */
export function countWords(text: string, mode: WordCountMode): number {
  if (!text) return 0;
  if (mode === "hanOnly") {
    const matched = text.match(HAN_PATTERN);
    return matched ? matched.length : 0;
  }
  let count = 0;
  for (const ch of text) {
    if (!/\s/.test(ch)) count += 1;
  }
  return count;
}

/** 千分位分隔，用于状态条与章节树右侧字数 */
export function formatThousands(value: number): string {
  return String(Math.max(0, Math.round(value))).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ",",
  );
}

/** 章节序号补零：7 → "07" */
export function padIndex(index: number): string {
  return String(index).padStart(2, "0");
}

/** HH:mm，用于保存时间、快照时间线 */
export function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 相对时间：刚刚 / N 分钟前 / N 小时前 / M月D日 */
export function formatRelativeTime(
  timestamp: number,
  now: number = Date.now(),
): string {
  const diff = now - timestamp;
  if (diff < 0) return "刚刚";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/**
 * 构建标注层词库：要素名称 + 别名，按词长倒序（长词优先，避免「青梧」吃掉「青梧山」）
 */
export function buildEntityTerms(
  entities: NovelEntity[],
  enabledTypes: EntityType[],
): EntityTerm[] {
  const enabled = new Set(enabledTypes);
  const terms: EntityTerm[] = [];
  const seen = new Set<string>();

  for (const entity of entities) {
    if (!enabled.has(entity.type)) continue;
    const candidates = [entity.name, ...entity.aliases];
    for (const term of candidates) {
      const trimmed = term.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      terms.push({ term: trimmed, entityId: entity.id, type: entity.type });
    }
  }

  return terms.sort((a, b) => b.term.length - a.term.length);
}

/**
 * 在给定文本中做白名单匹配，返回互不重叠、（同起点）最长的命中区间。
 * 只扫传入文本，不做全文档扫描——调用方负责切成可视区片段。
 */
export function findTermMatches(
  text: string,
  terms: EntityTerm[],
): TermMatch[] {
  if (!text || terms.length === 0) return [];
  const sorted = [...terms].sort((a, b) => b.term.length - a.term.length);
  const matches: TermMatch[] = [];
  let index = 0;

  while (index < text.length) {
    const hit = sorted.find(
      (item) => item.term.length > 0 && text.startsWith(item.term, index),
    );
    if (hit) {
      matches.push({
        from: index,
        to: index + hit.term.length,
        term: hit.term,
        entityId: hit.entityId,
        type: hit.type,
      });
      index += hit.term.length;
    } else {
      index += 1;
    }
  }

  return matches;
}

/** 今日目标进度百分比，上限 100 */
export function calcGoalProgress(todayTotal: number, goal: number): number {
  if (goal <= 0) return 0;
  return Math.min(100, Math.round((todayTotal / goal) * 100));
}

/** 码字速度（字 / 分钟） */
export function calcSpeed(words: number, minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.round(words / minutes);
}

/** 按关键词切分文本，供检索 / 快照 diff 高亮渲染 */
export function splitByKeyword(text: string, keyword: string): TextSegment[] {
  if (!keyword) return [{ text, hit: false }];

  const lowerText = text.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  const segments: TextSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const found = lowerText.indexOf(lowerKeyword, cursor);
    if (found === -1) {
      segments.push({ text: text.slice(cursor), hit: false });
      break;
    }
    if (found > cursor) {
      segments.push({ text: text.slice(cursor, found), hit: false });
    }
    segments.push({
      text: text.slice(found, found + keyword.length),
      hit: true,
    });
    cursor = found + keyword.length;
  }

  return segments.filter((segment) => segment.text.length > 0);
}

/** 字符级截断，超出补省略号（用于列表摘要） */
export function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars.slice(0, max).join("")}…`;
}

/** 抽取命中词附近的片段，避免整章塞进检索结果 */
export function buildSearchSnippet(
  content: string,
  keyword: string,
  radius = 24,
): string {
  if (!keyword) return truncate(content.replace(/\s+/g, " "), radius * 2);

  const plain = content.replace(/\s+/g, " ");
  const index = plain.toLowerCase().indexOf(keyword.toLowerCase());
  if (index === -1) return truncate(plain, radius * 2);

  const start = Math.max(0, index - radius);
  const end = Math.min(plain.length, index + keyword.length + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < plain.length ? "…" : "";
  return `${prefix}${plain.slice(start, end)}${suffix}`;
}

/**
 * 子序列模糊匹配：Ctrl+P 章节跳转用。
 * 连续命中给加成，返回按分数倒序的结果。
 */
export function fuzzyMatch<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
): T[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return items;

  const scored = items
    .map((item) => {
      const text = getText(item).toLowerCase();
      const score = scoreSubsequence(text, keyword);
      return { item, score };
    })
    .filter((entry) => entry.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.item);
}

function scoreSubsequence(text: string, keyword: string): number {
  if (!keyword) return 1;
  let score = 0;
  let textIndex = 0;
  let streak = 0;

  for (const char of keyword) {
    const found = text.indexOf(char, textIndex);
    if (found === -1) return 0;
    if (found === textIndex) {
      streak += 1;
      score += 4 + streak;
    } else {
      streak = 0;
      score += 1;
    }
    textIndex = found + 1;
  }

  return score;
}

/** 卷 → 章两级分组，卷内按 sort 排序 */
export interface ChapterGroup {
  volume: NovelVolume;
  chapters: NovelChapter[];
}

export function buildChapterGroups(
  volumes: NovelVolume[],
  chapters: NovelChapter[],
): ChapterGroup[] {
  return [...volumes]
    .sort((a, b) => a.sort - b.sort)
    .map((volume) => ({
      volume,
      chapters: chapters
        .filter((chapter) => chapter.volumeId === volume.id)
        .sort((a, b) => a.sort - b.sort),
    }));
}

/** 面包屑「卷名 / 章名」 */
export function buildBreadcrumb(
  volumes: NovelVolume[],
  chapters: NovelChapter[],
  activeChapterId: string | null,
): { volumeName: string; chapterName: string } {
  const chapter = chapters.find((item) => item.id === activeChapterId);
  if (!chapter) return { volumeName: "", chapterName: "" };
  const volume = volumes.find((item) => item.id === chapter.volumeId);
  return { volumeName: volume?.name ?? "未分卷", chapterName: chapter.title };
}
