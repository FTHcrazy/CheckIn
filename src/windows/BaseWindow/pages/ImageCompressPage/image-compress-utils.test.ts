import { describe, expect, it } from "vitest";
import {
  archiveStamp,
  buildOutputName,
  clampInt,
  formatBytes,
  normalizeFormat,
  outputNameOf,
  savedPercent,
  scaleSize,
  scaledSize,
  searchMaxFloat,
  searchMaxInt,
  stripExtension,
  summarize,
  uniqueName,
  type Probe,
} from "./image-compress-utils";

describe("formatBytes", () => {
  it("按 B / KB / MB 三档展示", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.00 MB");
  });

  it("非法输入给占位符，不显示 NaN", () => {
    expect(formatBytes(Number.NaN)).toBe("-");
    expect(formatBytes(-1)).toBe("-");
  });
});

describe("savedPercent", () => {
  it("变小为正数，变大 为负数（换格式后确实会变大）", () => {
    expect(savedPercent(1000, 400)).toBe(60);
    expect(savedPercent(1000, 1000)).toBe(0);
    expect(savedPercent(1000, 1200)).toBe(-20);
  });

  it("原图体积为 0 时返回 0，不产生 Infinity", () => {
    expect(savedPercent(0, 0)).toBe(0);
  });
});

describe("scaleSize", () => {
  it("按最大宽高等比收缩", () => {
    expect(scaleSize(4000, 2000, 1000, 0)).toEqual({ width: 1000, height: 500 });
    expect(scaleSize(4000, 2000, 0, 500)).toEqual({ width: 1000, height: 500 });
  });

  it("宽高同时限制时取更严的一侧", () => {
    expect(scaleSize(4000, 2000, 1000, 400)).toEqual({ width: 800, height: 400 });
  });

  it("只缩不放", () => {
    expect(scaleSize(100, 50, 1000, 1000)).toEqual({ width: 100, height: 50 });
  });

  it("限制为 0 表示不限", () => {
    expect(scaleSize(100, 50, 0, 0)).toEqual({ width: 100, height: 50 });
  });
});

describe("scaledSize", () => {
  it("按倍率取整，最小 1px", () => {
    expect(scaledSize(1000, 500, 0.5)).toEqual({ width: 500, height: 250 });
    expect(scaledSize(3, 3, 0.1)).toEqual({ width: 1, height: 1 });
  });

  it("非法倍率按 1 处理", () => {
    expect(scaledSize(10, 10, 0)).toEqual({ width: 10, height: 10 });
    expect(scaledSize(10, 10, Number.NaN)).toEqual({ width: 10, height: 10 });
  });
});

describe("normalizeFormat", () => {
  it("auto 时保持受支持的格式", () => {
    expect(normalizeFormat("auto", "image/png")).toBe("image/png");
    expect(normalizeFormat("auto", "image/jpeg")).toBe("image/jpeg");
    expect(normalizeFormat("auto", "IMAGE/WEBP")).toBe("image/webp");
  });

  it("auto 遇到不支持的原格式退到 JPEG", () => {
    expect(normalizeFormat("auto", "image/gif")).toBe("image/jpeg");
    expect(normalizeFormat("auto", "image/bmp")).toBe("image/jpeg");
    expect(normalizeFormat("auto", "")).toBe("image/jpeg");
  });

  it("显式指定格式时忽略原格式", () => {
    expect(normalizeFormat("image/webp", "image/png")).toBe("image/webp");
  });
});

describe("文件名", () => {
  it("去掉扩展名", () => {
    expect(stripExtension("照片.png")).toBe("照片");
    expect(stripExtension("a.b.c.jpg")).toBe("a.b.c");
    expect(stripExtension("无扩展名")).toBe("无扩展名");
  });

  it("按输出格式生成下载名", () => {
    expect(buildOutputName("照片.png", "image/jpeg")).toBe("照片-压缩.jpg");
    expect(buildOutputName("照片", "image/webp")).toBe("照片-压缩.webp");
  });

  it("重名补序号，避免 zip 内互相覆盖", () => {
    const used = new Set<string>();
    expect(uniqueName("a.png", used)).toBe("a.png");
    expect(uniqueName("a.png", used)).toBe("a-2.png");
    expect(uniqueName("a.png", used)).toBe("a-3.png");
  });

  it("outputNameOf 与列表下载口径一致", () => {
    expect(outputNameOf({ name: "x.png", outType: "image/png" })).toBe(
      "x-压缩.png",
    );
  });
});

describe("summarize", () => {
  it("只统计已完成的条目（处理中的体积是旧值）", () => {
    const summary = summarize([
      { status: "done", origSize: 1000, outSize: 400 },
      { status: "done", origSize: 500, outSize: 500 },
      { status: "working", origSize: 9999, outSize: 0 },
      { status: "error", origSize: 8888, outSize: 0 },
    ]);
    expect(summary.doneCount).toBe(2);
    expect(summary.totalCount).toBe(4);
    expect(summary.origSize).toBe(1500);
    expect(summary.outSize).toBe(900);
    expect(summary.savedBytes).toBe(600);
    expect(summary.savedPercent).toBe(40);
  });

  it("全部未完成时体积为 0，不产生负数", () => {
    expect(summarize([{ status: "pending", origSize: 100, outSize: 0 }])).toEqual({
      doneCount: 0,
      totalCount: 1,
      origSize: 0,
      outSize: 0,
      savedBytes: 0,
      savedPercent: 0,
    });
  });
});

describe("clampInt", () => {
  it("越界与非法值都收敛到安全范围", () => {
    expect(clampInt(0, 2, 256, 256)).toBe(2);
    expect(clampInt(999, 2, 256, 256)).toBe(256);
    expect(clampInt(Number.NaN, 2, 256, 256)).toBe(256);
    expect(clampInt(80.4, 1, 100, 100)).toBe(80);
  });
});

describe("searchMaxInt（PNG 色数二分）", () => {
  it("找到能满足目标体积的最大整数", async () => {
    // 体积与色数线性相关：每色 1000 字节，目标 50KB → 恰好 50 色
    const result = await searchMaxInt<number>(
      async (colors) => ({ size: colors * 1000, payload: colors }),
      { min: 2, max: 256, targetBytes: 50_000, steps: 10 },
    );
    expect(result?.value).toBe(50);
    expect(result?.size).toBe(50_000);
  });

  it("全部超标时返回 null（由调用方降级）", async () => {
    const result = await searchMaxInt<number>(
      async (colors) => ({ size: colors * 1000, payload: colors }),
      { min: 2, max: 256, targetBytes: 100, steps: 8 },
    );
    expect(result).toBeNull();
  });

  it("返回的是命中那一次的产物，不是参数（避免收敛后再补编一遍）", async () => {
    const probe = async (colors: number): Promise<Probe<string>> => ({
      size: colors * 1000,
      payload: `blob-${colors}`,
    });
    const result = await searchMaxInt<string>(probe, {
      min: 2,
      max: 64,
      targetBytes: 10_000,
      steps: 8,
    });
    expect(result).not.toBeNull();
    expect(result?.payload).toBe(`blob-${result?.value}`);
  });

  it("步数用满即停，不会无限探测", async () => {
    let calls = 0;
    await searchMaxInt<number>(
      async (colors) => {
        calls += 1;
        return { size: colors, payload: colors };
      },
      { min: 2, max: 256, targetBytes: 128, steps: 4 },
    );
    expect(calls).toBe(4);
  });
});

describe("searchMaxFloat（质量 / 缩放二分）", () => {
  it("收敛到目标附近且结果一定达标", async () => {
    const result = await searchMaxFloat<number>(
      async (quality) => ({ size: Math.round(quality * 100_000), payload: quality }),
      { min: 0.05, max: 1, targetBytes: 50_000, steps: 8 },
    );
    expect(result).not.toBeNull();
    expect(result!.size).toBeLessThanOrEqual(50_000);
    // 8 步二分后应落在 0.5 附近（区间宽度的 1/256）
    expect(result!.value).toBeGreaterThan(0.49);
    expect(result!.value).toBeLessThanOrEqual(0.5);
  });

  it("全部超标时返回 null", async () => {
    const result = await searchMaxFloat<number>(
      async (quality) => ({ size: Math.round(quality * 100_000), payload: quality }),
      { min: 0.05, max: 1, targetBytes: 10, steps: 8 },
    );
    expect(result).toBeNull();
  });
});

describe("archiveStamp", () => {
  it("生成分钟级时间戳，用于 zip 文件名", () => {
    expect(archiveStamp(new Date(2026, 10, 4, 9, 5))).toBe("20261104-0905");
  });
});
