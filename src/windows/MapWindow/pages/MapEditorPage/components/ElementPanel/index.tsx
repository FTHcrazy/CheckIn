/**
 * 素材属性面板（R-MAP-23）。
 *
 * ── 心智模型 ──
 * 选中素材 = 进入「这个对象长什么样」的语境（逆向目标的三栏范式：左栏"用什么画"、
 * 画布"在哪里"、本面板"长什么样"）。四件套（尺寸 / 旋转 / 不透明度 / 色相）+
 * 层级 + 地名 + 排序与增删，全部围绕**当前这一个**素材。
 *
 * ── 组件边界 ──
 * 纯受控展示：所有值来自 props，所有变更走回调。地名草稿（nameDraft）留在页面
 * ——它跨"选中素材的联动地名"与"新建标注的默认字号"两个状态域，面板不该知道。
 */

import {
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  VerticalAlignBottomOutlined,
  VerticalAlignTopOutlined,
} from "@ant-design/icons";
import { Button, Divider, Input, Select, Slider, Tooltip } from "antd";
import {
  ELEMENT_OPACITY_MAX,
  ELEMENT_OPACITY_MIN,
  ELEMENT_TINT_NONE,
  type MapElement,
  type MapLabel,
} from "../../types";
import { levelLabelOf, type RegionLevelDef } from "../../regions";
import "./index.scss";

interface ElementPanelProps {
  element: MapElement;
  /** 素材展示名（来自 SPRITE_MAP，调用方解析 —— 面板不 import 素材表） */
  spriteName: string;
  /** 联动地名（`null` = 还没起名；地名输入框据此回填） */
  label: MapLabel | null;
  /** 层级定义（决定「层级」下拉的选项与命名；空数组 = 未生成区块） */
  schema: readonly RegionLevelDef[];
  /** 地名输入框显示值（页面持有草稿：`null` = 跟随文档值） */
  nameDraft: string | null;
  onNameDraftChange: (value: string) => void;
  onNameCommit: () => void;
  /** 改属性；`coalesceKey` 让滑杆一次拖动只占一步撤销 */
  onUpdate: (
    patch: Partial<Pick<MapElement, "scale" | "rotation" | "opacity" | "tint" | "level">>,
    coalesceKey?: string,
  ) => void;
  onReorder: (to: "front" | "back") => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}

/** 「层级」下拉里"层级无关"的哨兵值（Select 需要 string 值，null 表达不了） */
const LEVEL_LOOSE = "loose";

export default function ElementPanel({
  element,
  spriteName,
  label,
  schema,
  nameDraft,
  onNameDraftChange,
  onNameCommit,
  onUpdate,
  onReorder,
  onDuplicate,
  onDelete,
  onClose,
}: ElementPanelProps) {
  /* 层级选项：层级无关 + schema 各级；层级数被削减后选中的旧层级也要能显示 */
  const levelOptions = [
    { value: LEVEL_LOOSE, label: "层级无关（恒可见）" },
    ...schema.map((_, i) => ({ value: String(i), label: levelLabelOf(schema, i) })),
  ];
  const levelValue =
    element.level === null
      ? LEVEL_LOOSE
      : String(Math.min(element.level, Math.max(0, schema.length - 1)));

  return (
    <div className="element-panel" data-testid="element-panel">
      <div className="element-panel__header">
        <span className="element-panel__title" title={spriteName}>
          {spriteName}
        </span>
        <Tooltip title="关闭属性面板（Esc 取消选中同样可关闭）">
          <Button
            size="small"
            type="text"
            icon={<CloseOutlined />}
            aria-label="关闭素材属性"
            onClick={onClose}
          />
        </Tooltip>
      </div>

      {/* 地名：与工具栏时代同一个 placeholder —— 联动语义不变（随素材移动、一起删除） */}
      <Input
        size="small"
        value={nameDraft ?? label?.text ?? ""}
        placeholder="地名"
        allowClear
        onChange={(e) => onNameDraftChange(e.target.value)}
        onBlur={onNameCommit}
        onKeyDown={(e) => {
          // IME 组字中的回车属于输入法（确认候选词），不是"提交"
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            onNameCommit();
          }
        }}
      />

      <div className="element-panel__row">
        <span className="element-panel__label">尺寸</span>
        <Slider
          className="element-panel__slider"
          min={0.4}
          max={3}
          step={0.05}
          value={element.scale}
          tooltip={{ formatter: (v) => `×${(v ?? 1).toFixed(2)}` }}
          onChange={(v) => onUpdate({ scale: v }, `el:${element.id}:scale`)}
        />
        <span className="element-panel__value">{`×${element.scale.toFixed(2)}`}</span>
      </div>

      <div className="element-panel__row">
        <span className="element-panel__label">旋转</span>
        <Slider
          className="element-panel__slider"
          min={0}
          max={360}
          step={1}
          value={element.rotation}
          tooltip={{ formatter: (v) => `${Math.round(v ?? 0)}°` }}
          onChange={(v) => onUpdate({ rotation: v }, `el:${element.id}:rotation`)}
        />
        <span className="element-panel__value">{`${Math.round(element.rotation)}°`}</span>
      </div>

      <div className="element-panel__row">
        <span className="element-panel__label">不透明</span>
        <Slider
          className="element-panel__slider"
          min={Math.round(ELEMENT_OPACITY_MIN * 100)}
          max={Math.round(ELEMENT_OPACITY_MAX * 100)}
          step={5}
          value={Math.round((element.opacity ?? ELEMENT_OPACITY_MAX) * 100)}
          tooltip={{ formatter: (v) => `${Math.round(v ?? 100)}%` }}
          onChange={(v) => onUpdate({ opacity: v / 100 }, `el:${element.id}:opacity`)}
        />
        <span className="element-panel__value">
          {`${Math.round((element.opacity ?? ELEMENT_OPACITY_MAX) * 100)}%`}
        </span>
      </div>

      <div className="element-panel__row">
        <span className="element-panel__label">色相</span>
        <Slider
          className="element-panel__slider element-panel__slider--hue"
          min={0}
          max={360}
          step={5}
          value={element.tint ?? ELEMENT_TINT_NONE}
          tooltip={{ formatter: (v) => ((v ?? 0) === 0 ? "原色" : `${Math.round(v ?? 0)}°`) }}
          onChange={(v) => onUpdate({ tint: v }, `el:${element.id}:tint`)}
        />
        <span className="element-panel__value">
          {(element.tint ?? ELEMENT_TINT_NONE) === 0 ? "原色" : `${Math.round(element.tint ?? 0)}°`}
        </span>
      </div>

      <div className="element-panel__row">
        <span className="element-panel__label">层级</span>
        <Select
          className="element-panel__level"
          size="small"
          value={levelValue}
          options={levelOptions}
          onChange={(v) => onUpdate({ level: v === LEVEL_LOOSE ? null : Number(v) })}
        />
      </div>

      <Divider style={{ margin: "2px 0" }} />

      <div className="element-panel__actions">
        <Tooltip title="置顶：画到所有素材之上">
          <Button
            size="small"
            icon={<VerticalAlignTopOutlined />}
            aria-label="置顶素材"
            onClick={() => onReorder("front")}
          />
        </Tooltip>
        <Tooltip title="置底：垫到所有素材之下">
          <Button
            size="small"
            icon={<VerticalAlignBottomOutlined />}
            aria-label="置底素材"
            onClick={() => onReorder("back")}
          />
        </Tooltip>
        <Tooltip title="复制一份（Ctrl+D / Ctrl+C 后 Ctrl+V）">
          <Button
            size="small"
            icon={<CopyOutlined />}
            aria-label="复制素材"
            onClick={onDuplicate}
          />
        </Tooltip>
        <Tooltip title="删除素材（联动地名一起删，可撤销）">
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            aria-label="删除素材"
            onClick={onDelete}
          />
        </Tooltip>
      </div>
    </div>
  );
}
