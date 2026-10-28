/**
 * 选区右键菜单的落位计算（纯函数，不碰 DOM，便于单测）。
 *
 * ## 为什么需要它
 *
 * 菜单是 `.nv-page__stage` 里的绝对定位浮层，而 stage 带 `overflow: hidden`：
 * 一旦菜单底边越过 stage 下沿，**下面的菜单项就被裁掉且无法滚动到**——
 * 表现为「点了右键，底部的『新建资料卡 / 绑定到现有资料卡』根本够不着」。
 *
 * 旧实现在 EditorPane 里按「约 190×320」估算夹取。菜单后来长到接近 500px
 * （文本变换 6 项 + 记入行囊 + 新建资料卡 + 绑定列表），估算值失灵，于是
 * 在靠近正文底部右键时菜单下半截整块被切。
 *
 * 现在改为：组件渲染后**实测自身高度**（含滚动内容），再用本函数把菜单
 * 塞进 stage 可视区——放不下就翻到光标上方，再放不下就压到底部留白处，
 * 连高度都超了才启用 `max-height` 让菜单内部滚动。
 */

/** 菜单与 stage 边缘的最小留白 */
export const CONTEXT_MENU_MARGIN = 8;

export interface Box {
  width: number;
  height: number;
}

export interface PlacementInput {
  /** 期望位置：相对 `.nv-page__stage` 的鼠标坐标 */
  x: number;
  y: number;
  /** 菜单本体实测尺寸（宽度取 offsetWidth，高度取 scrollHeight） */
  menu: Box;
  /** 定位父级（stage）的可视尺寸 */
  stage: Box;
  /** 与 stage 边缘的最小留白，默认 {@link CONTEXT_MENU_MARGIN} */
  margin?: number;
}

export interface Placement {
  left: number;
  top: number;
  /** 菜单比 stage 还高时的可视上限；不需要约束时为 undefined */
  maxHeight?: number;
}

/** 数值夹取：min > max 时以 min 为准，保证结果恒在 [min, max] */
const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max));

/**
 * 计算菜单在 stage 内的最终位置。
 *
 * 顺序：先横后纵。横向只会左右夹取（菜单宽度由内容决定，不收缩）；
 * 纵向优先贴着光标向下展开，下方不够则翻到光标上方，两处都不够才夹到
 * 边缘——此时高度已经超限，整个菜单退化为内部滚动。
 */
export function placeContextMenu(input: PlacementInput): Placement {
  const { x, y, menu, stage } = input;
  const margin = input.margin ?? CONTEXT_MENU_MARGIN;

  // 可视区内能用的宽 / 高（扣掉两侧留白）
  const innerW = Math.max(0, stage.width - margin * 2);
  const innerH = Math.max(0, stage.height - margin * 2);

  // 横向：菜单可能比可视区还宽，夹取时按「能显示出来的宽度」算右边界，
  // 否则 stage.width - margin - menu.width 会算出负数，菜单整体左移出界
  const width = Math.min(menu.width, innerW);
  const left = clamp(x, margin, stage.width - margin - width);

  // 纵向：菜单比可视区还高时，只能力保「顶部可见 + 内部滚动」
  const tooTall = menu.height > innerH;
  const height = tooTall ? innerH : menu.height;
  const maxHeight = tooTall ? innerH : undefined;

  const bottomLimit = stage.height - margin;
  let top: number;
  if (y + height <= bottomLimit) {
    // 下方放得下：原地向下展开（最常见）；仍夹下界，防负坐标顶出 stage
    top = clamp(y, margin, bottomLimit - height);
  } else if (y - height >= margin) {
    // 下方放不下、上方放得下：整体翻到光标上方，保持与光标相邻
    top = y - height;
  } else {
    // 上下都放不下（菜单几乎和 stage 一样高）：夹到底部留白处，顶部对齐
    top = clamp(y, margin, bottomLimit - height);
  }

  return { left, top, maxHeight };
}
