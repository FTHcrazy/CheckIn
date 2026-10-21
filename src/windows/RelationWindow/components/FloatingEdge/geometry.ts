/**
 * 浮动边的几何计算（纯函数，无 DOM、无随机、可单测）。
 *
 * 传统 React Flow 边从「固定手柄」连出：两节点上下错位时，曲线控制点仍按固定侧
 * （左/右）取方向，于是会绕出截图里那种大回环。这里改为「沿两节点中心连线」求
 * 节点边框交点 —— 连线的起点/终点始终落在两节点彼此最接近的那条边上，再交给
 * bezier 曲线，就是 XMind 那种自然、不绕路的短线。
 *
 * 刻意不引 @xyflow/system 的 `getBoundsOfRects`：本文件的矩形边框相交只有 20 行，
 * 直接写成纯函数更好单测、也不依赖内部类型。
 */
import { Position } from "@xyflow/react";

/** 节点在画布坐标系里的绝对矩形（左上角 + 尺寸） */
export interface NodeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface XYPoint {
  x: number;
  y: number;
}

/** 一条浮动边所需的全部端点参数（起点 / 终点 + 各自出边方向） */
export interface FloatingEdgeParams {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  sourcePos: Position;
  targetPos: Position;
}

/**
 * 从 `from` 的中心朝 `to` 的中心引一条射线，求它与 `from` 矩形边框的交点。
 *
 * 这是「最近侧自然连出」的核心：交点必然落在 `from` 朝向 `to` 的那条边上。
 * 用「到左右边 / 到上下边的缩放系数取较小者」实现矩形边框的射线相交，
 * 比「先判象限再按边算」少一堆 if，且角点方向自然落到某一侧。
 */
export function intersectRectFromCenter(from: NodeRect, to: NodeRect): XYPoint {
  const halfW = Math.max(from.width, 0) / 2;
  const halfH = Math.max(from.height, 0) / 2;
  const fromCx = from.x + halfW;
  const fromCy = from.y + halfH;
  const toCx = to.x + to.width / 2;
  const toCy = to.y + to.height / 2;

  const dx = toCx - fromCx;
  const dy = toCy - fromCy;

  // 中心重合时没有方向可言：退回右缘中点，避免除零
  if (dx === 0 && dy === 0) {
    return { x: fromCx + halfW, y: fromCy };
  }

  const tx = dx !== 0 ? halfW / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const ty = dy !== 0 ? halfH / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const t = Math.min(tx, ty);

  // 理论上不可达（宽高 > 0 时 t 必有限），兜底回中心
  if (!Number.isFinite(t)) {
    return { x: fromCx, y: fromCy };
  }
  return { x: fromCx + dx * t, y: fromCy + dy * t };
}

/**
 * 判断点落在矩形的哪条边上（用于给 bezier 曲线选控制点方向）。
 *
 * 用「到四条边距离取最小」而不是阈值比较：浮点下更稳。角点（两条边距离同为 0）
 * 按 左 > 右 > 上 > 下 的顺序兜底，任选一侧对曲线形状影响可忽略。
 */
export function edgePositionOf(rect: NodeRect, point: XYPoint): Position {
  const distLeft = point.x - rect.x;
  const distRight = rect.x + rect.width - point.x;
  const distTop = point.y - rect.y;
  const distBottom = rect.y + rect.height - point.y;
  const min = Math.min(distLeft, distRight, distTop, distBottom);

  if (min === distLeft) return Position.Left;
  if (min === distRight) return Position.Right;
  if (min === distTop) return Position.Top;
  return Position.Bottom;
}

/**
 * 一条边两端的完整参数：`source` 朝 `target` 的出点、`target` 朝 `source` 的出点。
 * 两个交点分别落在两节点「相向」的边上，曲线从此自然进出。
 */
export function getFloatingEdgeParams(
  source: NodeRect,
  target: NodeRect,
): FloatingEdgeParams {
  const sourcePoint = intersectRectFromCenter(source, target);
  const targetPoint = intersectRectFromCenter(target, source);
  return {
    sx: sourcePoint.x,
    sy: sourcePoint.y,
    tx: targetPoint.x,
    ty: targetPoint.y,
    sourcePos: edgePositionOf(source, sourcePoint),
    targetPos: edgePositionOf(target, targetPoint),
  };
}
