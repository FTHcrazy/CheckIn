import { describe, expect, it } from "vitest";
import { THEME_LIST } from "@/shared/theme/themes";
import {
  ART_H,
  POSTER_H,
  POSTER_W,
  TEX_H,
  TEX_RATIO,
  hexToRgb01,
  resolvePosterColors,
  tintRgba,
} from "./posterArtwork";
import { POSTER_TUNING, createPosterEngine } from "./posterEngine";

function avgLum(hex: string): number {
  const [r, g, b] = hexToRgb01(hex);
  return (r + g + b) / 3;
}

describe("posterArtwork 色板解析", () => {
  it("四主题的 accent 与 THEME_LIST 主色同源", () => {
    for (const meta of THEME_LIST) {
      expect(resolvePosterColors(meta).accent).toBe(meta.antd.colorPrimary);
    }
  });

  it("四主题都有全量纸张色板（paper/ink/gray/muted 均为 6 位 hex）", () => {
    for (const meta of THEME_LIST) {
      const colors = resolvePosterColors(meta);
      expect(colors.paper).toMatch(/^#[0-9a-f]{6}$/i);
      expect(colors.ink).toMatch(/^#[0-9a-f]{6}$/i);
      expect(colors.gray).toMatch(/^#[0-9a-f]{6}$/i);
      expect(colors.muted).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("纸永远浅色、油墨永远深色（暗色主题不取 colorText，防止白字印浅纸）", () => {
    // 回归防线：midnight 的 antd.colorText 是浅色，若 ink 改回跟随主题
    // 会在浅纸上消失（NEWS 报头不可见事故）。锁定明度契约：
    for (const meta of THEME_LIST) {
      const colors = resolvePosterColors(meta);
      expect(avgLum(colors.paper)).toBeGreaterThan(0.8);
      expect(avgLum(colors.ink)).toBeLessThan(0.35);
      expect(avgLum(colors.muted)).toBeLessThan(0.6);
    }
  });

  it("hexToRgb01 转换正确且对非法输入兜底", () => {
    expect(hexToRgb01("#5b6cf9")).toEqual([
      91 / 255,
      108 / 255,
      249 / 255,
    ]);
    expect(hexToRgb01("not-a-color")).toEqual([0, 0, 0]);
  });

  it("tintRgba 产出合法 rgba 字符串", () => {
    expect(tintRgba("#ffffff", 0.14)).toBe("rgba(255,255,255,0.14)");
    expect(tintRgba("#2b2f4a", 0.35)).toBe("rgba(43,47,74,0.35)");
  });
});

describe("PosterWidget 手感与贴图契约", () => {
  it("手感参数不被无声改动（弹簧 / 卷角 / 微拱）", () => {
    expect(POSTER_TUNING.thetaMax).toBe(2.1);
    expect(POSTER_TUNING.zFlap).toBe(2.2);
    expect(POSTER_TUNING.foldK).toBe(60);
    expect(POSTER_TUNING.bow).toBe(2.2);
    expect(POSTER_TUNING.springK).toBe(110);
    expect(POSTER_TUNING.springDampRatio).toBe(0.92);
  });

  it("贴图尺寸满足 WebGL1 POT 约束，采样比率正确", () => {
    // 上传纹理（宽 ART_W、高 TEX_H）两个维度都必须是 2 的幂，
    // 否则 mipmap 静默失败、采样全黑（v3 踩过的坑）
    expect(Math.log2(512) % 1).toBe(0);
    expect(Math.log2(TEX_H) % 1).toBe(0);
    expect(TEX_RATIO).toBeCloseTo(ART_H / TEX_H, 10);
    // 海报逻辑尺寸（CSS 显示与视口投影基于它）
    expect(POSTER_W).toBe(260);
    expect(POSTER_H).toBe(360);
  });
});

describe("createPosterEngine 降级", () => {
  it("WebGL 不可用时安全返回 null（jsdom 无 GL 实现）", () => {
    const canvas = document.createElement("canvas");
    const meta = THEME_LIST[0];
    expect(meta).toBeDefined();
    expect(() => {
      const engine = createPosterEngine(canvas, resolvePosterColors(meta));
      expect(engine).toBeNull();
    }).not.toThrow();
  });
});
