import { useMemo } from "react";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { formatAttrValue, type SummaryDelta } from "../../pack-utils";
import "./index.scss";

interface SummaryDeltaListProps {
  api: PackPanelApi;
  deltas: SummaryDelta[];
  /** 一条都没变时的文案（装备与估算的语境不同，不能共用一句） */
  emptyText?: string;
}

/**
 * Δ 清单（REQ-018 / REQ-037 共用）
 *
 * 只列**真的会变**的属性：没变的行不占位。作者看这张表时问的是「换这件值不值」，
 * 一张大半是「0」的表只会把真正在意的那两行淹掉。
 */
export function SummaryDeltaList({
  api,
  deltas,
  emptyText = "总属性没有变化",
}: SummaryDeltaListProps) {
  const doc = api.doc;
  if (!doc) return null;

  if (deltas.length === 0) {
    return <p className="cpk-delta__none">{emptyText}</p>;
  }

  return (
    <ul className="cpk-delta__list">
      {deltas.map((item) => {
        const attr = doc.attributes.find((candidate) => candidate.id === item.attrId);
        if (!attr) return null;
        const decimals = attr.decimals ?? 0;
        const up = item.delta > 0;
        return (
          <li key={item.attrId} className={`cpk-delta__row is-${up ? "up" : "down"}`}>
            <span className="cpk-delta__name">{attr.name}</span>
            <span className="cpk-delta__calc">
              <span className="cpk-delta__from">{formatAttrValue(item.before, decimals)}</span>
              <span className="cpk-delta__arrow">→</span>
              <span className="cpk-delta__after">{formatAttrValue(item.after, decimals)}</span>
            </span>
            <em className="cpk-delta__chip">
              {up ? "+" : ""}
              {formatAttrValue(item.delta, decimals)}
              {attr.unit}
            </em>
          </li>
        );
      })}
    </ul>
  );
}

interface EquipDeltaPreviewProps {
  api: PackPanelApi;
  itemId: string;
  slotId: string;
}

/**
 * 穿戴 Δ 预览（REQ-018）
 *
 * 挂到浮层里，**只在浮层真正展开时才计算**（antd 的 Popover 内容为惰性挂载）——
 * 候选列表里有几件就预计算几遍完整汇总管线，是这类功能的典型性能陷阱。
 */
export default function EquipDeltaPreview({ api, itemId, slotId }: EquipDeltaPreviewProps) {
  const deltas = useMemo(
    () => api.previewEquipDeltas(itemId, slotId),
    [api, itemId, slotId],
  );

  return (
    <div className="cpk-delta">
      <p className="cpk-delta__title">装上后</p>
      <SummaryDeltaList api={api} deltas={deltas} emptyText="穿上后总属性不变" />
    </div>
  );
}
