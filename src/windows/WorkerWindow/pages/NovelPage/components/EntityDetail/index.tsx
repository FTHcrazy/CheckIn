import { ArrowLeftOutlined } from "@ant-design/icons";
import { ENTITY_TYPE_META } from "../../novel-config";
import TypeBadge from "../TypeBadge";
import type {
  EntityRelationView,
  LevelSystem,
  NovelEntity,
} from "../../types";
import "./index.scss";

interface EntityDetailProps {
  entity: NovelEntity;
  relations: EntityRelationView[];
  appearances: string[];
  levelSystems: LevelSystem[];
  highlighted: boolean;
  onToggleHighlight: () => void;
  onExportCard: () => void;
  onBack: () => void;
}

/** 要素详情：基础字段 / 自定义字段 / 关联要素 / 等级 / 出场章节（R23–R25、R21） */
export default function EntityDetail({
  entity,
  relations,
  appearances,
  levelSystems,
  highlighted,
  onToggleHighlight,
  onExportCard,
  onBack,
}: EntityDetailProps) {
  const meta = ENTITY_TYPE_META[entity.type];
  const levelRelation = relations.find(
    (relation) => relation.targetType === "level_system",
  );
  const level = levelSystems.find((system) => system.id === levelRelation?.targetId);
  const others = relations.filter(
    (relation) => relation.targetType !== "level_system",
  );

  const BASE_KEYS = ["别名", "一句话", "性格"];
  const customEntries = Object.entries(entity.fields).filter(
    ([key]) => !BASE_KEYS.includes(key),
  );

  return (
    <div className="nv-edetail">
      <div className="nv-edetail__head">
        <button type="button" className="nv-edetail__back" onClick={onBack}>
          <ArrowLeftOutlined /> 返回
        </button>
      </div>

      <div className="nv-edetail__title">
        <span
          className="nv-edetail__avatar"
          style={{ color: meta.color, background: meta.colorWeak }}
        >
          {Array.from(entity.name)[0] ?? "?"}
        </span>
        <span className="nv-edetail__name">{entity.name}</span>
        <TypeBadge type={entity.type} />
      </div>

      <section className="nv-edetail__section">
        <h6 className="nv-edetail__label">基础字段</h6>
        <div className="nv-edetail__kv">
          <span className="nv-edetail__k">别名</span>
          <span className="nv-edetail__v">
            {entity.aliases.length > 0 ? entity.aliases.join(" · ") : "—"}
          </span>
        </div>
        <div className="nv-edetail__kv">
          <span className="nv-edetail__k">一句话</span>
          <span className="nv-edetail__v">{entity.summary || "—"}</span>
        </div>
        {entity.fields["性格"] && (
          <div className="nv-edetail__tags">
            {entity.fields["性格"].split(/[·、,，]/).map((tag) => (
              <span key={tag} className="nv-edetail__tag">
                {tag.trim()}
              </span>
            ))}
          </div>
        )}
      </section>

      {customEntries.length > 0 && (
        <section className="nv-edetail__section">
          <h6 className="nv-edetail__label">自定义字段</h6>
          {customEntries.map(([key, value]) => (
            <div key={key} className="nv-edetail__kv">
              <span className="nv-edetail__k">{key}</span>
              <span className="nv-edetail__v">{value}</span>
            </div>
          ))}
        </section>
      )}

      {others.length > 0 && (
        <section className="nv-edetail__section">
          <h6 className="nv-edetail__label">关联要素</h6>
          {others.map((relation) => (
            <div key={relation.id} className="nv-edetail__rel">
              <span className="nv-edetail__arrow">
                {relation.direction === "out" ? "→" : "←"}
              </span>
              <span className="nv-edetail__rel-name">{relation.targetName}</span>
              <span className="nv-edetail__rel-tag">{relation.relation}</span>
            </div>
          ))}
        </section>
      )}

      {level && levelRelation && (
        <section className="nv-edetail__section">
          <h6 className="nv-edetail__label">
            当前境界 · {levelRelation.targetName}
          </h6>
          <div className="nv-edetail__ladder">
            {level.rungs.map((rung) => (
              <div
                key={rung.id}
                className={`nv-edetail__rung${
                  levelRelation.note?.includes(rung.name.split(" ")[0])
                    ? " is-on"
                    : ""
                }`}
              >
                <span className="nv-edetail__rung-no">{rung.rank}</span>
                <span>{rung.name}</span>
                {rung.note && (
                  <span className="nv-edetail__rung-note">{rung.note}</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {appearances.length > 0 && (
        <section className="nv-edetail__section">
          <h6 className="nv-edetail__label">
            出场章节 · 共 {appearances.length} 章
          </h6>
          <div className="nv-edetail__appear">
            {appearances.slice(0, 6).map((title) => (
              <span key={title} className="nv-edetail__chip">
                {title}
              </span>
            ))}
          </div>
        </section>
      )}

      <button type="button" className="nv-edetail__btn" onClick={onToggleHighlight}>
        {highlighted ? "已在正文中高亮" : "在正文中高亮此要素"}
      </button>
      <button
        type="button"
        className="nv-edetail__btn nv-edetail__btn--ghost"
        onClick={onExportCard}
      >
        导出为设定卡
      </button>
    </div>
  );
}
