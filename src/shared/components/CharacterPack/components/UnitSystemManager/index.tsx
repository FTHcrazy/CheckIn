import { Button, Input, InputNumber, Modal, Switch, Upload } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { CURRENCY_TEMPLATE, PROFICIENCY_TEMPLATE } from "../../pack-config";
import {
  carryBreakdown,
  formatRatio,
  proficiencySchemeOf,
  type RatioLevel,
  type ThresholdLevel,
} from "../../pack-utils";
import { buildUnitsJson, parseUnitsJson } from "../../pack-units";
import { copyText, downloadText } from "../../services/pack-export";
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
  const autoCarry = configOf(currency?.config).autoCarry !== false;

  const writeCurrency = (levels: RatioLevel[], nextAutoCarry = autoCarry) =>
    api.upsertUnitSystem("ratio", "currency", {
      id: currency?.id,
      name: "货币",
      levels,
      config: { autoCarry: nextAutoCarry },
    });

  /**
   * 写回某套熟练度体系：levels + 别名 + autoCarry 一起写（upsert 的 config 是
   * merge 语义，但「改别名」和「改档位」若分开写会让中间态互相覆盖）。
   * ratio ≤ 0 的档位写回时剥掉字段 —— 存储里只留有效进位率，JSON 干净。
   */
  const writeProficiencySystem = (
    systemId: string | undefined,
    levels: ThresholdLevel[],
    meta: { alias: string; autoCarry: boolean },
  ) =>
    api.upsertUnitSystem("threshold", "proficiency", {
      id: systemId,
      levels: levels.map((level) =>
        level.ratio && level.ratio > 0
          ? level
          : { name: level.name, min: level.min, max: level.max },
      ),
      config: { alias: meta.alias.trim(), autoCarry: meta.autoCarry },
    });

  /** 新增一套熟练度体系（Phase 3：修为 / 剑意并存），初始为空档位 */
  const addProficiencySystem = () =>
    api.upsertUnitSystem("threshold", "proficiency", {
      create: true,
      name: "新体系",
      levels: [{ name: "入门", min: 0, max: null }],
      config: { alias: "" },
    });  const sorted = [...currencyLevels].sort((a, b) => b.ratioToBase - a.ratioToBase);
  const baseName = sorted[sorted.length - 1]?.name;

  /** 导出：把库里这两套量纲拼成一段可交换的 JSON（REQ-022） */
  const unitsJson = () => buildUnitsJson(api.doc?.unitSystems ?? []);

  const handleCopyUnits = async (): Promise<void> => {
    const ok = await copyText(unitsJson());
    if (ok) api.showToast("已复制量纲 JSON");
    else api.showToast("复制失败，请改用「下载」", "warning");
  };

  const handleDownloadUnits = async (): Promise<void> => {
    const path = await downloadText("行囊-量纲.json", unitsJson(), "json", "JSON");
    if (path) api.showToast(`已导出：${path}`);
    else api.showToast("已取消导出", "info");
  };

  /**
   * 导入：**覆盖同用途的那一套**（货币覆盖货币、熟练度覆盖熟练度），不做合并。
   *
   * 合并会让「档位被删掉」变成静默失败（旧档位还在），而作者看着文件里没有它
   * 会以为导入没生效。覆盖是可解释的语义，且这一步只改内存 + 标脏，
   * 真写库要等显式保存 —— 导错了「撤销全部」就能回去。
   */
  const handleImportUnits = async (file: File): Promise<void> => {
    // 不给初值 `""`：读了才赋值，读失败直接 return —— 给初值会变成一次
    // 永远不会被用到的赋值（`no-useless-assignment`）。
    let text: string;
    try {
      text = await file.text();
    } catch {
      api.showToast("这个文件读不出来", "warning");
      return;
    }
    const result = parseUnitsJson(text);
    if (!result.ok) {
      api.showToast(`导入失败：${result.error}`, "warning");
      return;
    }
    for (const unit of result.units) {
      const existing = unit.use === "currency" ? currency : proficiency;
      api.upsertUnitSystem(unit.kind, unit.use, {
        id: existing?.id,
        name: unit.name,
        levels: unit.levels,
        config: { ...unit.config, use: unit.use },
      });
    }
    api.showToast(`已导入 ${result.units.length} 套量纲（保存后生效）`, "success");
  };

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
              <Button
                className="cpk-iconbtn tiny danger"
                onClick={() => writeCurrency(currencyLevels.filter((_, i) => i !== index))}
                title="删除这一档"
              >
                <DeleteOutlined />
              </Button>
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

      {api.proficiencySystems.length === 0 ? (
        <section className="cpk-unit">
          <header className="cpk-unit__head">
            <h4 className="cpk-unit__title">熟练度（阈值型）</h4>
          </header>
          <p className="cpk-unit__sub">
            还没有熟练度体系。可先新增一套再套用模板；分组可以各自绑定不同的体系（修为 / 剑意并存）。
          </p>
        </section>
      ) : null}
      {api.proficiencySystems.map((system) => {
        const meta = proficiencySchemeOf(system.levels, system.config);
        const sample = meta.autoCarry ? carryBreakdown(12345, meta.levels) : "";
        const setLevels = (next: ThresholdLevel[]) =>
          writeProficiencySystem(system.id, next, meta);
        return (
          <section key={system.id} className="cpk-unit">
            <header className="cpk-unit__head">
              <h4 className="cpk-unit__title">{meta.alias}（阈值型）</h4>
              <label className="cpk-unit__switch">
                <span>自动进位</span>
                <Switch
                  size="small"
                  checked={meta.autoCarry}
                  onChange={(checked) =>
                    writeProficiencySystem(system.id, meta.levels, {
                      alias: meta.alias,
                      autoCarry: checked,
                    })
                  }
                />
              </label>
            </header>
            <p className="cpk-unit__sub">
              别名会替换行囊里所有「熟练度」字样；进位率填在档位上，表示「1 × 上一档 = 几 × 本档」，留空不进位。原始数值始终是唯一真相源，进位只影响展示。
              {sample ? <> 当前示例：12345 = {sample}。</> : null}
            </p>
            <div className="cpk-unit__io">
              <span className="cpk-unit__iohead">别名</span>
              <span className="cpk-unit__ioacts">
                <Input
                  size="small"
                  style={{ width: 140 }}
                  value={meta.alias === "熟练度" ? "" : meta.alias}
                  placeholder="熟练度"
                  onChange={(event) =>
                    writeProficiencySystem(system.id, meta.levels, {
                      alias: event.target.value,
                      autoCarry: meta.autoCarry,
                    })
                  }
                />
              </span>
            </div>
            <ul className="cpk-unit__rows">
              {meta.levels.map((level, index) => (
                <li key={index} className="cpk-unit__row">
                  <Input
                    size="small"
                    value={level.name}
                    placeholder="档位名"
                    onChange={(event) => {
                      const next = [...meta.levels];
                      next[index] = { ...level, name: event.target.value };
                      setLevels(next);
                    }}
                  />
                  <InputNumber
                    size="small"
                    min={0}
                    style={{ width: 84 }}
                    value={level.min}
                    addonBefore="≥"
                    onChange={(value) => {
                      const next = [...meta.levels];
                      next[index] = { ...level, min: Math.max(0, Number(value) || 0) };
                      setLevels(next);
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
                      const next = [...meta.levels];
                      next[index] = { ...level, max: value === null ? null : Number(value) };
                      setLevels(next);
                    }}
                  />
                  <InputNumber
                    size="small"
                    min={0}
                    style={{ width: 88 }}
                    value={level.ratio}
                    placeholder="进位率"
                    title="1 × 上一档单位 = 几 × 本档单位；留空表示这一档不进位"
                    onChange={(value) => {
                      const next = [...meta.levels];
                      const ratio = Math.max(0, Number(value) || 0);
                      next[index] = {
                        name: level.name,
                        min: level.min,
                        max: level.max,
                        ...(ratio > 0 ? { ratio } : {}),
                      };
                      setLevels(next);
                    }}
                  />
                  <Button
                    className="cpk-iconbtn tiny danger"
                    onClick={() => setLevels(meta.levels.filter((_, i) => i !== index))}
                    title="删除这一档"
                  >
                    <DeleteOutlined />
                  </Button>
                </li>
              ))}
            </ul>
            <div className="cpk-unit__actions">
              <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={() =>
                  setLevels([
                    ...meta.levels,
                    { name: "新档位", min: 0, max: null },
                  ])
                }
              >
                加一档
              </Button>
              <Button
                size="small"
                onClick={() => writeProficiencySystem(system.id, PROFICIENCY_TEMPLATE, meta)}
              >
                套用模板
              </Button>
              <Button
                size="small"
                danger
                onClick={() => api.removeUnitSystem(system.id)}
                title="删除这套体系（组内绑定会回落到默认体系，原始数值不受影响）"
              >
                删除体系
              </Button>
            </div>
          </section>
        );
      })}
      <div className="cpk-unit__actions">
        <Button size="small" icon={<PlusOutlined />} onClick={addProficiencySystem}>
          新增体系
        </Button>
      </div>

      <div className="cpk-unit__io">
        <span className="cpk-unit__iohead">量纲 JSON</span>
        <span className="cpk-unit__ioacts">
          <Button size="small" onClick={() => void handleCopyUnits()} title="复制这段 JSON">
            复制
          </Button>
          <Button size="small" onClick={() => void handleDownloadUnits()} title="存成 .json 文件">
            下载
          </Button>
          {/* 选文件走 antd Upload 的 beforeUpload（自己读文本、返回 false 阻止上传），
              渲染层就不需要为主进程再开一条「读文件」通道 */}
          <Upload
            accept=".json,application/json"
            showUploadList={false}
            maxCount={1}
            beforeUpload={(file) => {
              void handleImportUnits(file);
              return false;
            }}
          >
            <Button size="small" title="从 .json 文件导入（覆盖同用途的那套）">
              导入
            </Button>
          </Upload>
        </span>
      </div>

      <p className="cpk-guard__sub">
        修改量纲不会清空已有数值 —— 作者换一套换算关系时，原始数值必须保留（{CURRENCY_TEMPLATE.length}
        档货币模板：{CURRENCY_TEMPLATE.map((level) => level.name).join(" / ")}）。
      </p>
    </Modal>
  );
}
