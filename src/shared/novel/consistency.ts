/**
 * 一致性校对（R-AI-10a）· 纯本地规则版
 *
 * 解决的是「人工做不到、读者一眼看见」的那类事故：
 * - 第 12 章主角叫「李玄」，第 30 章写成「李元」；
 * - 正文写了「金丹后期」，境界阶梯里只有「金丹」这一档、也没登记该别名。
 *
 * 为什么必须是**纯本地**（零 token、零授权）：
 * 1. 它是「AI 不可用时也有价值」的证明（B6 判据①）——不配置 AI 也能跑；
 * 2. 它给出的误报基线，是 10b（AI 档）收敛口径的依据；
 * 3. 人名 / 境界都有**明确比对基准**（要素卡与境界阶梯），本来就不需要推理。
 *
 * 边界：本文件不含 React、不碰 IPC、不读 store，只有纯函数 + 一个可增量喂章的
 * 扫描器。分片让出由调用方（store）负责——这里是同步的，才能被单测直接量性能。
 * 中文分词 / 拼音表一律不引入（路线图 §五 纪律 2：不许新增 production 依赖）。
 */
import type { EntityType } from "./entity-model";

/** 问题类型 */
export type ConsistencyKind = "name-near-miss" | "realm-variant";

/** 置信度：sure = 几乎必错（确定）；suspect = 需要人看一眼（疑似） */
export type ConsistencySeverity = "sure" | "suspect";

/** 参与比对的一张要素卡（只取校对需要的字段） */
export interface ConsistencyEntityInput {
  id: string;
  name: string;
  type: EntityType;
  aliases: string[];
}

/** 境界阶梯的一档（名称 + 别名；别名是「写作里出现也算引用本阶」的写法） */
export interface ConsistencyLevelInput {
  name: string;
  aliases: string[];
}

/** 待扫描章节 */
export interface ConsistencyChapterInput {
  id: string;
  title: string;
  content: string;
}

/** 一条校对结果 */
export interface ConsistencyIssue {
  /** 稳定 id：同类同写法同期望 → 同一个 id（列表 key / 未来「忽略此项」的键） */
  id: string;
  kind: ConsistencyKind;
  severity: ConsistencySeverity;
  chapterId: string;
  chapterTitle: string;
  /** 正文里实际写的样子 */
  found: string;
  /** 正确的写法（卡名 / 境界名） */
  expected: string;
  /** 人的可读标签（如「人物：李玄」） */
  expectedLabel: string;
  /** 全书命中次数（同名同写法跨章合计，用于判断「像不像错字」） */
  count: number;
  /** 首次命中的章内偏移（跳转定位用） */
  from: number;
  /** 证据句（命中前后各留一小段上下文） */
  evidence: string;
  /** 建议动作（人话，不替用户做决定） */
  suggestion: string;
}

/** 构建好的比对索引（一次构建，整本复用） */
export interface ConsistencyIndex {
  /** 词条字面 → 拥有它的卡（同一字面可能被多张卡共享，例如共用的别名） */
  exact: Map<string, Array<{ entityId: string; label: string; type: EntityType }>>;
  /** 需要尝试的词长（升序，只含真实存在的长度） */
  lens: number[];
  /** 任一卡名的首字：近似命中**必然**首字或尾字相同（见 scanChapter 注释） */
  firstChars: Set<string>;
  /** 任一卡名的尾字 */
  lastChars: Set<string>;
  /** 删一字变体 → 期望词条（对称删除索引，见 scanChapter 注释） */
  variants: Map<string, string[]>;
  /** 长词的真子串：这些片段不该被当成「近似的错名」 */
  blocked: Set<string>;
  /** 境界基名（档位名 + 别名） */
  realmBases: Array<{ base: string; levelName: string }>;
  /** 境界分类里所有已登记的写法（档位名 + 全部别名），成员判定用 */
  realmRegistered: Set<string>;
}

/** 单章的原始扫描结果（未做全书阈值过滤） */
export interface ChapterScanResult {
  /** 名近似命中：同一对（写法 → 期望）在同章只出一条，`count` 是章内出现次数 */
  nameHits: Array<{ found: string; expected: string; from: number; count: number }>;
  /** 境界未登记写法 */
  realmHits: Array<{
    found: string;
    base: string;
    levelName: string;
    from: number;
    count: number;
  }>;
  /** 本章里各「期望词」的精确出现次数（判断「这个名字在书里站不站得住」） */
  termCounts: Map<string, number>;
}

/** 最短 / 最长参与比对的词长：1 字词几乎全是常用字（噪声），7 字以上不是名字 */
const MIN_TERM_LEN = 2;
const MAX_TERM_LEN = 6;

/**
 * 一个名字在书里出现多少次，才值得为它做近似比对。
 *
 * 只出现一两次的名字本来就可能是笔误或路人，把它当基准会把噪声放大成
 * 「满屏疑似」；3 次是「作者确实在反复用这个名字」的最低门槛。
 */
const MIN_EXPECTED_COUNT = 3;

/**
 * 「疑似写错」的频率上限：近似写法必须**明显少于**正确写法。
 *
 * 真实错字是少数派（50 次正确里混 1~3 次写错）；而两个真不同的同姓角色
 * （「李玄」50 次 + 「李四」20 次）频率接近，靠这一条就能压掉。
 * `RARITY_FLOOR` 是给小样本留的余量：正确写法只出现 3 次时按比例算只允许
 * 0.9 次，等于「第一个错字都报不出来」——而重复写错恰恰是最该抓的形态。
 */
const RARITY_RATIO = 0.3;
const RARITY_FLOOR = 2;

/**
 * 同一个正确名能容忍「多少种不同写法」才算错字。
 *
 * 2.15.0 实机跑真书（《惊悚世界》几十万字）时误报率极高，样本一眼就能归类：
 * `布偶` 被抓成 `布游`/`布控`/`布鬼`/`布身`/`布家`/`布间`/…（16 种），
 * `恐怖屋` 被抓成 `恐怖了`/`恐怖感`/`恐怖和`/`恐怖吗`/…（10 种），
 * `陈歌` 被抓成 `陈医`/`陈育`/`陈列`（3 种）。
 *
 * 共同点是：**同一个名字同时冒出多种「错法」**——真错字几乎不会这样，
 * 手滑是**同一种错法反复出现**（`李元` 出现 2~10 次，写法始终是那一个）。
 * 冒出多种写法的唯一解释是：这个名字的首/尾字本身是高频字，正文里到处
 * 都是「它 + 另一个常用字」的正常词（布控、陈列、恐怖了），逐个比对必然
 * 命中。所以**按名字整体判定**：写法种数到了 3，说明该名是碎片源，整组丢弃。
 *
 * 代价（明确接受）：作者真把同一个名字写成三种不同错法时会被漏掉。
 * 这是刻意的取舍——10a 的价值在信噪比，漏报由 10b（AI 档）兜底；
 * 反过来「满屏 99 条全错」会让作者永久关掉面板，连真错字也看不见。
 */
const FRAGMENT_SOURCE_VARIANTS = 3;

/**
 * 数字/序数字符。
 *
 * `第二病栋` 与 `第三病栋` 是**两个真实存在的地点**，差一个数字不可能是手滑
 * 结果——作者真要写错，错的是别的字。这类替换一律不报。
 */
const NUMERAL_CHARS = new Set("零〇一二三四五六七八九十百千万亿两0123456789".split(""));

/** 单次扫描最多返回多少条（列表是给人看的，不是给机器统计的） */
const MAX_ISSUES = 200;

/** 境界建议类最多返回多少条（这类只是「建议登记别名」，量大了就成噪音） */
const MAX_REALM_ISSUES = 30;

/** 证据句前后各留多少字 */
const EVIDENCE_PAD = 14;

/** 纯汉字窗口判定：跨标点 / 数字 / 拉丁字母的窗口不是名字 */
const HAN_ONLY = /^[\u4e00-\u9fff]+$/;

/**
 * 境界档位的「写法尾巴」。
 *
 * 只认这些后缀，是因为「金丹后期」「元婴巅峰」这类是作者的**常规写法**，
 * 而不是任意接字——否则「金丹」后面跟任何字都会被报成境界问题。
 * 长后缀排在前面（「大圆满」必须先于「圆满」命中）。
 */
const REALM_SUFFIXES = [
  "大圆满",
  "圆满",
  "巅峰",
  "初期",
  "中期",
  "后期",
  "前期",
  "之上",
  "之下",
  "期",
  "境",
  "阶",
  "层",
  "重",
  "级",
  "段",
] as const;

/** 内置六类的中文标签（用于「人物：李玄」这种可读标签） */
const TYPE_LABELS: Record<string, string> = {
  character: "人物",
  location: "地点",
  faction: "势力",
  item: "物品",
  level_system: "境界体系",
  custom: "其他",
};

/** 类型的中文标签；自建类型原样返回（与 collector.entityTypeLabel 同口径） */
export function consistencyTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

/** 去掉一个字符（生成删除变体） */
function dropChar(text: string, at: number): string {
  return text.slice(0, at) + text.slice(at + 1);
}

/**
 * 构建比对索引。
 *
 * 近似判定用**对称删除索引**（SymSpell 思路）：两个等长词若只差一个字，
 * 那么「各自删掉那一个字」得到的是同一个串。于是把每张卡的每个删一字变体
 * 登记一次，扫描时把窗口的删一字变体拿去查表即可，不必对每个窗口跑一遍
 * 全部卡名的编辑距离（那是 n×m 的灾难）。
 */
export function buildConsistencyIndex(params: {
  entities: ConsistencyEntityInput[];
  realmLevels: ConsistencyLevelInput[];
}): ConsistencyIndex {
  const exact = new Map<
    string,
    Array<{ entityId: string; label: string; type: EntityType }>
  >();
  const firstChars = new Set<string>();
  const lastChars = new Set<string>();
  const lenSet = new Set<number>();
  const allTerms: string[] = [];

  for (const entity of params.entities) {
    const name = entity.name?.trim();
    if (!name) continue;
    const candidates = [name, ...(entity.aliases ?? []).map((a) => a?.trim())].filter(
      (item): item is string => Boolean(item),
    );
    for (const term of candidates) {
      if (term.length < MIN_TERM_LEN || term.length > MAX_TERM_LEN) continue;
      if (!HAN_ONLY.test(term)) continue;
      const owners = exact.get(term);
      const owner = { entityId: entity.id, label: name, type: entity.type };
      if (owners) {
        // 同一字面被两张卡共用（例如两人共用一个称号）：都记，报告时取第一张
        if (!owners.some((item) => item.entityId === owner.entityId)) owners.push(owner);
      } else {
        exact.set(term, [owner]);
        allTerms.push(term);
      }
      firstChars.add(term[0]);
      lastChars.add(term[term.length - 1]);
      lenSet.add(term.length);
    }
  }

  const variants = new Map<string, string[]>();
  for (const term of allTerms) {
    for (let at = 0; at < term.length; at += 1) {
      const key = dropChar(term, at);
      const bucket = variants.get(key);
      if (bucket) {
        if (!bucket.includes(term)) bucket.push(term);
      } else {
        variants.set(key, [term]);
      }
    }
  }

  // 长词的真子串：正文里的「青云」不可能是「青云山」的错写，它是它的片段
  const blocked = new Set<string>();
  for (const term of allTerms) {
    if (term.length <= MIN_TERM_LEN) continue;
    for (let from = 0; from < term.length; from += 1) {
      for (let len = MIN_TERM_LEN; len < term.length; len += 1) {
        const piece = term.slice(from, from + len);
        if (piece.length === len && piece !== term) blocked.add(piece);
      }
    }
  }

  const realmBases: Array<{ base: string; levelName: string }> = [];
  const realmRegistered = new Set<string>();
  for (const level of params.realmLevels) {
    const name = level.name?.trim();
    if (!name) continue;
    realmRegistered.add(name);
    realmBases.push({ base: name, levelName: name });
    for (const alias of level.aliases ?? []) {
      const trimmed = alias?.trim();
      if (!trimmed) continue;
      realmRegistered.add(trimmed);
      realmBases.push({ base: trimmed, levelName: name });
    }
  }
  // 长的基名先试：「金丹大圆满」是基名时不该先命中「金丹」再报后缀「大圆满」
  realmBases.sort((a, b) => b.base.length - a.base.length);

  return {
    exact,
    lens: Array.from(lenSet).sort((a, b) => a - b),
    firstChars,
    lastChars,
    variants,
    blocked,
    realmBases,
    realmRegistered,
  };
}

/** 证据句：把命中位置前后各取一小段，压成单行 */
function buildEvidence(text: string, from: number, to: number): string {
  const start = Math.max(0, from - EVIDENCE_PAD);
  const end = Math.min(text.length, to + EVIDENCE_PAD);
  return text
    .slice(start, end)
    .replace(/[\r\n]+/g, " ")
    .trim();
}

/**
 * 扫一章（同步，纯函数语义 —— 只读索引，结果返回给调用方累计）。
 *
 * 两趟：
 * 1. **精确趟**：按位置从长到短试词长，命中已知词条就整段吃掉（记次数、
 *    标记区间）。先吃掉精确命中，才不会把「李玄」的「李玄」当成「李玄之」的近似。
 * 2. **近似趟**：只在未被精确命中覆盖的位置上试。窗口必须**首字或尾字**
 *    出现在卡名首/尾字集合里——两个等长词若只差一个字，不同的那个字要么
 *    不在首位（首字必然相同）、要么在首位（尾字必然相同），所以这是**零漏判**
 *    的必要条件，把绝大部分位置挡在一次 Set 查询上。
 */
export function scanChapterForConsistency(
  index: ConsistencyIndex,
  chapter: ConsistencyChapterInput,
): ChapterScanResult {
  const text = chapter.content ?? "";
  const result: ChapterScanResult = {
    nameHits: [],
    realmHits: [],
    termCounts: new Map(),
  };
  if (!text) return result;

  const { lens, exact, firstChars, lastChars, variants, blocked } = index;
  if (lens.length === 0) {
    scanRealmVariants(index, text, result);
    return result;
  }
  const taken = new Uint8Array(text.length);
  /**
   * 本章内同一对（写法 → 期望）聚合成一条，只记**首次**偏移。
   *
   * 不能按「发现即去重」：那样同一章的重复写错只算 1 次，全书频率判据
   * 会被章节数稀释，10 章里写错 10 次也只算 10 —— 与「真实出现次数」
   * 不一致，阈值就失去意义。
   */
  const pairCounts = new Map<string, { found: string; expected: string; from: number; count: number }>();

  for (let i = 0; i < text.length; i += 1) {
    if (taken[i]) continue;
    // 长词优先：避免「青云」吃掉「青云山」
    for (let k = lens.length - 1; k >= 0; k -= 1) {
      const len = lens[k];
      if (i + len > text.length) continue;
      const window = text.slice(i, i + len);
      if (!exact.has(window)) continue;
      const count = result.termCounts.get(window) ?? 0;
      result.termCounts.set(window, count + 1);
      for (let step = 0; step < len; step += 1) taken[i + step] = 1;
      i += len - 1;
      break;
    }
  }

  for (let i = 0; i < text.length; i += 1) {
    if (taken[i]) continue;
    for (let k = 0; k < lens.length; k += 1) {
      const len = lens[k];
      if (i + len > text.length) continue;
      const window = text.slice(i, i + len);
      if (!HAN_ONLY.test(window)) continue;
      if (exact.has(window) || blocked.has(window)) continue;
      // 零漏判前置过滤（见函数注释）：两个等长词只差一字时，首字或尾字必然相同
      if (!firstChars.has(window[0]) && !lastChars.has(window[len - 1])) continue;
      // 窗口压到已精确命中的区间：它只是某个已知词的一部分，不是「近似的错名」
      let overlapped = false;
      for (let step = 1; step < len; step += 1) {
        if (taken[i + step]) {
          overlapped = true;
          break;
        }
      }
      if (overlapped) continue;

      for (let at = 0; at < len; at += 1) {
        const pool = variants.get(dropChar(window, at));
        if (!pool) continue;
        for (const expected of pool) {
          if (expected.length !== len) continue;
          // 删同一位置得同一串 ⇒ 恰好只差一个字（差两个字的不是错字）
          if (!differsByOne(window, expected)) continue;
          const pair = `${window}\u0000${expected}`;
          const existing = pairCounts.get(pair);
          if (existing) {
            existing.count += 1;
            continue;
          }
          pairCounts.set(pair, { found: window, expected, from: i, count: 1 });
        }
      }
    }
  }

  for (const item of pairCounts.values()) result.nameHits.push(item);

  scanRealmVariants(index, text, result);
  return result;
}

/** 两个等长串是否恰好差一个字符 */
function differsByOne(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      diff += 1;
      if (diff > 1) return false;
    }
  }
  return diff === 1;
}

/**
 * 两个等长串是否只是「数字对数字」的一处替换（第二病栋 / 第三病栋）。
 *
 * 只在一处不同、且两字都在 `NUMERAL_CHARS` 里才算——`两年` vs `两天` 不在此列。
 */
function differsOnlyByNumeral(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let at = -1;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      if (at !== -1) return false;
      at = i;
    }
  }
  return at !== -1 && NUMERAL_CHARS.has(a[at]) && NUMERAL_CHARS.has(b[at]);
}

/**
 * 境界未登记写法：正文出现「档位名 + 常规后缀」，但这个完整写法没登记为别名。
 *
 * 这**不是错误**，是「体系与正文脱节」的信号：作者习惯写「金丹后期」，
 * 而阶梯只登记了「金丹」，于是后续所有按档位统计 / 高亮的功能都认不出它。
 * 建议动作就是把这句加进别名，而不是让作者去改正文。
 */
function scanRealmVariants(
  index: ConsistencyIndex,
  text: string,
  result: ChapterScanResult,
): void {
  const { realmBases, realmRegistered } = index;
  if (realmBases.length === 0) return;

  /** 同一写法在章内合并，只留首次偏移（与名近似同口径） */
  const counts = new Map<string, { found: string; base: string; levelName: string; from: number; count: number }>();

  for (const { base, levelName } of realmBases) {
    let at = text.indexOf(base);
    while (at !== -1) {
      const after = text.slice(at + base.length, at + base.length + 4);
      const suffix = REALM_SUFFIXES.find((item) => after.startsWith(item));
      if (suffix) {
        const full = base + suffix;
        if (!realmRegistered.has(full)) {
          const existing = counts.get(full);
          if (existing) existing.count += 1;
          else counts.set(full, { found: full, base, levelName, from: at, count: 1 });
        }
      }
      at = text.indexOf(base, at + base.length);
    }
  }

  for (const item of counts.values()) result.realmHits.push(item);
}

/** 扫描器：逐章喂入，最后 finalize 出全书结果 */
export interface ConsistencyScanner {
  /** 扫一章并累计（返回本章结果，调用方通常只用来显示进度） */
  scanChapter: (chapter: ConsistencyChapterInput) => ChapterScanResult;
  /** 全书汇总：阈值过滤 + 去重 + 排序，产出可直接渲染的问题列表 */
  finalize: () => ConsistencyIssue[];
  /** 已扫章数 */
  readonly scanned: number;
}

/** 扫描器内部累计的原始数据 */
interface RawAccumulator {
  /** 写法 → 期望（同一对出现可能跨多章）；hits 按章各一条，`count` 是该章内出现次数 */
  nameHits: Map<
    string,
    {
      found: string;
      expected: string;
      hits: Array<{
        chapterId: string;
        chapterTitle: string;
        from: number;
        evidence: string;
        count: number;
      }>;
    }
  >;
  realmHits: Map<
    string,
    {
      found: string;
      levelName: string;
      base: string;
      hits: Array<{
        chapterId: string;
        chapterTitle: string;
        from: number;
        evidence: string;
        count: number;
      }>;
    }
  >;
  termCounts: Map<string, number>;
}

/**
 * 创建扫描器。
 *
 * 把「逐章扫」与「全书阈值判定」分开，是因为两个判据都需要**全书视角**：
 * 「这个名字在书里站得住吗」「这个写法是不是少数派」都算不出来单章内的结论。
 */
export function createConsistencyScanner(params: {
  entities: ConsistencyEntityInput[];
  realmLevels: ConsistencyLevelInput[];
}): ConsistencyScanner {
  const index = buildConsistencyIndex(params);
  const acc: RawAccumulator = {
    nameHits: new Map(),
    realmHits: new Map(),
    termCounts: new Map(),
  };
  let scanned = 0;

  return {
    get scanned() {
      return scanned;
    },

    scanChapter(chapter) {
      const result = scanChapterForConsistency(index, chapter);
      scanned += 1;

      for (const [term, count] of result.termCounts) {
        acc.termCounts.set(term, (acc.termCounts.get(term) ?? 0) + count);
      }

      for (const hit of result.nameHits) {
        const key = `${hit.found}\u0000${hit.expected}`;
        const bucket =
          acc.nameHits.get(key) ??
          (() => {
            const fresh = { found: hit.found, expected: hit.expected, hits: [] };
            acc.nameHits.set(key, fresh);
            return fresh;
          })();
        bucket.hits.push({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          from: hit.from,
          evidence: buildEvidence(chapter.content, hit.from, hit.from + hit.found.length),
          count: hit.count,
        });
      }

      for (const hit of result.realmHits) {
        const key = `${hit.found}\u0000${hit.base}`;
        const bucket =
          acc.realmHits.get(key) ??
          (() => {
            const fresh = {
              found: hit.found,
              levelName: hit.levelName,
              base: hit.base,
              hits: [],
            };
            acc.realmHits.set(key, fresh);
            return fresh;
          })();
        bucket.hits.push({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          from: hit.from,
          evidence: buildEvidence(chapter.content, hit.from, hit.from + hit.found.length),
          count: hit.count,
        });
      }

      return result;
    },

    finalize() {
      const issues: ConsistencyIssue[] = [];

      /*
       * 先按「正确名」聚合出**它一共有多少种不同写法**。
       *
       * 这一步必须在逐条判定之前做完：单条看上去都像错字（`布控` 只差一字、
       * 出现 7 次、远少于 `布偶` 的 150 次），只有把同一名字的全部写法摆在一起，
       * 「这是高频字碎片」才暴露出来（见 FRAGMENT_SOURCE_VARIANTS 注释）。
       */
      const foundByExpected = new Map<string, Set<string>>();
      for (const bucket of acc.nameHits.values()) {
        let set = foundByExpected.get(bucket.expected);
        if (!set) {
          set = new Set<string>();
          foundByExpected.set(bucket.expected, set);
        }
        set.add(bucket.found);
      }

      for (const bucket of acc.nameHits.values()) {
        const expectedCount = acc.termCounts.get(bucket.expected) ?? 0;
        const occurrences = bucket.hits.reduce((sum, item) => sum + item.count, 0);
        const variants = foundByExpected.get(bucket.expected)?.size ?? 0;
        if (expectedCount < MIN_EXPECTED_COUNT) continue;
        // 数字对数字的替换是两个真名（第二病栋 / 第三病栋），不是手滑
        if (differsOnlyByNumeral(bucket.found, bucket.expected)) continue;
        // 同一名字有 3 种以上写法 ⇒ 该名首/尾字是高频字，整组都是词内碎片
        if (variants >= FRAGMENT_SOURCE_VARIANTS) continue;
        // 近似写法必须是少数派：出现得比正确写法还多，说明它是另一个真人真物
        if (occurrences > Math.max(RARITY_FLOOR, expectedCount * RARITY_RATIO)) continue;

        const owner = index.exact.get(bucket.expected)?.[0];
        const sameHead = bucket.found[0] === bucket.expected[0];
        /*
         * 「确定」的完整含义 = 同一个名字**只有这一种**错法，且它反复出现。
         * 一旦冒出两种写法（陈医 / 陈列），更可能是词内碎片而非手滑，
         * 此时降为「疑似」——仍给作者看，但不再替他定罪。
         */
        const severity: ConsistencySeverity =
          sameHead && occurrences >= 2 && variants === 1 ? "sure" : "suspect";
        const first = bucket.hits[0];
        issues.push({
          id: `name:${bucket.expected}:${bucket.found}`,
          kind: "name-near-miss",
          severity,
          chapterId: first.chapterId,
          chapterTitle: first.chapterTitle,
          found: bucket.found,
          expected: bucket.expected,
          expectedLabel: owner
            ? `${consistencyTypeLabel(owner.type)}：${owner.label}`
            : bucket.expected,
          count: occurrences,
          from: first.from,
          evidence: first.evidence,
          suggestion: `正文写了「${bucket.found}」，卡片是「${bucket.expected}」。确认是写错就改，是另一种称呼就加进「${bucket.expected}」的别名。`,
        });
      }

      for (const bucket of acc.realmHits.values()) {
        const occurrences = bucket.hits.reduce((sum, item) => sum + item.count, 0);
        // 只出现一次的多半是偶发写法，不值得占一条；两次起才是「作者的常用说法」
        if (occurrences < 2) continue;
        const first = bucket.hits[0];
        issues.push({
          id: `realm:${bucket.base}:${bucket.found}`,
          kind: "realm-variant",
          severity: "suspect",
          chapterId: first.chapterId,
          chapterTitle: first.chapterTitle,
          found: bucket.found,
          expected: bucket.base,
          expectedLabel: `境界：${bucket.levelName}`,
          count: occurrences,
          from: first.from,
          evidence: first.evidence,
          suggestion: `「${bucket.found}」不在境界体系里。若是常用写法，把它加为「${bucket.base}」的别名，此后档位统计与标注才认得出。`,
        });
      }

      const realmIssues = issues
        .filter((item) => item.kind === "realm-variant")
        .sort((a, b) => b.count - a.count)
        .slice(0, MAX_REALM_ISSUES);
      const nameIssues = issues
        .filter((item) => item.kind === "name-near-miss")
        .sort(
          (a, b) =>
            (a.severity === b.severity ? 0 : a.severity === "sure" ? -1 : 1) ||
            b.count - a.count,
        )
        .slice(0, MAX_ISSUES);

      return [...nameIssues, ...realmIssues];
    },
  };
}
