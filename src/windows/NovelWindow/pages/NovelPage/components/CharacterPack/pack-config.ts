/**
 * 行囊配置常量
 *
 * 只放「本模块私有」的常量与出厂值；跨模块复用的（如「当前境界」关系名）
 * 一律从既有配置导入，避免第二份事实源。
 */
import { LEVEL_RELATION, STORAGE_KEYS } from "../../novel-config";
import { PACK_MODULES, type PackModuleState } from "./types";

/** 「当前境界」关联名：与 R25 实体面板共用同一份定义（§9.7.3 唯一事实源） */
export const PACK_LEVEL_RELATION = LEVEL_RELATION;

/** 界面偏好落库键（即改即存，不进草稿；与 §8.6.2 的判据一致） */
export const PACK_UI_KEY = STORAGE_KEYS.packUi;

/** 出厂模块布局：全部启用，顺序即 PACK_MODULES */
export const DEFAULT_LAYOUTS: PackModuleState[] = PACK_MODULES.map((module, index) => ({
  key: module.key,
  enabled: true,
  sortOrder: index + 1,
}));

/** 面板宽度（与既有右栏共存，故比右栏更宽一档以便宫格视图） */
export const PACK_PANEL = {
  defaultWidth: 420,
  minWidth: 340,
  maxWidth: 620,
  debounceMs: 300,
  /** 窄窗降级阈值：可用宽度低于此值 → 全屏浮层 + 遮罩（§8.2 降级规则） */
  overlayBelow: 1100,
} as const;

/** 物品列表搜索防抖（B-3：≥20 条时实时过滤，防抖 200ms） */
export const INVENTORY_SEARCH_DEBOUNCE_MS = 200;

/** 物品数量长按连续增减：首次延迟与步进间隔 */
export const QTY_HOLD = { delayMs: 400, intervalMs: 60 } as const;

/** 货币进制模板（D-1：作者可「从模板创建」） */
export const CURRENCY_TEMPLATE: Array<{ name: string; ratioToBase: number }> = [
  { name: "金", ratioToBase: 10000 },
  { name: "银", ratioToBase: 100 },
  { name: "铜", ratioToBase: 1 },
];

/** 熟练度阈值模板（D-1：0-99 入门 / 100-499 熟练 / 500+ 大师） */
export const PROFICIENCY_TEMPLATE: Array<{ name: string; min: number; max: number | null }> = [
  { name: "入门", min: 0, max: 99 },
  { name: "熟练", min: 100, max: 499 },
  { name: "大师", min: 500, max: null },
];

/** 境界阶梯模板（D-1：从模板创建，一步到位） */
export const LADDER_TEMPLATE: Array<{ name: string; subLevels: number }> = [
  { name: "炼气", subLevels: 9 },
  { name: "筑基", subLevels: 9 },
  { name: "金丹", subLevels: 9 },
  { name: "元婴", subLevels: 9 },
  { name: "化神", subLevels: 1 },
];

/** 量纲体系的用途键：同一角色最多各一套（境界复用 R25，不在这里） */
export type UnitKind = "currency" | "proficiency";

/** 数量总数上限（F-5 负重是 P2，这里只做显示用的大数保护） */
export const QTY_MAX = 999999;

// ── 主角绑定变更事件 ──

/**
 * 事件名（本窗口 CustomEvent 与跨窗口 broadcast 共用同一个名字）。
 *
 * 为什么需要它：右侧要素栏的「设为主角」与行囊面板的「绑定实体」是两个入口、
 * 写的是同一格数据（`novel_pack_characters.entity_id`）。若不广播，另一边就得
 * 等到重新装载才跟上——表现为「这边设了主角、那边还写着未绑定」。
 *
 * 事件定义放在行囊模块里而不是页面配置里：主角绑定是行囊的数据，
 * 右侧要素栏只是它的另一个展示面。这样未来把模块迁到独立窗口时，
 * 事件随模块一起走，调用方零改动。
 */
export const PACK_PROTAGONIST_EVENT = "pack-protagonist-changed";

/** 事件负载：`workId` 用于过滤别的作品（多窗口可能各自开着不同的书） */
export interface PackProtagonistEventDetail {
  workId: string;
  entityId: string;
}

/**
 * 读取事件负载——两种投递形状必须都认。
 *
 * 同一个事件有两条投递路径，负载形状**不同**：
 * - 同窗口：`window.dispatchEvent(new CustomEvent(name, { detail }))`
 *   → 监听器收到的第一个参数是 `CustomEvent`，负载挂在 `.detail` 上；
 * - 跨窗口：`ipcRenderer.on(name, (_e, ...args) => handler(...args))`
 *   → 第一个参数就是负载对象本身。
 *
 * ⚠️ 必须在这里归一化，不能各监听器直接 `args[0] as Detail`。此前就是那样写的，
 * 于是同窗口这条路径永远读出 `undefined`：读主角的那处会把值**清空**
 * （表现为「点了设为主角，角标一闪就没」），读境界的那几处则因为 `workId`
 * 是 `undefined` 直接 return（表现为「行囊和面板各说各话」）。
 *
 * 而广播又刻意**排除发送者**（`window-broadcast` → `broadcast(..., senderName)`），
 * 所以同窗口没有任何一条路能兜住它——这个洞是纯静默的。
 */
export function readEventDetail<T>(args: unknown[]): T | undefined {
  const first = args[0];
  if (typeof Event !== "undefined" && first instanceof Event) {
    return (first as CustomEvent).detail as T | undefined;
  }
  return first as T | undefined;
}

/**
 * 广播「主角换了」。
 *
 * 两条路径都必须发：只发 CustomEvent 时分离窗口收不到；只发 broadcast 时
 * 同窗口内的监听不保证回环。两边都发一次，代价只是多一个 IPC 通知。
 */
export function notifyProtagonistChanged(workId: string, entityId: string): void {
  const detail: PackProtagonistEventDetail = { workId, entityId };
  window.dispatchEvent(new CustomEvent(PACK_PROTAGONIST_EVENT, { detail }));
  void window.electronAPI?.windowAPI.broadcast(PACK_PROTAGONIST_EVENT, detail);
}

// ── 境界关联变更事件 ──

/**
 * 事件名：行囊改了「主角的当前境界」后，右侧要素栏的卡片要立刻重画同样的读数。
 *
 * 没有它会发生什么：行囊里把境界推到「碎虚」，写库已经成功，但右侧角色卡上
 * 仍然写着「凝丹」——直到下次重载。这正是「看着像联动、实际各说各话」的典型。
 */
export const PACK_REALM_EVENT = "pack-realm-changed";

/** 事件负载：带上 workId，避免另一个窗口开着别的书时被误改 */
export interface PackRealmEventDetail {
  workId: string;
  link: {
    id: string;
    fromType: string;
    fromId: string;
    toType: string;
    toId: string;
    relation: string;
    note?: string;
  } | null;
  /**
   * 改动来源。`'pack'` 表示行囊面板自己写的——它写完已经读过一遍元数据，
   * 再被自己的广播触发一次整体重读纯属浪费（realm 改动是点击级频率，
   * 但整体重读要过一次完整 bundle 装载）。
   */
  origin: "pack" | "panel";
}

/** 广播「境界关联变了」（同窗口 + 跨窗口各一次，理由同 notifyProtagonistChanged） */
export function notifyRealmLinkChanged(
  workId: string,
  link: PackRealmEventDetail["link"],
  origin: PackRealmEventDetail["origin"],
): void {
  const detail: PackRealmEventDetail = { workId, link, origin };
  window.dispatchEvent(new CustomEvent(PACK_REALM_EVENT, { detail }));
  void window.electronAPI?.windowAPI.broadcast(PACK_REALM_EVENT, detail);
}

// ── 受保护的关闭桥 ──

/**
 * 「关闭请求」的唯一受保护实现，由面板挂载时注册。
 *
 * 为什么要这一层：除了面板自己的关闭按钮，还有三条路径能把它收起来 ——
 * 顶栏「行囊」图标、`Ctrl+Shift+B`、页面级 Esc 优先级链。它们过去都直接
 * `setPackOpen(false)`，绕开了未保存拦截（G-2）与草稿 flush（A5），表现为
 * 「在行囊里改了半天，关掉之后什么都没留下」。
 *
 * 面板是数据主人但状态在页面手里，反过来让页面 import 组件不合适 —— 用桥：
 * 面板注册自己的 `requestClose`，外部一律调用它。
 */
let closer: (() => Promise<void>) | null = null;

/** 面板挂载 / 卸载时调用；同一时刻只允许一个面板（面板形态是唯一的） */
export function registerPackCloser(fn: (() => Promise<void>) | null): void {
  closer = fn;
}

/**
 * 请求关闭行囊面板。**返回 false 表示当前没有面板**（调用方自行兜底关闭）；
 * 返回 true 表示已交给面板处理 —— 它可能不关（有未保存改动时弹拦截）。
 */
export function requestClosePackPanel(): boolean {
  if (!closer) return false;
  void closer();
  return true;
}
