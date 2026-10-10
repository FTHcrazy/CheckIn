import { useMemo, useState } from "react";
import { Button, Input, Modal, Popover } from "antd";
import { DeleteOutlined, SettingOutlined, SwapOutlined } from "@ant-design/icons";
import PackModuleShell from "../PackModuleShell";
import ModifierList from "../ModifierList";
import EquipDeltaPreview from "../DeltaPreview";
import PackExportButton from "../PackExportButton";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { moduleLabel } from "../module-meta";
import { isItemEquipped } from "../../pack-utils";
import { RARITY_META, type PackItem, type PackSlot } from "../../types";
import "./index.scss";

interface EquipmentModuleProps {
  api: PackPanelApi;
}

interface ReplaceTarget {
  itemId: string;
  itemName: string;
  slotId: string;
  slotIndex: number;
  victimName: string;
}

/**
 * 装备栏（A-1 / A-2 / A-3）
 *
 * 部位可自定义容量与可接受类别（戒指能戴两个就是这么来的）。槽位满时
 * **不拒绝操作**，而是明确列出「将替换掉哪一件」让作者确认（REQ-009）——
 * 「点了没反应」是这类面板最伤信任的失败方式。
 */
export default function EquipmentModule({ api }: EquipmentModuleProps) {
  const doc = api.doc;
  const [picking, setPicking] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<ReplaceTarget | null>(null);
  /** 换装方案浮层是否展开（REQ-032） */
  const [presetsOpen, setPresetsOpen] = useState(false);
  /** 待保存的方案名（浮层里的输入框；保存成功后清空） */
  const [presetName, setPresetName] = useState("");

  const slots = useMemo(
    () => [...(doc?.slots ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [doc],
  );

  const presets = useMemo(
    () => [...(doc?.presets ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [doc],
  );

  if (!doc) return null;
  const key = "equipment" as const;

  const saveCurrentPreset = () => {
    if (api.savePreset(presetName)) setPresetName("");
  };

  const occupantsOf = (slotId: string) =>
    doc.items
      .filter((item) => item.equippedSlotId === slotId)
      .sort((a, b) => (a.slotIndex ?? 0) - (b.slotIndex ?? 0));

  const candidatesOf = (slot: PackSlot): PackItem[] =>
    doc.items.filter((item) => {
      if (item.equippedSlotId === slot.id) return false;
      if (isItemEquipped(item)) return false;
      if (slot.accepts.length > 0 && !slot.accepts.includes(item.category)) return false;
      return true;
    });

  const requestEquip = (item: PackItem, slot: PackSlot) => {
    const result = api.equipItem(item.id, slot.id);
    if (result.ok) {
      setPicking(null);
      return;
    }
    if (result.conflict) {
      const victim = result.conflict;
      setReplacing({
        itemId: item.id,
        itemName: item.name,
        slotId: slot.id,
        slotIndex: victim.slotIndex ?? 0,
        victimName: victim.name,
      });
    }
  };

  return (
    <PackModuleShell
      title={moduleLabel(key)}
      collapsed={Boolean(api.prefs.collapsed[key])}
      onToggle={() => api.toggleModuleCollapsed(key)}
      actions={
        <>
          <PackExportButton api={api} moduleKey="equipment" label={moduleLabel(key)} />
          {/*
            换装方案（REQ-032）。
            用 Popover 而不是 Dropdown 菜单：每一行要能**就地改名**、要显示「几件可用」、
            还要并列两个真按钮（套用 / 删除）—— 菜单项里塞按钮会让点击冒泡到菜单项本身
            （点删除同时触发套用），这是这个仓库里已经踩过一次的坑。
          */}
          <Popover
            trigger="click"
            placement="bottomRight"
            arrow={false}
            open={presetsOpen}
            onOpenChange={setPresetsOpen}
            overlayClassName="cpk-dropdown"
            title="换装方案"
            content={
              <div className="cpk-eq__presets">
                <div className="cpk-eq__presetsave">
                  <Input
                    size="small"
                    className="cpk-eq__presetinput"
                    value={presetName}
                    placeholder="方案名（如：战斗装）"
                    aria-label="新方案名"
                    onChange={(event) => setPresetName(event.target.value)}
                    onPressEnter={saveCurrentPreset}
                  />
                  <Button className="cpk-btn ghost" onClick={saveCurrentPreset}>
                    保存当前穿戴
                  </Button>
                </div>
                {presets.length === 0 ? (
                  <p className="cpk-eq__presetempty">
                    还没有方案。先把这一套穿好，再点上面的「保存当前穿戴」。
                  </p>
                ) : (
                  <ul className="cpk-eq__presetlist">
                    {presets.map((preset) => {
                      const readout = api.presetReadout(preset);
                      return (
                        <li key={preset.id} className="cpk-eq__preset">
                          <Input
                            size="small"
                            variant="borderless"
                            className="cpk-inline cpk-eq__presetname"
                            value={preset.name}
                            aria-label={`方案名：${preset.name}`}
                            onChange={(event) => api.renamePreset(preset.id, event.target.value)}
                          />
                          <span className="cpk-eq__presetmeta">
                            {readout.available}/{readout.total} 件
                            {readout.missing > 0 ? ` · 缺 ${readout.missing}` : ""}
                            {readout.broken > 0 ? ` · 失效 ${readout.broken}` : ""}
                          </span>
                          <Button
                            className="cpk-btn ghost"
                            disabled={readout.available === 0}
                            onClick={() => api.applyPresetById(preset.id)}
                            title={
                              readout.available === 0
                                ? "这套方案里的东西现在一件都穿不上"
                                : "套用：先全部卸下，再按这套方案穿"
                            }
                          >
                            套用
                          </Button>
                          <Button
                            className="cpk-iconbtn tiny danger"
                            onClick={() => api.removePreset(preset.id)}
                            title="删除方案"
                          >
                            <DeleteOutlined />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="cpk-eq__presettip">
                  套用会先把身上全部卸下，再按方案穿。方案只记「谁穿在哪一格」，物品被删掉时会自动跳过。
                </p>
              </div>
            }
          >
            <Button
              className={`cpk-iconbtn${presetsOpen ? " is-on" : ""}`}
              title="换装方案（保存 / 套用）"
            >
              <SwapOutlined />
            </Button>
          </Popover>
          <Button
            className="cpk-iconbtn"
            onClick={() => api.setSlotManagerOpen(true)}
            title="部位设置（名称 / 容量 / 可接受类别）"
          >
            <SettingOutlined />
          </Button>
        </>
      }
    >
      {slots.length === 0 ? (
        <p className="cpk-empty">还没有装备部位。先到部位设置里加几个，或者恢复默认的一套通用部位。</p>
      ) : (
        <div className="cpk-eq">
          {slots.map((slot) => {
            const occupants = occupantsOf(slot.id);
            const candidates = candidatesOf(slot);
            return (
              <section
                key={slot.id}
                className={`cpk-eq__slot${slot.enabled ? "" : " is-disabled"}`}
              >
                <header className="cpk-eq__head">
                  <span className="cpk-eq__slotname">{slot.name}</span>
                  <span className="cpk-eq__cap">
                    {occupants.length}/{slot.capacity}
                  </span>
                  {slot.accepts.length > 0 ? (
                    <span className="cpk-eq__accepts">仅 {slot.accepts.join("/")}</span>
                  ) : null}
                  <Button
                    className="cpk-btn ghost"
                    onClick={() => setPicking(picking === slot.id ? null : slot.id)}
                    disabled={!slot.enabled}
                  >
                    {picking === slot.id ? "收起" : "穿戴"}
                  </Button>
                </header>

                {occupants.length === 0 ? (
                  <p className="cpk-eq__empty">空</p>
                ) : (
                  <ul className="cpk-eq__items">
                    {occupants.map((item) => {
                      const active = api.isCarrierActive("item", item.id);
                      return (
                        <li
                          key={item.id}
                          className={`cpk-eq__item${active ? "" : " is-off"}`}
                        >
                          <div className="cpk-eq__itemhead">
                            <span
                              className="cpk-dot"
                              style={{ background: RARITY_META[item.rarity]?.color }}
                              title={RARITY_META[item.rarity]?.label ?? item.rarity}
                            />
                            <span className="cpk-eq__itemname">{item.name}</span>
                            {!slot.enabled ? <span className="cpk-eq__offtag">部位已停用</span> : null}
                            <span className="cpk-eq__itemops">
                              <Button
                                className="cpk-btn ghost"
                                onClick={() =>
                                  api.openEffectEditor("item", item.id, item.name || "装备")
                                }
                              >
                                加成效果
                              </Button>
                              <Button
                                className="cpk-btn ghost"
                                onClick={() => api.unequipItem(item.id)}
                              >
                                卸下
                              </Button>
                            </span>
                          </div>
                          <ModifierList
                            modifiers={api.modifiersOf("item", item.id)}
                            attributes={doc.attributes}
                            ownerActive={active}
                            onOpenEditor={(modifierId) =>
                              api.openEffectEditor("item", item.id, item.name || "装备", modifierId)
                            }
                            onToggleActive={api.toggleModifierActive}
                            onToggleDisabled={api.toggleModifierDisabled}
                            onDuplicate={api.duplicateModifier}
                            onRemove={api.removeModifier}
                            onJumpAttribute={api.setDetailAttrId}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}

                {picking === slot.id ? (
                  <div className="cpk-eq__picker">
                    {candidates.length === 0 ? (
                      <p className="cpk-eq__empty">物品栏里没有可放进这个部位的物品。</p>
                    ) : (
                      <>
                        <p className="cpk-eq__candtip">悬停候选可预览装上后的属性变化</p>
                        <ul className="cpk-eq__cands">
                          {candidates.map((item) => (
                            <li key={item.id}>
                              {/* hover 即预览 Δ（REQ-018）。浮层内容为惰性挂载，
                                  所以「每件都算一遍完整汇总管线」不会发生在列表渲染时。 */}
                              <Popover
                                trigger="hover"
                                placement="leftTop"
                                mouseEnterDelay={0.25}
                                arrow={false}
                                overlayClassName="cpk-delta-pop"
                                content={
                                  <EquipDeltaPreview api={api} itemId={item.id} slotId={slot.id} />
                                }
                              >
                                <Button
                                  className="cpk-eq__cand"
                                  onClick={() => requestEquip(item, slot)}
                                >
                                  <span
                                    className="cpk-dot"
                                    style={{ background: RARITY_META[item.rarity]?.color }}
                                  />
                                  <span className="cpk-eq__candname">{item.name}</span>
                                  <span className="cpk-eq__candcat">{item.category}</span>
                                  {occupants.length >= slot.capacity ? (
                                    <span className="cpk-eq__candhint">将替换 1 件</span>
                                  ) : null}
                                </Button>
                              </Popover>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      <Modal
        open={replacing !== null}
        title="该部位已满"
        centered
        width={360}
        footer={
          <div className="cpk-guard__footer">
            <Button onClick={() => setReplacing(null)}>取消</Button>
            <Button
              type="primary"
              onClick={() => {
                if (replacing) {
                  api.replaceInSlot(replacing.itemId, replacing.slotId, replacing.slotIndex);
                  api.showToast(`已替换「${replacing.victimName}」`, "info");
                }
                setReplacing(null);
                setPicking(null);
              }}
            >
              替换并穿上
            </Button>
          </div>
        }
      >
        <p className="cpk-guard__text">
          穿上「{replacing?.itemName}」会顶掉原本在这个位置上的「{replacing?.victimName}」。
        </p>
        <p className="cpk-guard__sub">被顶掉的物品会退回物品栏，不会被删除。</p>
      </Modal>
    </PackModuleShell>
  );
}
