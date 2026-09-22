import { useState } from "react";
import dayjs from "dayjs";
import {
  Button,
  DatePicker,
  Input,
  Modal,
  Popover,
  Segmented,
} from "antd";
import { CalendarOutlined } from "@ant-design/icons";
import type { LedgerCategoryDTO } from "@/shared/services/ledger";
import { colorVar, renderCategoryIcon, weakColorVar } from "../../constants/categories";
import { categoriesForType } from "../../ledger-utils";
import "./index.scss";

interface QuickAddBarProps {
  open: boolean;
  type: "expense" | "income";
  onTypeChange: (type: "expense" | "income") => void;
  amountText: string;
  onAmountChange: (value: string) => void;
  categoryId: string | null;
  onCategoryChange: (categoryId: string) => void;
  date: string;
  onDateChange: (date: string) => void;
  categories: readonly LedgerCategoryDTO[];
  note: string;
  onNoteChange: (note: string) => void;
  error: string | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: () => void;
}

/**
 * 快捷记一笔：屏幕居中弹窗（antd Modal 承载遮罩 / Esc / 焦点管理）
 * 视觉对齐设计稿的三行布局：
 *   行1 收支分段 + ¥金额胶囊 + 行内错误
 *   行2 紧凑胶囊分类
 *   行3 备注 + 今天胶囊（可改期）+ 快捷键提示 + 保存
 */
export default function QuickAddBar({
  open,
  type,
  onTypeChange,
  amountText,
  onAmountChange,
  categoryId,
  onCategoryChange,
  date,
  onDateChange,
  categories,
  note,
  onNoteChange,
  error,
  submitting,
  onClose,
  onSubmit,
}: QuickAddBarProps) {
  const available = categoriesForType(categories, type);
  const isToday = date === dayjs().format("YYYY-MM-DD");
  const dateLabel = isToday ? "今天" : dayjs(date).format("MM-DD");
  const [datePopOpen, setDatePopOpen] = useState(false);

  const datePanel = (
    <DatePicker
      autoFocus
      open
      defaultValue={dayjs(date)}
      onChange={(value) => {
        if (value) {
          onDateChange(value.format("YYYY-MM-DD"));
          setDatePopOpen(false);
        }
      }}
      needConfirm={false}
      format="YYYY-MM-DD"
    />
  );

  return (
    <Modal
      className="ld-quick"
      open={open}
      onCancel={onClose}
      centered
      width={640}
      footer={null}
      closable={false}
      maskClosable
      keyboard
      destroyOnHidden
    >
      <div className="ld-quick__bar">
        {/* 行1：收支 + 金额 + 错误 */}
        <div className="ld-quick__row">
          <Segmented<"expense" | "income">
            value={type}
            options={[
              { label: "支出", value: "expense" },
              { label: "收入", value: "income" },
            ]}
            onChange={onTypeChange}
            aria-label="收支类型"
          />

          <label className={`ld-quick__amount${error ? " is-error" : ""}`}>
            <span className="ld-quick__currency">¥</span>
            <Input
              className="ld-quick__amount-input"
              value={amountText}
              onChange={(event) => onAmountChange(event.target.value)}
              onPressEnter={onSubmit}
              placeholder="0.00"
              inputMode="decimal"
              autoFocus
              variant="borderless"
              aria-label="金额"
              aria-invalid={Boolean(error)}
            />
          </label>

          {error ? (
            <span className="ld-quick__err" role="alert">
              {error}
            </span>
          ) : null}
        </div>

        {/* 行2：紧凑胶囊分类 */}
        <div className="ld-quick__row">
          <div className="ld-quick__cats" role="radiogroup" aria-label="选择分类">
            {available.map((category) => {
              const active = category.id === categoryId;
              const style = active
                ? {
                    background: weakColorVar(category.color),
                    color: colorVar(category.color),
                  }
                : undefined;
              return (
                <button
                  key={category.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`ld-quick__chip${active ? " is-on" : ""}`}
                  style={style}
                  onClick={() => onCategoryChange(category.id)}
                >
                  <span
                    className="ld-quick__chip-icon"
                    style={{ color: colorVar(category.color) }}
                  >
                    {renderCategoryIcon(category.icon)}
                  </span>
                  <span className="ld-quick__chip-name">{category.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 行3：备注 + 今天 + 提示 + 保存 */}
        <div className="ld-quick__row">
          <Input
            className="ld-quick__note"
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            onPressEnter={onSubmit}
            placeholder="备注（可选）"
            maxLength={60}
            aria-label="备注"
          />

          <Popover
            content={datePanel}
            trigger="click"
            placement="topRight"
            arrow={false}
            open={datePopOpen}
            onOpenChange={setDatePopOpen}
          >
            <button type="button" className="ld-quick__date" aria-label="选择日期">
              <CalendarOutlined />
              {dateLabel}
            </button>
          </Popover>

          <span className="ld-quick__tip">
            <b>Enter</b> 保存 · <b>Esc</b> 关闭
          </span>

          <Button
            type="primary"
            loading={submitting}
            onClick={onSubmit}
            className="ld-quick__save"
          >
            保存
          </Button>
        </div>
      </div>
    </Modal>
  );
}
