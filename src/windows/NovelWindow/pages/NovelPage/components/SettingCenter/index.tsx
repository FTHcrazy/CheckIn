import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  BookOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  HolderOutlined,
  MoreOutlined,
  PlusOutlined,
  SaveOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import {
  Button,
  ColorPicker,
  Dropdown,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Tooltip,
} from "antd";
import type { InputRef } from "antd";
import type {
  CarryDirection,
  SettingCategory,
  SettingLevel,
} from "../../types";
import {
  CATEGORY_PALETTE,
  DEFAULT_CATEGORY_COLOR,
  DEFAULT_SUB_LEVELS,
  DEFAULT_SUB_PATTERN,
} from "../../novel-config";
import {
  buildBatchNames,
  buildCarryExample,
  countSubLevels,
  formatSubLevel,
  listSubLevels,
  previewSplit,
  sortLevels,
} from "../../utils/setting-utils";
import { SETTING_PRESETS } from "../../utils/setting-presets";
import "./index.scss";

interface SettingCenterProps {
  open: boolean;
  workName: string;
  settings: SettingCategory[];
  /** 打开时要聚焦的分类 id（从角色卡「管理境界」进来时传 realm 分类） */
  focusCategoryId: string | null;
  onClose: () => void;
  onCreateCategory: (name: string, kind: "realm" | "custom", color: string) => void;
  onPatchCategory: (
    categoryId: string,
    patch: {
      name?: string;
      color?: string;
      note?: string;
      subLevels?: number;
      carryDir?: CarryDirection;
      subPattern?: string;
      /** 设为境界体系 / 转为普通分类（主进程保证每书至多一个 realm） */
      kind?: "realm" | "custom";
    },
  ) => void;
  onDeleteCategory: (categoryId: string) => void;
  onReorderCategories: (orderedIds: string[]) => void;
  onAddLevel: (categoryId: string, name: string, index: number) => void;
  /** 批量生成：names 顺序即阶梯序，全部追加到末尾（1.37.0） */
  onBatchAddLevels: (categoryId: string, names: string[]) => void;
  onPatchLevel: (
    levelId: string,
    patch: {
      name?: string;
      aliases?: string[];
      note?: string;
      subLevels?: number;
      subPattern?: string;
    },
  ) => void;
  onDeleteLevel: (levelId: string) => void;
  onReorderLevels: (categoryId: string, fromId: string, toIndex: number) => void;
  /** 拆分层级：namePattern 缺省沿用「原名 · 第N段」（1.37.0） */
  onSplitLevel: (levelId: string, segmentCount: number, namePattern?: string) => void;
  onMergeLevel: (levelId: string) => void;
  /** 导出：kind 决定写 JSON 还是 Markdown */
  onExport: (categoryId: string, format: "json" | "markdown") => void;
  /** 另存为模板 */
  onSaveTemplate: (categoryId: string, name: string) => void;
  /** 预设模板（模板库面板） */
  templates: Array<{ id: string; name: string; createdAt: number }>;
  /** 打开模板库时拉一次列表 */
  onRefreshTemplates: () => void;
  /** 套用模板到当前作品 */
  onApplyTemplate: (templateId: string) => void;
  onDeleteTemplate: (templateId: string) => void;
  /** 应用内置预设（按 SETTING_PRESETS 的 id）（1.37.0） */
  onApplyPreset: (presetId: string) => void;
}

/** 分类卡的可编辑草稿 */
interface CategoryDraft {
  name: string;
  note: string;
  subLevels: string;
  subPattern: string;
}

/** 等级行的可编辑草稿 */
interface LevelDraft {
  name: string;
  aliases: string;
  note: string;
  subLevels: string;
  /** 本阶小层命名；空 = 沿用分类模板 */
  subPattern: string;
}

/** 批量生成的两种模式 */
type BatchMode = "lines" | "pattern";

const SPLIT_PARTS_MAX = 30;

/** 拖拽 id 前缀：同一个 DndContext 里区分等级行与分类行（见 handleDragEnd） */
const lvlId = (id: string): string => `lvl:${id}`;
const catId = (id: string): string => `cat:${id}`;

/**
 * 左栏分类行的可排序包装（@dnd-kit）
 *
 * 整行即拖拽把手（PointerSensor 带 distance 约束，点击仍是「选中分类」）；
 * sortable 同时注册了同名 droppable，等级行拖到分类上松手 =
 * 跨分类搬移，不需要额外的 Droppable。
 */
function SortableCategoryRow({
  category,
  isOn,
  isDragSource,
  onSelect,
}: {
  category: SettingCategory;
  isOn: boolean;
  isDragSource: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: catId(category.id) });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`nv-sc__cat${isOn ? " is-on" : ""}${
        isDragSource || isDragging ? " is-drag" : ""
      }`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={onSelect}
    >
      <span
        className="nv-sc__dot"
        style={{ background: category.color }}
        aria-hidden
      />
      <span className="nv-sc__cat-name">{category.name}</span>
      <span className="nv-sc__cat-count">{category.levels.length} 级</span>
    </div>
  );
}

/**
 * 等级行的可排序包装（@dnd-kit）
 *
 * 行结构里还包含行间插入条（悬停显形），整块作为一个 sortable 条目；
 * 拖拽把手是行首的 grip 图标——listeners 只挂到 grip 上，
 * 行内其余区域（输入框、菜单按钮）不受拖拽干扰。
 */
function SortableLevelRow({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: (listeners: Record<string, unknown> | undefined) => ReactNodeLike;
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

/** 最小 ReactNode 类型：避免在本文件顶部再引一次 React 命名空间 */
type ReactNodeLike = import("react").ReactNode;

/**
 * 设定中心
 *
 * 一部作品的全部等级序列（境界体系 / 功法等级 / 丹药稀有度…）都在这里维护。
 * 境界体系只是 `kind='realm'` 的那一个分类，与自定义分类共用同一套编辑能力。
 *
 * 交互取舍（与设计稿一致）：
 * - 行尾三个常驻图标在七行同屏时太吵 → 收成一个「⋯」菜单，行间悬停出插入条
 * - 拆分 / 合并只在「⋯」里，因为它们一年用不了几次，但需要说清后果
 */
export default function SettingCenter({
  open,
  workName,
  settings,
  focusCategoryId,
  onClose,
  onCreateCategory,
  onPatchCategory,
  onDeleteCategory,
  onReorderCategories,
  onAddLevel,
  onBatchAddLevels,
  onPatchLevel,
  onDeleteLevel,
  onReorderLevels,
  onSplitLevel,
  onMergeLevel,
  onExport,
  onSaveTemplate,
  templates,
  onRefreshTemplates,
  onApplyTemplate,
  onDeleteTemplate,
  onApplyPreset,
}: SettingCenterProps) {
  const [activeId, setActiveId] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(null);
  const [editingLevelId, setEditingLevelId] = useState<string | null>(null);
  const [levelDraft, setLevelDraft] = useState<LevelDraft | null>(null);
  /** 行间插入条：值为落点下标（0 = 最前） */
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [insertName, setInsertName] = useState("");
  const [newLevelName, setNewLevelName] = useState("");
  /** 拖拽中的条目 id（dnd-kit）：前缀区分「lvl:」等级与「cat:」分类 */
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [templateDraft, setTemplateDraft] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  /** 批量生成弹窗（1.37.0） */
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchMode, setBatchMode] = useState<BatchMode>("lines");
  const [batchLines, setBatchLines] = useState("");
  const [batchCount, setBatchCount] = useState("8");
  const [batchPattern, setBatchPattern] = useState("");
  /** 拆分弹窗：记目标 id，目标行跟着数据更新走（1.37.0） */
  const [splitTargetId, setSplitTargetId] = useState<string | null>(null);
  const [splitParts, setSplitParts] = useState("2");
  const [splitPattern, setSplitPattern] = useState("");
  const insertInputRef = useRef<InputRef>(null);

  const sorted = useMemo(
    () => [...settings].sort((a, b) => a.sortOrder - b.sortOrder),
    [settings],
  );

  // 聚焦：activeId（用户点选）优先，其次外部指定（从角色卡进来），最后落第一个分类。
  // ⚠️ focusCategoryId 只能当「初始选中」—— 此前它永久优先，导致「从角色卡
  // 进入 / 应用模板后」左栏点其它分类永远切不过去（报障回归，别改回）。
  const activeIdResolved = useMemo(() => {
    if (activeId && sorted.some((item) => item.id === activeId)) return activeId;
    if (focusCategoryId && sorted.some((item) => item.id === focusCategoryId)) {
      return focusCategoryId;
    }
    return sorted[0]?.id ?? "";
  }, [activeId, focusCategoryId, sorted]);

  // 外部指定的聚焦变化时采纳一次：activeId 还停在旧分类上时，新 focus 要能接管
  useEffect(() => {
    if (focusCategoryId) setActiveId(focusCategoryId);
  }, [focusCategoryId]);

  const active = useMemo(
    () => sorted.find((item) => item.id === activeIdResolved) ?? null,
    [sorted, activeIdResolved],
  );

  /** 关闭后清掉全部草稿：下次打开不该看到上一次没提交的输入 */
  useEffect(() => {
    if (open) return;
    setActiveId("");
    setNewCategoryName("");
    setCategoryDraft(null);
    setEditingLevelId(null);
    setLevelDraft(null);
    setInsertAt(null);
    setInsertName("");
    setNewLevelName("");
    setDragId(null);
    setDropIndex(null);
    setTemplateDraft(null);
    setTemplateName("");
    setLibraryOpen(false);
    setBatchOpen(false);
    setBatchLines("");
    setBatchPattern("");
    setSplitTargetId(null);
    setSplitParts("2");
    setSplitPattern("");
  }, [open]);

  // 模板库只在打开时读库：模板是低频功能，跟着设定中心的每次重渲染读一遍不值
  useEffect(() => {
    if (libraryOpen) onRefreshTemplates();
  }, [libraryOpen, onRefreshTemplates]);

  // 换分类时收起行内编辑：草稿是针对某一条的，留在原地会改到别的行
  useEffect(() => {
    setEditingLevelId(null);
    setLevelDraft(null);
    setInsertAt(null);
    setCategoryDraft(null);
  }, [activeIdResolved]);

  const orderedLevels = useMemo(
    () => (active ? sortLevels(active.levels, active.carryDir) : []),
    [active],
  );

  /**
   * 阶梯行序的落点基准：**行数**，不是 max(rank)。
   *
   * `desc` 进位方向下展示是反的，但 rank 与行序仍是同一坐标系（sortLevels 只
   * 反转展示数组、sort 结果与 rank 升序互为倒序），所以 `orderedLevels.length`
   * 恒等于「末尾之后」的落点。两边（本地 insertLevel / 主进程 rankAt）都按
   * 行序解释 index，这三者必须一致，否则「在末尾插入」会落到中间。
   */
  const appendIndex = orderedLevels.length;

  const subLevelTotal = useMemo(
    () => (active ? countSubLevels(active.levels) : 0),
    [active],
  );

  const carryExample = useMemo(
    () => (active ? buildCarryExample(active) : ""),
    [active],
  );

  /** 批量生成预览：逐行模式去重去空，模板模式按数量渲染（1.37.0） */
  const batchNames = useMemo((): string[] => {
    if (!active || !batchOpen) return [];
    if (batchMode === "lines") {
      return [
        ...new Set(
          batchLines
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean),
        ),
      ].slice(0, 99);
    }
    const count = Math.max(1, Math.min(99, Math.floor(Number(batchCount)) || 1));
    return buildBatchNames(count, batchPattern.trim());
  }, [active, batchOpen, batchMode, batchLines, batchCount, batchPattern]);

  /** 拆分目标与预览（1.37.0）：按 id 找目标，行随数据更新走 */
  const splitTarget = useMemo(
    () => active?.levels.find((level) => level.id === splitTargetId) ?? null,
    [active, splitTargetId],
  );
  const splitPreview = useMemo(() => {
    if (!splitTarget) return [];
    const parts = Math.max(2, Math.min(SPLIT_PARTS_MAX, Math.floor(Number(splitParts)) || 2));
    return previewSplit(splitTarget, parts, splitTarget.subLevels, splitPattern);
  }, [splitTarget, splitParts, splitPattern]);

  /** 新建分类的下一个色点：取色板里还没被占用的那个 */
  const nextColor = useMemo(() => {
    const used = new Set(settings.map((item) => item.color));
    return CATEGORY_PALETTE.find((color) => !used.has(color)) ?? DEFAULT_CATEGORY_COLOR;
  }, [settings]);

  const handleCreateCategory = useCallback((): void => {
    const name = newCategoryName.trim();
    if (!name) return;
    onCreateCategory(name, "custom", nextColor);
    setNewCategoryName("");
  }, [newCategoryName, nextColor, onCreateCategory]);

  const submitCategoryDraft = useCallback((): void => {
    if (!active || !categoryDraft) return;
    const name = categoryDraft.name.trim();
    if (!name) return;
    const subLevels = Number(categoryDraft.subLevels);
    onPatchCategory(active.id, {
      name,
      note: categoryDraft.note.trim(),
      subLevels: Number.isFinite(subLevels) && subLevels >= 1
        ? Math.floor(subLevels)
        : DEFAULT_SUB_LEVELS,
      subPattern: categoryDraft.subPattern.trim() || DEFAULT_SUB_PATTERN,
    });
    setCategoryDraft(null);
  }, [active, categoryDraft, onPatchCategory]);

  const beginEditLevel = useCallback((level: SettingLevel): void => {
    setEditingLevelId(level.id);
    setLevelDraft({
      name: level.name,
      aliases: level.aliases.join("、"),
      note: level.note,
      subLevels: String(level.subLevels),
      subPattern: level.subPattern,
    });
  }, []);

  const submitLevelDraft = useCallback((): void => {
    if (!editingLevelId || !levelDraft) return;
    const name = levelDraft.name.trim();
    if (!name) return;
    const subLevels = Number(levelDraft.subLevels);
    onPatchLevel(editingLevelId, {
      name,
      // 别名用「、」分隔：中文里它最常用来并列，且不会出现在正常名字中间
      aliases: levelDraft.aliases
        .split(/[、,，;；\s]+/)
        .map((alias) => alias.trim())
        .filter(Boolean),
      note: levelDraft.note.trim(),
      subLevels: Number.isFinite(subLevels) && subLevels >= 1
        ? Math.floor(subLevels)
        : DEFAULT_SUB_LEVELS,
      // 空 = 沿用分类模板；提交前去空白
      subPattern: levelDraft.subPattern.trim(),
    });
    setEditingLevelId(null);
    setLevelDraft(null);
  }, [editingLevelId, levelDraft, onPatchLevel]);

  /** 批量生成：名称顺序即阶梯序，全部追加到末尾 */
  const submitBatch = useCallback((): void => {
    if (!active || batchNames.length === 0) return;
    onBatchAddLevels(active.id, batchNames);
    setBatchOpen(false);
    setBatchLines("");
    setBatchPattern("");
    setBatchCount("8");
  }, [active, batchNames, onBatchAddLevels]);

  /** 拆分：段数夹取 2–30；段名模板为空时沿用「原名 · 第N段」 */
  const submitSplit = useCallback((): void => {
    if (!splitTarget) return;
    const parts = Math.max(2, Math.min(SPLIT_PARTS_MAX, Math.floor(Number(splitParts)) || 2));
    onSplitLevel(splitTarget.id, parts, splitPattern.trim() || undefined);
    setSplitTargetId(null);
    setSplitParts("2");
    setSplitPattern("");
  }, [splitTarget, splitParts, splitPattern, onSplitLevel]);

  /** 行间插入：回车即插入，序号由主进程重排 */
  const submitInsert = useCallback(
    (at: number): void => {
      if (!active) return;
      const name = insertName.trim();
      if (!name) {
        setInsertAt(null);
        return;
      }
      onAddLevel(active.id, name, at);
      setInsertAt(null);
      setInsertName("");
    },
    [active, insertName, onAddLevel],
  );

  const submitAppend = useCallback((): void => {
    if (!active) return;
    const name = newLevelName.trim();
    if (!name) return;
    // 与「在末尾插入」共用 appendIndex 这一口径：rank 有空洞时行数才是落点
    onAddLevel(active.id, name, appendIndex);
    setNewLevelName("");
  }, [active, newLevelName, appendIndex, onAddLevel]);

  // ── 拖拽（@dnd-kit）────────────────────────────────────────────
  //
  // 一个 DndContext 同时管两件事，id 前缀区分归属：
  // - 「lvl:」等级行：同分类内重排（落到别的等级行），或拖到左栏分类上
  //   = 整体搬进那个分类末尾（保留旧 HTML5 实现的跨分类搬移能力）；
  // - 「cat:」分类行：只在分类列表内部排序。
  //
  // PointerSensor 带 distance 激活约束：行上的点击（选中分类 / 打开菜单）
  // 不会误触发拖拽。
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const handleDragStart = useCallback((event: DragStartEvent): void => {
    setDragId(String(event.active.id));
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent): void => {
    const overId = event.over ? String(event.over.id) : null;
    // 插入条高亮只关心等级行落点；悬停在分类上时不亮行间插入条
    setDropIndex(overId?.startsWith("lvl:") ? Number(overId.slice(4)) : null);
  }, []);

  const clearDrag = useCallback((): void => {
    setDragId(null);
    setDropIndex(null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      clearDrag();
      const activeId = String(event.active.id);
      const overId = event.over ? String(event.over.id) : null;
      if (!overId || overId === activeId) return;

      if (activeId.startsWith("lvl:")) {
        if (!active) return;
        const levelId = activeId.slice(4);
        if (overId.startsWith("lvl:")) {
          const toIndex = orderedLevels.findIndex(
            (level) => `lvl:${level.id}` === overId,
          );
          if (toIndex >= 0) onReorderLevels(active.id, levelId, toIndex);
        } else if (overId.startsWith("cat:")) {
          const target = sorted.find((item) => `cat:${item.id}` === overId);
          if (target && target.id !== active.id) {
            // 跨分类搬移：落到目标分类末尾（与旧行为一致）
            onReorderLevels(
              target.id,
              levelId,
              Math.max(0, target.levels.length - 1),
            );
          }
        }
        return;
      }

      if (activeId.startsWith("cat:") && overId.startsWith("cat:")) {
        const ids = sorted.map((item) => item.id);
        const from = ids.indexOf(activeId.slice(4));
        const to = ids.indexOf(overId.slice(4));
        if (from >= 0 && to >= 0 && from !== to) {
          onReorderCategories(arrayMove(ids, from, to));
        }
      }
    },
    [
      clearDrag,
      active,
      orderedLevels,
      sorted,
      onReorderLevels,
      onReorderCategories,
    ],
  );

  const handleDragCancel = useCallback((): void => clearDrag(), [clearDrag]);

  return (
    <Modal
      className="nv-sc"
      classNames={{ body: "nv-sc__body" }}
      open={open}
      onCancel={onClose}
      footer={null}
      width={1180}
      style={{ maxWidth: "calc(100vw - 48px)" }}
      title={
        <div className="nv-sc__title">
          <span>设定中心</span>
          <span className="nv-sc__pill">{workName}</span>
        </div>
      }
      destroyOnHidden
    >
      <div className="nv-sc__head">
        <span className="nv-sc__hint">
          设定按作品独立存储 · 修改即时同步到角色卡境界与行囊
        </span>
        <div className="nv-sc__actions">
          <Button size="small" onClick={() => setLibraryOpen(true)}>
            <SaveOutlined />
            模板库
          </Button>
          {active && (
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  {
                    key: "save-template",
                    label: (
                      <>
                        <UploadOutlined /> 另存为模板
                      </>
                    ),
                    onClick: () => {
                      setTemplateDraft(active.id);
                      setTemplateName(active.name);
                    },
                  },
                  {
                    key: "export-json",
                    label: (
                      <>
                        <DownloadOutlined /> 导出为 JSON（本分类）
                      </>
                    ),
                    onClick: () => onExport(active.id, "json"),
                  },
                  {
                    key: "export-md",
                    label: (
                      <>
                        <DownloadOutlined /> 导出为 Markdown 设定集
                      </>
                    ),
                    onClick: () => onExport(active.id, "markdown"),
                  },
                  ...(active.kind === "realm"
                    ? [
                        {
                          key: "unset-realm",
                          label: (
                            <>
                              <BookOutlined /> 转为普通分类
                            </>
                          ),
                          onClick: () => onPatchCategory(active.id, { kind: "custom" as const }),
                        },
                      ]
                    : []),
                ],
              }}
            >
              <Button size="small" aria-label="更多设定操作">
                <MoreOutlined />
              </Button>
            </Dropdown>
          )}
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
      <div className="nv-sc__body-grid">
        <aside className="nv-sc__side">
          <div className="nv-sc__side-head">设定分类</div>
          <div className="nv-sc__list">
            <SortableContext
              items={sorted.map((category) => catId(category.id))}
              strategy={verticalListSortingStrategy}
            >
              {sorted.map((category) => (
                <SortableCategoryRow
                  key={category.id}
                  category={category}
                  isOn={category.id === activeIdResolved}
                  isDragSource={dragId === catId(category.id)}
                  onSelect={() => setActiveId(category.id)}
                />
              ))}
            </SortableContext>
            {sorted.length === 0 && (
              <Empty
                className="nv-sc__empty"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="还没有设定分类"
              />
            )}
          </div>
          <div className="nv-sc__newcat">
            <Input
              size="small"
              value={newCategoryName}
              placeholder="新分类名，如「法宝品阶」"
              aria-label="新分类名"
              onChange={(event) => setNewCategoryName(event.target.value)}
              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                if (event.key === "Enter") handleCreateCategory();
              }}
            />
            <Button
              size="small"
              type="primary"
              onClick={handleCreateCategory}
              disabled={!newCategoryName.trim()}
            >
              <PlusOutlined />
              新建
            </Button>
          </div>
          <div className="nv-sc__tip">右键或「⋯」可重命名 / 删除分类</div>
        </aside>

        <section className="nv-sc__main">
          {!active ? (
            <Empty
              className="nv-sc__empty"
              description="先新建一个设定分类"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : (
            <>
              <div className="nv-sc__card">
                <div className="nv-sc__card-head">
                  <span className="nv-sc__cat-title">{active.name}</span>
                  <span className="nv-sc__badge">
                    {active.kind === "realm" ? "境界体系" : "自定义分类"}
                  </span>
                  {active.kind === "realm" && (
                    <span className="nv-sc__badge is-link">已联动角色境界</span>
                  )}
                  {active.kind === "custom" && (
                    <Button
                      size="small"
                      type="link"
                      className="nv-sc__set-realm"
                      aria-label="设为境界体系"
                      onClick={() => onPatchCategory(active.id, { kind: "realm" })}
                    >
                      设为境界体系
                    </Button>
                  )}
                  <span className="nv-sc__spacer" />
                  <ColorPicker
                    size="small"
                    value={active.color}
                    onChange={(_, hex) => onPatchCategory(active.id, { color: hex })}
                  />
                  <Button
                    size="small"
                    onClick={() =>
                      setCategoryDraft({
                        name: active.name,
                        note: active.note,
                        subLevels: String(active.subLevels),
                        subPattern: active.subPattern,
                      })
                    }
                  >
                    <EditOutlined />
                    编辑
                  </Button>
                  <Popconfirm
                    title="删除这个分类？"
                    description="该分类下的等级项会一并删除，绑在它们上的「当前境界」也会被摘除。"
                    okText="删除"
                    okButtonProps={{ danger: true }}
                    cancelText="取消"
                    onConfirm={() => onDeleteCategory(active.id)}
                  >
                    <Button size="small" danger>
                      <DeleteOutlined />
                      删除
                    </Button>
                  </Popconfirm>
                </div>

                {categoryDraft ? (
                  <div className="nv-sc__form">
                    <label className="nv-sc__field">
                      <span>名称</span>
                      <Input
                        size="small"
                        value={categoryDraft.name}
                        onChange={(event) =>
                          setCategoryDraft({ ...categoryDraft, name: event.target.value })
                        }
                      />
                    </label>
                    <label className="nv-sc__field">
                      <span>说明</span>
                      <Input
                        size="small"
                        value={categoryDraft.note}
                        placeholder="这条序列是干嘛的"
                        onChange={(event) =>
                          setCategoryDraft({ ...categoryDraft, note: event.target.value })
                        }
                      />
                    </label>
                    <label className="nv-sc__field is-narrow">
                      <span>每阶小层数</span>
                      <Input
                        size="small"
                        value={categoryDraft.subLevels}
                        inputMode="numeric"
                        onChange={(event) =>
                          setCategoryDraft({
                            ...categoryDraft,
                            subLevels: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="nv-sc__field is-narrow">
                      <span>小层命名</span>
                      <Input
                        size="small"
                        value={categoryDraft.subPattern}
                        placeholder="{n} 为层号；固定名单：初期,中期,后期,圆满"
                        onChange={(event) =>
                          setCategoryDraft({
                            ...categoryDraft,
                            subPattern: event.target.value,
                          })
                        }
                      />
                    </label>
                    <div className="nv-sc__form-actions">
                      <Button size="small" onClick={() => setCategoryDraft(null)}>
                        取消
                      </Button>
                      <Button size="small" type="primary" onClick={submitCategoryDraft}>
                        保存
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="nv-sc__note">
                    <span className="nv-sc__note-label">说明</span>
                    <span>{active.note || "—"}</span>
                  </div>
                )}

                <div className="nv-sc__carry">
                  <div className="nv-sc__carry-row">
                    <span className="nv-sc__carry-item">
                      <em>每阶小层数</em>
                      {active.subLevels}
                    </span>
                    <span className="nv-sc__carry-item">
                      <em>进位方向</em>
                      <Select
                        size="small"
                        className="nv-sc__carry-select"
                        value={active.carryDir}
                        aria-label="进位方向"
                        options={[
                          { value: "asc", label: "由低到高" },
                          { value: "desc", label: "由高到低" },
                        ]}
                        onChange={(value: CarryDirection) =>
                          onPatchCategory(active.id, { carryDir: value })
                        }
                      />
                    </span>
                    <span className="nv-sc__carry-item">
                      <em>小层命名</em>
                      {formatSubLevel(active.subPattern, 1)} …{" "}
                      {formatSubLevel(active.subPattern, active.subLevels)}
                    </span>
                  </div>
                  <div className="nv-sc__carry-example">
                    <em>进位示例</em>
                    {carryExample}
                  </div>
                </div>
              </div>

              <div className="nv-sc__card is-grow">
                <div className="nv-sc__card-head">
                  <span className="nv-sc__sec-title">等级序列</span>
                  <span className="nv-sc__spacer" />
                  <Button
                    size="small"
                    disabled={!active}
                    onClick={() => {
                      setBatchMode("lines");
                      setBatchOpen(true);
                    }}
                  >
                    <PlusOutlined />
                    批量生成
                  </Button>
                  <span className="nv-sc__tip">
                    拖动左侧手柄调整顺序 · 悬停行间可插入
                  </span>
                </div>

                <div className="nv-sc__thead">
                  <span className="nv-sc__col-grip" />
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
                      disabled={editingLevelId === level.id}
                    >
                    {(dragListeners) => (
                    <>
                      <div
                        className={`nv-sc__ins${
                          insertAt === index || dropIndex === index ? " is-on" : ""
                        }`}
                      >
                        {insertAt === index ? (
                          <Input
                            ref={insertInputRef}
                            size="small"
                            autoFocus
                            className="nv-sc__ins-input"
                            value={insertName}
                            placeholder="输入名称后回车插入"
                            aria-label="在此插入新等级"
                            onChange={(event) => setInsertName(event.target.value)}
                            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                              if (event.key === "Enter") submitInsert(index);
                              if (event.key === "Escape") {
                                setInsertAt(null);
                                setInsertName("");
                              }
                            }}
                            onBlur={() => submitInsert(index)}
                          />
                        ) : (
                          <Button
                            className="nv-sc__ins-btn"
                            size="small"
                            type="link"
                            onClick={() => {
                              setInsertAt(index);
                              setInsertName("");
                            }}
                          >
                            <PlusOutlined />
                            在此插入
                          </Button>
                        )}
                      </div>

                      <div
                        className={`nv-sc__row${
                          level.parentId ? " is-child" : ""
                        }${index % 2 === 1 ? " is-alt" : ""}${
                          dragId === lvlId(level.id) ? " is-drag" : ""
                        }`}
                      >
                        <Tooltip title="拖动调整顺序">
                          <span
                            className="nv-sc__grip"
                            aria-hidden
                            {...dragListeners}
                          >
                            <HolderOutlined />
                          </span>
                        </Tooltip>
                        <span className="nv-sc__col-no">{level.rank}</span>

                        {editingLevelId === level.id && levelDraft ? (
                          <>
                            <Input
                              size="small"
                              className="nv-sc__col-name"
                              value={levelDraft.name}
                              aria-label="等级名称"
                              onChange={(event) =>
                                setLevelDraft({ ...levelDraft, name: event.target.value })
                              }
                              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                                if (event.key === "Enter") submitLevelDraft();
                              }}
                            />
                            <Input
                              size="small"
                              className="nv-sc__col-alias"
                              value={levelDraft.aliases}
                              placeholder="用「、」分隔"
                              aria-label="别名"
                              onChange={(event) =>
                                setLevelDraft({
                                  ...levelDraft,
                                  aliases: event.target.value,
                                })
                              }
                              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                                if (event.key === "Enter") submitLevelDraft();
                              }}
                            />
                            <Input
                              size="small"
                              className="nv-sc__col-note"
                              value={levelDraft.note}
                              aria-label="等级说明"
                              onChange={(event) =>
                                setLevelDraft({ ...levelDraft, note: event.target.value })
                              }
                              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                                if (event.key === "Enter") submitLevelDraft();
                              }}
                            />
                            <span className="nv-sc__col-ops">
                              <Button size="small" onClick={() => setEditingLevelId(null)}>
                                取消
                              </Button>
                              <Button
                                size="small"
                                type="primary"
                                onClick={submitLevelDraft}
                              >
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
                                setLevelDraft({ ...levelDraft, subPattern: event.target.value })
                              }
                              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                                if (event.key === "Enter") submitLevelDraft();
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
                              <Dropdown
                                trigger={["click"]}
                                menu={{
                                  items: [
                                    { key: "edit", label: "编辑名称 / 别名 / 说明" },
                                    // 等级序列只支持两个层级（1.39.1）：主等级下可以
                                    // 挂一层子层级，子层级不能再拆 —— 否则「初级·第1段·
                                    // 第1段」这种三层嵌套既没法在境界 chip 里表达，
                                    // 也没人读得懂。子层级（parentId 非空）不给拆分入口。
                                    ...(level.parentId
                                      ? []
                                      : [{ key: "split", label: "新增子层级…" }]),
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
                                      beginEditLevel(level);
                                      return;
                                    }
                                    if (key === "split") {
                                      // 默认子层级数：小层数在 2–30 内就按它拆（一阶拆满层），
                                      // 否则回退 2；命名模板默认沿用「原名 · 第N段」
                                      const suggested = Math.min(
                                        SPLIT_PARTS_MAX,
                                        Math.max(2, level.subLevels),
                                      );
                                      setSplitTargetId(level.id);
                                      setSplitParts(String(suggested));
                                      setSplitPattern("");
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
                      ⚠️ 这里必须**自己渲染输入框**：`insertAt === index` 的
                      判断只存在于每个等级行上方的插入条里，末尾这一条不落在
                      任何行上，所以此前点它只是把 insertAt 设成行数、却没有任何
                      组件渲染输入框 —— 表现为「点『在末尾插入』没有反应」。
                      落点用 appendIndex（行数），与主进程的 rankAt 同一坐标系。 */}
                  <div className={`nv-sc__ins is-last${insertAt === appendIndex ? " is-on" : ""}`}>
                    {insertAt === appendIndex ? (
                      <Input
                        ref={insertInputRef}
                        size="small"
                        autoFocus
                        className="nv-sc__ins-input"
                        value={insertName}
                        placeholder="输入名称后回车插入"
                        aria-label="在此插入新等级"
                        onChange={(event) => setInsertName(event.target.value)}
                        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                          if (event.key === "Enter") submitInsert(appendIndex);
                          if (event.key === "Escape") {
                            setInsertAt(null);
                            setInsertName("");
                          }
                        }}
                        onBlur={() => submitInsert(appendIndex)}
                      />
                    ) : (
                      <Button
                        className="nv-sc__ins-btn"
                        size="small"
                        type="link"
                        onClick={() => {
                          setInsertAt(appendIndex);
                          setInsertName("");
                        }}
                      >
                        <PlusOutlined />
                        在末尾插入
                      </Button>
                    )}
                  </div>

                  {orderedLevels.length === 0 && (
                    <div className="nv-sc__append">
                      <Input
                        size="small"
                        value={newLevelName}
                        placeholder="第一条等级名，如「引气」"
                        aria-label="首条等级名"
                        onChange={(event) => setNewLevelName(event.target.value)}
                        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                          if (event.key === "Enter") submitAppend();
                        }}
                      />
                      <Button
                        size="small"
                        type="primary"
                        onClick={submitAppend}
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
            </>
          )}
        </section>
      </div>
      </DndContext>

      <Modal
        open={Boolean(templateDraft)}
        title="另存为模板"
        okText="保存"
        cancelText="取消"
        onOk={() => {
          if (templateDraft && templateName.trim()) {
            onSaveTemplate(templateDraft, templateName.trim());
          }
          setTemplateDraft(null);
          setTemplateName("");
        }}
        onCancel={() => {
          setTemplateDraft(null);
          setTemplateName("");
        }}
      >
        <Input
          value={templateName}
          placeholder="模板名，如「通用修仙体系」"
          aria-label="模板名"
          onChange={(event) => setTemplateName(event.target.value)}
        />
      </Modal>

      <Modal
        open={libraryOpen}
        title="模板库"
        footer={null}
        onCancel={() => setLibraryOpen(false)}
        width={480}
      >
        <div className="nv-sc__library">
          <div className="nv-sc__lib-head">内置预设 · 一键灌入，灌完随便改</div>
          {SETTING_PRESETS.map((preset) => (
            <div key={preset.id} className="nv-sc__lib-row">
              <span className="nv-sc__lib-name" title={preset.note}>
                {preset.name}
              </span>
              <Button
                size="small"
                type="link"
                onClick={() => {
                  onApplyPreset(preset.id);
                  setLibraryOpen(false);
                }}
              >
                应用到本书
              </Button>
            </div>
          ))}
          <div className="nv-sc__lib-head">我的模板 · 在分类上「另存为模板」存下</div>
          {templates.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="还没有自己的模板"
            />
          ) : (
            templates.map((template) => (
              <div key={template.id} className="nv-sc__lib-row">
                <span className="nv-sc__lib-name">{template.name}</span>
                <Button
                  size="small"
                  type="link"
                  onClick={() => {
                    onApplyTemplate(template.id);
                    setLibraryOpen(false);
                  }}
                >
                  应用到本书
                </Button>
                <Popconfirm
                  title="删除这个模板？"
                  okText="删除"
                  okButtonProps={{ danger: true }}
                  cancelText="取消"
                  onConfirm={() => onDeleteTemplate(template.id)}
                >
                  <Button size="small" type="text" danger>
                    删除
                  </Button>
                </Popconfirm>
              </div>
            ))
          )}
        </div>
      </Modal>

      <Modal
        open={batchOpen}
        title="批量生成等级"
        okText="生成"
        cancelText="取消"
        width={520}
        okButtonProps={{ disabled: batchNames.length === 0 }}
        onOk={submitBatch}
        onCancel={() => {
          setBatchOpen(false);
          setBatchLines("");
          setBatchPattern("");
        }}
      >
        <div className="nv-sc__batch">
          <Segmented
            value={batchMode}
            aria-label="批量生成模式"
            options={[
              { value: "lines", label: "逐行输入" },
              { value: "pattern", label: "模板生成" },
            ]}
            onChange={(value) => setBatchMode(value as BatchMode)}
          />
          {batchMode === "lines" ? (
            <Input.TextArea
              rows={6}
              value={batchLines}
              placeholder={"每行一个等级名，顺序即阶梯序：\n练气\n筑基\n金丹\n元婴"}
              aria-label="批量等级名（每行一个）"
              onChange={(event) => setBatchLines(event.target.value)}
            />
          ) : (
            <div className="nv-sc__batch-fields">
              <label className="nv-sc__field is-narrow">
                <span>数量（1–99）</span>
                <Input
                  size="small"
                  value={batchCount}
                  inputMode="numeric"
                  aria-label="生成数量"
                  onChange={(event) => setBatchCount(event.target.value)}
                />
              </label>
              <label className="nv-sc__field">
                <span>命名模板</span>
                <Input
                  size="small"
                  value={batchPattern}
                  placeholder="第{n}阶 / 练气第{n}层 / 固定名单：初期,中期,后期,圆满"
                  aria-label="批量命名模板"
                  onChange={(event) => setBatchPattern(event.target.value)}
                />
              </label>
            </div>
          )}
          <div className="nv-sc__carry-example">
            <em>预览</em>
            <span>
              {batchNames.length > 0
                ? `${batchNames.slice(0, 6).join(" → ")}${batchNames.length > 6 ? ` … 共 ${batchNames.length} 条` : ""}`
                : "—"}
            </span>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(splitTarget)}
        title={`为「${splitTarget?.name ?? ""}」新增子层级`}
        okText="新增"
        cancelText="取消"
        width={520}
        onOk={submitSplit}
        onCancel={() => {
          setSplitTargetId(null);
          setSplitParts("2");
          setSplitPattern("");
        }}
      >
        <div className="nv-sc__batch">
          <p className="nv-sc__tip">
            子层级从第 1 段起编号，挂在原阶之下；原阶变成分组（不占小层段），绑在它上面的「当前境界」不失效，可随时合并还原为一阶。
          </p>
          <div className="nv-sc__batch-fields">
            <label className="nv-sc__field is-narrow">
              <span>子层级数量（2–{SPLIT_PARTS_MAX}）</span>
              <Input
                size="small"
                value={splitParts}
                inputMode="numeric"
                aria-label="子层级数量"
                onChange={(event) => setSplitParts(event.target.value)}
              />
            </label>
            <label className="nv-sc__field">
              <span>子层级命名模板（留空 = 原名 · 第N段）</span>
              <Input
                size="small"
                value={splitPattern}
                placeholder="{name} · 第{n}段 / {name}·{n} / 固定名单：初期,中期,后期,圆满"
                aria-label="子层级命名模板"
                onChange={(event) => setSplitPattern(event.target.value)}
              />
            </label>
          </div>
          <div className="nv-sc__carry-example">
            <em>预览</em>
            <span>
              {splitPreview.length > 0
                ? splitPreview
                    .map(
                      (segment) =>
                        `${segment.name}（小层 ${segment.segFrom}–${segment.segTo}）`,
                    )
                    .join(" / ")
                : "—"}
            </span>
          </div>
        </div>
      </Modal>
    </Modal>
  );
}
