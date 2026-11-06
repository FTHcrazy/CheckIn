import { describe, expect, it, vi } from "vitest";

/**
 * 本文件只用到 `Texture.from`，却要**避免**引入真 pixi：
 * 真 pixi 在模块初始化时会探测 canvas 上下文，jsdom 下会打一条
 * "Not implemented: getContext" 噪声日志（与本文件要验的行为无关）。
 */
vi.mock("pixi.js", () => ({ Texture: { from: vi.fn(() => ({ mock: "texture" })) } }));

import {
  PAPER_GRAIN_LUMA,
  PAPER_GRAIN_SIZE,
  createPaperGrainTexture,
  writePaperGrainPixels,
} from "./paperGrain";

/**
 * 纸纹（程序生成）测试。
 *
 * 【为什么值得测】纸纹是**唯一**没有美术资源兜底的一层：如果它生成成全黑（写错
 * 通道）、全白（没生效）或带色（改了 RGB 不同值），陆地会整体变暗/发绿，而
 * 画面上只表现为"陆地颜色不对"—— 没人会想到是这张纹理。数值断言比截图可靠。
 */

/** 生成一张 size² 的纸纹缓冲 */
function grain(size = 64, seed?: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  writePaperGrainPixels(data, size, seed);
  return data;
}

describe("writePaperGrainPixels", () => {
  it("是中性灰：每个像素 r = g = b，且不透明", () => {
    const size = 32;
    const data = grain(size);
    for (let i = 0; i < size * size; i++) {
      const [r, g, b, a] = data.slice(i * 4, i * 4 + 4);
      expect(r, `第 ${i} 个像素不是灰度`).toBe(g);
      expect(r).toBe(b);
      expect(a).toBe(255);
    }
  });

  it("只会压暗不会提亮（下限 = PAPER_GRAIN_LUMA，上限 255）", () => {
    const data = grain(48);
    const lo = Math.floor(255 * PAPER_GRAIN_LUMA) - 1;
    let min = 255;
    let max = 0;
    for (let i = 0; i < data.length; i += 4) {
      min = Math.min(min, data[i]);
      max = Math.max(max, data[i]);
    }
    expect(min).toBeGreaterThanOrEqual(lo);
    expect(max).toBeLessThanOrEqual(255);
    // 必须有可见起伏：整张同值等于没加纸纹
    expect(max - min).toBeGreaterThan(8);
  });

  /**
   * 磨砂质感：颗粒必须"够深、够有对比"，而不是若有若无的均匀灰。
   *
   * 【为什么用统计量】multiply 叠到米黄 fill 上之后，颗粒太弱会把陆地拉成"死板纯色"
   * （本轮"陆地底部光秃秃"的根因）。均值越低于 255 表示越暗，标准差越大表示颗粒
   * 起伏越明显。旧参数（粗 0.5 / 细 0.32 / 网点 0.18 + LUMA 0.88）实测均值 ≈238、std ≈3.7；
   * 新参数（0.62 / 0.26 / 0.12 + LUMA 0.82）实测均值 ≈229、std ≈5.8。
   */
  it("颗粒更深、对比更强（均值偏暗且标准差可见）", () => {
    const size = 96;
    const data = grain(size);
    const values: number[] = [];
    for (let i = 0; i < data.length; i += 4) values.push(data[i]);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) * (v - mean), 0) / values.length;
    const std = Math.sqrt(variance);
    expect(mean).toBeLessThan(235);
    expect(std).toBeGreaterThan(5);
  });

  it("同 seed 逐字节相同（可复现），换 seed 不同", () => {
    const a = grain(32, 7);
    const b = grain(32, 7);
    const c = grain(32, 8);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });

  /**
   * 无缝：接缝处的左右跳变应与图中间的跳变同量级。
   *
   * 若噪声按"绝对坐标"取值而不对格点取模，右边缘与左边缘会各成一个独立随机
   * 值，接缝的平均差会明显偏大 —— 平铺后能看见一条条竖线。这条用统计量钉住，
   * 不追求逐像素相等（噪声本来就有起伏）。
   */
  it("左右接缝没有可见断裂（平均跳变与图中间同量级）", () => {
    const size = 64;
    const data = grain(size);
    const at = (x: number, y: number) => data[(y * size + x) * 4];

    let seam = 0;
    let middle = 0;
    for (let y = 0; y < size; y++) {
      seam += Math.abs(at(size - 1, y) - at(0, y));
      middle += Math.abs(at(size / 2 - 1, y) - at(size / 2, y));
    }
    // 允许 1.6 倍浮动（接缝只跨一个格点，统计上略大是正常的）
    expect(seam / size).toBeLessThanOrEqual((middle / size) * 1.6 + 1);
  });

  it("尺寸与常量一致，且不依赖调用方传 4 的倍数", () => {
    expect(PAPER_GRAIN_SIZE).toBeGreaterThan(0);
    // 传奇数尺寸也不能写出缓冲区（越界会抛或被 clamp）
    const data = new Uint8ClampedArray(33 * 33 * 4);
    expect(() => writePaperGrainPixels(data, 33)).not.toThrow();
  });
});

describe("createPaperGrainTexture", () => {
  it("无 2D 上下文的环境（jsdom）返回 null，而不是抛错", () => {
    // jsdom 的 canvas.getContext("2d") 没有实现 —— 画布测试全靠这个降级
    expect(createPaperGrainTexture(16)).toBeNull();
  });
});
