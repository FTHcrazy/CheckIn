/**
 * 设定中心：对外契约与跨子组件共享的常量 / 类型
 *
 * 拆分子组件后，父组件（index.tsx）、状态 Hook（hooks/useSettingCenter.ts）与
 * 各子组件都需要同一份契约。集中放在这里避免：
 * - Hook 反向 import 父组件（会形成循环依赖）；
 * - 子组件各自重复定义 props / 草稿类型，改一处漏两处。
 */

import type { CarryDirection, SettingCategory } from "@/shared/novel/setting-types";

/**
 * 设定中心的数据来源：
 * - `book`（默认）：本书域，一部作品的等级序列（原行为）；
 * - `global`：全局库，跨书共享设定（GlobalSettingWindow 用，见 §5.5）。
 *
 * 只是**呈现与动作区**的差异，不改变回调契约 —— 拉哪份数据、写哪条 IPC
 * 由调用方（本书页 / 全局窗口的 hook）决定，组件本身不认识 IPC。
 */
export type SettingCenterSource = "book" | "global";

/**
 * 设定中心的呈现形态（1.45.1）：
 * - `modal`（缺省）：可关闭浮层，浮在自己页面之上（本书设定中心，挂在编辑器里）；
 * - `panel`：**不再套外层浮层**，直接铺满宿主容器（GlobalSettingWindow 用 ——
 *   独立窗口整窗就是这一张设定中心）。
 *
 * 为什么必须有 `panel`：独立窗口里再套一层 Modal，就成了「窗口套弹窗」——
 * 标题栏与浮层标题重复（两处都写「全局设定中心」）、多出第二枚关闭叉、
 * 还多一层遮罩；为了点得到窗口的最小化/最大化/关闭三键，窗口侧被迫把
 * 标题栏 `z-index` 抬到遮罩之上（`GlobalSettingWindow/index.scss` 里那段 hack）。
 *
 * 与 `source` 正交：`panel` 只管**外壳**，标题 / 提示语 / 动作区仍由 `source` 决定。
 */
export type SettingCenterVariant = "modal" | "panel";

/**
 * 设定中心对外 props（UI-10 拆分前后**保持不变**）。
 *
 * 拆分只搬移内部结构，此接口的字段名、回调签名、触发时机都不动 ——
 * 否则父组件（NovelPage）调用方与既有 17 个回归用例会一起挂。
 */
export interface SettingCenterProps {
  open: boolean;
  workName: string;
  settings: SettingCategory[];
  /** 打开时要聚焦的分类 id（从角色卡「管理境界」进来时传 realm 分类） */
  focusCategoryId: string | null;
  /**
   * 数据来源；缺省 `"book"`。全局窗口传 `"global"` ⇒ 标题 / 提示语 / 动作区
   * 按跨书共享库调整，并给分类行加「N 部书引用」徽标。
   */
  source?: SettingCenterSource;
  /**
   * 呈现形态；缺省 `"modal"`。独立窗口传 `"panel"` —— 不再渲染外层 Modal，
   * 组件自身铺满容器（见 `SettingCenterVariant` 的说明）。
   */
  variant?: SettingCenterVariant;
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
  // ── 模板能力（以下 5 个 props 必须**齐备**才提供模板能力；1.45.1 / N-04）──
  //
  // 模板能力绑 workId，属本书域。语义：**不传（任缺其一）= 本形态不提供模板能力**，
  // 组件据此收掉三处：动作区「另存为模板」入口、SaveTemplateModal、
  // 模板库弹窗内的「我的模板」区块（`showTemplates` = hasTemplateCapability）。
  //
  // ⚠️ **不包含**「模板库」入口与空态 CTA：模板库里的「内置预设」是纯本地能力
  // （`onApplyPreset` 是必填 prop，见下），任何形态都能用 —— 把模板库一起门控
  // 会删掉一个本来可用的功能。
  //
  // 此前全局窗口传的是**空实现**（`onSaveTemplate={() => {}}`、`templates={[]}`…）
  // 而组件**无条件渲染**这些入口 —— 入口点了没反应、模板列表恒空，是对用户的
  // 假承诺。现在改为显式可选：不做就不传，而不是「传个假的」。
  /** 另存为模板 */
  onSaveTemplate?: (categoryId: string, name: string) => void;
  /** 预设模板（模板库面板） */
  templates?: Array<{ id: string; name: string; createdAt: number }>;
  /** 打开模板库时拉一次列表 */
  onRefreshTemplates?: () => void;
  /** 套用模板到当前作品 */
  onApplyTemplate?: (templateId: string) => void;
  onDeleteTemplate?: (templateId: string) => void;
  /** 应用内置预设（按 SETTING_PRESETS 的 id）（1.37.0） */
  onApplyPreset: (presetId: string) => void;

  // ── 全局设定中心联动（仅 source="book" 生效；1.45.0） ──

  /** 全局库分类（供「从全局库选择」选择器展示）；不传 = 不渲染该入口 */
  globalCategories?: SettingCategory[];
  /** 打开「从全局库选择」时拉一次全局库（低频，打开才读） */
  onRefreshGlobalCategories?: () => void;
  /** 确认引用：把勾选的全局分类加入本书（D2）。异步完成后由调用方重载本书设定 */
  onReferenceGlobal?: (globalCategoryId: string) => Promise<boolean> | void;
  /**
   * 放置到全局（D3）。`conflict='cancel'` 先探同名：命中返回
   * `{ok:false, conflict:true}`，弹冲突确认后以 `conflict='duplicate'` 再调一次。
   */
  onPublishGlobal?: (
    categoryId: string,
    conflict: "duplicate" | "cancel",
  ) => Promise<{ ok: boolean; conflict?: boolean }>;
  /** 轻提示（上架成功 / 失败 / 引用提示）；不传则静默 */
  onNotify?: (text: string, tone?: "success" | "info" | "warning" | "error") => void;
}

/** 分类卡的可编辑草稿 */
export interface CategoryDraft {
  name: string;
  note: string;
  subLevels: string;
  subPattern: string;
}

/** 等级行的可编辑草稿 */
export interface LevelDraft {
  name: string;
  aliases: string;
  note: string;
  subLevels: string;
  /** 本阶小层命名；空 = 沿用分类模板 */
  subPattern: string;
}

/** 批量生成的两种模式 */
export type BatchMode = "lines" | "pattern";

/** 拆分弹窗允许的最大段数 */
export const SPLIT_PARTS_MAX = 30;

/** 拖拽 id 前缀：同一个 DndContext 里区分等级行与分类行（见 handleDragEnd） */
export const lvlId = (id: string): string => `lvl:${id}`;
export const catId = (id: string): string => `cat:${id}`;
