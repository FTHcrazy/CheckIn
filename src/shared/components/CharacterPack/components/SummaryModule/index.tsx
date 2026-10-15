import { Button } from "antd";
import { ThunderboltOutlined } from "@ant-design/icons";
import PackModuleShell from "../PackModuleShell";
import PackExportButton from "../PackExportButton";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { moduleLabel } from "../module-meta";
import { attrSegments, formatAttrValue, type SummaryRow } from "../../pack-utils";
import "./index.scss";

interface SummaryModuleProps {
  api: PackPanelApi;
}

/**
 * 总属性汇总（A-1 / REQ-017）
 *
 * 全部数值都是 `computeSummary` 的输出，组件只做展示 —— 面板上出现的每一个
 * 总览值都必须能在这里点开追到明细，否则作者不敢信。
 *
 * （REQ-037 的「估算 / 临时加成」已按 1.39.1 产品决策下线：试算结果与真实
 * 汇总同管线同源，作者却总把它当成「没保存的数据」，鸡肋大于价值。
 * 穿戴 Δ 预览（REQ-018）仍走 `computeHypotheticalSummary`，不受影响。）
 */
export default function SummaryModule({ api }: SummaryModuleProps) {
  const doc = api.doc;
  if (!doc) return null;
  const key = "summary" as const;

  // 保持属性自己的顺序（summary.rows 的插入顺序即 attributes 顺序）
  const ordered = api.attrView
    .map((attr) => api.summary.byAttr.get(attr.id))
    .filter((row): row is SummaryRow => Boolean(row));

  const castCount = api.summary.casts.length;
  const eventCount = api.summary.eventOnly.length;
  // 时效已过的持续型（REQ-025）。单列一句而不是并进「带触发条件」：
  // 前者是期望内的暂停（加回回合数就恢复），后者是设计如此，混着说会让作者去改触发条件。
  const expiredCount = api.summary.expired.length;
  // 组停用（Phase 2 闸门 0）。与 expired 同层单列：前者是「这一类都没了」，
  // 后者是「到回合了」（加回回合数就恢复）。
  // 分组管理 UI 已全部下线（1.41.0 物品栏 / 本版装备栏），这一路只剩数据层
  // 兜底：模板种的组默认全启用，只有旧数据里被停用的组还会走到这里。
  const groupOffCount = api.summary.groupOff.length;

  return (
    <PackModuleShell
      title={moduleLabel(key)}
      collapsed={Boolean(api.prefs.collapsed[key])}
      onToggle={() => api.toggleModuleCollapsed(key)}
      actions={
        <>
          <PackExportButton api={api} moduleKey="summary" label={moduleLabel(key)} />
          {api.dirty > 0 ? <span className="cpk-chip">未保存</span> : null}
        </>
      }
    >
      {ordered.length === 0 ? (
        <p className="cpk-empty">
          还没有属性。先到「人物属性」加几项，或直接套用一个属性模板。
        </p>
      ) : (
        <ul className="cpk-sum__rows">
          {ordered.map((row) => {
            const attr = api.attrView.find((candidate) => candidate.id === row.attrId);
            if (!attr) return null;
            const parts = attrSegments(row, attr.decimals ?? 0);            const conflict = row.overrideCount > 1;
            return (
              <li key={row.attrId}>
                <Button
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
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {castCount > 0 || eventCount > 0 || expiredCount > 0 || groupOffCount > 0 ? (
        <p className="cpk-sum__note">
          <ThunderboltOutlined />
          {castCount > 0 ? (
            <span>另有 {castCount} 项主动效果（释放型）不计入总属性</span>
          ) : null}
          {castCount > 0 && (eventCount > 0 || expiredCount > 0 || groupOffCount > 0) ? <span>·</span> : null}
          {eventCount > 0 ? <span>{eventCount} 项带触发条件，按事件发生才生效</span> : null}
          {eventCount > 0 && (expiredCount > 0 || groupOffCount > 0) ? <span>·</span> : null}
          {expiredCount > 0 ? <span>{expiredCount} 项时效已过，暂时不计入</span> : null}
          {expiredCount > 0 && groupOffCount > 0 ? <span>·</span> : null}
          {groupOffCount > 0 ? <span>{groupOffCount} 项所在分组已停用，恢复分组后计入</span> : null}
        </p>
      ) : null}
    </PackModuleShell>
  );
}
