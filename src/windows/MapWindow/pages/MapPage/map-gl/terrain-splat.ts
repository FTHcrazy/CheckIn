/**
 * 地形 one-hot splat 贴图（CPU 侧纯函数，零依赖、零 DOM）
 *
 * 为什么用 one-hot + RGBA8：
 * - 每格只把自己所属的地形通道置 255，其余为 0
 * - 贴图交给 GPU 的 LINEAR 双线性过滤 ⇒ 直接采样得到「各地形占比」
 *   （等价于一次免费的模糊），无需 CPU 上采样 / 盒式模糊 / marching squares
 * - cells 只有 cols×rows 字节级体量，局部涂改可用 patch 走增量，不必整图重建
 *
 * 通道映射（与 shaders.ts FRAG_SRC 严格对应，改一边必须改另一边）：
 *   layer0.rgba → 地形 0-3 ｜ layer1.rgba → 地形 4-7 ｜ layer2.rg → 地形 8-9
 *
 * 边界：不 import React / window / document，可独立单测（见 map-gl.test.ts）。
 */

/** splat 贴图张数（3 张 RGBA = 12 通道，当前 10 类地形留 2 通道余量） */
export const SPLAT_LAYERS = 3;
/** 单张贴图的通道数 */
export const SPLAT_CHANNELS = 4;
/** 支持的地形类型上限（= SPLAT_LAYERS × SPLAT_CHANNELS） */
export const MAX_TERRAIN_TYPES = SPLAT_LAYERS * SPLAT_CHANNELS;

export interface SplatMaps {
  cols: number;
  rows: number;
  /** one-hot 原始场（每格仅所属通道为 255）：局部 patch 与单测的语义基准 */
  layers: Uint8Array[];
  /** 软覆盖度场（模糊 + 类型权重）：真正上传 GPU 的数据 */
  soft: Uint8Array[];
  /** 软场模糊轮数（patch 重算时需要沿用同一参数） */
  softPasses: number;
}

/**
 * 细窄地形的分类权重（> 1 会把该地形的「达标阈值」沿梯度往外推，
 * 于是 1 格宽的河流/熔岩在模糊后仍能胜出，而孤立单格噪点被自然抹平）。
 */
export const TERRAIN_WEIGHT: readonly number[] = [
  1.0, // 0 海
  1.4, // 1 湖（细长水体）
  2.4, // 2 河（常为 1 格宽）
  1.0, // 3 沙漠
  1.0, // 4 草原
  1.0, // 5 森林
  1.0, // 6 山地
  1.0, // 7 雪山
  1.0, // 8 雪原
  1.8, // 9 熔岩（手绘小片）
];

/** 覆盖度模糊的盒式核半径（格）：越大越圆润，过大会吞掉 1 格宽特征 */
export const SOFT_PASSES = 2;

/** 地形索引 → { layer, channel }；越界返回 null（渲染侧兜底成地形 0） */
export function splatSlotOf(terrain: number): { layer: number; channel: number } | null {
  if (!Number.isInteger(terrain) || terrain < 0 || terrain >= MAX_TERRAIN_TYPES) return null;
  return {
    layer: Math.floor(terrain / SPLAT_CHANNELS),
    channel: terrain % SPLAT_CHANNELS,
  };
}

/** 由 cells 构建三张 one-hot 贴图 + 软覆盖度场（确定性：同 cells 必出同结果） */
export function buildSplatMaps(
  cells: ArrayLike<number>,
  cols: number,
  rows: number,
  softPasses: number = SOFT_PASSES,
): SplatMaps {
  const layers: Uint8Array[] = [];
  for (let i = 0; i < SPLAT_LAYERS; i++) layers.push(new Uint8Array(cols * rows * SPLAT_CHANNELS));

  const n = cols * rows;
  for (let i = 0; i < n; i++) {
    writeCell(layers, i, cells[i] ?? 0);
  }
  return {
    cols,
    rows,
    layers,
    soft: buildSoftLayers(layers, cols, rows, softPasses),
    softPasses,
  };
}

/**
 * 局部增量更新：只重算 dirty 索引对应的格子，再重建软覆盖度场。
 *
 * 覆盖度场是全局模糊的结果，脏格会影响半径内的邻居，所以这里重建整张软场
 * （80×50 全量模糊约 0.2ms，远低于一次重绘预算，不值得为局部性增加复杂度）。
 */
export function patchSplatMaps(
  maps: SplatMaps,
  dirty: Iterable<number>,
  cells: ArrayLike<number>,
): void {
  for (const i of dirty) {
    if (i < 0 || i >= maps.cols * maps.rows) continue;
    writeCell(maps.layers, i, cells[i] ?? 0);
  }
  maps.soft = buildSoftLayers(maps.layers, maps.cols, maps.rows, maps.softPasses);
}

/**
 * one-hot → 软覆盖度：分离式 3 抽头盒式模糊（[1,2,1]/4）跑 SOFT_PASSES 轮，
 * 再按 TERRAIN_WEIGHT 加权并截断。
 *
 * 为什么必须模糊：one-hot + LINEAR 只能给出「1 个纹素宽」的线性过渡带，等值线
 * 仍是贴着格子栅格的阶梯；先做覆盖度模糊，等价线就变成**光滑曲线**（拐角被抹圆），
 * 这才是「无方块感」的关键一步。模糊是线性的，所以 Σ通道 仍为 1（加权前）。
 * 纯函数、零依赖，见 map-gl.test.ts。
 */
export function buildSoftLayers(
  layers: Uint8Array[],
  cols: number,
  rows: number,
  passes: number = SOFT_PASSES,
): Uint8Array[] {
  const n = cols * rows;
  return layers.map((src, layerIndex) => {
    const a = Uint8Array.from(src);
    const b = new Uint8Array(n * SPLAT_CHANNELS);
    for (let p = 0; p < passes; p++) {
      blurPass(a, b, cols, rows, true);
      blurPass(b, a, cols, rows, false);
    }
    // 加权 + 截断（必须在模糊之后：先加权会被模糊稀释，再被 255 截断丢信息）
    for (let ch = 0; ch < SPLAT_CHANNELS; ch++) {
      const w = TERRAIN_WEIGHT[layerIndex * SPLAT_CHANNELS + ch] ?? 1;
      if (w === 1) continue;
      for (let i = 0; i < n; i++) {
        const idx = i * SPLAT_CHANNELS + ch;
        const v = Math.round(a[idx] * w);
        a[idx] = v > 255 ? 255 : v;
      }
    }
    return a;
  });
}

/** 单方向 3 抽头盒式模糊（[1,2,1]/4），边界做夹紧复制 */
function blurPass(
  src: Uint8Array,
  dst: Uint8Array,
  cols: number,
  rows: number,
  horizontal: boolean,
): void {
  const n = cols * rows;
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = (i - c) / cols;
    const prev = horizontal ? (c > 0 ? i - 1 : i) : r > 0 ? i - cols : i;
    const next = horizontal ? (c < cols - 1 ? i + 1 : i) : r < rows - 1 ? i + cols : i;
    const base = i * SPLAT_CHANNELS;
    const pb = prev * SPLAT_CHANNELS;
    const nb = next * SPLAT_CHANNELS;
    for (let ch = 0; ch < SPLAT_CHANNELS; ch++) {
      dst[base + ch] = (src[pb + ch] + 2 * src[base + ch] + src[nb + ch] + 2) >> 2;
    }
  }
}

/** 单格写入：先清空该格全部通道，再点亮所属通道，保证 one-hot 不变式 */
function writeCell(layers: Uint8Array[], index: number, terrain: number): void {
  for (let l = 0; l < layers.length; l++) {
    const base = index * SPLAT_CHANNELS;
    layers[l][base] = 0;
    layers[l][base + 1] = 0;
    layers[l][base + 2] = 0;
    layers[l][base + 3] = 0;
  }
  const slot = splatSlotOf(terrain);
  if (!slot) return;
  layers[slot.layer][index * SPLAT_CHANNELS + slot.channel] = 255;
}

/** 校验 one-hot 不变式：每格恰有 1 个通道为 255（地形值合法时）。测试用。 */
export function countHotChannels(maps: SplatMaps, index: number): number {
  let hot = 0;
  for (let l = 0; l < maps.layers.length; l++) {
    const base = index * SPLAT_CHANNELS;
    for (let c = 0; c < SPLAT_CHANNELS; c++) {
      if (maps.layers[l][base + c] === 255) hot++;
    }
  }
  return hot;
}

/** "#rrggbb" / "#rgb" → 归一化 [r,g,b]，供 shader uniform 使用 */
export function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.trim().replace(/^#/, "");
  const full =
    h.length === 3
      ? h
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return [0, 0, 0];
  const v = Number.parseInt(full, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
