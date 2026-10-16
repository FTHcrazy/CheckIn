/**
 * 书籍导入解析器（纯函数，无 DOM / 无 IPC 依赖）
 *
 * 从 TXT 原文中切分出「卷 → 章」两级结构，产出可直接落库的中间结构。
 *
 * 设计来源：参考 D:\mine\Ftiehan 的 readerProvider.parseTxtChapters
 * （章节标题正则 + 广告行过滤 + 双编码回退），在此之上：
 *
 * 1. **增加卷识别**：原实现把所有标题一律当章；这里把「第X卷 / 卷X / Volume X」
 *    单独判为卷（level = "volume"），章节按最近一个卷归档。
 * 2. **不再走字节偏移**：原实现是按需读盘、需要精确字节 offset；CheckIn 是
 *    一次性全量入库，直接按行区间切片更简单也更不容易错（GB18030 下一个
 *    字符可能占 1~2 字节，字节游标极易错位）。
 * 3. 编码探测放进 worker（TextDecoder 原生支持 gb18030），本文件只处理
 *    已解码的字符串。
 *
 * 纯函数：入参字符串 → 出参结构体，便于 vitest 直接覆盖。
 */
import { countWords as countWordsShared } from "@/shared/novel/word-count";

/** 章节标题行：第X章 / 第X回 / 第X节，或 Chapter N（与参考实现同口径） */
export const CHAPTER_TITLE_RE =
  /^\s*(?:第\s*[零〇一二三四五六七八九十百千万兩两貳參肆伍陸柒捌玖拾佰仟萬0-9]+\s*(?:章|回|节|集)|[Cc]hapter\s+[0-9０-９]+)\s*[^\n]{0,40}$/;

/**
 * 标题序号前缀（捕获式）：第N章/回/节/集 或 Chapter N。
 *
 * 1.34.0 起，导入的章节**不再把序号存进标题** —— 左栏本就有序号列，
 * 「01 第1章 黑暗恐惧」是重复展示。这里捕获序号与后缀字，供两处使用：
 * ① `stripChapterNumbering` 剥离出纯章名；② `detectChapterNumbering`
 * 统计全书用的是哪种规则（章/回/节/集 × 阿拉伯/中文），写入该书的
 * 序号规则记录，让设置里的后缀自适应（见 shared/novel/work-numbering.ts）。
 */
const CHAPTER_NUM_RE =
  /^\s*(?:第\s*([零〇一二三四五六七八九十百千万兩两貳參肆伍陸柒捌玖拾佰仟萬0-9０-９]+)\s*([章回节集])|chapter\s*([0-9０-９]+))\s*/i;

/** 序号前缀之后紧跟的分隔符（「第1章：黑暗」「Chapter 3 - 雾」）一并剥掉 */
const LEADING_SEP_RE = /^[\s\u3000：:·．.。、\-—_*～~]+/;

/** 剥离标题中的序号前缀，返回纯章名（无前缀时原样返回） */
export function stripChapterNumbering(title: string): string {
  return title.replace(CHAPTER_NUM_RE, "").replace(LEADING_SEP_RE, "").trim();
}

/** 从标题集合里统计出的章节序号规则 */
export interface DetectedNumbering {
  /** 出现最多的后缀字（章 / 回 / 节 / 集；Chapter N 记「章」） */
  suffix: string;
  numberStyle: "arabic" | "chinese";
}

/**
 * 检测一本书的章节序号规则：后缀取出现最多的字，数字样式取多数派。
 * 一个都没匹配上（无结构 / 全是兜底章）返回 null，调用方沿用默认规则。
 */
export function detectChapterNumbering(titles: string[]): DetectedNumbering | null {
  const suffixCount = new Map<string, number>();
  let arabic = 0;
  let chinese = 0;
  for (const title of titles) {
    const match = CHAPTER_NUM_RE.exec(title);
    if (!match) continue;
    // 第①组+②组 = 第N章形态；第③组 = Chapter N 形态（记「章」，必为阿拉伯）
    if (match[3] !== undefined) {
      suffixCount.set("章", (suffixCount.get("章") ?? 0) + 1);
      arabic += 1;
      continue;
    }
    const suffix = match[2] ?? "章";
    suffixCount.set(suffix, (suffixCount.get(suffix) ?? 0) + 1);
    const numeric = match[1] ?? "";
    if (/[0-9０-９]/.test(numeric)) arabic += 1;
    else if (numeric) chinese += 1;
  }
  if (suffixCount.size === 0) return null;
  let suffix = "章";
  let best = -1;
  for (const [key, count] of suffixCount) {
    if (count > best) {
      suffix = key;
      best = count;
    }
  }
  return { suffix, numberStyle: arabic > chinese ? "arabic" : "chinese" };
}

/**
 * 卷标题行：第X卷 / 卷X / Volume N / Book N。
 *
 * 严格模式（用户选定）：只有行内明确出现「卷」字（中文序号形式），
 * 或英文 Volume/Book + 数字，才认定为卷。不猜测「短行即卷名」。
 *
 * - `第 一 卷`、`第一卷 风起云涌`、`第一卷：风起` 都算
 * - 裸 `卷一`（前无「第」）也算，漫画/网文常见写法
 * - 行尾允许跟卷名（≤40 字）
 */
export const VOLUME_TITLE_RE =
  /^\s*(?:第\s*[零〇一二三四五六七八九十百千万兩两貳參肆伍陸柒捌玖拾佰仟萬0-9]+\s*卷|卷\s*[零〇一二三四五六七八九十百千万兩两0-9]+|(?:第\s*)?[0-9]+\s*卷|(?:Volume|Book)\s*[0-9]+)\s*[^\n]{0,40}$/i;

/**
 * 广告 / 元信息行过滤（与参考实现 TXT_META_RE 同口径，略有收敛）。
 * 命中这些特征的行即使形似标题也跳过——盗版 TXT 的章节间常夹推广行。
 */
export const META_LINE_RE =
  /[『』「」]|作者[：:]|状态[：:]|内容简介|本书地址|更新时间|最后更新|txt下载|最新章节|请记住本站|手机阅读|www\.|https?:\/\//i;

/** 单章解析结果（落库前形态，id 由调用方生成） */
export interface ParsedChapter {
  title: string;
  content: string;
  /** 所属卷在 volumes 数组中的下标；永远 ≥ 0（兜底时指向默认卷） */
  volumeIndex: number;
  /** 是否为「识别出标题」的真实章节；false = 卷首语 / 全文兜底章 */
  explicit: boolean;
}

/** 单卷解析结果 */
export interface ParsedVolume {
  name: string;
}

/** 整本书的解析结果 */
export interface ParsedBook {
  volumes: ParsedVolume[];
  chapters: ParsedChapter[];
  /** 是否真正识别出了章节标题结构（false = 全文作为一章兜底） */
  structured: boolean;
  /**
   * 从章节标题统计出的序号规则（1.34.0）；识别不出返回 null。
   * 落库时写入该书的序号规则记录，让「章节后缀」设置自适应本书。
   */
  numberingRule: DetectedNumbering | null;
}

/** 默认卷名：章节出现在任何卷标记之前时挂到这里 */
export const DEFAULT_VOLUME_NAME = "正文";

/** 单章正文上限（字符）：防止某章因漏识别标题而吞下整本书 */
const MAX_CHAPTER_CHARS = 500_000;

/** 标题行前缀的空白与特殊符号在入库前清理 */
function normalizeTitle(line: string): string {
  return line.trim().replace(/[\s\u3000]+/g, " ").slice(0, 120);
}

/** 判断是否为卷标题行 */
export function isVolumeTitle(line: string): boolean {
  if (META_LINE_RE.test(line)) return false;
  return VOLUME_TITLE_RE.test(line);
}

/** 判断是否为章节标题行（卷标题不算章） */
export function isChapterTitle(line: string): boolean {
  if (META_LINE_RE.test(line)) return false;
  if (VOLUME_TITLE_RE.test(line)) return false;
  return CHAPTER_TITLE_RE.test(line);
}

/**
 * 统计正文字数：忽略空白字符（N-07 口径统一）。
 *
 * 原实现 `text.replace(/\s/g, "").length` 数的是 **UTF-16 码元**，含星平面字符
 * （emoji、CJK 扩展 B 区）时会比编辑器的 **码点** 口径多算 —— 导入章字数与编辑器
 * 显示对不上。现统一走 `@/shared/novel/word-count`（与编辑器同一实现、同一口径）。
 * 保留本函数名与签名，调用方（import-service / import.worker）零改动。
 */
export function countWords(text: string): number {
  return countWordsShared(text, "withPunctuation");
}

/**
 * 主解析函数：TXT 全文 → 卷 / 章结构。
 *
 * 规则：
 * - 逐行扫描，遇卷标题 → 开新卷（记住当前卷下标），并结束上一章的收集
 * - 遇章标题 → 开新章，归属当前卷（无卷则落默认卷「正文」）
 * - 其余行 → 追加到当前章正文
 * - 卷已开但还没遇到章标题时，先出现的正文行 → 开一个「<卷名> · 序」章兜底
 * - 相邻两行完全相同的标题 → 第二行视作排版冗余跳过
 * - 无任何**真实**章标题 → `structured: false`，全文作为单章返回
 */
export function parseTxtBook(text: string): ParsedBook {
  // 统一换行符
  const rawLines = text.split(/\r\n|\r|\n/);

  const volumes: ParsedVolume[] = [];
  const chapters: ParsedChapter[] = [];
  /** 与 chapters 同下标的正文累积缓冲（避免反复字符串拼接 + 便于最终 trim） */
  const buffers: string[] = [];

  /** 当前卷下标；-1 = 尚未遇到卷标记 */
  let currentVolume = -1;
  /** 当前章下标；-1 = 尚未开章 */
  let currentChapter = -1;
  /** 上一个被识别的标题行（折叠相邻重复标题）；存**原始行**而非剥后的章名 */
  let lastTitle = "";
  /** 是否识别到过「真实章标题」（决定 structured） */
  let sawExplicitChapter = false;
  /** 识别出的原始标题行（未剥序号）：供 detectChapterNumbering 统计全书规则 */
  const rawTitleLines: string[] = [];
  /**
   * 卷标记出现前开的兜底章下标（书名 / 作者 / 引文）。
   * 首个真实卷出现时把它**归并**过去（改名「<卷名> · 序」并把默认卷删掉），
   * 否则书架上会多出一个只装书名的「正文」空卷 —— 那是噪音不是结构。
   */
  let preambleChapter: number | null = null;

  const ensureVolume = (): number => {
    if (currentVolume >= 0) return currentVolume;
    volumes.push({ name: DEFAULT_VOLUME_NAME });
    currentVolume = volumes.length - 1;
    return currentVolume;
  };

  /**
   * 开一章。`dedupeKey` 是「相邻重复标题折叠」的比较依据 —— 传**原始行**：
   * 标题剥掉序号后多个不同的原始行会得到同一个空串（第N章无章名），
   * 拿剥后的章名比会误折叠（详见调用处注释）。
   */
  const openChapter = (title: string, explicit: boolean, dedupeKey: string): void => {
    const volumeIndex = ensureVolume();
    chapters.push({ title, content: "", volumeIndex, explicit });
    buffers.push("");
    currentChapter = chapters.length - 1;
    lastTitle = dedupeKey;
  };

  for (const raw of rawLines) {
    // ① 卷标题
    if (isVolumeTitle(raw)) {
      const name = normalizeTitle(raw);
      if (volumes[currentVolume]?.name === name) {
        // 相邻同名卷折叠
        lastTitle = name;
        continue;
      }
      volumes.push({ name });
      currentVolume = volumes.length - 1;

      // 卷标记前攒下的前言：并入这个真实卷，并抹掉临时默认卷
      if (preambleChapter !== null && currentChapter === preambleChapter) {
        const chapter = chapters[preambleChapter];
        chapter.title = `${name} · 序`;
        chapter.volumeIndex = currentVolume;
        preambleChapter = null;
      }
      // 开新卷后必须关闭当前章：否则上一卷的最后一章会被续写
      currentChapter = -1;
      lastTitle = name;
      continue;
    }

    // ② 章标题
    if (isChapterTitle(raw)) {
      // 序号进左栏序号列，不进标题：剥掉「第N章 」只留章名（1.34.0）
      const title = stripChapterNumbering(normalizeTitle(raw));
      // ⚠️ 折叠判据必须是**原始行**，不能是剥后的 title：多章都叫「第N章」
      // （无章名）时剥完全是空串，拿空串比会把后面每一章都当成「相邻重复」丢掉。
      const normalizedRaw = normalizeTitle(raw);
      if (normalizedRaw === lastTitle) continue; // 相邻重复标题折叠
      rawTitleLines.push(raw);
      openChapter(title, true, normalizedRaw);
      sawExplicitChapter = true;
      preambleChapter = null;
      continue;
    }

    // ③ 正文行
    if (currentChapter < 0) {
      // 还没有任何章可挂：先开兜底章（卷首语 / 全文开头散文）
      if (!raw.trim()) continue; // 开头空行丢弃
      // ⚠️ 必须在 openChapter 之前判：ensureVolume 会把 currentVolume 从 -1 抬到 0
      const beforeAnyVolume = currentVolume < 0;
      const fallbackTitle =
        currentVolume >= 0
          ? `${volumes[currentVolume].name} · 序`
          : `${DEFAULT_VOLUME_NAME} · 序`;
      openChapter(fallbackTitle, false, fallbackTitle);
      // 记下「卷标记前的前言章」，供首个真实卷出现时归并
      if (beforeAnyVolume) preambleChapter = currentChapter;
    }

    const bucket = buffers[currentChapter];
    if (bucket.length < MAX_CHAPTER_CHARS) {
      buffers[currentChapter] = bucket.length === 0 ? raw : `${bucket}\n${raw}`;
    }
  }

  // 前言章已并入真实卷：把中间那个临时默认卷挤掉（它只装前言）
  if (preambleChapter === null) {
    const referenced = new Set(chapters.map((chapter) => chapter.volumeIndex));
    if (volumes.length > 1 && !referenced.has(0) && volumes[0].name === DEFAULT_VOLUME_NAME) {
      volumes.shift();
      for (const chapter of chapters) chapter.volumeIndex -= 1;
    }
  }

  // 正文回填 + 丢掉无内容的兜底章（只有卷标记、没有正文的情形）
  const resultChapters: ParsedChapter[] = [];
  const indexMap = new Map<number, number>();
  for (let index = 0; index < chapters.length; index += 1) {
    const content = buffers[index].trim();
    const chapter = chapters[index];
    if (!chapter.explicit && !content) continue; // 空的兜底章丢弃
    indexMap.set(index, resultChapters.length);
    resultChapters.push({ ...chapter, content });
  }

  // 卷下标重映射（丢弃兜底章不改变卷数量，但保险起见统一走映射）
  for (const chapter of resultChapters) {
    chapter.volumeIndex = indexMap.has(chapter.volumeIndex)
      ? chapter.volumeIndex
      : Math.min(chapter.volumeIndex, volumes.length - 1);
  }

  if (!sawExplicitChapter || resultChapters.length === 0) {
    // 没识别出章结构：整本兜底成一章，仍保留默认卷
    const whole = text.trim();
    return {
      volumes: [{ name: DEFAULT_VOLUME_NAME }],
      chapters: [
        {
          title: DEFAULT_VOLUME_NAME,
          content: whole.slice(0, MAX_CHAPTER_CHARS),
          volumeIndex: 0,
          explicit: false,
        },
      ],
      structured: false,
      numberingRule: null,
    };
  }

  return {
    volumes,
    chapters: resultChapters,
    structured: true,
    numberingRule: detectChapterNumbering(rawTitleLines),
  };
}
