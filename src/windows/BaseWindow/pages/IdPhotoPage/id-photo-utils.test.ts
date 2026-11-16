import { describe, expect, it } from "vitest";
import {
  backdropStops,
  buildIdPhotoName,
  clampDimension,
  clampOffset,
  fitRect,
  normalizeHex,
  panDelta,
  withJpegDpi,
} from "./id-photo-utils";

/** 构造一个带 APP0/JFIF 的最小 JPEG 头（units=0，密度 256，模拟 canvas 输出） */
function fakeJpeg(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, // APP0, 长度 16
    0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
    0x01, 0x01, // version 1.1
    0x00, // units = 无单位
    0x01, 0x00, // Xdensity = 256
    0x01, 0x00, // Ydensity = 256
    0x00, 0x00, // 无缩略图
    0xff, 0xda, 0x00, 0x02, // SOS（后面不再有元数据段）
  ]);
}

describe("fitRect", () => {
  it("contain 等比缩小到完全可见，水平居中", () => {
    const rect = fitRect(200, 100, 100, 100, "contain", 0, 0);
    expect(rect.width).toBe(100);
    expect(rect.height).toBe(50);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(25);
  });

  it("cover 等比放大到铺满，超出部分向两侧溢出", () => {
    const rect = fitRect(200, 100, 100, 100, "cover", 0, 0);
    expect(rect.width).toBe(200);
    expect(rect.height).toBe(100);
    expect(rect.x).toBe(-50);
    expect(rect.y).toBe(0);
  });

  it("cover 时锚点决定保留头部还是肩部", () => {
    // 源图纵向更长，cover 后高度溢出，锚点才有意义
    const top = fitRect(100, 200, 100, 100, "cover", 0, -1);
    const bottom = fitRect(100, 200, 100, 100, "cover", 0, 1);
    expect(top.y).toBeCloseTo(0, 6);
    expect(bottom.y).toBe(-100);
  });

  it("cover 时水平方向同样可以左右挪", () => {
    const left = fitRect(200, 100, 100, 100, "cover", -1, 0);
    const right = fitRect(200, 100, 100, 100, "cover", 1, 0);
    expect(left.x).toBeCloseTo(0, 6);
    expect(right.x).toBe(-100);
  });

  it("contain 留白时锚点决定留白落在哪一侧", () => {
    const top = fitRect(200, 100, 100, 100, "contain", 0, -1);
    const bottom = fitRect(200, 100, 100, 100, "contain", 0, 1);
    expect(top.y).toBeCloseTo(0, 6);
    expect(bottom.y).toBe(50);
  });

  it("锚点越界时夹到 -1..1，不把图甩出画框", () => {
    const far = fitRect(100, 200, 100, 100, "cover", -8, 8);
    expect(far.y).toBe(-100);
    // 非数字退回居中，而不是让 x 变成 NaN
    expect(fitRect(200, 100, 100, 100, "cover", Number.NaN, 0).x).toBeCloseTo(-50, 6);
  });

  it("尺寸非法时退回整块画布，不产出 NaN 坐标", () => {
    const rect = fitRect(0, 100, 100, 100, "contain", 0, 0);
    expect(rect).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });
});

describe("clampOffset", () => {
  it("夹到 [-1, 1]，非数字退回 0", () => {
    expect(clampOffset(-3)).toBe(-1);
    expect(clampOffset(3)).toBe(1);
    expect(clampOffset(0.4)).toBe(0.4);
    expect(clampOffset(Number.NaN)).toBe(0);
  });
});

describe("panDelta", () => {
  // 100×100 的成品画框，预览也是 100px（1:1），前景 cover 后高 200
  it("拖动多少像素，图就移动多少像素", () => {
    // 余量 room = 100 - 200 = -100，向下拖 10px → 锚点 -0.2
    expect(panDelta(10, 100, 100, 200)).toBeCloseTo(-0.2, 6);
    // 换算回坐标位移：y = (100-200)*(1+(-0.2))/2 = -40，比居中(-50) 下移 10
    const dy = (-100 * (1 + -0.2)) / 2 - -50;
    expect(dy).toBeCloseTo(10, 6);
  });

  it("预览被缩小 2 倍时，同样的屏幕位移对应两倍成品像素", () => {
    expect(panDelta(10, 100, 50, 200)).toBeCloseTo(-0.4, 6);
  });

  it("前景与画框同高时没有可动余量，返回 0", () => {
    expect(panDelta(10, 100, 100, 100)).toBe(0);
  });

  it("预览尺寸为 0 时不做除法", () => {
    expect(panDelta(10, 100, 0, 200)).toBe(0);
  });
});

describe("backdropStops", () => {
  it("纯色两端同色", () => {
    const stops = backdropStops("#438EDB", "solid");
    expect(stops.from).toEqual(stops.to);
    expect(stops.from).toEqual({ r: 0x43, g: 0x8e, b: 0xdb });
  });

  it("上下渐变上深下浅", () => {
    const stops = backdropStops("#808080", "gradient-y");
    expect(stops.from.r).toBeLessThan(0x80);
    expect(stops.to.r).toBeGreaterThan(0x80);
  });

  it("中心渐变中心亮四周深", () => {
    const stops = backdropStops("#808080", "gradient-radial");
    expect(stops.from.r).toBeGreaterThan(stops.to.r);
  });

  it("非法底色退回白色而不是崩掉", () => {
    const stops = backdropStops("not-a-color", "solid");
    expect(stops.from).toEqual({ r: 255, g: 255, b: 255 });
  });
});

describe("clampDimension", () => {
  it("夹到 32-4000，非法值用 fallback", () => {
    expect(clampDimension(100, 295)).toBe(100);
    expect(clampDimension(5, 295)).toBe(32);
    expect(clampDimension(99999, 295)).toBe(4000);
    expect(clampDimension(Number.NaN, 295)).toBe(295);
    expect(clampDimension(100.6, 295)).toBe(101);
  });
});

describe("withJpegDpi", () => {
  it("改写已有 JFIF 头的 units 与 X/Y 密度", () => {
    const source = fakeJpeg();
    const out = withJpegDpi(source, 300);

    // APP0 段起点在 index 2：units=13，X=14/15，Y=16/17
    expect(out[13]).toBe(1);
    expect(out[14]).toBe(1); // 300 >> 8
    expect(out[15]).toBe(44); // 300 & 0xff
    expect(out[16]).toBe(1);
    expect(out[17]).toBe(44);
    expect(out.length).toBe(source.length);
  });

  it("不修改入参（同一个 source 连算两次结果一致）", () => {
    const source = fakeJpeg();
    withJpegDpi(source, 300);
    expect(source[13]).toBe(0);
    expect(source[15]).toBe(0);
  });

  it("没有 JFIF 段时在 SOI 之后插入一个", () => {
    const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]);
    const out = withJpegDpi(bare, 300);

    expect(out.length).toBe(bare.length + 18);
    expect(Array.from(out.subarray(0, 4))).toEqual([0xff, 0xd8, 0xff, 0xe0]);
    expect(out[13]).toBe(1);
    // 原始 SOS 段被完整挪到 APP0 之后
    expect(Array.from(out.subarray(out.length - 4))).toEqual([0xff, 0xda, 0x00, 0x02]);
  });

  it("非 JPEG 数据原样返回", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    expect(withJpegDpi(png, 300)).toBe(png);
  });

  it("DPI 超范围时夹到 1-1200", () => {
    const out = withJpegDpi(fakeJpeg(), 5000);
    expect((out[14] << 8) | out[15]).toBe(1200);
  });
});

describe("buildIdPhotoName", () => {
  it("拼出尺寸与底色", () => {
    expect(buildIdPhotoName("照片.png", 295, 413, "白底")).toBe(
      "照片-295x413-白底.jpg",
    );
  });

  it("透明底恒为 PNG", () => {
    expect(buildIdPhotoName("a.jpeg", 295, 413, "白底", true)).toBe(
      "a-295x413-透明底.png",
    );
  });

  it("无扩展名或空名也有合理兜底", () => {
    expect(buildIdPhotoName("", 100, 100, "红底")).toBe("photo-100x100-红底.jpg");
  });
});

describe("normalizeHex", () => {
  it("三位缩写补全为大写六位", () => {
    expect(normalizeHex("#abc")).toBe("#AABBCC");
  });

  it("非法输入退回白色", () => {
    expect(normalizeHex("zzz")).toBe("#FFFFFF");
  });
});
