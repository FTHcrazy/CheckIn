/**
 * 海岸烘焙（RenderTexture）—— 把"只随内容变、不随视口变"的四层海岸合成一张纹理
 *
 * 【为什么必须烘焙】海岸四层里有三层带 `BlurFilter`。滤镜会强制离屏渲染，挂在
 * 每帧重绘的容器上等于**每帧做三次高斯模糊** —— 600 区块的场景会直接掉到个位数
 * 帧率。而四层只依赖"陆地几何 + 风格 + 分辨率"，**完全不依赖 viewport**，
 * 这正是烘焙成立的充要条件：烘一次（几十毫秒），之后滚轮缩放零成本。
 *
 * 【判定规则（写在这里以便后来者对表）】一个图层如果要满足"随 viewport 重绘 +
 * 带 filter"，就说明它该被烘焙，或者它根本不该带 filter。
 *
 * 【五个坑，逐条对应】
 *   1. `filters` 会扩大 bounds，但 RenderTexture 尺寸固定 → 边缘模糊被裁掉。
 *      所以 `BAKE_MARGIN` 必须 ≥ 最大模糊半径 × 3（12×3 = 36 < 64）。
 *      改模糊半径必须同步改 margin。
 *   2. `resolution` 不能和尺寸重复放大：width/height 已乘 res，resolution 必须给 1。
 *   3. 坐标系要显式搬：`renderer.render` 到 target 时**不应用** world 的视口变换，
 *      holder 必须自己承担「世界原点 → 纹理左上角」的平移。**注意 Pixi 的 position
 *      施加在 scale 之后**，所以平移量必须也乘上 scale（PRD §6.1.4 的写法漏了这一步，
 *      症状是"烘焙成功但画面上什么都没有"，且不报错）。
 *   4. 纹理叠加不能一次 `fill()` 搞定：Graphics 一次填充只接受一种样式，
 *      「底色 + 纸纹」要拆成两条子节点（底色 Graphics + 纹理 Sprite + mask）。
 *   5. `holder.destroy()` **不能**带 `texture: true`：底图纹理是共享资源，
 *      跟着销毁会让整张地图的底图消失。
 *
 * 【风格矩阵在**烘焙期**作用，运行期 `coast` 容器不挂任何滤镜（PRD §6.4）】
 * PRD §6.4 的原话是"切风格时 bakeKey 变化 → 海岸层重建一次，其余图层只换 filters"。
 * 反过来做（`bakeKey` 含 style、`bakeCoast` 却不吃 style、海岸再挂运行期滤镜）
 * 会得到最差的两头：三档风格烘出**逐像素相同**的纹理却各重烘一次（白付三次
 * 高斯模糊），同时海岸每帧还要多一次全屏滤镜 pass（白付一次采样）。
 * 现在矩阵只在这里乘一次、烤进纹理，运行期海岸就是一张图。
 */

import { BlurFilter, Container, Graphics, RenderTexture, Sprite, Texture } from "pixi.js";
import { drawLandPath } from "./land";
import { filterFor } from "./style";
import type { MapLand, MapStyle, Rect } from "./types";

/** 烘焙世界矩形相对陆地包围盒的外扩：容纳浅海带 + 模糊拖尾（≥ max(blur) × 3） */
export const BAKE_MARGIN = 64;

/** WebGL 纹理的保守长边上限；超过就降采样并告警（不要静默） */
export const BAKE_MAX_SIDE = 4096;

/**
 * 浅海带：比深海**亮**一档的浅滩，海陆之间的过渡。
 *
 * 【方向曾经反了】旧值是深绿 `0x2f4a3c`（比海更暗），画出来是陆地外面套一圈
 * **暗环** —— 像贴纸的影子，不像浅滩。参考实现（以及任何地形图）的浅滩都
 * 比深海亮：水浅 → 反射海底 → 明度上升。三档底色（青绿/蔚蓝/墨海）都适用
 * 这个方向，风格矩阵只改色相不改明暗关系。
 */
export const COAST_SHELF = {
  width: 20,
  color: 0x9dbfae,
  alpha: 0.22,
  blur: 9,
  quality: 3,
} as const;

/**
 * 等深线：与海岸平行的细线，离岸越远越淡。
 *
 * 【为什么值得画】海面只有一张平铺纹理时，岸外没有任何"深度信息"，海看起来
 * 是块布；参考实现的海面靠 2~3 圈等深线立刻有了"离岸越来越深"的层次。
 * 这是本次背景质感里性价比最高的一笔 —— 烘焙期算完就烤进纹理，运行期零成本。
 *
 * `distance` 是离岸的**世界单位**（经陆地半幅换算成缩放系数，见 `ringScaleK`）。
 */
export const COAST_ISOBATHS = [
  { distance: 16, width: 2.2, alpha: 0.32 },
  { distance: 40, width: 1.7, alpha: 0.2 },
  { distance: 70, width: 1.3, alpha: 0.12 },
] as const;

/** 等深线颜色：比深海浅一档的青灰（与浅滩同族，不引入新色相） */
export const COAST_ISOBATH_COLOR = 0x9dbfae;

/** 海岸外发光：让陆地"浮"在海面上，而不是"贴"上去 */
export const COAST_GLOW = {
  width: 8,
  color: 0xf2ead6,
  alpha: 0.3,
  blur: 5,
  quality: 3,
} as const;

/**
 * 陆岸**内**阴影：沿海岸线往陆地内侧压一道暖暗边。
 *
 * 【为什么加】参考实现的陆地不是一块均匀的米黄：岸线内侧 10~20 像素明显偏
 * 深偏暖（像纸被水浸过）。这一道用 `alignment: 1`（描边全画在路径内侧）
 * 实现，模糊后就是"陆地从边缘往中心逐渐变亮"的立体感；没有它，陆地就是
 * 一张剪下来的色卡。
 */
export const COAST_INNER_SHADE = {
  width: 22,
  color: 0x8a7350,
  alpha: 0.2,
  blur: 7,
  quality: 3,
} as const;

/** 陆地填色（米黄纸色）+ 极轻模糊，复刻参考实现"低分辨率位图放大"的柔边 */
export const COAST_FILL = { color: 0xc8bd9d, blur: 1.6, quality: 2 } as const;

/** 海岸白边：整张图最亮最锐的线，它断不断决定这张图成不成立 */
export const COAST_STROKE = { width: 1.8, color: 0xf6f0e0, alpha: 0.86 } as const;

/** 纸纹以 multiply 叠在陆地上的强度（纸纹已换成中性颗粒，见 paperGrain.ts） */
export const LAND_TEXTURE_ALPHA = 0.55;

/** 烘焙结果的尺寸与缩放（纯几何，可单测） */
export interface BakeSize {
  /** 纹理像素宽（已乘 res 与降采样系数） */
  width: number;
  /** 纹理像素高 */
  height: number;
  /** 世界单位 → 纹理像素的倍率 */
  scale: number;
  /** 是否因超出 BAKE_MAX_SIDE 而降采样 */
  downsampled: boolean;
}

/** 最小的渲染器面：只用到 `render({container, target, clear})` */
export interface BakeRenderer {
  render(options: { container: Container; target: RenderTexture; clear: boolean }): void;
}

export interface BakeInput {
  renderer: BakeRenderer;
  /** 陆地几何（polygons 为空时得到一张全透明的纹理，不抛异常） */
  land: MapLand;
  /**
   * 全局风格预设（PRD §6.4）。
   *
   * 【为什么是烘焙的输入】风格要作用在海岸上，而海岸的能量全在烘焙期的三次
   * 高斯模糊里；把矩阵放到运行期去乘，等于每帧多一次全屏采样，而效果完全一样。
   * 又因为 `bakeKey` 里含 style，切风格本来就会重烘一次 —— 把矩阵放进来，
   * 那次重烘才有实际产出（否则三档烘出来的像素一模一样）。
   */
  style: MapStyle;
  /** 纸纹（底图）；缺省则不叠纹理，只出米黄底色 */
  paperTexture?: Texture | null;
  /** 纸纹覆盖的世界矩形；缺省用 `land.bounds`（= 整张纸） */
  paperRect?: Rect;
  /** 烘焙分辨率（`min(devicePixelRatio, 2)`） */
  resolution: number;
}

/** 降采样告警只打一次：切风格/重生成会反复触发，刷屏反而没人看了 */
let warnedDownsample = false;

/**
 * 烘焙纹理的尺寸。
 *
 * `scale` 同时是 holder 的缩放倍率 —— 尺寸与 resolution 只能在这里乘一次，
 * `RenderTexture.create` 的 `resolution` 恒为 1（见文件头第 2 个坑）。
 */
export function bakeTextureSize(bounds: Rect, resolution: number): BakeSize {
  const res = Math.max(0.01, resolution);
  const wWorld = Math.max(1, bounds.width) + BAKE_MARGIN * 2;
  const hWorld = Math.max(1, bounds.height) + BAKE_MARGIN * 2;
  const long = Math.max(wWorld, hWorld) * res;
  const k = long > BAKE_MAX_SIDE ? BAKE_MAX_SIDE / long : 1;
  const scale = res * k;
  return {
    width: Math.max(1, Math.round(wWorld * scale)),
    height: Math.max(1, Math.round(hWorld * scale)),
    scale,
    downsampled: k < 1,
  };
}

/**
 * 烘焙内容指纹 —— 烘焙的唯一触发源（取代布尔脏标记）。
 *
 * 【为什么用指纹而不是布尔标记】布尔标记要业务侧在**每一处**改动后置位，
 * 漏一处就表现为"改了但画面没变"；指纹是派生的，天然幂等。
 *
 * 【为什么带 P0 坐标】只用「环数 + 各环顶点数」无法区分"顶点数相同但形状不同"
 * （将来支持编辑陆地时必踩）。加一个首点坐标后，任何顶点变动都会改变 key，
 * 成本仍是 O(环数)。
 *
 * @returns `null` 表示"没有陆地，不需要烘焙"
 */
export function bakeKeyOf(land: MapLand | null, style: MapStyle, resolution: number): string | null {
  if (!land || land.polygons.length === 0) return null;
  const sizes = land.polygons.map((ring) => ring.length).join(",");
  const p0 = land.polygons[0][0] ?? { x: 0, y: 0 };
  return [
    land.seed,
    land.polygons.length,
    sizes,
    p0.x.toFixed(2),
    p0.y.toFixed(2),
    style,
    resolution,
  ].join("|");
}

/**
 * 陆地轮廓的近似中心（所有环顶点的均值）。
 *
 * 【为什么用均值而不是面积重心】这里只拿它当"外扩的缩放原点"，对形状精度
 * 没有要求；面积重心要算环积分（还得处理自交与多环），成本高出一个量级。
 */
function ringsCenter(polygons: readonly { x: number; y: number }[][]): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const ring of polygons) {
    for (const p of ring) {
      sx += p.x;
      sy += p.y;
      n += 1;
    }
  }
  return n === 0 ? { x: 0, y: 0 } : { x: sx / n, y: sy / n };
}

/**
 * 离岸 `distance` 世界单位对应的缩放系数。
 *
 * 【为什么用"从中心放大"而不是真的做多边形外扩】真正的 offset 曲线要在
 * 每个顶点求法线、处理自交，几百个顶点的弯折岸线很容易翻边；而陆地是
 * 团块状（不是细长条），从中心等比放大的误差只有一二十个百分点 ——
 * 对"离岸十几像素的一圈淡线"完全够用，且绝不会自交。
 */
function ringScaleK(bounds: Rect, distance: number): number {
  const half = Math.max(1, Math.max(bounds.width, bounds.height) / 2);
  return 1 + distance / half;
}

/** 按中心等比放大后描边（等深线专用；曲线控制点同倍放大即可保持形状） */
function strokeScaledRings(
  g: Graphics,
  polygons: readonly { x: number; y: number }[][],
  center: { x: number; y: number },
  k: number,
  width: number,
  color: number,
  alpha: number,
): void {
  for (const ring of polygons) {
    const n = ring.length;
    if (n < 3) continue;
    const at = (p: { x: number; y: number }) => ({
      x: center.x + (p.x - center.x) * k,
      y: center.y + (p.y - center.y) * k,
    });
    const start = at(ring[0]);
    g.moveTo(start.x, start.y);
    for (let i = 0; i < n; i += 1) {
      const a = at(ring[(i - 1 + n) % n]);
      const b = at(ring[i]);
      const c = at(ring[(i + 1) % n]);
      const d = at(ring[(i + 2) % n]);
      g.bezierCurveTo(
        b.x + (c.x - a.x) / 6,
        b.y + (c.y - a.y) / 6,
        c.x - (d.x - b.x) / 6,
        c.y - (d.y - b.y) / 6,
        c.x,
        c.y,
      );
    }
    g.closePath();
    g.stroke({ width, color, alpha, alignment: 0.5 });
  }
}

/**
 * 烘一张海岸纹理。
 *
 * 六层在 holder 内是六个独立 Graphics：
 * `shelf → isobaths → glow → fill → tex → stroke`（自下而上）。
 * 填充与描边必须分开，否则后画的填充会压掉前一段描边的一半，海岸白边会断断续续。
 *
 * 调用方负责：把返回的 RT 挂到 `coast` 容器的 Sprite 上，
 * 并在替换成功后**再**销毁旧 RT（先建后换，避免闪一帧空白）。
 */
export function bakeCoast(input: BakeInput): RenderTexture {
  const { renderer, land, resolution } = input;
  // 已销毁的纹理一律当"没有"处理：`Texture.destroy(true)` 之后 `_source` 是 null，
  // 而 batcher 会读 `getAdjustedBlendModeBlend(texture._source)` → 解 null 的
  // `alphaMode` 直接抛，**整张画布白屏**（2.27.0 的事故）。
  // 这是第二道闸；第一道是纸纹做成单例、永不销毁（见 `paperGrain.ts`）。
  // 退化成 `Texture.EMPTY` 总比把死引用交给渲染管线好。
  const paper = input.paperTexture && !input.paperTexture.destroyed ? input.paperTexture : null;
  const paperRect = input.paperRect ?? land.bounds;
  const size = bakeTextureSize(land.bounds, resolution);

  if (size.downsampled && !warnedDownsample) {
    warnedDownsample = true;
    console.warn(
      `[coastBake] 烘焙尺寸 ${Math.round(size.width)}×${Math.round(size.height)} 超过 ${BAKE_MAX_SIDE}，已降采样（scale=${size.scale.toFixed(3)}）`,
    );
  }

  const target = RenderTexture.create({
    width: size.width,
    height: size.height,
    // 尺寸里已经乘过 res 与降采样系数，这里必须是 1，否则等于放大两次
    resolution: 1,
    antialias: true,
  });

  const holder = new Container();
  const originX = land.bounds.x - BAKE_MARGIN;
  const originY = land.bounds.y - BAKE_MARGIN;
  // 【坑 3】Pixi 的 position 施加在 scale **之后**：world → scale*world + position。
  // 要让"纹理左上角 = 世界 origin"，position 必须等于 -scale*origin（不能漏乘 scale）。
  holder.position.set(-originX * size.scale, -originY * size.scale);
  holder.scale.set(size.scale);

  // ── 1) 浅海大陆架：最外圈，比海亮一档的绿带，向两侧各铺一半后模糊 ──
  const shelf = new Graphics();
  drawLandPath(shelf, land.polygons);
  shelf.stroke({
    width: COAST_SHELF.width,
    color: COAST_SHELF.color,
    alpha: COAST_SHELF.alpha,
    alignment: 0.5,
  });
  shelf.filters = [new BlurFilter({ strength: COAST_SHELF.blur, quality: COAST_SHELF.quality })];

  // ── 2) 等深线：与海岸平行、向外递减的细线，给海面"深度"层次 ──
  const isobaths = new Graphics();
  const center = ringsCenter(land.polygons);
  for (const line of COAST_ISOBATHS) {
    strokeScaledRings(
      isobaths,
      land.polygons,
      center,
      ringScaleK(land.bounds, line.distance),
      line.width,
      COAST_ISOBATH_COLOR,
      line.alpha,
    );
  }

  // ── 3) 海岸外发光：白色窄带，模糊后让陆地边缘微微发亮 ──
  const glow = new Graphics();
  drawLandPath(glow, land.polygons);
  glow.stroke({
    width: COAST_GLOW.width,
    color: COAST_GLOW.color,
    alpha: COAST_GLOW.alpha,
    alignment: 0.5,
  });
  glow.filters = [new BlurFilter({ strength: COAST_GLOW.blur, quality: COAST_GLOW.quality })];

  // ── 3) 陆地底色：米黄 + 极轻模糊（复刻参考实现的柔边）──
  const fill = new Graphics();
  drawLandPath(fill, land.polygons);
  fill.fill({ color: COAST_FILL.color });
  fill.filters = [new BlurFilter({ strength: COAST_FILL.blur, quality: COAST_FILL.quality })];

  // ── 4) 纸纹：mask 到陆地、multiply 叠一层，让陆地不是一块死板的纯色 ──
  const texSprite = new Sprite(paper ?? Texture.EMPTY);
  texSprite.anchor.set(0);
  texSprite.position.set(paperRect.x, paperRect.y);
  texSprite.width = Math.max(1, paperRect.width);
  texSprite.height = Math.max(1, paperRect.height);
  const mask = new Graphics();
  drawLandPath(mask, land.polygons);
  // 掩膜必须真的"填"出来：只有路径没有填充时，遮罩区域就是空的
  mask.fill({ color: 0xffffff });
  texSprite.mask = mask;
  texSprite.alpha = LAND_TEXTURE_ALPHA;
  texSprite.blendMode = "multiply";

  // ── 5) 陆岸内阴影：描边只画在路径**内侧**（alignment 1），模糊后是"岸线附近
  //    略深、往内陆逐渐变亮"的立体感。必须 mask 到陆地：模糊会把 22px 的描边
  //    洇到海面上，那会在浅滩里压出一圈脏边（与"浅滩比深海亮"直接冲突）。──
  const innerShade = new Graphics();
  drawLandPath(innerShade, land.polygons);
  innerShade.stroke({
    width: COAST_INNER_SHADE.width,
    color: COAST_INNER_SHADE.color,
    alpha: COAST_INNER_SHADE.alpha,
    alignment: 1,
  });
  innerShade.filters = [
    new BlurFilter({ strength: COAST_INNER_SHADE.blur, quality: COAST_INNER_SHADE.quality }),
  ];
  innerShade.mask = mask;

  // ── 6) 海岸白边：实心、不带滤镜，整张图最锐的一笔 ──
  const stroke = new Graphics();
  drawLandPath(stroke, land.polygons);
  stroke.stroke({
    width: COAST_STROKE.width,
    color: COAST_STROKE.color,
    alpha: COAST_STROKE.alpha,
    alignment: 0.5,
  });

  holder.addChild(shelf, isobaths, glow, fill, texSprite, innerShade, mask, stroke);

  // ── 6) 风格矩阵：只乘一次，烤进纹理 ──
  //
  // 【挂在四个"画颜色"的节点上，不挂 holder】holder 是 `renderer.render` 的根容器，
  // 给根容器挂滤镜会在"渲染到 RT"这条路径上多绕一圈；而挂到内容节点上，
  // 滤镜就是这个节点自身的一部分，语义与"直接给这四笔画上色"完全等价。
  //
  // 【为什么不挂 `mask`】它是遮罩、不是被画出来的颜色。矩阵会改写 alpha 行，
  // 遮罩的软边会被一起改写 —— 抠形边缘发脏，而且改的是几何不是色相。
  //
  // 【为什么不挂 `texSprite`（QA 第二轮逐通道核算出来的真实偏差）】纸纹是
  // `blendMode="multiply"` 的**纹理**，不是颜色。multiply 是非线性运算，
  // 「先乘后上色」≠「先上色后乘」：fill 已经被矩阵上过一次色，纸纹若也上色，
  // 暖度就乘了两遍。实测偏差是羊皮纸档陆地整体偏暗、偏饱和约 4.3%
  // （逐通道最大 11/255）。把纸纹保持中性后，暖度只乘一遍，与返工前
  // 「整个容器上色一次」的语义一致。
  //
  // 【顺序】数组前后即先后：`[blur, matrix]` = 先模糊再上色 —— 先上色再模糊会
  // 让模糊核在色域里做混合，暖色带边缘会发灰。
  const styleFilter = filterFor(input.style);
  if (styleFilter) {
    for (const node of [shelf, isobaths, glow, fill, innerShade, stroke]) {
      node.filters = [...(node.filters ?? []), styleFilter];
    }
  }

  try {
    renderer.render({ container: holder, target, clear: true });
  } finally {
    // 只销毁子节点几何；**不带 texture: true** —— 底图纹理是共享资源
    holder.destroy({ children: true });
    // 滤镜必须在渲染**之后**销毁：它已经完成使命（像素在 RT 里了），
    // 留着就是每烘一次漏一个 uniform group（切风格/重生成会反复触发）。
    //
    // 【为什么必须写在 `finally` 里】`renderer.render` 是会抛的：WebGL 上下文
    // 丢失、RT 尺寸超限、驱动层报错都会走到异常分支。抛出去以后这一段根本
    // 不会执行 —— 于是**每失败一次漏一个 uniform group**，而且失败往往伴随
    // 重试，泄漏会累积得比成功路径更快。`holder` 一起放进 finally 同理：
    // 它持有五组 Graphics 几何，留着的代价比滤镜更大。
    styleFilter?.destroy();
  }
  return target;
}
