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
import { Virtuoso } from "react-virtuoso";
import { useEntityTypeMeta } from "../../hooks/entity-types-context";
import type {
  EntityAppearance,
  EntityRelationView,
  EntitySavePatch,
  EntityType,
  NovelEntity,
  SettingCategory,
  SettingLevel,
} from "../../types";
import {
  findRealmPosition,
  listSubLevels,
  parseRealmNoteSub,
  rootLevels,
  sortLevels,
} from "../../utils/setting-utils";
import "./index.scss";

export type { EntitySavePatch };

interface EntityDetailProps {
  entity: NovelEntity;
  /** 全量要素：添加关联时的目标候选 */
  entities: NovelEntity[];
  relations: EntityRelationView[];
  appearances: EntityAppearance[];
  /** 小说设定：境界阶梯取其中 kind='realm' 的那一个分类 */
  settings: SettingCategory[];
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
  /**
   * 设定 / 替换 / 取消当前境界：levelId 传 null 即取消。
   * 父阶是「组」（1.38.1）：绑定统一落在根阶 + sub（阶内第几层）上，
   * 与行囊共用同一坐标（novel_links.note 的 {sub}）。
   */
  onSetEntityLevel: (levelId: string | null, sub?: number) => void;
  /** 打开设定中心并定位到境界体系分类 */
  onOpenSettings: () => void;
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

/**
 * 出场章节虚拟列表的行高与高度上限（px）。
 *
 * 必须与 `index.scss` 里 `.nv-edetail__appear-list` 的行盒保持一致：
 * Virtuoso 需要一个确切的行高来算滚动区间，给错会有跳白条。
 *
 * 38 = chip 内容行高（12px 字号 ≈ 18）+ 上下 padding 5×2 + 描边 1×2 + 行间距 8，
 * 与 `&__appear-list > div > div { padding-bottom: 8px }`（REQ-046 行间距 4→8）
 * 一一对应 —— 这两处是本项的唯一契约，改一边必须同步改另一边。
 *
 * 导出供契约测试断言（`EntityDetail/index.test.tsx`）。
 */
export const APPEAR_ROW_HEIGHT = 38;
/** 列表封顶高度：超过就内部滚动，避免上千章把下方操作区推得很远 */
const APPEAR_MAX_HEIGHT = 240;

/**
 * 「关联境界」小境界 chip 的默认展示条数。
 *
 * 一阶配几十个小层时，整片 chip 会把当前境界区撑得很长、行间区分也弱。超过
 * 这个数先只显示前 N 项 + 「展开全部 N 项」，作者要设更靠后的层再展开。
 * 绑定落点超过 N 时强制全量展示（不能把「当前境界」折进去看不见）。
 * 导出供契约测试断言（`EntityDetail/index.test.tsx`）。
 */
export const SUB_COLLAPSE_THRESHOLD = 8;

/** 要素详情：基础字段编辑 / 关联要素增删 / 当前境界（R25）/ 出场章节跳转 */
export default function EntityDetail({
  entity,
  entities,
  relations,
  appearances,
  settings,
  highlighted,
  onToggleHighlight,
  onExportCard,
  onSaveEntity,
  onAddRelation,
  onRemoveRelation,
  onSetEntityLevel,
  onOpenSettings,
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

  /**
   * 境界阶梯：取 kind='realm' 的那个分类
   *
   * 境界体系全书唯一（主进程对第二个 realm 请求会降级为 custom），所以这里
   * 不需要「选哪个体系」的下拉 —— 阶梯本身就是那一条。
   */
  const realmCategory = useMemo(
    () => settings.find((category) => category.kind === "realm") ?? null,
    [settings],
  );
  /**
   * 阶梯按进位方向展示：desc 时高阶在上（「九品 → 一品」）。
   * 只列**根阶** —— 拆分出的子层级是「阶内进度」，不是独立的新阶；
   * 「练气」拆 9 段后阶梯上仍是一行「练气」，段进度挂在它下面（1.38.1）。
   */
  const realmRoots = useMemo(
    () => (realmCategory ? rootLevels(realmCategory.levels, realmCategory.carryDir) : []),
    [realmCategory],
  );
  /** 每个根阶下的派生段（阶内进度）与其小层总数，按展示序排列 */
  const subtreeByRoot = useMemo(() => {
    const map = new Map<string, { segments: SettingLevel[]; total: number }>();
    if (!realmCategory) return map;
    for (const level of sortLevels(realmCategory.levels, realmCategory.carryDir)) {
      if (!level.parentId) continue;
      const entry = map.get(level.parentId) ?? { segments: [], total: 0 };
      entry.segments.push(level);
      if (level.segTo !== null) entry.total = Math.max(entry.total, level.segTo);
      map.set(level.parentId, entry);
    }
    for (const root of realmCategory.levels) {
      const entry = map.get(root.id);
      if (entry) {
        entry.total = Math.max(entry.total, root.subLevels);
      }
    }
    return map;
  }, [realmCategory]);
  /**
   * 绑定落点：绑在哪个根阶下、落在哪个派生段（渲染「境界内进度」用）。
   * 绑定统一落 (根阶, note.sub) —— 行囊 ±1 层写的就是 note 那一格。
   */
  const boundPosition = useMemo(
    () =>
      findRealmPosition(
        realmCategory?.levels ?? [],
        levelBinding?.targetId ?? null,
        parseRealmNoteSub(levelBinding?.note),
      ),
    [realmCategory, levelBinding],
  );
  /**
   * 绑定行的阶内小层（`novel_links.note` 的 `{sub}`）。
   *
   * 未拆分但配了多个小层的阶，没有派生段可高亮 —— 用这个下标点亮对应的小层
   * chip（REQ-045）。缺省 1（与 `parseRealmNoteSub` 同口径）。
   */
  const boundSub = parseRealmNoteSub(levelBinding?.note);

  const BASE_KEYS = ["别名", "一句话", "性格"];
  const customEntries = Object.entries(entity.fields).filter(
    ([key]) => !BASE_KEYS.includes(key),
  );

  const [draft, setDraft] = useState<EntityDraft | null>(null);
  const editing = draft !== null;
  /** 已「展开全部」小境界的根阶 id（每个根阶各自记住，切卡时复位） */
  const [expandedSubs, setExpandedSubs] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

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

  // 切换查看对象时退出编辑态，避免把 A 卡的草稿写进 B 卡；小境界折叠态一并复位
  useEffect(() => {
    setDraft(null);
    setRelAdding(false);
    setExpandedSubs(new Set());
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

      {/* 当前境界。
          角色卡**永远**显示这一格：原来整个区块挂在「有没有等级体系」上，
          新开的书还没有境界体系时它整块消失 —— 连入口按钮也跟着没了，
          作者在资料卡里找不到任何地方去设境界关联。
          没体系时给空态 + 建体系入口，而不是什么都不画。 */}
      {(entity.type === "character" ||
        (settings.length > 0 && Boolean(realmCategory))) && (
        <>
          <div className="nv-sechead">
            当前境界
            {isProtagonist && (
              <span className="nv-edetail__same" title="与行囊面板读的是同一行 novel_links">
                <CrownFilled /> 行囊同源
              </span>
            )}
            {/* 空态里已经有「＋新建境界体系」这个更明确的入口，
                再挂一个同样打开设定中心的「管理」就是两个按钮一件事 */}
            {realmCategory && (
              <Button
                className="nv-edetail__manage"
                onClick={onOpenSettings}
                title="在设定中心管理境界阶梯"
              >
                <SettingOutlined />管理
              </Button>
            )}
          </div>
          {!realmCategory ? (
            <div className="nv-edetail__lvlempty">
              <b>还没有境界体系</b>
              <em>
                境界挂在设定里的「境界体系」阶梯上（炼气 / 筑基…）。先建一套阶梯，
                建好后就能在这张卡上点选当前境界。
              </em>
              <Button
                className="nv-edetail__lvlempty-add"
                onClick={onOpenSettings}
              >
                <PlusOutlined />新建境界体系
              </Button>
            </div>
          ) : (
            <div className="nv-edetail__ladder">
              {realmRoots.map((level) => {
                const subtree = subtreeByRoot.get(level.id);
                const segments = subtree?.segments ?? [];
                const total = subtree?.total ?? level.subLevels;
                const boundInSubtree = boundPosition?.root.id === level.id;
                const boundToRoot = boundInSubtree && !boundPosition?.segment;
                const boundSegment = boundInSubtree ? boundPosition?.segment ?? null : null;
                // 未拆分但有多小层的阶：先折叠到前 N 项，超长时给「展开全部」入口
                const subNames =
                  segments.length === 0 && level.subLevels > 1
                    ? listSubLevels(level, realmCategory)
                    : [];
                const subOverflow = subNames.length > SUB_COLLAPSE_THRESHOLD;
                const subExplicitExpanded = expandedSubs.has(level.id);
                // 绑定落点折在窗口外时强制全量展示，不能让「当前境界」被折叠藏起来
                const subBoundOverflow =
                  boundInSubtree && boundSub > SUB_COLLAPSE_THRESHOLD;
                const subsCollapsed =
                  subOverflow && !subExplicitExpanded && !subBoundOverflow;
                const visibleSubNames = subsCollapsed
                  ? subNames.slice(0, SUB_COLLAPSE_THRESHOLD)
                  : subNames;
                return (
                  <div key={level.id} className="nv-edetail__rung-group">
                    <Button
                      /*
                        根阶行在「绑定落点属于这一阶」时就高亮，而不是只在
                        `boundToRoot`（没落在任何段上）时高亮。

                        绑定统一落 (根阶, note.sub)：落在段上和落在未覆盖层上，
                        **当前境界都还是这一阶** —— 卡片上要能一眼看出「主角在炼气」，
                        段只是阶内进度。只按 boundToRoot 判的话，绑在「炼气 第1段」
                        上会出现「段小条高亮、炼气那一行反而不高亮」，看起来像
                        当前境界不在这一阶。
                      */
                      className={`nv-edetail__rung${boundInSubtree ? " is-on" : ""}`}
                      title={
                        boundInSubtree
                          ? "点击取消当前境界绑定"
                          : segments.length > 0
                            ? "点击设为当前境界（自动选中第 1 层）"
                            : "点击设为当前境界"
                      }
                      onClick={() => {
                        // 这一阶下已有绑定（绑在组上或某个子层级上）→ 再点即取消
                        if (boundInSubtree) {
                          onSetEntityLevel(null);
                          return;
                        }
                        // 父阶是「组」，不单独当境界：有子层级时切到这一阶
                        // = 绑定 (根阶, 第 1 层)；子层级从 1 起编号
                        if (segments.length > 0) {
                          onSetEntityLevel(level.id, 1);
                        } else {
                          // 显式传 undefined：这一阶没有子层级，note 里不写
                          // {sub}（下游靠「第二参有没有」判断要不要落小层号）
                          onSetEntityLevel(level.id, undefined);
                        }
                      }}
                    >
                      <span className="nv-edetail__rung-no">{level.rank}</span>
                      <span>{level.name}</span>
                      {level.note && (
                        <span className="nv-edetail__rung-note">{level.note}</span>
                      )}
                      {boundSegment && (
                        <span className="nv-edetail__rung-prog">
                          {boundSegment.segFrom}–{boundSegment.segTo} / 共 {total} 层
                        </span>
                      )}
                      {(boundToRoot || boundSegment) && (
                        <span className="nv-edetail__rung-cur">当前</span>
                      )}
                    </Button>
                    {segments.length > 0 && (
                      <div className="nv-edetail__rung-segs">
                        {segments.map((segment) => {
                          // 绑定统一落 (根阶, note.sub)：落在该段区间内即高亮；
                          // 旧数据绑在段 id 上时 boundPosition.segment 就是该段，同样命中
                          const segBound = boundSegment?.id === segment.id;
                          return (
                            <Button
                              key={segment.id}
                              className={`nv-edetail__rung-seg${segBound ? " is-on" : ""}`}
                              title={`${segment.name} · 子层 ${segment.segFrom}–${segment.segTo}，共 ${total} 层${
                                segBound ? "（点击取消绑定）" : "（点击绑定此段）"
                              }`}
                              onClick={() =>
                                onSetEntityLevel(
                                  segBound ? null : level.id,
                                  segment.segFrom ?? 1,
                                )
                              }
                            >
                              {segment.name}
                            </Button>
                          );
                        })}
                      </div>
                    )}
                    {/*
                      REQ-045：这一阶**没有拆分**、只配了多个小层时，派生出的小层
                      清单直接铺成一行 chip —— 否则这类阶只能绑到「阶」本身，
                      选不到第 N 层（「已拆分」的阶用上面的派生段那行，二者互斥）。
                      名称由 listSubLevels 唯一生成；绑定坐标是 (根阶, 第 N 层)，
                      与行囊 ±1 层共用同一格 note.sub。
                    */}
                    {segments.length === 0 && level.subLevels > 1 && (
                      <div className="nv-edetail__rung-subs">
                        {visibleSubNames.map((name, index) => {
                          const subIndex = index + 1;
                          const subBound = boundInSubtree && boundSub === subIndex;
                          return (
                            <Button
                              key={subIndex}
                              className={`nv-edetail__rung-sub${
                                subBound ? " is-on" : ""
                              }`}
                              title={
                                subBound
                                  ? `当前小境界（${name}），点击取消绑定`
                                  : `把当前境界设为「${level.name} · ${name}」`
                              }
                              onClick={() => {
                                if (subBound) {
                                  onSetEntityLevel(null);
                                  return;
                                }
                                onSetEntityLevel(level.id, subIndex);
                              }}
                            >
                              {/* 超长小境界名截断，完整名走 span 的 title */}
                              <span className="nv-edetail__rung-sub-name" title={name}>
                                {name}
                              </span>
                            </Button>
                          );
                        })}
                        {subOverflow && subsCollapsed && (
                          <Button
                            className="nv-edetail__rung-subs-toggle"
                            onClick={() =>
                              setExpandedSubs((current) => {
                                const next = new Set(current);
                                next.add(level.id);
                                return next;
                              })
                            }
                          >
                            展开全部 {subNames.length} 项
                          </Button>
                        )}
                        {subOverflow && subExplicitExpanded && (
                          <Button
                            className="nv-edetail__rung-subs-toggle"
                            onClick={() =>
                              setExpandedSubs((current) => {
                                const next = new Set(current);
                                next.delete(level.id);
                                return next;
                              })
                            }
                          >
                            收起
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {realmRoots.length === 0 && (
                <div className="nv-kv">
                  <span className="nv-kv__v">这套阶梯还没有等级，点「管理」添加</span>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {appearances.length > 0 && (
        <>
          <div className="nv-sechead">
            出场章节<em>{appearances.length}</em>
          </div>
          {/*
            出场章节列表走虚拟化：三千章的长篇里一个角色可能出场上千章，
            原先 `appearances.map` 会一次挂载上千个 antd Button
            —— 打开详情卡就是几百毫秒的同步渲染 + 内存尖峰。
            Virtuoso 只挂可视区，且是既有依赖（左栏章节树已用同一套）。

            ⚠️ 高度必须**确定**：Virtuoso 的行绝对定位、不参与父级尺寸计算，
            容器只给 `max-height` 会塌成 0，列表整个看不见。这里按
            「行数 × 行高」算出内联高度 —— 几条出场时自适应收缩不留空白，
            上千条时封顶 APPEAR_MAX_HEIGHT 由容器内部滚动。
          */}
          <div
            className="nv-edetail__appear"
            style={{
              height: Math.min(
                APPEAR_MAX_HEIGHT,
                appearances.length * APPEAR_ROW_HEIGHT,
              ),
            }}
          >
            <Virtuoso
              className="nv-edetail__appear-list"
              style={{ height: "100%" }}
              data={appearances}
              computeItemKey={(_, item) => item.chapterId}
              itemContent={(_, item) => (
                <Button
                  className="nv-edetail__chip"
                  title={`跳转到 ${item.label ? `${item.label}·` : ""}${item.title}`}
                  onClick={() => onSelectChapter(item.chapterId)}
                >
                  {item.label && (
                    <span className="nv-edetail__chip-no">{item.label}</span>
                  )}
                  <span className="nv-edetail__chip-title">{item.title}</span>
                </Button>
              )}
            />
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
