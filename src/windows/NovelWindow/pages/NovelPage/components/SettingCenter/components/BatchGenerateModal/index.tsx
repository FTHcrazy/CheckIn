/**
 * 设定中心 · 批量生成弹窗（UI-10 拆分）
 *
 * 逐行输入 / 模板生成两种模式，名称顺序即阶梯序，全部追加到末尾（1.37.0）。
 * 只复用 `setting-primitives.scss` 的公共零件，不再单独出样式。
 */

import { Input, Modal, Segmented } from "antd";
import type { BatchMode } from "../../setting-center-shared";

export interface BatchGenerateModalProps {
  open: boolean;
  mode: BatchMode;
  onModeChange: (mode: BatchMode) => void;
  lines: string;
  onLinesChange: (value: string) => void;
  count: string;
  onCountChange: (value: string) => void;
  pattern: string;
  onPatternChange: (value: string) => void;
  /** 逐行去重去空 / 模板按数量渲染后的预览名 */
  names: string[];
  onSubmit: () => void;
  onCancel: () => void;
}

export default function BatchGenerateModal({
  open,
  mode,
  onModeChange,
  lines,
  onLinesChange,
  count,
  onCountChange,
  pattern,
  onPatternChange,
  names,
  onSubmit,
  onCancel,
}: BatchGenerateModalProps) {
  return (
    <Modal
      open={open}
      title="批量生成等级"
      okText="生成"
      cancelText="取消"
      width={520}
      okButtonProps={{ disabled: names.length === 0 }}
      onOk={onSubmit}
      onCancel={onCancel}
    >
      <div className="nv-sc__batch">
        <Segmented
          value={mode}
          aria-label="批量生成模式"
          options={[
            { value: "lines", label: "逐行输入" },
            { value: "pattern", label: "模板生成" },
          ]}
          onChange={(value) => onModeChange(value as BatchMode)}
        />
        {mode === "lines" ? (
          <Input.TextArea
            rows={6}
            value={lines}
            placeholder={"每行一个等级名，顺序即阶梯序：\n练气\n筑基\n金丹\n元婴"}
            aria-label="批量等级名（每行一个）"
            onChange={(event) => onLinesChange(event.target.value)}
          />
        ) : (
          <div className="nv-sc__batch-fields">
            <label className="nv-sc__field is-narrow">
              <span>数量（1–99）</span>
              <Input
                size="small"
                value={count}
                inputMode="numeric"
                aria-label="生成数量"
                onChange={(event) => onCountChange(event.target.value)}
              />
            </label>
            <label className="nv-sc__field">
              <span>命名模板</span>
              <Input
                size="small"
                value={pattern}
                placeholder="第{n}阶 / 练气第{n}层 / 固定名单：初期,中期,后期,圆满"
                aria-label="批量命名模板"
                onChange={(event) => onPatternChange(event.target.value)}
              />
            </label>
          </div>
        )}
        <div className="nv-sc__carry-example">
          <em>预览</em>
          <span>
            {names.length > 0
              ? `${names.slice(0, 6).join(" → ")}${names.length > 6 ? ` … 共 ${names.length} 条` : ""}`
              : "—"}
          </span>
        </div>
      </div>
    </Modal>
  );
}
