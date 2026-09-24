import type { StatusSheetContent, StatusTotalRow } from "./types";

function parseStat(value: string): number {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * R5 状态汇总（纯函数，汇总栏唯一数据来源）：
 * 总值 = 基础当前值 + Σ永久加成 + Σ激活中条目的激活加成。
 * 只做同源加减累加，无乘区/套装逻辑（PRD Non-goal）。
 * 汇总是 content 的投影，永远不落库——单一数据源防止两处真值。
 */
export function computeTotals(content: StatusSheetContent): StatusTotalRow[] {
  const baseById = new Map<string, { name: string; base: number }>();
  for (const group of content.groups) {
    for (const entry of group.entries) {
      if (entry.kind === "number") {
        baseById.set(entry.id, { name: entry.name, base: parseStat(entry.value) });
      }
    }
  }

  const rows = new Map<string, StatusTotalRow>();
  for (const group of content.groups) {
    for (const entry of group.entries) {
      for (const bonus of entry.bonuses ?? []) {
        const target = baseById.get(bonus.attrId);
        // 加成目标已被删除时忽略（正常流程会级联清理，此处兜底）
        if (!target) continue;
        let row = rows.get(bonus.attrId);
        if (!row) {
          row = {
            attrId: bonus.attrId,
            attrName: target.name,
            base: target.base,
            bonus: 0,
            total: target.base,
            sources: [],
          };
          rows.set(bonus.attrId, row);
        }
        const on = bonus.mode === "permanent" || entry.active === true;
        row.sources.push({
          entryId: entry.id,
          entryName: entry.name,
          amount: bonus.amount,
          mode: bonus.mode,
          on,
        });
        if (on) {
          row.bonus += bonus.amount;
          row.total = row.base + row.bonus;
        }
      }
    }
  }
  return Array.from(rows.values());
}
