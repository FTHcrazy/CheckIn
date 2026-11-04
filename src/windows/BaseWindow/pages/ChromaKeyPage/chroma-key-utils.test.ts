import { describe, expect, it } from "vitest";
import {
  DEFAULT_KEY_COLOR,
  applyChromaKey,
  buildCutoutName,
  clampByte,
  formatRgb,
  hexToRgb,
  removedRatio,
  rgbToHex,
  toleranceRadius,
  type ChromaKeyOptions,
} from "./chroma-key-utils";

/** 构造一行像素：[r,g,b,a] × n */
function pixels(...values: number[][]): Uint8ClampedArray {
  return new Uint8ClampedArray(values.flat());
}

function options(patch: Partial<ChromaKeyOptions> = {}): ChromaKeyOptions {
  return {
    key: DEFAULT_KEY_COLOR,
    tolerance: 0,
    feather: 0,
    ...patch,
  };
}

describe("toleranceRadius", () => {
  it("百分比映射到 0-255", () => {
    expect(toleranceRadius(0)).toBe(0);
    expect(toleranceRadius(50)).toBe(127.5);
    expect(toleranceRadius(100)).toBe(255);
  });

  it("越界与非法值收敛，不产生负半径", () => {
    expect(toleranceRadius(-10)).toBe(0);
    expect(toleranceRadius(999)).toBe(255);
    expect(toleranceRadius(Number.NaN)).toBe(0);
  });
});

describe("applyChromaKey（硬切，与参考实现同口径）", () => {
  it("容差为 0 时只抠掉完全等于色键的像素", () => {
    const data = pixels([0, 255, 0, 255], [0, 254, 0, 255], [1, 255, 1, 255]);
    const result = applyChromaKey(data, options());
    expect(result.removed).toBe(1);
    expect(Array.from(data)).toEqual([
      0, 255, 0, 0,
      0, 254, 0, 255,
      1, 255, 1, 255,
    ]);
  });

  it("容差是「逐通道差值的最大值」，不是三通道求和", () => {
    // 单通道差 20，容差半径 38.25 → 命中
    const inside = pixels([20, 255, 0, 255]);
    expect(applyChromaKey(inside, options({ tolerance: 15 })).removed).toBe(1);

    // 单通道差 40 已超半径 → 不命中（若按三通道求和计算就会误判成 40 命中的反面）
    const outside = pixels([0, 255, 40, 255]);
    expect(applyChromaKey(outside, options({ tolerance: 15 })).removed).toBe(0);
  });

  it("只改 alpha，不动 RGB（半透明边缘合成就靠这个）", () => {
    const data = pixels([0, 255, 0, 128]);
    applyChromaKey(data, options());
    expect(Array.from(data)).toEqual([0, 255, 0, 0]);
  });

  it("已经透明的像素不重复计入命中", () => {
    const data = pixels([0, 255, 0, 0], [0, 255, 0, 255]);
    const result = applyChromaKey(data, options());
    expect(result.removed).toBe(1);
  });

  it("不命中的像素原样保留（含原有半透明）", () => {
    const data = pixels([10, 20, 30, 77]);
    applyChromaKey(data, options({ tolerance: 10 }));
    expect(Array.from(data)).toEqual([10, 20, 30, 77]);
  });
});

describe("applyChromaKey（软边增强）", () => {
  it("软边区间内 alpha 按距离线性衰减", () => {
    // 容差 0 → 半径 0；软边 40 → 软边宽 102。
    // 差值 51 落在中间 → 系数 0.5 → alpha 128
    const data = pixels([51, 255, 0, 255]);
    const result = applyChromaKey(data, options({ feather: 40 }));
    expect(result.feathered).toBe(1);
    expect(data[3]).toBe(128);
  });

  it("软边外侧不动、内侧完全抠掉", () => {
    const data = pixels(
      [0, 255, 0, 255], // 半径内 → 0
      [200, 255, 0, 255], // 超出 0+102 → 不动
    );
    applyChromaKey(data, options({ feather: 40 }));
    expect(data[3]).toBe(0);
    expect(data[7]).toBe(255);
  });

  it("软边不影响命中计数口径（removed 只统计完全抠掉的）", () => {
    const data = pixels([0, 255, 0, 255], [51, 255, 0, 255]);
    const result = applyChromaKey(data, options({ feather: 40 }));
    expect(result.removed).toBe(1);
    expect(result.feathered).toBe(1);
  });
});

describe("颜色换算", () => {
  it("rgb ↔ hex 双向一致", () => {
    expect(rgbToHex({ r: 0, g: 255, b: 0 })).toBe("#00ff00");
    expect(rgbToHex({ r: 18, g: 52, b: 86 })).toBe("#123456");
    expect(hexToRgb("#123456")).toEqual({ r: 18, g: 52, b: 86 });
    expect(hexToRgb("123456")).toEqual({ r: 18, g: 52, b: 86 });
    expect(hexToRgb("#0f0")).toEqual({ r: 0, g: 255, b: 0 });
  });

  it("非法输入返回 null，不静默变成黑色", () => {
    expect(hexToRgb("#12")).toBeNull();
    expect(hexToRgb("")).toBeNull();
    expect(hexToRgb("#gggggg")).toBeNull();
  });

  it("clampByte 收敛越界值", () => {
    expect(clampByte(-5)).toBe(0);
    expect(clampByte(300)).toBe(255);
    expect(clampByte(12.6)).toBe(13);
    expect(clampByte(Number.NaN)).toBe(0);
  });

  it("formatRgb 用于提示文案", () => {
    expect(formatRgb({ r: 0, g: 255, b: 0 })).toBe("rgb(0, 255, 0)");
  });
});

describe("removedRatio", () => {
  it("返回 0-1 且不吃除零", () => {
    expect(removedRatio(25, 10, 10)).toBe(0.25);
    expect(removedRatio(0, 0, 0)).toBe(0);
    expect(removedRatio(200, 10, 10)).toBe(1);
  });
});

describe("buildCutoutName", () => {
  it("去掉原扩展名并统一成 png", () => {
    expect(buildCutoutName("照片.jpg")).toBe("照片-抠图.png");
    expect(buildCutoutName("无扩展名")).toBe("无扩展名-抠图.png");
    expect(buildCutoutName(".gitignore")).toBe(".gitignore-抠图.png");
  });
});
