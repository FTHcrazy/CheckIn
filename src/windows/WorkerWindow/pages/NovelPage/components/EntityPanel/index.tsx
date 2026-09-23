import { useMemo, useState } from "react";
import { CloseOutlined, SearchOutlined } from "@ant-design/icons";
import EntityCard from "../EntityCard";
import EntityDetail from "../EntityDetail";
import type { EntitySavePatch } from "../EntityDetail";
import { useEntityTypeMeta } from "../../hooks/entity-types-context";
import { useEdgeFade } from "../SupportPanel/useEdgeFade";
import { useAppearanceStore } from "../../store/useAppearanceStore";
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
  /** 把要素名插入正文光标处 */
  onInsertName: (name: string) => void;
}

/** 名称 / 别名 / 一句话三处命中即算匹配 */
function matchKeyword(entity: NovelEntity, keyword: string): boolean {
  if (!keyword) return true;
  const haystack =
    `${entity.name} ${entity.aliases.join(" ")} ${entity.summary}`.toLowerCase();
  return haystack.includes(keyword);
}

/**
 * 要素库面板（R7 / R23）
 *
 * 顶部搜索 + 带计数的类型 chips → 要素卡列表 → 详情。
 * 搜索与筛选都是本面板的短生命周期状态，不回流到页面；
 * 「全部」视图按类型分组，避免几十张卡混成一片。
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
  onInsertName,
}: EntityPanelProps) {
  const { metaOf, filterOrder } = useEntityTypeMeta();
  const [keyword, setKeyword] = useState("");
  // 出场章数索引由 store 增量维护：本面板订阅它，角标更新时才重渲染，
  // 页面根不再为了这个数字被保存动作推一遍
  const appearanceCounts = useAppearanceStore((state) => state.counts);
  // 类型 chips 行横向溢出时两端渐隐提示（滚动条为隐藏设计）
  const chipsFade = useEdgeFade<HTMLDivElement>();

  // 类型计数：只在要素集合变化时重算，与筛选 / 搜索无关
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entity of entities) {
      map.set(entity.type, (map.get(entity.type) ?? 0) + 1);
    }
    return map;
  }, [entities]);

  const trimmed = keyword.trim().toLowerCase();

  const visible = useMemo(
    () =>
      entities.filter(
        (entity) =>
          (filter === "all" || entity.type === filter) &&
          matchKeyword(entity, trimmed),
      ),
    [entities, filter, trimmed],
  );

  // 卡片的关联数与当前境界：列表级一次性算好，避免逐卡重复扫关联表
  const statsOf = useMemo(() => {
    const map = new Map<string, { relations: number; levelName: string }>();
    for (const entity of entities) {
      const relations = getEntityRelations(entity.id, entity.type);
      const binding = relations.find((item) => item.targetType === "level");
      let levelName = "";
      if (binding) {
        for (const system of levelSystems) {
          const rung = system.rungs.find((item) => item.id === binding.targetId);
          if (rung) {
            levelName = rung.name;
            break;
          }
        }
      }
      map.set(entity.id, { relations: relations.length, levelName });
    }
    return map;
  }, [entities, getEntityRelations, levelSystems]);

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

  const renderCard = (entity: NovelEntity) => {
    const stats = statsOf.get(entity.id);
    return (
      <li key={entity.id}>
        <EntityCard
          entity={entity}
          relationCount={stats?.relations ?? 0}
          appearanceCount={appearanceCounts.get(entity.id) ?? 0}
          levelName={stats?.levelName ?? ""}
          onOpen={onOpenEntity}
          onInsertName={onInsertName}
        />
      </li>
    );
  };

  return (
    <div className="nv-entity">
      <div className="nv-field nv-entity__search">
        <SearchOutlined />
        <input
          value={keyword}
          placeholder="搜名称 / 别名 / 简介"
          aria-label="搜索要素"
          onChange={(event) => setKeyword(event.target.value)}
        />
        {keyword && (
          <button
            type="button"
            className="nv-field__clear"
            aria-label="清空搜索"
            onClick={() => setKeyword("")}
          >
            <CloseOutlined />
          </button>
        )}
      </div>

      <div
        ref={chipsFade.ref}
        className={`nv-chips nv-entity__chips${chipsFade.fadeLeft ? " is-fade-left" : ""}${
          chipsFade.fadeRight ? " is-fade-right" : ""
        }`}
      >
        <button
          type="button"
          className={`nv-chip${filter === "all" ? " is-on" : ""}`}
          style={filter === "all" ? { color: "var(--app-primary)" } : undefined}
          onClick={() => onFilterChange("all")}
        >
          全部<em>{entities.length}</em>
        </button>
        {filterOrder.map((type) => {
          const count = counts.get(type) ?? 0;
          if (count === 0) return null;
          const meta = metaOf(type);
          const on = filter === type;
          return (
            <button
              key={type}
              type="button"
              className={`nv-chip${on ? " is-on" : ""}`}
              style={on ? { color: meta.color } : undefined}
              onClick={() => onFilterChange(type)}
            >
              {meta.label}
              <em>{count}</em>
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div className="nv-empty">
          <b>没有匹配的要素</b>
          <span>换个关键词，或切回「全部」</span>
        </div>
      ) : filter === "all" ? (
        <>
          {filterOrder.map((type) => {
            const group = visible.filter((entity) => entity.type === type);
            if (group.length === 0) return null;
            return (
              <div key={type}>
                <div className="nv-sechead">
                  {metaOf(type).label}
                  <em>{group.length}</em>
                </div>
                <ul className="nv-entity__list">{group.map(renderCard)}</ul>
              </div>
            );
          })}
        </>
      ) : (
        <>
          <div className="nv-sechead">
            {metaOf(filter).label}
            <em>{visible.length}</em>
          </div>
          <ul className="nv-entity__list">{visible.map(renderCard)}</ul>
        </>
      )}
    </div>
  );
}
