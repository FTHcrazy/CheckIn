import { Button, Input, InputNumber, Modal, Switch } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { CURRENCY_TEMPLATE, PROFICIENCY_TEMPLATE } from "../../pack-config";
import { formatRatio, type RatioLevel, type ThresholdLevel } from "../../pack-utils";
import "./index.scss";
import "./index.scss";

interface UnitSystemManagerProps {
  api: PackPanelApi;
}

function parse<T>(raw: string | undefined): T[] {
  try {
    const parsed: unknown = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function configOf(raw: string | undefined): Record<string, unknown> {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * 量纲设置（D-1）
 *
 * 三套量纲模型里，行囊只用得上两套：货币走「进制型」、熟练度走「阈值型」；
 * 境界走「阶梯型」，但那套直接复用 R25 的等级体系，不在这里重复配置。
 */
export default function UnitSystemManager({ api }: UnitSystemManagerProps) {
  const currency = api.currencySystem;
  const proficiency = api.proficiencySystem;

  const currencyLevels = parse<RatioLevel>(currency?.levels);
  const proficiencyLevels = parse<ThresholdLevel>(proficiency?.levels);
  const autoCarry = configOf(currency?.config).autoCarry !== false;

  const writeCurrency = (levels: RatioLevel[], nextAutoCarry = autoCarry) =>
    api.upsertUnitSystem("ratio", "currency", {
      id: currency?.id,
      name: "货币",
      levels,
      config: { autoCarry: nextAutoCarry },
    });

  const writeProficiency = (levels: ThresholdLevel[]) =>
    api.upsertUnitSystem("threshold", "proficiency", {
      id: proficiency?.id,
      name: "熟练度",
      levels,
    });

  const sorted = [...currencyLevels].sort((a, b) => b.ratioToBase - a.ratioToBase);
  const baseName = sorted[sorted.length - 1]?.name;

  return (
    <Modal
      open={api.unitManagerOpen}
      title="量纲设置"
      centered
      width={500}
      onCancel={() => api.setUnitManagerOpen(false)}
      footer={
        <div className="cpk-guard__footer">
          <Button onClick={() => api.setUnitManagerOpen(false)}>完成</Button>
        </div>
      }
    >
      <section className="cpk-unit">
        <header className="cpk-unit__head">
          <h4 className="cpk-unit__title">货币（进制型）</h4>
          <label className="cpk-unit__switch">
            <span>自动进位</span>
            <Switch
              size="small"
              checked={autoCarry}
              onChange={(checked) => writeCurrency(currencyLevels, checked)}
            />
          </label>
        </header>
        <p className="cpk-unit__sub">
          折算率相对基准单位填写：基准单位（最小的那个）填 1。
          {currencyLevels.length > 0 ? (
            <>
              {" "}
              当前示例：12345 {baseName} = {formatRatio(12345, currencyLevels, autoCarry, baseName)}
            </>
          ) : null}
        </p>
        <ul className="cpk-unit__rows">
          {currencyLevels.map((level, index) => (
            <li key={index} className="cpk-unit__row">
              <Input
                size="small"
                value={level.name}
                placeholder="单位名"
                onChange={(event) => {
                  const next = [...currencyLevels];
                  next[index] = { ...level, name: event.target.value };
                  writeCurrency(next);
                }}
              />
              <InputNumber
                size="small"
                min={1}
                style={{ width: 92 }}
                value={level.ratioToBase}
                addonBefore="×"
                onChange={(value) => {
                  const next = [...currencyLevels];
                  next[index] = { ...level, ratioToBase: Math.max(1, Number(value) || 1) };
                  writeCurrency(next);
                }}
              />
              <button
                type="button"
                className="cpk-iconbtn tiny danger"
                onClick={() => writeCurrency(currencyLevels.filter((_, i) => i !== index))}
                title="删除这一档"
              >
                <DeleteOutlined />
              </button>
            </li>
          ))}
        </ul>
        <div className="cpk-unit__actions">
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() =>
              writeCurrency([
                ...currencyLevels,
                { name: "新单位", ratioToBase: 1 },
              ])
            }
          >
            加一档
          </Button>
          <Button size="small" onClick={api.applyCurrencyTemplate}>
            套用模板
          </Button>
          {currency ? (
            <Button size="small" danger onClick={() => api.removeUnitSystem(currency.id)}>
              清除设置
            </Button>
          ) : null}
        </div>
      </section>

      <section className="cpk-unit">
        <header className="cpk-unit__head">
          <h4 className="cpk-unit__title">熟练度（阈值型）</h4>
        </header>
        <p className="cpk-unit__sub">
          上限留空表示「无上限」，网文里「超越大师」只会被标注，不会被截断。
        </p>
        <ul className="cpk-unit__rows">
          {proficiencyLevels.map((level, index) => (
            <li key={index} className="cpk-unit__row">
              <Input
                size="small"
                value={level.name}
                placeholder="档位名"
                onChange={(event) => {
                  const next = [...proficiencyLevels];
                  next[index] = { ...level, name: event.target.value };
                  writeProficiency(next);
                }}
              />
              <InputNumber
                size="small"
                min={0}
                style={{ width: 84 }}
                value={level.min}
                addonBefore="≥"
                onChange={(value) => {
                  const next = [...proficiencyLevels];
                  next[index] = { ...level, min: Math.max(0, Number(value) || 0) };
                  writeProficiency(next);
                }}
              />
              <InputNumber
                size="small"
                min={0}
                style={{ width: 84 }}
                value={level.max ?? undefined}
                placeholder="无上限"
                addonBefore="≤"
                onChange={(value) => {
                  const next = [...proficiencyLevels];
                  next[index] = { ...level, max: value === null ? null : Number(value) };
                  writeProficiency(next);
                }}
              />
              <button
                type="button"
                className="cpk-iconbtn tiny danger"
                onClick={() => writeProficiency(proficiencyLevels.filter((_, i) => i !== index))}
                title="删除这一档"
              >
                <DeleteOutlined />
              </button>
            </li>
          ))}
        </ul>
        <div className="cpk-unit__actions">
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() =>
              writeProficiency([...proficiencyLevels, { name: "新档位", min: 0, max: null }])
            }
          >
            加一档
          </Button>
          <Button size="small" onClick={() => writeProficiency(PROFICIENCY_TEMPLATE)}>
            套用模板
          </Button>
          {proficiency ? (
            <Button size="small" danger onClick={() => api.removeUnitSystem(proficiency.id)}>
              清除设置
            </Button>
          ) : null}
        </div>
      </section>

      <p className="cpk-guard__sub">
        修改量纲不会清空已有数值 —— 作者换一套换算关系时，原始数值必须保留（{CURRENCY_TEMPLATE.length}
        档货币模板：{CURRENCY_TEMPLATE.map((level) => level.name).join(" / ")}）。
      </p>
    </Modal>
  );
}
