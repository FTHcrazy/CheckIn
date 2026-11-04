import { describe, expect, it } from "vitest";
import { isPlainBackdrop, matteBackground } from "./id-photo-matting";

type Pixel = [number, number, number, number];

/** 按坐标画一张 RGBA 图，方便构造「纯色背景 + 人像」的合成样本 */
function paint(
  width: number,
  height: number,
  shade: (x: number, y: number) => Pixel,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const [r, g, b, a] = shade(x, y);
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return data;
}

const GREEN: Pixel = [0, 255, 0, 255];
const RED: Pixel = [200, 30, 30, 255];

/** 40×40 绿底 + 中央 20×20 红块 */
function greenWithRedBlock(): Uint8ClampedArray {
  return paint(40, 40, (x, y) =>
    x >= 10 && x < 30 && y >= 10 && y < 30 ? RED : GREEN,
  );
}

function alphaAt(data: Uint8ClampedArray, width: number, x: number, y: number): number {
  return data[(y * width + x) * 4 + 3];
}

describe("matteBackground", () => {
  it("抠掉从四边连通的背景，保留中央前景", () => {
    const width = 40;
    const height = 40;
    const { data, stats } = matteBackground(greenWithRedBlock(), width, height, {
      tolerance: 10,
      feather: 0,
      decontaminate: 0,
    });

    // 背景 1200 像素，前景 400
    expect(stats.removedRatio).toBeCloseTo(1200 / 1600, 5);
    expect(alphaAt(data, width, 0, 0)).toBe(0);
    expect(alphaAt(data, width, 20, 20)).toBe(255);
    expect(stats.borderColor).toBe("#00ff00");
  });

  it("被前景包住的同色区域不抠（漫水而非色键的关键差别）", () => {
    const width = 40;
    const source = paint(40, 40, (x, y) => {
      if (x >= 10 && x < 30 && y >= 10 && y < 30) {
        // 前景内部藏一个和背景同色的点
        return x === 20 && y === 20 ? GREEN : RED;
      }
      return GREEN;
    });

    const { data } = matteBackground(source, width, 40, {
      tolerance: 10,
      feather: 0,
      decontaminate: 0,
    });

    // 色键实现会把这个点一起抠掉；边界漫水不会，因为它不与画面边缘连通
    expect(alphaAt(data, width, 20, 20)).toBe(255);
  });

  it("贴着底边的前景不会被当成背景种子", () => {
    const width = 30;
    const height = 30;
    const source = paint(width, height, (_x, y) => {
      // 下半部分的深色衣服一直贴到画面底边
      if (y >= 20) return [30, 30, 30, 255];
      return GREEN;
    });

    const { data, stats } = matteBackground(source, width, height, {
      tolerance: 10,
      feather: 0,
      decontaminate: 0,
    });

    expect(alphaAt(data, width, 15, 29)).toBe(255);
    // 边界主色仍是背景绿（中位数不受贴边深色影响）
    expect(stats.borderColor).toBe("#00ff00");
  });

  it("背景不纯时 seedRatio 明显偏低，可据此提示换图", () => {
    const noisy = paint(20, 20, (x, y) =>
      (x + y) % 2 === 0 ? [0, 255, 0, 255] : [255, 0, 255, 255],
    );
    const { stats } = matteBackground(noisy, 20, 20, {
      tolerance: 5,
      feather: 0,
      decontaminate: 0,
    });

    expect(stats.seedRatio).toBeLessThan(0.9);
    expect(isPlainBackdrop(stats.seedRatio)).toBe(false);
  });

  it("羽化让边缘像素半透明，且只在边缘出现", () => {
    const width = 40;
    const source = greenWithRedBlock();
    const hard = matteBackground(source, width, 40, {
      tolerance: 10,
      feather: 0,
      decontaminate: 0,
    });
    const soft = matteBackground(source, width, 40, {
      tolerance: 10,
      feather: 2,
      decontaminate: 0,
    });

    const edge = alphaAt(soft.data, width, 10, 20);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(255);
    // 硬切时同一点是完全不透明的
    expect(alphaAt(hard.data, width, 10, 20)).toBe(255);
    expect(soft.stats.feathered).toBeGreaterThan(0);
  });

  it("羽化后更靠内的像素比边缘更不透明", () => {
    const width = 40;
    const { data } = matteBackground(greenWithRedBlock(), width, 40, {
      tolerance: 10,
      feather: 3,
      decontaminate: 0,
    });

    const edge = alphaAt(data, width, 10, 20); // 距背景 1
    const inner = alphaAt(data, width, 12, 20); // 距背景 3
    expect(inner).toBeGreaterThan(edge);
  });

  it("去色边把边缘像素从原底色里拉回来", () => {
    const width = 40;
    // 边缘一圈是「红 + 绿」的混合色，模拟原底色渗进前景
    const blended: Pixel = [100, 140, 20, 255];
    const source = paint(width, 40, (x, y) => {
      const inside = x >= 10 && x < 30 && y >= 10 && y < 30;
      if (!inside) return GREEN;
      const onEdge =
        x === 10 || x === 29 || y === 10 || y === 29;
      return onEdge ? blended : RED;
    });

    const plain = matteBackground(source, width, 40, {
      tolerance: 10,
      feather: 2,
      decontaminate: 0,
    });
    const cleaned = matteBackground(source, width, 40, {
      tolerance: 10,
      feather: 2,
      decontaminate: 1,
    });

    const i = (20 * width + 10) * 4;
    // 绿通道（原底色渗入的量）应被显著压低
    expect(cleaned.data[i + 1]).toBeLessThan(plain.data[i + 1]);
    // 红通道向纯前景色靠拢
    expect(cleaned.data[i]).toBeGreaterThan(plain.data[i]);
  });

  it("整图都是背景时全部透明，不产生 NaN", () => {
    const solid = paint(16, 16, () => GREEN);
    const { data, stats } = matteBackground(solid, 16, 16, {
      tolerance: 10,
      feather: 2,
      decontaminate: 0.5,
    });

    expect(stats.removedRatio).toBe(1);
    expect(alphaAt(data, 16, 8, 8)).toBe(0);
  });

  it("已经透明的像素不参与统计也不被写坏", () => {
    const source = paint(10, 10, (x) => (x === 0 ? [0, 0, 0, 0] : GREEN));
    const { data } = matteBackground(source, 10, 10, {
      tolerance: 10,
      feather: 0,
      decontaminate: 1,
    });

    expect(alphaAt(data, 10, 0, 0)).toBe(0);
  });

  it("尺寸为 0 时安全返回空结果", () => {
    const { data, stats } = matteBackground(new Uint8ClampedArray(0), 0, 0, {
      tolerance: 10,
      feather: 2,
      decontaminate: 0.5,
    });

    expect(data.length).toBe(0);
    expect(stats.removedRatio).toBe(0);
  });
});
