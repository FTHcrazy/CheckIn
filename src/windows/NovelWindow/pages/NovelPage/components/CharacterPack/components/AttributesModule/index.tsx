import { useMemo, useState } from "react";
import { Button, Dropdown, Input, InputNumber, Modal, Select } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import PackModuleShell from "../PackModuleShell";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { moduleLabel } from "../module-meta";
import { ATTR_TEMPLATES, type PackAttribute } from "../../types";
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
 * 人物属性（B-1）
 *
 * 支持分组（战斗属性 / 资质 / 资源…）、自定义小数位与单位。
 * 删除属性会**连带清掉指向它的加成词条**，所以条数为正时必须先确认 ——
 * 否则装备上的加成会静默消失，作者只会觉得「总属性怎么掉了」。
 */
export default function AttributesModule({ api }: AttributesModuleProps) {
  const doc = api.doc;
  const [pendingRemove, setPendingRemove] = useState<{ id: string; name: string } | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, PackAttribute[]>();
    for (const attr of [...(doc?.attributes ?? [])].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const list = map.get(attr.groupName) ?? [];
      list.push(attr);
      map.set(attr.groupName, list);
    }
    return [...map.entries()];
  }, [doc]);

  if (!doc) return null;
  const key = "attributes" as const;

  const tryRemove = (attr: PackAttribute) => {
    if (api.countModifiersOfAttribute(attr.id) > 0) {
      setPendingRemove({ id: attr.id, name: attr.name });
      return;
    }
    api.removeAttribute(attr.id);
  };

  const move = (list: PackAttribute[], index: number, delta: number) => {
    const next = [...list];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    // 只重排当前分组内的序，全局顺序由分组顺序拼出
    const ordered = groups.flatMap(([groupName, items]) =>
      groupName === list[0]?.groupName ? next : items,
    );
    api.reorderAttributes(ordered.map((attr) => attr.id));
  };

  return (
    <PackModuleShell
      title={moduleLabel(key)}
      collapsed={Boolean(api.prefs.collapsed[key])}
      onToggle={() => api.toggleModuleCollapsed(key)}
      actions={
        <>
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
                {items.map((attr, index) => (
                  <li key={attr.id} className="cpk-attr__row">
                    <Input
                      size="small"
                      variant="borderless"
                      className="cpk-inline cpk-attr__name"
                      value={attr.name}
                      placeholder="属性名"
                      aria-label="属性名"
                      onChange={(event) => api.updateAttribute(attr.id, { name: event.target.value })}
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
                    <Input
                      size="small"
                      variant="borderless"
                      className="cpk-inline cpk-attr__unit"
                      value={attr.unit}
                      placeholder="单位"
                      aria-label="单位"
                      onChange={(event) => api.updateAttribute(attr.id, { unit: event.target.value })}
                    />
                    <Select
                      size="small"
                      className="cpk-attr__decimals"
                      value={attr.decimals}
                      options={DECIMAL_OPTIONS}
                      classNames={{ popup: { root: "cpk-dropdown" } }}
                      onChange={(value: number) => api.updateAttribute(attr.id, { decimals: value })}
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
                        onClick={() => tryRemove(attr)}
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
        </div>
      )}

      <Modal
        open={pendingRemove !== null}
        title="删除属性会同时移除加成"
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
          「{pendingRemove?.name}」上有{" "}
          <b>{pendingRemove ? api.countModifiersOfAttribute(pendingRemove.id) : 0}</b> 条加成效果。
        </p>
        <p className="cpk-guard__sub">
          继续删除会把这些效果一并移除（它们在装备 / 技能上，不会自己恢复）。若只是想停用，可以改到效果编辑器里临时禁用。
        </p>
      </Modal>
    </PackModuleShell>
  );
}
