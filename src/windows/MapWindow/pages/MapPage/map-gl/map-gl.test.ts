/**
 * map-gl 纯函数单测（AGENTS.md 6.6：纯函数必须有单测）
 *
 * 覆盖 terrain-splat：one-hot 不变式 / 通道映射 / 确定性 / 局部 patch / 越界兜底。
 * 说明：Pixi 渲染器本体依赖 WebGL 上下文，不在 jsdom 覆盖范围，故只对纯函数层断言。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FRAG_SRC, VERT_SRC } from "./shaders";
import {
  MAX_TERRAIN_TYPES,
  SOFT_PASSES,
  SPLAT_CHANNELS,
  SPLAT_LAYERS,
  buildSoftLayers,
  buildSplatMaps,
  countHotChannels,
  hexToRgb01,
  patchSplatMaps,
  splatSlotOf,
} from "./terrain-splat";

const COLS = 4;
const ROWS = 3;

describe("splatSlotOf", () => {
  it("地形索引映射到 layer / channel", () => {
    expect(splatSlotOf(0)).toEqual({ layer: 0, channel: 0 });
    expect(splatSlotOf(3)).toEqual({ layer: 0, channel: 3 });
    expect(splatSlotOf(4)).toEqual({ layer: 1, channel: 0 });
    expect(splatSlotOf(8)).toEqual({ layer: 2, channel: 0 });
    expect(splatSlotOf(9)).toEqual({ layer: 2, channel: 1 });
  });

  it("越界与非整数返回 null（渲染侧兜底成地形 0）", () => {
    expect(splatSlotOf(-1)).toBeNull();
    expect(splatSlotOf(MAX_TERRAIN_TYPES)).toBeNull();
    expect(splatSlotOf(1.5)).toBeNull();
  });
});

describe("buildSplatMaps", () => {
  it("每格恰有一个通道点亮（one-hot 不变式）", () => {
    const cells = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 4];
    const maps = buildSplatMaps(cells, COLS, ROWS);
    expect(maps.layers.length).toBe(SPLAT_LAYERS);
    for (let i = 0; i < cells.length; i++) {
      expect(countHotChannels(maps, i)).toBe(1);
    }
  });

  it("通道映射正确：地形 5 落在 layer1 的 g 通道", () => {
    const cells = new Array(12).fill(5);
    const maps = buildSplatMaps(cells, COLS, ROWS);
    // 第 0 格：layer1 的 channel 1 为 255
    expect(maps.layers[1][0 * SPLAT_CHANNELS + 1]).toBe(255);
    expect(maps.layers[0][0]).toBe(0);
  });

  it("确定性：同输入必出同结果", () => {
    const cells = [2, 2, 6, 6, 9, 9, 0, 0, 3, 4, 5, 1];
    const a = buildSplatMaps(cells, COLS, ROWS);
    const b = buildSplatMaps(cells, COLS, ROWS);
    for (let l = 0; l < SPLAT_LAYERS; l++) {
      expect(Array.from(a.layers[l])).toEqual(Array.from(b.layers[l]));
    }
  });

  it("未知地形值不点亮任何通道（渲染侧兜底，不崩）", () => {
    const cells = [0, 0, 99, 0];
    const maps = buildSplatMaps(cells, 2, 2);
    expect(countHotChannels(maps, 2)).toBe(0);
    expect(countHotChannels(maps, 0)).toBe(1);
  });
});

describe("buildSoftLayers（软覆盖度场 = 无方块感的关键）", () => {
  it("均匀区域模糊后仍是原值（核归一，不整体变亮变暗）", () => {
    const cells = new Array(9).fill(5);
    const maps = buildSplatMaps(cells, 3, 3);
    // 全图森林：layer1.g 全为 255，模糊仍是 255；其他层全 0
    for (let i = 0; i < 9; i++) {
      expect(maps.soft[1][i * SPLAT_CHANNELS + 1]).toBe(255);
      expect(maps.soft[0][i * SPLAT_CHANNELS]).toBe(0);
    }
  });

  it("边界处产生中间值（等值线因此可成曲线，而非 0/255 二值台阶）", () => {
    // 左右各半：0 海 | 4 草原
    const cells = [0, 0, 4, 4, 0, 0, 4, 4, 0, 0, 4, 4];
    const maps = buildSplatMaps(cells, 2, 6);
    const boundarySeen = [];
    for (let i = 0; i < 6; i++) {
      // 第 3 行左右两格（索引 4、5）应出现中间值
      boundarySeen.push(maps.soft[0][4 * SPLAT_CHANNELS]);
      boundarySeen.push(maps.soft[1][5 * SPLAT_CHANNELS]);
    }
    expect(boundarySeen.some((v) => v > 0 && v < 255)).toBe(true);
  });

  it("1 格宽河流经加权后仍占优（细窄地形不会被模糊吞掉）", () => {
    // 5×5 草原，中间一列（2 格宽）为河流
    const cols = 5;
    const rows = 5;
    const cells = new Array(cols * rows).fill(4);
    for (let r = 0; r < rows; r++) cells[r * cols + 2] = 2;
    const maps = buildSplatMaps(cells, cols, rows);
    // 河道中心（第 2 行第 2 列）river 层应 ≥ 草地对应通道
    const idx = (2 * cols + 2) * SPLAT_CHANNELS;
    const river = maps.soft[0][idx + 2]; // 地形 2 = layer0.b
    const grass = maps.soft[1][idx]; // 地形 4 = layer1.r
    expect(river).toBeGreaterThan(grass);
  });

  it("确定性 + 不修改 one-hot 原始场", () => {
    const cells = [0, 5, 9, 3, 6, 8, 1, 2, 4];
    const a = buildSplatMaps(cells, 3, 3);
    const rawBefore = a.layers.map((l) => Array.from(l));
    const b = buildSplatMaps(cells, 3, 3);
    for (let l = 0; l < SPLAT_LAYERS; l++) {
      expect(Array.from(b.soft[l])).toEqual(Array.from(a.soft[l]));
      expect(Array.from(a.layers[l])).toEqual(rawBefore[l]);
    }
    expect(buildSoftLayers(a.layers, 3, 3).length).toBe(SPLAT_LAYERS);
    expect(SOFT_PASSES).toBeGreaterThan(0);
  });
});

describe("patchSplatMaps", () => {
  it("局部更新只改动脏格，其余保持不变", () => {
    const cells = [0, 0, 0, 0, 0, 0];
    const maps = buildSplatMaps(cells, 3, 2);
    const next = [0, 9, 0, 0, 0, 0];
    patchSplatMaps(maps, [1], next);
    // 脏格已变为熔岩：layer2.g 点亮
    expect(maps.layers[2][1 * SPLAT_CHANNELS + 1]).toBe(255);
    // 脏格在旧图层上的通道必须被清除，否则会与熔岩叠加成「既是海又是岩浆」
    expect(maps.layers[0][1 * SPLAT_CHANNELS]).toBe(0);
    expect(countHotChannels(maps, 1)).toBe(1);
    // 非脏格保持原样
    expect(maps.layers[0][0 * SPLAT_CHANNELS]).toBe(255);
    expect(maps.layers[0][2 * SPLAT_CHANNELS]).toBe(255);
    expect(countHotChannels(maps, 2)).toBe(1);
  });

  it("patch 后软场同步刷新（渲染读的是 soft）", () => {
    const cells = new Array(25).fill(4);
    const maps = buildSplatMaps(cells, 5, 5);
    const center = (2 * 5 + 2) * SPLAT_CHANNELS;
    expect(maps.soft[0][center]).toBe(0); // 原本无海
    const next = [...cells];
    next[2 * 5 + 2] = 0;
    patchSplatMaps(maps, [2 * 5 + 2], next);
    expect(maps.soft[0][center]).toBeGreaterThan(0);
  });

  it("忽略越界索引", () => {
    const cells = [0, 0, 0, 0];
    const maps = buildSplatMaps(cells, 2, 2);
    expect(() => patchSplatMaps(maps, [-1, 99], cells)).not.toThrow();
  });
});

describe("hexToRgb01", () => {
  it("六位与三位简写都能解析", () => {
    expect(hexToRgb01("#ffffff")).toEqual([1, 1, 1]);
    expect(hexToRgb01("#000000")).toEqual([0, 0, 0]);
    expect(hexToRgb01("#f00")).toEqual([1, 0, 0]);
  });

  it("实际地形色解析正确（海 #2f6f9f）", () => {
    const [r, g, b] = hexToRgb01("#2f6f9f");
    expect(r).toBeCloseTo(0x2f / 255, 5);
    expect(g).toBeCloseTo(0x6f / 255, 5);
    expect(b).toBeCloseTo(0x9f / 255, 5);
  });

  it("非法输入兜底为黑色而非抛错", () => {
    expect(hexToRgb01("nonsense")).toEqual([0, 0, 0]);
  });
});

/**
 * shader 源码守卫：shaders.ts 用 TS **模板字符串**承载 GLSL，
 * 注释里一旦出现反引号或 ${ 就会截断字符串 —— 症状是运行期抛
 * 「0.5 is not a function」这类莫名其妙的值类型错误（已踩两次），
 * 且报错位置指向 GLSL 注释行，极难定位。这里做源码级断言把它钉死。
 */
describe("shader 源码守卫", () => {
  const src = readFileSync(
    path.resolve(process.cwd(), "src/windows/MapWindow/pages/MapPage/map-gl/shaders.ts"),
    "utf8",
  );

  it("模板字符串区间内不含反引号 / ${（否则截断 GLSL）", () => {
    const lines = src.split("\n");
    const bad: string[] = [];
    let inTpl = false;
    lines.forEach((line, i) => {
      const ticks = (line.match(/`/g) ?? []).length;
      if (!inTpl && /=\s*`\s*$/.test(line)) {
        inTpl = true;
        return;
      }
      if (!inTpl) return;
      if (/^`;\s*$/.test(line)) {
        inTpl = false;
        return;
      }
      if (ticks > 0 || line.includes("${")) bad.push(`${i + 1}: ${line.trim()}`);
    });
    expect(inTpl).toBe(false);
    expect(bad).toEqual([]);
  });

  it("必备要素齐全（顶点属性名、精度声明、核心函数）", () => {
    expect(VERT_SRC).toContain("attribute vec2 aPosition");
    expect(VERT_SRC).not.toContain("aWorld");
    expect(FRAG_SRC).toContain("precision highp float");
    expect(FRAG_SRC).toContain("void main()");
    expect(FRAG_SRC).toContain("gl_FragColor");
    // 边界装饰层（墨线 / 海岸）与色板 uniform 必须与 map-symbols 同源
    expect(FRAG_SRC).toContain("uCoastSand");
    expect(FRAG_SRC).toContain("uCoastLine");
    expect(FRAG_SRC).toContain("uBorder0");
    expect(FRAG_SRC).not.toContain("undefined");
  });

  it("顶点着色器与 Canvas2D 层同构：screen = world * scale + offset", () => {
    expect(VERT_SRC).toContain("aPosition * uViewScale + uViewOffset");
  });
});
