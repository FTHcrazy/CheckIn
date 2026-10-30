/**
 * 设定中心 · 从全局库选择（D2 / REQ-041）
 *
 * 多选建立引用：勾选即引用，本书侧只读、改动随全局自动同步。
 * 本书已有境界体系时，全局 realm 只能作为普通分类引入（U6）——
 * 「每书至多一个 realm」是主进程硬约束，UI 只负责提前把后果说清。
 */

import { Empty, Modal, Checkbox } from "antd";
import {
  formatReferenceCountLabel,
} from "@/shared/novel/setting-reference";
import type { SettingCategory } from "@/shared/novel/setting-types";
import "./index.scss";

export interface GlobalCategoryPickerProps {
  open: boolean;
  /** 全局库分类列表 */
  categories: SettingCategory[];
  /** 已勾选的全局分类 id */
  pickedIds: string[];
  /** 本书是否已有境界体系（决定全局 realm 是否降级为普通分类） */
  bookHasRealm: boolean;
  onToggle: (globalId: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export default function GlobalCategoryPicker({
  open,
  categories,
  pickedIds,
  bookHasRealm,
  onToggle,
  onSubmit,
  onCancel,
}: GlobalCategoryPickerProps) {
  return (
    <Modal
      open={open}
      title="从全局库选择设定"
      okText="加入本书"
      cancelText="取消"
      width={520}
      okButtonProps={{ disabled: pickedIds.length === 0 }}
      onOk={onSubmit}
      onCancel={onCancel}
    >
      <div className="nv-sc__picker">
        <p className="nv-sc__tip">
          加入后为「引用」：本书只读，改动随全局自动同步；不需要了可随时取消。
        </p>
        {categories.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="全局库还没有设定分类"
          />
        ) : (
          categories.map((category) => (
            <label key={category.id} className="nv-sc__picker-row">
              <Checkbox
                checked={pickedIds.includes(category.id)}
                onChange={() => onToggle(category.id)}
              />
              <span
                className="nv-sc__dot"
                style={{ background: category.color }}
                aria-hidden
              />
              <span className="nv-sc__picker-name">{category.name}</span>
              <span className="nv-sc__picker-kind">
                {category.kind === "realm" ? "境界体系" : "自定义"}
              </span>
              <span className="nv-sc__picker-count">
                {formatReferenceCountLabel(category.refCount ?? 0)}
              </span>
              {/* U6：本书已有 realm 时，全局 realm 只能作为普通分类引入 */}
              {category.kind === "realm" && bookHasRealm && (
                <span className="nv-sc__picker-note">
                  本书已有境界体系，已作为普通分类引入
                </span>
              )}
            </label>
          ))
        )}
      </div>
    </Modal>
  );
}
