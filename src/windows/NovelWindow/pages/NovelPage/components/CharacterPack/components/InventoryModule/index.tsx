import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Dropdown, Input, InputNumber, Select } from "antd";
import {
  AppstoreOutlined,
  CheckOutlined,
  MoreOutlined,
  PlusOutlined,
  SearchOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import PackModuleShell from "../PackModuleShell";
import PackExportButton from "../PackExportButton";
import PackChangedDot from "../PackChangedDot";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { moduleLabel } from "../module-meta";
import { formatWeight, isItemEquipped, itemWeight, matchesKeyword } from "../../pack-utils";
import { INVENTORY_RENDER_WINDOW, INVENTORY_SEARCH_DEBOUNCE_MS, QTY_HOLD } from "../../pack-config";
import { ITEM_CATEGORIES, RARITY_KEYS, rarityMetaOf, type PackItem } from "../../types";
import "./index.scss";

interface InventoryModuleProps {
  api: PackPanelApi;
}

/** 「超载」状态在状态模块里的名字（自动创建 / 去重都按它认人） */
const OVERLOAD_STATUS_NAME = "超载";

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
  /** 展开详情的物品 id（描述 / 标签；同一时刻只开一条，面板窄） */
  const [detailId, setDetailId] = useState<string | null>(null);
  /**
   * 标签的**编辑中草稿**（键 = 物品 id）
   *
   * 标签在存储里是 `string[]`，而输入时用户敲的是「空格分隔的一整串」——
   * 如果每个字符都 `split` 回写模型，敲到一半的空格会把输入框里的内容立刻吃掉
   * （值被规范化成 join 后的形式），表现为「打不出第二个词」。所以草稿留在本地，
   * 失焦 / 回车 / 折叠时才解析一次提交。
   */
  const [tagsDraft, setTagsDraft] = useState<Record<string, string>>({});
  /** 上限设置面板是否展开（REQ-033：负重 / 格数） */
  const [limitsOpen, setLimitsOpen] = useState(false);
  /** 装备下拉的目标物品：用 ref 而不是 state，避免菜单读到上一帧的对象 */
  const equipTargetRef = useRef<string>("");
  const hold = useHoldRepeat();

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(keyword), INVENTORY_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  /** 把标签草稿解析成数组提交（空白 / 中英文逗号 / 顿号都当分隔符） */
  const commitTags = useCallback(
    (id: string) => {
      const raw = tagsDraft[id];
      if (raw === undefined) return;
      const tags = raw.split(/[\s,，、]+/).filter(Boolean);
      api.updateItem(id, { tags });
      setTagsDraft((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [api, tagsDraft],
  );

  /** 切换详情行：**切走时先把标签草稿提交掉**，否则未失焦的输入会被静默丢弃 */
  const toggleDetail = useCallback(
    (id: string) => {
      if (detailId === id) {
        commitTags(id);
        setDetailId(null);
        return;
      }
      if (detailId) commitTags(detailId);
      setDetailId(id);
    },
    [commitTags, detailId],
  );

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

  /**
   * 渲染窗口（REQ-019 长列表）：默认只挂载前 `INVENTORY_RENDER_WINDOW` 条。
   *
   * 过滤条件或物品总数一变就把窗口收回第一屏 —— 否则「搜出 3 条、再清空搜索」
   * 会停在上一次点出来的条数上，看起来像是丢了东西。
   */
  const [windowCount, setWindowCount] = useState(INVENTORY_RENDER_WINDOW);
  const itemCount = doc?.items.length ?? 0;
  useEffect(() => {
    setWindowCount(INVENTORY_RENDER_WINDOW);
  }, [debounced, itemCount]);

  const visible = useMemo(() => items.slice(0, windowCount), [items, windowCount]);

  if (!doc) return null;
  const key = "inventory" as const;
  const showSearch = doc.items.length >= 20;
  const grid = api.prefs.inventoryView === "grid";
  const slots = [...doc.slots].sort((a, b) => a.sortOrder - b.sortOrder);
  const load = api.load;

  /**
   * 是否已经有一条「超载」状态。
   *
   * 按**名字**认人而不是记一个 id：状态是作者自己的数据，他可能删了重建、
   * 也可能从别的书复制过来。按名字去重是最不容易出错的判据 —— 而这里必须
   * 去重，否则超载期间每点一次就多一条「超载」。
   */
  const overloadStatus = doc.modifiers.find(
    (mod) => mod.ownerType === "status" && mod.name === OVERLOAD_STATUS_NAME,
  );

  /**
   * 「把超载记成状态效果」（F-5 第二条：**复用状态模块**）。
   *
   * 刻意**不做自动挂载**：超载该扣什么属性、扣多少，是每本书自己的规则，
   * 工具猜不出来。自动塞一条 `value = 0` 的「超载」进设定，作者要过很久才会
   * 发现它在汇总里什么都没干 —— 那比不做更糟。所以这里只建出这条骨架并直接
   * 打开效果编辑器，让作者当场填数值。
   */
  const addOverloadStatus = () => {
    const id = api.addStatus({
      name: OVERLOAD_STATUS_NAME,
      nature: "sustained",
      active: true,
    });
    if (id) api.openEffectEditor("status", doc.character.id, "状态效果", id);
  };

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

  /**
   * 稀有度角标即「改稀有度的入口」（REQ-010）
   *
   * 圆点本来就是这行里唯一的稀有度表达，所以不做成「圆点旁边再加一个下拉」——
   * 那会让每行多占 74px 宽，而这个面板最窄只有 340px。点圆点直接改，
   * 菜单项自己带色点（选中项打勾），顺手给「点这里能改」的发现性。
   *
   * 按钮用现成的 `.cpk-iconbtn.tiny`（20px，与同排的 ✦ / ⋯ 齐平）：圆点靠 antd
   * 按钮自带的居中即可，**不要**再挂一个只为 `justify-content: center` 的新类 ——
   * `novel-ui-kit.test.ts` 会把它当成「自带造型的按钮」，然后要求它自带清零点。
   */
  const renderRarity = (item: PackItem) => {
    const meta = rarityMetaOf(item.rarity);
    return (
      <Dropdown
        trigger={["click"]}
        classNames={{ root: "cpk-dropdown" }}
        menu={{
          items: RARITY_KEYS.map((rarity) => {
            const option = rarityMetaOf(rarity);
            return {
              key: rarity,
              label: (
                <span className="cpk-inv__raropt">
                  <span className="cpk-dot" style={{ background: option.color }} />
                  <span>{option.label}</span>
                  {item.rarity === rarity ? (
                    <CheckOutlined className="cpk-inv__rarchk" />
                  ) : null}
                </span>
              ),
            };
          }),
          onClick: ({ key: picked }) => api.updateItem(item.id, { rarity: picked }),
        }}
      >
        <Button
          className="cpk-iconbtn tiny"
          aria-label={`稀有度：${meta.label}`}
          title={`稀有度：${meta.label}（点击修改）`}
        >
          <span className="cpk-dot" style={{ background: meta.color }} />
        </Button>
      </Dropdown>
    );
  };

  /**
   * 行尾的「更多」菜单：**描述与标签** + **删除**
   *
   * 这里不是在追求「少放几个按钮」，而是被实测宽度逼出来的：行囊面板最窄 340px，
   * 扣掉正文内边距、滚动条留槽（10px）、模块与条目的 padding，一行只剩 **285px**；
   * 而「已穿戴 + 刚改动角标」这一行的不可再压缩宽度就是 292px —— 已经贴着上限。
   * 每个行尾图标按钮（哪怕被压到 11px）连间距要吃掉 15px，实测 340px 下**只放得下
   * 两个**。所以新增的入口一律并进这个菜单，而不是再加第三个按钮。
   *
   * 刻意把「加成效果」留在菜单外：那是行囊的主行为（这个面板存在的理由就是汇总加成），
   * 不该被推进二级。删除反而本来就带一步确认，进菜单后是三步，更安全。
   */
  const renderMore = (item: PackItem, open: boolean) => (
    <Dropdown
      trigger={["click"]}
      classNames={{ root: "cpk-dropdown" }}
      menu={{
        items: [
          { key: "detail", label: open ? "收起描述与标签" : "描述 / 标签 / 重量" },
          { type: "divider" },
          { key: "remove", label: "删除", danger: true },
        ],
        onClick: ({ key }) => {
          if (key === "detail") toggleDetail(item.id);
          else if (key === "remove") setPendingRemove(item);
        },
      }}
    >
      <Button
        className={`cpk-iconbtn tiny${open ? " is-on" : ""}`}
        aria-label="更多操作"
        aria-haspopup="menu"
        title="描述 / 标签 / 重量 / 删除"
      >
        <MoreOutlined />
      </Button>
    </Dropdown>
  );

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
          <PackExportButton api={api} moduleKey="inventory" label={moduleLabel(key)} />
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
      {/*
        负重 / 容量条（REQ-033 / F-5）
        两个口径并排：200 株草药占 1 格却可能压垮肩膀，作者需要同时看到两把尺子。
        上限为 0 显示「不限」而不是 0 —— 「不限」和「上限为零」是相反的结论。
      */}
      <div className="cpk-inv__load">
        <span className={`cpk-inv__loadseg${load.capacity.full ? " is-over" : ""}`}>
          格数 {load.capacity.used}
          {load.capacity.limit > 0 ? `/${load.capacity.limit}` : "（不限）"}
        </span>
        <span className="cpk-inv__loadsep">·</span>
        <span className={`cpk-inv__loadseg${load.weight.over ? " is-over" : ""}`}>
          负重 {formatWeight(load.weight.total)}
          {load.weight.limit > 0 ? `/${formatWeight(load.weight.limit)}` : "（不限）"}
        </span>
        {load.capacity.full ? <span className="cpk-inv__loadwarn">背包已满</span> : null}
        {load.weight.over ? <span className="cpk-inv__loadwarn">超载</span> : null}
        {load.weight.over && !overloadStatus ? (
          <Button
            className="cpk-btn ghost"
            onClick={addOverloadStatus}
            title="在「状态效果」里建一条超载并立刻填数值"
          >
            记为状态
          </Button>
        ) : null}
        <Button
          className="cpk-btn ghost"
          onClick={() => setLimitsOpen((open) => !open)}
          aria-expanded={limitsOpen}
        >
          {limitsOpen ? "收起" : "上限"}
        </Button>
      </div>

      {limitsOpen ? (
        <div className="cpk-inv__limits">
          <label className="cpk-inv__limitfield">
            <span className="cpk-inv__limitlabel">格数上限</span>
            <InputNumber
              size="small"
              min={0}
              step={1}
              className="cpk-inv__limitnum"
              value={doc.character.capacityLimit}
              placeholder="0 = 不限"
              onChange={(value) => api.setLoadLimits({ capacityLimit: Number(value) || 0 })}
            />
          </label>
          <label className="cpk-inv__limitfield">
            <span className="cpk-inv__limitlabel">负重上限</span>
            <InputNumber
              size="small"
              min={0}
              step={1}
              className="cpk-inv__limitnum"
              value={doc.character.weightLimit}
              placeholder="0 = 不限"
              onChange={(value) => api.setLoadLimits({ weightLimit: Number(value) || 0 })}
            />
          </label>
          <p className="cpk-inv__limithint">
            填 0 表示不限。重量填在每件物品的「描述与标签」里，总重按「单件重量 × 数量」累计。
          </p>
        </div>
      ) : null}

      {doc.items.length === 0 ? (
        <p className="cpk-empty">还没有物品。把主角身上带着的东西先记下来，比「回头再补」靠谱。</p>
      ) : items.length === 0 ? (
        <p className="cpk-empty">没有匹配「{debounced}」的物品。</p>
      ) : (
        <ul className={`cpk-inv${grid ? " is-grid" : ""}`}>
          {visible.map((item) => {
            const equipped = isItemEquipped(item);
            const open = detailId === item.id;
            return (
              <li key={item.id} className={`cpk-inv__item${equipped ? " is-equipped" : ""}`}>
                <div className="cpk-inv__line">
                  {renderRarity(item)}
                  <PackChangedDot
                    updatedAt={item.updatedAt}
                    changed={api.isRecentlyChanged(item.updatedAt)}
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
                  {renderMore(item, open)}
                </div>

                {open ? (
                  <div className="cpk-inv__detail">
                    <Input.TextArea
                      size="small"
                      autoSize={{ minRows: 1, maxRows: 3 }}
                      className="cpk-inv__desc"
                      value={item.desc}
                      placeholder="描述 / 来历（可选）"
                      aria-label="物品描述"
                      onChange={(event) => api.updateItem(item.id, { desc: event.target.value })}
                    />
                    <Input
                      size="small"
                      className="cpk-inv__tags"
                      value={tagsDraft[item.id] ?? item.tags.join(" ")}
                      placeholder="标签（空格分隔）"
                      aria-label="物品标签"
                      onChange={(event) =>
                        setTagsDraft((prev) => ({ ...prev, [item.id]: event.target.value }))
                      }
                      onBlur={() => commitTags(item.id)}
                      onPressEnter={() => commitTags(item.id)}
                    />
                    {/*
                      单件重量（REQ-033）。放在详情行而不是主行：
                      面板最窄 340px 时主行只剩 285px，而「已穿戴 + 角标」已经占掉 292px
                      —— 主行里再加一个数字输入框，会把这个模块整体撑出容器。
                    */}
                    <div className="cpk-inv__meta">
                      <span className="cpk-inv__metalabel">单件重量</span>
                      <InputNumber
                        size="small"
                        min={0}
                        step={0.1}
                        className="cpk-inv__weight"
                        value={item.weight || undefined}
                        placeholder="0 = 没记"
                        aria-label="单件重量"
                        onChange={(value) =>
                          api.updateItem(item.id, { weight: Math.max(0, Number(value) || 0) })
                        }
                      />
                      <span className="cpk-inv__subtotal">
                        {item.weight > 0
                          ? `小计 ${formatWeight(itemWeight(item))}（${item.qty} 件）`
                          : "总重不含这一件"}
                      </span>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {items.length > visible.length ? (
        <div className="cpk-inv__more">
          <Button
            className="cpk-btn ghost"
            onClick={() => setWindowCount((count) => count + INVENTORY_RENDER_WINDOW)}
          >
            显示更多（还有 {items.length - visible.length} 条）
          </Button>
        </div>
      ) : null}

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
