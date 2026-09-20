import { AppstoreOutlined, BulbOutlined, SearchOutlined, UnorderedListOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";
import EntityPanel from "../EntityPanel";
import type { EntitySavePatch } from "../EntityDetail";
import InspirationPanel, { type InspirationActions } from "../InspirationPanel";
import OutlinePanel, { type OutlineActions } from "../OutlinePanel";
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
  /** 当前编辑章：大纲面板同步高亮 */
  activeChapterId: string | null;
  outlineActions: OutlineActions;
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
  inspirationActions: InspirationActions;
  onSearch: (keyword: string) => Promise<SearchHit[]>;
  onSelectChapter: (chapterId: string) => void;
  getAppearances: (entityId: string) => EntityAppearance[];
  highlighted: boolean;
  onToggleHighlight: () => void;
  onExportCard: () => void;
  onSaveEntity: (entityId: string, patch: EntitySavePatch) => void;
  onAddRelation: (
    entityId: string,
    entityType: EntityType,
    targetId: string,
    relation: string,
  ) => void;
  onRemoveRelation: (linkId: string, targetName: string) => void;
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
  activeChapterId,
  outlineActions,
  entities,
  filter,
  onFilterChange,
  detailEntityId,
  onOpenEntity,
  onCloseEntity,
  getEntityRelations,
  levelSystems,
  notes,
  inspirationActions,
  onSearch,
  onSelectChapter,
  getAppearances,
  highlighted,
  onToggleHighlight,
  onExportCard,
  onSaveEntity,
  onAddRelation,
  onRemoveRelation,
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
          <OutlinePanel
            outline={outline}
            activeChapterId={activeChapterId}
            onSelectChapter={onSelectChapter}
            actions={outlineActions}
          />
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
            onAddRelation={onAddRelation}
            onRemoveRelation={onRemoveRelation}
          />
        )}
        {activeTab === "note" && (
          <InspirationPanel notes={notes} actions={inspirationActions} />
        )}
        {activeTab === "search" && (
          <SearchPanel onSearch={onSearch} onSelectChapter={onSelectChapter} />
        )}
      </div>
    </aside>
  );
}
