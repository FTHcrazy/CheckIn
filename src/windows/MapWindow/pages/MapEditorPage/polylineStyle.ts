/**
 * 折线样式表（v1 五档，常量 + 纯函数）。
 *
 * ── 为什么是「样式档」而不是「一堆可调参数」──
 * 手绘地图的线有很强的**约定俗成**：官道是深褐双线、小路是碎虚线、河是蓝绿实线、
 * 山脊是带笔刷的细线、国界是红褐长虚。把这些做成"颜色 + 线宽 + 虚线密度"三个
 * 自由滑杆，用户得到的是四万种不像任何一张参考图的组合，还得自己调半天。
 * 给五档、每档自带正确的手感，是这个品类里成熟工具（Wonderdraft / Inkarnate）
 * 一致的做法 —— 它们同样以"预设笔刷"为主、细调为辅（D8 的结论）。
 *
 * ── 为什么是「双层」（深褐 + 米白内描）──
 * 单根纯色线看起来像 CAD 图纸：它在米黄纸面上没有"体积"，也不会与底下的地形
 * 分离。深褐描边 + 米白芯的两笔叠画是手绘地图的通用手法，成本只是多一次 stroke。
 *
 * ── 单位 ──
 * `width` 是**世界单位**（基准图宽 1024）：线随图一起缩放，与区块边界同一口径。
 * 屏幕下限由 `effectiveWidthWorld` 兜底 —— 缩到整图时线会细到 0.1px 而整条消失，
 * 这是"世界单位线宽"最容易踩的坑（PRD §4.3）。
 */

import type { MapPolyline } from "./types";

/** 折线的语义类型（`MapPolyline.kind` 的同义词，避免各处重复写联合类型） */
export type PolylineKind = MapPolyline["kind"];

/** 一档折线样式 */
export interface PolylineStyle {
  /** 样式 id（写进 `MapPolyline.styleId`；**一旦发布不得改名**，老文档认它） */
  id: string;
  /** 面板下拉里的名字 */
  label: string;
  /** 默认服务于哪种语义（`styleId` 缺失 / 非法时按它回退） */
  kind: PolylineKind;
  /** 主色 */
  color: number;
  /** 基准线宽（世界单位） */
  width: number;
  /**
   * 内描（亮色芯）：`width` 比主线窄，画在主色之上形成"双线"观感。
   * 缺省 = 单线（河流、山脊、界线都不加芯，否则会糊成一团彩色）。
   */
  casing?: { color: number; width: number };
  /**
   * 虚线节奏 `[实, 虚]`，单位是**线宽的倍数**（不是绝对长度）。
   *
   * 用倍数而不是绝对长度，是为了让虚线随线宽/缩放一起伸缩：一条 2 单位宽的
   * 小路，实段 3 倍宽（6 单位）才读得出"碎"，而 5 单位宽的官道若用绝对 6 单位，
   * 虚线会密得像毛边。
   */
  dash?: readonly [number, number];
  /** 两端渐隐（势力边界用：边界是一条"渐弱"的带，不是一根硬线头） */
  fadeEnds?: boolean;
  /**
   * 沿线变宽（B4-3，河流用）：起点/终点的线宽是基准宽的倍数，中间按**弧长**
   * 线性插值 —— "源头细、入海粗"，笔顺即水流方向。
   *
   * 【为什么只有 from/to 两个数】Wonderdraft 的河流笔刷同样只给"从多细到多粗"；
   * 中途忽细忽粗的河在自然界不存在，给自由曲线只会得到不像河的东西。
   * 闭合线不吃 taper（一条首尾相接的河没有"哪头是海"）。
   */
  taper?: { from: number; to: number };
  /**
   * 一侧影线笔刷（B4-3，山脊用）：沿路径每隔一段在**同一侧**戳一根垂直短线，
   * 长短交替 —— 传统地图山脊阴影（hachure）的极简版，让脊线读作"笔刷"
   * 而不是一根铁丝。
   *
   * 【为什么固定一侧、不做纹理贴图】影线的意义在"长短交替的节奏"，不在贴图；
   * 贴图笔刷（Wonderdraft 的 textured path）要管理素材对齐、接缝与缩放，
   * 是另一个数量级的工程（PRD §7 的同一逻辑：先给语义正确的便宜方案）。
   */
  hatch?: {
    /** 影线颜色（通常比主线更深一档） */
    color: number;
    /** 影线粗细，倍数于实际线宽 */
    widthScale: number;
    /** 相邻影线的间距，倍数于实际线宽 */
    spacingScale: number;
    /** 影线长度 `[长, 短]`，倍数于实际线宽（沿弧长交替取用） */
    lengthScale: readonly [number, number];
    /** 影线透明度（相对该样式 `alpha` 的倍数；缺省 1） */
    alpha?: number;
  };
  /** 该样式的透明度上限（河流略微透出河床；缺省 1） */
  alpha?: number;
  /** 面板 tooltip：一句话说清"什么时候用它" */
  hint: string;
}

/** 默认样式（新画的线都用它） */
export const DEFAULT_POLYLINE_STYLE_ID = "road-main";

/** 五档样式表（顺序即面板下拉顺序） */
export const POLYLINE_STYLES: readonly PolylineStyle[] = [
  {
    id: "road-main",
    label: "官道",
    kind: "road",
    color: 0x5c4128,
    width: 5,
    casing: { color: 0xf3e7cd, width: 2.4 },
    hint: "深褐双线：城与城之间的主路",
  },
  {
    id: "road-trail",
    label: "小径",
    kind: "road",
    color: 0x6d4f34,
    width: 2.4,
    dash: [3, 2.4],
    hint: "碎虚线：山径、村道这类「不保证能走车」的路",
  },
  {
    id: "river",
    label: "河流",
    kind: "river",
    color: 0x2f6f7d,
    width: 3.6,
    alpha: 0.92,
    // 源头约 1/3 宽，入海口足宽：落笔的顺序就是水流的方向
    taper: { from: 0.35, to: 1 },
    hint: "蓝绿实线、源头细入海粗：从源头往入海口画（笔顺即流向）",
  },
  {
    id: "ridge",
    label: "山脊",
    kind: "ridge",
    color: 0x4a3524,
    width: 2.6,
    alpha: 0.86,
    hatch: {
      color: 0x38281a,
      widthScale: 0.5,
      spacingScale: 2.4,
      lengthScale: [1.9, 3.2],
      alpha: 0.75,
    },
    hint: "脊线 + 一侧山影笔刷：沿山脉走向从一头画到另一头",
  },
  {
    id: "border",
    label: "势力边界",
    kind: "border",
    color: 0x8a3a2c,
    width: 3,
    dash: [4, 2.6],
    fadeEnds: true,
    hint: "红褐长虚线、两端渐隐：国界 / 势力范围",
  },
];

/**
 * 屏幕最小线宽（像素）。
 *
 * 【为什么必须有】线宽是世界单位：整图缩放 0.34 时一条 5 单位的官道只有
 * 1.7px（还行），但一条 2.4 单位的小径只有 0.8px —— 再缩小一点就整条消失，
 * 用户会认为"线没画上"。0.75px 是肉眼仍能读出连续线的下限。
 */
export const POLYLINE_MIN_SCREEN_PX = 0.75;

/**
 * 命中测试在"线宽"之外额外放宽的屏幕像素（PRD §4.5：`线宽/2 + 6px`）。
 *
 * 【为什么不直接用线宽】一条 2.4 世界单位的小径，在整图缩放下只有 1px ——
 * 要求用户把鼠标点进 1px 才算选中，等于这条线"选不中"。6px 是手指/触控板
 * 仍能精确落点的上限，也是本项目素材命中与子区块草稿共用的一档手感。
 */
export const POLYLINE_PICK_PAD_PX = 6;

/** 线宽的可调倍数区间（属性面板滑杆） */
export const POLYLINE_WIDTH_SCALE_MIN = 0.5;
export const POLYLINE_WIDTH_SCALE_MAX = 2.5;

/**
 * 取样式：先按 `styleId` 精确找，找不到按 `kind` 回退，再不行用第一档。
 *
 * 【为什么允许回退而不是抛错】`styleId` 是**字符串字段**，老文档 / 手改 JSON /
 * 未来删掉某一档都会留下非法值。渲染层为一条线的样式崩掉整张图是不可接受的 ——
 * 退化成"最像的那一档"即可，而且用户能立刻看出"样式不对"再改回来。
 */
export function polylineStyleOf(styleId: string | undefined, kind: PolylineKind): PolylineStyle {
  const byId = styleId ? POLYLINE_STYLES.find((s) => s.id === styleId) : undefined;
  if (byId) return byId;
  const byKind = POLYLINE_STYLES.find((s) => s.kind === kind);
  return byKind ?? POLYLINE_STYLES[0];
}

/** 某一类语义的默认样式（新建线时用 `kind` 定初值） */
export function defaultStyleIdOf(kind: PolylineKind): string {
  return POLYLINE_STYLES.find((s) => s.kind === kind)?.id ?? DEFAULT_POLYLINE_STYLE_ID;
}

/**
 * 实际绘制用的线宽（**世界单位**）。
 *
 * @param scale 当前视口缩放（世界 → 屏幕的倍数）
 *
 * 两步：先乘用户倍数（属性面板的滑杆），再用屏幕下限兜底。下限换算成世界单位是
 * `MIN_PX / scale` —— 缩小得越狠，世界单位的下限越大，正好抵消。
 */
export function effectiveWidthWorld(
  style: PolylineStyle,
  widthScale: number | undefined,
  scale: number,
  minScreenPx: number = POLYLINE_MIN_SCREEN_PX,
): number {
  const scaleK = Number.isFinite(widthScale) && widthScale && widthScale > 0 ? widthScale : 1;
  const world = style.width * scaleK;
  const floor = minScreenPx / Math.max(1e-6, scale);
  return Math.max(world, floor);
}

/**
 * 虚线节奏换算成世界单位长度。
 *
 * 以**实际线宽**为基准（含屏幕下限），于是"缩到很远"时线与虚段一起被下限撑大，
 * 不会出现"线是 0.75px、虚段是 0.2px"这种碎成一团灰的观感。
 */
export function dashLengthsOf(
  style: PolylineStyle,
  widthWorld: number,
): readonly [number, number] | null {
  if (!style.dash) return null;
  return [style.dash[0] * widthWorld, style.dash[1] * widthWorld];
}
