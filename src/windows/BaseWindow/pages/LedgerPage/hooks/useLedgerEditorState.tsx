/**
 * 记账编辑态：快捷记一笔表单 / 行内编辑弹窗 / 删除与撤销
 * 表单状态与校验集中在此，弹层组件只做渲染
 */
import { useCallback, useMemo, useState } from "react";
import dayjs from "dayjs";
import { App, Button } from "antd";
import { addTransaction } from "@/shared/services/ledger";
import type { LedgerCategoryDTO, LedgerTransactionDTO } from "@/shared/services/ledger";
import type { LedgerEditDraft } from "../components/LedgerEditModal";
import { formatSignedAmount, guessDefaultCategory, parseAmountInput } from "../ledger-utils";

/** 当前本地时间 HH:mm:ss（与 addTransaction 内部 nowLocal 的时分秒格式一致） */
function nowTimePart(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

interface QuickDraft {
  type: "expense" | "income";
  amountText: string;
  categoryId: string | null;
  note: string;
  /** 本地日期 YYYY-MM-DD，配合当前时分秒落库 */
  date: string;
}

interface UseLedgerEditorParams {
  categories: readonly LedgerCategoryDTO[];
  transactions: readonly LedgerTransactionDTO[];
  removeTransaction: (id: string) => Promise<void>;
  restore: (tx: LedgerTransactionDTO) => Promise<void>;
  saveTransaction: (
    id: string,
    updates: Partial<Pick<LedgerTransactionDTO, "type" | "amount" | "categoryId" | "note" | "happenedAt">>,
  ) => Promise<void>;
  reload: () => void;
}

const UNDO_DURATION = 5;

export function useLedgerEditorState({
  categories,
  transactions,
  removeTransaction,
  restore,
  saveTransaction,
  reload,
}: UseLedgerEditorParams) {
  const { message } = App.useApp();

  const [quickOpen, setQuickOpen] = useState(false);
  const [draft, setDraft] = useState<QuickDraft>({
    type: "expense",
    amountText: "",
    categoryId: null,
    note: "",
    date: dayjs().format("YYYY-MM-DD"),
  });
  const [submitting, setSubmitting] = useState(false);

  const [editTarget, setEditTarget] = useState<LedgerTransactionDTO | null>(null);
  const [editDraft, setEditDraft] = useState<LedgerEditDraft | null>(null);

  const openQuick = useCallback(() => {
    setDraft({
      type: "expense",
      amountText: "",
      categoryId: guessDefaultCategory(transactions, categories, "expense"),
      note: "",
      date: dayjs().format("YYYY-MM-DD"),
    });
    setQuickOpen(true);
  }, [categories, transactions]);

  const closeQuick = useCallback(() => setQuickOpen(false), []);

  const setQuickType = useCallback(
    (type: "expense" | "income") => {
      setDraft((current) => ({
        ...current,
        type,
        categoryId: guessDefaultCategory(transactions, categories, type),
      }));
    },
    [categories, transactions],
  );

  const setQuickAmount = useCallback((amountText: string) => {
    setDraft((current) => ({ ...current, amountText }));
  }, []);

  const setQuickNote = useCallback((note: string) => {
    setDraft((current) => ({ ...current, note }));
  }, []);

  const setQuickCategory = useCallback((categoryId: string) => {
    setDraft((current) => ({ ...current, categoryId }));
  }, []);

  const setQuickDate = useCallback((date: string) => {
    setDraft((current) => ({ ...current, date }));
  }, []);

  const amountError = useMemo(() => parseAmountInput(draft.amountText).error, [draft.amountText]);

  const submitQuick = useCallback(async () => {
    const parsed = parseAmountInput(draft.amountText);
    if (!parsed.ok) {
      message.warning(parsed.error ?? "请输入大于 0 的金额");
      return;
    }
    setSubmitting(true);
    try {
      const saved = await addTransaction({
        type: draft.type,
        amount: parsed.value,
        categoryId: draft.categoryId,
        note: draft.note.trim(),
        happenedAt: `${draft.date} ${nowTimePart()}`,
      });
      if (!saved) {
        message.error("保存失败，请重试");
        return;
      }
      message.success(`已记一笔 ${formatSignedAmount(saved.type, saved.amount)}`);
      setQuickOpen(false);
      await reload();
    } finally {
      setSubmitting(false);
    }
  }, [draft, message, reload]);

  const openEdit = useCallback((id: string) => {
    const tx = transactions.find((item) => item.id === id);
    if (!tx) return;
    setEditTarget(tx);
    setEditDraft({
      type: tx.type === "income" ? "income" : "expense",
      amountText: tx.amount.toFixed(2),
      categoryId: tx.categoryId,
      note: tx.note,
      happenedAt: tx.happenedAt,
    });
  }, [transactions]);

  const closeEdit = useCallback(() => {
    setEditTarget(null);
    setEditDraft(null);
  }, []);

  const patchEditDraft = useCallback((patch: Partial<LedgerEditDraft>) => {
    setEditDraft((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const editError = useMemo(
    () => (editDraft ? parseAmountInput(editDraft.amountText).error : null),
    [editDraft],
  );

  const submitEdit = useCallback(async () => {
    if (!editTarget || !editDraft) return;
    const parsed = parseAmountInput(editDraft.amountText);
    if (!parsed.ok) {
      message.warning(parsed.error ?? "请输入大于 0 的金额");
      return;
    }
    setSubmitting(true);
    try {
      await saveTransaction(editTarget.id, {
        type: editDraft.type,
        amount: parsed.value,
        categoryId: editDraft.categoryId,
        note: editDraft.note.trim(),
        happenedAt: editDraft.happenedAt,
      });
      message.success("已更新");
      closeEdit();
    } finally {
      setSubmitting(false);
    }
  }, [closeEdit, editDraft, editTarget, message, saveTransaction]);

  const handleDelete = useCallback(
    async (id: string) => {
      const tx = transactions.find((item) => item.id === id);
      if (!tx) return;
      await removeTransaction(id);
      const key = `ledger-undo-${tx.id}`;
      message.open({
        key,
        type: "success",
        duration: UNDO_DURATION,
        content: (
          <span>
            已删除 1 笔
            <Button
              type="link"
              size="small"
              onClick={() => {
                void restore(tx).then(() => {
                  message.destroy(key);
                  message.success("已撤销");
                });
                void reload();
              }}
            >
              撤销
            </Button>
          </span>
        ),
      });
    },
    [message, reload, removeTransaction, restore, transactions],
  );

  return {
    quickOpen,
    draft,
    amountError,
    submitting,
    openQuick,
    closeQuick,
    setQuickType,
    setQuickAmount,
    setQuickNote,
    setQuickCategory,
    setQuickDate,
    submitQuick,
    editTarget,
    editDraft,
    editError,
    openEdit,
    closeEdit,
    patchEditDraft,
    submitEdit,
    handleDelete,
  };
}
