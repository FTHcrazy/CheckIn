/**
 * 地形图标补画层单测（AGENTS.md 6.6：纯函数必须独立单测）
 *
 * 守卫的是本次修复的那类问题：GL 模式下 2D 层只画河流 / 叠加符号 / 图框，
 * **逐格地形纹理一个都没画** → 地图退化成一片渐变色域，用户认不出哪儿是森林、哪儿是沙丘。
 *
 * 因此把两条不变量钉死：
 * ① `drawTerrainIcons` 必须跳过水体（GL 侧已有动态水纹，再叠一层是重复绘制）；
 * ② 每一个陆地地形都必须至少画出一笔 —— 新增地形却忘了配图标，测试立刻红。
 *
 * 另外两组（本轮修复新增）：
 * ③ 地表不再刷河面（河只由 ribbon 画一次），否则两套水体并排错位；
 * ④ 图标不在「GL 渲染为水面」的格上落笔（水里不能长山）。
 *
 * jsdom 无 canvas 实现（getContext 返回 null），故这里用一个「记录调用」的假 ctx，
 * 不断言像素，只断言绘制调用序列。
 */
import { describe, expect, it } from "vitest";
import { drawTerrain, drawTerrainIcons, drawRiverRibbons, riverHalfWidth, sampleIconSites } from "./map-render";
import { TERRAIN_BORDER_COLORS, TERRAIN_COLORS, TERRAIN_TEXTURE } from "./map-symbols";
import { CELL, fillRiverBase, T_DESERT, T_FOREST, T_GRASS, T_LAKE, T_LAVA, T_MARSH, T_MOUNTAIN, T_RIVER, T_RUINS, T_SEA, T_SNOW, T_SNOWFIELD, type BuiltWorld } from "./map-terrain";

/** 水体纹理：与 map-render 内 WATER_TEXTURES 对应 */
const WATER_TEXTURES = ["wave", "ripple", "ribbon"];
/** 真正落笔的调用（save / restore / 属性赋值不算「画了东西」） */
const DRAW_OPS = new Set([
  "beginPath",
  "moveTo",
  "lineTo",
  "quadraticCurveTo",
  "arc",
  "ellipse",
  "closePath",
  "fill",
  "stroke",
  "fillRect",
  "fillText",
]);

type FakeCtx = CanvasRenderingContext2D & { calls: string[] };

/** 记录所有方法调用的假 ctx（属性赋值被吞掉，方法一律 no-op） */
function fakeCtx(): FakeCtx {
  const calls: string[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(_target, prop) {
      if (prop === "calls") return calls;
      // 一律 no-op：只关心「调了哪些方法」，不关心参数
      return () => {
        calls.push(String(prop));
      };
    },
    set() {
      return true;
    },
  });
  return ctx as unknown as FakeCtx;
}

/** 造一个 size×size 的纯色世界（features 为空：本层只关心地形图标） */
function solidWorld(terrain: number, size = 8): BuiltWorld {
  const n = size * size;
  const cells = new Uint8Array(n);
  cells.fill(terrain);
  return {
    cols: size,
    rows: size,
    cell: CELL,
    width: size * CELL,
    height: size * CELL,
    cells,
    elev: new Float32Array(n).fill(0.5),
    seed: "T",
    templates: {},
    features: [],
    snum: 0x12345678,
  };
}

function drawOps(calls: string[]): string[] {
  return calls.filter((c) => DRAW_OPS.has(c));
}

describe("drawTerrainIcons：GL 补画层的地形可识别性", () => {
  it("水体（大海 / 湖泊 / 河流）一个调用都不发 —— GL 侧已有水纹，不能重复叠画", () => {
    for (const t of [T_SEA, T_LAKE, T_RIVER]) {
      expect(WATER_TEXTURES).toContain(TERRAIN_TEXTURE[t]);
      const ctx = fakeCtx();
      drawTerrainIcons(ctx, solidWorld(t));
      expect(ctx.calls.length).toBe(0);
    }
  });

  it("每一个陆地地形都必须画出图标（新增地形忘配图标会立刻失败）", () => {
    const land = [
      T_DESERT,
      T_GRASS,
      T_FOREST,
      T_MOUNTAIN,
      T_SNOW,
      T_SNOWFIELD,
      T_LAVA,
      T_MARSH,
      T_RUINS,
    ];
    for (const t of land) {
      const ctx = fakeCtx();
      // ⚠️ 稀疏抽样后 8×8（4×4 候选点）太小：最低概率的雪原冰晶（22%）有 1.9% 概率
      //    一个都不出，会让「忘了配图标」的守卫变成掷骰子。放大到 24×24 才有统计意义。
      drawTerrainIcons(ctx, solidWorld(t, 24));
      expect(
        drawOps(ctx.calls).length,
        `地形 #${t}（${TERRAIN_TEXTURE[t]}）没有画出任何图标`,
      ).toBeGreaterThan(0);
    }
  });

  it("确定性：同 seed 同 cells 必出同调用序列（对齐 RM8 复现性）", () => {
    const a = recCtx();
    const b = recCtx();
    drawTerrainIcons(a, solidWorld(T_FOREST, 16));
    drawTerrainIcons(b, solidWorld(T_FOREST, 16));
    expect(a.calls.length).toBeGreaterThan(0);
    // 比方法名更强：连坐标/尺寸一起比，抖动一旦不确定这里立刻红
    expect(JSON.stringify(a.ops)).toBe(JSON.stringify(b.ops));
  });

  it("细度守卫：每格屏幕像素过低（远景）时整层跳过绘制", () => {
    const world = solidWorld(T_FOREST);
    const far = fakeCtx();
    drawTerrainIcons(far, world, "A", 0.1); // 16 × 0.1 = 1.6px / 格
    expect(far.calls.length).toBe(0);
    const near = fakeCtx();
    drawTerrainIcons(near, world, "A", 1); // 16px / 格
    expect(near.calls.length).toBeGreaterThan(0);
  });

  it("空地（无世界尺寸为 0）与空 cells 不抛错", () => {
    const ctx = fakeCtx();
    const world = solidWorld(T_GRASS);
    world.cells = new Uint8Array(0);
    world.cols = 0;
    world.rows = 0;
    expect(() => drawTerrainIcons(ctx, world)).not.toThrow();
  });

  it("水体掩码命中（GL 把该格画成了水面）时不落笔 —— 水里不能长山", () => {
    const world = solidWorld(T_MOUNTAIN, 8);
    const all = fakeCtx();
    drawTerrainIcons(all, world, "A", 1, new Uint8Array(64).fill(1));
    expect(all.calls.length).toBe(0);

    const none = fakeCtx();
    drawTerrainIcons(none, world, "A", 1, new Uint8Array(64));
    const half = fakeCtx();
    const mask = new Uint8Array(64);
    for (let i = 0; i < 32; i++) mask[i] = 1;
    drawTerrainIcons(half, world, "A", 1, mask);
    expect(half.calls.length).toBeLessThan(none.calls.length);
    expect(half.calls.length).toBeGreaterThan(0);
  });
});

describe("sampleIconSites：图标稀疏化 + 去栅格（手绘点缀，不是铺满的矩阵）", () => {
  it("稀疏：候选点只有全图的 1/step²，远低于逐格", () => {
    const size = 32;
    const world = solidWorld(T_FOREST, size);
    const sites = sampleIconSites(world);
    const lattice = Math.ceil(size / 2) * Math.ceil(size / 2);
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.length).toBeLessThanOrEqual(lattice);
    expect(sites.length).toBeLessThanOrEqual((size * size) / 4);
  });

  it("水体一个候选点都不给（大海 / 湖泊 / 河流）", () => {
    for (const t of [T_SEA, T_LAKE, T_RIVER]) {
      expect(sampleIconSites(solidWorld(t, 16)).length).toBe(0);
    }
  });

  it("去栅格：边长刻意 ≠ 一格且彼此不等大", () => {
    const world = solidWorld(T_FOREST, 32);
    const sites = sampleIconSites(world);
    expect(sites.every((s) => s.size > world.cell && s.size < world.cell * 1.6)).toBe(true);
    // 尺寸是连续抖动出来的，不是两三档
    expect(new Set(sites.map((s) => Math.round(s.size * 50))).size).toBeGreaterThan(8);
  });

  it("去栅格：位置被抖离候选格 —— 中心格不再全是 step 的倍数", () => {
    const world = solidWorld(T_FOREST, 32);
    const sites = sampleIconSites(world);
    const onLattice = sites.filter((s) => {
      const cc = Math.floor((s.x + s.size / 2) / world.cell);
      return cc % 2 === 0;
    }).length;
    expect(onLattice).toBeGreaterThan(0);
    expect(onLattice).toBeLessThan(sites.length);
  });

  it("去栅格：带轻微旋转，且不一律朝上", () => {
    const sites = sampleIconSites(solidWorld(T_MOUNTAIN, 32));
    expect(sites.some((s) => s.rot > 0)).toBe(true);
    expect(sites.some((s) => s.rot < 0)).toBe(true);
    expect(sites.every((s) => Math.abs(s.rot) <= 0.11)).toBe(true);
  });

  it("抖动跨格后按**新格**判定水体 —— 树不会被抖进海里", () => {
    const size = 16;
    const world = solidWorld(T_MOUNTAIN, size);
    const mask = new Uint8Array(size * size);
    for (let i = 0; i < (size * size) / 2; i++) mask[i] = 1; // 上半 = 水
    const sites = sampleIconSites(world, mask);
    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every((s) => s.index >= (size * size) / 2)).toBe(true);
  });

  it("确定性：同 seed 同 cells 必出同一批候选点（含坐标/尺寸/旋转）", () => {
    const world = solidWorld(T_FOREST, 16);
    expect(JSON.stringify(sampleIconSites(world))).toBe(JSON.stringify(sampleIconSites(world)));
    // seed 一变图案就得变，否则「每世界同款点缀」会露馅
    const other = solidWorld(T_FOREST, 16);
    other.snum = 0x0badc0de;
    expect(JSON.stringify(sampleIconSites(other))).not.toBe(JSON.stringify(sampleIconSites(world)));
  });

  it("drawTerrainIcons 真的施加了旋转变换（translate/rotate 成对出现）", () => {
    const ctx = recCtx();
    drawTerrainIcons(ctx, solidWorld(T_MOUNTAIN, 16), "A", 1);
    const ops = ctx.calls;
    expect(ops).toContain("rotate");
    expect(ops.filter((o) => o === "translate").length).toBeGreaterThan(0);
  });
});

/** 记录「属性赋值 + 方法首参」的假 ctx：断言绘制几何用 */
type RecCtx = CanvasRenderingContext2D & { calls: string[]; ops: { op: string; args: number[] }[] };

function recCtx(): RecCtx {
  const calls: string[] = [];
  const ops: { op: string; args: number[] }[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(_t, prop) {
      if (prop === "calls") return calls;
      if (prop === "ops") return ops;
      return (...args: unknown[]) => {
        const name = String(prop);
        calls.push(name);
        ops.push({ op: name, args: args.map((a) => (typeof a === "number" ? a : Number.NaN)) });
      };
    },
    set(_t, prop, value) {
      calls.push(`set:${String(prop)}=${String(value)}`);
      return true;
    },
  });
  return ctx as unknown as RecCtx;
}

/** 1 格宽纵向河道（带对应 river feature + 地表底质）的世界 */
function riverWorld(): BuiltWorld {
  const cols = 9;
  const rows = 9;
  const cells = new Uint8Array(cols * rows).fill(T_MOUNTAIN);
  const pts: number[] = [];
  for (let r = 1; r < 8; r++) {
    cells[r * cols + 4] = T_RIVER;
    pts.push(4.5 * CELL, (r + 0.5) * CELL);
  }
  return { ...solidWorld(T_MOUNTAIN, 9), cells, baseCells: fillRiverBase(cells, cols, rows), features: [{ type: "river", pts }] };
}

describe("drawRiverRibbons：水体只画一遍（本轮修复）", () => {
  it("一条河道 = 一次 fill + 一次 stroke：不再「水带 + 半透明宽岸」两层叠加", () => {
    const ctx = recCtx();
    drawRiverRibbons(ctx, riverWorld(), 1);
    const count = (op: string) => ctx.calls.filter((c) => c === op).length;
    expect(count("fill")).toBe(1);
    expect(count("stroke")).toBe(1);
    expect(ctx.calls).toContain(`set:fillStyle=${TERRAIN_COLORS[2]}`);
    expect(ctx.calls).toContain(`set:strokeStyle=${TERRAIN_BORDER_COLORS[2]}`);
  });

  it("轮廓是加密后的闭合曲线（远多于折线控制点，且首尾各有一个圆弧端头）", () => {
    const ctx = recCtx();
    drawRiverRibbons(ctx, riverWorld(), 1);
    const lines = ctx.ops.filter((o) => o.op === "lineTo").length;
    expect(lines).toBeGreaterThan(7 * 2); // 7 个控制点 × 两侧 + 圆头采样
    expect(ctx.calls).toContain("closePath");
  });

  it("远景守卫：水带在屏幕上不足 1.5px 宽时整条跳过", () => {
    const far = recCtx();
    drawRiverRibbons(far, riverWorld(), 0.02);
    expect(far.calls.length).toBe(0);
    const near = recCtx();
    drawRiverRibbons(near, riverWorld(), 1);
    expect(near.calls.length).toBeGreaterThan(0);
  });
});

describe("riverHalfWidth：河宽沿程渐变", () => {
  it("主河自源头向河口单调变宽", () => {
    const [a, b, c] = [0, 0.5, 1].map((t) => riverHalfWidth(false, t, CELL));
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });

  it("支流自交汇处向上游单调变细", () => {
    const [a, b, c] = [0, 0.5, 1].map((t) => riverHalfWidth(true, t, CELL));
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });

  it("进度越界做夹紧，不产出负宽度", () => {
    expect(riverHalfWidth(false, -3, CELL)).toBe(riverHalfWidth(false, 0, CELL));
    expect(riverHalfWidth(false, 9, CELL)).toBe(riverHalfWidth(false, 1, CELL));
    expect(riverHalfWidth(true, 9, CELL)).toBeGreaterThan(0);
  });
});

describe("drawTerrain：地表不再刷河面（否则与 2D 水带并排错位）", () => {
  it("有 baseCells 时，底色里不出现「河流蓝」——河格已回填成底质", () => {
    const ctx = recCtx();
    drawTerrain(ctx, riverWorld(), { contours: false, rivers: false, features: false, frame: false });
    const fills = ctx.calls.filter((c) => c.startsWith("set:fillStyle="));
    expect(fills.length).toBeGreaterThan(0);
    expect(fills).not.toContain(`set:fillStyle=${TERRAIN_COLORS[T_RIVER]}`);
    expect(fills).toContain(`set:fillStyle=${TERRAIN_COLORS[T_MOUNTAIN]}`);
  });
});
