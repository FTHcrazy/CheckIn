/**
 * 按书独立的章节序号规则（1.34.0）
 *
 * 背景：章节后缀 / 数字样式原先存在全局排版设置里，所有书共用一份 ——
 * 导入的书多是「第N章」阿拉伯数字，手写的书可能是「第一章」中文，
 * 互相一改就串味。这里把规则降级为**按书记录**：
 *
 * - 存储：config 表的 `novel_work_numbering` 键，`Record<workId, 规则>` 整读整写
 * - 语义：全局设置里的 numberStyle / chapterSuffix / volumeSuffix 退化为
 *   「无记录作品的默认值」；某本书一旦有记录（导入自适应 / 手动改过），覆盖即生效
 * - 读写都走 `window.electronAPI.novel.configGet/configSet`，本文件不含 React，
 *   书架页与编辑器页（互不导入）都从这里拿，避免两份口径
 */

import { STORAGE_KEYS, type WorkNumberingRule } from "./constants";

/** 单本书的规则允许只覆盖部分字段（例如只改过后缀） */
export type WorkNumberingEntry = Partial<WorkNumberingRule>;

/** config JSON → 规则映射（损坏数据安全回退空表） */
export function parseWorkNumbering(raw: string | null): Record<string, WorkNumberingEntry> {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const source = parsed as Record<string, unknown>;
    const result: Record<string, WorkNumberingEntry> = {};
    for (const [workId, value] of Object.entries(source)) {
      if (!workId || value === null || typeof value !== "object" || Array.isArray(value)) {
        continue;
      }
      const rule = value as Record<string, unknown>;
      const entry: WorkNumberingEntry = {};
      if (rule.numberStyle === "arabic" || rule.numberStyle === "chinese") {
        entry.numberStyle = rule.numberStyle;
      }
      if (typeof rule.chapterSuffix === "string" && rule.chapterSuffix) {
        entry.chapterSuffix = rule.chapterSuffix;
      }
      if (typeof rule.volumeSuffix === "string" && rule.volumeSuffix) {
        entry.volumeSuffix = rule.volumeSuffix;
      }
      if (Object.keys(entry).length > 0) result[workId] = entry;
    }
    return result;
  } catch {
    return {};
  }
}

/** 拉取全书规则映射（键不存在 / IPC 失败返回空表，由上层回退默认值） */
export async function fetchWorkNumbering(): Promise<Record<string, WorkNumberingEntry>> {
  try {
    const raw = await window.electronAPI!.novel.configGet(STORAGE_KEYS.workNumbering);
    return parseWorkNumbering(raw ?? null);
  } catch {
    return {};
  }
}

/**
 * 把某本书的规则写进映射（读改写；低频小数据，不需要事务）。
 * 传 `null` 删除该书记录（回退默认值）。
 */
export async function saveWorkNumberingRule(
  workId: string,
  rule: WorkNumberingEntry | null,
): Promise<boolean> {
  if (!workId) return false;
  try {
    const map = await fetchWorkNumbering();
    if (rule && Object.keys(rule).length > 0) {
      map[workId] = { ...map[workId], ...rule };
    } else {
      delete map[workId];
    }
    return await window.electronAPI!.novel.configSet(
      STORAGE_KEYS.workNumbering,
      JSON.stringify(map),
    );
  } catch {
    return false;
  }
}

/**
 * 把某本书的规则叠加到全局设置上：无记录 / 字段缺失时保留全局值。
 *
 * 泛型不限定 EditorSettings —— 书架侧的 ShelfNumberStyle 同样适用。
 */
export function applyWorkNumbering<T extends WorkNumberingRule>(
  base: T,
  workId: string,
  map: Record<string, WorkNumberingEntry>,
): T {
  const rule = workId ? map[workId] : undefined;
  if (!rule) return base;
  return {
    ...base,
    ...(rule.numberStyle !== undefined ? { numberStyle: rule.numberStyle } : null),
    ...(rule.chapterSuffix !== undefined ? { chapterSuffix: rule.chapterSuffix } : null),
    ...(rule.volumeSuffix !== undefined ? { volumeSuffix: rule.volumeSuffix } : null),
  };
}

/** 从规则映射里取某本书的规则（无记录返回 null） */
export function workNumberingOf(
  workId: string,
  map: Record<string, WorkNumberingEntry>,
): WorkNumberingEntry | null {
  const rule = workId ? map[workId] : undefined;
  return rule && Object.keys(rule).length > 0 ? rule : null;
}
