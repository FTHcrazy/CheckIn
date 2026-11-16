/**
 * 作品纯文本（TXT）导出的单一实现
 *
 * 为什么放 shared：整本 / 单卷 / 单章的拼装口径只能有一份 —— 编辑器顶栏的
 * 「导出整本」与书架右键的「导出当前作品」是同一条产线，两处各写一份迟早在
 * 序号、段缩进、卷标题上分家（同一部书导两次得到两份不同的稿子）。
 *
 * 参数只声明**结构**（id / title / content / volumeId / sort）：页面自己的
 * NovelChapter / NovelVolume 结构上就满足这些约束，不必把页面类型搬进 shared。
 */
import { formatNumberedLabel, type NumberLabelStyle } from "./number-label";

/**
 * 卷的默认名：存储层新建卷时用的占位名。
 *
 * 放这里是因为「导出时该不该把它写进稿子」是导出侧的决定（占位名不裸写，
 * 按 sort 派生「第N卷」）；界面侧同样要判一次，所以由 novel-config 从这里
 * re-export，两处共用一个字面量。
 */
export const UNNAMED_VOLUME = "未命名卷";

/** 导出拼装需要的卷字段（页面类型结构上满足即可） */
export interface PlainTextVolume {
  id: string;
  name: string;
  sort: number;
}

/** 导出拼装需要的章节字段 */
export interface PlainTextChapter {
  id: string;
  volumeId: string;
  title: string;
  content: string;
  sort: number;
}

/** 卷 → 章两级分组，卷内按 sort 排序 */
export interface VolumeGroup<V extends PlainTextVolume, C extends PlainTextChapter> {
  volume: V;
  chapters: C[];
}

export function buildChapterGroups<V extends PlainTextVolume, C extends PlainTextChapter>(
  volumes: V[],
  chapters: C[],
): Array<VolumeGroup<V, C>> {
  // 先按 volumeId 分桶再排序：原实现是「每个卷各 filter 一遍全量章节」，
  // 复杂度 O(卷 × 章)。3000 章 / 60 卷时是 18 万次比较，而它每次切章、
  // 每次保存正文（chapters 换新数组）都会被调用，且 buildChapterNumbers 里
  // 还会再调一次 —— 分桶后降为 O(章 + 卷)，排序只作用于卷内子集。
  const byVolume = new Map<string, C[]>();
  for (const chapter of chapters) {
    const bucket = byVolume.get(chapter.volumeId);
    if (bucket) bucket.push(chapter);
    else byVolume.set(chapter.volumeId, [chapter]);
  }

  return [...volumes]
    .sort((a, b) => a.sort - b.sort)
    .map((volume) => ({
      volume,
      chapters: (byVolume.get(volume.id) ?? []).sort((a, b) => a.sort - b.sort),
    }));
}

/**
 * 全书章节序号：卷按 sort、卷内章按 sort 连续编号。
 * 序号是排序的派生属性（不写进标题字符串），拖拽重排后由调用方重新派生即自动跟随。
 */
export function buildChapterNumbers(
  volumes: PlainTextVolume[],
  chapters: PlainTextChapter[],
): Map<string, number> {
  return buildChapterNumbersFromGroups(buildChapterGroups(volumes, chapters));
}

/**
 * 序号派生的内部入口：接受**已建好**的分组，避免调用方已经算过 groups 时
 * 再建一遍（buildOutlineTree 同时要 groups 与 numbers，原本建了两遍）。
 */
export function buildChapterNumbersFromGroups(
  groups: Array<VolumeGroup<PlainTextVolume, PlainTextChapter>>,
): Map<string, number> {
  const numbers = new Map<string, number>();
  let seq = 0;
  for (const group of groups) {
    for (const chapter of group.chapters) {
      seq += 1;
      numbers.set(chapter.id, seq);
    }
  }
  return numbers;
}

/** 导出序号口径（与界面所见一致：数字风格 + 章 / 卷后缀 + 段首缩进） */
export interface ExportNumberingOptions {
  numberStyle: NumberLabelStyle;
  chapterSuffix: string;
  volumeSuffix: string;
  /**
   * 段首缩进（1.40.0）：导出时把每段正文规范化为全角两格缩进（\u3000\u3000）。
   * 编辑器里的缩进是 CSS `text-indent`（不落在文本上），而作者手工补的
   * 空格往往只有第二段起才有 —— 首段因此「导出不缩进」。缺省开启
   * （中文小说 txt 的通行排版）；作者在设置里关掉「首行缩进」视为
   * 自己管排版，导出保持原文不动。
   */
  paragraphIndent?: boolean;
}

/**
 * 段落规范化缩进（1.40.0）：每个非空行剥掉既有行首空白后统一补全角两格（\u3000\u3000）。
 *
 * 为什么是「剥了再补」而不是「缺了才补」：作者手工补的缩进五花八门
 * （全角两格 / 四格 / 半角空格 / 制表符），只补缺的话同一章里会出现
 * 2 格与 4 格并存的行；剥了再补幂等，跑多少遍都是同一份文本。
 */
export function normalizeParagraphIndent(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      const stripped = line.replace(/^[\s\u3000]+/, "");
      return stripped ? `\u3000\u3000${stripped}` : "";
    })
    .join("\n");
}

/** 章节标题行：「第一章 灵潮起」；章节名为空时退化为纯序号「第一章」 */
function buildChapterHeading(
  chapter: PlainTextChapter,
  chapterNumber: number,
  options: ExportNumberingOptions,
): string {
  const label = formatNumberedLabel(
    options.numberStyle,
    options.chapterSuffix,
    Math.max(1, chapterNumber),
  );
  const title = chapter.title.trim();
  return title ? `${label} ${title}` : label;
}

/** 单章文本：序号标题行 + 正文（正文原样，仅去除尾部空白） */
export function buildChapterPlainText(
  chapter: PlainTextChapter,
  chapterNumber: number,
  options: ExportNumberingOptions,
): string {
  // 缩进规范化（1.40.0）：修「每章第一段不缩进」。设置里关掉缩进的作者
  // 被视为自己在管排版，导出保持原文不动（paragraphIndent 缺省开启）。
  const body =
    options.paragraphIndent === false
      ? chapter.content
      : normalizeParagraphIndent(chapter.content);
  return [buildChapterHeading(chapter, chapterNumber, options), body.trimEnd()].join("\n\n");
}

/**
 * 单卷文本：卷标题行（第N卷 · 自定义名，口径同 volumeDisplayName）+ 卷内各章。
 * chapters 传全量（内部按卷筛选 + sort 排序），chapterNumbers 为全书章序表，
 * 保证单卷导出的章节序号与整本 / 界面完全一致。
 */
export function buildVolumePlainText(
  volume: PlainTextVolume,
  chapters: PlainTextChapter[],
  chapterNumbers: Map<string, number>,
  options: ExportNumberingOptions,
): string {
  const label = formatNumberedLabel(
    options.numberStyle,
    options.volumeSuffix,
    Math.max(1, volume.sort),
  );
  const custom = volume.name === UNNAMED_VOLUME ? "" : volume.name.trim();
  const heading = custom ? `${label} · ${custom}` : label;
  const body = chapters
    .filter((chapter) => chapter.volumeId === volume.id)
    .sort((a, b) => a.sort - b.sort)
    .map((chapter) =>
      buildChapterPlainText(chapter, chapterNumbers.get(chapter.id) ?? 1, options),
    );
  return [heading, ...body].join("\n\n");
}

/** 整本文本：书名行 + 按卷序逐卷拼装 */
export function buildBookPlainText(
  bookTitle: string,
  volumes: PlainTextVolume[],
  chapters: PlainTextChapter[],
  options: ExportNumberingOptions,
): string {
  const chapterNumbers = buildChapterNumbers(volumes, chapters);
  const blocks: string[] = [`《${bookTitle.trim() || "未命名作品"}》`];
  for (const group of buildChapterGroups(volumes, chapters)) {
    blocks.push(buildVolumePlainText(group.volume, chapters, chapterNumbers, options));
  }
  return blocks.join("\n\n");
}
