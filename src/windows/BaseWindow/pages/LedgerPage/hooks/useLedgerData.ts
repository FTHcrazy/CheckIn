/**
 * 记账数据：分类 + 当前区间流水 + 上一同期支出（环比基准）
 * 只负责取数与写库，派生统计全部交给 ledger-utils 的纯函数
 */
import { useCallback, useEffect, useRef, useState } from "react";
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

  /**
   * 请求序号：连续切周期（本月→本季→本年→本月）会有多个 load 同时在飞，
   * 「本年」数据量最大、返回最慢，极易最后到达 —— 不判序号就会把一整年的
   * 流水写进「本月」视图，环比基准（previousExpense）也跟着错位。
   */
  const seqRef = useRef(0);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    setLoading(true);
    try {
      const [categoryRows, txRows, previousRows] = await Promise.all([
        listCategories(),
        listTransactions({ start: range.start, end: range.end }),
        listTransactions(previousRange(range)),
      ]);
      if (!aliveRef.current || seq !== seqRef.current) return;
      setCategories(categoryRows);
      setTransactions(txRows);
      setPreviousExpense(
        previousRows.reduce(
          (sum, tx) => (tx.type === "expense" ? sum + tx.amount : sum),
          0,
        ),
      );
    } catch (error) {
      // 不静默吞掉：取数失败时留一条痕，否则排障无从下手
      console.error("[useLedgerData] 加载流水失败", error);
    } finally {
      // 只收当前这一次请求的 loading，过期请求不得去关新请求的转圈
      if (seq === seqRef.current) setLoading(false);
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
