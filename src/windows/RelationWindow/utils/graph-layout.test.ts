/**
 * 布局确定性单测（R27）
 *
 * 产品要求「打开就有一张稳定的图」：布局必须在首帧前算完，且同一输入每次
 * 得到同一张图（否则每次开窗位置都在变，用户会以为数据变了）。
 */
import { describe, expect, it } from "vitest";
import { layoutGraphNodes, suggestNodeSpot } from "./graph-layout";
import type { RelationGraphEdge, RelationGraphNode } from "@/shared/novel/relation-graph";

function node(id: string, name: string): RelationGraphNode {
  return {
    id,
    entityId: id,
    type: "character",
    name,
    aliases: [],
    summary: "",
    realm: "",
    relationCount: 1,
    linked: true,
  };
}

function edge(id: string, source: string, target: string): RelationGraphEdge {
  return {
    id,
    source,
    target,
    relation: "同门",
    relations: ["同门"],
    extraCount: 0,
    label: "同门",
    linkIds: [`${id}-row`],
    notes: [undefined],
  };
}

describe("layoutGraphNodes", () => {
  it("空图不产出坐标", () => {
    expect(layoutGraphNodes([], []).size).toBe(0);
  });

  it("同一输入两次布局完全一致（不是随机播种）", () => {
    const nodes = [node("a", "甲"), node("b", "乙"), node("c", "丙")];
    const edges = [edge("e1", "a", "b"), edge("e2", "b", "c")];
    const first = layoutGraphNodes(nodes, edges);
    const second = layoutGraphNodes(nodes, edges);
    expect([...first.entries()]).toEqual([...second.entries()]);
  });

  it("每个节点都有有限坐标，且不重叠在同一点", () => {
    const nodes = [node("a", "甲"), node("b", "乙"), node("c", "丙"), node("d", "丁")];
    const edges = [edge("e1", "a", "b"), edge("e2", "c", "d")];
    const points = layoutGraphNodes(nodes, edges);
    expect(points.size).toBe(4);
    for (const point of points.values()) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    }
    const unique = new Set([...points.values()].map((point) => `${point.x},${point.y}`));
    expect(unique.size).toBe(4);
  });

  it("边指向不存在的节点时不抛错（脏数据已在派生层过滤，这里兜底）", () => {
    const nodes = [node("a", "甲"), node("b", "乙")];
    const edges = [edge("e1", "a", "ghost")];
    expect(() => layoutGraphNodes(nodes, edges)).not.toThrow();
  });

  it("200 节点 / 400 边的布局在预算内（S0 的性能下限，阈值给 CI 留足余量）", () => {
    const nodes = Array.from({ length: 200 }, (_, index) =>
      node(`n${index}`, `要素${index}`),
    );
    // 环形拓扑 + 少量跨环长边：比纯链更接近真实关系网
    const edges = nodes.flatMap((item, index) => [
      edge(`e${index}a`, item.id, nodes[(index + 1) % nodes.length].id),
      edge(`e${index}b`, item.id, nodes[(index * 7 + 13) % nodes.length].id),
    ]);

    const started = performance.now();
    const points = layoutGraphNodes(nodes, edges);
    const elapsed = performance.now() - started;

    expect(points.size).toBe(200);
    // 实测（vitest / Node 环境）：200 节点约 190~210ms（已用 alphaDecay=0.05
    // 把迭代从 ~260 降到 ~135）。阈值放到 800ms 是抗 CI 抖动，不是性能目标。
    expect(elapsed).toBeLessThan(800);
  });
});

describe("suggestNodeSpot：一键上图的落点", () => {
  it("确定性：同样的序号给同一个点", () => {
    expect(suggestNodeSpot(3)).toEqual(suggestNodeSpot(3));
  });

  it("连续点上图不会叠在同一个坐标上", () => {
    const points = [0, 1, 2, 3, 4, 5].map((index) => suggestNodeSpot(index));
    const unique = new Set(points.map((point) => `${point.x},${point.y}`));
    expect(unique.size).toBe(points.length);
    expect(points[0]).not.toEqual(points[1]);
  });

  it("围绕原点且随序号外扩（螺旋而不是一条线）", () => {
    const near = suggestNodeSpot(1);
    const far = suggestNodeSpot(20);
    const distance = (point: { x: number; y: number }) => Math.hypot(point.x, point.y);
    expect(distance(far)).toBeGreaterThan(distance(near));
  });
});
