import { useMemo, useState } from "react";
import { Button, Modal } from "antd";
import { SettingOutlined } from "@ant-design/icons";
import PackModuleShell from "../PackModuleShell";
import ModifierList from "../ModifierList";
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

  const slots = useMemo(
    () => [...(doc?.slots ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [doc],
  );

  if (!doc) return null;
  const key = "equipment" as const;

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
        <button
          type="button"
          className="cpk-iconbtn"
          onClick={() => api.setSlotManagerOpen(true)}
          title="部位设置（名称 / 容量 / 可接受类别）"
        >
          <SettingOutlined />
        </button>
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
                  <button
                    type="button"
                    className="cpk-btn ghost"
                    onClick={() => setPicking(picking === slot.id ? null : slot.id)}
                    disabled={!slot.enabled}
                  >
                    {picking === slot.id ? "收起" : "穿戴"}
                  </button>
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
                              <button
                                type="button"
                                className="cpk-btn ghost"
                                onClick={() =>
                                  api.openEffectEditor("item", item.id, item.name || "装备")
                                }
                              >
                                加成效果
                              </button>
                              <button
                                type="button"
                                className="cpk-btn ghost"
                                onClick={() => api.unequipItem(item.id)}
                              >
                                卸下
                              </button>
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
                      <ul className="cpk-eq__cands">
                        {candidates.map((item) => (
                          <li key={item.id}>
                            <button
                              type="button"
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
                            </button>
                          </li>
                        ))}
                      </ul>
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
