import { useCallback, useMemo } from "react";
import { GroupedVirtuoso } from "react-virtuoso";
import type { LedgerCategoryDTO, LedgerTransactionDTO } from "@/shared/services/ledger";
import type { LedgerDayGroup } from "../../ledger-utils";
import { formatAmount } from "../../ledger-utils";
import LedgerTxRow from "../LedgerTxRow";
import "./index.scss";

interface LedgerTimelineProps {
  groups: readonly LedgerDayGroup[];
  categories: readonly LedgerCategoryDTO[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * 日期分组流水时间线
 * 用 GroupedVirtuoso 虚拟化：长账目下只挂载可视行，
 * 分组结构以 groupCounts + 扁平行数组表达（Virtuoso 只接受一维数据）
 */
export default function LedgerTimeline({
  groups,
  categories,
  onEdit,
  onDelete,
}: LedgerTimelineProps) {
  const groupCounts = useMemo(() => groups.map((group) => group.items.length), [groups]);
  const items = useMemo<LedgerTransactionDTO[]>(
    () => groups.flatMap((group) => group.items),
    [groups],
  );
  const categoryMap = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );

  const handleEdit = useCallback((id: string) => onEdit(id), [onEdit]);
  const handleDelete = useCallback((id: string) => onDelete(id), [onDelete]);

  if (items.length === 0) return null;

  return (
    <GroupedVirtuoso
      className="ld-timeline"
      groupCounts={groupCounts}
      overscan={12}
      computeItemKey={(index) => items[index]?.id ?? String(index)}
      groupContent={(index) => {
        const group = groups[index];
        if (!group) return null;
        return (
          <div className="ld-timeline__head">
            <h3 className="ld-timeline__label">{group.label}</h3>
            <span className="ld-timeline__sums">
              {group.expense > 0 ? (
                <span className="ld-timeline__sum is-expense">
                  支出 {formatAmount(group.expense)}
                </span>
              ) : null}
              {group.income > 0 ? (
                <span className="ld-timeline__sum is-income">
                  收入 {formatAmount(group.income)}
                </span>
              ) : null}
            </span>
          </div>
        );
      }}
      itemContent={(index) => {
        const tx = items[index];
        if (!tx) return null;
        return (
          <LedgerTxRow
            tx={tx}
            category={tx.categoryId ? categoryMap.get(tx.categoryId) : undefined}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        );
      }}
    />
  );
}
