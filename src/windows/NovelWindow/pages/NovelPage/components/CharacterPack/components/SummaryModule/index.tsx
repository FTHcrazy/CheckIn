import { ThunderboltOutlined } from "@ant-design/icons";
import PackModuleShell from "../PackModuleShell";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { moduleLabel } from "../module-meta";
import { formatAttrValue, type SummaryRow } from "../../pack-utils";
import type { PackAttribute } from "../../types";

interface SummaryModuleProps {
  api: PackPanelApi;
}

/** 增量片段（被动走灰、持续走蓝，与效果徽标同一套颜色语言） */
function segments(row: SummaryRow, attr: PackAttribute) {
  const decimals = attr.decimals ?? 0;
  const items: Array<{ tone: "passive" | "sustained"; text: string }> = [];
  if (row.addPassive) {
    items.push({ tone: "passive", text: `+${formatAttrValue(row.addPassive, decimals)}` });
  }
  if (row.addSustained) {
    items.push({ tone: "sustained", text: `+${formatAttrValue(row.addSustained, decimals)}` });
  }
  const percent = (row.percentPassive || 0) + (row.percentSustained || 0);
  if (percent) {
    items.push({ tone: "sustained", text: `${percent > 0 ? "+" : ""}${formatAttrValue(percent, 1)}%` });
  }
  const mul = row.mulPassive * row.mulSustained;
  if (mul !== 1) items.push({ tone: "sustained", text: `×${formatAttrValue(mul, 2)}` });
  return items;
}

/**
 * 总属性汇总（A-1 / REQ-017）
 *
 * 全部数值都是 `computeSummary` 的输出，组件只做展示 —— 面板上出现的每一个
 * 总览值都必须能在这里点开追到明细，否则作者不敢信。
 */
export default function SummaryModule({ api }: SummaryModuleProps) {
  const doc = api.doc;
  if (!doc) return null;
  const key = "summary" as const;

  // 保持属性自己的顺序（summary.rows 的插入顺序即 attributes 顺序）
  const ordered = doc.attributes
    .map((attr) => api.summary.byAttr.get(attr.id))
    .filter((row): row is SummaryRow => Boolean(row));

  const castCount = api.summary.casts.length;
  const eventCount = api.summary.eventOnly.length;

  return (
    <PackModuleShell
      title={moduleLabel(key)}
      collapsed={Boolean(api.prefs.collapsed[key])}
      onToggle={() => api.toggleModuleCollapsed(key)}
      actions={
        api.dirty > 0 ? <span className="cpk-chip">未保存</span> : null
      }
    >
      {ordered.length === 0 ? (
        <p className="cpk-empty">
          还没有属性。先到「人物属性」加几项，或直接套用一个属性模板。
        </p>
      ) : (
        <ul className="cpk-sum__rows">
          {ordered.map((row) => {
            const attr = doc.attributes.find((candidate) => candidate.id === row.attrId);
            if (!attr) return null;
            const parts = segments(row, attr);
            const conflict = row.overrideCount > 1;
            return (
              <li key={row.attrId}>
                <button
                  type="button"
                  className="cpk-sum__row"
                  onClick={() => api.setDetailAttrId(row.attrId)}
                  title="查看这项属性的来源明细"
                >
                  <span className="cpk-sum__name">{attr.name}</span>
                  <span className="cpk-sum__calc">
                    <span className="cpk-sum__num">
                      {formatAttrValue(row.base, attr.decimals)}
                    </span>
                    <span className="cpk-sum__arrow">→</span>
                    <span
                      className={`cpk-sum__num is-final${row.override !== null ? " is-override" : ""}`}
                    >
                      {formatAttrValue(row.final, attr.decimals)}
                      {attr.unit ? <em className="cpk-sum__unit">{attr.unit}</em> : null}
                    </span>
                  </span>
                  <span className="cpk-sum__seg">
                    {parts.length === 0 ? (
                      <span className="cpk-sum__none">无加成</span>
                    ) : (
                      parts.map((part, index) => (
                        <em key={index} className={`cpk-seg is-${part.tone}`}>
                          {part.text}
                        </em>
                      ))
                    )}
                    {row.override !== null ? (
                      <em className="cpk-seg is-override">
                        {conflict ? `覆盖冲突 ×${row.overrideCount}` : "覆盖生效"}
                      </em>
                    ) : null}
                  </span>
                  {row.contributions.length > 0 ? (
                    <span className="cpk-sum__count">{row.contributions.length} 条来源</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {castCount > 0 || eventCount > 0 ? (
        <p className="cpk-sum__note">
          <ThunderboltOutlined />
          {castCount > 0 ? (
            <span>另有 {castCount} 项主动效果（释放型）不计入总属性</span>
          ) : null}
          {castCount > 0 && eventCount > 0 ? <span>·</span> : null}
          {eventCount > 0 ? <span>{eventCount} 项带触发条件，按事件发生才生效</span> : null}
        </p>
      ) : null}
    </PackModuleShell>
  );
}
