import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, InputNumber, Select } from "antd";
import PackModuleShell from "../PackModuleShell";
import PackExportButton from "../PackExportButton";
import PackChangedDot from "../PackChangedDot";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { moduleLabel } from "../module-meta";
import { formatAttrValue } from "../../pack-utils";
import { MAPPING_PROBLEM_META } from "../../pack-mapping";
import type { PackMapping } from "../../types";
import "./index.scss";

interface MappingModuleProps {
  api: PackPanelApi;
}

/**
 * 属性映射（1.35.0）
 *
 * 一条换算 = 「每 1 点源属性 → 目标属性加算多少」。网游里最常见的写法是
 * 「加 1 点力量，血量 +100」；玄幻里则是「每点根骨多 12 点气血」。
 *
 * 三条刻意的取舍：
 * - **没有开关**：把系数设成 0 就是关掉（汇总里不算、也不报警告）。两种「关」
 *   会让脏计数与「与本章初对比」都说不清哪个才是作者的意思，所以只留一种。
 * - **行里直接报「折算了多少」**：作者要的是「这套装备下折合多少生命」，
 *   只给系数等于让他自己再乘一遍。这个数来自 `summary.mappingApplied`，
 *   与总属性是**同一次计算**，不可能对不上。
 * - **算不出来的如实说**：成环、属性被删、源目标相同都会在这行直接标出来，
 *   而不是静静地不生效（详见 `pack-mapping.ts` 的注释）。
 */
export default function MappingModule({ api }: MappingModuleProps) {
  const doc = api.doc;
  if (!doc) return null;
  const key = "mapping" as const;

  const attributes = api.attrView;
  const attrOptions = attributes.map((attr) => ({
    value: attr.id,
    label: attr.unit ? `${attr.name}（${attr.unit}）` : attr.name,
  }));
  const attrOf = (id: string) => attributes.find((attr) => attr.id === id) ?? null;

  const mappings = api.mappings;

  const add = () => {
    const id = api.addMapping();
    // 属性不足两条时主进程之外没有「另一条属性」可折算 —— 造一条必然无效的
    // 记录比什么都不做更糟，这里给一句话说明
    if (!id) api.showToast("至少需要两条属性才能建立换算", "warning");
  };

  const move = (index: number, delta: number) => {
    const next = [...mappings];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    api.reorderMappings(next.map((mapping) => mapping.id));
  };

  /** 一行右侧的读数：折算量 / 停用 / 算不出来的原因，三者只会出现一个 */
  const readoutOf = (mapping: PackMapping) => {
    const problem = api.summary.mappingProblems.get(mapping.id);
    if (problem) {
      const meta = MAPPING_PROBLEM_META[problem];
      return { tone: "problem" as const, text: meta.label, title: meta.hint };
    }
    if (mapping.rate === 0) {
      return {
        tone: "off" as const,
        text: "已停用",
        title: "系数为 0 即停用：汇总里不算它，也不会报错。改成非 0 就恢复",
      };
    }
    const source = attrOf(mapping.sourceAttrId);
    const target = attrOf(mapping.targetAttrId);
    const sourceValue = api.summary.byAttr.get(mapping.sourceAttrId)?.final ?? 0;
    const applied = api.summary.mappingApplied.get(mapping.id) ?? 0;
    const sourceText = source
      ? `${source.name} ${formatAttrValue(sourceValue, source.decimals ?? 0)}`
      : "源属性已删除";
    const appliedText = `+${formatAttrValue(applied, target?.decimals ?? 0)}`;
    return {
      tone: "value" as const,
      text: `当前 ${sourceText} · 折算 ${appliedText}`,
      title: target
        ? `每 1 点「${source?.name ?? "?"}」给「${target.name}」加 ${mapping.rate}；当前合计 ${appliedText}`
        : "目标属性已删除",
    };
  };

  return (
    <PackModuleShell
      title={moduleLabel(key)}
      collapsed={Boolean(api.prefs.collapsed[key])}
      onToggle={() => api.toggleModuleCollapsed(key)}
      hint={
        mappings.length === 0
          ? "换算：每 1 点某条属性，折算成另一条属性加多少。源取的是它的最终值（含装备与加成）。"
          : undefined
      }
      actions={
        <>
          <PackExportButton api={api} moduleKey="mapping" label={moduleLabel(key)} />
          <Button className="cpk-btn ghost" onClick={add} title="新增一条换算">
            <PlusOutlined /> 换算
          </Button>
        </>
      }
    >
      {mappings.length === 0 ? (
        <p className="cpk-empty">
          {attributes.length < 2
            ? "至少需要两条属性才能建立换算 —— 先去「人物属性」里把属性补齐。"
            : "还没有换算。「加 1 点力量，血量 +100」这类成长关系记在这里，改装备、开技能带来的属性变化会自动跟着折算。"}
        </p>
      ) : (
        <ul className="cpk-map">
          {mappings.map((mapping, index) => {
            const source = attrOf(mapping.sourceAttrId);
            const target = attrOf(mapping.targetAttrId);
            const readout = readoutOf(mapping);
            return (
              <li key={mapping.id} className={`cpk-map__item is-${readout.tone}`}>
                <div className="cpk-map__row">
                  <PackChangedDot
                    updatedAt={mapping.updatedAt}
                    changed={api.isRecentlyChanged(mapping.updatedAt)}
                  />
                  <Select
                    size="small"
                    className="cpk-map__attr"
                    value={source ? mapping.sourceAttrId : undefined}
                    placeholder="源属性"
                    options={attrOptions}
                    classNames={{ popup: { root: "cpk-dropdown" } }}
                    aria-label="源属性"
                    onChange={(value: string) => api.updateMapping(mapping.id, { sourceAttrId: value })}
                  />
                  <span className="cpk-map__arrow" aria-hidden="true">
                    →
                  </span>
                  <Select
                    size="small"
                    className="cpk-map__attr"
                    value={target ? mapping.targetAttrId : undefined}
                    placeholder="目标属性"
                    options={attrOptions}
                    classNames={{ popup: { root: "cpk-dropdown" } }}
                    aria-label="目标属性"
                    onChange={(value: string) => api.updateMapping(mapping.id, { targetAttrId: value })}
                  />
                  <span className="cpk-map__ops">
                    <Button
                      className="cpk-iconbtn tiny"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      title="上移"
                    >
                      <ArrowUpOutlined />
                    </Button>
                    <Button
                      className="cpk-iconbtn tiny"
                      onClick={() => move(index, 1)}
                      disabled={index === mappings.length - 1}
                      title="下移"
                    >
                      <ArrowDownOutlined />
                    </Button>
                    <Button
                      className="cpk-iconbtn tiny danger"
                      onClick={() => api.removeMapping(mapping.id)}
                      title="删除这条换算"
                    >
                      <DeleteOutlined />
                    </Button>
                  </span>
                </div>
                <div className="cpk-map__calc">
                  <span className="cpk-map__rateLabel">每 1 点</span>
                  <InputNumber
                    size="small"
                    className="cpk-map__rate cpk-num"
                    value={mapping.rate}
                    step={Number.isInteger(mapping.rate) ? 1 : 0.1}
                    aria-label="换算系数"
                    onChange={(value) => api.updateMapping(mapping.id, { rate: Number(value) || 0 })}
                  />
                  <span
                    className={`cpk-map__readout is-${readout.tone}`}
                    title={readout.title}
                  >
                    {readout.text}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PackModuleShell>
  );
}
