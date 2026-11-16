/**
 * 动态节假日数据拉取与缓存（CodePage 工作日统计用）
 *
 * 数据源：timor.tech 免费节假日接口（无需 Key），返回结构：
 *   { code: 0, holiday: { "MM-DD": { holiday: boolean, name, ... } } }
 * 其中 holiday=true 对应「放假日」、holiday=false 对应「调休补班日」，
 * 与 code-utils.ts 的 HOLIDAYS / MAKEUP_WORKDAYS 两张硬编码表一一对应。
 * ⚠️ 该接口要求携带浏览器 UA，否则返回 403。
 *
 * 策略：
 * - 「每日一拉」：当天首次拉取时先读 localStorage 缓存（立即生效），随后后台静默
 *   重新拉取接口并回写缓存；当天再次调用直接命中缓存，不再发请求；
 * - 拉取失败 / 接口不可用 → 保持缓存（或返回 null），由调用方回退到硬编码表兜底；
 * - 数据只覆盖「当年及已公布年份」，历史年份查询仍走硬编码表。
 *
 * 网络契约：走渲染进程 fetch（符合 AGENTS.md §8.7「网络请求一律在渲染进程发起」），
 * 不新增任何主进程 IPC 通道。
 */

import type { HolidayData } from "./code-utils";

/** 接口地址（timor.tech 免费节假日 API，路径末尾拼年份） */
const HOLIDAY_API = "https://timor.tech/api/holiday/year";

/** 请求必须携带浏览器 UA，否则接口返回 403 */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/** localStorage 缓存键前缀（含数据源标识，换源不冲突），拼接年份构成完整 key */
const CACHE_KEY_PREFIX = "code-holiday-timor-";

/** 接口 holiday 对象里单日记录的字段 */
interface HolidayDay {
  holiday?: boolean;
  name?: string;
}

/** 接口完整响应 */
interface HolidayResponse {
  code: number;
  holiday?: Record<string, HolidayDay>;
}

/**
 * 从 localStorage 读某年缓存；无缓存或解析失败返回 null。
 */
function readCache(year: number): HolidayData | null {
  try {
    const raw = localStorage.getItem(`${CACHE_KEY_PREFIX}${year}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { holidays: string[]; makeupWorkdays: string[] };
    if (!Array.isArray(parsed.holidays) || !Array.isArray(parsed.makeupWorkdays)) {
      return null;
    }
    return {
      holidays: new Set(parsed.holidays),
      makeupWorkdays: new Set(parsed.makeupWorkdays),
    };
  } catch {
    return null;
  }
}

/** 写某年缓存（静默失败，缓存不可用不影响主流程） */
function writeCache(year: number, data: HolidayData): void {
  try {
    localStorage.setItem(
      `${CACHE_KEY_PREFIX}${year}`,
      JSON.stringify({
        holidays: [...data.holidays],
        makeupWorkdays: [...data.makeupWorkdays],
      }),
    );
  } catch {
    // localStorage 满 / 被禁用等场景，忽略
  }
}

/** 解析接口响应为 HolidayData；字段缺失 / 结构不符返回 null */
function parseResponse(body: HolidayResponse, year: number): HolidayData | null {
  if (!body || body.code !== 0 || !body.holiday) return null;
  const holidays = new Set<string>();
  const makeupWorkdays = new Set<string>();
  for (const [md, day] of Object.entries(body.holiday)) {
    // key 为 "MM-DD"，拼上年份构成完整日期（如 "2026-10-10"）
    const full = `${year}-${md}`;
    if (day.holiday === true) holidays.add(full);
    else if (day.holiday === false) makeupWorkdays.add(full);
  }
  if (holidays.size === 0 && makeupWorkdays.size === 0) return null;
  return { holidays, makeupWorkdays };
}

/**
 * 联网拉取某年数据并写缓存；失败返回 null（不动缓存）。
 */
async function fetchAndCache(year: number): Promise<HolidayData | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`${HOLIDAY_API}/${year}`, {
      signal: controller.signal,
      headers: { "User-Agent": BROWSER_UA },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const body = (await res.json()) as HolidayResponse;
    const data = parseResponse(body, year);
    if (data) writeCache(year, data);
    return data;
  } catch {
    return null;
  }
}

/** 记录某年份「今天是否已拉取过」，避免同一天内多次挂载重复发请求 */
const pulledToday = new Set<string>();

/** 当天日期键（本地时区 YYYY-MM-DD），用于跨天自动失效 */
function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 同步读某年的动态节假日数据（只读缓存，立即生效、不触发网络）。
 * @returns 缓存数据；无缓存返回 null（调用方回退硬编码表）
 */
export function getCachedHoliday(year: number): HolidayData | null {
  return readCache(year);
}

/**
 * 获取某年的动态节假日数据：
 *  1. 先同步读缓存并立即返回；
 *  2. 随后（当今天尚未拉取过时）后台静默重新拉取接口刷新缓存。
 * 保证「本地缓存先用上」，同时每天自动跟上接口最新数据（覆盖国务院 11 月公布次年安排）。
 *
 * @param year 目标年份（如 2026）
 * @param onUpdate 缓存刷新后的回调（可选），用于把新数据注入运行时状态
 * @returns 当次可用的数据（缓存优先；无缓存则等待拉取结果）
 */
export async function fetchHolidayData(
  year: number,
  onUpdate?: (data: HolidayData | null) => void,
): Promise<HolidayData | null> {
  const cached = readCache(year);
  const key = `${todayKey()}:${year}`;

  // 今天已拉过 → 直接返回缓存（可能为 null），不再发请求
  if (pulledToday.has(key)) return cached;

  pulledToday.add(key);
  // 已有缓存：先返回缓存，再后台静默刷新（失败保留旧缓存）
  if (cached) {
    void fetchAndCache(year).then((fresh) => onUpdate?.(fresh));
    return cached;
  }

  // 无缓存：等待首次拉取结果
  const data = await fetchAndCache(year);
  onUpdate?.(data);
  return data;
}
