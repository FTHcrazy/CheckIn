import { useCallback, useMemo, useState } from "react";
import { Button, Checkbox, Input, Popconfirm, Segmented, Spin, Tooltip } from "antd";
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  ReloadOutlined,
  SearchOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import SvgIcon from "@/shared/components/SvgIcon";
import recycleBinSvg from "@/assets/novel/recycle-bin.svg?raw";
import type { NovelTrashItemDTO } from "@/shared/types/electron";
import TrashRow from "./components/TrashRow";
import { useTrashBin } from "./hooks/useTrashBin";
import {
  countTrashKinds,
  filterTrashItems,
  isAllSelected,
  latestDeleted,
  pickSelected,
  toggleSelectAll,
  toggleSelection,
  trashKey,
  type TrashKindFilter,
} from "./recycle-bin-utils";
import "./index.scss";

interface RecycleBinPageProps {
  /** 返回书架（回收站是书架下的一个独立页面，不是弹窗） */
  onBack: () => void;
}

/**
 * 回收站页面（2.5.0 从「数据安全」弹窗里拆出来）。
 *
 * 为什么独立成页而不是继续挤在弹窗里：回收站的三件事 —— 看清「丢了什么」、
 * 挑选要捞回的、决定哪些彻底销毁 —— 都需要横向空间（类型 / 归属作品 / 规模 /
 * 剩余天数 / 两个动作），塞进 560px 的弹窗后每行只能靠省略号过日子。
 * 备份 / 恢复是低频一步操作，留在弹窗；回收站是低频但**逐条判断**的事，给它一页。
 *
 * 职责边界：本组件只做编排与渲染，「调哪条通道 / 过期清理 / 批量串行」在
 * `hooks/useTrashBin`，纯规则（文案 / 计数 / 筛选 / 选中）在 `recycle-bin-utils`。
 */
export default function RecycleBinPage({ onBack }: RecycleBinPageProps) {
  const { items, retentionDays, loading, busyKey, reload, restoreOne, purgeOne, restoreMany, purgeMany, emptyAll } =
    useTrashBin();

  const [kind, setKind] = useState<TrashKindFilter>("all");
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const counts = useMemo(() => countTrashKinds(items), [items]);
  const visible = useMemo(
    () => filterTrashItems(items, kind, keyword),
    [items, kind, keyword],
  );
  const selectedItems = useMemo(() => pickSelected(items, selected), [items, selected]);
  const allSelected = isAllSelected(visible, selected);
  const someSelected = !allSelected && visible.some((item) => selected.has(trashKey(item)));
  const latest = useMemo(() => latestDeleted(items), [items]);

  const segOptions = useMemo(
    () => [
      { label: `全部 ${counts.all}`, value: "all" as TrashKindFilter },
      { label: `作品 ${counts.work}`, value: "work" as TrashKindFilter },
      { label: `卷 ${counts.volume}`, value: "volume" as TrashKindFilter },
      { label: `章节 ${counts.chapter}`, value: "chapter" as TrashKindFilter },
    ],
    [counts],
  );

  /** 单条操作成功后把该条从选中集合里摘掉，避免「已选 N 项」算上已经不在的条目 */
  const dropSelection = useCallback((item: NovelTrashItemDTO): void => {
    setSelected((prev) => toggleSelection(prev, trashKey(item), false));
  }, []);

  const handleToggle = useCallback((item: NovelTrashItemDTO, checked: boolean): void => {
    setSelected((prev) => toggleSelection(prev, trashKey(item), checked));
  }, []);

  const handleRestoreOne = useCallback(
    async (item: NovelTrashItemDTO): Promise<void> => {
      await restoreOne(item);
      dropSelection(item);
    },
    [restoreOne, dropSelection],
  );

  const handlePurgeOne = useCallback(
    async (item: NovelTrashItemDTO): Promise<void> => {
      await purgeOne(item);
      dropSelection(item);
    },
    [purgeOne, dropSelection],
  );

  const handleRestoreMany = useCallback(async (): Promise<void> => {
    await restoreMany(selectedItems);
    setSelected(new Set());
  }, [restoreMany, selectedItems]);

  const handlePurgeMany = useCallback(async (): Promise<void> => {
    await purgeMany(selectedItems);
    setSelected(new Set());
  }, [purgeMany, selectedItems]);

  const handleEmpty = useCallback(async (): Promise<void> => {
    await emptyAll();
    setSelected(new Set());
  }, [emptyAll]);

  const busyAll = busyKey !== null;

  return (
    <div className="rb-page">
      {/* ── 页头：返回 / 标题 / 危险操作 ── */}
      <header className="rb-page__head">
        <Tooltip title="返回书架">
          <Button
            className="rb-page__back"
            aria-label="返回书架"
            icon={<ArrowLeftOutlined />}
            onClick={onBack}
          />
        </Tooltip>

        <div className="rb-page__title-block">
          <div className="rb-page__title-row">
            <SvgIcon svg={recycleBinSvg} className="rb-page__icon" />
            <h1 className="rb-page__title">回收站</h1>
            {items.length > 0 && (
              <span className="rb-page__count">{items.length} 项</span>
            )}
          </div>
          <p className="rb-page__subtitle">
            误删的内容会在这里保留 {retentionDays} 天，随时可以原样找回
          </p>
        </div>

        <div className="rb-page__head-actions">
          <Button
            className="rb-page__refresh"
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={() => void reload()}
          >
            刷新
          </Button>
          <Popconfirm
            title={`清空回收站（${items.length} 项）？`}
            description="这些内容将被销毁，无法恢复。"
            okText="清空"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => void handleEmpty()}
            disabled={items.length === 0 || busyAll}
          >
            <Button
              className="rb-page__empty-btn"
              icon={<DeleteOutlined />}
              disabled={items.length === 0 || busyAll}
            >
              清空回收站
            </Button>
          </Popconfirm>
        </div>
      </header>

      {/* 滚动区：页头固定在容器外（页头里有「清空回收站」这种破坏性操作，
          滚到列表底部还想动它时不必先滚回顶部）。用「页头 + 滚动区」两段结构
          而不是 sticky —— sticky 在带 padding 的滚动容器里吸不到顶边，
          负 margin 抵消又会随媒体查询失配（实测吸附位置会偏 40px）。 */}
      <div className="rb-page__scroll">
        {/* ── 规模概览：条目 / 保留期 / 最近一次删除 ── */}
        <div className="rb-page__stats">
          <div className="rb-page__stat">
            <b className="rb-page__stat-value">{counts.all} 项</b>
            <span className="rb-page__stat-label">
              可恢复条目 · 作品 {counts.work} / 卷 {counts.volume} / 章节 {counts.chapter}
            </span>
          </div>
          <div className="rb-page__stat">
            <b className="rb-page__stat-value">{retentionDays} 天</b>
            <span className="rb-page__stat-label">保留期 · 过期自动彻底删除</span>
          </div>
          <div className="rb-page__stat">
            <b className="rb-page__stat-value">{latest ? latest.at : "—"}</b>
            <span className="rb-page__stat-label">
              最近一次删除{latest ? ` · ${latest.workName}` : " · 暂无"}
            </span>
          </div>
        </div>

        {/* ── 筛选栏：类型 / 关键词 ── */}
        <div className="rb-page__bar">
          <Segmented<TrashKindFilter>
            className="rb-page__seg"
            value={kind}
            options={segOptions}
            onChange={setKind}
          />
          <div className="rb-page__bar-right">
            <Input
              className="rb-page__search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索名称或所属作品"
              prefix={<SearchOutlined />}
              allowClear
            />
            <span className="rb-page__sort">按删除时间倒序</span>
          </div>
        </div>

        {/* ── 批量操作条：有选中才出现，避免常驻一条空壳 ── */}
        {selectedItems.length > 0 && (
          <div className="rb-page__selection">
            <span className="rb-page__selection-count">已选 {selectedItems.length} 项</span>
            <Button
              className="rb-page__bulk"
              size="small"
              icon={<UndoOutlined />}
              disabled={busyAll}
              onClick={() => void handleRestoreMany()}
            >
              批量恢复
            </Button>
            <Popconfirm
              title={`彻底删除这 ${selectedItems.length} 项？`}
              description="正文与全部历史快照将一并销毁，无法恢复。"
              okText="彻底删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => void handlePurgeMany()}
              disabled={busyAll}
            >
              <Button
                className="rb-page__bulk rb-page__bulk--danger"
                size="small"
                icon={<DeleteOutlined />}
                disabled={busyAll}
              >
                批量彻底删除
              </Button>
            </Popconfirm>
            <Button
              className="rb-page__bulk"
              size="small"
              type="text"
              onClick={() => setSelected(new Set())}
            >
              取消选择
            </Button>
          </div>
        )}

        {/* ── 列表 ── */}
        <section className="rb-page__list" aria-label="回收站内容">
          <div className="rb-page__list-head">
            <Checkbox
              checked={allSelected}
              indeterminate={someSelected}
              disabled={visible.length === 0}
              onChange={(event) => {
                const checked = event.target.checked;
                setSelected((prev) => toggleSelectAll(prev, visible, checked));
              }}
            >
              全选
            </Checkbox>
            <span className="rb-page__list-count">共 {visible.length} 项</span>
          </div>

          {loading ? (
            <div className="rb-page__loading">
              <Spin size="small" />
              <span>正在读取回收站…</span>
            </div>
          ) : items.length === 0 ? (
            <div className="rb-page__empty">
              <span className="rb-page__empty-icon">
                <SvgIcon svg={recycleBinSvg} />
              </span>
              <b className="rb-page__empty-title">回收站是空的</b>
              <span className="rb-page__empty-hint">
                删掉的作品、卷、章节会先放进这里，{retentionDays} 天内都可以原样找回
              </span>
              <Button size="small" onClick={onBack}>
                回到书架
              </Button>
            </div>
          ) : visible.length === 0 ? (
            <div className="rb-page__empty rb-page__empty--filtered">
              <b className="rb-page__empty-title">没有匹配的条目</b>
              <span className="rb-page__empty-hint">换个关键词，或把类型切回「全部」</span>
            </div>
          ) : (
            <ul className="rb-page__rows">
              {visible.map((item) => {
                const key = trashKey(item);
                return (
                  <TrashRow
                    key={key}
                    item={item}
                    selected={selected.has(key)}
                    busy={busyKey === key}
                    onToggle={(checked) => handleToggle(item, checked)}
                    onRestore={() => void handleRestoreOne(item)}
                    onPurge={() => void handlePurgeOne(item)}
                  />
                );
              })}
            </ul>
          )}

          <footer className="rb-page__list-foot">
            <span>彻底删除会连同正文与全部历史快照一起销毁，无法恢复</span>
            <span>过期条目在进入本页时自动清理</span>
          </footer>
        </section>

        {/* ── 恢复规则：把「恢复后落到哪儿」讲清楚，减少找回前的犹豫 ── */}
        <section className="rb-page__rules">
          <h2 className="rb-page__rules-title">恢复规则</h2>
          <p className="rb-page__rule">
            · 恢复卷会连同「同批删除」的章节一起带回；删卷之前单独删掉的章节仍留在回收站。
          </p>
          <p className="rb-page__rule">
            · 原来的位置已被占用时，恢复的章节落到同级末尾，不会打乱已有的章节顺序。
          </p>
          <p className="rb-page__rule">
            · 恢复的作品直接回到书架；超过保留期的条目在进入本页时自动清理，并给出提示。
          </p>
        </section>
      </div>
    </div>
  );
}
