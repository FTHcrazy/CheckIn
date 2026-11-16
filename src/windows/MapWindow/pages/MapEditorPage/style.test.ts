import { describe, expect, it, vi } from "vitest";

/**
 * 风格预设（B4 / PRD §6.4）的纯函数测试。
 *
 * 【为什么断言"纯白映射到哪"而不是断言矩阵常量】矩阵是 20 个数，逐位断言等于
 * 把实现抄一遍 —— 改一个系数时测试跟着改，什么也没守住。真正要守的是**观感契约**：
 *   · 羊皮纸：偏暖（R > G > B）且整体变暗；
 *   · 墨色：不变色（三通道相等）但略暗；
 *   · 原色：不做任何映射。
 * 这些断言与实现解耦，将来把矩阵换成别的等效写法也照样成立。
 *
 * 【为什么 mock 掉 pixi】`style.ts` 顶层 `import { ColorMatrixFilter }`，而 jsdom
 * 里没有 WebGL 上下文。这里只需要"能 new、能收 matrix"的替身 —— 真正的矩阵运算
 * 由本文件的 `applyToWhite` 自己算，与 pixi 的实现无关。
 */
vi.mock("pixi.js", () => {
  class ColorMatrixFilter {
    matrix: number[] = [];
    destroy = vi.fn();
  }
  return { ColorMatrixFilter };
});

import { ColorMatrixFilter } from "pixi.js";
import {
  MAP_STYLES,
  STYLE_MATRIX_INK,
  STYLE_MATRIX_PARCHMENT,
  filterFor,
  styleMatrixOf,
} from "./style";

/**
 * 按 pixi 的约定把 20 元矩阵作用到一个 RGBA 颜色上（行主序，4 行 × 5 列）。
 *
 * 第 i 行：`C'_i = m[5i+0]·R + m[5i+1]·G + m[5i+2]·B + m[5i+3]·A + m[5i+4]`
 * 最后一项是**偏移**（0~1 之间直接加到通道上）。
 */
function applyMatrix(
  matrix: readonly number[],
  rgba: readonly [number, number, number, number],
): [number, number, number, number] {
  const [r, g, b, a] = rgba;
  const out: number[] = [];
  for (let row = 0; row < 4; row += 1) {
    const o = row * 5;
    out.push(matrix[o] * r + matrix[o + 1] * g + matrix[o + 2] * b + matrix[o + 3] * a + matrix[o + 4]);
  }
  return [out[0], out[1], out[2], out[3]];
}

/** 亮度（Rec.601 加权）—— 判断"有没有变暗"用它，比单独看某个通道稳 */
function luma([r, g, b]: readonly [number, number, number, number]): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

const WHITE = [1, 1, 1, 1] as const;

describe("风格预设 · 下拉数据", () => {
  it("三档、原色第一（默认），键与文案都齐", () => {
    expect(MAP_STYLES.map((s) => s.key)).toEqual(["none", "parchment", "ink"]);
    for (const item of MAP_STYLES) {
      expect(item.label.length).toBeGreaterThan(0);
    }
  });
});

describe("风格预设 · 矩阵常量", () => {
  it("两个矩阵都是 20 元，最后一行是 alpha 恒等", () => {
    for (const matrix of [STYLE_MATRIX_PARCHMENT, STYLE_MATRIX_INK]) {
      expect(matrix).toHaveLength(20);
      expect(matrix.slice(15)).toEqual([0, 0, 0, 1, 0]);
    }
  });

  it("前三行都不含 alpha 项（a3 = 0），否则半透明像素会被额外染色", () => {
    for (const matrix of [STYLE_MATRIX_PARCHMENT, STYLE_MATRIX_INK]) {
      for (let row = 0; row < 3; row += 1) {
        expect(matrix[row * 5 + 3]).toBe(0);
      }
    }
  });
});

describe("风格预设 · 纯白映射（观感契约）", () => {
  it("羊皮纸：偏暖（R > G > B）且整体变暗", () => {
    const [r, g, b] = applyMatrix(STYLE_MATRIX_PARCHMENT, WHITE);
    // 期望值 (0.98, 0.88, 0.76) 允许 ±0.03 的余量：将来微调系数不必改测试
    expect(r).toBeGreaterThan(0.9);
    expect(r).toBeLessThanOrEqual(1);
    expect(g).toBeGreaterThan(0.8);
    expect(g).toBeLessThan(0.95);
    expect(b).toBeGreaterThan(0.65);
    expect(b).toBeLessThan(0.85);
    // 暖色的次序契约
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    // 变暗：白纸不该越调越亮
    expect(luma([r, g, b, 1])).toBeLessThan(1);
  });

  it("墨色：三通道相等（不变色）且略暗，不偏黄也不偏蓝", () => {
    const [r, g, b] = applyMatrix(STYLE_MATRIX_INK, WHITE);
    expect(Math.abs(r - 0.95)).toBeLessThan(1e-6);
    expect(Math.abs(g - 0.95)).toBeLessThan(1e-6);
    expect(Math.abs(b - 0.95)).toBeLessThan(1e-6);
    // "不变色"的严格含义：最大最小通道之差为 0
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(1e-6);
    expect(r).toBeLessThan(1);
  });

  it("墨色：纯红被明显抽色（这就是「墨」的来源），但仍比纯蓝红得多", () => {
    const red = applyMatrix(STYLE_MATRIX_INK, [1, 0, 0, 1]);
    const green = applyMatrix(STYLE_MATRIX_INK, [0, 1, 0, 1]);
    const blue = applyMatrix(STYLE_MATRIX_INK, [0, 0, 1, 1]);
    // 饱和 0.15 ≈ 只剩 15% 的色相，85% 走灰度
    expect(red[0]).toBeGreaterThan(red[1]);
    expect(green[1]).toBeGreaterThan(green[0]);
    expect(blue[2]).toBeGreaterThan(blue[0]);
    // 抽色之后三者的"通道差距"都比原色小得多（原色差距是 1）
    expect(red[0] - red[1]).toBeLessThan(0.2);
  });
});

describe("风格预设 · filterFor", () => {
  it("原色返回 null（= 调用方赋空数组，零成本）", () => {
    expect(styleMatrixOf("none")).toBeNull();
    expect(filterFor("none")).toBeNull();
  });

  it("每次调用都是**新实例**，且 matrix 就是常量（不是累乘出来的）", () => {
    const a = filterFor("ink");
    const b = filterFor("ink");
    expect(a).toBeInstanceOf(ColorMatrixFilter);
    expect(a).not.toBe(b);
    expect(a?.matrix).toEqual([...STYLE_MATRIX_INK]);
    expect(b?.matrix).toEqual([...STYLE_MATRIX_INK]);
  });

  it("旧实例可销毁（切风格时必须 destroy，否则漏 uniform group）", () => {
    const filter = filterFor("parchment");
    expect(filter?.matrix).toEqual([...STYLE_MATRIX_PARCHMENT]);
    // 销毁不抛错即可：真实 pixi 的 destroy 会释放 GlProgram 引用
    expect(() => filter?.destroy()).not.toThrow();
  });
});
