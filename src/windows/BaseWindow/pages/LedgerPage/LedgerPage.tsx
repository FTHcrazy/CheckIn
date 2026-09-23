import { useCallback, useEffect, useMemo } from "react";
import Page from "@/shared/components/Page";
import { useLedgerData } from "./hooks/useLedgerData";
import { useLedgerViewState } from "./store/useLedgerViewStore";
import { useLedgerEditorState } from "./hooks/useLedgerEditorState";
import LedgerPeriodBar from "./components/LedgerPeriodBar";
import LedgerOverviewCard from "./components/LedgerOverviewCard";
import LedgerCategoryPie from "./components/LedgerCategoryPie";
import LedgerFilterBar from "./components/LedgerFilterBar";
import LedgerTimeline from "./components/LedgerTimeline";
import LedgerEmpty from "./components/LedgerEmpty";
import LedgerFab from "./components/LedgerFab";
import QuickAddBar from "./components/QuickAddBar";
import LedgerEditModal from "./components/LedgerEditModal";
import {
  buildCategorySlices,
  buildTrend,
  filterTransactions,
  groupByDate,
  growthRate,
  summarize,
  toDateKey,
} from "./ledger-utils";
import "./index.scss";

/** 趋势回溯天数（设计规格：近 30 天） */
const TREND_DAYS = 30;

/** 编辑弹窗关闭时的空草稿：必须是常量，否则每次渲染都造新对象、击穿 memo */
const EMPTY_EDIT_DRAFT = {
  type: "expense" as const,
  amountText: "",
  categoryId: null,
  note: "",
  happenedAt: "",
};

/**
 * 记账页
 * 布局：周期条 → （总览 + 占比）→ 流水；主操作为右下角 FAB
 * 派生统计全部由 ledger-utils 的纯函数计算，本页只做编排
 */
export default function LedgerPage() {
  const view = useLedgerViewState();
  const data = useLedgerData(view.range);
  const editor = useLedgerEditorState({
    categories: data.categories,
    transactions: data.transactions,
    removeTransaction: data.removeTransaction,
    restore: data.restore,
    saveTransaction: data.saveTransaction,
    reload: data.reload,
  });

  const todayKey = useMemo(() => toDateKey(new Date()), []);

  const filtered = useMemo(
    () =>
      filterTransactions(
        data.transactions,
        { keyword: view.keyword, type: view.type, categoryId: view.categoryId },
        data.categories,
      ),
    [data.categories, data.transactions, view.categoryId, view.keyword, view.type],
  );

  const groups = useMemo(() => groupByDate(filtered, todayKey), [filtered, todayKey]);
  const summary = useMemo(() => summarize(data.transactions), [data.transactions]);
  const slices = useMemo(
    () => buildCategorySlices(data.transactions, data.categories, view.pieType),
    [data.categories, data.transactions, view.pieType],
  );
  const trend = useMemo(
    () => buildTrend(data.transactions, view.range.end, TREND_DAYS),
    [data.transactions, view.range.end],
  );
  const expenseGrowth = useMemo(
    () => growthRate(summary.expense, data.previousExpense),
    [data.previousExpense, summary.expense],
  );

  // 提交回调收敛成稳定引用：此前这里是两个内联箭头，
  // 父层每渲染一次就换一批身份，弹层上的 memo 会被立刻击穿
  const submitQuick = useCallback(() => {
    void editor.submitQuick();
  }, [editor.submitQuick]);
  const submitEdit = useCallback(() => {
    void editor.submitEdit();
  }, [editor.submitEdit]);

  // 全局唤起：⌘/Ctrl + Shift + L（设计规格 D-2）
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "l") {
        event.preventDefault();
        editor.openQuick();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editor.openQuick]);

  const hasFilter = view.keyword.trim().length > 0 || view.type !== "all" || Boolean(view.categoryId);

  return (
    <Page>
      <div className="ledger-page">
        <LedgerPeriodBar
          period={view.period}
          range={view.range}
          balance={summary.balance}
          expenseGrowth={expenseGrowth}
          onPeriodChange={view.setPeriod}
          onRangeChange={view.setCustomRange}
        />

        <div className="ledger-page__mid">
          <LedgerOverviewCard summary={summary} points={trend} loading={data.loading} />
          <LedgerCategoryPie
            slices={slices}
            total={view.pieType === "expense" ? summary.expense : summary.income}
            pieType={view.pieType}
            onPieTypeChange={view.setPieType}
          />
        </div>

        <div className="ledger-page__flow">
          <LedgerFilterBar
            keyword={view.keyword}
            onKeywordChange={view.setKeyword}
            type={view.type}
            onTypeChange={view.setType}
            categories={data.categories}
            categoryId={view.categoryId}
            onCategoryChange={view.setCategoryId}
            count={filtered.length}
          />
          {data.loading ? (
            <div className="ledger-page__skeleton" />
          ) : groups.length === 0 ? (
            <LedgerEmpty filtered={hasFilter} onCreate={editor.openQuick} />
          ) : (
            <LedgerTimeline
              groups={groups}
              categories={data.categories}
              onEdit={editor.openEdit}
              onDelete={editor.handleDelete}
            />
          )}
        </div>

        <LedgerFab onClick={editor.openQuick} />
      </div>

      <QuickAddBar
        open={editor.quickOpen}
        type={editor.draft.type}
        onTypeChange={editor.setQuickType}
        amountText={editor.draft.amountText}
        onAmountChange={editor.setQuickAmount}
        categoryId={editor.draft.categoryId}
        onCategoryChange={editor.setQuickCategory}
        date={editor.draft.date}
        onDateChange={editor.setQuickDate}
        categories={data.categories}
        note={editor.draft.note}
        onNoteChange={editor.setQuickNote}
        error={editor.amountError}
        submitting={editor.submitting}
        onClose={editor.closeQuick}
        onSubmit={submitQuick}
      />

      <LedgerEditModal
        open={Boolean(editor.editTarget)}
        draft={editor.editDraft ?? EMPTY_EDIT_DRAFT}
        categories={data.categories}
        error={editor.editError}
        submitting={editor.submitting}
        onDraftChange={editor.patchEditDraft}
        onClose={editor.closeEdit}
        onSubmit={submitEdit}
      />
    </Page>
  );
}
