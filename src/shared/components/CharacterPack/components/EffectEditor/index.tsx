import { useState } from "react";
import { Button, Input, InputNumber, Modal, Select, Switch } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import {
  CAST_TARGETS,
  CAST_UNITS,
  NATURE_META,
  OP_META,
  type PackAttribute,
  type PackModifier,
  type PackNature,
  type PackOp,
} from "../../types";
import "./index.scss";

interface EffectEditorProps {
  open: boolean;
  ownerTitle: string;
  modifiers: PackModifier[];
  attributes: PackAttribute[];
  editingId: string | null;
  onSelect: (id: string | null) => void;
  /** 新增一条指定性质的效果，返回新 id */
  onAdd: (nature: PackNature) => string;
  onUpdate: (id: string, patch: Partial<PackModifier>) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

const TRIGGERS = [
  { value: "", label: "无（常驻生效）" },
  { value: "on_damaged", label: "受到伤害时" },
  { value: "on_kill", label: "击杀目标时" },
  { value: "on_crit", label: "暴击时" },
  { value: "on_low_hp", label: "生命低于阈值时" },
  { value: "on_turn_start", label: "每回合开始时" },
];

const OPS: Array<{ value: PackOp; label: string }> = [
  { value: "add", label: "加算（+n）" },
  { value: "percent", label: "百分比加成（+n%）" },
  { value: "mul", label: "乘算（×n）" },
  { value: "override", label: "覆盖（设为 n）" },
];

const NATURES: PackNature[] = ["passive", "sustained", "cast"];

/**
 * 效果编辑器（C-1）：**先选性质，再填内容**
 *
 * 表单按性质分叉，而不是给一个万能长表单；释放型**不出现「目标属性」字段**
 * （它不指向任何属性），并在顶部明确标注「不计入总属性」。
 */
export default function EffectEditor({
  open,
  ownerTitle,
  modifiers,
  attributes,
  editingId,
  onSelect,
  onAdd,
  onUpdate,
  onRemove,
  onClose,
}: EffectEditorProps) {
  const [pendingTrigger, setPendingTrigger] = useState<{ id: string; trigger: string } | null>(
    null,
  );

  const current = modifiers.find((mod) => mod.id === editingId) ?? null;

  const attrOptions = attributes.map((attr) => ({
    value: attr.id,
    label: attr.unit ? `${attr.name}（${attr.unit}）` : attr.name,
  }));

  const pickNature = (nature: PackNature) => {
    const id = onAdd(nature);
    onSelect(id);
  };

  const changeTrigger = (id: string, trigger: string) => {
    if (trigger) {
      // 有触发条件 → 不计入总属性（§9.2.1 第 4 种组合），必须先让作者确认
      setPendingTrigger({ id, trigger });
      return;
    }
    onUpdate(id, { trigger: "" });
  };

  return (
    <Modal
      open={open}
      title={`效果编辑 · ${ownerTitle}`}
      onCancel={onClose}
      centered
      width={560}
      footer={null}
      className="cpk-fxmodal"
    >
      <div className="cpk-fxmodal__body">
        {/* 已有效果：紧凑列表，点击切换编辑目标 */}
        {modifiers.length > 0 ? (
          <ul className="cpk-fxmodal__list">
            {modifiers.map((mod) => (
              /* 行容器不是交互元素：里面放「选择」与「删除」两个真按钮 ——
                 `<button>` 里嵌 `<button>` 会被浏览器拆坏 DOM，所以删除不能留在选择按钮内部。 */
              <li
                key={mod.id}
                className={`cpk-fxmodal__row${mod.id === editingId ? " is-active" : ""}`}
              >
                <Button className="cpk-fxmodal__pick" onClick={() => onSelect(mod.id)}>
                  <span className={`cpk-bdg is-${mod.nature}`}>{NATURE_META[mod.nature].badge}</span>
                  <span className="cpk-fxmodal__pickname">
                    {mod.name || NATURE_META[mod.nature].label + "效果"}
                  </span>
                  <span className="cpk-fxmodal__pickval">
                    {mod.nature === "cast"
                      ? `${mod.value}${mod.valueUnit}`
                      : `${OP_META[mod.op].symbol}${mod.value}`}
                  </span>
                </Button>
                <Button
                  className="cpk-iconbtn tiny danger"
                  title="删除该条"
                  onClick={() => {
                    onRemove(mod.id);
                    if (mod.id === editingId) onSelect(null);
                  }}
                >
                  <CloseOutlined />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        {/* 第一步：先选性质 */}
        {!current ? (
          <div className="cpk-fxmodal__natures">
            <p className="cpk-fxmodal__tip">先选择效果性质，表单会按性质分叉：</p>
            {NATURES.map((nature) => (
              <Button
                key={nature}
                className={`cpk-ncard is-${nature}`}
                onClick={() => pickNature(nature)}
              >
                <span className={`cpk-bdg is-${nature}`}>{NATURE_META[nature].badge}</span>
                <span className="cpk-ncard__label">{NATURE_META[nature].label}</span>
                <span className="cpk-ncard__hint">{NATURE_META[nature].hint}</span>
              </Button>
            ))}
          </div>
        ) : (
          <div className="cpk-fxmodal__form">
            <div className="cpk-fxmodal__lead">
              <span className={`cpk-bdg is-${current.nature}`}>
                {NATURE_META[current.nature].badge}
              </span>
              <span className="cpk-fxmodal__leadtext">{NATURE_META[current.nature].hint}</span>
            </div>

            <label className="cpk-field">
              <span className="cpk-field__label">名称</span>
              <Input
                size="small"
                value={current.name}
                placeholder={
                  current.nature === "cast" ? "如：风雷一击" : "可留空，留空则不显示名称"
                }
                onChange={(event) => onUpdate(current.id, { name: event.target.value })}
              />
            </label>

            {current.nature !== "cast" ? (
              <>
                <label className="cpk-field">
                  <span className="cpk-field__label">目标属性</span>
                  <Select
                    size="small"
                    value={current.targetAttrId || undefined}
                    placeholder="选择属性"
                    options={attrOptions}
                    classNames={{ popup: { root: "cpk-dropdown" } }}
                    onChange={(value: string) => onUpdate(current.id, { targetAttrId: value })}
                  />
                </label>
                <div className="cpk-field cpk-field--row">
                  <label className="cpk-field cpk-field--half">
                    <span className="cpk-field__label">运算</span>
                    <Select
                      size="small"
                      value={current.op}
                      options={OPS}
                      classNames={{ popup: { root: "cpk-dropdown" } }}
                      onChange={(value: PackOp) => onUpdate(current.id, { op: value })}
                    />
                  </label>
                  <label className="cpk-field cpk-field--half">
                    <span className="cpk-field__label">数值</span>
                    <InputNumber
                      size="small"
                      value={current.value}
                      step={current.op === "mul" ? 0.1 : 1}
                      style={{ width: "100%" }}
                      onChange={(value) => onUpdate(current.id, { value: Number(value) || 0 })}
                    />
                  </label>
                </div>
              </>
            ) : (
              <>
                <div className="cpk-field cpk-field--row">
                  <label className="cpk-field cpk-field--half">
                    <span className="cpk-field__label">效果量</span>
                    <InputNumber
                      size="small"
                      value={current.value}
                      style={{ width: "100%" }}
                      onChange={(value) => onUpdate(current.id, { value: Number(value) || 0 })}
                    />
                  </label>
                  <label className="cpk-field cpk-field--half">
                    <span className="cpk-field__label">单位</span>
                    <Select
                      size="small"
                      value={current.valueUnit || CAST_UNITS[0]}
                      options={CAST_UNITS.map((unit) => ({ value: unit, label: unit }))}
                      classNames={{ popup: { root: "cpk-dropdown" } }}
                      onChange={(value: string) => onUpdate(current.id, { valueUnit: value })}
                    />
                  </label>
                </div>
                <div className="cpk-field cpk-field--row">
                  <label className="cpk-field cpk-field--half">
                    <span className="cpk-field__label">冷却（秒）</span>
                    <InputNumber
                      size="small"
                      value={current.cooldown ?? undefined}
                      style={{ width: "100%" }}
                      onChange={(value) =>
                        onUpdate(current.id, { cooldown: value === null ? null : Number(value) })
                      }
                    />
                  </label>
                  <label className="cpk-field cpk-field--half">
                    <span className="cpk-field__label">目标</span>
                    <Select
                      size="small"
                      value={current.target || CAST_TARGETS[1]}
                      options={CAST_TARGETS.map((item) => ({ value: item, label: item }))}
                      classNames={{ popup: { root: "cpk-dropdown" } }}
                      onChange={(value: string) => onUpdate(current.id, { target: value })}
                    />
                  </label>
                </div>
                <p className="cpk-fxmodal__warn">该条只记录参数，不参与总属性汇总。</p>
              </>
            )}

            {/* 熟练度只有技能才统计：宿主是装备 / 状态时查不到熟练度，缩放会恒取
                下限系数，把数值静默腰斩 —— 干脆不给这个开关 */}
            {current.nature !== "cast" && current.ownerType === "skill" ? (
              <label className="cpk-field cpk-field--row">
                <span className="cpk-field__label">按熟练度缩放</span>
                <Switch
                  size="small"
                  checked={current.scaleByProficiency}
                  onChange={(checked) => onUpdate(current.id, { scaleByProficiency: checked })}
                />
              </label>
            ) : null}

            {current.nature === "sustained" ? (
              <>
                <div className="cpk-field cpk-field--row">
                  <label className="cpk-field cpk-field--half">
                    <span className="cpk-field__label">消耗</span>
                    <Input
                      size="small"
                      value={current.cost}
                      placeholder="如：5 法力/回合"
                      onChange={(event) => onUpdate(current.id, { cost: event.target.value })}
                    />
                  </label>
                  <label className="cpk-field cpk-field--half">
                    <span className="cpk-field__label">持续时间</span>
                    <Input
                      size="small"
                      value={current.duration}
                      placeholder="如：3 回合 / 持续"
                      onChange={(event) => onUpdate(current.id, { duration: event.target.value })}
                    />
                  </label>
                </div>
                {/*
                  剩余回合（REQ-025 时效）。
                  与上面的「持续时间」**不是**同一件事：那个是给人看的自由文本
                  （「一盏茶 / 三息」），这个是**会被判定的数字** —— 到 0 就不再计入
                  总属性。刻意留空为「不限时」，因为给个默认 1 会让新建的状态
                  下一拍就自己过期，而作者根本没填过这一格。
                */}
                <label className="cpk-field cpk-field--row">
                  <span className="cpk-field__label">剩余回合</span>
                  <InputNumber
                    size="small"
                    min={0}
                    value={current.roundsLeft ?? undefined}
                    placeholder="留空 = 不限时"
                    aria-label="剩余回合"
                    style={{ width: "100%" }}
                    onChange={(value) =>
                      onUpdate(current.id, {
                        roundsLeft:
                          value === null || value === undefined
                            ? null
                            : Math.max(0, Math.floor(Number(value))),
                      })
                    }
                  />
                </label>
                <p className="cpk-fxmodal__tip">
                  填 0 即视为已过期：这条会保留在列表里，但暂时不计入总属性。把回合数加回去就恢复。
                </p>
                <label className="cpk-field cpk-field--row">
                  <span className="cpk-field__label">默认开启</span>
                  <Switch
                    size="small"
                    checked={current.defaultOn}
                    onChange={(checked) =>
                      onUpdate(current.id, { defaultOn: checked, active: checked })
                    }
                  />
                </label>
              </>
            ) : null}

            {current.nature !== "cast" ? (
              <label className="cpk-field">
                <span className="cpk-field__label">触发条件</span>
                <Select
                  size="small"
                  value={current.trigger}
                  options={TRIGGERS}
                  classNames={{ popup: { root: "cpk-dropdown" } }}
                  onChange={(value: string) => changeTrigger(current.id, value)}
                />
              </label>
            ) : (
              <label className="cpk-field">
                <span className="cpk-field__label">消耗</span>
                <Input
                  size="small"
                  value={current.cost}
                  placeholder="如：30 法力"
                  onChange={(event) => onUpdate(current.id, { cost: event.target.value })}
                />
              </label>
            )}

            <label className="cpk-field">
              <span className="cpk-field__label">备注</span>
              <Input
                size="small"
                value={current.note}
                onChange={(event) => onUpdate(current.id, { note: event.target.value })}
              />
            </label>
          </div>
        )}
      </div>

      <Modal
        open={pendingTrigger !== null}
        title="该效果将不计入总属性"
        centered
        width={340}
        okText="我确认"
        cancelText="取消"
        onOk={() => {
          if (pendingTrigger) onUpdate(pendingTrigger.id, { trigger: pendingTrigger.trigger });
          setPendingTrigger(null);
        }}
        onCancel={() => setPendingTrigger(null)}
      >
        <p className="cpk-guard__text">
          你选择了触发条件。这类效果属于「事件型」，**不会**计入总属性汇总 ——
          面板只会记录并展示它。
        </p>
      </Modal>

      <div className="cpk-fxmodal__foot">
        <Button size="small" onClick={onClose}>
          完成
        </Button>
      </div>
    </Modal>
  );
}
