/**
 * 全局灵感抽屉（O-12）
 *
 * 编辑器「查看全部 →」的落点：antd Drawer 内嵌窗口级 IdeaLibraryContent，
 * 与书架共用同一份筛选 / 列表 / 动作词。焦点规则走 O-17 共享 hook，
 * 不另写一套 triggerRef / 回焦逻辑。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Drawer } from "antd";
import { useDrawerFocusReturn } from "@/shared/hooks/useDrawerFocusReturn";
import type { NovelNoteDTO } from "@/shared/types/electron";
import IdeaLibraryContent from "../../../../components/IdeaLibraryContent";
import {
  countIdeaNotes,
  filterIdeaNotes,
  type IdeaFilter,
} from "../../../../utils/idea-filter";
import "./index.scss";

interface GlobalInspirationDrawerProps {
  open: boolean;
  onClose: () => void;
  /** 全局灵感（所有作品 + 未归属） */
  notes: NovelNoteDTO[];
  workOptions: Array<{ id: string; name: string }>;
  workNameOf: (workId: string) => string | null;
  onAdd: (content: string, workId: string) => boolean;
  onMove: (noteId: string, workId: string) => void;
  onTogglePin: (noteId: string, pinned: boolean) => void;
  onUpdate: (noteId: string, content: string) => void;
  onRemove: (noteId: string) => void;
}

export default function GlobalInspirationDrawer({
  open,
  onClose,
  notes,
  workOptions,
  workNameOf,
  onAdd,
  onMove,
  onTogglePin,
  onUpdate,
  onRemove,
}: GlobalInspirationDrawerProps) {
  const [filter, setFilter] = useState<IdeaFilter>("all");
  const containerRef = useRef<HTMLDivElement>(null);
  const { captureTrigger, restoreFocus } = useDrawerFocusReturn({
    active: open,
    containerRef,
  });

  const handleClose = (): void => {
    restoreFocus();
    onClose();
  };

  // 每次打开都重新记住触发按钮（「查看全部 →」）；关闭三条路径都走
  // handleClose 回焦。放 effect 而非 render，遵守 react-hooks/refs。
  useEffect(() => {
    if (open) captureTrigger();
  }, [open, captureTrigger]);

  const counts = useMemo(() => countIdeaNotes(notes), [notes]);
  const visible = useMemo(() => filterIdeaNotes(notes, filter, ""), [notes, filter]);

  return (
    <Drawer
      className="nv-idea-drawer"
      title="全部灵感"
      open={open}
      onClose={handleClose}
      destroyOnHidden
      size={420}
    >
      <div ref={containerRef} className="nv-idea-drawer__body bs-rail">
        <IdeaLibraryContent
          notes={visible}
          counts={counts}
          filter={filter}
          onFilterChange={setFilter}
          workOptions={workOptions}
          workNameOf={workNameOf}
          onAdd={onAdd}
          onMove={onMove}
          onTogglePin={onTogglePin}
          onUpdate={onUpdate}
          onRemove={onRemove}
          showCapture={false}
        />
      </div>
    </Drawer>
  );
}
