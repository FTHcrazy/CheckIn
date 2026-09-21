import EntityCard from "../EntityCard";
import EntityDetail from "../EntityDetail";
import type { EntitySavePatch } from "../EntityDetail";
import { useEntityTypeMeta } from "../../hooks/entity-types-context";
import type { EntityFilter } from "../../hooks/useNovelViewState";
import type {
  EntityAppearance,
  EntityRelationView,
  EntityType,
  LevelSystem,
  NovelEntity,
} from "../../types";
import "./index.scss";

interface EntityPanelProps {
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
  getAppearances: (entityId: string) => EntityAppearance[];
  levelSystems: LevelSystem[];
  highlighted: boolean;
  onToggleHighlight: () => void;
  onExportCard: () => void;
  onSaveEntity: (entityId: string, patch: EntitySavePatch) => void;
  onSelectChapter: (chapterId: string) => void;
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
}

/**
 * 要素库面板（R7 / R23）
 *
 * 类型 chips 筛选 → 要素卡列表 → 详情。筛选是本面板的局部交互，状态由页面持有后回传。
 */
export default function EntityPanel({
  entities,
  filter,
  onFilterChange,
  detailEntityId,
  onOpenEntity,
  onCloseEntity,
  getEntityRelations,
  getAppearances,
  levelSystems,
  highlighted,
  onToggleHighlight,
  onExportCard,
  onSaveEntity,
  onSelectChapter,
  onAddRelation,
  onRemoveRelation,
  onSetEntityLevel,
  onOpenLevelManager,
}: EntityPanelProps) {
  const { metaOf, filterOrder } = useEntityTypeMeta();

  const filtered =
    filter === "all"
      ? entities
      : entities.filter((entity) => entity.type === filter);

  const detail = entities.find((entity) => entity.id === detailEntityId) ?? null;

  if (detail) {
    return (
      <EntityDetail
        entity={detail}
        entities={entities}
        relations={getEntityRelations(detail.id, detail.type)}
        appearances={getAppearances(detail.id)}
        levelSystems={levelSystems}
        highlighted={highlighted}
        onToggleHighlight={onToggleHighlight}
        onExportCard={onExportCard}
        onSaveEntity={onSaveEntity}
        onSelectChapter={onSelectChapter}
        onAddRelation={onAddRelation}
        onRemoveRelation={onRemoveRelation}
        onSetEntityLevel={(rungId) => onSetEntityLevel(detail.id, rungId)}
        onOpenLevelManager={onOpenLevelManager}
        onBack={onCloseEntity}
      />
    );
  }

  return (
    <div className="nv-entity">
      <div className="nv-entity__filters">
        <button
          type="button"
          className={`nv-entity__chip${filter === "all" ? " is-on" : ""}`}
          onClick={() => onFilterChange("all")}
        >
          全部
        </button>
        {filterOrder.map((type) => {
          const meta = metaOf(type);
          return (
            <button
              key={type}
              type="button"
              className={`nv-entity__chip${filter === type ? " is-on" : ""}`}
              onClick={() => onFilterChange(type)}
              style={filter === type ? undefined : { color: meta.color }}
            >
              {meta.label}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="nv-entity__empty">这个类型下还没有要素</p>
      ) : (
        <ul className="nv-entity__list">
          {filtered.map((entity) => (
            <li key={entity.id}>
              <EntityCard entity={entity} onOpen={onOpenEntity} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
