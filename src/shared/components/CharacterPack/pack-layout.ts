/**
 * 行囊窗口的「分区仪表盘」布局编排（纯函数）
 *
 * 行囊从侧边栏升级为独立窗口后，十个模块不再是一条长滚动，而是按语义分栏、
 * 并按窗口宽度分档降级。这里集中放**与渲染无关**的编排规则：
 * 哪个模块属于哪一栏、窄档下哪些模块要折叠、折叠行右侧那句摘要怎么算。
 *
 * 抽成纯函数的理由（AGENTS.md §6.2「逻辑归位」+ §6.6「可测性优先」）：
 * 分栏与档位判定是这个界面的骨架，散在组件里就变成「改一处漏一处」；
 * 而且它们在 jsdom 里没有真实布局可测，只有做成参数进结果出的纯函数才钉得住。
 */
import { isCorePackModule } from "./pack-config";
import type { PackDoc } from "./hooks/usePackData";
import type { PackModuleKey, PackModuleState } from "./types";

/** 内容区的语义分区。宽档下左栏放「装备类」，右栏放「数值与状态类」。 */
export type PackZone = "gear" | "stats";

/**
 * 模块 → 分区的映射（唯一事实源）。
 *
 * 依据是「作者改一样东西时另一只手在干什么」：
 * - 装备 / 物品 / 技能是**同一类操作**（挑一件东西、装配、开开关），放一栏，
 *   视线不需要横跨整屏；
 * - 汇总 / 属性 / 映射 / 境界 / 数值 / 状态 / 备注都是**读数或定义**，放另一栏。
 *
 * 属性映射归 stats 而不是 gear：它回答的是「这个数是怎么来的」，
 * 与属性定义是一件事的两半（所以紧挨着属性放）。
 *
 * 用 `satisfies` 而不是注释约定：新增模块时漏登记会被类型检查直接拦下。
 */
export const PACK_ZONE_OF = {
  equipment: "gear",
  inventory: "gear",
  skills: "gear",
  summary: "stats",
  attributes: "stats",
  mapping: "stats",
  realm: "stats",
  currency: "stats",
  status: "stats",
  note: "stats",
} satisfies Record<PackModuleKey, PackZone>;

/**
 * 宽档下两栏的**左右落位**（唯一事实源）。
 *
 * 左栏放「数值与状态」而不是「装备类」：左上是视线的起点，而作者开行囊第一眼
 * 找的是属性汇总 / 人物属性 / 境界这三块（新书出厂也只有这三块）—— 把它们放在
 * 左栏第一屏，装备 / 物品 / 技能这些「按需翻下去」的放右栏。
 *
 * 宽度配比跟着内容走：装备类是「部位名 + 按钮 / 物品行 + 数量 + 按钮」这类长行，
 * 给窄了会挤成两行；数值类多是「标签 : 数值」的短行，窄一点无妨 —— 所以右栏
 * （装备类）反而更宽（44 : 56）。样式层 `&__zones` 与这里必须同序。
 */
export const PACK_ZONE_ORDER: readonly PackZone[] = ["stats", "gear"];

/** 分区标题（宽档两栏各顶一个眉标） */
export const PACK_ZONE_LABEL: Record<PackZone, string> = {
  gear: "装备类",
  stats: "数值与状态",
};

/**
 * 仪表盘展示顺序：核心三块（汇总 / 属性 / 境界）**恒在最前**，其余模块按
 * 作者的排序跟在后面（两段各自保持相对顺序，稳定分区）。
 *
 * 为什么不纯按 `sortOrder`：存量书的布局顺序里核心三块可能排在末尾（老版本
 * 播种 / 作者拖过），每新开一个模块它就插在核心三块上面，把主内容越顶越深 ——
 * 行囊第一屏永远该是这三块。代价是仪表盘里核心三块**拖不动**（模块管理里
 * 拖了也不影响它们在仪表盘的落位），这是「钉顶」的题中之义。
 */
export function coreFirstOrder(modules: PackModuleState[]): PackModuleState[] {
  const core: PackModuleState[] = [];
  const rest: PackModuleState[] = [];
  for (const module of modules) {
    (isCorePackModule(module.key) ? core : rest).push(module);
  }
  return [...core, ...rest];
}

/**
 * 依当前**启用且排序后**的模块清单，拆成两栏。
 *
 * 保持各自原有的相对顺序（作者在模块管理里拖出来的顺序必须被尊重），
 * 只是按分区归堆 —— 不能重排成固定顺序，否则拖拽排序会在宽档下看似失效。
 */
export function splitByZone(
  modules: PackModuleState[],
): Record<PackZone, PackModuleState[]> {
  const gear: PackModuleState[] = [];
  const stats: PackModuleState[] = [];
  for (const module of modules) {
    if (PACK_ZONE_OF[module.key] === "gear") gear.push(module);
    else stats.push(module);
  }
  return { gear, stats };
}

/**
 * 宽档下真正要渲染的分区：一个启用模块都没有的分区**整个不渲染**。
 *
 * 新书出厂只开核心三块（汇总 / 属性 / 境界），全在 stats 栏 —— 若照旧渲染
 * 空的 gear 栏，左半窗只剩一个孤零零的「装备类」眉标，画面六成是死空间。
 * 空分区退场后，剩下一栏由样式层（`--solo`）居中收窄，整版只有一个视觉重心。
 */
export function activeZones(split: Record<PackZone, PackModuleState[]>): PackZone[] {
  return PACK_ZONE_ORDER.filter((zone) => split[zone].length > 0);
}

/**
 * 唯一渲染分区的**对面栏**（被整体关掉的那栏），宽档下用一张引导卡替它占位，
 * 作者才知道行囊还有可开未开的模块。双栏都在（或全空，上游已有整版空态）时
 * 返回 null —— 双栏并排时引导卡反而是噪音。
 */
export function missingZoneOf(active: PackZone[]): PackZone | null {
  if (active.length !== 1) return null;
  return active[0] === "gear" ? "stats" : "gear";
}

/**
 * 该模块是否**自动收成摘要行**（UI-04 渐进披露）。
 *
 * 改革前的规则只在窄档生效（「窄档下未表态的次要模块自动折叠」），宽 / 中档
 * 十模块全摊开 —— 作者开行囊第一屏被编辑控件淹没，「一屏看懂主角状态」做不到。
 * UI-04 把默认态改成**全档一致**：非核心模块默认就是摘要行，点击就地展开。
 *
 * 四条规则，缺一不可：
 * 1. **钉选优先**：`pinned` 里的模块永不自动收起（作者已表态「这个常开」）；
 * 2. 核心三块（汇总 / 属性 / 境界）永不折叠 —— 它们是对记时最常瞟的；
 * 3. 其余模块**跟随作者的显式折叠偏好**：作者手动开合过的，按作者的值来；
 * 4. 作者**没表态过**（`authored[key]` 为 undefined）的其余模块，默认折叠成
 *    摘要行 —— 这是「渐进披露」的题中之义。
 *
 * ⚠️ 规则 4 只影响**未表态**的模块，不覆盖作者手动展开过的（否则作者怎么点都
 * 展不开）。作者一旦手动操作过，那个值就进了 `prefs.collapsed`，规则 3 接管。
 */
export function isAutoCollapsed(
  key: PackModuleKey,
  tier: "wide" | "mid" | "narrow",
  authored: Partial<Record<PackModuleKey, boolean>>,
  pinned: readonly PackModuleKey[] = [],
): boolean {
  // 规则 1：钉选常驻 —— 高于一切折叠策略
  if (pinned.includes(key)) return false;
  // 规则 2：核心三块永不折叠（任何档位）
  if (isCorePackModule(key)) return false;
  // 规则 3：作者显式表态过的，一律从作者
  if (authored[key] !== undefined) return Boolean(authored[key]);
  // 规则 4：未表态的非核心模块，默认收成摘要行（全档一致）
  // tier 仍参与签名以便未来按档微调，但当前默认策略与档位无关。
  void tier;
  return true;
}

/**
 * 折叠行右侧的一句摘要（派生值，不是存下来的数据）。
 *
 * 窄档下十个模块压成十行，光看标题作者分不清「物品栏是不是空的」——
 * 摘要就是用来回答这个的。全部取**已有的派生量**，不新增统计口径：
 * 数得出来就写，数不出来就返回空串（不编）。
 *
 * 数据来源说明（易踩坑）：
 * - 物品「件数」用 `qty` 求和，不是条目数 —— 作者关心的是「还剩几颗丹药」；
 * - 货币**没有余额字段**（正文里写金额，面板只做换算），所以这里不改口径、
 *   只报「进制有没有配好」，不去编一个不存在的余额；
 * - 备注存在 `character.note` 上，不是 doc.note。
 */
export function moduleSummary(
  key: PackModuleKey,
  doc: PackDoc | null,
): string {
  if (!doc) return "";
  switch (key) {
    case "equipment": {
      // 槽位在 doc.slots 里是「部位定义」，是否已穿戴要看物品有没有落到该部位
      const filled = new Set(
        doc.items
          .filter((item) => item.equippedSlotId)
          .map((item) => item.equippedSlotId),
      );
      return `${doc.slots.length} 部位 · ${filled.size} 已穿戴`;
    }
    case "inventory": {
      const kinds = doc.items.length;
      const total = doc.items.reduce((sum, item) => sum + (item.qty || 0), 0);
      return kinds > 0 ? `${kinds} 种 · 共 ${total} 件` : "空";
    }
    case "skills": {
      const on = doc.skills.filter((skill) => skill.enabled).length;
      return doc.skills.length > 0
        ? `${doc.skills.length} 项 · ${on} 启用`
        : "暂无技能";
    }
    case "currency": {
      // 面板不持有余额：只说明进制有没有配置好，避免编造不存在的「余额」口径。
      // 货币身份藏在 config JSON 的 `use` 字段里（kind 只表示换算模型），
      // 与 usePackPanel 的 unitSystemOf 保持同一判据。
      const configured = doc.unitSystems.some((unit) => {
        try {
          const config = JSON.parse(unit.config || "{}") as { use?: string };
          return config.use === "currency";
        } catch {
          return false;
        }
      });
      return configured ? "已配置" : "未配置";
    }
    case "status": {
      const active = doc.modifiers.filter(
        (mod) => mod.ownerType === "status" && mod.active,
      ).length;
      return active > 0 ? `${active} 项生效` : "无生效中";
    }
    case "mapping": {
      // 系数为 0 的那几条等于「停用」，别混进「N 条换算」里 —— 摘要说「3 条换算」
      // 而面板上只有 2 条在动，作者会以为哪条坏了
      const live = doc.mappings.filter((mapping) => mapping.rate !== 0).length;
      if (doc.mappings.length === 0) return "暂无换算";
      return live === doc.mappings.length
        ? `${live} 条换算`
        : `${live} / ${doc.mappings.length} 条换算`;
    }
    case "note": {
      const length = doc.character.note.trim().length;
      return length > 0 ? `${length} 字` : "空白";
    }
    // 核心三块在窄档不折叠，摘要用不上
    default:
      return "";
  }
}

/* ────────────────────────── UI-01 看板（L0）编排 ────────────────────────── */

/**
 * C 区「核心属性总览」默认展示条数（随档位）。
 *
 * 首屏是「一眼看懂」，条数太多会把 D / E 区挤出首屏。宽档给 8 条、中档 6、窄档 4；
 * 其余属性由「展开全部」放出 —— 不删能力，只是默认收敛。
 */
export function dashboardAttrLimit(tier: "wide" | "mid" | "narrow"): number {
  if (tier === "wide") return 8;
  if (tier === "narrow") return 4;
  return 6;
}

/**
 * E 区「关键设定」摘要行 = **当前启用的全部模块**。
 *
 * 为什么连核心三块（汇总 / 属性 / 境界）也列进来：A/B/C 只给只读速览，而
 * 十模块的编辑能力必须一条不少（G-04）。把它们留成摘要行，作者仍能一键进
 * L1 编辑器 —— 看板负责「看」，摘要行负责「改」，职责分开但入口不缺。
 *
 * 顺序沿用 `api.enabledModules`（含作者的拖拽排序）；不在这里重排，
 * 否则模块管理里拖出来的顺序在 E 区会看似失效。
 */
export function dashboardSummaryModules(modules: PackModuleState[]): PackModuleState[] {
  return modules;
}

/**
 * D 区「生效状态」：只列**当前生效**的状态效果（`active === true`）。
 *
 * 不生效的不看板上出现 —— 看板回答的是「主角现在中了什么」，未开启的持续性
 * 效果是「可能发生」而不是「正在发生」，混在一起会让作者误判当前处境。
 * 全部状态仍可在 L1 的「状态效果」模块里开合。
 */
export function dashboardActiveStatuses<T extends { ownerType: string; active: boolean }>(
  modifiers: readonly T[],
): T[] {
  return modifiers.filter((mod) => mod.ownerType === "status" && mod.active);
}

