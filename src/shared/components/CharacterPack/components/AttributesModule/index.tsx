import { useState } from "react";
import { Button, Dropdown, Input, InputNumber, Modal, Select } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import PackModuleShell from "../PackModuleShell";
import PackExportButton from "../PackExportButton";
import PackChangedDot from "../PackChangedDot";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { moduleLabel } from "../module-meta";
import { ATTR_TEMPLATES } from "../../types";
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
 * 人物属性（1.39.1 单列化：直接编辑**当前角色**的属性）
 *
 * 此前是「属性模型 · 全书共用 + 属性值 · 当前角色」两段：模型段管「这本书有
 * 哪些属性」，数值段按模型逐条编基础值 —— 但两段分置让「新增属性」的交互
 * 晦涩（名称是无边框输入，看不出能编辑），也和「就是想给当前角色加个数」的
 * 高频诉求错位。现在合并成**一张每角色的属性行列表**：名称 / 数值 / 单位 /
 * 小数位一行编完，底层仍是 def（作品级模型）+ value（角色实例）两份数据，
 * 增删改走原有 `addAttribute / updateAttribute / removeAttribute`，效果与
 * 映射按 defId 的引用关系原样保留。
 *
 * 删除属性仍会连带清掉指向它的加成词条、属性映射与数值行，条数为正时先确认
 * —— 否则装备上的加成会静默消失，作者只会觉得「总属性怎么掉了」。
 */
export default function AttributesModule({ api }: AttributesModuleProps) {
  const doc = api.doc;
  const [pendingRemove, setPendingRemove] = useState<{ id: string; name: string } | null>(null);

  if (!doc) return null;
  const key = "attributes" as const;

  // 待删定义牵连到的引用条数（确认框要逐类说清楚删掉的是什么）
  const pendingMods = pendingRemove ? api.countModifiersOfAttribute(pendingRemove.id) : 0;
  const pendingMaps = pendingRemove ? api.countMappingsOfAttribute(pendingRemove.id) : 0;

  const tryRemove = (id: string, name: string) => {
    // 加成与换算都要算：两者都是「删了定义就再也算不出来」的引用，
    // 只判加成的话，一个纯换算属性会被静默删掉、连带清掉别人的折算量。
    if (api.countModifiersOfAttribute(id) > 0 || api.countMappingsOfAttribute(id) > 0) {
      setPendingRemove({ id, name });
      return;
    }
    api.removeAttribute(id);
  };

  const move = (index: number, delta: number) => {
    const ids = api.attrView.map((attr) => attr.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    api.reorderAttributes(ids);
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
      {api.attrView.length === 0 ? (
        <p className="cpk-empty">
          还没有属性。点「＋ 属性」直接给当前角色加一条（攻击力 / 防御力这类），
          装备和技能的加成再往上挂。
        </p>
      ) : (
        <div className="cpk-attr">
          <ul className="cpk-attr__rows">
            {api.attrView.map((attr, index) => (
              <li key={attr.id} className="cpk-attr__row">
                {/* 带边框的输入框：一眼可知「名称可编辑」——
                    此前无边框样式让人以为属性名是死的标签 */}
                <Input
                  size="small"
                  className="cpk-attr__name"
                  value={attr.name}
                  placeholder="属性名"
                  aria-label="属性名"
                  title="属性名（可直接修改）"
                  onChange={(event) => api.updateAttribute(attr.id, { name: event.target.value })}
                />
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
                  title="当前角色的基础值"
                  onChange={(value) =>
                    api.updateAttribute(attr.id, { baseValue: Number(value) || 0 })
                  }
                />
                <Input
                  size="small"
                  className="cpk-attr__unit"
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
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    title="上移"
                  >
                    <ArrowUpOutlined />
                  </Button>
                  <Button
                    className="cpk-iconbtn tiny"
                    onClick={() => move(index, 1)}
                    disabled={index === api.attrView.length - 1}
                    title="下移"
                  >
                    <ArrowDownOutlined />
                  </Button>
                  <Button
                    className="cpk-iconbtn tiny danger"
                    onClick={() => tryRemove(attr.id, attr.name)}
                    title="删除属性"
                  >
                    <DeleteOutlined />
                  </Button>
                </span>
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
