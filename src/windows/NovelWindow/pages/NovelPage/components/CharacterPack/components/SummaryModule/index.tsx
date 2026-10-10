import { Button, InputNumber, Select } from "antd";
import { DeleteOutlined, PlusOutlined, ThunderboltOutlined } from "@ant-design/icons";
import PackModuleShell from "../PackModuleShell";
import PackExportButton from "../PackExportButton";
import { SummaryDeltaList } from "../DeltaPreview";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { moduleLabel } from "../module-meta";
import { formatAttrValue, type SummaryRow } from "../../pack-utils";
import { OP_META, type PackAttribute, type PackModifier } from "../../types";
import "./index.scss";

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

const OP_OPTIONS = (["add", "percent", "mul", "override"] as const).map((op) => ({
  value: op,
  label: OP_META[op].label,
}));

/**
 * 总属性汇总（A-1 / REQ-017）+ 估算模式（REQ-037）
 *
 * 全部数值都是 `computeSummary` 的输出，组件只做展示 —— 面板上出现的每一个
 * 总览值都必须能在这里点开追到明细，否则作者不敢信。
 *
 * 估算模式走的是**另一条**汇总（`computeHypotheticalSummary`，同一个管线换一份输入），
 * 结果只在开关打开且有临时加成时存在。临时加成不落库、不计未保存改动 ——
 * 它是「试算」，不是「一份要维护的数据」。
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
  // 时效已过的持续型（REQ-025）。单列一句而不是并进「带触发条件」：
  // 前者是期望内的暂停（加回回合数就恢复），后者是设计如此，混着说会让作者去改触发条件。
  const expiredCount = api.summary.expired.length;
  const estimating = api.estimateOn && api.estimateEntries.length > 0;
  const attrOptions = doc.attributes.map((attr) => ({
    value: attr.id,
    label: attr.unit ? `${attr.name}（${attr.unit}）` : attr.name,
  }));

  const toggleEstimate = () => {
    const next = !api.estimateOn;
    api.setEstimateOn(next);
    // 打开估算却因为模块折叠而看不见任何变化 —— 等于开关没反应。顺手展开。
    if (next && api.prefs.collapsed[key]) api.toggleModuleCollapsed(key);
  };

  return (
    <PackModuleShell
      title={moduleLabel(key)}
      collapsed={Boolean(api.prefs.collapsed[key])}
      onToggle={() => api.toggleModuleCollapsed(key)}
      actions={
        <>
          <PackExportButton api={api} moduleKey="summary" label={moduleLabel(key)} />
          <Button
            className={`cpk-btn ghost${api.estimateOn ? " is-on" : ""}`}
            onClick={toggleEstimate}
            title="估算模式：叠加未保存的临时加成看换算结果（不落库）"
          >
            估算
          </Button>
          {api.dirty > 0 ? <span className="cpk-chip">未保存</span> : null}
        </>
      }
    >
      {api.estimateOn ? (
        <div className="cpk-est">
          <p className="cpk-est__hint">
            临时加成只参与试算，不会保存，也不计入未保存改动数。
          </p>
          {api.estimateEntries.length === 0 ? (
            <p className="cpk-est__empty">还没有临时加成。加一条，看看总属性会变成多少。</p>
          ) : (
            <ul className="cpk-est__list">
              {api.estimateEntries.map((entry) => (
                <li key={entry.id} className="cpk-est__row">
                  <Select
                    size="small"
                    value={entry.attrId || undefined}
                    placeholder="属性"
                    options={attrOptions}
                    className="cpk-est__attr"
                    classNames={{ popup: { root: "cpk-dropdown" } }}
                    onChange={(value: string) => api.updateEstimate(entry.id, { attrId: value })}
                  />
                  <Select
                    size="small"
                    value={entry.op}
                    options={OP_OPTIONS}
                    className="cpk-est__op"
                    classNames={{ popup: { root: "cpk-dropdown" } }}
                    onChange={(value: PackModifier["op"]) => api.updateEstimate(entry.id, { op: value })}
                  />
                  <InputNumber
                    size="small"
                    className="cpk-est__value"
                    value={entry.value}
                    step={entry.op === "mul" ? 0.1 : 1}
                    onChange={(value) => api.updateEstimate(entry.id, { value: Number(value) || 0 })}
                  />
                  <Button
                    className="cpk-iconbtn tiny danger"
                    onClick={() => api.removeEstimate(entry.id)}
                    title="删除这条临时加成"
                  >
                    <DeleteOutlined />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="cpk-est__ops">
            <Button className="cpk-btn ghost" onClick={() => api.addEstimate()}>
              <PlusOutlined /> 临时加成
            </Button>
            {api.estimateEntries.length > 0 ? (
              <Button className="cpk-btn ghost" onClick={api.clearEstimates}>
                清空
              </Button>
            ) : null}
          </div>

          {estimating ? (
            <div className="cpk-est__result">
              <p className="cpk-est__resulttitle">估算后总属性变化</p>
              <SummaryDeltaList
                api={api}
                deltas={api.estimateDeltas}
                emptyText="这些加成不影响任何属性"
              />
            </div>
          ) : null}
        </div>
      ) : null}

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
            const est = estimating ? api.estimateSummary?.byAttr.get(row.attrId) : undefined;
            const delta = estimating
              ? api.estimateDeltas.find((item) => item.attrId === row.attrId)
              : undefined;
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
                  {est ? (
                    <span className="cpk-sum__est">
                      <span className="cpk-sum__arrow">→</span>
                      <span className={`cpk-sum__num is-est${delta ? "" : " is-flat"}`}>
                        {formatAttrValue(est.final, attr.decimals)}
                      </span>
                      {delta ? (
                        <em className={`cpk-seg is-est${delta.delta < 0 ? " is-down" : ""}`}>
                          {delta.delta > 0 ? "+" : ""}
                          {formatAttrValue(delta.delta, attr.decimals)}
                        </em>
                      ) : null}
                    </span>
                  ) : null}
                  {/* 估算时把「N 条来源」让出来：一行里塞不下两个尾部信息，
                      而估算值正是此刻唯一在看的东西 */}
                  {!estimating && row.contributions.length > 0 ? (
                    <span className="cpk-sum__count">{row.contributions.length} 条来源</span>
                  ) : null}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {castCount > 0 || eventCount > 0 || expiredCount > 0 ? (
        <p className="cpk-sum__note">
          <ThunderboltOutlined />
          {castCount > 0 ? (
            <span>另有 {castCount} 项主动效果（释放型）不计入总属性</span>
          ) : null}
          {castCount > 0 && (eventCount > 0 || expiredCount > 0) ? <span>·</span> : null}
          {eventCount > 0 ? <span>{eventCount} 项带触发条件，按事件发生才生效</span> : null}
          {eventCount > 0 && expiredCount > 0 ? <span>·</span> : null}
          {expiredCount > 0 ? <span>{expiredCount} 项时效已过，暂时不计入</span> : null}
        </p>
      ) : null}
    </PackModuleShell>
  );
}
