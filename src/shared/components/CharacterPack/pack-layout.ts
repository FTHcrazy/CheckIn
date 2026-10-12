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

/** 分区标题（宽档两栏各顶一个眉标） */
export const PACK_ZONE_LABEL: Record<PackZone, string> = {
  gear: "装备类",
  stats: "数值与状态",
};

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
 * 窄档下该模块是否**自动折叠成标题行**。
 *
 * 三条规则，缺一不可：
 * 1. 核心三块（汇总 / 属性 / 境界）永不折叠 —— 它们是对记时最常瞟的，任何宽度都留着；
 * 2. 其余模块**跟随作者的显式折叠偏好**：作者自己折叠过的，窄档保持折叠；
 * 3. 作者**没表态过**（`prefs.collapsed[key]` 为 undefined）的其余模块，
 *    窄档下默认折叠 —— 这正是「自动折叠成标题行」要的效果。
 *
 * ⚠️ 与「作者偏好」的区别很关键：规则 3 只影响**未表态**的模块，不覆盖作者
 * 手动展开过的（否则窄档下作者怎么点都展不开）。作者一旦手动操作过，
 * 那个值就进了 `prefs.collapsed`，规则 2 接管。
 */
export function isAutoCollapsed(
  key: PackModuleKey,
  tier: "wide" | "mid" | "narrow",
  authored: Partial<Record<PackModuleKey, boolean>>,
): boolean {
  if (tier !== "narrow") return Boolean(authored[key]);
  if (isCorePackModule(key)) return false;
  return authored[key] ?? true;
}

/**
 * 顶部概览带的两个读数（派生值，不是存下来的数据）。
 *
 * 设计稿把「负重 / 容量」两个读数并排放在头部中央 —— 它们回答的是
 * 「这一趟盘完没有」：负重超没超、格子还剩几格。二者在 `usePackPanel`
 * 里都已有派生量（`load`），这里只做**格式化**，不新增统计口径。
 *
 * 曾经还有第三个「技能」读数（N 项 · N 启用），但它与技能模块自身的
 * 摘要（`moduleSummary("skills")`）完全同源 —— 同一份信息不该在头部
 * 和模块里各说一遍，头部让位后整条概览带也少一分密度。
 *
 * 为什么把格式化也抽成纯函数：`limit === 0` 表示「不限」，此时要显示 `—`
 * 而不是 `0/0`（后者像一个「0 容量」的错误读数）；超限要变色。这两条规则
 * 散在 JSX 里就变成两处 `? :` 嵌套，测不到也改不动。
 */
export interface PackHeaderReading {
  /** 读数标签（负重 / 容量） */
  label: string;
  /** 主读数，如 `128 / 200` 或 `18 / 30 格` */
  value: string;
  /** 超限 / 超载标记：为真时头部按告警配色 */
  alert: boolean;
  /** 无上限或未配置时的补充说明（显示在读数下方） */
  hint: string;
}

/** headerReadings 的入参：与 usePackPanel 的 load 派生量同形 */
export interface PackHeaderReadingsInput {
  load: {
    weight: { total: number; limit: number; over: boolean };
    capacity: { used: number; limit: number; full: boolean };
  };
}

export function headerReadings(
  key: "weight" | "capacity",
  input: PackHeaderReadingsInput,
): PackHeaderReading {
  switch (key) {
    case "weight": {
      const { total, limit, over } = input.load.weight;
      // limit 为 0 = 作者没设上限：显示实重但不给分母，避免「/0」这种假读数
      return {
        label: "负重",
        value: limit > 0 ? `${formatNumber(total)} / ${formatNumber(limit)}` : formatNumber(total),
        alert: over,
        hint: limit > 0 ? "" : "未设上限",
      };
    }
    case "capacity": {
      const { used, limit, full } = input.load.capacity;
      return {
        label: "容量",
        value: limit > 0 ? `${used} / ${limit} 格` : `${used} 格`,
        alert: full,
        hint: limit > 0 ? "" : "未设上限",
      };
    }
  }
}

/**
 * 千分位。重量可能是 `1280.5` 这种，整数部分分组、小数原样保留。
 *
 * 不引 `Intl.NumberFormat`：它要过一遍 locale 解析，而这个面板每敲一个字
 * 都要重算一次读数，没必要为「128 / 200」这种短数字付那份开销。
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 100) / 100;
  const [intPart, decimalPart] = String(rounded).split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decimalPart ? `${grouped}.${decimalPart}` : grouped;
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
