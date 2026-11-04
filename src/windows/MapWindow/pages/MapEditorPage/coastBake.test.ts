import { describe, expect, it, vi } from "vitest";

/**
 * 海岸烘焙（纯函数层）单元测试。
 *
 * 本文件自己 mock 一份最小 pixi（不复用 MapCanvas 那份），因为要断言的是
 * **烘焙期的场景图装配**：holder 的平移/缩放、四层顺序、纹理尺寸、销毁参数。
 * 这些在真 Pixi 上只能靠"看画面"验证，而画面上最容易出现的失败
 * （"烘焙成功但什么都没有"）恰恰**不报错** —— 只能靠数值钉死。
 */

/** 记录下来的假对象 —— 供断言读取 */
interface Fake {
  kind: string;
  children: Fake[];
  position: { x: number; y: number };
  scale: { x: number; y: number };
  alpha: number;
  filters: unknown[];
  mask: Fake | null;
  destroyed: unknown;
  calls: string[];
  width: number;
  height: number;
  blendMode: string;
  texture: unknown;
}

const blurOptions: unknown[] = [];
const createdTextures: Array<{ width: number; height: number; resolution: number; antialias: boolean }> = [];
/** 每次造的 `ColorMatrixFilter`（用来数"造了几个、销毁了没有"） */
const colorMatrixInstances: Array<{ matrix: number[]; destroy: ReturnType<typeof vi.fn> }> = [];

vi.mock("pixi.js", () => {
  class FakeContainer {
    kind = "container";
    children: Fake[] = [];
    alpha = 1;
    visible = true;
    renderable = true;
    filters: unknown[] = [];
    mask: Fake | null = null;
    destroyed: unknown = undefined;
    calls: string[] = [];
    position = {
      x: 0,
      y: 0,
      set(x: number, y: number) {
        this.x = x;
        this.y = y;
      },
    };
    scale = {
      x: 1,
      y: 1,
      set(x: number, y?: number) {
        this.x = x;
        this.y = y ?? x;
      },
    };
    anchor = {
      x: 0,
      y: 0,
      set(x: number, y: number) {
        this.x = x;
        this.y = y;
      },
    };
    width = 0;
    height = 0;
    blendMode = "normal";
    texture: unknown = null;
    addChild(...kids: unknown[]) {
      this.children.push(...(kids as Fake[]));
      return kids[0];
    }
    removeChild() {}
    destroy(options?: unknown) {
      this.destroyed = options === undefined ? true : options;
    }
  }

  class FakeGraphics extends FakeContainer {
    kind = "graphics";
    moveTo(x: number, y: number) {
      this.calls.push(`M${x},${y}`);
      return this;
    }
    bezierCurveTo(...args: number[]) {
      this.calls.push(`C${args.join(",")}`);
      return this;
    }
    closePath() {
      this.calls.push("Z");
      return this;
    }
    poly() {
      this.calls.push("poly");
      return this;
    }
    fill() {
      this.calls.push("fill");
      return this;
    }
    stroke() {
      this.calls.push("stroke");
      return this;
    }
    rect() {
      return this;
    }
    clear() {
      return this;
    }
  }

  class FakeSprite extends FakeContainer {
    kind = "sprite";
    constructor(texture?: unknown) {
      super();
      this.texture = texture ?? null;
    }
  }

  class BlurFilter {
    options: unknown;
    constructor(options?: unknown) {
      this.options = options;
      blurOptions.push(options);
    }
  }

  /**
   * 风格滤镜替身。
   *
   * 【必须补】`coastBake` 现在经 `style.ts` 的 `filterFor()` 造滤镜，而
   * `style.ts` 在模块顶层 `import { ColorMatrixFilter } from "pixi.js"` ——
   * mock 缺这个导出会在 **import 阶段**直接抛错，整个文件在收集期就红。
   */
  class ColorMatrixFilter {
    matrix: number[] = [];
    destroy = vi.fn();
    constructor() {
      colorMatrixInstances.push(this as unknown as (typeof colorMatrixInstances)[number]);
    }
  }

  class RenderTexture {
    static create(options: {
      width: number;
      height: number;
      resolution: number;
      antialias: boolean;
    }) {
      createdTextures.push(options);
      return new RenderTexture();
    }
    destroy = vi.fn();
  }

  const Texture = { EMPTY: Symbol("empty") };

  return {
    Container: FakeContainer,
    Graphics: FakeGraphics,
    Sprite: FakeSprite,
    BlurFilter,
    ColorMatrixFilter,
    RenderTexture,
    Texture,
  };
});

import {
  BAKE_MARGIN,
  BAKE_MAX_SIDE,
  LAND_TEXTURE_ALPHA,
  bakeCoast,
  bakeKeyOf,
  bakeTextureSize,
  type BakeRenderer,
} from "./coastBake";
import { generateLand } from "./land";
import type { MapLand, Rect, MapStyle } from "./types";
// 上面 vi.mock 过的那个 pixi（`{ EMPTY: Symbol("empty") }`）
import { Texture } from "pixi.js";

const BOUNDS: Rect = { x: -512, y: -512, width: 1024, height: 1024 };
const LAND: MapLand = generateLand({ seed: 20261009, bounds: BOUNDS, islands: 2 });

/** 捕获被 render 的容器，并统计 render 次数 */
function fakeRenderer() {
  const render = vi.fn((options: { container: unknown; target: unknown; clear: boolean }) => {
    captured = options.container as unknown as Fake;
  });
  const renderer: BakeRenderer = { render: render as unknown as BakeRenderer["render"] };
  return { renderer, render };
}
let captured: Fake | null = null;

describe("bakeKeyOf：指纹", () => {
  it("无陆地 / 无环时返回 null（= 不烘焙）", () => {
    expect(bakeKeyOf(null, "none", 2)).toBeNull();
    expect(bakeKeyOf({ seed: 1, polygons: [], bounds: BOUNDS }, "none", 2)).toBeNull();
  });

  it("同输入同 key；换 seed / 风格 / 分辨率都会换 key", () => {
    const base = bakeKeyOf(LAND, "none", 2) as string;
    expect(bakeKeyOf(LAND, "none", 2)).toBe(base);
    expect(bakeKeyOf({ ...LAND, seed: LAND.seed + 1 }, "none", 2)).not.toBe(base);
    expect(bakeKeyOf(LAND, "parchment", 2)).not.toBe(base);
    expect(bakeKeyOf(LAND, "ink", 2)).not.toBe(base);
    expect(bakeKeyOf(LAND, "none", 1)).not.toBe(base);
  });

  /**
   * 顶点数相同但形状不同也要换 key（PRD 原版的 `polygons[0].length` 会漏）。
   *
   * 注意指纹只取首点坐标：改**其它**顶点不会换 key。这是刻意换来的廉价
   * （O(环数)）—— 本次陆地不可编辑，形状只随 seed 变，而 seed 已在 key 里。
   * 将来支持手改陆地时，这里要升级成全量指纹或加一个 `landVersion` 计数。
   */
  it("首点坐标参与指纹：环数与顶点数都相同也能区分", () => {
    const moved: MapLand = {
      ...LAND,
      polygons: LAND.polygons.map((ring, i) =>
        i === 0 ? ring.map((p, k) => (k === 0 ? { x: p.x + 7, y: p.y - 3 } : p)) : ring,
      ),
    };
    const base = bakeKeyOf(LAND, "none", 2) as string;
    const after = bakeKeyOf(moved, "none", 2) as string;
    // 环数与各环顶点数逐字相同 —— 能区分开，靠的就是 P0 之后的坐标指纹
    expect(after.split("|").slice(0, 3)).toEqual(base.split("|").slice(0, 3));
    expect(after).not.toBe(base);
  });

  it("key 里带风格与分辨率，便于按档缓存", () => {
    const key = bakeKeyOf(LAND, "ink", 1.5) as string;
    expect(key.endsWith("ink|1.5")).toBe(true);
  });
});

describe("bakeTextureSize：尺寸与降采样", () => {
  it("常规尺寸 =（世界矩形 + 两侧 margin）× 分辨率", () => {
    const size = bakeTextureSize(BOUNDS, 2);
    expect(size.width).toBe((BOUNDS.width + BAKE_MARGIN * 2) * 2);
    expect(size.height).toBe((BOUNDS.height + BAKE_MARGIN * 2) * 2);
    expect(size.scale).toBe(2);
    expect(size.downsampled).toBe(false);
  });

  it("超过 4096 时按系数降采样，并标记 downsampled", () => {
    const size = bakeTextureSize(BOUNDS, 4); // 1152 × 4 = 4608 > 4096
    expect(size.downsampled).toBe(true);
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(BAKE_MAX_SIDE);
    // 降采样后 scale = res × (上限 / 降采样前长边) = 上限 / 世界长边
    expect(size.scale).toBeCloseTo(BAKE_MAX_SIDE / (BOUNDS.width + BAKE_MARGIN * 2), 6);
    expect(Math.max(size.width, size.height)).toBe(
      Math.round((BOUNDS.width + BAKE_MARGIN * 2) * size.scale),
    );
    expect(Math.max(size.width, size.height)).toBe(BAKE_MAX_SIDE);
  });

  it("退化矩形（宽高为 0）也不产出 0 尺寸", () => {
    const size = bakeTextureSize({ x: 0, y: 0, width: 0, height: 0 }, 1);
    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
  });
});

describe("bakeCoast：装配与坐标搬运", () => {
  it("render 被调用一次，且 target 尺寸 = bakeTextureSize 的结果", () => {
    const { renderer, render } = fakeRenderer();
    createdTextures.length = 0;
    bakeCoast({ renderer, land: LAND, style: "none", resolution: 2 });

    expect(render).toHaveBeenCalledTimes(1);
    const options = render.mock.calls[0][0] as unknown as { clear: boolean };
    expect(options.clear).toBe(true);
    const want = bakeTextureSize(LAND.bounds, 2);
    expect(createdTextures).toHaveLength(1);
    expect(createdTextures[0]).toEqual({
      width: want.width,
      height: want.height,
      resolution: 1,
      antialias: true,
    });
  });

  it("holder 承担「世界原点 → 纹理左上角」的平移，且平移量已乘 scale（坑 3）", () => {
    const { renderer } = fakeRenderer();
    const resolution = 2;
    bakeCoast({ renderer, land: LAND, style: "none", resolution });
    const holder = captured as Fake;
    const want = bakeTextureSize(LAND.bounds, resolution);

    expect(holder.scale.x).toBe(want.scale);
    expect(holder.scale.y).toBe(want.scale);
    // 漏乘 scale 是 PRD §6.1.4 的原写法：position 施加在 scale 之后，
    // 漏乘会把整张海岸推出纹理 —— 症状是"烘焙成功但画面空白且不报错"。
    expect(holder.position.x).toBeCloseTo(-(LAND.bounds.x - BAKE_MARGIN) * want.scale, 6);
    expect(holder.position.y).toBeCloseTo(-(LAND.bounds.y - BAKE_MARGIN) * want.scale, 6);
  });

  it("六层各自独立节点，顺序为 浅滩 → 等深线 → 外发光 → 底色 → 纸纹 → 内阴影 → 掩膜 → 白边", () => {
    const { renderer } = fakeRenderer();
    bakeCoast({ renderer, land: LAND, style: "none", paperTexture: null, resolution: 1 });
    const holder = captured as Fake;

    expect(holder.children.map((c) => c.kind)).toEqual([
      "graphics", // shelf
      "graphics", // isobaths
      "graphics", // glow
      "graphics", // fill
      "sprite", // 纸纹
      "graphics", // 内阴影
      "graphics", // 掩膜
      "graphics", // 白边
    ]);
    const [shelf, isobaths, glow, fill, tex, innerShade, mask, stroke] = holder.children;
    // 填充与描边必须分开：先全填再全描，否则白边会断断续续（PRD §8.2 第 2 条）
    expect(fill.calls.filter((c) => c === "fill")).toHaveLength(1);
    expect(fill.calls.filter((c) => c === "stroke")).toHaveLength(0);
    expect(stroke.calls.filter((c) => c === "stroke")).toHaveLength(1);
    // 等深线每条一段描边（3 条 × 每个环一次）
    expect(isobaths.calls.filter((c) => c === "stroke")).toHaveLength(
      3 * LAND.polygons.length,
    );
    // 三层带模糊、白边与等深线不带
    expect(shelf.filters).toHaveLength(1);
    expect(glow.filters).toHaveLength(1);
    expect(fill.filters).toHaveLength(1);
    expect(innerShade.filters).toHaveLength(1);
    expect(stroke.filters).toHaveLength(0);
    expect(isobaths.filters).toHaveLength(0);
    // 纸纹与内阴影都被陆地掩膜（内阴影必须遮：模糊会把描边洇到浅滩上）
    expect(tex.mask).toBe(mask);
    expect(innerShade.mask).toBe(mask);
    // 纸纹用 multiply 叠
    expect(tex.alpha).toBeCloseTo(LAND_TEXTURE_ALPHA, 6);
    expect(tex.blendMode).toBe("multiply");
    // 掩膜必须真的填过，否则遮罩区域是空的
    expect(mask.calls.filter((c) => c === "fill")).toHaveLength(1);
  });

  it("纸纹纹理已被销毁时退回 EMPTY，绝不把死纹理交给渲染管线", () => {
    const { renderer } = fakeRenderer();
    // 【复现 2.27.0 白屏事故】`Texture.destroy(true)` 之后 `_source` 是 null，
    // Sprite 进 batcher 时 `getAdjustedBlendModeBlend(texture._source)` 解 null 的
    // `alphaMode` 直接抛 —— 报错在 pixi 深处，画面表现却是"地图窗口起来了但全白"。
    // 所以烘焙层必须自己把死纹理认出来。
    bakeCoast({
      renderer,
      land: LAND,
      style: "none",
      paperTexture: { destroyed: true } as never,
      resolution: 1,
    });
    const holder = captured as Fake;
    const tex = holder.children[4];
    expect(tex.kind).toBe("sprite");
    expect(tex.texture).toBe(Texture.EMPTY);
  });

  it("每个环都走 moveTo + n 段贝塞尔 + closePath（不是 poly 直弦）", () => {
    const { renderer } = fakeRenderer();
    bakeCoast({ renderer, land: LAND, style: "none", resolution: 1 });
    const holder = captured as Fake;
    const [shelf] = holder.children;
    const moves = shelf.calls.filter((c) => c.startsWith("M"));
    const curves = shelf.calls.filter((c) => c.startsWith("C"));
    const closes = shelf.calls.filter((c) => c === "Z");
    expect(moves).toHaveLength(LAND.polygons.length);
    expect(closes).toHaveLength(LAND.polygons.length);
    expect(curves).toHaveLength(LAND.polygons.reduce((s, r) => s + r.length, 0));
    expect(shelf.calls.filter((c) => c === "poly")).toHaveLength(0);
  });

  it("holder 只销毁子节点，绝不带 texture: true（坑 5）", () => {
    const { renderer } = fakeRenderer();
    bakeCoast({ renderer, land: LAND, style: "none", paperTexture: null, resolution: 1 });
    const holder = captured as Fake;
    expect(holder.destroyed).toEqual({ children: true });
  });

  it("模糊参数与常量一致（改常量时此处会红，提醒同步 BAKE_MARGIN）", () => {
    blurOptions.length = 0;
    const { renderer } = fakeRenderer();
    bakeCoast({ renderer, land: LAND, style: "none", resolution: 1 });
    const strengths = (blurOptions as Array<{ strength: number }>).map((o) => o.strength);
    // 创建顺序：浅滩 → 外发光 → 陆地底色 → 陆岸内阴影
    expect(strengths).toEqual([9, 5, 1.6, 7]);
    // margin 必须 ≥ 最大模糊半径 × 3，否则模糊会被纹理边缘裁掉
    expect(BAKE_MARGIN).toBeGreaterThanOrEqual(Math.max(...strengths) * 3);
  });

  it("换风格 = 换 key（烘焙随风格重建，不随视口重建）", () => {
    const styles: MapStyle[] = ["none", "parchment", "ink"];
    const keys = new Set(styles.map((s) => bakeKeyOf(LAND, s, 2)));
    expect(keys.size).toBe(3);
  });

  /**
   * 风格矩阵在**烘焙期**乘上（PRD §6.4 / 返工项 N-2）。
   *
   * 【为什么必须真的乘进去】`bakeKey` 早就含 style 了：切一次风格就重烘一次，
   * 每次付三次高斯模糊。若 `bakeCoast` 不吃 style，三档烘出来的纹理**逐像素
   * 相同** —— 那次重烘纯属白付；而风格又只能在运行期由海岸容器补一次滤镜，
   * 于是每帧再白付一次全屏采样。两头都亏。
   *
   * 【挂载范围 = 四个"画颜色"的节点，本题就是在钉这个范围】
   * - `shelf` / `glow` / `fill`：本来是 `[blur]`，加完是 `[blur, matrix]`；
   * - `stroke`：本来无滤镜，加完是 `[matrix]`；
   * - `tex`：**不上色**（下面单独一条钉死）——纸纹是 multiply 纹理，不是颜色；
   * - `mask`：**不上色** —— 遮罩乘矩阵会污染它的 alpha。
   */
  it("风格矩阵在烘焙期乘上：模糊层之后上色、白边与等深线也上色、纸纹与遮罩都不上色", () => {
    colorMatrixInstances.length = 0;
    const { renderer } = fakeRenderer();
    bakeCoast({ renderer, land: LAND, style: "ink", resolution: 1 });

    const holder = captured as Fake;
    const [shelf, isobaths, glow, fill, tex, innerShade, mask, stroke] = holder.children;

    // 三层带模糊的：`[blur, matrix]` —— 先模糊后上色
    for (const node of [shelf, glow, fill]) {
      expect(node.filters).toHaveLength(2);
    }
    // 内阴影自己带模糊，也是 `[blur, matrix]`
    expect(innerShade.filters).toHaveLength(2);
    // 本来没模糊的白边与等深线：只有矩阵
    expect(stroke.filters).toHaveLength(1);
    expect(isobaths.filters).toHaveLength(1);
    // 纸纹不上色：multiply 是非线性的，"先乘后上色"会把暖度乘两遍
    expect(tex.filters).toHaveLength(0);
    // 遮罩不是"画出来的颜色"，乘矩阵只会污染它的 alpha
    expect(mask.filters).toHaveLength(0);

    // 一次烘焙只造一个滤镜实例，六个节点共用
    expect(colorMatrixInstances).toHaveLength(1);
    const filter = colorMatrixInstances[0];
    expect(shelf.filters[1]).toBe(filter);
    expect(glow.filters[1]).toBe(filter);
    expect(fill.filters[1]).toBe(filter);
    expect(innerShade.filters[1]).toBe(filter);
    expect(isobaths.filters[0]).toBe(filter);
    expect(stroke.filters[0]).toBe(filter);
    // 矩阵是真的填进去了（空矩阵 = 全黑，比"没生效"更糟）
    expect(filter.matrix).toHaveLength(20);
    // 渲染**之后**必须销毁：切风格/重生成会反复触发，不销毁就是每烘一次漏一个
    expect(filter.destroy).toHaveBeenCalledTimes(1);
  });

  /**
   * `renderer.render` 抛异常时的资源回收（返工项：`styleFilter` 缺 try/finally）。
   *
   * 【为什么值得单独一条】失败路径比成功路径更容易泄漏：异常一抛，
   * `render` 后面那几行就不执行了，而渲染失败通常伴随重试（换尺寸再试、
   * 用户再点一次"生成陆地"），泄漏会累积。这条用例的价值全在
   * "render 抛了，destroy 仍然被调"——没有 finally 它会红。
   */
  it("render 抛异常时：滤镜仍被销毁、holder 仍被回收、异常原样抛出", () => {
    colorMatrixInstances.length = 0;
    // 故意在把容器交出去之后抛：这样 `captured` 拿到的是**这一次**的 holder，
    // 而不是上一条用例留下的旧对象（否则断言会在错的对象上通过）。
    const render = vi.fn((options: { container: unknown }) => {
      captured = options.container as unknown as Fake;
      throw new Error("WebGL context lost");
    });
    const renderer = { render } as unknown as BakeRenderer;

    expect(() => bakeCoast({ renderer, land: LAND, style: "ink", resolution: 1 })).toThrow(
      "WebGL context lost",
    );

    expect(colorMatrixInstances).toHaveLength(1);
    expect(colorMatrixInstances[0].destroy).toHaveBeenCalledTimes(1);
    // holder 是最后一次 render 拿到的容器，它也必须被销毁（持有五组几何）
    expect((captured as Fake).destroyed).toEqual({ children: true });
  });

  it("原色：不造滤镜、不挂任何矩阵（只剩四层模糊）", () => {
    colorMatrixInstances.length = 0;
    const { renderer } = fakeRenderer();
    bakeCoast({ renderer, land: LAND, style: "none", resolution: 1 });

    expect(colorMatrixInstances).toHaveLength(0);
    const [shelf, isobaths, glow, fill, tex, innerShade, , stroke] = (captured as Fake).children;
    expect(shelf.filters).toHaveLength(1);
    expect(glow.filters).toHaveLength(1);
    expect(fill.filters).toHaveLength(1);
    expect(innerShade.filters).toHaveLength(1);
    expect(tex.filters).toHaveLength(0);
    expect(isobaths.filters).toHaveLength(0);
    expect(stroke.filters).toHaveLength(0);
  });
});
