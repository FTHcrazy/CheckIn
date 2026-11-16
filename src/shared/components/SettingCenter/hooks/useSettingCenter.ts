/**
 * 设定中心：状态机与动作编排（UI-10 拆分）
 *
 * 原单体组件 index.tsx 里的全部状态、派生数据、提交动作与拖拽编排搬到这里，
 * 让父组件只负责「组合子组件」。对外契约不变：入参即 SettingCenter 的 props，
 * 所有回调的触发时机与参数与拆分前一致。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import type { SettingCategory, SettingLevel } from "@/shared/novel/setting-types";
import {
  CATEGORY_PALETTE,
  DEFAULT_CATEGORY_COLOR,
  DEFAULT_SUB_LEVELS,
  DEFAULT_SUB_PATTERN,
} from "@/shared/novel/setting-defaults";
import {
  buildBatchNames,
  buildCarryExample,
  canSplitLevel,
  countSubLevels,
  hasChildLevels,
  previewSplit,
  sortLevels,
} from "@/shared/novel/setting-utils";
import {
  SPLIT_PARTS_MAX,
  type BatchMode,
  type CategoryDraft,
  type LevelDraft,
  type SettingCenterProps,
} from "../setting-center-shared";

/** 设定中心状态机对外暴露的能力集合（父组件透传给子组件） */
export interface SettingCenterController {
  // ── 派生数据 ──
  sorted: SettingCategory[];
  activeIdResolved: string;
  active: SettingCategory | null;
  orderedLevels: SettingLevel[];
  /** 末尾之后的落点（行序，不是 max(rank)） */
  appendIndex: number;
  subLevelTotal: number;
  carryExample: string;
  nextColor: string;
  batchNames: string[];
  splitTarget: SettingLevel | null;
  splitPreview: ReturnType<typeof previewSplit>;
  // ── 交互状态 ──
  newCategoryName: string;
  setNewCategoryName: (value: string) => void;
  categoryDraft: CategoryDraft | null;
  setCategoryDraft: (draft: CategoryDraft | null) => void;
  editingLevelId: string | null;
  levelDraft: LevelDraft | null;
  setLevelDraft: (draft: LevelDraft | null) => void;
  insertAt: number | null;
  insertName: string;
  setInsertName: (value: string) => void;
  newLevelName: string;
  setNewLevelName: (value: string) => void;
  dragId: string | null;
  dropIndex: number | null;
  templateDraft: string | null;
  templateName: string;
  setTemplateName: (value: string) => void;
  libraryOpen: boolean;
  batchOpen: boolean;
  batchMode: BatchMode;
  setBatchMode: (mode: BatchMode) => void;
  batchLines: string;
  setBatchLines: (value: string) => void;
  batchCount: string;
  setBatchCount: (value: string) => void;
  batchPattern: string;
  setBatchPattern: (value: string) => void;
  splitParts: string;
  setSplitParts: (value: string) => void;
  splitPattern: string;
  setSplitPattern: (value: string) => void;
  // ── 全局设定中心联动（source="book" 才用到；1.45.0） ──
  /** 是否全局库形态（标题 / 提示语 / 动作区按此切换） */
  isGlobal: boolean;
  /** 当前分类是引用项：本书侧只读 */
  referenced: boolean;
  /** 当前分类是已固化副本（原全局项被删） */
  detachedHint: boolean;
  /** 本次勾选里是否含会被降级为普通分类的全局境界 */
  willDemoteRealm: boolean;
  /** 本书是否已有境界体系（全局 realm 引用时决定是否降级） */
  bookHasRealm: boolean;
  globalCategories: SettingCategory[];
  pickerOpen: boolean;
  pickedGlobalIds: string[];
  openPicker: () => void;
  closePicker: () => void;
  togglePickedGlobal: (globalId: string) => void;
  submitReference: () => void;
  submitPublish: () => void;
  /** 上架同名冲突：弹确认（默认新建副本） */
  publishConflictId: string | null;
  confirmPublishDuplicate: () => void;
  cancelPublishConflict: () => void;
  // ── 选择与动作 ──
  setActiveId: (id: string) => void;
  handleCreateCategory: () => void;
  openLibrary: () => void;
  closeLibrary: () => void;
  openSaveTemplate: () => void;
  closeSaveTemplate: () => void;
  submitSaveTemplate: () => void;
  openBatch: () => void;
  closeBatch: () => void;
  submitBatch: () => void;
  startSplit: (level: SettingLevel) => void;
  closeSplit: () => void;
  submitSplit: () => void;
  applyPreset: (presetId: string) => void;
  applyTemplate: (templateId: string) => void;
  startEditCategory: () => void;
  closeCategoryDraft: () => void;
  submitCategoryDraft: () => void;
  beginEditLevel: (level: SettingLevel) => void;
  endEditLevel: () => void;
  submitLevelDraft: () => void;
  beginInsert: (at: number) => void;
  cancelInsert: () => void;
  submitInsert: (at: number) => void;
  submitAppend: () => void;
  // ── 拖拽（@dnd-kit） ──
  sensors: ReturnType<typeof useSensors>;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragOver: (event: DragOverEvent) => void;
  handleDragEnd: (event: DragEndEvent) => void;
  handleDragCancel: () => void;
}

/**
 * 设定中心状态机。
 *
 * 交互取舍（与拆分前一致）：
 * - 行尾三个常驻图标在七行同屏时太吵 → 收成一个「⋯」菜单，行间悬停出插入条
 * - 拆分 / 合并只在「⋯」里，因为它们一年用不了几次，但需要说清后果
 */
export function useSettingCenter(props: SettingCenterProps): SettingCenterController {
  const {
    open,
    settings,
    focusCategoryId,
    source = "book",
    onCreateCategory,
    onPatchCategory,
    onReorderCategories,
    onAddLevel,
    onBatchAddLevels,
    onPatchLevel,
    onReorderLevels,
    onSplitLevel,
    onSaveTemplate,
    onRefreshTemplates,
    onApplyTemplate,
    onApplyPreset,
    globalCategories,
    onRefreshGlobalCategories,
    onReferenceGlobal,
    onPublishGlobal,
    onNotify,
  } = props;

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
  /** 「从全局库选择」选择器开合 + 已勾选的全局分类 id（多选，D2） */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedGlobalIds, setPickedGlobalIds] = useState<string[]>([]);
  /** 上架命中的全局同名分类：非空即弹冲突确认（默认「新建为副本」） */
  const [publishConflictId, setPublishConflictId] = useState<string | null>(null);

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

  const isGlobal = source === "global";

  /**
   * 引用项在本书侧只读（D2 / H3）：UI 隐藏编辑入口，**主进程才是权威**
   * （写通道命中 source_global_id 非空即拒绝）。UI 只是降低误触，不是安全边界。
   */
  const referenced = !isGlobal && Boolean(active?.sourceGlobalId);
  /** 已固化副本（原全局项被删）：提示一句，但可当普通分类编辑 */
  const detachedHint = !isGlobal && !referenced && Boolean(active?.detachedFromName);

  /**
   * 本书是否已有境界体系（U6）。
   * 「每书至多一个 realm」是硬约束，所以引用一个全局 realm 时：本书已有 realm
   * ⇒ 镜像 kind 落 custom（主进程执行），UI 据此提前提示；本书没有 realm ⇒
   * 落 realm（作者意图就是拿它当境界）。
   */
  const bookHasRealm = useMemo(
    () => settings.some((item) => item.kind === "realm"),
    [settings],
  );
  /** 本次勾选里是否含「会被降级为普通分类」的全局境界（用于提交时提示口径一致） */
  const willDemoteRealm = useMemo(
    () =>
      bookHasRealm &&
      (globalCategories ?? []).some(
        (item) => item.kind === "realm" && pickedGlobalIds.includes(item.id),
      ),
    [bookHasRealm, globalCategories, pickedGlobalIds],
  );

  /** 打开「从全局库选择」：拉一次全局库并清空上次勾选 */
  const openPicker = useCallback((): void => {
    onRefreshGlobalCategories?.();
    setPickedGlobalIds([]);
    setPickerOpen(true);
  }, [onRefreshGlobalCategories]);

  const closePicker = useCallback((): void => {
    setPickerOpen(false);
    setPickedGlobalIds([]);
  }, []);

  /** 勾选 / 取消一个全局分类 */
  const togglePickedGlobal = useCallback((globalId: string): void => {
    setPickedGlobalIds((prev) =>
      prev.includes(globalId) ? prev.filter((id) => id !== globalId) : [...prev, globalId],
    );
  }, []);

  /** 确认「从全局库选择」：逐个建立引用（多选），随后由调用方重载本书设定 */
  const submitReference = useCallback((): void => {
    if (!onReferenceGlobal || pickedGlobalIds.length === 0) return;
    for (const globalId of pickedGlobalIds) void onReferenceGlobal(globalId);
    setPickerOpen(false);
    setPickedGlobalIds([]);
    if (willDemoteRealm) {
      onNotify?.("已加入本书 · 本书已有境界体系，已作为普通分类引入", "warning");
      return;
    }
    onNotify?.("已加入本书 · 引用全局，改动自动同步", "success");
  }, [onReferenceGlobal, pickedGlobalIds, onNotify, willDemoteRealm]);

  /** 「放置到全局」：先探同名（cancel），命中则弹冲突确认（默认新建副本） */
  const submitPublish = useCallback((): void => {
    if (!active || !onPublishGlobal) return;
    void onPublishGlobal(active.id, "cancel").then((result) => {
      if (result.ok) {
        onNotify?.("已上架到全局设定中心", "success");
        return;
      }
      if (result.conflict) setPublishConflictId(active.id);
    });
  }, [active, onPublishGlobal, onNotify]);

  const confirmPublishDuplicate = useCallback((): void => {
    const target = publishConflictId;
    setPublishConflictId(null);
    if (!target || !onPublishGlobal) return;
    void onPublishGlobal(target, "duplicate").then((result) => {
      if (result.ok) onNotify?.("已上架到全局设定中心（新建副本）", "success");
    });
  }, [publishConflictId, onPublishGlobal, onNotify]);

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
    setPickerOpen(false);
    setPickedGlobalIds([]);
    setPublishConflictId(null);
  }, [open]);

  // 模板库只在打开时读库：模板是低频功能，跟着设定中心的每次重渲染读一遍不值。
  // ⚠️ 可选调用：本形态未提供模板能力时不传 onRefreshTemplates（不传该 prop），
  // `?.` 是兜底 —— 否则类型上就不成立（N-04）。
  useEffect(() => {
    if (libraryOpen) onRefreshTemplates?.();
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
      subLevels:
        Number.isFinite(subLevels) && subLevels >= 1
          ? Math.floor(subLevels)
          : DEFAULT_SUB_LEVELS,
      subPattern: categoryDraft.subPattern.trim() || DEFAULT_SUB_PATTERN,
    });
    setCategoryDraft(null);
  }, [active, categoryDraft, onPatchCategory]);

  const startEditCategory = useCallback((): void => {
    if (!active) return;
    setCategoryDraft({
      name: active.name,
      note: active.note,
      subLevels: String(active.subLevels),
      subPattern: active.subPattern,
    });
  }, [active]);

  const closeCategoryDraft = useCallback((): void => {
    setCategoryDraft(null);
  }, []);

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

  const endEditLevel = useCallback((): void => {
    setEditingLevelId(null);
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
      subLevels:
        Number.isFinite(subLevels) && subLevels >= 1
          ? Math.floor(subLevels)
          : DEFAULT_SUB_LEVELS,
      // 空 = 沿用分类模板；提交前去空白
      subPattern: levelDraft.subPattern.trim(),
    });
    setEditingLevelId(null);
    setLevelDraft(null);
  }, [editingLevelId, levelDraft, onPatchLevel]);

  /** 批量生成：名称顺序即阶梯序，全部追加到末尾 */
  const openBatch = useCallback((): void => {
    setBatchMode("lines");
    setBatchOpen(true);
  }, []);

  const closeBatch = useCallback((): void => {
    setBatchOpen(false);
    setBatchLines("");
    setBatchPattern("");
  }, []);

  const submitBatch = useCallback((): void => {
    if (!active || batchNames.length === 0) return;
    // 手动批量生成没有「等级说明」，只给名字；小层回落分类默认（主进程侧）
    onBatchAddLevels(active.id, batchNames.map((name) => ({ name })));
    setBatchOpen(false);
    setBatchLines("");
    setBatchPattern("");
    setBatchCount("8");
  }, [active, batchNames, onBatchAddLevels]);

  /** 拆分：段数夹取 2–30；段名模板为空时沿用「原名 · 第N段」 */
  const startSplit = useCallback((level: SettingLevel): void => {
    // 等级序列只支持两层（1.39.1）：子层级（parentId 非空）不能再拆。
    // 1.4x 收口：已拆出子行的根阶（parentId 为 null 但有子行挂在下面）同样不能
    // 再拆。菜单已隐藏入口（第二层防线之一），这里兜底防程序化调用 —— 权威在主进程。
    if (!active || !canSplitLevel(level, hasChildLevels(active.levels, level.id))) return;
    // 默认子层级数：小层数在 2–30 内就按它拆（一阶拆满层），否则回退 2；
    // 命名模板默认沿用「原名 · 第N段」
    const suggested = Math.min(SPLIT_PARTS_MAX, Math.max(2, level.subLevels));
    setSplitTargetId(level.id);
    setSplitParts(String(suggested));
    setSplitPattern("");
  }, [active]);

  const closeSplit = useCallback((): void => {
    setSplitTargetId(null);
    setSplitParts("2");
    setSplitPattern("");
  }, []);

  const submitSplit = useCallback((): void => {
    // 双层防线：子层级不能再拆；已拆出子行的根阶同样不能再拆。startSplit 已拦，
    // 这里再兜一次防 splitTargetId 被其它路径改坏 —— 权威拒绝仍在主进程。
    if (
      !active ||
      !splitTarget ||
      !canSplitLevel(splitTarget, hasChildLevels(active.levels, splitTarget.id))
    ) {
      return;
    }
    const parts = Math.max(2, Math.min(SPLIT_PARTS_MAX, Math.floor(Number(splitParts)) || 2));
    onSplitLevel(splitTarget.id, parts, splitPattern.trim() || undefined);
    setSplitTargetId(null);
    setSplitParts("2");
    setSplitPattern("");
  }, [active, splitTarget, splitParts, splitPattern, onSplitLevel]);

  /** 行间插入：回车即插入，序号由主进程重排 */
  const beginInsert = useCallback((at: number): void => {
    setInsertAt(at);
    setInsertName("");
  }, []);

  const cancelInsert = useCallback((): void => {
    setInsertAt(null);
    setInsertName("");
  }, []);

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

  const openLibrary = useCallback((): void => {
    setLibraryOpen(true);
  }, []);

  const closeLibrary = useCallback((): void => {
    setLibraryOpen(false);
  }, []);

  const openSaveTemplate = useCallback((): void => {
    if (!active) return;
    setTemplateDraft(active.id);
    setTemplateName(active.name);
  }, [active]);

  const closeSaveTemplate = useCallback((): void => {
    setTemplateDraft(null);
    setTemplateName("");
  }, []);

  const submitSaveTemplate = useCallback((): void => {
    if (templateDraft && templateName.trim()) {
      onSaveTemplate?.(templateDraft, templateName.trim());
    }
    setTemplateDraft(null);
    setTemplateName("");
  }, [templateDraft, templateName, onSaveTemplate]);

  const applyPreset = useCallback(
    (presetId: string): void => {
      onApplyPreset(presetId);
      setLibraryOpen(false);
    },
    [onApplyPreset],
  );

  const applyTemplate = useCallback(
    (templateId: string): void => {
      onApplyTemplate?.(templateId);
      setLibraryOpen(false);
    },
    [onApplyTemplate],
  );

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
      const dragActiveId = String(event.active.id);
      const overId = event.over ? String(event.over.id) : null;
      if (!overId || overId === dragActiveId) return;

      if (dragActiveId.startsWith("lvl:")) {
        if (!active) return;
        const levelId = dragActiveId.slice(4);
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

      if (dragActiveId.startsWith("cat:") && overId.startsWith("cat:")) {
        const ids = sorted.map((item) => item.id);
        const from = ids.indexOf(dragActiveId.slice(4));
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

  return {
    sorted,
    activeIdResolved,
    active,
    orderedLevels,
    appendIndex,
    subLevelTotal,
    carryExample,
    nextColor,
    batchNames,
    splitTarget,
    splitPreview,
    newCategoryName,
    setNewCategoryName,
    categoryDraft,
    setCategoryDraft,
    editingLevelId,
    levelDraft,
    setLevelDraft,
    insertAt,
    insertName,
    setInsertName,
    newLevelName,
    setNewLevelName,
    dragId,
    dropIndex,
    templateDraft,
    templateName,
    setTemplateName,
    libraryOpen,
    batchOpen,
    batchMode,
    setBatchMode,
    batchLines,
    setBatchLines,
    batchCount,
    setBatchCount,
    batchPattern,
    setBatchPattern,
    splitParts,
    setSplitParts,
    splitPattern,
    setSplitPattern,
    isGlobal,
    referenced,
    detachedHint,
    willDemoteRealm,
    bookHasRealm,
    globalCategories: globalCategories ?? [],
    pickerOpen,
    pickedGlobalIds,
    openPicker,
    closePicker,
    togglePickedGlobal,
    submitReference,
    submitPublish,
    publishConflictId,
    confirmPublishDuplicate,
    cancelPublishConflict: () => setPublishConflictId(null),
    setActiveId,
    handleCreateCategory,
    openLibrary,
    closeLibrary,
    openSaveTemplate,
    closeSaveTemplate,
    submitSaveTemplate,
    openBatch,
    closeBatch,
    submitBatch,
    startSplit,
    closeSplit,
    submitSplit,
    applyPreset,
    applyTemplate,
    startEditCategory,
    closeCategoryDraft,
    submitCategoryDraft,
    beginEditLevel,
    endEditLevel,
    submitLevelDraft,
    beginInsert,
    cancelInsert,
    submitInsert,
    submitAppend,
    sensors,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}
