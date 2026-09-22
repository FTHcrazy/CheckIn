/**
 * 记账数据：分类 + 当前区间流水 + 上一同期支出（环比基准）
 * 只负责取数与写库，派生统计全部交给 ledger-utils 的纯函数
 */
import { useCallback, useEffect, useState } from "react";
import {
  deleteTransaction,
  listCategories,
  listTransactions,
  restoreTransaction,
  updateTransaction,
} from "@/shared/services/ledger";
import type { LedgerCategoryDTO, LedgerTransactionDTO } from "@/shared/services/ledger";
import { previousRange } from "../ledger-utils";
import type { LedgerRange } from "../ledger-utils";

export interface LedgerDataResult {
  loading: boolean;
  categories: LedgerCategoryDTO[];
  transactions: LedgerTransactionDTO[];
  /** 上一同期支出合计，用于环比 */
  previousExpense: number;
  reload: () => void;
  removeTransaction: (id: string) => Promise<void>;
  restore: (tx: LedgerTransactionDTO) => Promise<void>;
  saveTransaction: (
    id: string,
    updates: Partial<Pick<LedgerTransactionDTO, "type" | "amount" | "categoryId" | "note" | "happenedAt">>,
  ) => Promise<void>;
}

export function useLedgerData(range: LedgerRange): LedgerDataResult {
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<LedgerCategoryDTO[]>([]);
  const [transactions, setTransactions] = useState<LedgerTransactionDTO[]>([]);
  const [previousExpense, setPreviousExpense] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [categoryRows, txRows, previousRows] = await Promise.all([
        listCategories(),
        listTransactions({ start: range.start, end: range.end }),
        listTransactions(previousRange(range)),
      ]);
      setCategories(categoryRows);
      setTransactions(txRows);
      setPreviousExpense(
        previousRows.reduce(
          (sum, tx) => (tx.type === "expense" ? sum + tx.amount : sum),
          0,
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [range.start, range.end]);

  useEffect(() => {
    void load();
  }, [load]);

  const removeTransaction = useCallback(async (id: string) => {
    await deleteTransaction(id);
    setTransactions((current) => current.filter((tx) => tx.id !== id));
  }, []);

  const restore = useCallback(async (tx: LedgerTransactionDTO) => {
    await restoreTransaction(tx);
    await load();
  }, [load]);

  const saveTransaction = useCallback<LedgerDataResult["saveTransaction"]>(
    async (id, updates) => {
      await updateTransaction(id, updates);
      await load();
    },
    [load],
  );

  return {
    loading,
    categories,
    transactions,
    previousExpense,
    reload: load,
    removeTransaction,
    restore,
    saveTransaction,
  };
}
