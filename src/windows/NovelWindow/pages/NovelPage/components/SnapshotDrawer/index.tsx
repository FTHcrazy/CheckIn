import { Button } from "antd";
import { useEffect, useRef } from "react";
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
  const rootRef = useRef<HTMLElement>(null);

  /**
   * 点抽屉外部关闭 —— 与 SettingsDrawer 同一套战术（文档级 `mousedown` 分流，
   * 绝不 preventDefault，让同一次点击继续派发）。
   *
   * 此前快照抽屉只有 ✕ 与 Esc 两条关闭路径，点正文空白毫无反应，真机反馈成
   * 「这个抽屉关不掉」。触发它的是顶栏「⋯ → 历史快照」，菜单浮层渲染在 body 上
   * 不经过顶栏，所以「⋯」按钮与菜单项都要带 `data-drawer-keep-open="snapshot"`：
   * 否则 mousedown 先把抽屉关掉、同一次 click 又把它 toggle 回来（点了没反应）。
   */
  useEffect(() => {
    if (!open) return undefined;
    const handleMouseDown = (event: MouseEvent): void => {
      const node = rootRef.current;
      if (!node) return;
      const target = event.target;
      if (target instanceof Node && node.contains(target)) return;
      if (
        target instanceof Element &&
        target.closest('[data-drawer-keep-open="snapshot"]')
      ) {
        return;
      }
      onClose();
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open, onClose]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.isComposing) onClose();
    };
    if (!open) return undefined;
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open, onClose]);

  return (
    <aside ref={rootRef} className={`nv-snap${open ? " is-open" : ""}`}>
      <header className="nv-snap__head">
        <b>历史快照</b>
        <span className="nv-snap__sub">· 每章保留 20 版</span>
        <Button aria-label="关闭" onClick={onClose}>
          <CloseOutlined />
        </Button>
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
                  <Button
                    onClick={() => onRollback(snapshot.id, snapshot.createdAt)}
                  >
                    回滚
                  </Button>
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
