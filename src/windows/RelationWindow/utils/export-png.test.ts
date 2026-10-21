import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EXPORT_HIDE_SELECTORS,
  EXPORT_NEUTRALIZE_SELECTORS,
  exportFileName,
  isRectUsable,
  pixelSize,
  resolveCaptureRect,
  sanitizeFileName,
} from "./export-png";

/** 覆盖物清单的实际落点：清单里每条都必须在 scss 里有对应规则，否则是死规则 */
const CANVAS_SCSS = readFileSync(
  resolve(process.cwd(), "src/windows/RelationWindow/components/RelationCanvas/index.scss"),
  "utf8",
);

describe("resolveCaptureRect：DOMRect → capturePage 整数矩形", () => {
  it("小数两端整取后再相减，不各取宽高（否则右缘少半像素变白边）", () => {
    const rect = resolveCaptureRect({ left: 10.6, top: 20.4, width: 300.4, height: 200.6 });
    expect(rect).toEqual({ x: 11, y: 20, width: 300, height: 201 });
    // 右缘 = 311、下缘 = 221：与 box 的实际边界 311 / 221 对齐
    expect(rect.x + rect.width).toBe(311);
    expect(rect.y + rect.height).toBe(221);
  });

  it("负坐标 clamp 到 0（画布被横向滚出可视区时 getBoundingClientRect 会给负数）", () => {
    const rect = resolveCaptureRect({ left: -40, top: -12, width: 300, height: 200 });
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    // 右侧跟着缩：-40 + 300 = 260
    expect(rect.width).toBe(260);
    expect(rect.height).toBe(188);
  });

  it("超出视口的部分被裁掉（Electron 对越界矩形不报错，只给一张填黑的图）", () => {
    const rect = resolveCaptureRect(
      { left: 900, top: 600, width: 400, height: 300 },
      { width: 1000, height: 800 },
    );
    expect(rect).toEqual({ x: 900, y: 600, width: 100, height: 200 });
  });

  it("宽高为 0 时兜到 1（Electron 会返回空图，走失败比让用户等重试好）", () => {
    expect(resolveCaptureRect({ left: 5, top: 5, width: 0, height: 0 })).toEqual({
      x: 5,
      y: 5,
      width: 1,
      height: 1,
    });
  });

  it("NaN 坐标不传染（布局算错时宁可截左上角，也不要整张 NaN）", () => {
    const rect = resolveCaptureRect({
      left: Number.NaN,
      top: Number.NaN,
      width: 300,
      height: 200,
    });
    expect(Number.isFinite(rect.x)).toBe(true);
    expect(Number.isFinite(rect.y)).toBe(true);
    expect(rect.width).toBeGreaterThan(0);
  });

  it("太小 / 正常：由 isRectUsable 判断要不要提示", () => {
    expect(isRectUsable({ x: 0, y: 0, width: 120, height: 40 })).toBe(false);
    expect(isRectUsable({ x: 0, y: 0, width: 600, height: 400 })).toBe(true);
  });
});

describe("pixelSize：像素 = CSS × DPR（RG-X-01 改写口径）", () => {
  it("1× 屏即 1×（1440×860 视口导出就是 1440×860，不假装 2×）", () => {
    expect(pixelSize({ x: 0, y: 0, width: 1440, height: 860 }, 1)).toEqual({
      width: 1440,
      height: 860,
    });
  });

  it("2× 屏按 DPR 原生放大", () => {
    expect(pixelSize({ x: 0, y: 0, width: 1440, height: 860 }, 2)).toEqual({
      width: 2880,
      height: 1720,
    });
  });

  it("DPR 拿不到（0 / NaN）时退回 1，不产生 0 像素图", () => {
    expect(pixelSize({ x: 0, y: 0, width: 100, height: 50 }, 0)).toEqual({
      width: 100,
      height: 50,
    });
    expect(pixelSize({ x: 0, y: 0, width: 100, height: 50 }, Number.NaN)).toEqual({
      width: 100,
      height: 50,
    });
  });
});

describe("sanitizeFileName：文件名消毒（RG-X-09）", () => {
  it("九个非法字符（含反斜杠）全部替换为 _", () => {
    const raw = '夜/行:记*录?"<>|\\';
    const out = sanitizeFileName(raw);
    // 逐个字符断言而不是数下划线：这类测试最怕「期望值本身数错」
    expect(out).not.toMatch(/[\\/:*?"<>|]/);
    expect(out.match(/_/g)).toHaveLength(9);
    expect(out.endsWith(".png")).toBe(true);
  });

  it("单字符场景可读地对齐", () => {
    expect(sanitizeFileName("夜/行:记")).toBe("夜_行_记.png");
  });

  it("已带 .png 不产生 .png.png（大小写都认）", () => {
    expect(sanitizeFileName("人物关系图.png")).toBe("人物关系图.png");
    expect(sanitizeFileName("人物关系图.PNG")).toBe("人物关系图.png");
  });

  it("空 / 纯空白 / 只有非法字符时回落默认名", () => {
    expect(sanitizeFileName("")).toBe("人物关系图.png");
    expect(sanitizeFileName("   ")).toBe("人物关系图.png");
    expect(sanitizeFileName("///")).toBe("___.png");
  });

  it("换行 / 连空白折叠成一个空格（书名里有换行时文件名不该断成两截）", () => {
    expect(sanitizeFileName("  夜行\n记录  ")).toBe("夜行 记录.png");
  });

  it("扩展名参数化（未来导 SVG 不用改实现）", () => {
    expect(sanitizeFileName("人物关系图", "svg")).toBe("人物关系图.svg");
  });
});

describe("exportFileName：默认名带书名", () => {
  it("书名正常时拼在后面", () => {
    expect(exportFileName("夜行记")).toBe("夜行记 人物关系图.png");
  });

  it("书名非法字符被消毒，不会让保存框直接失败", () => {
    expect(exportFileName("夜/行:记")).toBe("夜_行_记 人物关系图.png");
  });

  it("没有书名时用默认名", () => {
    expect(exportFileName("   ")).toBe("人物关系图.png");
  });
});

describe("覆盖物清单：屏幕上的辅助不该进图", () => {
  it("工具栏 / 缩放控件 / 密度提示条 / 连线手柄都在隐藏清单里", () => {
    expect(EXPORT_HIDE_SELECTORS).toContain(".rel-canvas__toolbar");
    expect(EXPORT_HIDE_SELECTORS).toContain(".react-flow__controls");
    expect(EXPORT_HIDE_SELECTORS).toContain(".rel-node__handle");
    expect(EXPORT_HIDE_SELECTORS).toContain(".rel-canvas__dense");
  });

  it("选中态是压样式而不是隐藏（整块隐藏会把选中那条边一起抹掉）", () => {
    expect(EXPORT_NEUTRALIZE_SELECTORS).toContain(".react-flow__node.selected");
    expect(EXPORT_NEUTRALIZE_SELECTORS).toContain(".react-flow__edge.selected");
    expect(EXPORT_HIDE_SELECTORS).not.toContain(".react-flow__edge.selected");
  });

  it("两份清单没有重复项（重复意味着规则会互相打架）", () => {
    for (const selector of EXPORT_HIDE_SELECTORS) {
      expect(EXPORT_NEUTRALIZE_SELECTORS).not.toContain(selector);
    }
  });

  it("清单里每一条都在 scss 里有落点（否则是条死规则，截图时覆盖物照样进图）", () => {
    for (const selector of EXPORT_HIDE_SELECTORS) {
      expect(CANVAS_SCSS).toContain(selector);
    }
    for (const selector of EXPORT_NEUTRALIZE_SELECTORS) {
      expect(CANVAS_SCSS).toContain(selector);
    }
  });

  it("scss 用 visibility:hidden 而不是 display:none（后者会 reflow，截图期间图面会挪）", () => {
    const block = CANVAS_SCSS.slice(
      CANVAS_SCSS.indexOf(".rel-canvas.is-exporting"),
      CANVAS_SCSS.length,
    );
    expect(block).toContain("visibility: hidden");
    expect(block).not.toContain("display: none");
  });
});
