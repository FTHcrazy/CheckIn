/**
 * 书架主页面纯函数工具（R32）
 *
 * 全部为「参数进、结果出」的可测函数：书卡聚合、排序筛选、继续写作定位、
 * 灵感库筛选、封面配色派生。类型使用 electron.d.ts 导出的 DTO 契约——
 * 书架与编辑器是同窗口的两个页面，按 AGENTS.md 页面隔离规范互不导入，
 * 数据契约以 preload 暴露的线格式（DTO）为准。
 */

import {
  formatRelativeTime as relativeTime,
  formatThousands,
} from "@/shared/utils/format";
import { formatNumberedLabel, toChineseOrdinal } from "@/shared/novel/number-label";
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
  /** 题材（可空：建书第二步可跳过）；展示口径见 `formatGenreLabel` */
  genre?: string;
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
export { formatThousands } from "@/shared/utils/format";

/** 字数紧凑展示：≥1 万 → 「48.2 万」（去尾 .0），否则千分位 */
export function formatWordsCompact(words: number): string {
  const safe = Math.max(0, Math.round(words));
  if (safe < 10_000) return formatThousands(safe);
  const wan = safe / 10_000;
  const text = wan >= 100 ? String(Math.round(wan)) : wan.toFixed(1).replace(/\.0$/, "");
  return `${text} 万`;
}

/**
 * 题材展示文案：空 = 未归属。
 *
 * 建书第二步允许跳过题材，跳过不等于「没有这一栏」——书卡上把话说明白
 * （`题材：未归属`）作者才知道这里还能补，留空只会让人以为没做这个字段。
 */
export function formatGenreLabel(genre?: string): string {
  const trimmed = genre?.trim();
  return `题材：${trimmed ? trimmed : "未归属"}`;
}

/** 相对时间（Hero「上次写到 · 12 分钟前」） */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  // 书架的口径：没有时间戳 = 尚未动笔；超过一天走 formatDayLabel（今天/昨天/上周…）
  return relativeTime(timestamp, now, {
    empty: "尚未动笔",
    beyondDay: (at, current) => formatDayLabel(at, current),
  });
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
// 单一实现迁至 @/shared/novel/number-label（N11 / M30）：书架 / 编辑器 / 全局
// 设定窗口共用一处口径（REQ-052 ③「不另写一份」）。这里 re-export 保持既有
// import 路径（bookshelf-service、bookshelf-utils.test 等）不变。
export { formatNumberedLabel, toChineseOrdinal };

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
      ...(work.genre ? { genre: work.genre } : {}),
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
  /** 按书取序号规则（1.34.0）；不传则全书共用 `style` */
  styleForWork?: (workId: string) => ShelfNumberStyle,
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
  // 「继续写作」展示的是这一本书的序号规则，不是全局设置（1.34.0 按书独立）
  const workStyle = styleForWork?.(workId) ?? style;
  const volumeLabel = volume
    ? formatNumberedLabel(workStyle.numberStyle, workStyle.volumeSuffix, Math.max(1, volume.sort))
    : "";
  const chapterLabel = `${formatNumberedLabel(
    workStyle.numberStyle,
    workStyle.chapterSuffix,
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

// ── 新建作品校验（L-03） ────────────────────────────────────────────

/**
 * 书名不能为空的提示。
 *
 * 原先书名留空点「创建并开写」是**静默无反应**——`createWork` 直接 return null，
 * 弹窗不关也不提示，作者只会以为软件卡了（PRD 遗留问题 L-03）。
 * 现在校验在这里做，错误文案唯一事实源，页面只负责渲染。
 */
export const EMPTY_WORK_NAME_HINT = "先给书起个名字（后面随时能改）";

/**
 * 校验书名：通过返回 null，不通过返回给作者看的提示。
 * 只看 trim 后的结果——纯空格同样是不合格输入。
 */
export function validateWorkName(name: string): string | null {
  return name.trim() ? null : EMPTY_WORK_NAME_HINT;
}
