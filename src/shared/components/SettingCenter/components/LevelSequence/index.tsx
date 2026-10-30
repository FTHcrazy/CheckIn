/**
 * 设定中心 · 等级序列（UI-10 拆分）
 *
 * 右栏第二块卡：小节头（进阶操作入口）+ 表头 + 可排序的阶梯行 + 行间插入条
 * + 末尾插入条 + 空列表的「首条等级名」追加行 + 状态条。
 *
 * 行结构里还包含行间插入条（悬停显形），整块作为一个 sortable 条目；拖拽把手
 * 是行首的 grip 图标——listeners 只挂到 grip 上，行内其余区域（输入框、菜单
 * 按钮）不受拖拽干扰。等级序列只支持两个层级：子层级（parentId 非空）不再
 * 提供拆分入口。
 */

import { HolderOutlined, PlusOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Button, Checkbox, Dropdown, Input, Tooltip } from "antd";
import type { KeyboardEvent, ReactNode } from "react";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { SettingCategory, SettingLevel } from "@/shared/novel/setting-types";
import { canSplitLevel, hasChildLevels, listSubLevels } from "@/shared/novel/setting-utils";
import { lvlId, type LevelDraft } from "../../setting-center-shared";
import "./index.scss";

/**
 * 等级行的可排序包装（@dnd-kit）
 *
 * 拖拽把手是行首的 grip 图标——listeners 只挂到 grip 上，行内其余区域
 * （输入框、菜单按钮）不受拖拽干扰。
 */
function SortableLevelRow({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: (listeners: Record<string, unknown> | undefined) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        position: "relative",
        zIndex: isDragging ? 3 : undefined,
      }}
    >
      {children(listeners)}
    </div>
  );
}

export interface LevelSequenceProps {
  /** 引用项只读（D2）：隐藏全部写入口，手柄锁成占位 */
  referenced?: boolean;
  active: SettingCategory;
  orderedLevels: SettingLevel[];
  editingLevelId: string | null;
  levelDraft: LevelDraft | null;
  onLevelDraftChange: (draft: LevelDraft) => void;
  onBeginEditLevel: (level: SettingLevel) => void;
  onEndEditLevel: () => void;
  onSubmitLevelDraft: () => void;
  /** 行间插入条：值为落点下标（0 = 最前） */
  insertAt: number | null;
  insertName: string;
  onInsertNameChange: (value: string) => void;
  onBeginInsert: (at: number) => void;
  onCancelInsert: () => void;
  onSubmitInsert: (at: number) => void;
  /** 末尾之后的落点（行序） */
  appendIndex: number;
  newLevelName: string;
  onNewLevelNameChange: (value: string) => void;
  onSubmitAppend: () => void;
  dragId: string | null;
  dropIndex: number | null;
  subLevelTotal: number;
  onOpenBatch: () => void;
  /**
   * 打开 AI 生成 / 拓展弹窗（R-AI-18）。
   *
   * **不传 = 本形态不提供**（与模板能力的「不传而不是传空实现」同一纪律）：
   * AI 不可用 / 用户关掉了 AI / 引用自全局的只读分类，调用方都不传，
   * 卡头就不会出现一个点了没反应的按钮。
   */
  onOpenAiGen?: () => void;
  onStartSplit: (level: SettingLevel) => void;
  onMergeLevel: (levelId: string) => void;
  onDeleteLevel: (levelId: string) => void;
  // ── 批量选择（R10，全局设定中心窗口用） ──────────────────────────
  //
  // 三个 prop **全可选且带默认值**：本书设定中心不传 ⇒ `selectable` 为 falsy
  // ⇒ 不渲染勾选框、行网格不加 `is-selectable` 类 ⇒ DOM 与改动前**逐节点一致**。
  // 这是「可选 prop」而不是「形态分流」—— 不传即等于今天的全部行为。
  /** 行首是否出现勾选框（批量选择模式） */
  selectable?: boolean;
  /** 已勾选的等级 id */
  selectedIds?: string[];
  /** 勾选 / 取消一条 */
  onToggleSelect?: (levelId: string) => void;
}

export default function LevelSequence({
  active,
  orderedLevels,
  editingLevelId,
  levelDraft,
  onLevelDraftChange,
  onBeginEditLevel,
  onEndEditLevel,
  onSubmitLevelDraft,
  insertAt,
  insertName,
  onInsertNameChange,
  onBeginInsert,
  onCancelInsert,
  onSubmitInsert,
  appendIndex,
  newLevelName,
  onNewLevelNameChange,
  onSubmitAppend,
  dragId,
  dropIndex,
  subLevelTotal,
  onOpenBatch,
  onOpenAiGen,
  onStartSplit,
  onMergeLevel,
  onDeleteLevel,
  referenced = false,
  selectable = false,
  selectedIds = [],
  onToggleSelect,
}: LevelSequenceProps) {
  return (
    <div className="nv-sc__card is-grow">
      <div className="nv-sc__card-head">
        <span className="nv-sc__sec-title">阶梯</span>
        <span className="nv-sc__spacer" />
        {!referenced && (
          <>
            {/* AI 生成排在批量生成前面：这是「建一整套体系」的主路径，
                批量生成（逐行 / 模板）是它不可用时的本地兜底。 */}
            {onOpenAiGen && (
              <Button size="small" disabled={!active} onClick={onOpenAiGen}>
                <ThunderboltOutlined />
                AI 生成
              </Button>
            )}
            <Button size="small" disabled={!active} onClick={onOpenBatch}>
              <PlusOutlined />
              批量生成
            </Button>
          </>
        )}
        <span className="nv-sc__tip">
          {referenced
            ? "引用自全局中心 · 只读，改动请到全局设定中心"
            : "拖动左侧手柄调整顺序 · 悬停行间可插入"}
        </span>
      </div>

      <div className={`nv-sc__thead${selectable ? " is-selectable" : ""}`}>
        <span className="nv-sc__col-grip" />
        {selectable && <span className="nv-sc__col-pick" />}
        <span className="nv-sc__col-no">序号</span>
        <span className="nv-sc__col-name">等级名称</span>
        <span className="nv-sc__col-alias">别名</span>
        <span className="nv-sc__col-note">等级说明</span>
        <span className="nv-sc__col-ops">操作</span>
      </div>

      <div className="nv-sc__rows">
        <SortableContext
          items={orderedLevels.map((level) => lvlId(level.id))}
          strategy={verticalListSortingStrategy}
        >
          {orderedLevels.map((level, index) => (
            <SortableLevelRow
              key={level.id}
              id={lvlId(level.id)}
              disabled={referenced || editingLevelId === level.id}
            >
              {(dragListeners) => (
                <>
                  {/* 引用项只读（D2）：不给「在此插入」入口，主进程才是权威 */}
                  {!referenced && (
                  <div
                    className={`nv-sc__ins${
                      insertAt === index || dropIndex === index ? " is-on" : ""
                    }`}
                  >
                    {insertAt === index ? (
                      <Input
                        size="small"
                        autoFocus
                        className="nv-sc__ins-input"
                        value={insertName}
                        placeholder="输入名称后回车插入"
                        aria-label="在此插入新等级"
                        onChange={(event) => onInsertNameChange(event.target.value)}
                        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                          if (event.key === "Enter") onSubmitInsert(index);
                          if (event.key === "Escape") onCancelInsert();
                        }}
                        onBlur={() => onSubmitInsert(index)}
                      />
                    ) : (
                      <Button
                        className="nv-sc__ins-btn"
                        size="small"
                        type="link"
                        onClick={() => onBeginInsert(index)}
                      >
                        <PlusOutlined />
                        在此插入
                      </Button>
                    )}
                  </div>
                  )}

                  <div
                    className={`nv-sc__row${level.parentId ? " is-child" : ""}${
                      index % 2 === 1 ? " is-alt" : ""
                    }${dragId === lvlId(level.id) ? " is-drag" : ""}${
                      selectable ? " is-selectable" : ""
                    }`}
                  >
                    {referenced ? (
                      <span className="nv-sc__grip is-locked" aria-hidden>
                        <HolderOutlined />
                      </span>
                    ) : (
                      <Tooltip title="拖动调整顺序">
                        <span className="nv-sc__grip" aria-hidden {...dragListeners}>
                          <HolderOutlined />
                        </span>
                      </Tooltip>
                    )}
                    {/* 批量选择勾选框（R10）：`selectable` 为 falsy 时整段不渲染
                        ⇒ 本书侧的 DOM 与改动前逐节点一致 */}
                    {selectable && (
                      <Checkbox
                        className="nv-sc__col-pick"
                        aria-label={`选择 ${level.name}`}
                        checked={selectedIds.includes(level.id)}
                        onChange={() => onToggleSelect?.(level.id)}
                      />
                    )}
                    <span className="nv-sc__col-no">{level.rank}</span>

                    {editingLevelId === level.id && levelDraft ? (
                      <>
                        <Input
                          size="small"
                          className="nv-sc__col-name"
                          value={levelDraft.name}
                          aria-label="等级名称"
                          onChange={(event) =>
                            onLevelDraftChange({ ...levelDraft, name: event.target.value })
                          }
                          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                            if (event.key === "Enter") onSubmitLevelDraft();
                          }}
                        />
                        <Input
                          size="small"
                          className="nv-sc__col-alias"
                          value={levelDraft.aliases}
                          placeholder="用「、」分隔"
                          aria-label="别名"
                          onChange={(event) =>
                            onLevelDraftChange({
                              ...levelDraft,
                              aliases: event.target.value,
                            })
                          }
                          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                            if (event.key === "Enter") onSubmitLevelDraft();
                          }}
                        />
                        <Input
                          size="small"
                          className="nv-sc__col-note"
                          value={levelDraft.note}
                          aria-label="等级说明"
                          onChange={(event) =>
                            onLevelDraftChange({ ...levelDraft, note: event.target.value })
                          }
                          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                            if (event.key === "Enter") onSubmitLevelDraft();
                          }}
                        />
                        <span className="nv-sc__col-ops">
                          <Button size="small" onClick={onEndEditLevel}>
                            取消
                          </Button>
                          <Button size="small" type="primary" onClick={onSubmitLevelDraft}>
                            保存
                          </Button>
                        </span>
                        <Input
                          size="small"
                          className="nv-sc__col-sub"
                          value={levelDraft.subPattern}
                          placeholder="小层命名（留空沿用分类模板）：第{n}层 / {n}品 / 初期,中期,后期,圆满"
                          aria-label="小层命名"
                          onChange={(event) =>
                            onLevelDraftChange({
                              ...levelDraft,
                              subPattern: event.target.value,
                            })
                          }
                          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                            if (event.key === "Enter") onSubmitLevelDraft();
                          }}
                        />
                      </>
                    ) : (
                      <>
                        <span className="nv-sc__col-name">{level.name}</span>
                        <span className="nv-sc__col-alias">
                          {level.aliases.join(" · ") || "—"}
                        </span>
                        <span className="nv-sc__col-note">
                          {level.note || "—"}
                          {/* 拆分过的父阶也标自己的段（从 1 起）：子层级编号
                              是「整阶的第几小层」，不是「第几个新增行」（1.38.1） */}
                          {(level.parentId || level.segFrom !== null) && (
                            <span className="nv-sc__seg">
                              子层 {level.segFrom}–{level.segTo}
                            </span>
                          )}
                        </span>
                        <span className="nv-sc__col-ops">
                          {/* 引用项只读（D2）：隐藏行内「⋯」全部写入口 */}
                          {referenced && <span className="nv-sc__ro">只读</span>}
                          {!referenced && (
                          <Dropdown
                            trigger={["click"]}
                            menu={{
                              items: [
                                { key: "edit", label: "编辑名称 / 别名 / 说明" },
                                // 等级序列只支持两个层级（1.39.1）：主等级下可以
                                // 挂一层子层级，子层级不能再拆 —— 否则「初级·第1段·
                                // 第1段」这种三层嵌套既没法在境界 chip 里表达，
                                // 也没人读得懂。子层级（parentId 非空）不给拆分入口。
                                // 1.4x 收口：已拆出子行的根阶（parentId 为 null 但
                                // 有子行挂在下面）同样不再给拆分入口。口径收敛到纯
                                // 函数 canSplitLevel（主进程 / UI 同一判据），子行
                                // 信息由 hasChildLevels 从整份序列里现算。
                                ...(canSplitLevel(
                                  level,
                                  hasChildLevels(orderedLevels, level.id),
                                )
                                  ? [{ key: "split", label: "新增子层级…" }]
                                  : []),
                                ...(level.parentId
                                  ? []
                                  : [
                                      {
                                        key: "merge",
                                        label: "合并子层级（还原为一阶）",
                                        disabled: !orderedLevels.some(
                                          (item) => item.parentId === level.id,
                                        ),
                                      },
                                    ]),
                                { type: "divider" as const },
                                { key: "delete", label: "删除该等级", danger: true },
                              ],
                              onClick: ({ key }) => {
                                if (key === "edit") {
                                  onBeginEditLevel(level);
                                  return;
                                }
                                if (key === "split") {
                                  onStartSplit(level);
                                  return;
                                }
                                if (key === "merge") {
                                  onMergeLevel(level.id);
                                  return;
                                }
                                if (key === "delete") onDeleteLevel(level.id);
                              },
                            }}
                          >
                            <Button size="small" type="text" aria-label="更多操作">
                              ⋯
                            </Button>
                          </Dropdown>
                          )}
                        </span>

                        {/* 小境界清单（1.38.0）。
                            此前 `subLevels` 只是一个存在于进位示例文案里的
                            数字，阶梯里永远只有「练气」一行 —— 作者看不到
                            「一层、二层」到底存不存在。这里把该阶真实的小层
                            展开成可点选的行，点一下即把「练气 二层」插到正文。

                            与「拆分」的区别：拆分是把一阶**变成多行阶**（写库、
                            改层级结构）；这里是**只读速览**，不写库、不动阶梯。
                            两者都保留了，因为「我只是想瞄一眼九层名字」和
                            「我要把练气当九阶用」是两种意图。 */}
                        {!level.parentId && level.subLevels > 1 && (
                          <div className="nv-sc__sub">
                            <span className="nv-sc__sub-label">
                              {listSubLevels(level, active).length} 小境界
                            </span>
                            <span className="nv-sc__sub-list">
                              {listSubLevels(level, active).map((subName) => (
                                <Button
                                  key={subName}
                                  size="small"
                                  type="text"
                                  className="nv-sc__sub-chip"
                                  title={`复制「${level.name} ${subName}」`}
                                  onClick={() => {
                                    void navigator.clipboard?.writeText(
                                      `${level.name} ${subName}`,
                                    );
                                  }}
                                >
                                  {subName}
                                </Button>
                              ))}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}
            </SortableLevelRow>
          ))}
        </SortableContext>

        {/* 末尾插入条。
            ⚠️ 这里必须**自己渲染输入框**：`insertAt === index` 的判断只存在于
            每个等级行上方的插入条里，末尾这一条不落在任何行上，所以此前点它
            只是把 insertAt 设成行数、却没有任何组件渲染输入框 —— 表现为
            「点『在末尾插入』没有反应」。落点用 appendIndex（行数），与主进程
            的 rankAt 同一坐标系。 */}
        {!referenced && (
          <div className={`nv-sc__ins is-last${insertAt === appendIndex ? " is-on" : ""}`}>
          {insertAt === appendIndex ? (
            <Input
              size="small"
              autoFocus
              className="nv-sc__ins-input"
              value={insertName}
              placeholder="输入名称后回车插入"
              aria-label="在此插入新等级"
              onChange={(event) => onInsertNameChange(event.target.value)}
              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                if (event.key === "Enter") onSubmitInsert(appendIndex);
                if (event.key === "Escape") onCancelInsert();
              }}
              onBlur={() => onSubmitInsert(appendIndex)}
            />
          ) : (
            <Button
              className="nv-sc__ins-btn"
              size="small"
              type="link"
              onClick={() => onBeginInsert(appendIndex)}
            >
              <PlusOutlined />
              在末尾插入
            </Button>
          )}
          </div>
        )}

        {!referenced && orderedLevels.length === 0 && (
          <div className="nv-sc__append">
            <Input
              size="small"
              value={newLevelName}
              placeholder="第一条等级名，如「引气」"
              aria-label="首条等级名"
              onChange={(event) => onNewLevelNameChange(event.target.value)}
              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                if (event.key === "Enter") onSubmitAppend();
              }}
            />
            <Button
              size="small"
              type="primary"
              onClick={onSubmitAppend}
              disabled={!newLevelName.trim()}
            >
              新增
            </Button>
          </div>
        )}
      </div>

      <div className="nv-sc__status">
        共 {orderedLevels.length} 级
        {subLevelTotal > 0 && ` · ${subLevelTotal} 小境界`} · 修改即时生效
      </div>
    </div>
  );
}
