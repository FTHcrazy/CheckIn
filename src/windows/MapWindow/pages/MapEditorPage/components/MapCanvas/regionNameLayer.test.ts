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
  REGION_NAME_BIG_WIDTH_RATIO,
  REGION_NAME_FONT_FAMILY,
  REGION_NAME_LETTER_SPACING,
  REGION_NAME_SHADOW_BLUR,
  REGION_NAME_SIZE_BASE,
  REGION_NAME_SIZE_BIG,
  REGION_NAME_SIZE_TINY,
  REGION_NAME_TINY_WIDTH_RATIO,
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

/** 本仓底图宽（世界单位），也就是参考判据里的"纸宽" */
const PAGE = 1447;

describe("regionNameFontSize：照抄参考的三档判据（块宽 vs 纸宽）", () => {
  it("窄块给 30、常规给 56、宽块给 100", () => {
    expect(regionNameFontSize(PAGE * REGION_NAME_TINY_WIDTH_RATIO - 10, PAGE)).toBe(
      REGION_NAME_SIZE_TINY,
    );
    expect(regionNameFontSize(PAGE * 0.45, PAGE)).toBe(REGION_NAME_SIZE_BASE);
    expect(regionNameFontSize(PAGE * REGION_NAME_BIG_WIDTH_RATIO + 10, PAGE)).toBe(
      REGION_NAME_SIZE_BIG,
    );
  });

  it("阈值本身落在常规档（参考用的是严格大于 / 小于）", () => {
    // 恰好等于阈值不算越界 —— 写成 >= 会把一半的常规块推进极端档
    expect(regionNameFontSize(PAGE * REGION_NAME_TINY_WIDTH_RATIO, PAGE)).toBe(
      REGION_NAME_SIZE_BASE,
    );
    expect(regionNameFontSize(PAGE * REGION_NAME_BIG_WIDTH_RATIO, PAGE)).toBe(
      REGION_NAME_SIZE_BASE,
    );
  });

  it("宽高比决定档位：面积相同，横贯的窄条反而比方正块字号大", () => {
    // 参考判的是"这行字放不放得下"，横排国名的约束是宽度，不是面积
    const wide = PAGE * 0.7; // 宽而扁 → 大国档（1012 > 919）
    const square = Math.sqrt(wide * 200); // 边长 ≈450，落在常规档
    expect(regionNameFontSize(wide, PAGE)).toBe(REGION_NAME_SIZE_BIG);
    expect(regionNameFontSize(square, PAGE)).toBe(REGION_NAME_SIZE_BASE);
  });

  it("退化输入不返回 0 / NaN（Text 会抛错）", () => {
    expect(regionNameFontSize(0, PAGE)).toBeGreaterThan(0);
    expect(regionNameFontSize(Number.NaN, PAGE)).toBe(REGION_NAME_SIZE_TINY);
    expect(regionNameFontSize(-100, PAGE)).toBe(REGION_NAME_SIZE_TINY);
    // 纸宽非法时退回参考页宽，不能变成 NaN
    expect(Number.isFinite(regionNameFontSize(500, Number.NaN))).toBe(true);
    expect(Number.isFinite(regionNameFontSize(500, 0))).toBe(true);
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
    // 字距恒 0：参考的国名是紧排（`word_spacing: 0`），疏排会溢到邻国边界上
    expect(node.style.letterSpacing).toBe(0);
    expect(REGION_NAME_LETTER_SPACING).toBe(0);
    // 深色模糊投影：粉彩色板下白字 α0.6 不靠投影根本读不出来
    expect(node.style.dropShadow).toMatchObject({ blur: REGION_NAME_SHADOW_BLUR });
  });

  it("同一次同步里按块宽分三档字号（30 / 56 / 100）", () => {
    texts.length = 0;
    const container = newContainer();
    // 300 宽 → 30；700 宽 → 56；1000 宽 → 100。
    // 面积门槛（均值×7.8%）不能让小的那块被剔掉，所以最小一块也取 300。
    const regions = [
      square({ id: "small", level: 0, side: 300 }),
      square({ id: "mid", level: 0, side: 700 }),
      square({ id: "big", level: 0, side: 1000 }),
    ];
    syncRegionNameGroup(container as never, regions, 0);
    expect(texts.map((t) => t.style.fontSize)).toEqual([
      REGION_NAME_SIZE_TINY,
      REGION_NAME_SIZE_BASE,
      REGION_NAME_SIZE_BIG,
    ]);
  });

  it("飞地计入块宽：主体窄、带远方飞地的国不该被判成小国", () => {
    texts.length = 0;
    const container = newContainer();
    const base = square({ id: "split", level: 0, side: 300 });
    const island = [
      { x: 800, y: 0 },
      { x: 900, y: 0 },
      { x: 900, y: 60 },
      { x: 800, y: 60 },
    ];
    // 只量主体是 300 宽 → 30；算上飞地是 900 宽 → 56
    syncRegionNameGroup(container as never, [base], 0);
    expect(texts.at(-1)?.style.fontSize).toBe(REGION_NAME_SIZE_TINY);
    syncRegionNameGroup(container as never, [{ ...base, pieces: [island] }], 0);
    expect(texts.at(-1)?.style.fontSize).toBe(REGION_NAME_SIZE_BASE);
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
