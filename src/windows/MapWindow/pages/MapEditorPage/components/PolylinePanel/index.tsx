/**
 * 折线属性面板（B4-2 / R-MAP-26）。
 *
 * ── 心智模型 ──
 * 选中一条线 = 进入「这条线长什么样」的语境。与素材属性面板（ElementPanel）
 * 同位、同样互斥：素材选中与折线选中本来就不能同时成立（点选是单选）。
 *
 * ── 为什么只有四行 ──
 * 线的"好看"靠样式档（`polylineStyle.ts` 的五档），不是靠一堆自由参数：
 * 颜色 / 虚线密度 / 双线与否都在档内定好了，用户只需要选档 + 微调粗细。
 * 把颜色也做成自由取色器，会立刻得到"不像任何一张参考图"的组合（PRD D8）。
 *
 * ── 组件边界 ──
 * 纯受控展示：值来自 `polyline`，变更走 `onUpdate`。标签输入框的本地草稿留在
 * 组件内（只有它需要"边打边不落库"），提交时一次性写文档。
 */

import { CloseOutlined, DeleteOutlined } from "@ant-design/icons";
import { Button, Divider, Input, Select, Slider, Switch, Tooltip } from "antd";
import { useEffect, useState } from "react";
import type { MapPolyline } from "../../types";
import { levelLabelOf, type RegionLevelDef } from "../../regions";
import {
  POLYLINE_STYLES,
  POLYLINE_WIDTH_SCALE_MAX,
  POLYLINE_WIDTH_SCALE_MIN,
  polylineStyleOf,
} from "../../polylineStyle";
import "./index.scss";

interface PolylinePanelProps {
  polyline: MapPolyline;
  /** 层级定义（决定「层级」下拉的选项；空数组 = 未生成区块） */
  schema: readonly RegionLevelDef[];
  /** 改属性；`coalesceKey` 让滑杆一次拖动只占一步撤销 */
  onUpdate: (
    patch: Partial<
      Pick<MapPolyline, "styleId" | "kind" | "level" | "label" | "closed" | "widthScale">
    >,
    coalesceKey?: string,
  ) => void;
  onDelete: () => void;
  onClose: () => void;
}

/** 「层级」下拉里"层级无关"的哨兵值（Select 需要 string 值，null 表达不了） */
const LEVEL_LOOSE = "loose";

export default function PolylinePanel({
  polyline,
  schema,
  onUpdate,
  onDelete,
  onClose,
}: PolylinePanelProps) {
  const style = polylineStyleOf(polyline.styleId, polyline.kind);

  /**
   * 标签草稿。
   *
   * 【为什么要本地草稿】`onUpdate` 每敲一个字就写一次文档，撤销栈会被打字刷满
   * （虽然能靠 coalesceKey 压步，但"输入框内容"本来就该由输入框自己持有）。
   * 换选中对象时按 id 重置，避免把上一条线的名字带进来。
   */
  const [labelDraft, setLabelDraft] = useState(polyline.label ?? "");
  useEffect(() => {
    setLabelDraft(polyline.label ?? "");
  }, [polyline.id, polyline.label]);

  const commitLabel = () => {
    const next = labelDraft.trim();
    if (next === (polyline.label ?? "")) return;
    // 空串 = 清掉标签（不写 `label: ""`，否则存档里躺着一个空字段）
    onUpdate(next ? { label: next } : { label: undefined });
  };

  const levelOptions = [
    { value: LEVEL_LOOSE, label: "层级无关（恒可见）" },
    ...schema.map((_, i) => ({ value: String(i), label: levelLabelOf(schema, i) })),
  ];
  const levelValue =
    polyline.level === null
      ? LEVEL_LOOSE
      : String(Math.min(polyline.level, Math.max(0, schema.length - 1)));

  return (
    <div className="polyline-panel" data-testid="polyline-panel">
      <div className="polyline-panel__header">
        <span className="polyline-panel__title" title={style.hint}>
          {style.label}
        </span>
        <Tooltip title="关闭属性面板（Esc 取消选中同样可关闭）">
          <Button
            size="small"
            type="text"
            icon={<CloseOutlined />}
            aria-label="关闭折线属性"
            onClick={onClose}
          />
        </Tooltip>
      </div>

      <Input
        size="small"
        value={labelDraft}
        placeholder="名称（如「官道」「清河」）"
        allowClear
        onChange={(e) => setLabelDraft(e.target.value)}
        onBlur={commitLabel}
        onKeyDown={(e) => {
          // IME 组字中的回车属于输入法（确认候选词），不是"提交"
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            commitLabel();
          }
        }}
      />

      <div className="polyline-panel__row">
        <span className="polyline-panel__label">样式</span>
        <Select
          className="polyline-panel__control"
          size="small"
          value={style.id}
          aria-label="折线样式"
          options={POLYLINE_STYLES.map((s) => ({ value: s.id, label: s.label }))}
          onChange={(v) => {
            // 换样式档时 `kind` 跟着档走：`kind` 只用于"没有 styleId 时回退到哪档"，
            // 两者不一致会让老文档的回退结果莫名其妙
            const next = POLYLINE_STYLES.find((s) => s.id === v);
            onUpdate({ styleId: v, ...(next ? { kind: next.kind } : {}) });
          }}
        />
      </div>

      <div className="polyline-panel__row">
        <span className="polyline-panel__label">粗细</span>
        <Slider
          className="polyline-panel__slider"
          min={POLYLINE_WIDTH_SCALE_MIN}
          max={POLYLINE_WIDTH_SCALE_MAX}
          step={0.05}
          value={polyline.widthScale ?? 1}
          tooltip={{ formatter: (v) => `×${(v ?? 1).toFixed(2)}` }}
          onChange={(v) => onUpdate({ widthScale: v }, `pl:${polyline.id}:width`)}
        />
        <span className="polyline-panel__value">{`×${(polyline.widthScale ?? 1).toFixed(2)}`}</span>
      </div>

      {/* 闭合（B4-3）：湖岸 / 势力轮廓是"绕一圈回到出发点"的线。
          少于 3 个点画不出闭合形，开关禁用而不是静默不生效。 */}
      <div className="polyline-panel__row">
        <span className="polyline-panel__label">闭合</span>
        <Tooltip title="首尾相连（湖泊 / 轮廓）。绘制时点回起点也能闭合。">
          <Switch
            size="small"
            checked={polyline.closed && polyline.points.length >= 3}
            disabled={polyline.points.length < 3}
            aria-label="折线首尾相连"
            onChange={(v) => onUpdate({ closed: v })}
          />
        </Tooltip>
      </div>

      <div className="polyline-panel__row">
        <span className="polyline-panel__label">层级</span>
        <Select
          className="polyline-panel__control"
          size="small"
          value={levelValue}
          aria-label="折线层级"
          options={levelOptions}
          onChange={(v) => onUpdate({ level: v === LEVEL_LOOSE ? null : Number(v) })}
        />
      </div>

      <Divider style={{ margin: "2px 0" }} />

      <div className="polyline-panel__actions">
        <Tooltip title="删除这条折线（可撤销；双击节点是删单个点）">
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            aria-label="删除折线"
            onClick={onDelete}
          />
        </Tooltip>
        <span className="polyline-panel__hint">双击线上加一个节点，双击节点删掉它</span>
      </div>
    </div>
  );
}
