/**
 * 设定中心 · 普通分类拆分弹窗（UI-10 拆分）
 *
 * 把一阶拆成多行子层级：子层级从第 1 段起编号、挂在原阶之下；原阶变成分组
 * （不占小层段），绑在它上面的「当前境界」不失效，可随时合并还原为一阶。
 * 只复用 `setting-primitives.scss` 的公共零件，不再单独出样式。
 */

import { Input, Modal } from "antd";
import { SPLIT_PARTS_MAX } from "../../setting-center-shared";

export interface SplitLevelModalProps {
  open: boolean;
  /** 被拆分的等级名（拼进标题） */
  targetName: string;
  parts: string;
  onPartsChange: (value: string) => void;
  pattern: string;
  onPatternChange: (value: string) => void;
  /** 段名与段区间预览 */
  preview: Array<{ name: string; segFrom: number; segTo: number }>;
  onSubmit: () => void;
  onCancel: () => void;
}

export default function SplitLevelModal({
  open,
  targetName,
  parts,
  onPartsChange,
  pattern,
  onPatternChange,
  preview,
  onSubmit,
  onCancel,
}: SplitLevelModalProps) {
  return (
    <Modal
      open={open}
      title={`为「${targetName}」新增子层级`}
      okText="新增"
      cancelText="取消"
      width={520}
      onOk={onSubmit}
      onCancel={onCancel}
    >
      <div className="nv-sc__batch">
        <p className="nv-sc__tip">
          子层级从第 1 段起编号，挂在原阶之下；原阶变成分组（不占小层段），绑在它上面的「当前境界」不失效，可随时合并还原为一阶。
        </p>
        <div className="nv-sc__batch-fields">
          <label className="nv-sc__field is-narrow">
            <span>子层级数量（2–{SPLIT_PARTS_MAX}）</span>
            <Input
              size="small"
              value={parts}
              inputMode="numeric"
              aria-label="子层级数量"
              onChange={(event) => onPartsChange(event.target.value)}
            />
          </label>
          <label className="nv-sc__field">
            <span>子层级命名模板（留空 = 原名 · 第N段）</span>
            <Input
              size="small"
              value={pattern}
              placeholder="{name} · 第{n}段 / {name}·{n} / 固定名单：初期,中期,后期,圆满"
              aria-label="子层级命名模板"
              onChange={(event) => onPatternChange(event.target.value)}
            />
          </label>
        </div>
        <div className="nv-sc__carry-example">
          <em>预览</em>
          <span>
            {preview.length > 0
              ? preview
                  .map(
                    (segment) =>
                      `${segment.name}（小层 ${segment.segFrom}–${segment.segTo}）`,
                  )
                  .join(" / ")
              : "—"}
          </span>
        </div>
      </div>
    </Modal>
  );
}
