import { memo } from "react";
import { Popconfirm } from "antd";
import { DeleteOutlined, EditOutlined } from "@ant-design/icons";
import type { LedgerCategoryDTO, LedgerTransactionDTO } from "@/shared/services/ledger";
import { renderCategoryIcon, colorVar, weakColorVar } from "../../constants/categories";
import { formatSignedAmount } from "../../ledger-utils";
import "./index.scss";

interface LedgerTxRowProps {
  tx: LedgerTransactionDTO;
  category: LedgerCategoryDTO | undefined;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * 单行流水
 * memo + 稳定回调（父层传 id，不在行内新建函数），保证虚拟列表滚动时不重渲染无关行
 */
function LedgerTxRow({ tx, category, onEdit, onDelete }: LedgerTxRowProps) {
  const color = category?.color ?? "--app-text-muted";

  return (
    <li className="ld-row">
      <span
        className="ld-row__icon"
        style={{ background: weakColorVar(color), color: colorVar(color) }}
      >
        {renderCategoryIcon(category?.icon ?? "EllipsisOutlined")}
      </span>
      <span className="ld-row__main">
        <span className="ld-row__title">{category?.name ?? "未分类"}</span>
        {tx.note ? <span className="ld-row__note">{tx.note}</span> : null}
      </span>
      <span className={`ld-row__amount${tx.type === "income" ? " is-income" : " is-expense"}`}>
        {formatSignedAmount(tx.type, tx.amount)}
      </span>
      <span className="ld-row__actions">
        <button
          type="button"
          className="ld-row__action"
          onClick={() => onEdit(tx.id)}
          aria-label="编辑这笔"
        >
          <EditOutlined />
        </button>
        <Popconfirm
          title="删除这笔？"
          description="删除后 5 秒内可撤销"
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={() => onDelete(tx.id)}
        >
          <button type="button" className="ld-row__action" aria-label="删除这笔">
            <DeleteOutlined />
          </button>
        </Popconfirm>
      </span>
    </li>
  );
}

export default memo(LedgerTxRow);
