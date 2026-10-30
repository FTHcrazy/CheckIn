/**
 * 画布信息密度（S4 / W-16 配套，原产 §五 D3 ① 的改写版）
 *
 * 为什么单独一层纯函数：密度是**渲染策略**，但它决定「看不看得见名字」这种
 * 产品可判定的事（RG-I-39 / 40a）。埋在 JSX 的 `if (count > 200)` 里就只能靠
 * 目测验收，而这里的每一档都能被单测逐字钉住。
 *
 * 与原四档（120 / 200 / 400 / 800）的关系：
 * - 原档位是按「pill 节点」标定的；v2.2 把节点改成约 190×36 的紧凑卡，
 *   卡片面积是 pill 的 1.5~2 倍，四个边界整体前移到 **60 / 200 / 400**；
 * - 原「121–400 隐角标 + 名称 6 字截断」与「401+ 只画色点」之间还夹着一档
 *   （原 200–400 与 401–800 的差别只剩边透明度），落在紧凑卡上肉眼看不出差别，
 *   因此合并为三档（delta §6 已写明「可简化为两档/三档」）。
 *
 * 阈值口径：**按上图成员数（`doc.nodes.length`）算，不按筛选后的可见数**。
 * 否则用户在池子里点一下类型筛选就会把整张图的密度换掉 —— 而筛选只该改
 * 「哪些淡出」，不该改「画多少信息」（④ 三数字同一条口径）。
 */

/** 三档信息密度：完整卡 / 紧凑卡 / 只画点 */
export type GraphDensity = "full" | "compact" | "minimal";

export const DENSITY_THRESHOLDS = {
  /** 超过这个数开始隐类型角标 + 名称截断 */
  compact: 60,
  /** 超过这个数只画色点与边（文字只在悬停/选中时出现） */
  minimal: 200,
  /** 超过这个数常驻「要素较多，已简化显示」提示条 */
  notice: 400,
} as const;

/** 紧凑档名称截断长度（按码点算，「林晚」是 2 个字） */
export const COMPACT_NAME_CHARS = 6;

export interface DensityPlan {
  level: GraphDensity;
  /** 是否画类型角标（chip） */
  showTypeChip: boolean;
  /** 是否画名称；false = 只画色点（悬停时靠 title 给全名） */
  showName: boolean;
  /** 名称截断到几个字；0 = 不截断（CSS ellipsis 兜底） */
  nameMaxChars: number;
  /** 边的透明度（档位越低越淡，避免一屏糊成一片） */
  edgeOpacity: number;
  /** 边的线宽（选中态另加粗） */
  edgeWidth: number;
  /** 是否常驻画关系名标签 */
  showEdgeLabel: boolean;
  /** 常驻提示条文案；null = 不显示 */
  notice: string | null;
}

const FULL: Omit<DensityPlan, "level" | "notice"> = {
  showTypeChip: true,
  showName: true,
  nameMaxChars: 0,
  edgeOpacity: 1,
  edgeWidth: 1.2,
  showEdgeLabel: true,
};

const COMPACT: Omit<DensityPlan, "level" | "notice"> = {
  showTypeChip: false,
  showName: true,
  nameMaxChars: COMPACT_NAME_CHARS,
  edgeOpacity: 0.65,
  edgeWidth: 1,
  showEdgeLabel: true,
};

const MINIMAL: Omit<DensityPlan, "level" | "notice"> = {
  showTypeChip: false,
  showName: false,
  nameMaxChars: 0,
  edgeOpacity: 0.4,
  edgeWidth: 1,
  showEdgeLabel: false,
};

/**
 * 按上图节点数取密度档。
 *
 * 注意：**不做降级动作、不动节点集合**——401 起只降信息密度（RG-I-39 的关键
 * 断言是「可见节点数 === 总节点数」）。真正的减法只有用户的显式动作
 * （拖回池子 / 「精简上图」），不存在按度数裁剪。
 */
export function resolveDensity(nodeCount: number): DensityPlan {
  const count = Number.isFinite(nodeCount) ? Math.max(0, Math.floor(nodeCount)) : 0;
  const base =
    count > DENSITY_THRESHOLDS.minimal
      ? { level: "minimal" as const, ...MINIMAL }
      : count > DENSITY_THRESHOLDS.compact
        ? { level: "compact" as const, ...COMPACT }
        : { level: "full" as const, ...FULL };

  return {
    ...base,
    notice: count > DENSITY_THRESHOLDS.notice ? "要素较多，已简化显示" : null,
  };
}

/** 按码点截断（`String.prototype.slice` 会切坏 emoji 与部分生僻字） */
export function truncateName(name: string, maxChars: number): string {
  const chars = Array.from(name);
  if (maxChars <= 0 || chars.length <= maxChars) return name;
  return `${chars.slice(0, maxChars).join("")}…`;
}

/** 该档位下这张卡要显示的文本（空串 = 只画色点） */
export function nodeLabelOf(name: string, plan: DensityPlan): string {
  if (!plan.showName) return "";
  return truncateName(name, plan.nameMaxChars);
}
