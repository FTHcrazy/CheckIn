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
 *   layer0.rgba → 地形 0-3 ｜ layer1.rgba → 地形 4-7 ｜ layer2.rgba → 地形 8-11
 *
 * 边界：不 import React / window / document，可独立单测（见 map-gl.test.ts）。
 */

/** splat 贴图张数（3 张 RGBA = 12 通道，当前 12 类地形**恰好占满**） */
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
 *
 * ⚠️ 索引 2（河流）现在几乎不参与分类：河流改由 2D 层按 `pts` 单独绘制，
 * 喂给 splat 的是 `fillRiverBase` 回填过的底质（河格已被两岸地形顶掉）。
 * 保留这一档是为了不改动「12 通道 ↔ 地形索引」的既定映射，
 * 并为「直接喂含河格 cells」的调用方（历史数据 / 诊断脚本）留兜底。
 */
export const TERRAIN_WEIGHT: readonly number[] = [
  1.0, // 0 海
  1.4, // 1 湖（细长水体）
  2.4, // 2 河（常为 1 格宽；现由 2D 层单独绘制，见上）
  1.0, // 3 沙漠
  1.0, // 4 草原
  1.0, // 5 森林
  1.0, // 6 山地
  1.0, // 7 雪山
  1.0, // 8 雪原
  1.8, // 9 熔岩（手绘小片 / 火山模板的岩浆带）
  1.5, // 10 沼泽（常沿低洼成片，但要能压住草原的模糊外扩）
  1.3, // 11 废墟（斑块状散布，比周边草原略强即可）
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

/**
 * 该格在 GL 里最终呈现的**主导地形**（= shader 的取色规则：软场读数取最大，值相同取前者）。
 *
 * 用途：2D 补画层（图标 / 河道）要知道「GL 把这一格画成了什么」，才能只在陆地上落笔。
 * 旧实现只看 `cells` 里的地形码，而 GL 的实际画面是**模糊后的软场**决定的 ——
 * 于是 1 格宽的河被加权吹宽后，两岸明明是山地格、画面却已经是水，
 * 山形图标就长在了水里（实测截图：水里全是折线山）。
 *
 * 采样位置就是纹素中心（`uv = cell/cols` 恰好落在第 cell 个纹素中心），故无需插值；
 * 域扰动带来的横向偏移（≤ 0.8 格）无法在 CPU 侧复刻，这里按「格中心归属」近似，
 * 对于「水面/陆地」这种成片区分的判定足够（水面本身有 1.4~2.4 的权重冗余）。
 */
export function dominantTerrainAt(maps: SplatMaps, index: number): number {
  if (index < 0 || index >= maps.cols * maps.rows) return 0;
  let best = -1;
  let id = 0;
  for (let l = 0; l < maps.soft.length; l++) {
    const base = index * SPLAT_CHANNELS;
    for (let ch = 0; ch < SPLAT_CHANNELS; ch++) {
      const v = maps.soft[l][base + ch];
      // 与 shader 的 CMP 宏同款：严格大于，平局取编号小的
      if (v > best) {
        best = v;
        id = l * SPLAT_CHANNELS + ch;
      }
    }
  }
  return id;
}

/**
 * GL 水体掩码：1 = GL 会把这格画成水（大海 / 湖泊）。
 *
 * 传进来的必须是**地表底质**（`paintedCells(world)`，即河格已回填的 cells）——
 * 河流不走 GL（由 2D 层单独绘制），故掩码里不该出现河。
 * 图标层据此跳过绘制，杜绝「水面上冒出山/树」。
 */
export function buildGlWaterMask(
  painted: ArrayLike<number>,
  cols: number,
  rows: number,
  softPasses: number = SOFT_PASSES,
): Uint8Array {
  const maps = buildSplatMaps(painted, cols, rows, softPasses);
  const mask = new Uint8Array(cols * rows);
  for (let i = 0; i < mask.length; i++) {
    const t = dominantTerrainAt(maps, i);
    if (t === 0 || t === 1) mask[i] = 1;
  }
  return mask;
}

/** "#rrggbb" / "#rgb" → 归一化 [r,g,b]，供 shader uniform 使用 */export function hexToRgb01(hex: string): [number, number, number] {
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
