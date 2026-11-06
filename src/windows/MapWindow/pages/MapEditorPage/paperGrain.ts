/**
 * 纸纹（程序生成，无美术资源）—— 陆地 multiply 用的中性颗粒
 *
 * 【为什么不再拿底图当纸纹】2.26 之前 `bakeCoast` 的纸纹参数直接传的是**海面底图**
 * （`textures[doc.baseImageId]`）。那等于把海面的水纹漩涡 multiply 到陆地上：
 * 陆地会带上青灰的旋纹、整体偏暗，而参考实现的陆地是**米黄纸 + 细颗粒**。
 * 底图是"海"，纸纹是"纸"，两者不该共用一张图。
 *
 * 【为什么程序生成而不是再加一张美术资源】
 *   1. 纸纹要求**无缝平铺 + 中性灰**，AI 生成的图很难同时满足这两点（颜色会偏）；
 *   2. 它只是噪声，生成成本 ~5ms，且可以按需要的尺寸/强度调，不必再走一遍素材登记；
 *   3. 不引入新的版权/体积负担。
 *
 * 纯函数部分（`writePaperGrainPixels`）可直接单测；`createPaperGrainTexture`
 * 只在有 `document` 的渲染进程里跑（jsdom 测试环境返回 null）。
 */

import { Texture } from "pixi.js";

/**
 * 纸纹边长（像素）。
 *
 * 512 而不是 256：烘焙时这张纹理要铺满整张纸（1024 世界单位），256 会被放大
 * 4 倍、颗粒糊成大色块；1024 又要多花 4 倍像素。512 拉伸 2 倍刚好还是"颗粒"。
 */
export const PAPER_GRAIN_SIZE = 512;

/** 颗粒基准亮度：越小越暗（multiply 后陆地越深）。0.82 ≈ 平均压暗 18% */
export const PAPER_GRAIN_LUMA = 0.82;

/** 32 位整数散列（无符号），用于格点随机值 —— 同 seed 同图，便于复现 */
function hash2(x: number, y: number, seed: number): number {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 1442695041;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/**
 * 无缝值噪声：格点按 `period` **取模**，所以左右/上下边界天然接得上。
 *
 * @param x,y    像素坐标（0..size）
 * @param cell   格边长（像素）；period = size / cell
 */
function tileableNoise(x: number, y: number, cell: number, size: number, seed: number): number {
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const period = Math.max(1, Math.round(size / cell));
  const fx = x / cell - gx;
  const fy = y / cell - gy;
  // smoothstep：值噪声的线性插值会留下菱形格子感，三次平滑后才是"云"
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const wrap = (v: number) => ((v % period) + period) % period;
  const x0 = wrap(gx);
  const x1 = wrap(gx + 1);
  const y0 = wrap(gy);
  const y1 = wrap(gy + 1);
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return top + (bottom - top) * sy;
}

/**
 * 把纸纹写进 RGBA 缓冲（纯函数，可单测）。
 *
 * 三层叠加：粗粒（大块明暗，让纸不是均匀灰）+ 细粒（纤维感）+ 逐像素白噪声
 * （打印网点感，也是放大后仍不"塑料"的关键）。三层都是**灰度**（r=g=b），
 * 因为这张图只走 multiply，一旦带色就会把陆地整体染色。
 */
export function writePaperGrainPixels(
  data: Uint8ClampedArray,
  size: number,
  seed = 20260411,
): void {
  const coarseCell = Math.max(2, Math.round(size / 4));
  const fineCell = Math.max(2, Math.round(size / 24));
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const coarse = tileableNoise(x, y, coarseCell, size, seed);
      const fine = tileableNoise(x, y, fineCell, size, seed ^ 0x5f356495);
      const speck = hash2(x, y, seed ^ 0x1b873593);
      // 权重：粗 0.62 / 细 0.26 / 网点 0.12 → 加大粗粒占比让"纸的明暗"更抢眼，
      // 否则 multiply 之后颗粒被 fill 米黄稀释成若有若无的均匀灰（底部"光秃秃"）。
      const v = coarse * 0.62 + fine * 0.26 + speck * 0.12;
      // 只往"变暗"方向走：multiply 的纸纹超过 1 会提亮，那不是纸，是灯
      const g = Math.round(255 * (PAPER_GRAIN_LUMA + (1 - PAPER_GRAIN_LUMA) * v));
      const i = (y * size + x) * 4;
      data[i] = g;
      data[i + 1] = g;
      data[i + 2] = g;
      data[i + 3] = 255;
    }
  }
}

/**
 * 生成纸纹纹理；无 `document`（jsdom / 主进程）时返回 `null`。
 *
 * 调用方必须容忍 null（海岸烘焙退化成"纯米黄陆地"，不会抛）。
 *
 * **一般不要直接调用这个函数** —— 用下面的 `getPaperGrainTexture()`，
 * 它带模块级缓存。原因见那里的注释（很长，但是血写的）。
 */
export function createPaperGrainTexture(size = PAPER_GRAIN_SIZE): Texture | null {
  if (typeof document === "undefined") return null;
  // jsdom（组件测试环境）没有 2D 上下文，而且每建一个 canvas 都会打一条
  // "Not implemented: HTMLCanvasElement's getContext" 噪声日志 —— 测试里本来也
  // 用不到纸纹，直接降级，别把整个测试输出刷满。真浏览器不会命中这一条。
  if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) return null;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    // jsdom 的 canvas 没有实现 getContext（会抛 "not implemented"）——
    // 测试环境要能静默降级，不能因为一张纸纹把整个画布测试打红
    return null;
  }
  if (!ctx) return null;
  const image = ctx.createImageData(size, size);
  writePaperGrainPixels(image.data, size);
  ctx.putImageData(image, 0, 0);
  return Texture.from(canvas);
}

/** 模块级缓存：`undefined` = 还没造过，`null` = 这个环境造不出来（jsdom） */
let cached: Texture | null | undefined;

/**
 * 取**全进程共享**的纸纹纹理（同一份，永不销毁）。
 *
 * 【为什么是模块级单例，而不是 `useMemo` + 卸载时 destroy】
 * 这是 2.27.0 上线当天白屏事故的根因，务必看完再改：
 *
 * 1. `Texture.destroy(true)` 会把 `Texture._source` 置成 **null**（pixi v8
 *    `Texture.mjs` 的 destroy：`if (destroySource) { _source.destroy(); _source = null }`）。
 * 2. `MapWindow/main.tsx` 开着 `React.StrictMode`。StrictMode 在开发环境会
 *    「挂载 → 跑 effect → 立刻卸载（跑 cleanup）→ 再跑 effect」，而**第二轮不会再渲染**
 *    —— 也就是说 `useMemo` 里那张纹理的引用不会重建，cleanup 已经把它销毁了。
 * 3. 于是第二轮 effect 拿着**同一张已销毁的纹理**去烘焙。`Sprite` 进 batcher 时
 *    `getAdjustedBlendModeBlend(element.texture._source)` 读到 null
 *    → `Cannot read properties of null (reading 'alphaMode')` → 整个 canvas 渲染中断。
 *    症状看起来像"窗口起来了但一张图都没有"，跟纹理毫不相干。
 *
 * 纸纹是**静态资产**（固定 seed、固定 512²、内容与文档无关），本来就没有"每次挂载
 * 应当重建"的理由；一张 512² 的 RGBA 常驻 ≈ 1 MB 显存，且**不随开关窗口增长**
 * （单例只会造一次），比"每次挂载造一张、卸载销毁"更省也更安全。
 *
 * 【为什么换了 renderer 也不会坏】pixi v8 的 GL 纹理挂在 `renderer` 自己的
 * `GCManagedHash` 上（`item._gpuData[renderer.uid]`），关窗口销毁 renderer 只销毁
 * 那一份 GPU 数据，**TextureSource 本身仍在**；新窗口的新 renderer 会重新上传一次。
 */
export function getPaperGrainTexture(): Texture | null {
  // 已销毁（外部有人不守规矩）→ 重建一张，绝不把死纹理交回渲染管线
  if (cached === undefined || (cached !== null && cached.destroyed)) {
    cached = createPaperGrainTexture();
  }
  return cached;
}

