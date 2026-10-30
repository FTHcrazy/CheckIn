/**
 * 行囊配置常量
 *
 * 只放「本模块私有」的常量与出厂值；跨模块复用的（如「当前境界」关系名）
 * 一律从既有配置导入，避免第二份事实源。
 */
import { STORAGE_KEYS } from "@/shared/novel/constants";
import { PACK_MODULES, type PackModuleKey, type PackModuleState } from "./types";

/** 界面偏好落库键（即改即存，不进草稿；与 §8.6.2 的判据一致） */
export const PACK_UI_KEY = STORAGE_KEYS.packUi;

/**
 * 核心模块：对记时最常瞟的三块（总属性汇总 / 人物属性 / 境界）。
 *
 * 这一份清单同时承担两件事，别再在别处写第二份：
 * - 窄档下这三块**不参与自动折叠**（`isAutoCollapsed` 经 `isCorePackModule` 读它）；
 * - 新作品**默认只启用**这三块（本文件的 `DEFAULT_LAYOUTS`、主进程播种、
 *   `mergeLayouts` / `setModuleOrder` 对缺失行的兜底）。
 */
export const CORE_PACK_MODULE_KEYS = ["summary", "attributes", "realm"] as const;

/**
 * 出厂模块布局：顺序即 PACK_MODULES，但**只有核心三块默认启用**。
 *
 * 十个模块的「存在」与顺序照旧（模块管理弹窗里十条都在，仍代表这本小说的
 * 模块拼装），变的只是新书的默认启用态 —— 打开行囊先是一张干净的仪表盘，
 * 其余七块按需打开。「模块管理」的「恢复默认」回写的也是这份值。
 */
export const DEFAULT_LAYOUTS: PackModuleState[] = PACK_MODULES.map((module, index) => ({
  key: module.key,
  enabled: (CORE_PACK_MODULE_KEYS as readonly string[]).includes(module.key),
  sortOrder: index + 1,
}));

/**
 * 界面偏好落库防抖（界面偏好是即改即存，但打字般的连续折叠不应每次都写库）
 */
export const PACK_UI_SAVE_DEBOUNCE_MS = 300;

/**
 * 行囊窗口的三档断点（px，按**窗口内容区宽度**判定）。
 *
 * 行囊是独立窗口、作者边写边对记，所以要能一路缩到 380px 仍可用：
 * - `wide`（≥900）：左栏「装备类」+ 右栏「数值与状态」双栏并排，九模块同屏可达；
 * - `narrow`（<600）：单栏；核心三块（总属性汇总 / 人物属性 / 境界）照常展开，
 *   其余六模块**自动折叠成标题行**（右侧带一句派生摘要），点开才展开。
 * - 600–900 之间：单栏纵向流，全部模块按序展开。
 *
 * 判据用 `contentWidth`（窗口宽度）而不是 `window.innerWidth`：窗口壳自带
 * 边框与内边距，直接读 innerWidth 会把边框算进可用宽度，导致断点在临界值抖动。
 */
export const PACK_WINDOW_BREAKPOINTS = {
  wide: 900,
  narrow: 600,
  /** 窄档下永不折叠的模块（同 CORE_PACK_MODULE_KEYS，见文件顶部） */
  coreModules: CORE_PACK_MODULE_KEYS,
} as const;

/** 判定档位。纯函数，供组件与单测共用同一份规则（不重复实现）。 */
export function packWidthTier(width: number): "wide" | "mid" | "narrow" {
  if (width >= PACK_WINDOW_BREAKPOINTS.wide) return "wide";
  if (width < PACK_WINDOW_BREAKPOINTS.narrow) return "narrow";
  return "mid";
}

/** 该模块在指定档位下是否强制常驻（不接受折叠态）。 */
export function isCorePackModule(key: PackModuleKey): boolean {
  return (PACK_WINDOW_BREAKPOINTS.coreModules as readonly string[]).includes(key);
}

/** 物品列表搜索防抖（B-3：≥20 条时实时过滤，防抖 200ms） */
export const INVENTORY_SEARCH_DEBOUNCE_MS = 200;

/**
 * 物品列表一次挂载多少条（REQ-019 长列表）。
 *
 * 这里**没有用 JS 虚拟列表**（虽然仓库装了 `react-virtuoso`）：虚拟列表要求列表
 * 自己拥有确定高度的滚动容器，而行囊的滚动是整块 `.cpk__body` 一个（十个模块共用
 * 一条滚动条）。改成嵌套滚动之后，「滚到技能模块」会变成「先滚内层再滚外层」，
 * 那不是这个面板想要的交互。
 *
 * 取值 80：低于它的列表完全不出现「显示更多」，也就是绝大多数书的默认路径与
 * 加这个之前**逐字节相同**；超过之后按窗口追加，避免 500 条物品时一次挂载
 * 500 套 antd 输入控件。
 */
export const INVENTORY_RENDER_WINDOW = 80;

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

/** 数量总数上限（只是显示用的大数保护：防止误按长按把数量推到溢出） */
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

// ── 主角名字变更事件 ──

/**
 * 事件名：主角名改了，行囊头部与右侧要素栏/角色卡要一起重画。
 *
 * 名字的**单一事实源是要素库的实体**（见 `PackCharacterDTO.displayName`）：
 * 在行囊里改名 = 改实体名，在要素库改名 = 改同一格。两个入口若互不通知，
 * 就会出现「行囊显示陆长安、要素库还是旧名」这种同屏打架。
 *
 * 与「主角换了」分开两条事件：换主角要重载整份 bundle（境界绑定跟着变），
 * 改名只动一格文字，重载反而会把未保存的编辑冲掉。分开后能按需选轻的那条。
 */
export const PACK_NAME_EVENT = "pack-name-changed";

/** 事件负载：`workId` 用于过滤别的作品；`displayName` 是解析后的最终展示名 */
export interface PackNameEventDetail {
  workId: string;
  displayName: string;
  /**
   * 改名落到哪个实体上（未绑定主角、改的是行囊内那格时为空串）。
   *
   * 监听方靠它**精确定位**要改哪一条要素 —— 不能按名字找：
   * 同名要素是真实存在的（作者常有两个「神秘人」），按旧名匹配会改错人。
   */
  entityId: string;
}

/**
 * 广播「主角名变了」。
 *
 * `origin` 用来避免自己触发自己：行囊自己改的名已经落进文档，不必再走一遍；
 * 要素库改的名则要推给行囊（行囊没有监听实体表的通道）。
 */
export function notifyNameChanged(
  workId: string,
  displayName: string,
  origin: "pack" | "panel",
  /**
   * 落点实体 id。**行囊改名前一定先查过绑定**，故知道是哪个实体；
   * 要素库侧 `updateEntity` 天然就有 id。未绑定时传空串。
   */
  entityId = "",
): void {
  const detail: PackNameEventDetail & { origin: "pack" | "panel" } = {
    workId,
    displayName,
    entityId,
    origin,
  };
  window.dispatchEvent(new CustomEvent(PACK_NAME_EVENT, { detail }));
  void window.electronAPI?.windowAPI.broadcast(PACK_NAME_EVENT, detail);
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

// ── 「先处理后行动」闸门 ──

/**
 * 需要先征询用户的动作。**这是一份白名单，不是给人看的文案** ——
 * 每加一处调用点，都要想清楚「这个动作会不会让未保存的编辑离场」：
 * 会，就必须过闸门；不会，就别加（无缘无故弹拦截比丢数据更烦人）。
 *
 * 历史（P3-1）：这里曾有一对「页面 ↔ 面板」的进程内桥（registerPackGuard /
 * guardPackBeforeAction，外加关闭用的 registerPackCloser / requestClosePackPanel），
 * 供面板还挂在 NovelPage 里的年代做「切章 / 切作品前先问面板」用。行囊拆成
 * 独立窗口后页面与面板分属两个 renderer，页面侧从此没有调用方 —— 桥已删除，
 * 跨窗口的未保存拦截统一由主进程关闭守卫三通道（pack-close-guard.ts：
 * `onCloseRequest` / `respondCloseRequest` + `setCloseGuardEnabled`）裁决。
 */
export type PackGuardReason = "关闭行囊" | "切换章节" | "切换作品" | "退出应用" | "关闭窗口";

// ── 快速记账桥（REQ-027 正文选区 → 记入背包） ──

/** 一次快速记账请求 */
export interface PackQuickAddRequest {
  /** 物品名（取自正文选区，调用方已去空白并截断） */
  name: string;
  /** 分类，缺省「杂物」 */
  category?: string;
  /** 来源章节（正文选区所在的章），展示与导出都要用 */
  chapterId: string;
}

/**
 * 面板挂载时注册的处理器：**同步**返回新建物品 id，失败返回 null。
 *
 * 同步是刻意的：面板那条路径只是往内存文档里 push 一条 + 标脏，没有任何 await；
 * 做成 Promise 会让调用方在「面板开着」这条最快路径上也要挂一次 then。
 */
let quickAdder: ((request: PackQuickAddRequest) => string | null) | null = null;

/** 面板挂载 / 卸载时调用（与 `registerPackCloser` 同生命周期） */
export function registerPackQuickAdd(fn: ((request: PackQuickAddRequest) => string | null) | null): void {
  quickAdder = fn;
}

/**
 * 走面板那条路径记账。返回 `handled: false` 表示**当前没有面板** ——
 * 调用方改用主进程落库（`quickAddPackItem`），而不是当作失败。
 *
 * 为什么必须分两条路：面板开着时数据主人是它的内存文档 + 草稿，直接写库会
 * 与面板的下一份整文档草稿互相覆盖；面板没开时才轮到主进程（且它还得看草稿
 * 在不在，见 `novel-pack-quick-add` 的注释）。
 *
 * `itemId` 是新建物品的 id（面板那条路同步就有；主进程那条路由调用方从 IPC
 * 返回值里拿）。跨窗口合并要靠它定位，见 `PACK_QUICK_ADDED_EVENT`。
 *
 * ⚠️ 拆窗后（P3-1 备案）NovelPage 的调用方与面板分属两个 renderer，
 * `handled` 在编辑器窗口恒为 false、恒落主进程。本地这条「同进程回退」
 * 路径**刻意保留**：未来任何形态把面板重新挂回调用方所在窗口时它能直接
 * 生效，且不需要改调用方（`quickAddPackItem` 的分支天然兜住两种布局）。
 */
export function runPackQuickAdd(request: PackQuickAddRequest): {
  handled: boolean;
  ok: boolean;
  itemId: string | null;
} {
  if (!quickAdder) return { handled: false, ok: false, itemId: null };
  const id = quickAdder(request);
  return { handled: true, ok: id !== null, itemId: id };
}

// ── 快速记账跨窗口合并事件 ──

/**
 * 事件名：**别的渲染进程**替行囊记了一笔账，行囊窗口要把它并进内存文档。
 *
 * 拆窗之后 `runPackQuickAdd` 的本地桥只在面板所在渲染进程里有效 ——
 * 编辑器窗口（NovelWindow）里它永远 `handled: false`，于是记账落主进程
 * （`novel-pack-quick-add`：有草稿并草稿、没有直插正式表）。而行囊窗口
 * 持着自己的内存文档，对这次写入**不知情**：它的下一次整文档保存会连草稿
 * 一起清掉，刚记的物品凭空消失（纯静默的数据丢失）。
 *
 * 所以主进程落库成功后必须广播本事件，行囊窗口按 `itemId` 合并（已存在则
 * 跳过，幂等）。负载形状与其它行囊事件一致：`workId` 过滤别的作品。
 */
export const PACK_QUICK_ADDED_EVENT = "pack-quick-added";

/** 事件负载：`itemId` 指向主进程新建（或并入草稿）的那一条物品 */
export interface PackQuickAddedEventDetail {
  workId: string;
  itemId: string;
}

/** 广播「记账成功，行囊窗口来合并」（同窗口 + 跨窗口各一次，理由同其它事件） */
export function notifyQuickAdded(workId: string, itemId: string): void {
  const detail: PackQuickAddedEventDetail = { workId, itemId };
  window.dispatchEvent(new CustomEvent(PACK_QUICK_ADDED_EVENT, { detail }));
  void window.electronAPI?.windowAPI.broadcast(PACK_QUICK_ADDED_EVENT, detail);
}

// ── 「插入本章末尾」桥（REQ-034） ──

/**
 * 行囊里有几张表（属性 / 物品 / 装备…），作者会想把它们抄进正文。
 *
 * 行囊独立成窗口后与编辑器分属两个 renderer —— 恒走跨窗口广播：
 * NovelPage 订阅 `pack-insert-into-chapter` 频道接收文本并追加到当前章末尾。
 * fire-and-forget：行囊侧无法得知编辑器有没有章可写，失败由编辑器侧提示。
 * 历史（P3-1）：曾有「宿主页面注册的本地桥」优先、广播兜底的双路设计，
 * 拆窗后本地桥再无注册方，已按「别留半座桥」删掉注册入口。
 */

/** 本地恒返回 true（已转投跨窗口广播），失败由编辑器侧提示 */
export function runPackInsertIntoChapter(text: string): boolean {
  void window.electronAPI?.windowAPI.broadcast("pack-insert-into-chapter", text);
  return true;
}
