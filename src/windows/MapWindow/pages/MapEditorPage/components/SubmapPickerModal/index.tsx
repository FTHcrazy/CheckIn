/**
 * 跨图选择器 —— 路径 A′「绑定已有子图」的第一步（nested-submap-main.md §4.1.1）。
 *
 * 【职责边界】本组件只负责「从地图库里挑一张图」：
 *   · 列表 = 地图库全部在库地图（排除当前图；回收站里的图不出现 —— 绑一张
 *     随时会被彻底删除的图没有意义）；
 *   · 选中后把摘要交给页面，**拉全量文档、构造 MapSubmap、落库**都在页面侧
 *     （`submapFromDoc` + `editor.embedSubmap`），本组件不碰 store。
 *
 * 【拷贝语义的提示】绑定是「拷贝一份进来」，与源图此后互不相干 —— 这句话写在
 * 确认按钮的 Tooltip 里，比让用户绑完才发现"改源图子图不变"要友好。
 */
import { EnvironmentOutlined, WarningOutlined } from "@ant-design/icons";
import { Button, Empty, Modal, Spin, Tooltip } from "antd";
import { useCallback, useEffect, useState } from "react";
import type { MapDocSummaryDTO } from "@/shared/types/electron";
import { listMapDocs } from "../../persistence/useMapPersistence";
import "./index.scss";

/** 摘要卡片的更新时间（与地图库同款口径：只到分钟） */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface SubmapPickerModalProps {
  open: boolean;
  /** 当前图 id（从列表里排除 —— 不能把一张图绑定到它自己的区块上） */
  currentDocId: string | null;
  onClose: () => void;
  /** 选中一张图；页面负责加载与落库，之后自行关闭本弹窗 */
  onPick: (item: MapDocSummaryDTO) => void;
}

export default function SubmapPickerModal({
  open,
  currentDocId,
  onClose,
  onPick,
}: SubmapPickerModalProps) {
  const [docs, setDocs] = useState<MapDocSummaryDTO[] | null>(null);

  useEffect(() => {
    if (!open) {
      setDocs(null);
      return;
    }
    let alive = true;
    void listMapDocs().then((list) => {
      if (alive) setDocs(list.filter((d) => d.id !== currentDocId && d.deletedAt === null));
    });
    return () => {
      alive = false;
    };
  }, [open, currentDocId]);

  const pick = useCallback(
    (item: MapDocSummaryDTO) => {
      onPick(item);
    },
    [onPick],
  );

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={560}
      title="绑定已有地图"
      destroyOnHidden
    >
      <div className="submap-picker">
        <div className="submap-picker__hint">
          选一张地图库里的图，拷贝一份绑定到当前区块。绑定后两边各自独立编辑，互不影响。
        </div>
        {docs === null ? (
          <div className="submap-picker__loading">
            <Spin />
          </div>
        ) : docs.length === 0 ? (
          <Empty description="地图库里还没有其他地图（先去新建一张）" />
        ) : (
          <div className="submap-picker__list">
            {docs.map((doc) => (
              <div key={doc.id} className="submap-picker__row">
                <div className="submap-picker__thumb">
                  {doc.thumb ? (
                    <img className="submap-picker__thumb-img" src={doc.thumb} alt="" draggable={false} />
                  ) : (
                    <EnvironmentOutlined className="submap-picker__thumb-empty" />
                  )}
                </div>
                <div className="submap-picker__info">
                  <span className="submap-picker__title" title={doc.title}>
                    {doc.title}
                  </span>
                  <span className="submap-picker__meta">更新于 {formatTime(doc.updatedAt)}</span>
                </div>
                <Tooltip title="拷贝这张图的内容到当前区块（可撤销）">
                  <Button size="small" type="primary" onClick={() => pick(doc)}>
                    绑定
                  </Button>
                </Tooltip>
              </div>
            ))}
          </div>
        )}
        <div className="submap-picker__note">
          <WarningOutlined className="submap-picker__note-icon" />
          拷贝是当时的快照：之后修改源图不会同步过来，删除源图也不影响已绑定的内容。
        </div>
      </div>
    </Modal>
  );
}
