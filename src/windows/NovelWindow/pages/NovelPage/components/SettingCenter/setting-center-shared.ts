/**
 * 设定中心：对外契约与跨子组件共享的常量 / 类型
 *
 * 拆分子组件后，父组件（index.tsx）、状态 Hook（hooks/useSettingCenter.ts）与
 * 各子组件都需要同一份契约。集中放在这里避免：
 * - Hook 反向 import 父组件（会形成循环依赖）；
 * - 子组件各自重复定义 props / 草稿类型，改一处漏两处。
 */

import type { CarryDirection, SettingCategory } from "../../types";

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
