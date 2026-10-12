/**
 * 小说设定模块的领域纯函数
 *
 * 这里只做**不碰 IO 的推演**，主进程与 UI 共用同一套口径：
 * - 进位示例文案（「引气 一层 → … → 筑基 一层」）
 * - 插入 / 删除后的 rank 重排
 * - 拆分 / 合并的层段计算
 * - 正文一致性扫描
 *
 * 之所以独立成文件：这些规则是产品口径，散在组件里就会各写一份；
 * 且它们必须能被单测覆盖 —— UI 上的拖拽很难测，纯函数很容易测。
 */
import type {
  CarryDirection,
  SettingCategory,
  SettingLevel,
} from "../types";

/** 小层命名模板的占位符 */
const SUB_PATTERN_TOKEN = "{n}";

/** 固定名单的分隔符：顿号 / 中英文逗号都认（「初期,中期,后期,圆满」） */
const SUB_PATTERN_LIST_SEPARATOR = /[、,，]/;

/**
 * 按模板渲染小层名
 *
 * 三种模板形态，按顺序判定：
 * 1. **固定名单**（含顿号或逗号）：「初期,中期,后期,圆满」按序取第 index 个，
 *    名单不够长时回退「第 n 层」—— 绝不渲染出同名的两个小层；
 * 2. **{n} 模板**：「第{n}层」把 `{n}` 换成层号；
 * 3. **纯文本**：直接补层号后缀，避免出现同名的多个小层。
 */
export function formatSubLevel(subPattern: string, index: number): string {
  const pattern = subPattern.trim();
  if (pattern && SUB_PATTERN_LIST_SEPARATOR.test(pattern)) {
    const names = pattern
      .split(SUB_PATTERN_LIST_SEPARATOR)
      .map((item) => item.trim())
      .filter(Boolean);
    const fixed = names[index - 1];
    return fixed || `第${index}层`;
  }
  if (pattern.includes(SUB_PATTERN_TOKEN)) {
    return pattern.replace(SUB_PATTERN_TOKEN, String(index));
  }
  return pattern ? `${pattern}${index}` : `第${index}层`;
}

/**
 * 本阶生效的小层命名模板：自己的为空就沿用分类的
 *
 * subPattern 下放到每阶之后，这是唯一合法的读取口 —— 各处直接拼
 * `level.subPattern || category.subPattern` 会漏掉 trim，且口径散落。
 */
export function effectiveSubPattern(
  level: SettingLevel,
  category: SettingCategory,
): string {
  const own = level.subPattern.trim();
  return own || category.subPattern;
}

/**
 * 某一阶的**全部小境界名**（1.38.0）
 *
 * 「设了练气九层，但界面上只有「练气」一行」的根本原因：`subLevels` 此前
 * 只是一个存在于进位示例文案里的数字，没有任何一处把它渲染出来。本函数是
 * 唯一把「阶」展开成「小层清单」的口径 —— 设定中心的行内小层条、行囊换算
 * 都从这里取，避免各写一份。
 *
 * 上限 `cap`：默认 30（拆分上限，一阶最多 30 段）；阶数很大时不需要渲染
 * 整份名单，调用方可传更小的值。
 */
export function listSubLevels(
  level: SettingLevel,
  category: SettingCategory,
  cap = 30,
): string[] {
  const total = Math.max(1, Math.min(cap, Math.floor(level.subLevels) || 1));
  const pattern = effectiveSubPattern(level, category);
  const names: string[] = [];
  for (let index = 1; index <= total; index += 1) {
    names.push(formatSubLevel(pattern, index));
  }
  return names;
}

/**
 * 小境界总数（只算真正的「阶」）
 *
 * 派生段（`parentId` 非空）是拆分的产物，它与父阶共享同一个小层区间，
 * 不能重复计数 —— 否则「共 N 小境界」在拆过一次之后会翻倍。
 * 拆分后父阶的 `segTo` 只覆盖第一段（如 1–4，但整阶是 9 层），所以取
 * 「父阶 + 它的全部派生段」里**最大的 segTo**，才等于该阶原本的小层总数。
 */
export function countSubLevels(levels: SettingLevel[]): number {
  const roots = levels.filter((level) => !level.parentId);
  if (roots.length === 0) return 0;
  return roots.reduce((sum, root) => {
    let total = root.subLevels;
    for (const level of levels) {
      if (level.parentId !== root.id) continue;
      // 派生段标着它占据的 [segFrom, segTo]；整阶容量就是任一段的最大层号
      if (level.segTo !== null) total = Math.max(total, level.segTo);
    }
    return sum + Math.max(1, Math.floor(total) || 1);
  }, 0);
}

/**
 * 批量生成的名称列表（模板生成模式）
 *
 * 与 formatSubLevel 共用一套模板语义：{n} 模板、固定名单、纯文本补序号都合法。
 * 上限 99 —— 批量生成是「造一阶阶梯」，不是灌整本书的名词表。
 */
export function buildBatchNames(count: number, pattern: string): string[] {
  const total = Math.max(1, Math.min(99, Math.floor(count) || 1));
  const names: string[] = [];
  for (let index = 1; index <= total; index += 1) {
    names.push(formatSubLevel(pattern, index));
  }
  return names;
}

/**
 * 进位示例文案
 *
 * 取前两阶演示「满层进位」：`引气 一层 → 引气 九层 →（满层进位）→ 筑基 一层`。
 * 每阶用**自己生效的**小层命名模板（本级为空沿用分类）—— 阶阶结构可以不同，
 * 示例必须如实反映「练气 第1层 → 练气 第9层 → 筑基 初期」这种混搭。
 * 倒序（desc）时序列反向展示，示例也跟着反向 —— 否则「九品 → 一品」的示例
 * 会写成正序，与作者实际的进位方向相反。
 */
export function buildCarryExample(category: SettingCategory): string {
  const ordered = sortLevels(category.levels, category.carryDir);
  if (ordered.length === 0) return "尚无等级，新增后自动生成示例";
  const first = ordered[0];
  const second = ordered[1];
  const firstPattern = effectiveSubPattern(first, category);
  const last = formatSubLevel(firstPattern, first.subLevels);
  const head = `${first.name} ${formatSubLevel(firstPattern, 1)} → ${first.name} ${last}`;
  if (!second) return head;
  return `${head} →（满层进位）→ ${second.name} ${formatSubLevel(effectiveSubPattern(second, category), 1)}`;
}

/**
 * 按进位方向排序：desc 时阶梯在展示上倒过来
 *
 * 注意**不改 rank** —— rank 始终是「由低到高」的物理顺序（与数据库一致），
 * 倒序只是展示口径。否则插入 / 重排的 rank 计算会在两种方向下各有一套，必错。
 */
export function sortLevels(
  levels: SettingLevel[],
  carryDir: CarryDirection,
): SettingLevel[] {
  const byRank = [...levels].sort((a, b) => a.rank - b.rank);
  return carryDir === "desc" ? byRank.reverse() : byRank;
}

/**
 * 在落点插入一条新等级，返回重排后的完整序列
 *
 * `insertAt` 是**行序落点**（第几行之前），0 = 最前，`>= 行数` = 追加到末尾。
 * 落点一律换算成「目标行的 rank」，再把该 rank 及之后的全部 +1 ——
 * rank 是阶梯的唯一顺序依据，出现两条同 rank 的行，「第 N 阶」就与顺序脱钩。
 *
 * ⚠️ **落点必须按 rank 算，不能按数组下标 / 行数直接当 rank**（1.38.0 修）：
 * - 中间插入：目标行的 rank 就是落点（rank 有空洞时目标 rank 可能是 5，
 *   而不是 3）；
 * - 末尾追加：落点是 `max(rank) + 1`，不是 `行数 + 1` —— 历史数据里
 *   rank 是 1、2、5（行数 3）时，旧的 `长度 + 1 = 4` 会**插到金丹之前**，
 *   这正是「在末尾插入无效」的现象。
 *
 * 为此 rank 空洞也会被**顺带压实**（落点之后整体 +1 后重新按 rank 排序），
 * 使插入后的序列始终是连续序号 —— 不需要额外的规范化步骤。
 */
export function insertLevel(
  levels: SettingLevel[],
  insertAt: number,
  draft: Omit<SettingLevel, "rank">,
): SettingLevel[] {
  const ordered = [...levels].sort((a, b) => a.rank - b.rank);
  const endpoint = ordered.length === 0 ? 1 : ordered[ordered.length - 1].rank + 1;
  const target = Math.max(0, Math.min(insertAt, ordered.length));
  const rank = target >= ordered.length ? endpoint : ordered[target].rank;
  const shifted = ordered.map((level) =>
    level.rank >= rank ? { ...level, rank: level.rank + 1 } : level,
  );
  return [...shifted, { ...draft, rank }].sort((a, b) => a.rank - b.rank);
}

/**
 * 把一批 rank 压实成 1..n 连续序号
 *
 * 与主进程 `rankAt` 是同一套「行序 ↔ rank」映射：两端各算一套必然错位，
 * 所以这个函数只做本地乐观更新，落库仍由主进程按行序换算。
 * 拖动重排 / 删除 / 拆分合并后调用，保证下一次「末尾插入」的落点正确。
 */
export function normalizeRanks(levels: SettingLevel[]): SettingLevel[] {
  return [...levels]
    .sort((a, b) => a.rank - b.rank)
    .map((level, index) => ({ ...level, rank: index + 1 }));
}

/**
 * 删除一批等级，并把后面的 rank 前移补位
 *
 * 一次删多条（删等级项会连带它的派生分段）也要保持 rank 连续：
 * 逐条调「删一条」会让后面的行被前移多次，序号错乱。
 */
export function removeLevels(
  levels: SettingLevel[],
  ids: string[],
): SettingLevel[] {
  const doomed = new Set(ids);
  if (doomed.size === 0) return levels;
  return levels
    .filter((level) => !doomed.has(level.id))
    .sort((a, b) => a.rank - b.rank)
    .map((level, index) => ({ ...level, rank: index + 1 }));
}

/** 删除一条等级并补位（见 removeLevels） */
export function removeLevel(
  levels: SettingLevel[],
  levelId: string,
): SettingLevel[] {
  return removeLevels(levels, [levelId]);
}

/**
 * 把第 n 条移到第 m 条的位置（拖拽落点），返回重排后的序列
 *
 * 用「抽出后按下标插回」而不是交换：交换在跨多行拖拽时结果依赖路径，
 * 抽出插入则与拖拽的视觉落点一一对应。
 */
export function moveLevel(
  levels: SettingLevel[],
  fromId: string,
  toIndex: number,
): SettingLevel[] {
  const ordered = [...levels].sort((a, b) => a.rank - b.rank);
  const from = ordered.findIndex((level) => level.id === fromId);
  if (from < 0) return ordered;
  const clamped = Math.max(0, Math.min(toIndex, ordered.length - 1));
  const [moved] = ordered.splice(from, 1);
  ordered.splice(clamped, 0, moved);
  return ordered.map((level, index) => ({ ...level, rank: index + 1 }));
}

/**
 * 拆分层级的分段预览
 *
 * 1.38.1 起父阶是**纯分组**：不占用任何小层段，全部 `parts` 段都是它的
 * 子层级，段号从 **第1段** 起（此前第一段占用原行、子层级从第2段起，
 * 编号观感断档）。每段新建 id —— 绑在原阶上的引用落在分组上，
 * 仍然有效（分组即整阶）。
 *
 * `namePattern` 为段名模板（1.37.0）：支持 `{name}`（原名）与 `{n}`（段号），
 * 也支持固定名单（「初期,中期,后期,圆满」拆 4 段正好逐段命名）。
 * 缺省「原名 · 第N段」。
 */
export function previewSplit(
  level: SettingLevel,
  parts: number,
  subLevels: number,
  namePattern?: string,
): Array<{ id: string; name: string; segFrom: number; segTo: number }> {
  const count = Math.max(2, Math.floor(parts));
  const total = Math.max(count, Math.floor(subLevels) || level.subLevels || 1);
  const size = Math.floor(total / count);
  const pattern = (namePattern ?? "").trim();
  const segmentName = (index: number): string => {
    if (!pattern) {
      return `${level.name} · 第${index + 1}段`;
    }
    if (pattern.includes("{name}")) {
      return pattern
        .replace("{name}", level.name)
        .replace(/\{n\}/g, String(index + 1));
    }
    // {n} 模板 / 固定名单 / 纯文本补序号，与批量生成同一套语义
    return formatSubLevel(pattern, index + 1);
  };
  const segments: Array<{ id: string; name: string; segFrom: number; segTo: number }> = [];
  for (let i = 0; i < count; i += 1) {
    const from = i * size + 1;
    // 最后一段吃掉除不尽的余数，否则小层总数会少于原阶
    const to = i === count - 1 ? total : (i + 1) * size;
    segments.push({
      id: `${level.id}__seg${i + 1}`,
      name: segmentName(i),
      segFrom: from,
      segTo: to,
    });
  }
  return segments;
}

/**
 * 拆分后的完整序列：原行降级为**分组**（不占段），全部段挂在它下面
 *
 * 后面的等级项整体后移 `segments.length` 位（原一阶变成 1 个分组 + N 段）。
 * 分组保留整阶小层总数（行囊换算按它展开）；各段只留自己那段的小层数。
 */
export function applySplit(
  levels: SettingLevel[],
  levelId: string,
  segments: Array<{ id: string; name: string; segFrom: number; segTo: number }>,
): SettingLevel[] {
  const target = levels.find((level) => level.id === levelId);
  if (!target || segments.length === 0) return levels;
  const shifted = levels.map((level) =>
    level.rank > target.rank ? { ...level, rank: level.rank + segments.length } : level,
  );
  const group: SettingLevel = {
    ...target,
    segFrom: null,
    segTo: null,
    subLevels: segments.reduce(
      (sum, segment) => sum + (segment.segTo - segment.segFrom + 1),
      0,
    ),
  };
  const tails = segments.map((segment, index) => ({
    ...target,
    id: segment.id,
    name: segment.name,
    // 父级指针指向分组：合并时据此找回并摘掉这些派生段
    parentId: target.id,
    segFrom: segment.segFrom,
    segTo: segment.segTo,
    subLevels: segment.segTo - segment.segFrom + 1,
    rank: target.rank + index + 1,
  }));
  return [...shifted.filter((level) => level.id !== target.id), group, ...tails].sort(
    (a, b) => a.rank - b.rank,
  );
}

/**
 * 合并是拆分的逆操作：摘掉派生段、把后面的 rank 前移，并还原小层总数
 *
 * 还原值兼容两代拆分语义：新模型（分组持有整阶总数）取 `parent.subLevels`
 * 就够；旧模型（父阶占第一段、总数散在段里）靠「段的最大 segTo / 段长之和」
 * 兜底 —— 两者取最大，一拆一合后整阶的小层数都不会被永久改小。
 */
export function applyMerge(
  levels: SettingLevel[],
  parentId: string,
): SettingLevel[] {
  const parent = levels.find((level) => level.id === parentId);
  if (!parent) return levels;
  const children = levels.filter((level) => level.parentId === parentId);
  if (children.length === 0) return levels;
  const restored = Math.max(
    parent.subLevels,
    ...children.map((child) => child.segTo ?? 0),
    children.reduce((sum, child) => sum + child.subLevels, 0),
  );
  const kept = levels
    .filter((level) => level.parentId !== parentId)
    .map((level) =>
      level.id === parentId
        ? { ...level, segFrom: null, segTo: null, subLevels: restored }
        : level,
    );
  const removed = children.length;
  const minChildRank = Math.min(...children.map((child) => child.rank));
  return kept
    .map((level) =>
      level.rank > minChildRank
        ? { ...level, rank: level.rank - removed }
        : level,
    )
    .sort((a, b) => a.rank - b.rank);
}

// ── 绑定展示：优先父等级，子层级折算成境界内进度 ──

/**
 * 只取根阶（拆分前的「阶」），按展示序排列
 *
 * 绑定类 UI（角色卡当前境界、行囊境界）不把派生段当独立阶平铺 ——
 * 「练气」拆出 9 段后，阶梯上应该还是 9 个阶里的一阶「练气」，
 * 段是这一阶内部的进度，不是 9 个新阶。与 countSubLevels 同一口径：
 * 只数根，派生段不重复计阶。
 */
export function rootLevels(
  levels: SettingLevel[],
  carryDir: CarryDirection,
): SettingLevel[] {
  return sortLevels(
    levels.filter((level) => !level.parentId),
    carryDir,
  );
}

/** 绑定落点在阶梯里的位置：绑在哪个根阶下、落在哪个派生段、整阶共几小层 */
export interface RealmPosition {
  /** 绑定落点所属的根阶（直接绑在根阶上时就是它自己） */
  root: SettingLevel;
  /** 绑定落点的派生段；直接绑在根阶上时为 null */
  segment: SettingLevel | null;
  /** 该根阶的小层总数（父阶 + 全部派生段的最大 segTo，见 countSubLevels 同款口径） */
  total: number;
}

/**
 * 把「绑定到某个等级项 id + 阶内小层」翻译成「根阶 + 境界内进度」
 *
 * - 绑在根阶上（统一口径，1.38.1 起）：父阶是「组」，绑定总是落在
 *   根阶 + note.sub（阶内第几层）上 —— 有子层级时 segment 由 noteSub 落在
 *   哪个段决定，展示层据此渲染「练气 · 第4层（共 9 层）」这类进度文案；
 * - 绑在派生段上（旧数据）：segment 就是该段；
 * - 兼容旧模型（1.38.1 前父阶自己占第一段）：绑在 segFrom 非空的旧父阶上，
 *   把父阶自身当作段，进度照常展示；
 * - id 不在序列里（已删 / 换了体系）→ null。
 */
export function findRealmPosition(
  levels: SettingLevel[],
  boundLevelId: string | null,
  noteSub = 1,
): RealmPosition | null {
  if (!boundLevelId) return null;
  const bound = levels.find((level) => level.id === boundLevelId);
  if (!bound) return null;
  const root = bound.parentId
    ? levels.find((level) => level.id === bound.parentId)
    : bound;
  if (!root) return null;
  let total = root.subLevels;
  for (const level of levels) {
    if (level.parentId !== root.id) continue;
    if (level.segTo !== null) total = Math.max(total, level.segTo);
  }
  let segment: SettingLevel | null;
  if (bound.parentId) {
    segment = bound;
  } else if (root.segFrom !== null) {
    segment = root; // 旧模型：父阶自己占第一段
  } else {
    // 统一口径：绑在根阶 + note.sub —— 落在哪个子层级的段区间里就是哪段
    const sub = Math.max(1, Math.floor(noteSub) || 1);
    segment =
      levels.find(
        (level) =>
          level.parentId === root.id &&
          level.segFrom !== null &&
          level.segTo !== null &&
          sub >= level.segFrom &&
          sub <= level.segTo,
      ) ?? null;
  }
  return {
    root,
    segment,
    total: Math.max(1, Math.floor(total) || 1),
  };
}

/** 解析绑定行的阶内小层（novel_links.note 的 {sub}），缺省 1 */
export function parseRealmNoteSub(note?: string | null): number {
  if (!note) return 1;
  try {
    const parsed: unknown = JSON.parse(note);
    if (!parsed || typeof parsed !== "object") return 1;
    const sub = Number((parsed as { sub?: unknown }).sub);
    return Number.isFinite(sub) && sub >= 1 ? Math.floor(sub) : 1;
  } catch {
    return 1;
  }
}

/**
 * 绑定落点的**可读名**：父阶优先，阶内进度折算成「父阶 · 层名」
 *
 * 卡片 / 导出这类只有一行的场合用：绑在「练气」第 4 层上显示
 * 「练气 · 第4层」；段名自定义且没带父阶前缀时补上 —— 单看一行也得知道
 * 是哪一阶的进度。没有子层级（未拆分）时就是根阶名。
 */
export function formatBoundRealmName(
  levels: SettingLevel[],
  boundLevelId: string | null,
  noteSub = 1,
): string {
  const position = findRealmPosition(levels, boundLevelId, noteSub);
  if (!position) return "";
  const { root, segment } = position;
  if (!segment) return root.name;
  return segment.name.startsWith(root.name)
    ? segment.name
    : `${root.name} · ${segment.name}`;
}

// ── 正文一致性扫描 ──

/** 一致性问题的种类 */
export type ConsistencyIssueKind = "alias" | "unknown";

/** 一条一致性问题 */
export interface ConsistencyIssue {
  kind: ConsistencyIssueKind;
  /** 命中原文里的词 */
  term: string;
  /** 建议替换成的设定用词（unknown 时为 null） */
  suggest: string | null;
  /** 命中的分类名 */
  categoryName: string;
  categoryId: string;
}

/**
 * 扫描正文，找出与设定不符的用词
 *
 * 两类问题：
 * - `alias`：正文用了别名（「金丹期」），设定里正式名是「金丹」→ 可一键替换
 * - `unknown`：正文出现的词像某个分类的等级，但设定里没登记 → 提示登记
 *
 * 「unknown」的判定刻意保守：只对**形似等级名**的词报（长度 2–6 且全部为
 * CJK），否则正文里每个两字词都会被报成未登记，噪音大到没人看。
 */
export function scanConsistency(
  content: string,
  categories: SettingCategory[],
): ConsistencyIssue[] {
  if (!content.trim() || categories.length === 0) return [];

  const issues: ConsistencyIssue[] = [];
  const seen = new Set<string>();

  for (const category of categories) {
    // 长词优先：先匹配「金丹期」再匹配「金丹」，否则别名永远命中不到
    const aliasToName = new Map<string, string>();
    for (const level of category.levels) {
      for (const alias of level.aliases) {
        if (alias && alias !== level.name) aliasToName.set(alias, level.name);
      }
    }
    for (const [alias, name] of [...aliasToName.entries()].sort(
      (a, b) => b[0].length - a[0].length,
    )) {
      if (!alias || !content.includes(alias)) continue;
      const key = `${category.id}:${alias}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({
        kind: "alias",
        term: alias,
        suggest: name,
        categoryName: category.name,
        categoryId: category.id,
      });
    }
  }

  return issues;
}

/**
 * 找出正文里「形似等级但未登记」的词
 *
 * 只扫 realm 与 custom 分类中**已有等级名带共同后缀**的情况：
 * 例如设定里都是「X 丹」，正文出现「青元丹」就以「丹」为线索报出来。
 * 没有共同后缀线索时返回空 —— 宁可漏报，不可满屏误报。
 */
export function scanUnregistered(
  content: string,
  categories: SettingCategory[],
): ConsistencyIssue[] {
  if (!content.trim()) return [];
  const issues: ConsistencyIssue[] = [];
  const seen = new Set<string>();

  for (const category of categories) {
    if (category.levels.length < 2) continue;
    const suffix = commonSuffix(category.levels.map((level) => level.name));
    if (!suffix) continue;

    const known = new Set<string>();
    for (const level of category.levels) {
      known.add(level.name);
      for (const alias of level.aliases) known.add(alias);
    }

    // 前缀取 1–2 字且**非贪婪**：贪婪的 {2,4} 会把「那枚青元丹」整段吞进来，
    // 出来的词根本不是等级名。中文没有词边界，这里只能启发式地切。
    const pattern = new RegExp(
      `([\\u4e00-\\u9fa5]{1,2}?${escapeRegExp(suffix)})`,
      "g",
    );
    const matches = content.match(pattern) ?? [];
    for (const term of matches) {
      if (known.has(term) || seen.has(`${category.id}:${term}`)) continue;
      // 前缀里含虚词 → 说明切错了位置（「他服下金丹」会切出「下金丹」）
      if (hasStopWord(term.slice(0, term.length - suffix.length))) continue;
      seen.add(`${category.id}:${term}`);
      issues.push({
        kind: "unknown",
        term,
        suggest: null,
        categoryName: category.name,
        categoryId: category.id,
      });
    }
  }
  return issues;
}

/**
 * 等级名前缀里不该出现的虚词
 *
 * 中文没有词边界，「他服下金丹」会被切成「下金丹」。判据是：等级名的前缀
 * 是实词（金 / 玄 / 青元），不会以虚词或方位词打头。命中即认为切错了位置。
 */
const STOP_WORDS = new Set(
  "的了是在他她它这那有和与就都而及把被让给从对为以其之于并也還还又再只才更最很没不上下中里外前后内间时个些枚颗道次回年月日掌服走出去来到过说话看听想做手身心头眼口一二三四五六七八九十万千百".split(
    "",
  ),
);

function hasStopWord(prefix: string): boolean {
  return [...prefix].some((char) => STOP_WORDS.has(char));
}

/** 取一组词的共同后缀；不足两个词共享时返回空串 */
function commonSuffix(names: string[]): string {
  const clean = names.filter((name) => name.length >= 2);
  if (clean.length < 2) return "";
  let suffix = "";
  for (let len = 1; len <= 2; len += 1) {
    const candidate = clean[0].slice(-len);
    if (clean.every((name) => name.length > len && name.endsWith(candidate))) {
      suffix = candidate;
    }
  }
  return suffix;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 把设定名批量替换进正文（重命名等级时「一并更新已写正文」用）
 *
 * 只替换**整词**：`金丹` 不会命中 `金丹期` 的部分 —— 后者由别名扫描单独处理。
 */
export function replaceInContent(
  content: string,
  from: string,
  to: string,
): string {
  if (!from || from === to) return content;
  return content.split(from).join(to);
}
