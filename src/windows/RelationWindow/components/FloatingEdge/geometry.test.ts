/**
 * 浮动边几何单测（R27 / S3 连线优化）
 *
 * 只钉「行为」：两节点错位时，出点/入点必须落在彼此最近的那条边上，
 * 方向也要跟着对 —— 这样曲线才不会绕大回环。不断言内部用了哪个私有函数。
 */
import { Position } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import {
  edgePositionOf,
  getFloatingEdgeParams,
  intersectRectFromCenter,
  type NodeRect,
} from "./geometry";

describe("intersectRectFromCenter：中心连线与矩形边框的交点", () => {
  it("目标在正右方：交点落在右缘中点", () => {
    const from: NodeRect = { x: 0, y: 0, width: 100, height: 40 };
    const to: NodeRect = { x: 300, y: 0, width: 100, height: 40 };
    expect(intersectRectFromCenter(from, to)).toEqual({ x: 100, y: 20 });
  });

  it("目标在正上方：交点落在上缘中点", () => {
    const from: NodeRect = { x: 0, y: 100, width: 100, height: 40 };
    const to: NodeRect = { x: 0, y: 0, width: 100, height: 40 };
    expect(intersectRectFromCenter(from, to)).toEqual({ x: 50, y: 100 });
  });

  it("目标在正左方：交点落在左缘中点", () => {
    const from: NodeRect = { x: 0, y: 0, width: 100, height: 40 };
    const to: NodeRect = { x: -200, y: 0, width: 100, height: 40 };
    expect(intersectRectFromCenter(from, to)).toEqual({ x: 0, y: 20 });
  });

  it("目标在正下方：交点落在下缘中点", () => {
    const from: NodeRect = { x: 0, y: 0, width: 100, height: 40 };
    const to: NodeRect = { x: 0, y: 200, width: 100, height: 40 };
    expect(intersectRectFromCenter(from, to)).toEqual({ x: 50, y: 40 });
  });

  it("中心重合时退回右缘中点（不除零、不产出 NaN）", () => {
    const from: NodeRect = { x: 10, y: 10, width: 100, height: 40 };
    const to: NodeRect = { x: 10, y: 10, width: 100, height: 40 };
    expect(intersectRectFromCenter(from, to)).toEqual({ x: 110, y: 30 });
  });
});

describe("edgePositionOf：点落在哪条边", () => {
  const rect: NodeRect = { x: 0, y: 0, width: 100, height: 40 };

  it("四边各自归位", () => {
    expect(edgePositionOf(rect, { x: 0, y: 20 })).toBe(Position.Left);
    expect(edgePositionOf(rect, { x: 100, y: 20 })).toBe(Position.Right);
    expect(edgePositionOf(rect, { x: 50, y: 0 })).toBe(Position.Top);
    expect(edgePositionOf(rect, { x: 50, y: 40 })).toBe(Position.Bottom);
  });

  it("角点按 左 > 右 > 上 > 下 兜底（不抛异常）", () => {
    expect(edgePositionOf(rect, { x: 0, y: 0 })).toBe(Position.Left);
  });
});

describe("getFloatingEdgeParams：两端最近侧 + 方向", () => {
  it("水平错位（右/左）：出点在右缘、入点在左缘", () => {
    const source: NodeRect = { x: 0, y: 0, width: 100, height: 40 };
    const target: NodeRect = { x: 300, y: 0, width: 100, height: 40 };

    const params = getFloatingEdgeParams(source, target);
    expect(params.sourcePos).toBe(Position.Right);
    expect(params.sx).toBe(100);
    expect(params.targetPos).toBe(Position.Left);
    expect(params.tx).toBe(300);
  });

  it("垂直错位（上/下）：出点在底、入点在顶", () => {
    const source: NodeRect = { x: 0, y: 0, width: 100, height: 40 };
    const target: NodeRect = { x: 0, y: 200, width: 100, height: 40 };

    const params = getFloatingEdgeParams(source, target);
    expect(params.sourcePos).toBe(Position.Bottom);
    expect(params.targetPos).toBe(Position.Top);
  });

  it("斜向错位取「最近侧」：宽扁节点朝右下的目标从底边出（而不是绕到右缘）", () => {
    // source 宽 100 高 40，target 在右下方 —— 纵向占比更近，线从底边自然出，
    // 这正是「不绕大回环」的关键：出点贴着两节点相向的最近边。
    const source: NodeRect = { x: 0, y: 0, width: 100, height: 40 };
    const target: NodeRect = { x: 300, y: 200, width: 100, height: 40 };

    const params = getFloatingEdgeParams(source, target);
    expect(params.sourcePos).toBe(Position.Bottom);
    expect(params.targetPos).toBe(Position.Top);
  });
});
