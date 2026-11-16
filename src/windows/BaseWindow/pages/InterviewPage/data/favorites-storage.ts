/**
 * 收藏集合的本地持久化。
 *
 * 只用一条 JSON 字符串存 `string[]`：题目 id 是稳定的短字符串，
 * 150 条的收藏集合序列化后不过几 KB，不值得为它建表或拆 key。
 *
 * 读取一律「失败即空集」：localStorage 里可能是上一版本写的结构、
 * 也可能被手工改坏，任何一处抛错都不该让页面白屏。
 */

/** 存储键：带版本后缀，将来改结构可以并存而不是就地破坏 */
export const FAVORITES_STORAGE_KEY = "interview-bank:favorites:v1";

/** 取存储实现：显式传入的优先，否则用 window.localStorage（隐私模式下可能抛错） */
function resolveStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 类型守卫：只接受「全是字符串」的数组，其它一律视为损坏数据 */
function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

/** 读取收藏集合；缺失、损坏、无存储能力时都返回空集 */
export function readFavorites(storage?: Storage): ReadonlySet<string> {
  const target = resolveStorage(storage);
  if (!target) return new Set<string>();

  let raw: string | null;
  try {
    raw = target.getItem(FAVORITES_STORAGE_KEY);
  } catch {
    return new Set<string>();
  }
  if (!raw) return new Set<string>();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Set<string>();
  }
  if (!isStringArray(parsed)) return new Set<string>();

  // 顺手剔掉空串：手工改过的数据里常见 `["", "js-event-loop"]`
  return new Set(parsed.filter((id) => id.length > 0));
}

/** 写入收藏集合；写入失败（配额满 / 隐私模式）静默忽略，不影响当次会话 */
export function writeFavorites(
  ids: ReadonlySet<string>,
  storage?: Storage,
): void {
  const target = resolveStorage(storage);
  if (!target) return;
  try {
    target.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // 存储不可用时收藏只在内存里生效，下一次读取会回到空集
  }
}

/** 切换单条收藏，返回新集合（不修改入参，便于 React 做引用比较） */
export function toggleFavorite(
  ids: ReadonlySet<string>,
  id: string,
): Set<string> {
  const next = new Set(ids);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

/** 批量移除已下架题目留下的脏 id（题库删题后调用，保持存储干净） */
export function pruneFavorites(
  ids: ReadonlySet<string>,
  knownIds: ReadonlySet<string>,
): Set<string> {
  const next = new Set<string>();
  for (const id of ids) {
    if (knownIds.has(id)) next.add(id);
  }
  return next;
}
