/**
 * 类型 chips 行「保证选中项完整可见」的位移计算（W-08 的滚动细节）
 *
 * 这里刻意**不做居中**：居中虽然好看，但会把左邻 chip 推到容器外、只剩半颗
 * （用户看到的就是「第一个分类 tab 被切成一半」）。只回答一个问题：
 * 选中的那颗有没有被左右边缘遮住？遮住了就挪到刚好整颗可见，留 8px 呼吸位。
 *
 * 抽成纯函数是因为 jsdom 没有布局：组件里读到的矩形全是 0，只有把判定
 * 拿到外面才测得到「被遮住 → 挪最小距离」「没被遮住 → 一像素都不动」。
 */
export interface ChipRect {
  left: number;
  right: number;
}

/** 位移量（正数=向右滚）。`0` 表示选中项已经完整可见，不要动。 */
export function resolveChipsScrollDelta(
  row: ChipRect,
  chip: ChipRect,
  gap = 8,
): number {
  const leftEdge = row.left + gap;
  const rightEdge = row.right - gap;
  if (chip.left < leftEdge) return chip.left - leftEdge;
  if (chip.right > rightEdge) return chip.right - rightEdge;
  return 0;
}
