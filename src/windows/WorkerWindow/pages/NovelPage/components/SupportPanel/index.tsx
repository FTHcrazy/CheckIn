import { AppstoreOutlined, BulbOutlined, SearchOutlined, UnorderedListOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";
import EntityPanel from "../EntityPanel";
import type { EntitySavePatch } from "../EntityDetail";
import InspirationPanel from "../InspirationPanel";
import OutlinePanel from "../OutlinePanel";
import SearchPanel from "../SearchPanel";
import type { PanelTab, EntityFilter } from "../../hooks/useNovelViewState";
import type {
  EntityAppearance,
  EntityRelationView,
  EntityType,
  LevelSystem,
  NovelEntity,
  NovelNote,
  OutlineNode,
  SearchHit,
} from "../../types";
import "./index.scss";

interface SupportPanelProps {
  open: boolean;
  activeTab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  outline: OutlineNode[];
  entities: NovelEntity[];
  filter: EntityFilter;
  onFilterChange: (filter: EntityFilter) => void;
  detailEntityId: string | null;
  onOpenEntity: (entityId: string) => void;
  onCloseEntity: () => void;
  getEntityRelations: (
    entityId: string,
    type: EntityType,
  ) => EntityRelationView[];
  levelSystems: LevelSystem[];
  notes: NovelNote[];
  onAddNote: (content: string) => void;
  onRemoveNote: (noteId: string) => void;
  onSearch: (keyword: string) => Promise<SearchHit[]>;
  onSelectChapter: (chapterId: string) => void;
  getAppearances: (entityId: string) => EntityAppearance[];
  highlighted: boolean;
  onToggleHighlight: () => void;
  onExportCard: () => void;
  onSaveEntity: (entityId: string, patch: EntitySavePatch) => void;
}

const TABS: Array<{ key: PanelTab; label: string; icon: ReactNode }> = [
  { key: "outline", label: "大纲", icon: <UnorderedListOutlined /> },
  { key: "entity", label: "要素库", icon: <AppstoreOutlined /> },
  { key: "note", label: "灵感", icon: <BulbOutlined /> },
  { key: "search", label: "检索", icon: <SearchOutlined /> },
];

/**
 * 右栏容器（设计方案 §05 ⑤：322px 四支撑面板）
 *
 * 折叠用 width/opacity 过渡实现，不用条件渲染——避免破坏面板内的滚动位置（AGENTS 6.4）。
 */
export default function SupportPanel({
  open,
  activeTab,
  onTabChange,
  outline,
  entities,
  filter,
  onFilterChange,
  detailEntityId,
  onOpenEntity,
  onCloseEntity,
  getEntityRelations,
  levelSystems,
  notes,
  onAddNote,
  onRemoveNote,
  onSearch,
  onSelectChapter,
  getAppearances,
  highlighted,
  onToggleHighlight,
  onExportCard,
  onSaveEntity,
}: SupportPanelProps) {
  return (
    <aside className={`nv-panel${open ? "" : " is-collapsed"}`}>
      <div className="nv-panel__tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={tab.key === activeTab}
            className={`nv-panel__tab${tab.key === activeTab ? " is-on" : ""}`}
            onClick={() => onTabChange(tab.key)}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="nv-panel__body">
        {activeTab === "outline" && (
          <OutlinePanel outline={outline} onSelectChapter={onSelectChapter} />
        )}
        {activeTab === "entity" && (
          <EntityPanel
            entities={entities}
            filter={filter}
            onFilterChange={onFilterChange}
            detailEntityId={detailEntityId}
            onOpenEntity={onOpenEntity}
            onCloseEntity={onCloseEntity}
            getEntityRelations={getEntityRelations}
            getAppearances={getAppearances}
            levelSystems={levelSystems}
            highlighted={highlighted}
            onToggleHighlight={onToggleHighlight}
            onExportCard={onExportCard}
            onSaveEntity={onSaveEntity}
            onSelectChapter={onSelectChapter}
          />
        )}
        {activeTab === "note" && (
          <InspirationPanel
            notes={notes}
            onAddNote={onAddNote}
            onRemoveNote={onRemoveNote}
          />
        )}
        {activeTab === "search" && (
          <SearchPanel onSearch={onSearch} onSelectChapter={onSelectChapter} />
        )}
      </div>
    </aside>
  );
}
