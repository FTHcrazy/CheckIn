import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  ArrowLeftOutlined,
  CrownFilled,
  CrownOutlined,
  EditOutlined,
  PlusOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { Button, Input, Select } from "antd";
import { useEntityTypeMeta } from "../../hooks/entity-types-context";
import type {
  EntityAppearance,
  EntityRelationView,
  EntitySavePatch,
  EntityType,
  LevelSystem,
  NovelEntity,
} from "../../types";
import "./index.scss";

export type { EntitySavePatch };

interface EntityDetailProps {
  entity: NovelEntity;
  /** 全量要素：添加关联时的目标候选 */
  entities: NovelEntity[];
  relations: EntityRelationView[];
  appearances: EntityAppearance[];
  levelSystems: LevelSystem[];
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
  /** 设定 / 替换 / 取消当前境界（R25）：rungId 传 null 即取消 */
  onSetEntityLevel: (rungId: string | null) => void;
  /** 打开等级体系管理弹框（R25） */
  onOpenLevelManager: () => void;
  /** 是否为行囊主角 */
  isProtagonist: boolean;
  /** 设为主角 / 取消主角 */
  onSetProtagonist: () => void;
  onSelectChapter: (chapterId: string) => void;
  onBack: () => void;
}

/** 编辑草稿：null = 只读态 */
interface EntityDraft {
  name: string;
  type: EntityType;
  aliases: string;
  summary: string;
  personality: string;
}

/** 别名 / 性格输入分隔符：展示分隔符「·」不参与拆分（避免误拆含·的名字） */
const ALIAS_SPLIT = /[,，、;；\s]+/;

/** 要素详情：基础字段编辑 / 关联要素增删 / 当前境界（R25）/ 出场章节跳转 */
export default function EntityDetail({
  entity,
  entities,
  relations,
  appearances,
  levelSystems,
  highlighted,
  onToggleHighlight,
  onExportCard,
  onSaveEntity,
  onAddRelation,
  onRemoveRelation,
  onSetEntityLevel,
  onOpenLevelManager,
  isProtagonist,
  onSetProtagonist,
  onSelectChapter,
  onBack,
}: EntityDetailProps) {
  const { metaOf, filterOrder } = useEntityTypeMeta();
  const meta = metaOf(entity.type);

  // 当前境界绑定（R25）：toType='level' 的关联，精确指向 novel_levels.id；
  // 旧版「关联到体系卡 + note 文本猜测」的含混实现已废弃
  const levelBinding = relations.find(
    (relation) => relation.targetType === "level",
  );
  const others = relations.filter(
    (relation) => relation.targetType !== "level",
  );

  /** 绑定等级项 → 所属体系（用于默认选中下拉与绑定名回显） */
  const rungSystemOf = useMemo(() => {
    const index = new Map<string, LevelSystem>();
    for (const system of levelSystems) {
      for (const rung of system.rungs) index.set(rung.id, system);
    }
    return index;
  }, [levelSystems]);

  /** 当前展示的体系：默认绑定所在体系，否则第一个；切换查看对象时重置 */
  const [activeSystemId, setActiveSystemId] = useState("");
  const activeSystemIdResolved = useMemo(() => {
    if (activeSystemId && levelSystems.some((s) => s.id === activeSystemId)) {
      return activeSystemId;
    }
    const boundSystem = levelBinding
      ? rungSystemOf.get(levelBinding.targetId)
      : undefined;
    return boundSystem?.id ?? levelSystems[0]?.id ?? "";
  }, [activeSystemId, levelSystems, levelBinding, rungSystemOf]);
  const activeSystem = levelSystems.find(
    (system) => system.id === activeSystemIdResolved,
  );
  const boundRungId = levelBinding?.targetId ?? null;

  /** 等级体系下拉选项（组件库 Select，AGENTS 6.1.2） */
  const levelSystemOptions = useMemo(
    () => levelSystems.map((system) => ({ value: system.id, label: system.name })),
    [levelSystems],
  );

  const BASE_KEYS = ["别名", "一句话", "性格"];
  const customEntries = Object.entries(entity.fields).filter(
    ([key]) => !BASE_KEYS.includes(key),
  );

  const [draft, setDraft] = useState<EntityDraft | null>(null);
  const editing = draft !== null;

  // 添加关联的内联表单状态（独立于资料卡编辑态，随时可增删关联）
  const [relAdding, setRelAdding] = useState(false);
  const [relTargetId, setRelTargetId] = useState("");
  const [relName, setRelName] = useState("");

  /** 关联目标下拉选项：排除自身，标签带类型前缀便于区分同名要素 */
  const relationTargetOptions = useMemo(
    () =>
      entities
        .filter((item) => item.id !== entity.id)
        .map((item) => ({
          value: item.id,
          label: `${metaOf(item.type).label} · ${item.name}`,
        })),
    [entities, entity.id, metaOf],
  );

  // 切换查看对象时退出编辑态，避免把 A 卡的草稿写进 B 卡；体系选择一并重置
  useEffect(() => {
    setDraft(null);
    setRelAdding(false);
    setActiveSystemId("");
  }, [entity.id]);

  const startEdit = (): void =>
    setDraft({
      name: entity.name,
      type: entity.type,
      aliases: entity.aliases.join("、"),
      summary: entity.summary,
      personality: entity.fields["性格"] ?? "",
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
    // 性格写入 fields["性格"]（展示分隔符「·」）；清空即移除该键
    const fields = { ...entity.fields };
    const tags = draft.personality
      .split(ALIAS_SPLIT)
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (tags.length > 0) fields["性格"] = tags.join("·");
    else delete fields["性格"];
    onSaveEntity(entity.id, {
      name,
      type: draft.type,
      aliases,
      summary: draft.summary.trim(),
      fields,
    });
    setDraft(null);
  };

  const submitRelation = (): void => {
    if (!relTargetId) return;
    onAddRelation(entity.id, entity.type, relTargetId, relName);
    setRelTargetId("");
    setRelName("");
    setRelAdding(false);
  };

  const handleRelKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      submitRelation();
    } else if (event.key === "Escape") {
      event.stopPropagation();
      setRelAdding(false);
    }
  };

  return (
    <div className="nv-edetail">
      <div className="nv-edetail__top">
        <Button
          className="nv-edetail__icon"
          title="返回要素库"
          onClick={onBack}
        >
          <ArrowLeftOutlined />
        </Button>
        {!editing && (
          <Button className="nv-edetail__edit" onClick={startEdit}>
            <EditOutlined />编辑
          </Button>
        )}
      </div>

      <div className="nv-edetail__hero">
        <span
          className="nv-edetail__avatar"
          style={{ color: meta.color, background: meta.colorWeak }}
        >
          {Array.from(entity.name)[0] ?? "?"}
        </span>
        <div className="nv-edetail__ident">
          {editing ? (
            <Input
              variant="borderless"
              className="nv-edetail__input nv-edetail__name-input"
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
            <div className="nv-edetail__name">{entity.name}</div>
          )}
          <div className="nv-edetail__alias">
            {entity.aliases.length > 0
              ? `别名：${entity.aliases.join(" · ")}`
              : "暂无别名"}
          </div>
        </div>
      </div>

      <div className="nv-sechead">基础字段</div>
      {editing ? (
        <>
          <div className="nv-edetail__form-row">
            <span className="nv-edetail__k">类型</span>
            <div className="nv-edetail__type-row">
              {filterOrder.map((type) => {
                const typeMeta = metaOf(type);
                return (
                  <Button
                    key={type}
                    className={`nv-edetail__type-chip${
                      draft.type === type ? " is-on" : ""
                    }`}
                    style={
                      draft.type === type ? undefined : { color: typeMeta.color }
                    }
                    onClick={() =>
                      setDraft((current) =>
                        current ? { ...current, type } : current,
                      )
                    }
                  >
                    {typeMeta.label}
                  </Button>
                );
              })}
            </div>
          </div>
          <div className="nv-edetail__form-row">
            <span className="nv-edetail__k">别名</span>
            <Input
              variant="borderless"
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
            <Input
              variant="borderless"
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
          <div className="nv-edetail__form-row">
            <span className="nv-edetail__k">性格</span>
            <Input
              variant="borderless"
              className="nv-edetail__input"
              value={draft.personality}
              maxLength={60}
              placeholder="多个标签用顿号或逗号分隔"
              onChange={(event) =>
                setDraft((current) =>
                  current
                    ? { ...current, personality: event.target.value }
                    : current,
                )
              }
              onKeyDown={handleDraftKeyDown}
            />
          </div>
          <div className="nv-edetail__form-actions">
            <Button
              className="nv-edetail__save"
              onClick={commitEdit}
              disabled={!draft.name.trim()}
              title={draft.name.trim() ? "保存修改" : "名称不能为空"}
            >
              保存
            </Button>
            <Button
              className="nv-edetail__cancel"
              onClick={cancelEdit}
            >
              取消
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="nv-kv">
            <span className="nv-kv__k">一句话</span>
            <span className="nv-kv__v">{entity.summary || "—"}</span>
          </div>
          {customEntries.map(([key, value]) => (
            <div key={key} className="nv-kv">
              <span className="nv-kv__k">{key}</span>
              <span className="nv-kv__v">{value}</span>
            </div>
          ))}
        </>
      )}
      {entity.fields["性格"] && (
        <div className="nv-edetail__tags">
          {entity.fields["性格"]
            .split(/[·、,，]/)
            .map((tag) => tag.trim())
            .filter(Boolean)
            .map((tag, index) => (
              <span key={`${tag}-${index}`} className="nv-edetail__tag">
                {tag}
              </span>
            ))}
        </div>
      )}

      <div className="nv-sechead">
        关联要素<em>{others.length}</em>
      </div>
      {others.length === 0 && !relAdding && (
        <div className="nv-kv">
          <span className="nv-kv__v">还没有关联，试着添加一条</span>
        </div>
      )}
      {others.map((relation) => (
        <div key={relation.id} className="nv-edetail__rel">
          <span className="nv-edetail__arrow">
            {relation.direction === "out" ? "→" : "←"}
          </span>
          <span className="nv-edetail__rel-name">{relation.targetName}</span>
          <span className="nv-edetail__rel-tag">{relation.relation}</span>
          <Button
            className="nv-mini nv-mini--warn"
            title={`解除与「${relation.targetName}」的关联`}
            aria-label={`解除与「${relation.targetName}」的关联`}
            onClick={() => onRemoveRelation(relation.id, relation.targetName)}
          >
            ×
          </Button>
        </div>
      ))}
      {relAdding ? (
        <div className="nv-edetail__rel-form">
          <Select
            className="nv-edetail__select"
            size="small"
            classNames={{ popup: { root: "nv-edetail__dropdown" } }}
            aria-label="选择关联要素"
            placeholder="选择要素…"
            value={relTargetId || undefined}
            options={relationTargetOptions}
            onChange={setRelTargetId}
          />
          <Input
            variant="borderless"
            className="nv-edetail__input"
            value={relName}
            maxLength={12}
            placeholder="关系：师兄弟 / 持有…"
            aria-label="关系名称"
            onChange={(event) => setRelName(event.target.value)}
            onKeyDown={handleRelKeyDown}
          />
          <div className="nv-edetail__form-actions">
            <Button
              className="nv-edetail__save"
              onClick={submitRelation}
              disabled={!relTargetId}
              title={relTargetId ? "添加关联" : "先选择目标要素"}
            >
              添加
            </Button>
            <Button
              className="nv-edetail__cancel"
              onClick={() => setRelAdding(false)}
            >
              取消
            </Button>
          </div>
        </div>
      ) : (
        <Button
          className="nv-edetail__rel-add"
          onClick={() => setRelAdding(true)}
          disabled={entities.length <= 1}
          title={
            entities.length <= 1 ? "设定库里还没有其他要素" : "关联到其他资料卡"
          }
        >
          <PlusOutlined />添加关联
        </Button>
      )}

      {/* 主角设定：只对角色卡出现。行囊只承载主角一人，所以「主角」这一格
          是行囊 ↔ 实体面板唯一的挂钩——设了它，两边境界才是同一行数据 */}
      {entity.type === "character" && (
        <>
          <div className="nv-sechead">主角</div>
          <Button
            className={`nv-edetail__protagonist${isProtagonist ? " is-on" : ""}`}
            aria-pressed={isProtagonist}
            onClick={onSetProtagonist}
          >
            <span className="nv-edetail__protagonist-icon">
              {isProtagonist ? <CrownFilled /> : <CrownOutlined />}
            </span>
            <span className="nv-edetail__protagonist-text">
              <b>{isProtagonist ? "已设为主角" : "设为主角"}</b>
              <em>
                {isProtagonist
                  ? "行囊的境界与这里同源，改任一处两边都跟着变"
                  : "行囊只记主角的随身物品；设为主角后，行囊的境界与这张卡同步"}
              </em>
            </span>
          </Button>
        </>
      )}

      {/* 当前境界（R25）。
          角色卡**永远**显示这一格：原来整个区块挂在 `levelSystems.length > 0`
          上，新开的书还没有等级体系时它整块消失 —— 连「管理」按钮也跟着没了，
          作者在资料卡里找不到任何地方去设境界关联。
          没体系时给空态 + 建体系入口，而不是什么都不画。 */}
      {(entity.type === "character" ||
        (levelSystems.length > 0 && Boolean(activeSystem))) && (
        <>
          <div className="nv-sechead">
            当前境界
            {isProtagonist && (
              <span className="nv-edetail__same" title="与行囊面板读的是同一行 novel_links">
                <CrownFilled /> 行囊同源
              </span>
            )}
            {/* 空态里已经有「＋新建等级体系」这个更明确的入口，
                再挂一个同样打开管理弹框的「管理」就是两个按钮一件事 */}
            {activeSystem && (
              <Button
                className="nv-edetail__manage"
                onClick={onOpenLevelManager}
                title="管理体系与等级项"
              >
                <SettingOutlined />管理
              </Button>
            )}
          </div>
          {!activeSystem ? (
            <div className="nv-edetail__lvlempty">
              <b>还没有等级体系</b>
              <em>
                境界挂在「等级体系」的阶梯上（炼气 / 筑基…）。先建一套阶梯，
                建好后就能在这张卡上点选当前境界。
              </em>
              <Button
                className="nv-edetail__lvlempty-add"
                onClick={onOpenLevelManager}
              >
                <PlusOutlined />新建等级体系
              </Button>
            </div>
          ) : (
            <>
              <Select
                className="nv-edetail__select"
                size="small"
                classNames={{ popup: { root: "nv-edetail__dropdown" } }}
                aria-label="选择等级体系"
                placeholder="选择等级体系"
                value={activeSystemIdResolved || undefined}
                options={levelSystemOptions}
                onChange={setActiveSystemId}
              />
              <div className="nv-edetail__ladder">
                {activeSystem.rungs.map((rung) => {
                  const bound = rung.id === boundRungId;
                  return (
                    <Button
                      key={rung.id}
                      className={`nv-edetail__rung${bound ? " is-on" : ""}`}
                      title={bound ? "点击取消当前境界绑定" : "点击设为当前境界"}
                      onClick={() => onSetEntityLevel(bound ? null : rung.id)}
                    >
                      <span className="nv-edetail__rung-no">{rung.rank}</span>
                      <span>{rung.name}</span>
                      {rung.note && (
                        <span className="nv-edetail__rung-note">{rung.note}</span>
                      )}
                      {bound && <span className="nv-edetail__rung-cur">当前</span>}
                    </Button>
                  );
                })}
                {activeSystem.rungs.length === 0 && (
                  <div className="nv-kv">
                    <span className="nv-kv__v">该体系还没有等级项，点「管理」添加</span>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {appearances.length > 0 && (
        <>
          <div className="nv-sechead">
            出场章节<em>{appearances.length}</em>
          </div>
          <div className="nv-edetail__appear">
            {appearances.map((item) => (
              <Button
                key={item.chapterId}
                className="nv-edetail__chip"
                title={`跳转到 ${item.label ? `${item.label}·` : ""}${item.title}`}
                onClick={() => onSelectChapter(item.chapterId)}
              >
                {item.label && (
                  <span className="nv-edetail__chip-no">{item.label}</span>
                )}
                {item.title}
              </Button>
            ))}
          </div>
        </>
      )}

      {!editing && (
        <div className="nv-edetail__acts">
          <Button
            className={`nv-ghost${highlighted ? " is-on" : ""}`}
            onClick={onToggleHighlight}
          >
            {highlighted ? "已在正文中高亮" : "在正文中高亮此要素"}
          </Button>
          <Button className="nv-ghost" onClick={onExportCard}>
            导出为设定卡
          </Button>
        </div>
      )}
    </div>
  );
}
