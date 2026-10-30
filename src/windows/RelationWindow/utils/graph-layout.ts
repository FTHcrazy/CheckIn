/**
 * 关系图布局（确定性力导向，R27）
 *
 * 为什么不用 rAF / 实时迭代：布局必须在**首帧之前**算完 —— 用户打开窗口看到的是
 * 一张已经稳定、不再抖动的图（产品要求「打开就有一张图」）。同时单测要能断言，
 * 不能依赖动画帧。
 *
 * 确定性三件套：
 * ① 初始位置按节点顺序铺在圆周上（不用 Math.random）；
 * ② 固定迭代次数（默认 260 tick），不按能量阈值提前退出；
 * ③ 结束后按 id 取整到 1px，避免浮点尾数导致两次布局差 1e-9 而快照不等。
 */
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
} from "d3-force";
import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import type { RelationGraphEdge, RelationGraphNode } from "@/shared/novel/relation-graph";

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutOptions {
  /** 迭代次数（单测可调小；生产用默认值） */
  ticks?: number;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
}

/** 圆环播种半径：节点越多摊得越开，避免初始完全重叠导致斥力方向随机 */
function seedRadius(count: number): number {
  return Math.max(220, Math.min(1200, count * 26));
}

/**
 * 计算节点坐标。
 *
 * 返回 Map<nodeId, {x,y}>；未参与布局的 id 不会出现在结果里（调用方按需兜底）。
 */
export function layoutGraphNodes(
  nodes: readonly RelationGraphNode[],
  edges: readonly RelationGraphEdge[],
  options: LayoutOptions = {},
): Map<string, LayoutPoint> {
  const result = new Map<string, LayoutPoint>();
  if (nodes.length === 0) return result;

  const ids = new Set(nodes.map((node) => node.id));
  const radius = seedRadius(nodes.length);

  const simNodes: SimNode[] = nodes.map((node, index) => {
    const angle = (index / nodes.length) * Math.PI * 2;
    return {
      id: node.id,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  });

  const simLinks: SimulationLinkDatum<SimNode>[] = edges
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
    .map((edge) => ({ source: edge.source, target: edge.target }));

  const simulation = forceSimulation(simNodes)
    // distanceMax 截断远端斥力：200 节点时全局两两计算是纯浪费，图也不该被撑成一张巨网
    .force("charge", forceManyBody().strength(-420).distanceMax(1400))
    .force(
      "link",
      forceLink<SimNode, SimulationLinkDatum<SimNode>>(simLinks)
        .id((node) => node.id)
        .distance(170)
        .strength(0.7),
    )
    .force("center", forceCenter(0, 0))
    // 节点是资料卡（约 190×36），碰撞半径按对角线一半再留 12px 呼吸位
    .force("collide", forceCollide(80))
    // 默认 alphaDecay（0.0228）要 ~300 tick 才收敛；画布不需要物理精度，
    // 0.05 让它在 ~120 tick 内稳定，200 节点的布局耗时直接砍半
    .alphaDecay(0.05)
    .stop();

  const ticks = options.ticks ?? 260;
  for (let i = 0; i < ticks; i += 1) {
    if (simulation.alpha() <= simulation.alphaMin()) break;
    simulation.tick();
  }

  for (const node of simNodes) {
    result.set(node.id, {
      x: Math.round(node.x ?? 0),
      y: Math.round(node.y ?? 0),
    });
  }
  return result;
}

/**
 * 池子「一键上图」的落点。
 *
 * 用黄金角螺旋而不是随机/固定点：连续点上图时会自然摊开成向日葵盘，
 * 不会叠在同一个坐标上；也不依赖当前视口（点在按钮上时没有落点坐标）。
 * 纯函数、确定性 —— 同样的 count 永远给同一个位置，单测可断言。
 */
export function suggestNodeSpot(count: number, origin: LayoutPoint = { x: 0, y: 0 }): LayoutPoint {
  const safeCount = Math.max(0, Math.floor(count));
  const angle = safeCount * 2.399963229728653; // 黄金角（弧度）
  const radius = 150 + Math.sqrt(safeCount) * 34;
  return {
    x: Math.round(origin.x + Math.cos(angle) * radius),
    y: Math.round(origin.y + Math.sin(angle) * radius),
  };
}
