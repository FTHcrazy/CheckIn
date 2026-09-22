/**
 * 起名生成器纯函数（PRD R18 / 步骤三）
 *
 * 全部为「参数进、结果出」的可测函数：随机选词池组合、四维过滤
 * （风格 × 类型 × 性别 × 避开已用名）、可复现种子。不触达 DOM / IPC / React。
 *
 * 设计要点：
 *   1. 自带 PRNG（Mulberry32）—— seed 相同时生成顺序完全可复现，便于单测。
 *   2. 空池降级：风格不适配某类型时，prefixes/suffixes 桶缺省 → 返回空数组。
 *   3. 去重 + 避开 exclude：单批内去重；与 exclude 撞名时跳过；不足 count 时
 *      最多重试 count * 8 次（避免无限循环），仍不足则返回已得。
 *   4. 用户自定义池覆盖合并：customPool 的字段优先于内置池（PRD R18 ①）。
 */

import { NAMING_DICTIONARY } from "./data/dictionary";
import type {
  NameGender,
  NameStyle,
  NameStyleMeta,
  NamingCustomPool,
  NamingKind,
  NamingOptions,
  NamingPool,
  NamingResult,
} from "./types";

/** 风格元信息查询 */
export function getStyleMeta(style: NameStyle): NameStyleMeta | undefined {
  return NAMING_DICTIONARY.styles.find((meta) => meta.id === style);
}

/** 检查风格是否支持某名称类型（UI 据此禁用不适配组合） */
export function isKindSupported(style: NameStyle, kind: NamingKind): boolean {
  const meta = getStyleMeta(style);
  if (!meta) return false;
  if (meta.applicableKinds === null) return true;
  return meta.applicableKinds.includes(kind);
}

// ── 内部工具 ────────────────────────────────────────────────────────────

/** Mulberry32：体积小、速度快、可复现的 PRNG；seed=0 时按 Date.now 派生 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRandom<T>(rng: () => number, arr: readonly T[]): T | null {
  if (arr.length === 0) return null;
  return arr[Math.floor(rng() * arr.length)] as T;
}

/** 合并内置池与用户自定义池：用户池里的字段覆盖内置池对应字段 */
function resolvePool(
  style: NameStyle,
  customPool?: NamingCustomPool,
): NamingPool {
  const base = NAMING_DICTIONARY.pools[style] ?? {};
  if (!customPool) return base;

  // 自定义池的 key 形如 `${kind}:${style}:${slot}`，slot ∈ surnames/maleGiven/...
  // 仅当 key 与当前 style 匹配时才合并到对应字段
  const merged: NamingPool = {
    ...base,
    prefixesByKind: { ...base.prefixesByKind },
    suffixesByKind: { ...base.suffixesByKind },
  };

  for (const [compositeKey, value] of Object.entries(customPool)) {
    if (!Array.isArray(value) || value.length === 0) continue;
    // 解析 key：person 类用 person 桶，其它走 prefixesByKind/suffixesByKind
    const [kind, styleInKey, slot] = compositeKey.split(":") as [
      NamingKind,
      NameStyle,
      string,
    ];
    if (styleInKey !== style) continue;
    if (kind === "person") {
      if (slot === "surnames") merged.surnames = value;
      else if (slot === "maleGiven") merged.maleGiven = value;
      else if (slot === "femaleGiven") merged.femaleGiven = value;
      else if (slot === "westernSurnames") merged.westernSurnames = value;
      else if (slot === "westernMaleGiven") merged.westernMaleGiven = value;
      else if (slot === "westernFemaleGiven") merged.westernFemaleGiven = value;
    } else {
      if (slot === "prefixes") {
        merged.prefixesByKind = {
          ...merged.prefixesByKind,
          [kind]: value,
        };
      } else if (slot === "suffixes") {
        merged.suffixesByKind = {
          ...merged.suffixesByKind,
          [kind]: value,
        };
      }
    }
  }

  return merged;
}

/** 取风格族（东西方） */
function familyOf(style: NameStyle): "eastern" | "western" {
  return getStyleMeta(style)?.family ?? "eastern";
}

/** 组合单个名字（不参与去重 / exclude，由 generateNames 统一过滤） */
function composeName(
  rng: () => number,
  pool: NamingPool,
  style: NameStyle,
  kind: NamingKind,
  gender: NameGender,
): string | null {
  if (kind === "person") {
    // 性别为 any 时随机挑一个具体性别
    const resolved: "male" | "female" =
      gender === "any"
        ? rng() < 0.5
          ? "male"
          : "female"
        : gender;

    if (familyOf(style) === "western") {
      // 西方：given + " " + surname（给定名在前）
      const givenPool =
        resolved === "male"
          ? pool.westernMaleGiven
          : pool.westernFemaleGiven;
      const given = pickRandom(rng, givenPool ?? []);
      const sur = pickRandom(rng, pool.westernSurnames ?? []);
      if (!given || !sur) return null;
      return `${given} ${sur}`;
    }

    // 东方：surname + 1~2 个 given 字
    const sur = pickRandom(rng, pool.surnames ?? []);
    const givenPool =
      resolved === "male" ? pool.maleGiven : pool.femaleGiven;
    if (!sur) return null;
    const given1 = pickRandom(rng, givenPool ?? []);
    if (!given1) return null;
    // 50% 概率 2 字名（中文常见）
    if (rng() < 0.5) {
      const given2 = pickRandom(rng, givenPool ?? []);
      if (given2 && given2 !== given1) {
        return `${sur}${given1}${given2}`;
      }
    }
    return `${sur}${given1}`;
  }

  // 其它 7 类：prefix + suffix
  const prefixes = pool.prefixesByKind?.[kind] ?? [];
  const suffixes = pool.suffixesByKind?.[kind] ?? [];
  const prefix = pickRandom(rng, prefixes);
  const suffix = pickRandom(rng, suffixes);
  if (!prefix || !suffix) return null;
  return `${prefix}${suffix}`;
}

// ── 主入口 ──────────────────────────────────────────────────────────────

/**
 * 生成 N 个不重复且避开 exclude 的名字
 *
 * @returns 最多 options.count 个名字；空池 / 不适配 → 空数组
 */
export function generateNames(options: NamingOptions): NamingResult[] {
  const { kind, style, gender, count, exclude, seed, customPool } = options;

  // 不适配组合直接返回空（UI 应已禁用，但兜底）
  if (!isKindSupported(style, kind)) return [];

  const rng = mulberry32(seed ?? Date.now() >>> 0);
  const pool = resolvePool(style, customPool);

  const excludeSet = new Set(exclude.map((name) => name.trim()));
  const seen = new Set<string>();
  const results: NamingResult[] = [];

  // 重试上限：count * 8（够覆盖 30 池×30 池=900 组合的 10 抽样）
  const maxAttempts = Math.max(count * 8, 80);
  for (let attempt = 0; attempt < maxAttempts && results.length < count; attempt += 1) {
    const name = composeName(rng, pool, style, kind, gender);
    if (!name) break; // 池空，再试也是空
    if (seen.has(name)) continue;
    if (excludeSet.has(name)) continue;
    seen.add(name);
    results.push({ name, kind, style, gender });
  }

  return results;
}

/** "换一批" 的便捷封装：传入上次 seed 派生新种子，结果不重复（同 exclude 下） */
export function generateNextBatch(
  options: NamingOptions,
  previousSeed: number,
): { results: NamingResult[]; seed: number } {
  // 用 previousSeed + 1 作为新种子，确保与上次不同（但仍可复现）
  const seed = (previousSeed + 1) >>> 0;
  return {
    results: generateNames({ ...options, seed }),
    seed,
  };
}
