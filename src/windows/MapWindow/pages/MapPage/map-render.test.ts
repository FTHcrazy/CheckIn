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
 * jsdom 无 canvas 实现（getContext 返回 null），故这里用一个「记录调用」的假 ctx，
 * 不断言像素，只断言绘制调用序列。
 */
import { describe, expect, it } from "vitest";
import { drawTerrainIcons } from "./map-render";
import { TERRAIN_TEXTURE } from "./map-symbols";
import { CELL, T_DESERT, T_FOREST, T_GRASS, T_LAKE, T_LAVA, T_MARSH, T_MOUNTAIN, T_RIVER, T_RUINS, T_SEA, T_SNOW, T_SNOWFIELD, type BuiltWorld } from "./map-terrain";

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
      drawTerrainIcons(ctx, solidWorld(t));
      expect(
        drawOps(ctx.calls).length,
        `地形 #${t}（${TERRAIN_TEXTURE[t]}）没有画出任何图标`,
      ).toBeGreaterThan(0);
    }
  });

  it("确定性：同 seed 同 cells 必出同调用序列（对齐 RM8 复现性）", () => {
    const a = fakeCtx();
    const b = fakeCtx();
    drawTerrainIcons(a, solidWorld(T_FOREST));
    drawTerrainIcons(b, solidWorld(T_FOREST));
    expect(a.calls.length).toBeGreaterThan(0);
    expect(JSON.stringify(a.calls)).toBe(JSON.stringify(b.calls));
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
});
