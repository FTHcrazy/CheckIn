import { AppstoreOutlined, BulbOutlined, SearchOutlined, ToolOutlined, UnorderedListOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";
import EntityPanel from "../EntityPanel";
import type { EntitySavePatch } from "../EntityDetail";
import InspirationPanel, { type InspirationActions } from "../InspirationPanel";
import NameGeneratorPanel, { type NamingActions } from "../NameGeneratorPanel";
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
  /** 全部作品灵感：灵感面板全局搜索的数据源 */
  globalNotes: NovelNote[];
  /** 当前作品 id：搜索结果中区分其他书籍的灵感（只读 + 来源标签） */
  activeWorkId: string;
  /** 作品 id → 书名（外部灵感的来源标签） */
  workNameOf: (workId: string) => string;
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
  /** 设定 / 取消当前境界（R25） */
  onSetEntityLevel: (entityId: string, rungId: string | null) => void;
  /** 打开等级体系管理弹框（R25） */
  onOpenLevelManager: () => void;
  /** 起名工具动作组（R18 / 步骤三）：插入正文 / 建角色卡 / 收藏 / 删除收藏 */
  namingActions: NamingActions;
  /** 起名工具避开本书已用名时取数用：当前作品的全部要素名 + 别名 */
  namingExclude: string[];
  /** 起名工具收藏夹（当前作品）：按 createdAt 倒序 */
  namingFavorites: import("../../types").NameFavorite[];
}

const TABS: Array<{ key: PanelTab; label: string; icon: ReactNode }> = [
  { key: "outline", label: "大纲", icon: <UnorderedListOutlined /> },
  { key: "entity", label: "要素库", icon: <AppstoreOutlined /> },
  { key: "note", label: "灵感", icon: <BulbOutlined /> },
  { key: "search", label: "检索", icon: <SearchOutlined /> },
  { key: "tools", label: "工具", icon: <ToolOutlined /> },
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
  globalNotes,
  activeWorkId,
  workNameOf,
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
  onSetEntityLevel,
  onOpenLevelManager,
  namingActions,
  namingExclude,
  namingFavorites,
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
            onSetEntityLevel={onSetEntityLevel}
            onOpenLevelManager={onOpenLevelManager}
          />
        )}
        {activeTab === "note" && (
          <InspirationPanel
            notes={notes}
            globalNotes={globalNotes}
            activeWorkId={activeWorkId}
            workNameOf={workNameOf}
            actions={inspirationActions}
          />
        )}
        {activeTab === "search" && (
          <SearchPanel onSearch={onSearch} onSelectChapter={onSelectChapter} />
        )}
        {activeTab === "tools" && (
          <NameGeneratorPanel
            exclude={namingExclude}
            favorites={namingFavorites}
            actions={namingActions}
          />
        )}
      </div>
    </aside>
  );
}
