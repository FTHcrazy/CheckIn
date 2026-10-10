import { useMemo, useState } from "react";
import { Button, InputNumber } from "antd";
import { SettingOutlined } from "@ant-design/icons";
import PackModuleShell from "../PackModuleShell";
import PackExportButton from "../PackExportButton";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { moduleLabel } from "../module-meta";
import { formatAttrValue, formatRatio, type RatioLevel } from "../../pack-utils";
import "./index.scss";

interface CurrencyModuleProps {
  api: PackPanelApi;
}

function parseLevels(raw: string): RatioLevel[] {
  try {
    const parsed: unknown = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? (parsed as RatioLevel[]) : [];
  } catch {
    return [];
  }
}

function parseConfig(raw: string): { autoCarry?: boolean } {
  try {
    return JSON.parse(raw || "{}") as { autoCarry?: boolean };
  } catch {
    return {};
  }
}

/**
 * 货币（D-1）
 *
 * 这里只做「换算展示」——面板不持有余额字段（作者在正文里写金额），
 * 所以给一个试算框：输入基础单位数量，按作者自定义进制即时换算。
 */
export default function CurrencyModule({ api }: CurrencyModuleProps) {
  const doc = api.doc;
  const system = api.currencySystem;
  const [amount, setAmount] = useState(12345);

  const levels = useMemo(() => (system ? parseLevels(system.levels) : []), [system]);
  const config = useMemo(() => (system ? parseConfig(system.config) : {}), [system]);

  if (!doc) return null;
  const key = "currency" as const;
  const ordered = [...levels].sort((a, b) => b.ratioToBase - a.ratioToBase);
  const baseName = ordered[ordered.length - 1]?.name;
  const preview = formatRatio(amount, levels, config.autoCarry !== false, baseName);

  return (
    <PackModuleShell
      title={moduleLabel(key)}
      collapsed={Boolean(api.prefs.collapsed[key])}
      onToggle={() => api.toggleModuleCollapsed(key)}
      actions={
        <>
          <PackExportButton api={api} moduleKey="currency" label={moduleLabel(key)} />
          <Button
            className="cpk-iconbtn"
            onClick={() => api.setUnitManagerOpen(true)}
            title="量纲设置"
          >
            <SettingOutlined />
          </Button>
        </>
      }
    >
      {!system || ordered.length === 0 ? (
        <div className="cpk-cur__empty">
          <p className="cpk-empty">
            还没有设置货币进制。作者自定义换算关系后，这里会把大数自动进位成「n 金 n 银 n 铜」。
          </p>
          <Button className="cpk-btn ghost" onClick={api.applyCurrencyTemplate}>
            套用模板（1 金 = 100 银 = 10000 铜）
          </Button>
        </div>
      ) : (
        <>
          <ul className="cpk-cur__ladder">
            {ordered.map((level) => (
              <li key={level.name} className="cpk-cur__lvl">
                <span className="cpk-cur__lvlname">{level.name}</span>
                <span className="cpk-cur__ratio">
                  = {formatAttrValue(Math.max(1, Math.round(level.ratioToBase)), 0)}{" "}
                  {baseName}
                </span>
              </li>
            ))}
          </ul>
          <div className="cpk-cur__try">
            <span className="cpk-cur__label">试算</span>
            <InputNumber
              size="small"
              min={0}
              value={amount}
              style={{ width: 110 }}
              onChange={(value) => setAmount(Math.max(0, Number(value) || 0))}
            />
            <span className="cpk-cur__unit">{baseName}</span>
            <span className="cpk-cur__eq">=</span>
            <span className="cpk-cur__out">{preview}</span>
          </div>
          {config.autoCarry === false ? (
            <p className="cpk-cur__hint">已关闭自动进位：按作者的设定，低级货币不会换算上去。</p>
          ) : null}
        </>
      )}
    </PackModuleShell>
  );
}
