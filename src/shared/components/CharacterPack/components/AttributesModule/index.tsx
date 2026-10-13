import { useMemo, useState } from "react";
import { Button, Dropdown, Input, InputNumber, Modal, Select } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import PackModuleShell from "../PackModuleShell";
import PackExportButton from "../PackExportButton";
import PackChangedDot from "../PackChangedDot";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { moduleLabel } from "../module-meta";
import { ATTR_TEMPLATES, type PackAttrDef } from "../../types";
import "./index.scss";

interface AttributesModuleProps {
  api: PackPanelApi;
}

const DECIMAL_OPTIONS = [
  { value: 0, label: "整数" },
  { value: 1, label: "1 位小数" },
  { value: 2, label: "2 位小数" },
];

/**
 * 人物属性（B-1 · 1.39.0 定义 / 数值两段化）
 *
 * 上段是**属性模型**（作品级）：这本书有哪些属性、怎么分组、单位与默认值 ——
 * 效果、映射与未来的其它系统引用的都是这份模型里的 id。
 * 下段是**属性值**（角色级）：按模型逐条编基础值；模型里有、角色还没初始化的
 * 给「初始化为默认值」入口。
 *
 * 删除定义会**连带清掉指向它的加成词条、属性映射与全部角色的数值行**，
 * 所以条数为正时必须先确认 —— 否则装备上的加成会静默消失、别处的加点换算
 * 也会悄悄少一截，作者只会觉得「总属性怎么掉了」。
 */
export default function AttributesModule({ api }: AttributesModuleProps) {
  const doc = api.doc;
  const [pendingRemove, setPendingRemove] = useState<{ id: string; name: string } | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, PackAttrDef[]>();
    for (const def of [...(doc?.attrDefs ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const list = map.get(def.groupName) ?? [];
      list.push(def);
      map.set(def.groupName, list);
    }
    return [...map.entries()];
  }, [doc]);

  /** 模型里没有实例数值行的定义（组合视图回落 defaultValue，这里给初始化入口） */
  const valuelessIds = useMemo(() => {
    const set = new Set<string>();
    if (!doc) return set;
    const present = new Set(doc.attributes.map((value) => value.defId));
    for (const def of doc.attrDefs) if (!present.has(def.id)) set.add(def.id);
    return set;
  }, [doc]);

  if (!doc) return null;
  const key = "attributes" as const;

  // 待删定义牵连到的引用条数（确认框要逐类说清楚删掉的是什么）
  const pendingMods = pendingRemove ? api.countModifiersOfAttribute(pendingRemove.id) : 0;
  const pendingMaps = pendingRemove ? api.countMappingsOfAttribute(pendingRemove.id) : 0;

  const tryRemove = (def: PackAttrDef) => {
    // 加成与换算都要算：两者都是「删了定义就再也算不出来」的引用，
    // 只判加成的话，一个纯换算属性会被静默删掉、连带清掉别人的折算量。
    if (api.countModifiersOfAttribute(def.id) > 0 || api.countMappingsOfAttribute(def.id) > 0) {
      setPendingRemove({ id: def.id, name: def.name });
      return;
    }
    api.removeAttribute(def.id);
  };

  const move = (list: PackAttrDef[], index: number, delta: number) => {
    const next = [...list];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    // 只重排当前分组内的序，全局顺序由分组顺序拼出
    const ordered = groups.flatMap(([groupName, items]) =>
      groupName === list[0]?.groupName ? next : items,
    );
    api.reorderAttributes(ordered.map((def) => def.id));
  };

  return (
    <PackModuleShell
      title={moduleLabel(key)}
      collapsed={Boolean(api.prefs.collapsed[key])}
      onToggle={() => api.toggleModuleCollapsed(key)}
      actions={
        <>
          <PackExportButton api={api} moduleKey="attributes" label={moduleLabel(key)} />
          <Dropdown
            menu={{
              items: Object.keys(ATTR_TEMPLATES).map((name) => ({
                key: name,
                label: `套用「${name}」模板`,
                onClick: () => api.applyAttrTemplate(name),
              })),
            }}
            trigger={["click"]}
          >
            <Button className="cpk-btn ghost">
              模板
            </Button>
          </Dropdown>
          <Button className="cpk-btn ghost" onClick={() => api.addAttribute()}>
            <PlusOutlined /> 属性
          </Button>
        </>
      }
    >
      {groups.length === 0 ? (
        <p className="cpk-empty">
          还没有属性。属性是汇总的骨架 —— 先加「攻击力 / 防御力」这类项，再让装备和技能往上挂加成。
        </p>
      ) : (
        <div className="cpk-attr">
          <p className="cpk-attr__section">属性模型 · 全书共用</p>
          {groups.map(([groupName, items]) => (
            <section key={groupName} className="cpk-attr__group">
              <Input
                size="small"
                variant="borderless"
                className="cpk-inline cpk-attr__groupname"
                value={groupName}
                aria-label="属性分组名"
                onChange={(event) => api.renameAttributeGroup(groupName, event.target.value)}
              />
              <ul className="cpk-attr__rows">
                {items.map((def, index) => (
                  <li key={def.id} className="cpk-attr__row">
                    <Input
                      size="small"
                      variant="borderless"
                      className="cpk-inline cpk-attr__name"
                      value={def.name}
                      placeholder="属性名"
                      aria-label="属性名"
                      onChange={(event) => api.updateAttribute(def.id, { name: event.target.value })}
                    />
                    <InputNumber
                      size="small"
                      className="cpk-attr__base"
                      value={def.defaultValue}
                      step={def.decimals > 0 ? 0.1 : 1}
                      style={{ width: 84 }}
                      title="默认值：新建角色实例时的初始基础值"
                      onChange={(value) =>
                        api.updateAttribute(def.id, { defaultValue: Number(value) || 0 })
                      }
                    />
                    <Input
                      size="small"
                      variant="borderless"
                      className="cpk-inline cpk-attr__unit"
                      value={def.unit}
                      placeholder="单位"
                      aria-label="单位"
                      onChange={(event) => api.updateAttribute(def.id, { unit: event.target.value })}
                    />
                    <Select
                      size="small"
                      className="cpk-attr__decimals"
                      value={def.decimals}
                      options={DECIMAL_OPTIONS}
                      classNames={{ popup: { root: "cpk-dropdown" } }}
                      onChange={(value: number) => api.updateAttribute(def.id, { decimals: value })}
                    />
                    <span className="cpk-attr__ops">
                      <Button
                        className="cpk-iconbtn tiny"
                        onClick={() => move(items, index, -1)}
                        disabled={index === 0}
                        title="上移"
                      >
                        <ArrowUpOutlined />
                      </Button>
                      <Button
                        className="cpk-iconbtn tiny"
                        onClick={() => move(items, index, 1)}
                        disabled={index === items.length - 1}
                        title="下移"
                      >
                        <ArrowDownOutlined />
                      </Button>
                      <Button
                        className="cpk-iconbtn tiny danger"
                        onClick={() => tryRemove(def)}
                        title="删除属性"
                      >
                        <DeleteOutlined />
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <p className="cpk-attr__section">属性值 · 当前角色</p>
          <ul className="cpk-attr__rows">
            {api.attrView.map((attr) => (
              <li key={attr.id} className="cpk-attr__row">
                <span className="cpk-attr__valuelabel">{attr.name}</span>
                <PackChangedDot
                  updatedAt={attr.updatedAt}
                  changed={api.isRecentlyChanged(attr.updatedAt)}
                />
                <InputNumber
                  size="small"
                  className="cpk-attr__base"
                  value={attr.baseValue}
                  step={attr.decimals > 0 ? 0.1 : 1}
                  style={{ width: 84 }}
                  onChange={(value) =>
                    api.updateAttribute(attr.id, { baseValue: Number(value) || 0 })
                  }
                />
                {attr.unit ? <span className="cpk-attr__valueunit">{attr.unit}</span> : null}
                {valuelessIds.has(attr.id) ? (
                  <Button
                    className="cpk-iconbtn tiny"
                    title={`把基础值初始化为默认值 ${attr.baseValue}`}
                    onClick={() =>
                      api.updateAttribute(attr.id, { baseValue: attr.baseValue })
                    }
                  >
                    <PlusOutlined />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal
        open={pendingRemove !== null}
        title={pendingMaps > 0 ? "删除属性会同时移除加成与换算" : "删除属性会同时移除加成"}
        centered
        width={340}
        footer={
          <div className="cpk-guard__footer">
            <Button onClick={() => setPendingRemove(null)}>取消</Button>
            <Button
              danger
              onClick={() => {
                if (pendingRemove) api.removeAttribute(pendingRemove.id);
                setPendingRemove(null);
              }}
            >
              一并删除
            </Button>
          </div>
        }
      >
        <p className="cpk-guard__text">
          「{pendingRemove?.name}」{pendingMods > 0 ? "上有 " : null}
          {pendingMods > 0 ? <b>{pendingMods}</b> : null}
          {pendingMods > 0 ? " 条加成效果" : null}
          {pendingMods > 0 && pendingMaps > 0 ? "，" : null}
          {pendingMaps > 0 ? (pendingMods > 0 ? "另有 " : "上有 ") : null}
          {pendingMaps > 0 ? <b>{pendingMaps}</b> : null}
          {pendingMaps > 0 ? " 条属性换算。" : "。"}
        </p>
        <p className="cpk-guard__sub">
          继续删除会把它们连同这条属性一并移除（加成的源头在装备 / 技能上，换算在「属性映射」里，都不会自己恢复）。若只是想停用，可以把效果临时禁用，或把那条换算的系数改成 0。
        </p>
      </Modal>
    </PackModuleShell>
  );
}
