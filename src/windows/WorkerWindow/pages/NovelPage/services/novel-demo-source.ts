import type {
  LevelSystem,
  NovelChapter,
  NovelEntity,
  NovelLink,
  NovelNote,
  NovelSnapshot,
  NovelVolume,
  NovelWork,
  OutlineEntry,
  SearchHit,
} from "../types";
import { buildSearchSnippet, countWords } from "../novel-utils";

/**
 * 小说编辑器数据占位源
 *
 * 现阶段主进程还没有 novel_* 表与 novel-handlers（PRD §7 工程落点尚未开工），
 * 因此先按「未来 IPC 的返回形态」提供一份本地数据，hooks 只依赖这里的函数签名。
 *
 * TODO(数据层接入)：把每个导出函数替换为 `window.electronAPI.novel.*` 调用即可，
 * 页面层与组件层无需改动。注意 SQL 只允许出现在 electron/handlers 与 db.ts。
 */

/** 崩溃恢复信息（PRD R3 / 设计方案 §07） */
export interface NovelRecovery {
  snapshotTime: number;
  deltaWords: number;
}

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

const DEMO_CONTENT = [
  "雨是从后半夜开始下的。",
  "沈砚站在山门外的石阶上，看着雨水顺着青梧的檐角滴落成线。三年前他离开天衍宗时，也是这样的雨。",
  "「师兄。」身后有人唤他。",
  "陆昭撑着一把油纸伞，伞面已经旧得发白，伞骨断了一根，用麻绳草草缠着。",
  "「你还是来了。」",
  "沈砚没有回头。他知道陆昭会来——从天衍宗下山三百里，只有这一条路。",
  "雷声从云层深处滚过。他想起师父临终前说的那句话：青梧山的雨，能洗掉剑上的锈，洗不掉人心里的。",
  "「进去吧。」陆昭把伞往他这边挪了半寸，「掌门已经等了很久。」",
].join("\n");

const SHORT_CONTENT = [
  "他回到檐下坐下，茶已经凉了。",
  "「三年了。」掌门把旧信推过来，「你师父托我保管的。」",
].join("\n");

const hoursAgo = (hours: number, minutes = 0): number =>
  Date.now() - hours * 3_600_000 - minutes * 60_000;

const WORKS: NovelWork[] = [
  { id: "w1", name: "九州行", createdAt: hoursAgo(24 * 30) },
  { id: "w2", name: "旧剑录", createdAt: hoursAgo(24 * 120) },
];

const VOLUMES: NovelVolume[] = [
  { id: "v1", workId: "w1", name: "第一卷 · 少年游", sort: 1 },
  { id: "v2", workId: "w1", name: "第二卷 · 长夜行", sort: 2 },
];

const rawChapters: Array<Omit<NovelChapter, "wordCount">> = [
  { id: "c1", workId: "w1", volumeId: "v1", title: "雨夜叩门", content: "山门在雨里显得更旧了。", status: "done", sort: 1, updatedAt: hoursAgo(72) },
  { id: "c2", workId: "w1", volumeId: "v1", title: "旧剑", content: "此剑出自青梧后山的矿脉，重三十七斤。", status: "done", sort: 2, updatedAt: hoursAgo(60) },
  { id: "c3", workId: "w1", volumeId: "v1", title: "师兄的伞", content: "陆昭把伞递过来，伞骨断了一根。", status: "done", sort: 3, updatedAt: hoursAgo(48), outlineNote: "陆昭冒雨送伞，伞骨断了一根——不点破的旧交情。" },
  { id: "c4", workId: "w1", volumeId: "v1", title: "不告而别", content: "他没有留下只言片语。", status: "done", sort: 4, updatedAt: hoursAgo(36) },
  { id: "c5", workId: "w1", volumeId: "v1", title: "山下酒肆", content: "酒肆里有人说起天衍宗的旧事。", status: "done", sort: 5, updatedAt: hoursAgo(24), outlineNote: "借酒客之口抖出旧事，坐实师父之死另有隐情。" },
  { id: "c6", workId: "w1", volumeId: "v1", title: "青梧山道", content: "远望青梧山，雨雾里只见半截山门。", status: "done", sort: 6, updatedAt: hoursAgo(10) },
  { id: "c7", workId: "w1", volumeId: "v1", title: "青梧山雨", content: DEMO_CONTENT, status: "draft", sort: 7, updatedAt: hoursAgo(0, 3), outlineNote: "陆昭接他回山，掌门已等了三年。" },
  { id: "c8", workId: "w1", volumeId: "v1", title: "檐下对坐", content: SHORT_CONTENT, status: "draft", sort: 8, updatedAt: hoursAgo(0, 40), outlineNote: "掌门交出师父托付的旧信，旧诺浮出水面。" },
  { id: "c9", workId: "w1", volumeId: "v2", title: "渡口", content: "船在雾里靠岸。", status: "draft", sort: 1, updatedAt: hoursAgo(6) },
  { id: "c10", workId: "w1", volumeId: "v2", title: "借剑", content: "三年之约到期那天，玄铁重剑第一次出鞘。", status: "draft", sort: 2, updatedAt: hoursAgo(4) },
];

const CHAPTERS: NovelChapter[] = rawChapters.map((chapter) => ({
  ...chapter,
  wordCount: countWords(chapter.content, "withPunctuation"),
}));

const ENTITIES: NovelEntity[] = [
  {
    id: "e-shenyan",
    workId: "w1",
    type: "character",
    name: "沈砚",
    aliases: ["阿砚", "沈师兄"],
    summary: "被逐出师门后仍守着一句承诺的剑痴。沉默寡言，重诺。",
    content: "三年前离开天衍宗，独自行走北境，随身只带一柄锈迹斑斑的玄铁重剑。",
    fields: {
      金手指: "锈剑共鸣（可闻剑鸣辨人心）",
      战力: "★★★★☆",
      阵营: "无门无派",
      性格: "沉默寡言 · 重诺 · 剑痴",
    },
    sort: 1,
  },
  {
    id: "e-luzhao",
    workId: "w1",
    type: "character",
    name: "陆昭",
    aliases: ["陆师弟"],
    summary: "沈砚师弟，天衍宗现任掌门首徒。断了一根伞骨的油纸伞。",
    content: "掌门最看重的首徒，替师父守着那句不能说的旧诺。",
    fields: { 战力: "★★★☆☆", 阵营: "天衍宗" },
    sort: 2,
  },
  {
    id: "e-qingwu",
    workId: "w1",
    type: "location",
    name: "青梧山",
    aliases: ["青梧"],
    summary: "天衍宗山门所在。常年多雨，山雨能洗剑锈。",
    content: "后山有矿脉，玄铁重剑的原料便出自此处。",
    fields: { 气候: "常年多雨" },
    sort: 3,
  },
  {
    id: "e-tianyan",
    workId: "w1",
    type: "faction",
    name: "天衍宗",
    aliases: [],
    summary: "北境第一剑宗，沈砚出身之地。",
    content: "掌门一脉单传，门规极严。",
    fields: { 势力范围: "北境三州" },
    sort: 4,
  },
  {
    id: "e-xuantie",
    workId: "w1",
    type: "item",
    name: "玄铁重剑",
    aliases: ["锈剑"],
    summary: "沈砚佩剑，重三十七斤，剑身有锈。",
    content: "剑鸣可辨人心真伪。",
    fields: { 重量: "三十七斤" },
    sort: 5,
  },
  {
    id: "e-xiuzhen",
    workId: "w1",
    type: "level_system",
    name: "修真境界",
    aliases: [],
    summary: "练气 → 筑基 → 金丹 → 元婴 → 化神，共 5 阶。",
    content: "每阶分初 / 中 / 后三期。",
    fields: { 阶数: "5" },
    sort: 6,
  },
];

const LINKS: NovelLink[] = [
  { id: "l1", fromType: "character", fromId: "e-shenyan", toType: "character", toId: "e-luzhao", relation: "师兄弟" },
  { id: "l2", fromType: "character", fromId: "e-shenyan", toType: "faction", toId: "e-tianyan", relation: "出身地" },
  { id: "l3", fromType: "character", fromId: "e-shenyan", toType: "item", toId: "e-xuantie", relation: "持有" },
  { id: "l4", fromType: "character", fromId: "e-shenyan", toType: "level_system", toId: "e-xiuzhen", relation: "当前境界", note: "金丹 · 中期" },
  { id: "l5", fromType: "character", fromId: "e-luzhao", toType: "faction", toId: "e-tianyan", relation: "所属" },
  { id: "l6", fromType: "item", fromId: "e-xuantie", toType: "location", toId: "e-qingwu", relation: "出自" },
];

const LEVEL_SYSTEMS: LevelSystem[] = [
  {
    id: "ls1",
    workId: "w1",
    name: "修真境界",
    rungs: [
      { id: "lv1", name: "练气", rank: 1 },
      { id: "lv2", name: "筑基", rank: 2 },
      { id: "lv3", name: "金丹 · 中期", rank: 3, note: "沈砚当前" },
      { id: "lv4", name: "元婴", rank: 4 },
      { id: "lv5", name: "化神", rank: 5 },
    ],
  },
];

const NOTES: NovelNote[] = [
  { id: "n1", workId: "w1", content: "掌门的旧诺到底是什么？必须在第九章前给出答案，否则读者会觉得拖。", createdAt: hoursAgo(0, 90), pinned: true },
  { id: "n2", workId: "w1", content: "断伞骨 → 第二章旧剑。回收时让陆昭修伞，不说破。", createdAt: hoursAgo(0, 45), pinned: false },
  { id: "n3", workId: "w1", content: "下一章开头：雨停，山门内传来钟声。", createdAt: hoursAgo(0, 20), pinned: false },
  { id: "n4", workId: "w1", content: "「洗掉剑上的锈，洗不掉人心里的」——这句留着当卷末收尾。", createdAt: hoursAgo(0, 5), pinned: false },
];

/**
 * 伏笔条目（R7）：挂在真实卷 / 章上，回收状态可切换。
 * 骨架（卷章）不落库，所以这里只有用户手写的伏笔。
 */
const OUTLINE_ENTRIES: OutlineEntry[] = [
  {
    id: "f1",
    workId: "w1",
    kind: "foreshadow",
    volumeId: "v1",
    chapterId: "c3",
    title: "断伞骨",
    note: "第三章埋设；回收时让陆昭修伞，不说破。",
    status: "open",
    createdAt: hoursAgo(0, 52),
  },
  {
    id: "f2",
    workId: "w1",
    kind: "foreshadow",
    volumeId: "v1",
    chapterId: "c7",
    title: "师父临终语",
    note: "「青梧山的雨，能洗掉剑上的锈，洗不掉人心里的」——卷末回收。",
    status: "open",
    createdAt: hoursAgo(0, 30),
  },
  {
    id: "f3",
    workId: "w1",
    kind: "foreshadow",
    volumeId: "v2",
    title: "三年之约",
    note: "第十章借剑已回收，玄铁重剑第一次出鞘。",
    status: "resolved",
    createdAt: hoursAgo(6),
  },
];

/** 拉取编辑器所需的全部数据（对应未来的 novel-editor-load） */
export async function fetchNovelBundle(): Promise<NovelBundle> {
  return {
    works: [...WORKS],
    volumes: [...VOLUMES],
    chapters: CHAPTERS.map((chapter) => ({ ...chapter })),
    entities: ENTITIES.map((entity) => ({ ...entity, aliases: [...entity.aliases], fields: { ...entity.fields } })),
    links: LINKS.map((link) => ({ ...link })),
    levelSystems: LEVEL_SYSTEMS.map((system) => ({ ...system, rungs: system.rungs.map((rung) => ({ ...rung })) })),
    notes: NOTES.map((note) => ({ ...note })),
    outlineEntries: OUTLINE_ENTRIES.map((entry) => ({ ...entry })),
    recovery: { snapshotTime: hoursAgo(0, 8), deltaWords: 512 },
  };
}

/** 拉取某章节的历史快照（对应未来的 novel-snapshot-list） */
export async function fetchChapterSnapshots(
  chapterId: string,
): Promise<NovelSnapshot[]> {
  // 演示用：越早的快照正文越短，便于在抽屉里预览与回滚真实差异
  const timeline: Array<{ delta: number; hours: number; minutes: number; keep: number }> = [
    { delta: 512, hours: 0, minutes: 8, keep: 10 },
    { delta: 806, hours: 0, minutes: 33, keep: 8 },
    { delta: 1204, hours: 1, minutes: 2, keep: 6 },
    { delta: 318, hours: 3, minutes: 20, keep: 4 },
    { delta: 0, hours: 5, minutes: 20, keep: 2 },
  ];

  return timeline.map((item, index) => ({
    id: `s${index + 1}`,
    chapterId,
    content: DEMO_CONTENT.split("\n").slice(0, item.keep).join("\n"),
    deltaWords: item.delta,
    createdAt: hoursAgo(item.hours, item.minutes),
  }));
}

/** 全书检索（对应未来的 novel-search-all），按章节聚合命中次数 */
export async function searchAcrossBook(
  keyword: string,
  chapters: NovelChapter[],
): Promise<SearchHit[]> {
  const trimmed = keyword.trim();
  if (!trimmed) return [];

  return chapters
    .map((chapter) => {
      const count = chapter.content.split(trimmed).length - 1;
      return {
        id: `${chapter.id}-${trimmed}`,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        count,
        snippet: buildSearchSnippet(chapter.content, trimmed),
      };
    })
    .filter((hit) => hit.count > 0)
    .sort((a, b) => b.count - a.count);
}

/** 保存章节正文（对应未来的 novel-chapter-save） */
export async function saveChapterContent(
  chapterId: string,
  content: string,
): Promise<boolean> {
  return chapterId.length > 0 && typeof content === "string";
}

/** 保存章节大纲梗概（对应未来的 novel-outline-save-chapter，空串即清除） */
export async function saveChapterOutline(
  chapterId: string,
  note: string,
): Promise<boolean> {
  return chapterId.length > 0 && typeof note === "string";
}

/** 新增 / 更新伏笔条目（对应未来的 novel-outline-entry-save，upsert 语义） */
export async function saveOutlineEntry(entry: OutlineEntry): Promise<boolean> {
  return entry.id.length > 0 && entry.title.trim().length > 0;
}

/** 删除伏笔条目（对应未来的 novel-outline-entry-remove） */
export async function removeOutlineEntry(entryId: string): Promise<boolean> {
  return entryId.length > 0;
}

/** 新增 / 更新灵感速记（对应未来的 novel-note-save，upsert 语义） */
export async function saveNote(note: NovelNote): Promise<boolean> {
  return note.id.length > 0 && note.content.trim().length > 0;
}

/** 删除灵感速记（对应未来的 novel-note-remove） */
export async function removeNote(noteId: string): Promise<boolean> {
  return noteId.length > 0;
}
