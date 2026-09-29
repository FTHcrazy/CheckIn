/**
 * 书架主页面纯函数工具（R32）
 *
 * 全部为「参数进、结果出」的可测函数：书卡聚合、排序筛选、继续写作定位、
 * 灵感库筛选、封面配色派生。类型使用 electron.d.ts 导出的 DTO 契约——
 * 书架与编辑器是同窗口的两个页面，按 AGENTS.md 页面隔离规范互不导入，
 * 数据契约以 preload 暴露的线格式（DTO）为准。
 */

import type {
  NovelBundleDTO,
  NovelChapterDTO,
  NovelNoteDTO,
  NovelVolumeDTO,
} from "@/shared/types/electron";

// ── 展示模型 ────────────────────────────────────────────────────────

/** 书卡视图：作品 + 卷章聚合后的展示数据 */
export interface WorkCardView {
  id: string;
  name: string;
  createdAt: number;
  /** 全部章节字数之和 */
  totalWords: number;
  chapterCount: number;
  doneCount: number;
  volumeCount: number;
  /** 最近一次章节更新时间；无章节为 0 */
  updatedAt: number;
  /** 连载中 = 存在未完稿章节（或还没有章节）；全部完稿且有章节 = 已完稿 */
  status: "ongoing" | "finished";
}

/** 序号风格（与编辑器 EditorSettings 的字段口径一致，此处独立声明避免跨页导入） */
export interface ShelfNumberStyle {
  numberStyle: "arabic" | "chinese";
  chapterSuffix: string;
  volumeSuffix: string;
  dailyGoal: number;
}

/** 继续写作 Hero 的展示数据（G1 / R6：打开即回到上次位置） */
export interface HeroView {
  workId: string;
  chapterId: string;
  workName: string;
  volumeLabel: string;
  chapterLabel: string;
  /** 相对时间（12 分钟前 / 昨天 23:41…） */
  lastActiveText: string;
}

/** 位置记忆（novel_editor_position 的校验后子集，只取书架关心的两元） */
export interface ShelfPosition {
  workId: string;
  chapterId: string;
}

// ── 格式化 ──────────────────────────────────────────────────────────

/** 千分位（今日新增 1,284） */
export function formatThousands(value: number): string {
  return String(Math.max(0, Math.round(value))).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ",",
  );
}

/** 字数紧凑展示：≥1 万 → 「48.2 万」（去尾 .0），否则千分位 */
export function formatWordsCompact(words: number): string {
  const safe = Math.max(0, Math.round(words));
  if (safe < 10_000) return formatThousands(safe);
  const wan = safe / 10_000;
  const text = wan >= 100 ? String(Math.round(wan)) : wan.toFixed(1).replace(/\.0$/, "");
  return `${text} 万`;
}

/** 相对时间（Hero「上次写到 · 12 分钟前」） */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  if (!timestamp) return "尚未动笔";
  const diff = now - timestamp;
  if (diff < 0) return "刚刚";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return formatDayLabel(timestamp, now);
}

const clockOf = (timestamp: number): string => {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const dayKey = (timestamp: number): string => {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** 天级相对时间（卡片「昨天 23:41 更新」、灵感时间戳） */
export function formatDayLabel(timestamp: number, now: number = Date.now()): string {
  if (!timestamp) return "—";
  const diffDays = Math.floor(
    (new Date(dayKey(now)).getTime() - new Date(dayKey(timestamp)).getTime()) / 86_400_000,
  );
  if (diffDays <= 0) return `今天 ${clockOf(timestamp)}`;
  if (diffDays === 1) return `昨天 ${clockOf(timestamp)}`;
  if (diffDays < 7) return `${diffDays} 天前`;
  if (diffDays < 14) return "上周";
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

// ── 中文序号（卷/章标签派生，与编辑器 formatNumberedLabel 同口径） ──

const CHINESE_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 中文序数：1-9999（八十七 / 三百零六），超界回退阿拉伯数字 */
export function toChineseOrdinal(value: number): string {
  const n = Math.max(1, Math.round(value));
  if (n >= 10_000) return String(n);
  if (n < 10) return CHINESE_DIGITS[n];

  const digits = Array.from(String(n), Number);
  const units = ["", "十", "百", "千"];
  let result = "";
  const length = digits.length;
  digits.forEach((digit, index) => {
    const unit = units[length - 1 - index];
    if (digit === 0) {
      // 防止「三百零」「一千零十」式尾零：仅在中间补「零」
      if (result && !result.endsWith("零") && index < length - 1) result += "零";
      return;
    }
    result += (n < 20 && n >= 10 && index === 0) ? "" : CHINESE_DIGITS[digit];
    result += unit;
  });
  return result.replace(/零+$/, "");
}

/** 第N后缀：chinese → 第八十七章，arabic → 第87章 */
export function formatNumberedLabel(
  style: "arabic" | "chinese",
  suffix: string,
  value: number,
): string {
  const n = Math.max(1, Math.round(value));
  return `第${style === "chinese" ? toChineseOrdinal(n) : n}${suffix}`;
}

/** 按卷序 → 章序派生全书章节序号（书架侧独立实现，不跨页复用编辑器工具） */
export function buildWorkOrdinals(
  volumes: NovelVolumeDTO[],
  chapters: NovelChapterDTO[],
): Map<string, number> {
  const volumeSort = new Map(volumes.map((volume) => [volume.id, volume.sort]));
  const ordinals = new Map<string, number>();
  let seq = 0;
  for (const chapter of [...chapters].sort((a, b) => {
    const va = volumeSort.get(a.volumeId) ?? Number.MAX_SAFE_INTEGER;
    const vb = volumeSort.get(b.volumeId) ?? Number.MAX_SAFE_INTEGER;
    return va - vb || a.sort - b.sort;
  })) {
    seq += 1;
    ordinals.set(chapter.id, seq);
  }
  return ordinals;
}

// ── 书卡聚合 / 排序 / 筛选 ──────────────────────────────────────────

/** 由全量数据包聚合每部作品的书卡视图（按 works 原始顺序） */
export function buildWorkCards(bundle: NovelBundleDTO): WorkCardView[] {
  return bundle.works.map((work) => {
    const chapters = bundle.chapters.filter((chapter) => chapter.workId === work.id);
    const volumes = bundle.volumes.filter((volume) => volume.workId === work.id);
    const totalWords = chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
    const doneCount = chapters.filter((chapter) => chapter.status === "done").length;
    const updatedAt = chapters.reduce(
      (max, chapter) => Math.max(max, chapter.updatedAt),
      0,
    );
    return {
      id: work.id,
      name: work.name,
      createdAt: work.createdAt,
      totalWords,
      chapterCount: chapters.length,
      doneCount,
      volumeCount: volumes.length,
      updatedAt,
      status:
        chapters.length > 0 && doneCount === chapters.length ? "finished" : "ongoing",
    } satisfies WorkCardView;
  });
}

export type ShelfSortKey = "recent" | "created" | "words";
export type ShelfStatusFilter = "all" | "ongoing" | "finished";

export function sortWorkCards(cards: WorkCardView[], key: ShelfSortKey): WorkCardView[] {
  return [...cards].sort((a, b) => {
    if (key === "created") return b.createdAt - a.createdAt;
    if (key === "words") return b.totalWords - a.totalWords;
    // 最近更新：从未动笔的作品沉底
    return b.updatedAt - a.updatedAt || b.createdAt - a.createdAt;
  });
}

/** 状态筛选 + 关键词（匹配书名，忽略大小写） */
export function filterWorkCards(
  cards: WorkCardView[],
  status: ShelfStatusFilter,
  keyword: string,
): WorkCardView[] {
  const trimmed = keyword.trim().toLowerCase();
  return cards.filter((card) => {
    if (status !== "all" && card.status !== status) return false;
    if (trimmed && !card.name.toLowerCase().includes(trimmed)) return false;
    return true;
  });
}

// ── 继续写作 Hero ───────────────────────────────────────────────────

/**
 * 解析「继续写作」目标：位置记忆有效则用之（R6），否则回退到全库
 * 最近更新的章节；全库无章节返回 null（书架空态由空书卡承接）。
 */
export function resolveHero(
  bundle: NovelBundleDTO,
  position: ShelfPosition | null,
  style: ShelfNumberStyle,
  now: number = Date.now(),
): HeroView | null {
  let workId = "";
  let chapterId = "";

  if (
    position &&
    bundle.works.some((work) => work.id === position.workId) &&
    bundle.chapters.some(
      (chapter) => chapter.id === position.chapterId && chapter.workId === position.workId,
    )
  ) {
    workId = position.workId;
    chapterId = position.chapterId;
  }

  if (!workId) {
    const latest = [...bundle.chapters].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!latest) return null;
    workId = latest.workId;
    chapterId = latest.id;
  }

  const work = bundle.works.find((item) => item.id === workId);
  const chapter = bundle.chapters.find((item) => item.id === chapterId);
  if (!work || !chapter) return null;

  const workVolumes = bundle.volumes.filter((volume) => volume.workId === workId);
  const workChapters = bundle.chapters.filter((item) => item.workId === workId);
  const ordinals = buildWorkOrdinals(workVolumes, workChapters);
  const volume = workVolumes.find((item) => item.id === chapter.volumeId);
  const volumeLabel = volume
    ? formatNumberedLabel(style.numberStyle, style.volumeSuffix, Math.max(1, volume.sort))
    : "";
  const chapterLabel = `${formatNumberedLabel(
    style.numberStyle,
    style.chapterSuffix,
    ordinals.get(chapter.id) ?? 1,
  )} ${chapter.title}`.trim();

  return {
    workId,
    chapterId,
    workName: work.name,
    volumeLabel,
    chapterLabel,
    lastActiveText: formatRelativeTime(chapter.updatedAt, now),
  };
}

// ── 全局灵感库（R32） ───────────────────────────────────────────────

export type IdeaFilter = "all" | "unassigned" | "pinned" | "archived";

/** 未归属灵感：workId 为空串（跨作品收集池），其余视为已归档到作品 */
export const isUnassignedNote = (note: NovelNoteDTO): boolean => !note.workId;

export function countIdeaNotes(notes: NovelNoteDTO[]): Record<IdeaFilter, number> {
  const unassigned = notes.filter(isUnassignedNote).length;
  return {
    all: notes.length,
    unassigned,
    pinned: notes.filter((note) => note.pinned).length,
    archived: notes.length - unassigned,
  };
}

export function filterIdeaNotes(
  notes: NovelNoteDTO[],
  filter: IdeaFilter,
  keyword: string,
): NovelNoteDTO[] {
  const trimmed = keyword.trim().toLowerCase();
  return notes.filter((note) => {
    if (filter === "unassigned" && !isUnassignedNote(note)) return false;
    if (filter === "archived" && isUnassignedNote(note)) return false;
    if (filter === "pinned" && !note.pinned) return false;
    if (trimmed && !note.content.toLowerCase().includes(trimmed)) return false;
    return true;
  });
}

/** 置顶优先，其余按记录时间倒序（与编辑器灵感速记同口径） */
export function sortIdeaNotes(notes: NovelNoteDTO[]): NovelNoteDTO[] {
  return [...notes].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt,
  );
}

// ── 封面配色（程序化兜底：具体色值，与主题解耦，参照 CUSTOM_TYPE_PALETTE 先例） ──

export interface CoverPalette {
  /** 渐变起止色 */
  from: string;
  to: string;
  /** 装饰光斑 / 首字水印色 */
  accent: string;
}

export const COVER_PALETTES: CoverPalette[] = [
  { from: "#23244d", to: "#4a3f8f", accent: "#8f9bff" },
  { from: "#0f3d3a", to: "#1f7a6d", accent: "#5fd4b8" },
  { from: "#5a3413", to: "#c07b2d", accent: "#ffcf8f" },
  { from: "#3b2a63", to: "#7a5fd4", accent: "#c9b8ff" },
  { from: "#5c2438", to: "#c04a6b", accent: "#ff9fb6" },
  { from: "#26334d", to: "#4a6fa5", accent: "#9fc0ff" },
];

/** 按作品 id 稳定派生封面配色：同书永远同色，不随顺序变化 */
export function coverPaletteOf(seed: string): CoverPalette {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return COVER_PALETTES[Math.abs(hash) % COVER_PALETTES.length];
}
