import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Dropdown, Input, Select } from "antd";
import {
  AppstoreOutlined,
  DeleteOutlined,
  PlusOutlined,
  SearchOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import PackModuleShell from "../PackModuleShell";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { moduleLabel } from "../module-meta";
import { isItemEquipped, matchesKeyword } from "../../pack-utils";
import { INVENTORY_SEARCH_DEBOUNCE_MS, QTY_HOLD } from "../../pack-config";
import { ITEM_CATEGORIES, RARITY_META, type PackItem } from "../../types";
import "./index.scss";

interface InventoryModuleProps {
  api: PackPanelApi;
}

/** 物品数量：长按连续增减（第一下立即生效，按住 400ms 后每 60ms 一次） */
function useHoldRepeat() {
  const ref = useRef<{ delay: number | null; tick: number | null }>({ delay: null, tick: null });

  const stop = useCallback(() => {
    if (ref.current.delay !== null) window.clearTimeout(ref.current.delay);
    if (ref.current.tick !== null) window.clearInterval(ref.current.tick);
    ref.current = { delay: null, tick: null };
  }, []);

  const start = useCallback(
    (action: () => void) => {
      stop();
      action();
      ref.current.delay = window.setTimeout(() => {
        ref.current.tick = window.setInterval(action, QTY_HOLD.intervalMs);
      }, QTY_HOLD.delayMs);
    },
    [stop],
  );

  useEffect(() => stop, [stop]);
  return { start, stop };
}

const CATEGORY_OPTIONS = ITEM_CATEGORIES.map((category) => ({
  value: category,
  label: category,
}));

/**
 * 物品栏（B-3）
 *
 * 「时时刻刻检查主角拥有的物品」的正面回答：名称、分类、数量、稀有度都在一行里
 * 直接可改；数量支持原地加减与长按连加，不需要打开任何弹窗。
 */
export default function InventoryModule({ api }: InventoryModuleProps) {
  const doc = api.doc;
  const [keyword, setKeyword] = useState("");
  const [debounced, setDebounced] = useState("");
  const [pendingRemove, setPendingRemove] = useState<PackItem | null>(null);
  /** 装备下拉的目标物品：用 ref 而不是 state，避免菜单读到上一帧的对象 */
  const equipTargetRef = useRef<string>("");
  const hold = useHoldRepeat();

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(keyword), INVENTORY_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  const items = useMemo(
    () =>
      (doc?.items ?? []).filter(
        (item) =>
          matchesKeyword(item.name, debounced) ||
          matchesKeyword(item.category, debounced) ||
          item.tags.some((tag) => matchesKeyword(tag, debounced)),
      ),
    [doc, debounced],
  );

  if (!doc) return null;
  const key = "inventory" as const;
  const showSearch = doc.items.length >= 20;
  const grid = api.prefs.inventoryView === "grid";
  const slots = [...doc.slots].sort((a, b) => a.sortOrder - b.sortOrder);

  const equipOptions = slots.map((slot) => ({
    key: slot.id,
    label: slot.accepts.length > 0 ? `${slot.name}（仅 ${slot.accepts.join("/")}）` : slot.name,
    disabled: !slot.enabled,
    onClick: () => {
      const target = doc.items.find((item) => item.id === equipTargetRef.current);
      if (!target) return;
      const result = api.equipItem(target.id, slot.id);
      if (result.ok) api.showToast(`「${target.name}」已穿上 ${slot.name}`, "success");
      else if (result.conflict) api.showToast("该部位已满，请到装备栏替换", "warning");
    },
  }));

  const renderQty = (item: PackItem) => (
    <span className="cpk-inv__qty">
      <Button
        className="cpk-iconbtn tiny"
        onPointerDown={() => hold.start(() => api.stepItemQty(item.id, -1))}
        onPointerUp={hold.stop}
        onPointerLeave={hold.stop}
        onPointerCancel={hold.stop}
        onContextMenu={(event) => event.preventDefault()}
        disabled={item.qty <= 0}
        title="减 1（按住连减）"
      >
        −
      </Button>
      <span className="cpk-inv__qtynum">{item.qty}</span>
      <Button
        className="cpk-iconbtn tiny"
        onPointerDown={() => hold.start(() => api.stepItemQty(item.id, 1))}
        onPointerUp={hold.stop}
        onPointerLeave={hold.stop}
        onPointerCancel={hold.stop}
        onContextMenu={(event) => event.preventDefault()}
        title="加 1（按住连加）"
      >
        +
      </Button>
    </span>
  );

  return (
    <PackModuleShell
      title={moduleLabel(key)}
      collapsed={Boolean(api.prefs.collapsed[key])}
      onToggle={() => api.toggleModuleCollapsed(key)}
      actions={
        <>
          {showSearch ? (
            <Input
              size="small"
              allowClear
              className="cpk-inv__search"
              prefix={<SearchOutlined />}
              placeholder="搜索"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          ) : null}
          <Button
            className="cpk-iconbtn"
            onClick={() => api.patchPrefs({ inventoryView: grid ? "list" : "grid" })}
            title={grid ? "切换到列表视图" : "切换到宫格视图"}
          >
            {grid ? <UnorderedListOutlined /> : <AppstoreOutlined />}
          </Button>
          <Button className="cpk-btn ghost" onClick={() => api.addItem()}>
            <PlusOutlined /> 物品
          </Button>
        </>
      }
    >
      {doc.items.length === 0 ? (
        <p className="cpk-empty">还没有物品。把主角身上带着的东西先记下来，比「回头再补」靠谱。</p>
      ) : items.length === 0 ? (
        <p className="cpk-empty">没有匹配「{debounced}」的物品。</p>
      ) : (
        <ul className={`cpk-inv${grid ? " is-grid" : ""}`}>
          {items.map((item) => {
            const equipped = isItemEquipped(item);
            return (
              <li key={item.id} className={`cpk-inv__item${equipped ? " is-equipped" : ""}`}>
                <span
                  className="cpk-dot"
                  style={{ background: RARITY_META[item.rarity]?.color }}
                  title={RARITY_META[item.rarity]?.label ?? item.rarity}
                />
                <Input
                  size="small"
                  variant="borderless"
                  className="cpk-inline cpk-inv__name"
                  value={item.name}
                  placeholder="物品名"
                  aria-label="物品名"
                  onChange={(event) => api.updateItem(item.id, { name: event.target.value })}
                />
                <Select
                  size="small"
                  className="cpk-inv__cat"
                  value={item.category}
                  options={CATEGORY_OPTIONS}
                  classNames={{ popup: { root: "cpk-dropdown" } }}
                  onChange={(value: string) => api.updateItem(item.id, { category: value })}
                />
                {renderQty(item)}
                {equipped ? (
                  <Button
                    className="cpk-btn ghost"
                    onClick={() => api.unequipItem(item.id)}
                    title="点击卸下"
                  >
                    已穿戴
                  </Button>
                ) : (
                  <Dropdown trigger={["click"]} menu={{ items: equipOptions }}>
                    <Button
                      className="cpk-btn ghost"
                      onClick={() => {
                        equipTargetRef.current = item.id;
                      }}
                    >
                      装备
                    </Button>
                  </Dropdown>
                )}
                <Button
                  className="cpk-iconbtn tiny"
                  onClick={() => api.openEffectEditor("item", item.id, item.name || "物品")}
                  title="加成效果"
                >
                  ✦
                </Button>
                <Button
                  className="cpk-iconbtn tiny danger"
                  onClick={() => setPendingRemove(item)}
                  title="删除"
                >
                  <DeleteOutlined />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {pendingRemove ? (
        <div className="cpk-inv__confirm">
          <span>
            删除「{pendingRemove.name}」
            {api.modifiersOf("item", pendingRemove.id).length > 0
              ? `（连带 ${api.modifiersOf("item", pendingRemove.id).length} 条加成）`
              : ""}
            ？
          </span>
          <span className="cpk-inv__confirmactions">
            <Button className="cpk-btn ghost" onClick={() => setPendingRemove(null)}>
              取消
            </Button>
            <Button
              className="cpk-btn danger"
              onClick={() => {
                api.removeItem(pendingRemove.id);
                setPendingRemove(null);
              }}
            >
              删除
            </Button>
          </span>
        </div>
      ) : null}
    </PackModuleShell>
  );
}
