/**
 * 浮动边（XMind 风格）—— 两端从两节点边框的最近点自然连出。
 *
 * 为什么不用 React Flow 内置的 default/bezier 边：内置边从节点的「固定手柄」
 * 位置取控制点，两节点上下错位时会绕大回环。这里每次渲染都按节点**当前**的
 * 绝对矩形现算交点（`useInternalNode` 订阅节点移动），拖动时边即时跟着最近侧走。
 *
 * 边仍是无向展示、有向入参：箭头（markerEnd）指向数据层的 target，给用户方向感，
 * 但不改变「一条边 = 一对要素」的合并语义。
 */
import { memo } from "react";
import {
  BaseEdge,
  getBezierPath,
  useInternalNode,
  type EdgeProps,
  type InternalNode,
} from "@xyflow/react";
import { getFloatingEdgeParams, type NodeRect } from "./geometry";

/** InternalNode → 几何用的绝对矩形（宽高以实测为准，未测到时回退声明值） */
function rectOf(node: InternalNode | undefined): NodeRect | null {
  if (!node) return null;
  const width = node.measured.width ?? node.width ?? 0;
  const height = node.measured.height ?? node.height ?? 0;
  const { x, y } = node.internals.positionAbsolute;
  return { x, y, width, height };
}

function FloatingEdgeInner({
  id,
  source,
  target,
  markerEnd,
  style,
  interactionWidth,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  labelStyle,
  labelShowBg,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
}: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  const sourceRect = rectOf(sourceNode);
  const targetRect = rectOf(targetNode);

  // 首帧节点可能还没量出宽高：此时退回「按手柄」的坐标，避免边闪现消失。
  // 量出来之后 useInternalNode 会触发重渲染，自动切回「最近侧」的浮动几何。
  const measured =
    sourceRect !== null &&
    targetRect !== null &&
    sourceRect.width > 0 &&
    sourceRect.height > 0 &&
    targetRect.width > 0 &&
    targetRect.height > 0;
  const params = measured
    ? getFloatingEdgeParams(sourceRect as NodeRect, targetRect as NodeRect)
    : {
        sx: sourceX,
        sy: sourceY,
        tx: targetX,
        ty: targetY,
        sourcePos: sourcePosition,
        targetPos: targetPosition,
      };

  const [path, labelX, labelY] = getBezierPath({
    sourceX: params.sx,
    sourceY: params.sy,
    sourcePosition: params.sourcePos,
    targetX: params.tx,
    targetY: params.ty,
    targetPosition: params.targetPos,
    // 0.25 = React Flow 默认曲率：圆滑又不至于绕出大弧
    curvature: 0.25,
  });

  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      style={style}
      interactionWidth={interactionWidth}
      label={label}
      labelX={labelX}
      labelY={labelY}
      labelStyle={labelStyle}
      labelShowBg={labelShowBg}
      labelBgStyle={labelBgStyle}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
    />
  );
}

export default memo(FloatingEdgeInner);
