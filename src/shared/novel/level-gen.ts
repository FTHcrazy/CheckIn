/**
 * 等级体系生成的候选构造（R-AI-18，纯函数）
 *
 * 模型吐出「1. 练气 / 2. 筑基」这样一列文字，这一层把它变成**可勾选的阶梯候选**：
 * 名字归一到本体、与已有阶梯重名的单独标出、序号接着现有最高一级往下排。
 *
 * 三条硬口径：
 * 1. **只追加，不覆盖**：等级行会被角色卡「当前境界」与行囊换算按名字引用，
 *    覆盖式重写会让这些引用悬空。所以候选只有「加在末尾」一种去向。
 * 2. **重名项禁勾**：与已有阶梯同名的不入库（否则会出现两行同名等级，
 *    作者分不清角色卡指向哪一个）。归一后再比，避免「练气 」与「练气」漏判。
 * 3. **顺序即阶梯序**：模型给的行序就是候选序，这里**不重排**。
 *    高低无法本地判定（「金丹」比「筑基」高是常识，但自定义体系不是），
 *    重排等于替作者猜；重排错了比不排更糟。想调顺序在阶梯里拖动手柄。
 *
 * 本文件不读库、不碰 store / IPC，可单测。
 */
import { stripWrappers } from "./name-normalize";

/** 两档模式：整理整套 / 在现有顶点之后拓展 */
export type LevelGenMode = "generate" | "extend";

/** 条数区间（面板与提示词共用同一口径，避免「面板给 9、模板按 5 写」） */
export const LEVEL_COUNT_RANGE: Record<
  LevelGenMode,
  { min: number; max: number; fallback: number }
> = {
  generate: { min: 3, max: 20, fallback: 9 },
  extend: { min: 1, max: 12, fallback: 4 },
};

/** 单次最多列多少条候选（再多作者勾不过来，也没人真有一百级体系） */
export const MAX_LEVEL_CANDIDATES = 20;

/** 一条阶梯候选 */
export interface LevelCandidate {
  /** 稳定键（勾选态按它索引）：归一后的名字，列表内唯一 */
  key: string;
  name: string;
  /**
   * 一句话梯度说明（落进等级的 `note` 列 —— 「等级说明」）。
   * AI 生成时就带着它，落库必须跟着走，否则候选里看得见、库里没有。
   */
  note: string;
  /** 阶梯序（1-based，接在现有之后） */
  sequence: number;
  selected: boolean;
  /** 与已有阶梯重名 → 禁勾 */
  duplicate: boolean;
}

/**
 * 序号前缀：模型爱写「1. 练气」「（1）练气」「①练气」「第三级 练气」。
 *
 * ⚠️ 只剥「明确是序号的形态」，且剥完必须还剩 ≥2 个字 ——
 * 「三层」这种真名字剥完为空，必须原样保留（它是名字，不是序号）。
 */
const ORDINAL_PREFIXES: readonly RegExp[] = [
  /^[（(【[]\s*\d{1,2}\s*[)）】\]]\s*/,
  /^\d{1,2}\s*[.、．,，:：\-—)）]\s*/,
  /^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]\s*/,
  /^第\s*[一二三四五六七八九十百\d]{1,3}\s*[级阶层重品段]\s*[·:：、.．\-—]?\s*/,
];

/** 名字归一：剥包裹符号 + 剥序号前缀 + 去尾部标点 */
export function normalizeLevelName(raw: string): string {
  let name = stripWrappers(raw);
  for (let guard = 0; guard < 3; guard += 1) {
    const before = name;
    for (const pattern of ORDINAL_PREFIXES) {
      const next = name.replace(pattern, "").trim();
      // 剥完至少留 2 个字才算「这是序号」，否则视为名字本身（「三层」）
      if (next !== name && next.length >= 2) {
        name = next;
        break;
      }
    }
    if (name === before) break;
  }
  return name.replace(/[。，、,.;；:：!！?？]+$/, "").trim();
}

/** 取条目里第一个非空文本字段（模型字段名会漂移，按优先级取） */
function readText(entry: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = entry[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

/** 模型条目 → 阶梯候选（顺序保留模型给的阶梯序） */
export function buildLevelCandidates(
  entries: readonly unknown[],
  options: {
    /** 已有阶梯名（根级，顺序即阶梯序） */
    existing: readonly string[];
    mode: LevelGenMode;
    limit?: number;
  },
): LevelCandidate[] {
  const existingNames = options.existing.map((name) => normalizeLevelName(name)).filter(Boolean);
  const existingSet = new Set(existingNames);
  const limit = Math.min(
    MAX_LEVEL_CANDIDATES,
    Math.max(1, Math.floor(options.limit ?? MAX_LEVEL_CANDIDATES)),
  );

  const seen = new Set<string>();
  const candidates: LevelCandidate[] = [];
  // 阶梯序接着现有最高一级往下排（生成模式下现有通常为空，从 1 开始）
  let sequence = existingNames.length;

  for (const raw of entries) {
    if (candidates.length >= limit) break;
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const name = normalizeLevelName(readText(entry, ["name", "level", "title", "名称", "等级"]));
    // 1 字名字基本都是模型截断的残片；> 8 字是它把解释写进了名字
    // （中文境界名常见 2–5 字，「混元无极境」5 字已属长名，8 字是安全上限）
    if (name.length < 2 || name.length > 8) continue;
    if (seen.has(name)) continue;
    seen.add(name);

    sequence += 1;
    const duplicate = existingSet.has(name);
    candidates.push({
      key: name,
      name,
      note: readText(entry, ["note", "summary", "desc", "说明"]).trim().slice(0, 40),
      sequence,
      // 默认全勾：AI 给的是「一套体系」，逐条取消比逐条勾选顺手；
      // 重名项例外 —— 勾了也会被 `pickedLevelNames` 过滤掉，禁勾只是把话说在前面。
      selected: !duplicate,
      duplicate,
    });
  }

  return candidates;
}

/** 真正会写入的条数（勾选且不重名） */
export function countLevelPicks(candidates: readonly LevelCandidate[]): number {
  return candidates.filter((item) => item.selected && !item.duplicate).length;
}

/** 真正会写入的条目（勾选且不重名，顺序即阶梯序）：名字 + 等级说明一起走 */
export function pickedLevelItems(
  candidates: readonly LevelCandidate[],
): Array<{ name: string; note: string }> {
  return candidates
    .filter((item) => item.selected && !item.duplicate)
    .map((item) => ({ name: item.name, note: item.note }));
}

/** 真正会写入的名字（顺序即阶梯序）——只要名字的场景用它 */
export function pickedLevelNames(candidates: readonly LevelCandidate[]): string[] {
  return pickedLevelItems(candidates).map((item) => item.name);
}
