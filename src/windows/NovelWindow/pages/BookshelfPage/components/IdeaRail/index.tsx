/**
 * 全局灵感库右栏（书架侧薄壳，O-12）
 *
 * O-12 把筛选 / 列表 / 动作条抽到窗口级 IdeaLibraryContent，书架与编辑器
 * 全局抽屉共用一份。这里只保留书架特有的外壳（标题 / 计数 / 定位）与
 * 数据回调接线，不再自己渲染卡片与虚拟列表。
 */
import IdeaLibraryContent, {
  type IdeaFilter,
} from "../../../../components/IdeaLibraryContent";
import type { NovelNoteDTO } from "@/shared/types/electron";

interface IdeaRailProps {
  counts: Record<IdeaFilter, number>;
  filter: IdeaFilter;
  onFilterChange: (filter: IdeaFilter) => void;
  /** 已按筛选 + 关键词排好序的灵感列表（页面派生） */
  visibleNotes: NovelNoteDTO[];
  workOptions: Array<{ id: string; name: string }>;
  workNameOf: (workId: string) => string | null;
  onAdd: (content: string, workId: string) => boolean;
  onTogglePin: (noteId: string, pinned: boolean) => void;
  onMove: (noteId: string, workId: string) => void;
  onUpdateContent: (noteId: string, content: string) => void;
  onRemove: (noteId: string) => void;
}

export default function IdeaRail({
  counts,
  filter,
  onFilterChange,
  visibleNotes,
  workOptions,
  workNameOf,
  onAdd,
  onTogglePin,
  onMove,
  onUpdateContent,
  onRemove,
}: IdeaRailProps) {
  return (
    <aside className="bs-rail" aria-label="全局灵感库">
      <div className="bs-rail__head">
        <span className="bs-rail__title">灵感库</span>
        <span className="bs-rail__total">全部 {counts.all}</span>
      </div>
      <p className="bs-rail__subtitle">
        跨作品收集，随时归属到作品或回编辑器转为伏笔
      </p>
      <IdeaLibraryContent
        notes={visibleNotes}
        counts={counts}
        filter={filter}
        onFilterChange={onFilterChange}
        workOptions={workOptions}
        workNameOf={workNameOf}
        onAdd={onAdd}
        onMove={onMove}
        onTogglePin={onTogglePin}
        onUpdate={onUpdateContent}
        onRemove={onRemove}
      />
    </aside>
  );
}
