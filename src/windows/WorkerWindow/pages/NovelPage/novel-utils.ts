import type {
  EntityTerm,
  EntityType,
  ForeshadowPatch,
  LabelNumberStyle,
  NotePatch,
  NovelChapter,
  NovelEntity,
  NovelNote,
  NovelVolume,
  OutlineEntry,
  OutlineEntryDraft,
  OutlineNode,
  TermMatch,
  TextSegment,
  WordCountMode,
} from "./types";
import { UNNAMED_VOLUME } from "./novel-config";

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

/**
 * 在列表内把 fromId 移动到 toId 原所在位置（先移除后插入）。
 * fromId 与 toId 相同、或任一不存在时原样返回；不修改入参。
 */
export function moveItemBefore<T extends { id: string }>(
  items: T[],
  fromId: string,
  toId: string,
): T[] {
  if (fromId === toId) return items;
  const from = items.findIndex((item) => item.id === fromId);
  const to = items.findIndex((item) => item.id === toId);
  if (from === -1 || to === -1) return items;

  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to > from ? to - 1 : to, 0, moved);
  return next;
}

/**
 * 把一个不在列表中的元素插入到 targetId 之前；targetId 不存在时追加到末尾。
 */
export function insertItemBefore<T extends { id: string }>(
  items: T[],
  targetId: string,
  item: T,
): T[] {
  const to = items.findIndex((current) => current.id === targetId);
  if (to === -1) return [...items, item];

  const next = [...items];
  next.splice(to, 0, item);
  return next;
}

/** 按列表顺序生成 id → sort（从 1 起）的映射，供批量回写 sort 列 */
export function buildSortOrder(
  items: ReadonlyArray<{ id: string }>,
): Map<string, number> {
  return new Map(items.map((item, index) => [item.id, index + 1]));
}

/**
 * 大纲派生选项
 *
 * 卷 / 章的序号标签与左栏章节树共用同一套配置，改序号样式后大纲同步变动。
 */
export interface OutlineBuildOptions {
  numberStyle: LabelNumberStyle;
  chapterSuffix: string;
  volumeSuffix: string;
}

/**
 * 由真实卷 / 章 + 用户手写的伏笔派生大纲树（PRD R7）
 *
 * 骨架永远来自 volumes / chapters，不落库、也不允许与左栏不一致——
 * 因此大纲里的章节节点自带真实 chapterId，点击即跳转（历史上的桩数据
 * 用「o-c7」这类假 id，点了编辑器直接空态）。
 * 伏笔统一挂到所属卷末尾（待回收在前、同级内按写入时间），不插进章序中间，
 * 避免「大纲顺序 ≠ 章节顺序」的误导。
 */
export function buildOutlineTree(
  volumes: NovelVolume[],
  chapters: NovelChapter[],
  entries: OutlineEntry[],
  options: OutlineBuildOptions,
): OutlineNode[] {
  const numbers = buildChapterNumbers(volumes, chapters);

  return buildChapterGroups(volumes, chapters).map((group, index) => {
    const chapterNodes: OutlineNode[] = group.chapters.map((chapter) => ({
      kind: "chapter",
      id: chapter.id,
      chapterId: chapter.id,
      title: chapter.title,
      label: formatNumberedLabel(
        options.numberStyle,
        options.chapterSuffix,
        numbers.get(chapter.id) ?? 1,
      ),
      note: chapter.outlineNote ?? "",
      wordCount: chapter.wordCount,
      status: chapter.status,
    }));

    const owned = entries.filter((entry) => entry.volumeId === group.volume.id);
    const foreshadowNodes: OutlineNode[] = [...owned]
      .sort(
        (a, b) =>
          Number(a.status === "resolved") - Number(b.status === "resolved") ||
          a.createdAt - b.createdAt,
      )
      .map((entry) => ({
        kind: "foreshadow",
        id: entry.id,
        entryId: entry.id,
        title: entry.title,
        note: entry.note,
        resolved: entry.status === "resolved",
      }));

    return {
      kind: "volume",
      id: group.volume.id,
      title: formatNumberedLabel(
        options.numberStyle,
        options.volumeSuffix,
        index + 1,
      ),
      note: group.volume.name === UNNAMED_VOLUME ? "" : group.volume.name,
      openForeshadows: owned.filter((entry) => entry.status === "open").length,
      children: [...chapterNodes, ...foreshadowNodes],
    };
  });
}

/** 灵感排序：置顶优先，同级按创建时间倒序；不改入参 */
export function sortNotes(notes: NovelNote[]): NovelNote[] {
  return [...notes].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt,
  );
}

/** 灵感关键词过滤（内容子串，忽略大小写）；空关键词原样返回 */
export function filterNotes(notes: NovelNote[], keyword: string): NovelNote[] {
  const trimmed = keyword.trim().toLowerCase();
  if (!trimmed) return notes;
  return notes.filter((note) => note.content.toLowerCase().includes(trimmed));
}

/** 取首个非空行作标题并做字符级截断（一键转化的默认标题） */
export function firstLineTitle(text: string, max = 18): string {
  const firstLine =
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  return truncate(firstLine, max);
}

/**
 * 由灵感生成伏笔条目草稿（R7 联动：灵感 → 大纲）
 *
 * id 与 createdAt 由调用方注入，本函数保持纯函数可测；
 * 标题取首行截断，正文原样存进伏笔说明，不丢信息。
 */
export function buildForeshadowDraft(
  note: NovelNote,
  volumeId: string,
  chapterId?: string,
): OutlineEntryDraft {
  return {
    workId: note.workId,
    kind: "foreshadow",
    volumeId,
    chapterId: chapterId || undefined,
    title: firstLineTitle(note.content),
    note: note.content,
    status: "open",
  };
}

/**
 * 写入章节一句话梗概；去首尾空白后与原文相同、或章节不存在时返回原引用，
 * 空串表示清除梗概。不修改入参（updatedAt 属于正文保存，不在此更新）。
 */
export function patchChapterOutlineNote(
  chapters: NovelChapter[],
  chapterId: string,
  note: string,
): NovelChapter[] {
  const trimmed = note.trim();
  const target = chapters.find((chapter) => chapter.id === chapterId);
  if (!target || (target.outlineNote ?? "") === trimmed) return chapters;
  return chapters.map((chapter) =>
    chapter.id === chapterId ? { ...chapter, outlineNote: trimmed } : chapter,
  );
}

/** 伏笔条目局部更新；标题去空白后为空、或条目不存在时返回原引用 */
export function patchOutlineEntry(
  entries: OutlineEntry[],
  entryId: string,
  patch: ForeshadowPatch,
): OutlineEntry[] {
  const target = entries.find((entry) => entry.id === entryId);
  if (!target) return entries;
  const next: OutlineEntry = { ...target };
  if (patch.title !== undefined) {
    const trimmed = patch.title.trim();
    if (!trimmed) return entries;
    next.title = trimmed;
  }
  if (patch.note !== undefined) next.note = patch.note.trim();
  return entries.map((entry) => (entry.id === entryId ? next : entry));
}

/** 灵感局部更新；正文去空白后为空、或灵感不存在时返回原引用 */
export function patchNote(
  notes: NovelNote[],
  noteId: string,
  patch: NotePatch,
): NovelNote[] {
  const target = notes.find((note) => note.id === noteId);
  if (!target) return notes;
  const next: NovelNote = { ...target };
  if (patch.content !== undefined) {
    const trimmed = patch.content.trim();
    if (!trimmed) return notes;
    next.content = trimmed;
  }
  if (patch.pinned !== undefined) next.pinned = patch.pinned;
  if (patch.foreshadowId !== undefined) next.foreshadowId = patch.foreshadowId;
  return notes.map((note) => (note.id === noteId ? next : note));
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

/**
 * 全书章节序号：卷按 sort、卷内章按 sort 连续编号。
 * 序号是排序的派生属性（不写进标题字符串），拖拽重排后由调用方重新派生即自动跟随。
 */
export function buildChapterNumbers(
  volumes: NovelVolume[],
  chapters: NovelChapter[],
): Map<string, number> {
  const numbers = new Map<string, number>();
  let seq = 0;
  for (const group of buildChapterGroups(volumes, chapters)) {
    for (const chapter of group.chapters) {
      seq += 1;
      numbers.set(chapter.id, seq);
    }
  }
  return numbers;
}

/** 中文数字位权（个十百千），配合 CN_DIGITS 支持到万级 */
const CN_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const CN_UNITS = ["", "十", "百", "千"];

/** 0-9999 节内转换（不做零压缩边界，由 toChineseOrdinal 编排） */
function fourDigitToChinese(n: number): string {
  // 10-19 规范写法省略「一」：10 → 十、12 → 十二（口语「一十二」不采用）
  if (n >= 10 && n < 20) {
    const tail = n % 10;
    return tail > 0 ? `十${CN_DIGITS[tail]}` : "十";
  }
  let result = "";
  let zeroPending = false;
  for (let i = 3; i >= 0; i -= 1) {
    const digit = Math.floor(n / 10 ** i) % 10;
    if (digit === 0) {
      if (result) zeroPending = true;
    } else {
      if (zeroPending) {
        result += "零";
        zeroPending = false;
      }
      result += CN_DIGITS[digit] + CN_UNITS[i];
    }
  }
  return result;
}

/** 阿拉伯数字 → 中文序号：1→一、11→十一、123→一百二十三、10001→一万零一 */
export function toChineseOrdinal(value: number): string {
  const n = Math.max(1, Math.round(value));
  if (n >= 100_000_000) return String(n); // 超出常规序号范围回退阿拉伯数字

  const wan = Math.floor(n / 10_000);
  const rest = n % 10_000;
  if (wan === 0) return fourDigitToChinese(rest);

  let result = fourDigitToChinese(wan) + "万";
  if (rest > 0) {
    // 万节不足一千必须补零：10500 → 一万零五百
    result += rest < 1000 ? `零${fourDigitToChinese(rest)}` : fourDigitToChinese(rest);
  }
  return result;
}

/**
 * 按数字样式与后缀格式化序号标签："章" + 12 → 第十二章 / 第12章。
 * 数字样式与后缀是两个独立配置（numberStyle / chapterSuffix / volumeSuffix），
 * 在此自由组合；后缀为空时退化为纯序号。
 */
export function formatNumberedLabel(
  style: LabelNumberStyle,
  suffix: string,
  value: number,
): string {
  const n = Math.max(1, Math.round(value));
  const numberText = style === "chinese" ? toChineseOrdinal(n) : String(n);
  return `第${numberText}${suffix}`;
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

/**
 * 重排预览纯函数（R9 + 防误触确认）
 *
 * 三个函数都返回「更新后的新数组」，同时服务于两处：
 * ① useNovelData 的 setBundle（应用变更）
 * ② 确认弹框（用预览结果派生前后的序号 diff）
 * 不修改入参；无法执行时原样返回同一引用，调用方据此跳过。
 */

/** 章节拖到章节位置：同卷重排 / 跨卷移动（落到目标章节的位置） */
export function previewChapterReorder(
  chapters: NovelChapter[],
  fromId: string,
  toId: string,
): NovelChapter[] {
  if (fromId === toId) return chapters;
  const from = chapters.find((chapter) => chapter.id === fromId);
  const to = chapters.find((chapter) => chapter.id === toId);
  if (!from || !to) return chapters;

  const siblings = chapters
    .filter((chapter) => chapter.volumeId === to.volumeId)
    .sort((a, b) => a.sort - b.sort);
  const ordered =
    from.volumeId === to.volumeId
      ? moveItemBefore(siblings, fromId, toId)
      : insertItemBefore(siblings, toId, { ...from, volumeId: to.volumeId });
  const order = buildSortOrder(ordered);
  // 跨卷时 volumeId 必须跟随迁移（buildSortOrder 只带 sort，不带卷归属）
  const movingCrossVolume = from.volumeId !== to.volumeId ? to.volumeId : null;

  return chapters.map((chapter) => {
    if (!order.has(chapter.id)) return chapter;
    const next = { ...chapter, sort: order.get(chapter.id) ?? chapter.sort };
    if (chapter.id === fromId && movingCrossVolume) next.volumeId = movingCrossVolume;
    return next;
  });
}

/** 章节拖到卷头：移入该卷并排到末尾 */
export function previewChapterToVolume(
  chapters: NovelChapter[],
  chapterId: string,
  volumeId: string,
): NovelChapter[] {
  const target = chapters.find((chapter) => chapter.id === chapterId);
  if (!target || target.volumeId === volumeId) return chapters;

  const maxSort = chapters
    .filter((chapter) => chapter.volumeId === volumeId)
    .reduce((max, chapter) => Math.max(max, chapter.sort), 0);

  return chapters.map((chapter) =>
    chapter.id === chapterId
      ? { ...chapter, volumeId, sort: maxSort + 1 }
      : chapter,
  );
}

/** 卷拖到卷头：重排卷顺序 */
export function previewVolumeReorder(
  volumes: NovelVolume[],
  fromId: string,
  toId: string,
): NovelVolume[] {
  if (fromId === toId) return volumes;
  const ordered = moveItemBefore(
    [...volumes].sort((a, b) => a.sort - b.sort),
    fromId,
    toId,
  );
  if (ordered === volumes) return volumes;
  const order = buildSortOrder(ordered);

  return volumes.map((volume) =>
    order.has(volume.id)
      ? { ...volume, sort: order.get(volume.id) ?? volume.sort }
      : volume,
  );
}
