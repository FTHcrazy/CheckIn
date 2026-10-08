import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Input, InputNumber, Select, Switch } from "antd";
import PackModuleShell from "../PackModuleShell";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { moduleLabel } from "../module-meta";
import { formatAttrValue } from "../../pack-utils";
import { NATURE_META, OP_META, type PackModifier, type PackNature } from "../../types";
import "./index.scss";

interface StatusModuleProps {
  api: PackPanelApi;
}

const STAT_OPS = (["add", "percent", "mul", "override"] as const).map((op) => ({
  value: op,
  label: OP_META[op].label,
}));

const STAT_NATURES: Array<{ value: PackNature; label: string }> = [
  { value: "sustained", label: `持续（需开启，${NATURE_META.sustained.hint}）` },
  { value: "passive", label: `被动（在效即生效）` },
];

function statText(mod: PackModifier, attrName: string, decimals: number): string {
  const value = formatAttrValue(mod.value, mod.op === "mul" ? 2 : decimals);
  if (mod.op === "percent") return `${attrName} +${value}%`;
  if (mod.op === "mul") return `${attrName} ×${value}`;
  if (mod.op === "override") return `${attrName} 设为 ${value}`;
  return `${attrName} +${value}`;
}

/**
 * 状态效果（REQ-025）
 *
 * 不挂在装备 / 技能上的「持续型」（Buff / Debuff）：中毒扣血、阵法增益、
 * 临时虚弱……这类效果没有载体，所以自己就是载体 —— 开关也在自己身上。
 */
export default function StatusModule({ api }: StatusModuleProps) {
  const doc = api.doc;
  if (!doc) return null;
  const key = "status" as const;
  const statuses = api.statusModifiers;

  const attrOptions = doc.attributes.map((attr) => ({
    value: attr.id,
    label: attr.unit ? `${attr.name}（${attr.unit}）` : attr.name,
  }));

  const add = (nature: PackNature) => {
    const id = api.addStatus({ nature });
    if (id) api.openEffectEditor("status", doc.character.id, "状态效果", id);
  };

  return (
    <PackModuleShell
      title={moduleLabel(key)}
      collapsed={Boolean(api.prefs.collapsed[key])}
      onToggle={() => api.toggleModuleCollapsed(key)}
      actions={
        <>
          <Button className="cpk-btn ghost" onClick={() => add("sustained")}>
            <PlusOutlined />持续
          </Button>
          <Button className="cpk-btn ghost" onClick={() => add("passive")}>
            <PlusOutlined />被动
          </Button>
        </>
      }
    >
      {statuses.length === 0 ? (
        <p className="cpk-empty">
          还没有状态。中毒、虚弱、阵法增益这类「没有装备也没有技能」的效果记在这里，
          持续型可以在剧情里随时开关。
        </p>
      ) : (
        <ul className="cpk-stt__list">
          {statuses.map((mod) => {
            const attr = doc.attributes.find((candidate) => candidate.id === mod.targetAttrId);
            return (
              <li key={mod.id} className={`cpk-stt is-${mod.nature}${mod.active ? " is-on" : ""}`}>
                <div className="cpk-stt__top">
                  <Switch
                    size="small"
                    className="cpk-sw2"
                    checked={mod.active}
                    onChange={() => api.toggleModifierActive(mod.id)}
                    title={mod.active ? "已生效，计入总属性" : "未生效，不计入总属性"}
                  />
                  <Input
                    size="small"
                    value={mod.name}
                    placeholder="状态名（如：中毒）"
                    onChange={(event) => api.updateModifier(mod.id, { name: event.target.value })}
                  />
                  <Button
                    className="cpk-iconbtn tiny"
                    onClick={() => api.openEffectEditor("status", doc.character.id, mod.name || "状态效果", mod.id)}
                    title="详细编辑"
                  >
                    ⋯
                  </Button>
                  <Button
                    className="cpk-iconbtn tiny danger"
                    onClick={() => api.removeModifier(mod.id)}
                    title="删除状态"
                  >
                    <DeleteOutlined />
                  </Button>
                </div>
                <div className="cpk-stt__row">
                  <span className={`cpk-bdg is-${mod.nature}`} title={NATURE_META[mod.nature].hint}>
                    {NATURE_META[mod.nature].badge}
                  </span>
                  <Select
                    size="small"
                    value={mod.nature}
                    options={STAT_NATURES}
                    className="cpk-stt__nature"
                    classNames={{ popup: { root: "cpk-dropdown" } }}
                    onChange={(value: PackNature) => api.updateModifier(mod.id, { nature: value })}
                  />
                  <Select
                    size="small"
                    value={mod.targetAttrId || undefined}
                    placeholder="属性"
                    options={attrOptions}
                    className="cpk-stt__attr"
                    classNames={{ popup: { root: "cpk-dropdown" } }}
                    onChange={(value: string) => api.updateModifier(mod.id, { targetAttrId: value })}
                  />
                  <Select
                    size="small"
                    value={mod.op}
                    options={STAT_OPS}
                    className="cpk-stt__op"
                    classNames={{ popup: { root: "cpk-dropdown" } }}
                    onChange={(value: PackModifier["op"]) => api.updateModifier(mod.id, { op: value })}
                  />
                  <InputNumber
                    size="small"
                    value={mod.value}
                    step={mod.op === "mul" ? 0.1 : 1}
                    style={{ width: 72 }}
                    onChange={(value) => api.updateModifier(mod.id, { value: Number(value) || 0 })}
                  />
                </div>
                <p className="cpk-stt__preview">
                  {attr
                    ? statText(mod, attr.name, attr.decimals ?? 0)
                    : "未选择属性，暂不参与汇总"}
                  {mod.nature === "sustained" && !mod.active ? "（未开启）" : ""}
                  {mod.duration ? ` · 持续 ${mod.duration}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </PackModuleShell>
  );
}
