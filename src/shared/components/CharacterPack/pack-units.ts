/**
 * 量纲体系的 JSON 导入 / 导出（REQ-022）。
 *
 * 只覆盖行囊自己用得上的两套：货币（进制型）与熟练度（阈值型）。**境界不在这里**
 * —— 它走 R25 的等级体系（`novel_level_*` + `novel_links`），另有一套完整的
 * 增删改序入口；把它也塞进这个文件只会造出第二份真相源。
 *
 * 这一层刻意是**纯函数**：解析要顶得住用户粘进来的任何一段文本（也可能是别的
 * JSON），而「粘错了」的失败信息必须能说清哪一条不对 —— 这些都不该长在组件里。
 */
import type { PackUnitSystem } from "./types";

/** 文件标记：导入时用它区分「这是行囊的量纲文件」和「一段碰巧合法 JSON」 */
export const UNITS_FILE_KIND = "checkin.character-pack.units";
export const UNITS_FILE_VERSION = 1;

/** 可交换的两套量纲用途 */
export type UnitsUse = "currency" | "proficiency";
export type UnitsKind = "ratio" | "threshold";

export interface UnitsFileEntry {
  use: UnitsUse;
  kind: UnitsKind;
  name: string;
  /** 该模型的档位列表（原样搬运，不在这一层解释） */
  levels: unknown[];
  /** 业务配置（如 `autoCarry`）。**内部标记 `use` 会被剥掉**，导入时再补回。 */
  config?: Record<string, unknown>;
}

export interface UnitsFile {
  kind: string;
  version: number;
  units: UnitsFileEntry[];
}

export type UnitsParseResult =
  | { ok: true; units: UnitsFileEntry[] }
  | { ok: false; error: string };

/**
 * 拆出 `config.use`（它是「这套量纲给谁用」的内部标记）与其余业务字段。
 *
 * 导出的文件里**不该带 `use` 两遍**（`units[].use` 已经表达了一次），
 * 但库里它就是存在 config 里的 —— 这一层负责在出入两个方向上对齐。
 */
function splitConfig(config: Record<string, unknown> | undefined): {
  use: UnitsUse | undefined;
  rest: Record<string, unknown>;
} {
  const rest: Record<string, unknown> = { ...(config ?? {}) };
  const raw = rest.use;
  delete rest.use;
  return { use: raw === "currency" || raw === "proficiency" ? raw : undefined, rest };
}

function parseJson(raw: string | undefined): unknown {
  try {
    return JSON.parse(raw || "");
  } catch {
    return undefined;
  }
}

/**
 * 把库内的量纲行拼成可交换的 JSON 文本。
 *
 * 读不出来的行**直接跳过**而不是写进文件：导出的东西是拿去别处用的，
 * 混进一条空的量纲只会让对面更难判断。
 */
export function buildUnitsJson(units: PackUnitSystem[]): string {
  const picked: UnitsFileEntry[] = [];
  for (const system of units) {
    if (system.kind !== "ratio" && system.kind !== "threshold") continue;
    const parsedConfig = parseJson(system.config);
    const { use, rest } = splitConfig(
      parsedConfig && typeof parsedConfig === "object"
        ? (parsedConfig as Record<string, unknown>)
        : undefined,
    );
    if (!use) continue;
    const levels = parseJson(system.levels);
    if (!Array.isArray(levels)) continue;
    picked.push({
      use,
      kind: system.kind,
      name: system.name,
      levels,
      ...(Object.keys(rest).length > 0 ? { config: rest } : {}),
    });
  }
  const file: UnitsFile = {
    kind: UNITS_FILE_KIND,
    version: UNITS_FILE_VERSION,
    units: picked,
  };
  return JSON.stringify(file, null, 2);
}

/** 兜底名（文件里没写 name 时用）：与量纲设置里的默认名一致 */
const FALLBACK_NAME: Record<UnitsUse, string> = {
  currency: "货币",
  proficiency: "熟练度",
};

/**
 * 解析导入文本。
 *
 * 版本号**不做拦截**：目前唯一的兼容策略是「按结构校验」，`version` 只是给将来
 * 真的出现不兼容变更时留的识别位（那时再按它分流）。
 */
export function parseUnitsJson(text: string): UnitsParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "不是合法的 JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "顶层应当是一个对象" };
  }
  const file = parsed as Partial<UnitsFile>;
  if (file.kind !== UNITS_FILE_KIND) {
    return { ok: false, error: "这不是行囊导出的量纲文件" };
  }
  if (!Array.isArray(file.units)) {
    return { ok: false, error: "缺少 units 列表" };
  }

  const units: UnitsFileEntry[] = [];
  for (const [index, raw] of file.units.entries()) {
    const at = index + 1;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: `第 ${at} 条不是对象` };
    }
    const entry = raw as Partial<UnitsFileEntry>;
    if (entry.use !== "currency" && entry.use !== "proficiency") {
      return { ok: false, error: `第 ${at} 条的 use 只能是 currency / proficiency` };
    }
    if (entry.kind !== "ratio" && entry.kind !== "threshold") {
      return { ok: false, error: `第 ${at} 条的 kind 只能是 ratio / threshold` };
    }
    if (!Array.isArray(entry.levels)) {
      return { ok: false, error: `第 ${at} 条缺少 levels 列表` };
    }
    units.push({
      use: entry.use,
      kind: entry.kind,
      name:
        typeof entry.name === "string" && entry.name.trim()
          ? entry.name
          : FALLBACK_NAME[entry.use],
      levels: entry.levels,
      config:
        entry.config && typeof entry.config === "object" && !Array.isArray(entry.config)
          ? (entry.config as Record<string, unknown>)
          : undefined,
    });
  }

  if (units.length === 0) {
    return { ok: false, error: "文件里没有任何量纲" };
  }
  return { ok: true, units };
}
