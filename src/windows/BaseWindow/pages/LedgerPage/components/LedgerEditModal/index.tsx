import { DatePicker, Input, Modal, Segmented } from "antd";
import dayjs from "dayjs";
import type { LedgerCategoryDTO } from "@/shared/services/ledger";
import CategoryPicker from "../CategoryPicker";
import { categoriesForType } from "../../ledger-utils";
import "./index.scss";

/** 编辑草稿（由 useLedgerEditorState 持有，弹层只做渲染） */
export interface LedgerEditDraft {
  type: "expense" | "income";
  amountText: string;
  categoryId: string | null;
  note: string;
  happenedAt: string;
}

interface LedgerEditModalProps {
  open: boolean;
  draft: LedgerEditDraft;
  categories: readonly LedgerCategoryDTO[];
  error: string | null;
  submitting: boolean;
  onDraftChange: (patch: Partial<LedgerEditDraft>) => void;
  onClose: () => void;
  onSubmit: () => void;
}

/** 行内编辑弹窗：改类型 / 金额 / 分类 / 备注 / 日期 */
export default function LedgerEditModal({
  open,
  draft,
  categories,
  error,
  submitting,
  onDraftChange,
  onClose,
  onSubmit,
}: LedgerEditModalProps) {
  const available = categoriesForType(categories, draft.type);

  return (
    <Modal
      className="ld-edit"
      open={open}
      onCancel={onClose}
      onOk={onSubmit}
      title="编辑这笔"
      okText="保存"
      cancelText="取消"
      confirmLoading={submitting}
      destroyOnHidden
      centered
    >
      <div className="ld-edit__body">
        <Segmented<"expense" | "income">
          value={draft.type}
          options={[
            { label: "支出", value: "expense" },
            { label: "收入", value: "income" },
          ]}
          onChange={(value) => onDraftChange({ type: value })}
          aria-label="收支类型"
        />

        <div className="ld-edit__row">
          <span className="ld-edit__currency">¥</span>
          <Input
            className={`ld-edit__amount${error ? " is-error" : ""}`}
            value={draft.amountText}
            onChange={(event) => onDraftChange({ amountText: event.target.value })}
            inputMode="decimal"
            placeholder="0.00"
            aria-label="金额"
            aria-invalid={Boolean(error)}
          />
          <DatePicker
            value={dayjs(draft.happenedAt.slice(0, 10))}
            onChange={(value) =>
              onDraftChange({
                happenedAt: value
                  ? `${value.format("YYYY-MM-DD")}${draft.happenedAt.slice(10)}`
                  : draft.happenedAt,
              })
            }
            allowClear={false}
            aria-label="发生日期"
          />
        </div>
        {error ? <p className="ld-edit__error">{error}</p> : null}

        <CategoryPicker
          categories={available}
          value={draft.categoryId}
          onChange={(categoryId) => onDraftChange({ categoryId })}
        />

        <Input
          value={draft.note}
          onChange={(event) => onDraftChange({ note: event.target.value })}
          placeholder="备注（可选）"
          maxLength={60}
          aria-label="备注"
        />
      </div>
    </Modal>
  );
}
