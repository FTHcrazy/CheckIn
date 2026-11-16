import { describe, expect, it } from "vitest";
import {
  FIT_PADDING,
  WHEEL_MAX_STEPS,
  WHEEL_NOTCH_PX,
  ZOOM_LIMITS,
  ZOOM_STEP,
  fitScaleFor,
  fitSubmapTransform,
  fitToRect,
  hitTestElement,
  hitTestPolygon,
  isCenterCovered,
  ELEMENT_PLACE_PAD,
  wheelZoomFactor,
  worldToScreen,
  zoomAt,
} from "./coords";

/**
 * 坐标与缩放的**手感**层单测。
 *
 * 这里的断言全部是"用户能感觉到"的量：一格滚轮走多远、要滚多少格才到上限、
 * 命中区是否等于视觉尺寸。任何一个变了，用户都会当场察觉（滚不动 / 滚过头 /
 * 点不中），但它们不会抛异常 —— 没有测试就只能靠人肉试。
 */

const CANVAS = { width: 1024, height: 900 };
const BOUNDS = { x: -512, y: -512, width: 1024, height: 1024 };

describe("wheelZoomFactor：一格滚轮走多远", () => {
  it("小 delta（触控板慢推 / 工具栏按钮的 ±1）恒走满一档 1.1", () => {
    for (const delta of [-1, 1, -3, 5, -10]) {
      const f = wheelZoomFactor(delta);
      expect(delta < 0 ? f : 1 / f).toBeCloseTo(ZOOM_STEP, 12);
    }
  });

  it("方向与操作系统一致：deltaY < 0 放大，> 0 缩小", () => {
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100)).toBeLessThan(1);
    expect(wheelZoomFactor(-100) * wheelZoomFactor(100)).toBeCloseTo(1, 12);
  });

  it("一格标准鼠标滚轮（deltaY = 100）= 2 档 = 1.21 倍", () => {
    expect(100 / WHEEL_NOTCH_PX).toBe(2);
    expect(wheelZoomFactor(-100)).toBeCloseTo(ZOOM_STEP ** 2, 12);
  });

  it("大 delta（触控板一次滑动）按比例加速，但封顶 WHEEL_MAX_STEPS 档", () => {
    expect(wheelZoomFactor(-WHEEL_NOTCH_PX * 3)).toBeCloseTo(ZOOM_STEP ** 3, 12);
    expect(wheelZoomFactor(-4000)).toBeCloseTo(ZOOM_STEP ** WHEEL_MAX_STEPS, 12);
  });

  it("delta 为 0 / 非有限值时不动（不会因为一次异常事件把画面缩放掉）", () => {
    expect(wheelZoomFactor(0)).toBe(1);
    expect(wheelZoomFactor(Number.NaN)).toBe(1);
    expect(wheelZoomFactor(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("连续滚轮从适配缩放滚到上限：不超过 25 格（否则用户会以为「滚不动了」）", () => {
    // 实测值（1024×900 画布、5 个种子）：新上限 19.72~21.83，按 1.21/格 需要 18~19 格
    const from = fitScaleFor(BOUNDS, CANVAS, FIT_PADDING); // 0.703
    const max = 21.83;
    let scale = from;
    let notches = 0;
    while (scale < max - 1e-9 && notches < 200) {
      scale = Math.min(max, scale * wheelZoomFactor(-100));
      notches += 1;
    }
    expect(notches).toBeLessThanOrEqual(25);
    expect(notches).toBeGreaterThanOrEqual(10); // 也不该"一格到顶"，那就没法微调了
  });
});

describe("zoomAt：上限处的行为", () => {
  it("到达上限后再放大，视口原样返回（不越界、也不抖动）", () => {
    const limits = { min: 0.18, max: 20 };
    const vp = { x: 0, y: 0, scale: 20 };
    const next = zoomAt(vp, { x: 512, y: 450 }, wheelZoomFactor(-4000), CANVAS, limits);
    expect(next).toBe(vp);
  });

  it("没生成区块时用兜底区间 ZOOM_LIMITS（0.1 ~ 8）", () => {
    const vp = { x: 0, y: 0, scale: 7.9 };
    const next = zoomAt(vp, { x: 512, y: 450 }, 1.5, CANVAS);
    expect(next.scale).toBe(ZOOM_LIMITS.max);
  });

  it("以光标为锚点：缩放前后光标下的世界坐标不变", () => {
    const anchor = { x: 700, y: 200 };
    const vp = fitToRect(BOUNDS, CANVAS, FIT_PADDING, { min: 0.1, max: 20 });
    const next = zoomAt(vp, anchor, 2, CANVAS, { min: 0.1, max: 20 });
    // 用 worldToScreen 反查：同一个世界点在两套视口下都落在 anchor 上
    const world = {
      x: (anchor.x - CANVAS.width / 2) / next.scale + next.x,
      y: (anchor.y - CANVAS.height / 2) / next.scale + next.y,
    };
    expect(worldToScreen(world, next, CANVAS).x).toBeCloseTo(anchor.x, 6);
    const after = worldToScreen(world, next, CANVAS);
    expect(after.x).toBeCloseTo(anchor.x, 6);
    expect(after.y).toBeCloseTo(anchor.y, 6);
  });
});

describe("hitTestElement：命中区 = 绘制尺寸", () => {
  /**
   * 素材的绘制宽度 = baseWidth × 元素 scale × 层级尺寸因子（见 lod.elementSizeFactor）。
   * 命中测试只认识一个 `scale`，所以调用方必须把因子乘进去 —— 这条断言把
   * "点得中的范围"与"看得见的范围"绑在一起。
   */
  const el = { x: 0, y: 0, width: 160, height: 93 };
  /** 郡级素材：160 → 20 世界单位宽、11.6 高（每级减半，level 3 / 4 级） */
  const scaleAtCounty = 0.125;

  it("郡级素材：中心点得中，外接矩形外 1px 点不中", () => {
    const county = { ...el, scale: scaleAtCounty };
    expect(hitTestElement({ x: 0, y: -5 }, county)).toBe(true);
    // 半宽 10；在 228% 缩放下 1px ≈ 0.44 世界单位
    expect(hitTestElement({ x: 10.4, y: -5 }, county)).toBe(false);
    expect(hitTestElement({ x: 9.6, y: -5 }, county)).toBe(true);
    // 竖直：锚点在脚底，上方 11.6 之内
    expect(hitTestElement({ x: 0, y: -11.2 }, county)).toBe(true);
    expect(hitTestElement({ x: 0, y: -12 }, county)).toBe(false);
    expect(hitTestElement({ x: 0, y: 0.5 }, county)).toBe(false); // 锚点下方不属于它
  });

  it("若忘了乘层级因子，同一片命中区会大 8 倍（回归的形态）", () => {
    const unscaled = { ...el, scale: 1 };
    expect(hitTestElement({ x: 60, y: -5 }, unscaled)).toBe(true);
    expect(hitTestElement({ x: 60, y: -5 }, { ...el, scale: scaleAtCounty })).toBe(false);
  });
});

describe("hitTestPolygon：区块点选命中（射线法，凹多边形也成立）", () => {
  /** 一个凹多边形（"U" 形凹口朝下），顶点逆时针 */
  const concave = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 2 },
    { x: 3, y: 2 },
    { x: 3, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 2 },
    { x: 0, y: 2 },
  ];

  it("顶点在内部 / 外部 / 凹口里各自判对", () => {
    expect(hitTestPolygon({ x: 2, y: 0.5 }, concave)).toBe(true); // 内部
    expect(hitTestPolygon({ x: 5, y: 1 }, concave)).toBe(false); // 外部
    expect(hitTestPolygon({ x: 2, y: 1.5 }, concave)).toBe(false); // 凹口（在包围盒内、多边形外）
  });

  it("边界与顶点：落在边上/顶点上视为命中（点选宽容）", () => {
    expect(hitTestPolygon({ x: 0, y: 0 }, concave)).toBe(true); // 顶点
    expect(hitTestPolygon({ x: 2, y: 0 }, concave)).toBe(true); // 上边
  });

  it("退化输入：顶点不足 3 个 / NaN 坐标 / 非有限点一律 false，不抛错", () => {
    expect(hitTestPolygon({ x: 0, y: 0 }, [])).toBe(false);
    expect(hitTestPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false);
    expect(hitTestPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: Number.NaN, y: 1 }])).toBe(false);
    expect(hitTestPolygon({ x: Number.NaN, y: 0 }, concave)).toBe(false);
  });
});

describe("fitSubmapTransform：子图贴合到父图区块包围盒", () => {
  /**
   * 子图是一张独立地图（本地坐标、原点在中心），贴合进父图区块时：
   * 等比缩放铺满区块包围盒 + 居中。等比保证不变形，居中保证重心对齐。
   */
  const submapBounds = { x: -256, y: -256, width: 512, height: 512 };

  it("正方形子图贴合进同比例矩形：等比缩放 = 宽比 = 高比", () => {
    const target = { x: 100, y: 200, width: 512, height: 512 };
    const fit = fitSubmapTransform(submapBounds, target);
    expect(fit.scale).toBeCloseTo(1, 12);
    expect(fit.x).toBeCloseTo(100 + 256, 12);
    expect(fit.y).toBeCloseTo(200 + 256, 12);
  });

  it("目标矩形更扁：取宽比与高比的较小者，子图完整落在目标内且不变形", () => {
    // 目标宽 256、高 512：宽比 0.5、高比 1.0 → 取 0.5，子图缩到 256 宽、居中
    const fit = fitSubmapTransform(submapBounds, { x: 0, y: 0, width: 256, height: 512 });
    expect(fit.scale).toBeCloseTo(0.5, 12);
    expect(fit.x).toBeCloseTo(128, 12);
    expect(fit.y).toBeCloseTo(256, 12);
  });

  it("子图 bounds 的**中心**映射到目标矩形中心（bounds 偏心时要补位移）", () => {
    // 【为什么这条断言改过】旧版断言「fit 与 bounds 的 x/y 无关」，即把目标中心
    // 直接当位移 —— 那等于假设"子图内容一定以坐标原点为中心"。bounds 居中时这个
    // 巧合成立（所以一直没暴露），一旦绑定一张内容偏在一侧的地图，整个子图就会
    // 整体平移出去，且不报错、只在画面上"看起来偏了"。
    const target = { x: 40, y: 60, width: 1024, height: 1024 };
    for (const bounds of [
      { x: -256, y: -256, width: 512, height: 512 },
      { x: -512, y: -768, width: 512, height: 512 },
      { x: 1000, y: 2000, width: 512, height: 512 },
    ]) {
      const fit = fitSubmapTransform(bounds, target);
      const mappedCx = (bounds.x + bounds.width / 2) * fit.scale + fit.x;
      const mappedCy = (bounds.y + bounds.height / 2) * fit.scale + fit.y;
      expect(mappedCx).toBeCloseTo(target.x + target.width / 2, 9);
      expect(mappedCy).toBeCloseTo(target.y + target.height / 2, 9);
    }
  });

  it("bounds 居中（原点在中心）时位移就等于目标中心，与旧行为一致", () => {
    const target = { x: 40, y: 60, width: 1024, height: 1024 };
    const fit = fitSubmapTransform({ x: -512, y: -512, width: 1024, height: 1024 }, target);
    expect(fit.x).toBeCloseTo(40 + 512, 12);
    expect(fit.y).toBeCloseTo(60 + 512, 12);
  });

  it("脏入参（NaN / 非正尺寸）退回恒等变换 + 目标中心，不产出 Infinity", () => {
    const fit = fitSubmapTransform({ x: 0, y: 0, width: 0, height: 512 }, { x: 0, y: 0, width: 100, height: 100 });
    expect(Number.isFinite(fit.scale)).toBe(true);
    expect(fit.scale).toBe(1);
    expect(fit.x).toBeCloseTo(50, 12);
    expect(fit.y).toBeCloseTo(50, 12);

    const nan = fitSubmapTransform({ x: 0, y: 0, width: Number.NaN, height: 512 }, { x: 0, y: 0, width: 100, height: 100 });
    expect(nan.scale).toBe(1);
  });
});

/* ─────────────── 手工落位避让（观感批次 D · P2-3） ─────────────── */

/**
 * `isCenterCovered` 与 `hitTestElement` 同构（底部锚点 + width×scale 外接盒），
 * 外加一圈呼吸边（ELEMENT_PLACE_PAD，参考实现口径 +30px）。
 * 语义只钉"落位瞬间中心被已有素材压住"这一件事 —— 移动既有素材不设防
 * （否则压住的素材永远无法拖开解围）。
 */
describe("isCenterCovered：手工落位 AABB(+30) 避让", () => {
  /** 一个 100×50、scale 1、脚底锚点在 (0, 0) 的素材：盒 = x∈[-50,50], y∈[-50,0] */
  const box = { x: 0, y: 0, width: 100, height: 50, scale: 1 };

  it("中心落在命中盒内 → 拦（聚落被压在山体正中间的形态）", () => {
    expect(isCenterCovered({ x: 0, y: -25 }, [box])).toBe(true);
    expect(isCenterCovered({ x: 0, y: -1 }, [box])).toBe(true);
  });

  it("呼吸边生效：盒外 30 以内也拦，超出 30 放行", () => {
    // 水平：半宽 50 + 30 = 80
    expect(isCenterCovered({ x: 79, y: -25 }, [box])).toBe(true);
    expect(isCenterCovered({ x: 81, y: -25 }, [box])).toBe(false);
    // 竖直：脚底下方 30 / 盒顶上方 30
    expect(isCenterCovered({ x: 0, y: 29 }, [box])).toBe(true);
    expect(isCenterCovered({ x: 0, y: 31 }, [box])).toBe(false);
    expect(isCenterCovered({ x: 0, y: -79 }, [box])).toBe(true);
    expect(isCenterCovered({ x: 0, y: -81 }, [box])).toBe(false);
  });

  it("缩放参与外接盒（命中盒 = width×scale，与 hitTestElement 同口径）", () => {
    const small = { ...box, scale: 0.5 }; // 盒 = x∈[-25,25]
    // x=70：大盒半宽 50+30=80 → 在呼吸边内拦；小盒 25+30=55 → 放行。
    // 同一点对不同 scale 的素材结论不同 —— 钉"scale 真的参与外接盒"
    expect(isCenterCovered({ x: 70, y: -10 }, [box])).toBe(true);
    expect(isCenterCovered({ x: 70, y: -10 }, [small])).toBe(false);
  });

  it("空盒列表 / 多素材任一命中即拦（some 语义）", () => {
    expect(isCenterCovered({ x: 0, y: -25 }, [])).toBe(false);
    const far = { ...box, x: 500 };
    expect(isCenterCovered({ x: 0, y: -25 }, [far, box])).toBe(true);
  });

  /* ───── QA 边界补钉：scale 极端值 + 呼吸边常量口径 ───── */

  it("scale = 0.1（极小素材）：盒缩成 10.5×6.6，只拦贴身落点", () => {
    const tiny = { x: 0, y: 0, width: 105, height: 66, scale: 0.1 };
    // 盒半宽 = 5.25 + 30；中心被压住 → 拦
    expect(isCenterCovered({ x: 0, y: -3 }, [tiny])).toBe(true);
    // 呼吸边之外（水平距 > 35.25）→ 放行
    expect(isCenterCovered({ x: 36, y: 0 }, [tiny])).toBe(false);
    // 呼吸边内（水平距 < 35.25）→ 拦
    expect(isCenterCovered({ x: 34, y: 0 }, [tiny])).toBe(true);
  });

  it("scale = 1.7（极大素材）：盒扩到 178.5×112.2，远距离落点也拦", () => {
    const huge = { x: 0, y: 0, width: 105, height: 66, scale: 1.7 };
    // 盒半宽 = 89.25 + 30 = 119.25
    expect(isCenterCovered({ x: 0, y: -100 }, [huge])).toBe(true);
    // 盒+呼吸边外（水平 125 > 119.25）→ 放行
    expect(isCenterCovered({ x: 125, y: 0 }, [huge])).toBe(false);
    // 呼吸边内 → 拦
    expect(isCenterCovered({ x: 118, y: 0 }, [huge])).toBe(true);
  });

  it("呼吸边是常量 30（世界单位），不随素材 scale 缩放", () => {
    // scale 1.7 时放行边界 = 89.25 + 30；若呼吸边也被 ×1.7（51），
    // 放行边界会变成 140.25 —— 用 125 这个点区分两种语义
    const huge = { x: 0, y: 0, width: 105, height: 66, scale: 1.7 };
    expect(isCenterCovered({ x: 125, y: 0 }, [huge])).toBe(false);
    expect(125).toBeLessThan(89.25 + ELEMENT_PLACE_PAD + ELEMENT_PLACE_PAD);
  });
});
