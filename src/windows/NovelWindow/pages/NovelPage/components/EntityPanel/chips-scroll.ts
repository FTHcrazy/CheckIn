/**
 * 类型 chips 行「把选中项滚到行中间」的位移计算（W-08 的滚动细节）
 *
 * 这里是**真居中**：切到哪个分类，那颗 chip 就停在可视区正中，左右各露出
 * 半颗邻项 —— 既说明「两边还有内容」，也让手指/鼠标落在中间最容易点到。
 * 首尾两端由调用方的 clamp（`0 ~ scrollWidth - clientWidth`）兜住，滚不动
 * 时自然贴边，不会被居中算成负值。
 *
 * 抽成纯函数是因为 jsdom 没有布局：组件里读到的矩形全是 0，只有把判定
 * 拿到外面才测得到「居中 = 芯片中心对齐容器中心」。
 */
export interface ChipRect {
  left: number;
  right: number;
}

/** 位移量（正数=向右滚）。`0` 表示已经在正中，不要动。 */
export function resolveChipsScrollDelta(row: ChipRect, chip: ChipRect): number {
  const chipCenter = (chip.left + chip.right) / 2;
  const rowCenter = (row.left + row.right) / 2;
  return chipCenter - rowCenter;
}
