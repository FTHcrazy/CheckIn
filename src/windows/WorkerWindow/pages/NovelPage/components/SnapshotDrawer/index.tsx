import { useEffect } from "react";
import { CloseOutlined } from "@ant-design/icons";
import { formatClock, formatThousands } from "../../novel-utils";
import type { NovelSnapshot } from "../../types";
import "./index.scss";

interface SnapshotDrawerProps {
  open: boolean;
  snapshots: NovelSnapshot[];
  activeChapterId: string | null;
  onClose: () => void;
  onRollback: (snapshotId: string, snapshotTime: number) => void;
}

/**
 * 历史快照抽屉（D1 / R3）
 *
 * 右侧滑入 300px 的时间线：预览差异后一键回滚。
 * 回滚前可先看内容，回滚后当前正文自动存为新快照——回滚本身也可再回滚。
 */
export default function SnapshotDrawer({
  open,
  snapshots,
  activeChapterId,
  onClose,
  onRollback,
}: SnapshotDrawerProps) {
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) onClose();
    };
    if (!open) return undefined;
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open, onClose]);

  return (
    <aside className={`nv-snap${open ? " is-open" : ""}`}>
      <header className="nv-snap__head">
        <b>历史快照</b>
        <span className="nv-snap__sub">· 每章保留 20 版</span>
        <button type="button" aria-label="关闭" onClick={onClose}>
          <CloseOutlined />
        </button>
      </header>

      <div className="nv-snap__body">
        {!activeChapterId ? (
          <p className="nv-snap__empty">选择章节后查看它的快照</p>
        ) : snapshots.length === 0 ? (
          <p className="nv-snap__empty">本章还没有快照</p>
        ) : (
          snapshots.map((snapshot, index) => (
            <section key={snapshot.id} className="nv-snap__item">
              <span className="nv-snap__time">{formatClock(snapshot.createdAt)}</span>
              <span className="nv-snap__delta">
                {snapshot.deltaWords > 0
                  ? `+${formatThousands(snapshot.deltaWords)} 字`
                  : "本章创建"}
                {index === 0 && " · 当前"}
              </span>
              <span className="nv-snap__actions">
                {index !== 0 && (
                  <button
                    type="button"
                    onClick={() => onRollback(snapshot.id, snapshot.createdAt)}
                  >
                    回滚
                  </button>
                )}
              </span>
              {snapshot.content && (
                <p className="nv-snap__preview">{snapshot.content.slice(0, 90)}…</p>
              )}
            </section>
          ))
        )}
      </div>
    </aside>
  );
}
