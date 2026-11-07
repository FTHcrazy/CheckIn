import { describe, expect, it, vi } from "vitest";
import type { MapRegion } from "../../regions";

/**
 * 国名层的渲染契约。
 *
 * 【为什么单独测】国名是"看得见但很难断言"的一层：字多大、字距多少、为什么只给
 * 前三级建名 —— 这些在截图里只是"好看/不好看"，改坏了不会有任何报错。这里把三条
 * 可以量化的性质钉住：
 *   1. 字号随面积走但**有上下限**（小碎片不能配大字）；
 *   2. 面积过小的块**不出名字**（糊在边界上没有意义）；
 *   3. 重建是**幂等清空**（不累积节点 —— 累积会让同一块上叠十几个名字）。
 *
 * 【不测透明度】国名的 alpha 由**层级容器**（LOD 权重）统一给，本模块只给字体的
 * 0.6（2.42.0 对齐逆向目标），那是"字本身半透明"，与权重无关。
 */

interface FakeText {
  text: string;
  alpha: number;
  resolution: number;
  destroyed: boolean;
  style: Record<string, unknown>;
  anchorValue: { x: number; y: number };
  positionValue: { x: number; y: number };
}

const { texts } = vi.hoisted(() => ({ texts: [] as FakeText[] }));

vi.mock("pixi.js", () => {
  class FakeContainer {
    children: unknown[] = [];
    alpha = 1;
    visible = true;
    destroyed = false;
    addChild(...kids: unknown[]): unknown {
      this.children.push(...kids);
      return kids[0];
    }
    removeChild(kid: unknown): void {
      const i = this.children.indexOf(kid);
      if (i >= 0) this.children.splice(i, 1);
    }
    destroy(): void {
      this.destroyed = true;
    }
  }
  class TextStyle {
    constructor(options?: Record<string, unknown>) {
      Object.assign(this as object, options ?? {});
    }
  }
  class Text extends FakeContainer {
    text = "";
    resolution = 1;
    style: Record<string, unknown> = {};
    anchorValue = { x: 0, y: 0 };
    positionValue = { x: 0, y: 0 };
    anchor = {
      set: (x: number, y: number) => {
        this.anchorValue = { x, y };
      },
    };
    position = {
      set: (x: number, y: number) => {
        this.positionValue = { x, y };
      },
    };
    constructor(options?: { text?: string; style?: Record<string, unknown> }) {
      super();
      this.text = options?.text ?? "";
      this.style = options?.style ?? {};
      texts.push(this as unknown as FakeText);
    }
  }
  return { Container: FakeContainer, Text, TextStyle };
});

// ↑ 用动态 import：`vi.mock` 的工厂虽然会被提升，但本文件顶部的 `texts` 探针来自
// `vi.hoisted`，动态 import 能保证"先装 mock、再加载被测模块"的时序一眼可见。
const {
  REGION_NAME_ALPHA,
  REGION_NAME_FONT_FAMILY,
  REGION_NAME_LETTER_SPACING,
  REGION_NAME_SIZE_MAX_SCALE,
  REGION_NAME_SIZE_MIN_SCALE,
  REGION_NAME_SIZE_RATIO,
  regionNameFontSize,
  syncRegionNameGroup,
} = await import("./regionNameLayer");
const { Container } = await import("pixi.js");

/** 造一块正方形区块（边长 → 面积确定，便于断言字号） */
function square(input: { id: string; level: number; side: number; name?: string }): MapRegion {
  const s = input.side;
  return {
    id: input.id,
    parentId: null,
    level: input.level,
    name: input.name ?? `国家 ${input.id}`,
    seed: { x: 5, y: 7 },
    polygon: [
      { x: 0, y: 0 },
      { x: s, y: 0 },
      { x: s, y: s },
      { x: 0, y: s },
    ],
    color: 0x123456,
  };
}

const newContainer = () => new Container() as unknown as { children: unknown[] };

describe("regionNameFontSize：随面积走但有上下限", () => {
  it("均值面积 = 1 倍系数，大块封顶、小块封底", () => {
    const mean = 10_000; // 边长 100
    const base = Math.sqrt(mean) * REGION_NAME_SIZE_RATIO;
    expect(regionNameFontSize(mean, mean)).toBeCloseTo(base, 6);
    // 超大块（面积 100 倍 ⇒ 边长 10 倍）被压到上限
    expect(regionNameFontSize(mean * 100, mean)).toBeCloseTo(base * REGION_NAME_SIZE_MAX_SCALE, 6);
    // 极小碎片被抬到下限（否则字小到看不见，等于没名字）
    expect(regionNameFontSize(mean / 100, mean)).toBeCloseTo(base * REGION_NAME_SIZE_MIN_SCALE, 6);
    // 面积退化（0 / 负数）不能返回 0 或 NaN —— 那会让 Text 抛错
    expect(regionNameFontSize(0, 0)).toBeGreaterThan(0);
    expect(Number.isFinite(regionNameFontSize(0, 0))).toBe(true);
  });
});

describe("syncRegionNameGroup：建名规则", () => {
  it("只为指定层级建，文字 / 位置 / 样式 / 透明度都来自区块本身", () => {
    texts.length = 0;
    const container = newContainer();
    const regions = [
      square({ id: "a", level: 1, side: 100 }),
      square({ id: "b", level: 2, side: 100 }),
    ];
    const created = syncRegionNameGroup(container as never, regions, 1);

    expect(created).toBe(1);
    expect(container.children).toHaveLength(1);
    const node = texts[0];
    expect(node.text).toBe("国家 a");
    expect(node.positionValue).toEqual({ x: 5, y: 7 });
    expect(node.anchorValue).toEqual({ x: 0.5, y: 0.5 });
    expect(node.alpha).toBe(REGION_NAME_ALPHA);
    expect(node.style.fontFamily).toBe(REGION_NAME_FONT_FAMILY);
    // 字号 × 字距系数：疏排是古地图国名的特征，紧排会读成现代排版
    const fontSize = node.style.fontSize as number;
    expect(node.style.letterSpacing).toBeCloseTo(fontSize * REGION_NAME_LETTER_SPACING, 6);
  });

  it("面积过小的碎片不出名字（字会糊在边界上）", () => {
    texts.length = 0;
    const container = newContainer();
    // 1 块 100×100 + 1 块 10×10：小块面积是均值的 1/40，远低于门槛
    const regions = [
      square({ id: "big", level: 2, side: 100 }),
      square({ id: "tiny", level: 2, side: 10 }),
    ];
    const created = syncRegionNameGroup(container as never, regions, 2);
    expect(created).toBe(1);
    expect(texts.map((t) => t.text)).toEqual(["国家 big"]);
  });

  it("空名 / 退化多边形直接跳过（不建空文字节点）", () => {
    texts.length = 0;
    const container = newContainer();
    const empty = { ...square({ id: "x", level: 0, side: 100 }), name: "   " };
    const degenerate = { ...square({ id: "y", level: 0, side: 100 }), polygon: [] };
    expect(syncRegionNameGroup(container as never, [empty, degenerate], 0)).toBe(0);
    expect(texts).toHaveLength(0);
  });

  it("重复同步不累积节点，旧节点被真正销毁", () => {
    texts.length = 0;
    const container = newContainer();
    const regions = [
      square({ id: "a", level: 1, side: 100 }),
      square({ id: "b", level: 1, side: 100 }),
    ];
    syncRegionNameGroup(container as never, regions, 1);
    const first = [...(container.children as FakeText[])];
    syncRegionNameGroup(container as never, regions, 1);
    expect(container.children).toHaveLength(2);
    expect(first.every((n) => n.destroyed)).toBe(true);
    expect(first.some((n) => container.children.includes(n))).toBe(false);
  });

  it("同一层没有区块时清空（生成 → 清除后名字必须消失）", () => {
    const container = newContainer();
    syncRegionNameGroup(container as never, [square({ id: "a", level: 1, side: 100 })], 1);
    expect(container.children).toHaveLength(1);
    expect(syncRegionNameGroup(container as never, [], 1)).toBe(0);
    expect(container.children).toHaveLength(0);
  });
});
