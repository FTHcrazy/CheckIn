/**
 * 左侧要素资料池（S2：搜索 + 类型筛选 + 拖入 / 拖回 + 一键上图；S4：键盘可达）
 *
 * 池子列出**本书全部要素**（不是只有未上图的）：已上图的打「图上」标，未上图的
 * 打「未上图」标。这样「要素一个都没少」是可数的（状态栏 `X + M = Y`），
 * 也不需要用户在图与池之间对账。
 *
 * 两条上图路径（都要有，缺一条就有人用不了）：
 * - **拖**：HTML5 DnD 把行拖到画布上，落点即坐标（React Flow 官方 DnD 范式）；
 * - **点 / 键盘**：行尾「上图」按钮 + `↑↓` 在行间移动 + `Enter` 主操作。
 *
 * 为什么不用 `role="listbox"` + roving tabindex：listbox 的 option 里不该嵌
 * 按钮（行尾「移出」是第二个可操作目标），而且 roving 会把每行压成一个 tab
 * 停靠点之后，键盘用户就再也到不了「移出」。这里改成**行内方向键导航**：
 * tab 序保持原样（每行两个按钮都能到），方向键只是加速。
 */
import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button, Input } from "antd";
import { DownOutlined, SearchOutlined } from "@ant-design/icons";
import type { EntityTypeMeta } from "@/shared/novel/entity-type-meta";
import type { RelationGraphNode } from "@/shared/novel/relation-graph";
import PoolRow from "./components/PoolRow";
import "./index.scss";

/** 拖拽负载类型（定义在 dnd.ts，避免与行组件形成循环 import） */
export { REL_NODE_DND_TYPE } from "./dnd";

export interface EntityPoolProps {
  /** 本书全部要素（上图 + 池中） */
  nodes: readonly RelationGraphNode[];
  metaOf: (type: string) => EntityTypeMeta;
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
  /** 一键上图（落点由画布按空闲位给） */
  onAdd: (nodeId: string) => void;
  /** 一键移出画布（关系数据不动） */
  onRemove: (nodeId: string) => void;
  /** 搜索不到结果时的提示语（区分「该书没有要素」与「筛选没命中」） */
  emptyHint?: string;
}

export default function EntityPool({
  nodes,
  metaOf,
  selectedId,
  onSelect,
  onAdd,
  onRemove,
  emptyHint,
}: EntityPoolProps) {
  const [query, setQuery] = useState("");
  /** 收起的类型（默认全展开：池子是「要素一个都没少」的证据，不该一进来就藏着） */
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);

  /** 类型的出现顺序：按节点原始顺序（要素 sort），保证每次打开一致 */
  const types = useMemo(() => {
    const order: string[] = [];
    for (const node of nodes) {
      if (!order.includes(node.type)) order.push(node.type);
    }
    return order;
  }, [nodes]);

  const graphCount = useMemo(() => nodes.filter((node) => node.linked).length, [nodes]);
  /** W-07：未上图 N 与「全部 − 成员」逐次相等，头部常驻 */
  const offGraphCount = nodes.length - graphCount;

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return nodes;
    return nodes.filter(
      (node) =>
        // 名称 + 别名 + 一句话：与主窗口要素库的检索口径一致（PM W-08）
        node.name.toLowerCase().includes(keyword) ||
        node.aliases.some((alias) => alias.toLowerCase().includes(keyword)) ||
        node.summary.toLowerCase().includes(keyword),
    );
  }, [nodes, query]);

  /** 按类型分组（W-08）：顺序沿用节点原始顺序，保证每次打开一致 */
  const groups = useMemo(() => {
    const byType = new Map<string, RelationGraphNode[]>();
    for (const node of filtered) {
      const list = byType.get(node.type);
      if (list) list.push(node);
      else byType.set(node.type, [node]);
    }
    return types
      .map((type) => ({ type, meta: metaOf(type), rows: byType.get(type) ?? [] }))
      .filter((group) => group.rows.length > 0);
  }, [filtered, metaOf, types]);

  const searching = query.trim().length > 0;
  const isOpen = useCallback(
    (type: string) => searching || !collapsed.includes(type),
    [collapsed, searching],
  );

  const toggleGroup = useCallback((type: string) => {
    setCollapsed((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
  }, []);

  /** 行间移动：只认 DOM 顺序（= 当前展开且可见的顺序），不另存一份 index */
  const moveRow = useCallback((from: HTMLElement, offset: number | "first" | "last") => {
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-pool-row]") ?? [],
    ).filter((row) => !row.closest('[data-pool-group][data-open="0"]'));
    if (rows.length === 0) return;
    const index = rows.indexOf(from);
    const next =
      offset === "first"
        ? 0
        : offset === "last"
          ? rows.length - 1
          : Math.min(rows.length - 1, Math.max(0, index + offset));
    rows[next]?.focus();
  }, []);

  /**
   * 键盘口径（与鼠标刻意不同，见文件头）：
   * - `↑↓ / Home / End`：在可见行之间移动焦点（只走展开分组里的行）；
   * - `Enter`：**主操作** —— 未上图 = 上图；已上图 = 选中（打开右侧详情卡）。
   *   鼠标点行始终是「选中」，因为点一下就想看看是什么，不是想改画布。
   */
  const handleRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>, node: RelationGraphNode) => {
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          moveRow(event.currentTarget, 1);
          break;
        case "ArrowUp":
          event.preventDefault();
          moveRow(event.currentTarget, -1);
          break;
        case "Home":
          event.preventDefault();
          moveRow(event.currentTarget, "first");
          break;
        case "End":
          event.preventDefault();
          moveRow(event.currentTarget, "last");
          break;
        case "Enter":
          event.preventDefault();
          if (node.linked) onSelect(node.id);
          else onAdd(node.id);
          break;
        default:
          break;
      }
    },
    [moveRow, onAdd, onSelect],
  );
  return (
    // data-rel-pool：画布把节点拖到这块区域即「移出」（元素命中用 closest 判定）
    <aside className="rel-pool" aria-label="要素资料池" data-rel-pool="1">
      <header className="rel-pool__head">
        <div className="rel-pool__title">
          要素资料池
          <span className="rel-pool__counts">
            <span className="rel-pool__count">
              {graphCount} / {nodes.length} 已上图
            </span>
            <span className="rel-pool__count rel-pool__count--off">未上图 {offGraphCount}</span>
          </span>
        </div>

        <Input
          className="rel-pool__search"
          size="small"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          // 在检索框里按 ↓ 直接跳进结果列表：这是「搜索 → 定位 → Enter」的键盘路径
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown") return;
            const first = listRef.current?.querySelector<HTMLElement>("[data-pool-row]");
            if (!first) return;
            event.preventDefault();
            first.focus();
          }}
          placeholder="搜索名称、别名或简介"
          aria-label="搜索要素"
          allowClear
          prefix={<SearchOutlined className="rel-pool__search-icon" />}
        />

      </header>

      <div className="rel-pool__list" ref={listRef}>
        {groups.length === 0 ? (
          <p className="rel-pool__empty">
            {nodes.length === 0 ? "这本书还没有任何要素" : emptyHint ?? "未找到要素"}
          </p>
        ) : (
          groups.map((group) => {
            const open = isOpen(group.type);
            return (
              <section
                key={group.type}
                className="rel-pool__group"
                data-pool-group={group.type}
                data-open={open ? "1" : "0"}
              >
                <Button
                  type="text"
                  block
                  className="rel-pool__group-head"
                  aria-expanded={open}
                  autoInsertSpace={false}
                  onClick={() => toggleGroup(group.type)}
                >
                  <span
                    className="rel-pool__dot"
                    style={{ background: group.meta.color }}
                    aria-hidden="true"
                  />
                  <span className="rel-pool__group-name">{group.meta.label}</span>
                  <span className="rel-pool__group-count">{group.rows.length}</span>
                  <DownOutlined className="rel-pool__group-caret" aria-hidden="true" />
                </Button>

                <div className="rel-pool__group-body">
                  <ul className="rel-pool__rows">
                    {group.rows.map((node) => (
                      <PoolRow
                        key={node.id}
                        node={node}
                        typeLabel={group.meta.label}
                        selected={selectedId === node.id}
                        onSelect={onSelect}
                        onAdd={onAdd}
                        onRemove={onRemove}
                        onKeyDown={handleRowKeyDown}
                      />
                    ))}
                  </ul>
                </div>
              </section>
            );
          })
        )}
      </div>

      <footer className="rel-pool__foot">
        拖到画布即上图，拖回本区域即移出；成员与坐标按作品记住。
      </footer>
    </aside>
  );
}
