import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import { ArrowLeftOutlined, EditOutlined } from "@ant-design/icons";
import { ENTITY_FILTER_ORDER, ENTITY_TYPE_META } from "../../novel-config";
import TypeBadge from "../TypeBadge";
import type {
  EntityAppearance,
  EntityRelationView,
  EntityType,
  LevelSystem,
  NovelEntity,
} from "../../types";
import "./index.scss";

/** 资料卡编辑保存：只开放四个基础字段，正文与自定义字段不在详情页编辑 */
export type EntitySavePatch = Partial<
  Pick<NovelEntity, "name" | "type" | "aliases" | "summary">
>;

interface EntityDetailProps {
  entity: NovelEntity;
  relations: EntityRelationView[];
  appearances: EntityAppearance[];
  levelSystems: LevelSystem[];
  highlighted: boolean;
  onToggleHighlight: () => void;
  onExportCard: () => void;
  onSaveEntity: (entityId: string, patch: EntitySavePatch) => void;
  onSelectChapter: (chapterId: string) => void;
  onBack: () => void;
}

/** 编辑草稿：null = 只读态 */
interface EntityDraft {
  name: string;
  type: EntityType;
  aliases: string;
  summary: string;
}

/** 别名输入分隔符：展示分隔符「·」不参与拆分（避免误拆含·的名字） */
const ALIAS_SPLIT = /[,，、;；\s]+/;

/** 要素详情：基础字段编辑 / 关联要素 / 等级 / 出场章节跳转（R23–R25、R21） */
export default function EntityDetail({
  entity,
  relations,
  appearances,
  levelSystems,
  highlighted,
  onToggleHighlight,
  onExportCard,
  onSaveEntity,
  onSelectChapter,
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

  const [draft, setDraft] = useState<EntityDraft | null>(null);
  const editing = draft !== null;

  // 切换查看对象时退出编辑态，避免把 A 卡的草稿写进 B 卡
  useEffect(() => {
    setDraft(null);
  }, [entity.id]);

  const startEdit = (): void =>
    setDraft({
      name: entity.name,
      type: entity.type,
      aliases: entity.aliases.join("、"),
      summary: entity.summary,
    });

  const cancelEdit = (): void => setDraft(null);

  const handleDraftKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      cancelEdit();
    }
  };

  const commitEdit = (): void => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) return; // 名称必填：空名称不提交
    const aliases = [
      ...new Set(
        draft.aliases
          .split(ALIAS_SPLIT)
          .map((alias) => alias.trim())
          .filter((alias) => alias && alias !== name),
      ),
    ];
    onSaveEntity(entity.id, {
      name,
      type: draft.type,
      aliases,
      summary: draft.summary.trim(),
    });
    setDraft(null);
  };

  return (
    <div className="nv-edetail">
      <div className="nv-edetail__head">
        <button type="button" className="nv-edetail__back" onClick={onBack}>
          <ArrowLeftOutlined /> 返回
        </button>
        <button
          type="button"
          className="nv-edetail__back nv-edetail__back--edit"
          onClick={editing ? cancelEdit : startEdit}
        >
          <EditOutlined /> {editing ? "取消编辑" : "编辑"}
        </button>
      </div>

      <div className="nv-edetail__title">
        <span
          className="nv-edetail__avatar"
          style={{ color: meta.color, background: meta.colorWeak }}
        >
          {Array.from(entity.name)[0] ?? "?"}
        </span>
        {editing ? (
          <input
            className="nv-edetail__name-input"
            value={draft.name}
            autoFocus
            maxLength={40}
            aria-label="要素名称"
            placeholder="名称（必填）"
            onChange={(event) =>
              setDraft((current) =>
                current ? { ...current, name: event.target.value } : current,
              )
            }
            onKeyDown={handleDraftKeyDown}
          />
        ) : (
          <span className="nv-edetail__name">{entity.name}</span>
        )}
        <TypeBadge type={entity.type} />
      </div>

      <section className="nv-edetail__section">
        <h6 className="nv-edetail__label">基础字段</h6>
        {editing ? (
          <>
            <div className="nv-edetail__form-row">
              <span className="nv-edetail__k">类型</span>
              <div className="nv-edetail__type-row">
                {ENTITY_FILTER_ORDER.map((type) => (
                  <button
                    key={type}
                    type="button"
                    className={`nv-edetail__type-chip${
                      draft.type === type ? " is-on" : ""
                    }`}
                    style={
                      draft.type === type
                        ? undefined
                        : { color: ENTITY_TYPE_META[type].color }
                    }
                    onClick={() =>
                      setDraft((current) =>
                        current ? { ...current, type } : current,
                      )
                    }
                  >
                    {ENTITY_TYPE_META[type].label}
                  </button>
                ))}
              </div>
            </div>
            <div className="nv-edetail__form-row">
              <span className="nv-edetail__k">别名</span>
              <input
                className="nv-edetail__input"
                value={draft.aliases}
                maxLength={200}
                placeholder="多个别名用顿号或逗号分隔"
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, aliases: event.target.value } : current,
                  )
                }
                onKeyDown={handleDraftKeyDown}
              />
            </div>
            <div className="nv-edetail__form-row">
              <span className="nv-edetail__k">一句话</span>
              <input
                className="nv-edetail__input"
                value={draft.summary}
                maxLength={120}
                placeholder="一句话简介"
                onChange={(event) =>
                  setDraft((current) =>
                    current ? { ...current, summary: event.target.value } : current,
                  )
                }
                onKeyDown={handleDraftKeyDown}
              />
            </div>
            <div className="nv-edetail__form-actions">
              <button
                type="button"
                className="nv-edetail__btn nv-edetail__btn--save"
                onClick={commitEdit}
                disabled={!draft.name.trim()}
                title={draft.name.trim() ? "保存修改" : "名称不能为空"}
              >
                保存
              </button>
              <button
                type="button"
                className="nv-edetail__btn nv-edetail__btn--ghost"
                onClick={cancelEdit}
              >
                取消
              </button>
            </div>
          </>
        ) : (
          <>
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
          </>
        )}
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
            {appearances.map((item) => (
              <button
                key={item.chapterId}
                type="button"
                className="nv-edetail__chip nv-edetail__chip--link"
                title={`跳转到 ${item.label ? `${item.label}·` : ""}${item.title}`}
                onClick={() => onSelectChapter(item.chapterId)}
              >
                {item.label && (
                  <span className="nv-edetail__chip-no">{item.label}</span>
                )}
                {item.title}
              </button>
            ))}
          </div>
        </section>
      )}

      {!editing && (
        <>
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
        </>
      )}
    </div>
  );
}
