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
  /** 平铺精灵的纹理相位 / 缩放（TilingSprite 专有） */
  tilePosition: { x: number; y: number };
  tileScale: { x: number; y: number };
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
  /**
   * 可写可读的坐标对象（`tilePosition` / `tileScale`）。
   *
   * 必须定义在工厂**内部**：`vi.mock` 的工厂会被提升到模块顶部执行，
   * 引用模块作用域的变量会命中"cannot access before initialization"。
   */
  function readablePoint() {
    return {
      x: 0,
      y: 0,
      set(x: number, y: number) {
        this.x = x;
        this.y = y;
      },
    };
  }

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

  /**
   * 纸纹平铺精灵替身。
   *
   * `tilePosition` / `tileScale` 必须是**可写可读**的坐标对象：本文件用它钉住
   * 「相位对齐世界坐标」这条意图（`tilePosition === -paperRect`），若只给一个空
   * `set`，这条断言就只能写成"调过 set"，钉不住任何东西。
   */
  class FakeTilingSprite extends FakeSprite {
    kind = "TilingSprite";
    tilePosition = readablePoint();
    tileScale = readablePoint();
    constructor(options?: { texture?: unknown; width?: number; height?: number }) {
      super(options?.texture ?? null);
      this.width = options?.width ?? 0;
      this.height = options?.height ?? 0;
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
    TilingSprite: FakeTilingSprite,
    BlurFilter,
    ColorMatrixFilter,
    RenderTexture,
    Texture,
  };
});

import {
  BAKE_MARGIN,
  BAKE_MAX_SIDE,
  COAST_ISOBATHS,
  LAND_TEXTURE_ALPHA,
  LAND_TEXTURE_FEATHER,
  LAND_TEXTURE_STEPS,
  bakeCoast,
  bakeKeyOf,
  bakeTextureSize,
  clampIsobathDistance,
  minLandToPaperClearance,
  type BakeRenderer,
} from "./coastBake";
import { createRingOffset, generateLand, pointInLand } from "./land";
import { pointInPolygon, type Point } from "./regions";
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

describe("minLandToPaperClearance / clampIsobathDistance：海岸外扩不越纸边", () => {
  it("余量 = 陆地顶点到纸边框的最小距离（非负且与手工核算一致）", () => {
    const clearance = minLandToPaperClearance(LAND);
    let expected = Infinity;
    const { x, y, width, height } = LAND.bounds;
    const right = x + width;
    const bottom = y + height;
    for (const ring of LAND.polygons) {
      for (const p of ring) {
        expected = Math.min(expected, p.x - x, right - p.x, p.y - y, bottom - p.y);
      }
    }
    expect(clearance).toBeGreaterThan(0);
    expect(clearance).toBeCloseTo(expected, 6);
  });

  it("等深线离岸距离 clamp 后不超过纸边余量", () => {
    const clearance = minLandToPaperClearance(LAND);
    for (const d of [16, 40, 70]) {
      expect(clampIsobathDistance(LAND, d)).toBe(Math.min(d, clearance));
      expect(clampIsobathDistance(LAND, d)).toBeLessThanOrEqual(clearance);
    }
  });

  it("贴着纸边的单岛会把最外圈等深线（70）真正 clamp 到余量以内", () => {
    // 单岛按可用区排布时离纸边只有 LAND_PAPER_MARGIN ≈ 56，小于最外圈等深线 70，
    // 于是 clamp 必须生效——否则海岬指向纸边时外扩层会溢出到留白/背景。
    const tight = generateLand({ seed: 20260411, bounds: BOUNDS, islands: 1 });
    const clearance = minLandToPaperClearance(tight);
    expect(clearance).toBeGreaterThan(0);
    expect(clearance).toBeLessThan(70);
    expect(clampIsobathDistance(tight, 70)).toBeCloseTo(clearance, 6);
  });
});

/** 从 bakeCoast 记录的 `M{x},{y}` / `C...,x,y` 调用里取出一个顶点 */
function vertexFromCall(call: string): { x: number; y: number } {
  if (call.startsWith("M")) {
    const [x, y] = call.slice(1).split(",").map(Number);
    return { x, y };
  }
  // C c1x,c1y,c2x,c2y,x,y —— 终点 (x,y) 才是路径顶点（前两组是控制点）
  const nums = call.slice(1).split(",").map(Number);
  return { x: nums[4], y: nums[5] };
}

describe("等深线逐环外扩：真偏移（SDF 等值线），每座岛都均匀，且永不落进陆地", () => {
  /** 点到环各边的最短距离 */
  function distToRing(p: Point, ring: Point[]): number {
    let best = Infinity;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let t = len2 < 1e-18 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
    }
    return best;
  }

  it("createRingOffset：offset(d) 顶点离原环 ≈ d（栅格精度），内缩顶点全在环内", () => {
    const land = generateLand({ seed: 20260411, bounds: BOUNDS, islands: 1 });
    const ring = land.polygons[0];
    const field = createRingOffset(ring, COAST_ISOBATHS[COAST_ISOBATHS.length - 1].distance);
    expect(field).not.toBeNull();

    // 退化与非法入参：跳过而不是产出 NaN 几何
    expect(createRingOffset(ring.slice(0, 2), 70)).toBeNull();
    expect(createRingOffset(ring, 0)).toBeNull();
    expect(field!.offset(0)).toBeNull();
    expect(field!.offset(Number.NaN)).toBeNull();

    // 外扩 16：每个顶点到原环的距离 ≈ 16（等值线即真偏移；±3 覆盖栅格分辨率
    // ≈1.5 世界单位/像素与等值线插值误差）
    const out = field!.offset(16)!;
    expect(out.length).toBeGreaterThanOrEqual(8);
    for (const p of out) {
      const d = distToRing(p, ring);
      expect(d, `外扩顶点离岸 ${d.toFixed(2)}`).toBeGreaterThan(16 - 3);
      expect(d).toBeLessThan(16 + 3);
    }

    // 内缩 16：每个顶点都在原环内，且离岸 ≥ 16 − 3（不许贴回岸线）
    const inn = field!.offset(-16)!;
    expect(inn.length).toBeGreaterThanOrEqual(8);
    for (const p of inn) {
      expect(pointInPolygon(p, ring), `内缩顶点 (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) 越出原环`).toBe(true);
      expect(distToRing(p, ring)).toBeGreaterThan(16 - 3);
    }
  });

  /**
   * 「波浪线一侧有一侧没有」的回归用例（多岛版，2.34.0 起按真偏移重写）。
   *
   * 等深线是 SDF 等值线 = 真偏移曲线：每个顶点离原岸都应 ≈ 设计距离，
   * 且一个都不落进陆地（落进去就被后画的填色盖住 = 波浪线消失）。
   * 烘焙调用按 (等深线, 环) 逐块解析：每块 = 1 段 M + n 段 C + Z + stroke；
   * 偏移环的顶点数随海岸形状浮动，不能再用"原环长度"预切块长。
   */
  it("多岛等深线：每个顶点离岸 ≈ 设计值，且一个不落进陆地", () => {
    const multi = generateLand({ seed: 9176, bounds: BOUNDS, islands: 3 });
    const d = clampIsobathDistance(multi, COAST_ISOBATHS[0].distance);
    expect(d).toBeGreaterThan(0);

    const { renderer } = fakeRenderer();
    bakeCoast({ renderer, land: multi, style: "none", resolution: 1 });
    const holder = captured as Fake;
    const isobaths = holder.children[1];

    const blocks: Point[][] = [];
    let current: Point[] | null = null;
    for (const call of isobaths.calls as string[]) {
      if (call.startsWith("M")) {
        current = [vertexFromCall(call)];
      } else if (call.startsWith("C")) {
        current!.push(vertexFromCall(call));
      } else if (call === "Z" && current) {
        blocks.push(current);
        current = null;
      }
    }
    // 三条等深线 × 三座岛，每座岛每条线一个闭合块
    expect(blocks.length).toBe(COAST_ISOBATHS.length * multi.polygons.length);

    /** 到陆地所有岸边的最短距离 */
    const distToCoast = (p: Point): number => {
      let best = Infinity;
      for (const ring of multi.polygons) {
        for (let i = 0; i < ring.length; i += 1) {
          const a = ring[i];
          const b = ring[(i + 1) % ring.length];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len2 = dx * dx + dy * dy;
          let t = len2 < 1e-18 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
        }
      }
      return best;
    };

    // 第一条等深线：逐顶点断言（顶点在 Catmull-Rom 链上，等值线点即偏移点）
    for (const block of blocks.slice(0, multi.polygons.length)) {
      expect(block.length).toBeGreaterThanOrEqual(8);
      for (const p of block) {
        expect(
          pointInLand(p, multi),
          `等深线顶点 (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) 落进陆地`,
        ).toBe(false);
        const dist = distToCoast(p);
        expect(dist, `离岸 ${dist.toFixed(1)} vs 设计 ${d.toFixed(1)}`).toBeGreaterThan(d * 0.6);
        expect(dist).toBeLessThan(d * 1.4);
      }
    }
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

  it("各层各自独立节点，顺序为 浅滩 → 等深线 → 外发光 → 底色 → 纸纹层×N → 内阴影 → 掩膜 → 白边", () => {
    const { renderer } = fakeRenderer();
    bakeCoast({ renderer, land: LAND, style: "none", paperTexture: null, resolution: 1 });
    const holder = captured as Fake;

    // 纸纹的羽化靠"N 层内缩 + 逐层降 alpha"（stencil 遮罩没有 alpha，见
    // LAND_TEXTURE_STEPS 的注释），所以纸纹是「平铺精灵 + 掩膜」成对出现
    const layerKinds = Array.from({ length: LAND_TEXTURE_STEPS }, () => [
      "TilingSprite",
      "graphics",
    ]).flat();
    expect(holder.children.map((c) => c.kind)).toEqual([
      "graphics", // shelf
      "graphics", // isobaths
      "graphics", // glow
      "graphics", // fill
      ...layerKinds, // 纸纹层 × N（精灵 + 掩膜交替）
      "graphics", // 内阴影
      "graphics", // 掩膜
      "graphics", // 白边
    ]);
    const [shelf, isobaths, glow, fill] = holder.children;
    const layers = holder.children.slice(4, 4 + LAND_TEXTURE_STEPS * 2);
    const innerShade = holder.children[4 + LAND_TEXTURE_STEPS * 2];
    const mask = holder.children[5 + LAND_TEXTURE_STEPS * 2];
    const stroke = holder.children[6 + LAND_TEXTURE_STEPS * 2];
    // 填充与描边必须分开：先全填再全描，否则白边会断断续续（PRD §8.2 第 2 条）
    expect(fill.calls.filter((c) => c === "fill")).toHaveLength(1);
    expect(fill.calls.filter((c) => c === "stroke")).toHaveLength(0);
    expect(stroke.calls.filter((c) => c === "stroke")).toHaveLength(1);
    // 等深线每条一段描边（3 条 × 每个环一次）
    expect(isobaths.calls.filter((c) => c === "stroke")).toHaveLength(
      3 * LAND.polygons.length,
    );
    // 三层带模糊、白边与等深线不带（纸纹层与遮罩都不带：见下一条用例的注释）
    expect(shelf.filters).toHaveLength(1);
    expect(glow.filters).toHaveLength(1);
    expect(fill.filters).toHaveLength(1);
    expect(innerShade.filters).toHaveLength(1);
    expect(stroke.filters).toHaveLength(0);
    expect(isobaths.filters).toHaveLength(0);
    // 每一层纸纹只被**自己那层**的遮罩抠形，且各层遮罩互不相同（不同内缩量）
    for (let i = 0; i < LAND_TEXTURE_STEPS; i += 1) {
      const tex = layers[i * 2];
      const layerMask = layers[i * 2 + 1];
      expect(tex.mask).toBe(layerMask);
      expect(layerMask.kind).toBe("graphics");
      expect(layerMask.filters).toHaveLength(0);
      expect(layerMask.calls.filter((c) => c === "fill")).toHaveLength(1);
      // 平铺 + multiply + 均分强度
      expect(tex.blendMode).toBe("multiply");
      expect(tex.alpha).toBeCloseTo(LAND_TEXTURE_ALPHA / LAND_TEXTURE_STEPS, 6);
    }
    // 内阴影仍用**未内缩**的陆地掩膜：它要贴着岸线压暗，被内缩 40 的遮罩裁掉就没内容了
    expect(innerShade.mask).toBe(mask);
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
    expect(tex.kind).toBe("TilingSprite");
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
    const [shelf, isobaths, glow, fill] = holder.children;
    const layers = holder.children.slice(4, 4 + LAND_TEXTURE_STEPS * 2);
    const innerShade = holder.children[4 + LAND_TEXTURE_STEPS * 2];
    const mask = holder.children[5 + LAND_TEXTURE_STEPS * 2];
    const stroke = holder.children[6 + LAND_TEXTURE_STEPS * 2];

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
    for (const node of layers) {
      expect(node.filters).toHaveLength(0);
    }
    // 遮罩不是"画出来的颜色"，乘矩阵只会污染它的 alpha；
    // 而且纸纹遮罩一旦带 filters 就不再走 stencil 简单路径，整块遮罩会失效
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
    const holder = captured as Fake;
    const [shelf, isobaths, glow, fill] = holder.children;
    const layers = holder.children.slice(4, 4 + LAND_TEXTURE_STEPS * 2);
    const innerShade = holder.children[4 + LAND_TEXTURE_STEPS * 2];
    const stroke = holder.children[6 + LAND_TEXTURE_STEPS * 2];
    expect(shelf.filters).toHaveLength(1);
    expect(glow.filters).toHaveLength(1);
    expect(fill.filters).toHaveLength(1);
    expect(innerShade.filters).toHaveLength(1);
    for (const node of layers) {
      expect(node.filters).toHaveLength(0);
    }
    expect(isobaths.filters).toHaveLength(0);
    expect(stroke.filters).toHaveLength(0);
  });
});

/**
 * 纸纹：平铺 + 羽化。
 *
 * 【为什么这两件事必须单独钉】它们都属于"错了也不报错"的类型，只能看画面才发
 * 现，而画面又最容易把原因归到别处：
 *   - 用 `Sprite` 把 512² 的纸纹拉伸铺满 1152² 的烘焙矩形（旧实现）不报错，
 *     只是颗粒从"沙粒"糊成"色块"（放大 2.25 倍）；
 *   - 羽化若按"给遮罩挂 `BlurFilter`"实现，在 pixi v8 里会让遮罩**整块失效**
 *     （Graphics 遮罩走 stencil，没有 alpha；带 filters 的遮罩节点不再走
 *     "直接画进 stencil"的简单路径，见 `LAND_TEXTURE_STEPS` 的注释），
 *     症状是陆地又变回一块光板 —— 同样不报错。
 */
describe("bakeCoast：纸纹平铺与羽化", () => {
  /** 从 FakeGraphics 记录的调用里取回路径顶点（M 的起点 + 每段 C 的终点） */
  function verticesOf(node: Fake): { x: number; y: number }[] {
    return node.calls
      .filter((call) => call.startsWith("M") || call.startsWith("C"))
      .map(vertexFromCall);
  }

  /** 顶点集合的轴对齐包围盒（宽高） */
  function spanOf(points: readonly { x: number; y: number }[]): {
    width: number;
    height: number;
  } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { width: maxX - minX, height: maxY - minY };
  }

  /** 纸纹层在 holder 里是「精灵 + 掩膜」交替出现，起点固定在第 5 个孩子 */
  function textureLayers(holder: Fake): { sprites: Fake[]; masks: Fake[] } {
    const slice = holder.children.slice(4, 4 + LAND_TEXTURE_STEPS * 2);
    return {
      sprites: slice.filter((_, i) => i % 2 === 0),
      masks: slice.filter((_, i) => i % 2 === 1),
    };
  }

  const PAPER_RECT: Rect = { x: -260, y: -180, width: 520, height: 360 };

  it("纸纹是平铺精灵：尺寸 = paperRect，相位对齐世界坐标（-paperRect）", () => {
    const { renderer } = fakeRenderer();
    bakeCoast({
      renderer,
      land: LAND,
      style: "none",
      paperTexture: null,
      paperRect: PAPER_RECT,
      resolution: 1,
    });
    const { sprites } = textureLayers(captured as Fake);
    expect(sprites).toHaveLength(LAND_TEXTURE_STEPS);
    for (const tex of sprites) {
      expect(tex.kind).toBe("TilingSprite");
      // 平铺而不是拉伸：颗粒永远保持 512² 纹理下的原始大小
      expect(tex.width).toBe(PAPER_RECT.width);
      expect(tex.height).toBe(PAPER_RECT.height);
      // 相位取负 = 「世界坐标 x 处的颗粒」恒等于「纹理 x 处的颗粒」。
      // 若相位跟着 paperRect 走（取正号/留在 0），切风格重烘时纸纹会在原地跳一下。
      expect(tex.tilePosition.x).toBe(-PAPER_RECT.x);
      expect(tex.tilePosition.y).toBe(-PAPER_RECT.y);
      expect(tex.blendMode).toBe("multiply");
    }
  });

  it("羽化：遮罩逐层内缩且都落在陆地内，最内层比最外层窄约一个羽化宽度", () => {
    const land = generateLand({ seed: 20260411, bounds: BOUNDS, islands: 1 });
    const { renderer } = fakeRenderer();
    bakeCoast({ renderer, land, style: "none", paperTexture: null, resolution: 1 });
    const { sprites, masks } = textureLayers(captured as Fake);

    expect(masks).toHaveLength(LAND_TEXTURE_STEPS);
    // 最外层 = 原始轮廓：纸纹的硬边停在岸线上，由海岸白边与内阴影盖住接缝
    const outer = verticesOf(masks[0]);
    expect(outer).toHaveLength(land.polygons.reduce((sum, ring) => sum + ring.length, 0) + 1);
    expect(outer[0]).toEqual(land.polygons[0][0]);

    // 逐层内缩：顶点必须**全部落在原始陆地内**（方向写反会跑到海里，
    // 表现为"海面上浮着一圈纸纹"），且包围盒逐层变小
    let prevSpan = Infinity;
    for (let i = 1; i < masks.length; i += 1) {
      const points = verticesOf(masks[i]);
      expect(points.length).toBeGreaterThan(0);
      for (const p of points) {
        expect(pointInLand(p, land)).toBe(true);
      }
      const span = spanOf(points);
      const longest = Math.max(span.width, span.height);
      expect(longest).toBeLessThan(prevSpan);
      prevSpan = longest;
    }

    // 最内层的内缩量 = (STEPS-1) × FEATHER/STEPS ≈ 32 世界单位/边，
    // 落在包围盒上的收缩下限 ≈ 2 倍内缩量（两个极点各退 32）。上限只防"挤成
    // 一小块"：真偏移会把细长半岛整根吃掉（2.34.0 起为 SDF 等值线内缩），
    // 跨度差可以远超内缩量 —— 实测最大 ≈ 162，给到 5 倍羽化宽度的余量。
    const gap = Math.max(spanOf(outer).width, spanOf(outer).height) - prevSpan;
    expect(gap).toBeGreaterThan(LAND_TEXTURE_FEATHER);
    expect(gap).toBeLessThan(LAND_TEXTURE_FEATHER * 5);

    // 每层均分强度：叠起来的总强度 ≈ LAND_TEXTURE_ALPHA
    for (const tex of sprites) {
      expect(tex.alpha * LAND_TEXTURE_STEPS).toBeCloseTo(LAND_TEXTURE_ALPHA, 6);
    }
  });

  it("退化兜底：小岛内缩后坍缩成一点时，遮罩退回原始轮廓（不能只剩一个空壳）", () => {
    // 半幅 5 的小岛，内缩 40 会把整环压成一个点。那一层若还照缩不误，
    // 遮罩就什么都画不出来 —— 岛心会出现一块"光板"（比保留硬边纹理更难看）。
    const tiny: MapLand = {
      seed: 1,
      bounds: BOUNDS,
      polygons: [
        [
          { x: -5, y: -5 },
          { x: 5, y: -5 },
          { x: 5, y: 5 },
          { x: -5, y: 5 },
        ],
      ],
    };
    const { renderer } = fakeRenderer();
    bakeCoast({ renderer, land: tiny, style: "none", paperTexture: null, resolution: 1 });
    const { masks } = textureLayers(captured as Fake);

    const outer = verticesOf(masks[0]);
    expect(outer.length).toBeGreaterThan(0);
    for (const m of masks.slice(1)) {
      // 比的是**位置**不是点数：真按 k=0 内缩时点数是同一个（moveTo + n 段曲线），
      // 只是所有点都挤到中心那一点上 —— 只看数量会漏掉这个 bug
      expect(verticesOf(m)).toEqual(outer);
    }
    expect(verticesOf(masks[masks.length - 1])[0]).toEqual({ x: -5, y: -5 });
  });
});
