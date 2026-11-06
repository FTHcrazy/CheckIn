/**
 * 地图库（列表 / 新建 / 改名 / 绑定作品 / 回收站）。
 *
 * 【为什么是弹窗而不是"首屏列表态"】地图是画布工具，用户的日常路径是
 * 「打开窗口 → 接着上次那张画」；把列表做成首屏等于每次都要多点一下。
 * 库入口常驻工具栏，只在"换一张 / 管理"时才拉开 —— 这也让窗口不必维护
 * 两套页面状态（列表态与编辑态互斥的那些边界）。
 *
 * 本组件是**纯展示 + 局部交互**：列表与作品选项自己拉（弹窗时才拉，省一次启动
 * 期的无用请求），所有写操作都转给 `actions`（`useMapPersistence`），
 * 组件内不直接碰 IPC 的写通道。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Dropdown,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Spin,
  Tooltip,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  EnvironmentOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { MapDocSummaryDTO } from "@/shared/types/electron";
import { listMapDocs, listMapWorkOptions } from "../../persistence/useMapPersistence";
import "./index.scss";

/** 库入口的动作集合（全部来自 `useMapPersistence`，本层不实现业务） */
export interface MapLibraryActions {
  open: (id: string) => void | Promise<void>;
  create: (options?: { title?: string }) => void | Promise<void>;
  rename: (id: string, title: string) => void | Promise<void>;
  remove: (id: string) => void | Promise<void>;
  restore: (id: string) => void | Promise<void>;
  purge: (id: string) => void | Promise<void>;
  bind: (id: string, workId: string | null) => void | Promise<void>;
}

export interface MapLibraryModalProps {
  open: boolean;
  currentId: string | null;
  onClose: () => void;
  actions: MapLibraryActions;
}

/** 列表/回收站两个视图（不是"两种数据源"：同一条查询换个 WHERE） */
type LibraryTab = "docs" | "trash";

/**
 * 更新时间的人话化。
 *
 * 【为什么不引 dayjs 的 relativeTime】项目里没有引入 relativeTime 插件，
 * 而为一句"3 分钟前"多拉一个插件不划算；这里只覆盖列表真正需要的三档。
 */
function formatTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "—";
  const now = Date.now();
  const diff = now - timestamp;
  const date = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (diff < 60_000) return "刚刚";
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  const today = new Date(now);
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (sameDay) return `今天 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const yesterday = new Date(now - 24 * 60 * 60_000);
  if (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  ) {
    return `昨天 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function MapLibraryModal({
  open,
  currentId,
  onClose,
  actions,
}: MapLibraryModalProps) {
  const [tab, setTab] = useState<LibraryTab>("docs");
  const [docs, setDocs] = useState<MapDocSummaryDTO[]>([]);
  const [works, setWorks] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(false);
  /** 正在内联改名的 id（`null` = 没有） */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, workList] = await Promise.all([
        listMapDocs({ includeDeleted: tab === "trash" }),
        listMapWorkOptions(),
      ]);
      // 一屏只渲染「当前视图」的那批：在架与回收站从不同时出现，避免误删
      setDocs(list.filter((item) => (tab === "trash" ? item.deletedAt !== null : item.deletedAt === null)));
      setWorks(workList);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  /** 作品 id → 名称（绑定展示与"所属作品在回收站"灰标都要用） */
  const workNameOf = useMemo(() => {
    const map = new Map(works.map((work) => [work.id, work.name]));
    return (workId: string | null) => (workId ? map.get(workId) ?? null : null);
  }, [works]);

  /**
   * 写操作的统一收尾。
   *
   * 【为什么必须 try / finally，而不是 `await 动作(); await load();`】
   * 二次确认框（antd `Popconfirm`）只在 `onConfirm` 返回的 promise **resolve**
   * 时才关闭自己 —— 走到 `antd/es/_util/ActionButton.js` 的 reject 分支会
   * `setLoading(false)` 然后原样留在屏幕上。而写操作是会 reject 的（IPC 失败、
   * `message.success` 抛错……），一旦它抛，"刷新列表"和"收起确认框"两件事一起没了，
   * 用户看到的就是「点了没反应」。所以：动作失败只记日志（面向用户的错误文案
   * 归 `useMapPersistence`，它才知道失败原因），promise 一律收成 resolve，
   * 列表每次都重拉。
   */
  const runWrite = useCallback(
    async (action: () => void | Promise<void>) => {
      try {
        await action();
      } catch (error) {
        console.error("[map-library] 写操作失败", error);
      } finally {
        await load();
      }
    },
    [load],
  );

  const handleCreate = useCallback(async () => {
    // 名字带序号：一堆「未命名地图」在列表里完全分不清谁是谁
    await actions.create({ title: `未命名地图 ${docs.length + 1}` });
    setTab("docs");
    await load();
  }, [actions, docs.length, load]);

  const commitRename = useCallback(
    async (id: string) => {
      const next = editingText.trim();
      setEditingId(null);
      if (!next) return;
      await runWrite(() => actions.rename(id, next));
    },
    [actions, editingText, runWrite],
  );

  const renderRow = (doc: MapDocSummaryDTO) => {
    const boundName = workNameOf(doc.workId);
    const isCurrent = doc.id === currentId;
    const isTrash = doc.deletedAt !== null;
    return (
      <div
        key={doc.id}
        className={isCurrent ? "map-library__row map-library__row--current" : "map-library__row"}
      >
        <div className="map-library__thumb">
          {doc.thumb ? (
            <img className="map-library__thumb-img" src={doc.thumb} alt="" draggable={false} />
          ) : (
            <EnvironmentOutlined className="map-library__thumb-empty" />
          )}
        </div>

        <div className="map-library__info">
          {editingId === doc.id ? (
            <Input
              size="small"
              autoFocus
              value={editingText}
              maxLength={40}
              aria-label="地图名"
              onChange={(event) => setEditingText(event.target.value)}
              onPressEnter={() => void commitRename(doc.id)}
              onBlur={() => void commitRename(doc.id)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setEditingId(null);
              }}
            />
          ) : (
            <div className="map-library__title-line">
              <span className="map-library__title" title={doc.title}>
                {doc.title}
              </span>
              {isCurrent && <span className="map-library__badge">当前</span>}
              {isTrash && <span className="map-library__badge map-library__badge--warn">回收站</span>}
            </div>
          )}
          <div className="map-library__meta">
            <span>{isTrash ? `删除于 ${formatTime(doc.deletedAt ?? 0)}` : `更新于 ${formatTime(doc.updatedAt)}`}</span>
            <span className="map-library__dot">·</span>
            <span>{boundName ? `《${boundName}》` : "独立地图"}</span>
          </div>
        </div>

        <div className="map-library__row-actions">
          {isTrash ? (
            <>
              <Button
                size="small"
                onClick={() => void runWrite(() => actions.restore(doc.id))}
              >
                恢复
              </Button>
              <Popconfirm
                title="彻底删除这张地图？"
                description="文档、历史版本与素材会被永久删除，无法撤销。"
                okText="彻底删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={() => runWrite(() => actions.purge(doc.id))}
              >
                <Button size="small" danger icon={<DeleteOutlined />} aria-label="彻底删除" />
              </Popconfirm>
            </>
          ) : (
            <>
              <Button
                size="small"
                type={isCurrent ? "default" : "primary"}
                disabled={isCurrent}
                onClick={async () => {
                  await actions.open(doc.id);
                  onClose();
                }}
              >
                {isCurrent ? "编辑中" : "打开"}
              </Button>
              {/*
                绑定作品用 Dropdown 而不是 Select：一行一个 Select 会让整个列表
                长满表单控件；下拉菜单只在点开时出现，列表保持"一眼扫过去"。
              */}
              <Dropdown
                trigger={["click"]}
                placement="bottomRight"
                menu={{
                  selectable: true,
                  selectedKeys: [doc.workId ?? "__none__"],
                  items: [
                    { key: "__none__", label: "独立地图（不绑定）" },
                    ...(works.length > 0 ? [{ type: "divider" as const, key: "__divider__" }] : []),
                    ...works.map((work) => ({ key: work.id, label: work.name })),
                  ],
                  onClick: ({ key }) =>
                    void runWrite(() => actions.bind(doc.id, key === "__none__" ? null : key)),
                }}
              >
                <Tooltip title="绑定到作品（地图可以先独立存在，之后再挂到书里）">
                  <Button size="small" aria-label="绑定作品">
                    {boundName ? "已绑定" : "绑定"}
                  </Button>
                </Tooltip>
              </Dropdown>
              <Tooltip title="重命名">
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  aria-label="重命名"
                  onClick={() => {
                    setEditingId(doc.id);
                    setEditingText(doc.title);
                  }}
                />
              </Tooltip>
              <Popconfirm
                title="把这张地图移入回收站？"
                description="随时可以在「回收站」里恢复。"
                okText="移入回收站"
                cancelText="取消"
                // 【删当前图也不关弹窗】deleteDoc 会先断开 file、再自动切到下一张图
                // （docId 随之变化）；弹窗保持打开 + 刷新列表，用户才能看到
                // 「被删图消失、新当前图带上『当前』标记」。返回值必须 resolve，
                // 否则 antd 的二次确认框不会自己收起（见 runWrite 注释）。
                onConfirm={() => runWrite(() => actions.remove(doc.id))}
              >
                <Tooltip title="移入回收站">
                  <Button size="small" icon={<DeleteOutlined />} aria-label="移入回收站" />
                </Tooltip>
              </Popconfirm>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      title="地图库"
      destroyOnHidden
    >
      <div className="map-library">
        <div className="map-library__bar">
          <div className="map-library__tabs">
            <Button
              size="small"
              type={tab === "docs" ? "primary" : "text"}
              aria-pressed={tab === "docs"}
              onClick={() => setTab("docs")}
            >
              全部地图
            </Button>
            <Button
              size="small"
              type={tab === "trash" ? "primary" : "text"}
              aria-pressed={tab === "trash"}
              onClick={() => setTab("trash")}
            >
              回收站
            </Button>
          </div>
          <div className="map-library__bar-actions">
            <Tooltip title="重新读取列表">
              <Button
                size="small"
                icon={<ReloadOutlined />}
                aria-label="刷新列表"
                onClick={() => void load()}
              />
            </Tooltip>
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => void handleCreate()}>
              新建地图
            </Button>
          </div>
        </div>

        <Spin spinning={loading}>
          <div className="map-library__list">
            {docs.length === 0 && !loading ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={tab === "trash" ? "回收站是空的" : "还没有地图，先新建一张"}
              >
                {tab === "docs" && (
                  <Button type="primary" size="small" onClick={() => void handleCreate()}>
                    新建地图
                  </Button>
                )}
              </Empty>
            ) : (
              docs.map(renderRow)
            )}
          </div>
        </Spin>

        <div className="map-library__hint">
          地图会随每次改动自动保存（关窗前还会再写一次）；绑定作品只是建立关联，解绑或删除作品都不会删掉地图本身。
        </div>
      </div>
    </Modal>
  );
}
