import { useMemo, useState } from "react";
import { Button, Switch } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { NATURE_META, type PackAttribute, type PackModifier, type PackNature } from "../../types";
import { formatAttrValue } from "../../pack-utils";
import "./index.scss";

interface ModifierListProps {
  modifiers: PackModifier[];
  attributes: PackAttribute[];
  /** 载体（装备 / 技能 / 状态）当前是否在效；不在效时整组呈停用态 */
  ownerActive: boolean;
  onOpenEditor: (modifierId?: string) => void;
  onToggleActive: (id: string) => void;
  onToggleDisabled: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  /** 点击 cast 型效果里引用的属性 → 定位到汇总（只读引用，不参与计算） */
  onJumpAttribute?: (attrId: string) => void;
}

const NATURE_ORDER: PackNature[] = ["passive", "sustained", "cast"];

function attrName(attributes: PackAttribute[], id: string): string {
  return attributes.find((attr) => attr.id === id)?.name ?? "未指定属性";
}

function attrDecimals(attributes: PackAttribute[], id: string): number {
  return attributes.find((attr) => attr.id === id)?.decimals ?? 0;
}

/** 被动 / 持续型的数值文案：`攻击力 +320` / `防御力 +40%` */
function statText(mod: PackModifier, attributes: PackAttribute[]): string {
  const name = attrName(attributes, mod.targetAttrId);
  const value = formatAttrValue(mod.value, mod.op === "mul" ? 2 : attrDecimals(attributes, mod.targetAttrId));
  switch (mod.op) {
    case "percent":
      return `${name} +${value}%`;
    case "mul":
      return `${name} ×${value}`;
    case "override":
      return `${name} 设为 ${value}`;
    default:
      return `${name} +${value}`;
  }
}

/** 释放型的参数文案：`300% 攻击力 · CD 12s · 耗蓝 30 · 单体` */
function castText(mod: PackModifier): string {
  const parts: string[] = [];
  if (mod.value) parts.push(`${formatAttrValue(mod.value, 0)}${mod.valueUnit || ""}`);
  if (mod.cooldown) parts.push(`CD ${mod.cooldown}s`);
  if (mod.cost) parts.push(mod.cost);
  if (mod.target) parts.push(mod.target);
  return parts.join(" · ");
}

/** 该条为何不计入汇总（避免作者以为面板漏算） */
function excludedReason(mod: PackModifier): string {
  if (mod.disabled) return "已禁用，暂不生效";
  if (mod.nature === "cast") return "主动释放型，不计入总属性";
  if (mod.nature === "sustained" && !mod.active) return "持续效果未开启，未计入";
  if (mod.nature === "passive" && mod.trigger) return "有触发条件（事件型），不计入总属性";
  return "";
}

/**
 * 效果词条列表（装备 / 技能 / 状态共用）
 *
 * 三种性质在视觉上一眼可分：`被`灰 / `持`蓝+独立开关 / `放`橙+折叠。
 * 持续型效果**自带开关**，与载体开关完全分离（REQ-039）。
 */
export default function ModifierList({
  modifiers,
  attributes,
  ownerActive,
  onOpenEditor,
  onToggleActive,
  onToggleDisabled,
  onDuplicate,
  onRemove,
  onJumpAttribute,
}: ModifierListProps) {
  const [castsOpen, setCastsOpen] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<PackNature, PackModifier[]>();
    for (const nature of NATURE_ORDER) map.set(nature, []);
    for (const mod of modifiers) map.get(mod.nature)?.push(mod);
    return map;
  }, [modifiers]);

  const casts = groups.get("cast") ?? [];
  const acted = (groups.get("passive") ?? []).concat(groups.get("sustained") ?? []);

  const renderRow = (mod: PackModifier) => {
    const meta = NATURE_META[mod.nature];
    const reason = excludedReason(mod);
    return (
      <li
        key={mod.id}
        className={`cpk-efrow is-${mod.nature}${mod.disabled ? " is-off" : ""}`}
      >
        <span className={`cpk-bdg is-${mod.nature}`} title={meta.hint}>
          {meta.badge}
        </span>
        <span className="cpk-efrow__body">
          {mod.nature === "cast" ? (
            <>
              <span className="cpk-efrow__name">{mod.name || "未命名主动效果"}</span>
              <span className="cpk-efrow__value">{castText(mod)}</span>
              {/* 释放型引用的属性可点击定位（只读引用，不参与计算） */}
              {onJumpAttribute
                ? attributes
                    .filter((attr) => mod.valueUnit.startsWith(attr.name))
                    .slice(0, 1)
                    .map((attr) => (
                      <Button
                        key={attr.id}
                        className="cpk-attrref"
                        onClick={() => onJumpAttribute(attr.id)}
                        title="查看该属性当前值（只读引用）"
                      >
                        {attr.name} 当前值 ▸
                      </Button>
                    ))
                : null}
            </>
          ) : (
            <>
              {mod.name ? <span className="cpk-efrow__name">{mod.name}</span> : null}
              <span className="cpk-efrow__value">{statText(mod, attributes)}</span>
              {mod.scaleByProficiency ? (
                <span className="cpk-efrow__tag">按熟练度缩放</span>
              ) : null}
              {mod.nature === "sustained" && mod.cost ? (
                <span className="cpk-efrow__tag">消耗 {mod.cost}</span>
              ) : null}
              {mod.nature === "sustained" && mod.duration ? (
                <span className="cpk-efrow__tag">持续 {mod.duration}</span>
              ) : null}
            </>
          )}
          {reason ? <span className="cpk-efrow__excluded">{reason}</span> : null}
        </span>

        {/* 持续型效果自己的开关：与载体开关互不影响 */}
        {mod.nature === "sustained" ? (
          <Switch
            size="small"
            className="cpk-sw2"
            checked={mod.active}
            onChange={() => onToggleActive(mod.id)}
            title={mod.active ? "已开启，计入总属性" : "未开启，不计入总属性"}
          />
        ) : null}

        <span className="cpk-efrow__ops">
          <Button
            className="cpk-iconbtn tiny"
            onClick={() => onOpenEditor(mod.id)}
            title="编辑"
          >
            <EditOutlined />
          </Button>
          <Button
            className="cpk-iconbtn tiny"
            onClick={() => onDuplicate(mod.id)}
            title="复制一条"
          >
            <PlusOutlined />
          </Button>
          <Button
            className={`cpk-iconbtn tiny${mod.disabled ? " is-active" : ""}`}
            onClick={() => onToggleDisabled(mod.id)}
            title={mod.disabled ? "启用这条效果" : "临时禁用（保留配置）"}
          >
            ⊘
          </Button>
          <Button
            className="cpk-iconbtn tiny danger"
            onClick={() => onRemove(mod.id)}
            title="删除"
          >
            <DeleteOutlined />
          </Button>
        </span>
      </li>
    );
  };

  return (
    <div className={`cpk-eflist${ownerActive ? "" : " is-paused"}`}>
      {acted.length === 0 && casts.length === 0 ? (
        <p className="cpk-eflist__empty">
          还没有效果。点「+ 被动」写常驻加成，点「+ 释放」写主动技能参数。
        </p>
      ) : null}

      {acted.length > 0 ? <ul className="cpk-eflist__rows">{acted.map(renderRow)}</ul> : null}

      {casts.length > 0 ? (
        <>
          <Button
            className="cpk-castnote"
            onClick={() => setCastsOpen((open) => !open)}
          >
            <ThunderboltOutlined />
            <span>主动效果 {casts.length} 项</span>
            <span className="cpk-castnote__warn">不计入总属性</span>
            <span className="cpk-castnote__caret">{castsOpen ? "▴" : "▾"}</span>
          </Button>
          {castsOpen ? <ul className="cpk-eflist__rows">{casts.map(renderRow)}</ul> : null}
        </>
      ) : null}

      <div className="cpk-eflist__add">
        <Button className="cpk-btn ghost" onClick={() => onOpenEditor()}>
          + 新增效果
        </Button>
      </div>
    </div>
  );
}
