import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Dropdown, Input, Select } from "antd";
import { CheckOutlined, MoreOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import SvgIcon from "@/shared/components/SvgIcon";
import categorySvg from "@/assets/novel/category.svg?raw";
import PackModuleShell from "../PackModuleShell";
import PackExportButton from "../PackExportButton";
import PackChangedDot from "../PackChangedDot";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { moduleLabel } from "../module-meta";
import { isItemEquipped, matchesKeyword } from "../../pack-utils";
import { INVENTORY_RENDER_WINDOW, INVENTORY_SEARCH_DEBOUNCE_MS, QTY_HOLD } from "../../pack-config";
import { ITEM_CATEGORIES, RARITY_KEYS, rarityMetaOf, type PackItem } from "../../types";
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

/** 出厂默认分类（1.40.0 起分类可管理，分类下拉以它作兜底：见 categoryOptions） */

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

  // accepts 存组 id（Phase 2 refactor 口径）：装备菜单里翻译回组名
  const groupNameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of doc?.groups ?? []) map.set(group.id, group.name);
    return map;
  }, [doc]);

  /**
   * 分类下拉选项（1.40.0）：分类管理里的行 + 出厂默认兜底。
   * 分类按名字关联物品行 —— 老数据里可能还留着不再存在的分类名
   * （或没播种分类的老角色），兜底合并保证「value 有值 + options 为空」
   * 不会出现（那会让 antd 显示裸值）。
   */
  const categoryOptions = useMemo(() => {
    const names = new Set<string>(ITEM_CATEGORIES);
    for (const category of doc?.categories ?? []) {
      if (category.name.trim()) names.add(category.name);
    }
    return [...names].map((name) => ({ value: name, label: name }));
  }, [doc]);

  if (!doc) return null;
  const key = "inventory" as const;
  const showSearch = doc.items.length >= 20;
  const slots = [...doc.slots].sort((a, b) => a.sortOrder - b.sortOrder);

  const equipOptions = slots.map((slot) => ({
    key: slot.id,
    label:
      slot.accepts.length > 0
        ? `${slot.name}（仅 ${slot.accepts.map((id) => groupNameOf.get(id) ?? "未知分组").join("/")}）`
        : slot.name,
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
   * 品阶行（1.40.0）：物品所属分类绑定了体系 → 下标注品阶（小刀 · 神器）；
   * 分类未绑 / 设定域没有体系 → 引导文案（用户要求「没有小说体系则提示引导」）。
   * 体系清单随 bundle 装载（挂载即有），不会出现「value 有值 + options 为空」。
   */
  const renderGradeOption = (item: PackItem) => {
    const systemId = api.categorySystemIdOf(item.category);
    const system = api.gradeSystems.find((row) => row.id === systemId);
    if (system) {
      return (
        <span className="cpk-inv__catopt">
          <span className="cpk-inv__catopt-label">品阶</span>
          <Select
            size="small"
            variant="borderless"
            className="cpk-inv__catopt-select"
            value={item.gradeId || undefined}
            placeholder="未标注"
            allowClear
            options={system.levels.map((level) => ({ value: level.id, label: level.name }))}
            popupMatchSelectWidth={false}
            classNames={{ popup: { root: "cpk-dropdown" } }}
            // 下拉本身在 menu 里：点它不该把外层菜单一起关掉
            onClick={(event) => event.stopPropagation()}
            onChange={(value?: string) => api.updateItem(item.id, { gradeId: value ?? "" })}
          />
        </span>
      );
    }
    const hint = api.hasGradeSystems
      ? "该分类未绑定体系，到「分类管理」绑定"
      : "先到「设定中心」建一个等级体系（如法宝品阶），再到分类管理绑定";
    return (
      <span className="cpk-inv__catopt">
        <span className="cpk-inv__catopt-label">品阶</span>
        <span className="cpk-inv__gradehint" title={hint}>
          {hint}
        </span>
      </span>
    );
  };

  /**
   * 行尾的「更多」菜单：**分类** + **品阶** + **加成效果** + **描述与标签** + **删除**
   *（1.41.0 起「分组」行内入口下线：物品不再逐个标分组，装备限制仍由
   * 部位的 accepts × 物品 groupId 匹配 —— 旧数据的 groupId 原样保留，
   * 分组管理入口收进装备栏链路，物品栏只管「带了什么、有多少」。）
   *
   * 2026-10 用户报障「行太窄、每行塞太多控件」：主行原本并排 8 个控件
   * （稀有度点 / 改动点 / 名称 / 分类下拉 / 数量 −N+ / 装备 / ✦ / ⋯），
   * 在 380px 窗口下名称输入框被压到只剩几十像素，连物品名都读不全。
   *
   * 减法的判据是**「是不是每次盘点都会动」**：
   *   - 名称、数量、装备态 → 每次都可能改，留在主行；
   *   - 分类 → 一件物品建好时定一次，之后基本不动 → 进菜单；
   *   - 加成效果（✦）→ 是「展开编辑器」的低频入口，且已在菜单里有同族项 → 进菜单；
   *   - 描述 / 标签 → 本来就低频 → 留在菜单。
   *
   * 被移走的两个都不是「紧急行为」：分类改错不影响汇总口径的数字，
   * 加成效果漏填会体现在总属性上、作者看得到。而删除是破坏性操作，
   * 留在菜单里天然多一道确认。
   *
   * ⚠️ 主行现在最窄只需容纳「点 + 名称 + 数量 + 装备 + ⋯」，
   * 名称输入框因此拿得回被分类下拉吃掉的 ~74px。
   */
  const renderMore = (item: PackItem, open: boolean) => (
    <Dropdown
      trigger={["click"]}
      classNames={{ root: "cpk-dropdown" }}
      menu={{
        items: [
          {
            key: "category",
            label: (
              <span className="cpk-inv__catopt">
                <span className="cpk-inv__catopt-label">分类</span>
                <Select
                  size="small"
                  variant="borderless"
                  className="cpk-inv__catopt-select"
                  value={item.category}
                  options={categoryOptions}
                  popupMatchSelectWidth={false}
                  classNames={{ popup: { root: "cpk-dropdown" } }}
                  // 下拉本身在 menu 里：点它不该把外层菜单一起关掉
                  onClick={(event) => event.stopPropagation()}
                  onChange={(value: string) => api.updateItem(item.id, { category: value })}
                />
              </span>
            ),
          },
          {
            key: "grade",
            label: renderGradeOption(item),
          },
          { key: "effect", label: "加成效果" },
          { key: "detail", label: open ? "收起描述与标签" : "描述 / 标签" },
          { type: "divider" },
          { key: "remove", label: "删除", danger: true },
        ],
        onClick: ({ key }) => {
          if (key === "effect") api.openEffectEditor("item", item.id, item.name || "物品");
          else if (key === "detail") toggleDetail(item.id);
          else if (key === "remove") setPendingRemove(item);
        },
      }}
    >
      <Button
        className={`cpk-iconbtn tiny${open ? " is-on" : ""}`}
        aria-label="更多操作"
        aria-haspopup="menu"
        title="分类 / 加成效果 / 描述 / 标签 / 删除"
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
          <Button className="cpk-btn ghost" onClick={() => api.addItem()}>
            <PlusOutlined /> 物品
          </Button>
          <Button
            className="cpk-iconbtn"
            onClick={() => api.setCategoryManagerOpen(true)}
            title="分类管理（改名 / 绑定体系品阶）"
          >
            <SvgIcon svg={categorySvg} />
          </Button>
        </>
      }
    >
      {doc.items.length === 0 ? (
        <p className="cpk-empty">还没有物品。把主角身上带着的东西先记下来，比「回头再补」靠谱。</p>
      ) : items.length === 0 ? (
        <p className="cpk-empty">没有匹配「{debounced}」的物品。</p>
      ) : (
        <ul className="cpk-inv">
          {visible.map((item) => {
            const equipped = isItemEquipped(item);
            const open = detailId === item.id;
            // 品阶 chip（1.40.0）：「小刀 · 神器」的「神器」。等级被删 / id
            // 悬空时翻译不出名字，不渲染（而不是显示一串裸 id）
            const gradeName = api.gradeNameOf(item.gradeId);
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
                  {gradeName ? (
                    <span className="cpk-inv__grade" title={`品阶：${gradeName}`}>
                      {gradeName}
                    </span>
                  ) : null}
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
