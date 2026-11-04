/**
 * 嵌套子地图的渲染（Phase 2.4：从「只有分区色块」补齐到「一张完整的小地图」）。
 *
 * 职责：把「带 submap 的区块」挂成一棵递归子树 ——
 *   submapTreeNode                  position/scale = 贴合变换，alpha = 渐入权重
 *   ├─ clipMask                     区块 polygon 做遮罩，子图内容不越界
 *   └─ content
 *      ├─ sea                       子图自己的底图（铺满 submap.bounds）
 *      ├─ coast                     子图自己的海岸（bakeCoast 的产物，1 次 draw call）
 *      ├─ regionRoot                子图分区，按层级分容器（alpha = 子图自己的 levelAlphas）
 *      ├─ elementRoot               子图素材，按层级分容器
 *      ├─ nestedRoot                子图的区块再嵌的子图（递归）
 *      └─ labelRoot                 子图地名（复用 labelSync）
 *
 * 【为什么拆成「纯几何层 + Pixi 挂载层」】
 * 变换、渐入权重、层级权重都是纯算术，脱离 Pixi 就能单测（不 new 任何 Pixi 对象）；
 * Pixi 挂载层只做「按算好的参数 new 容器 + 画多边形」的薄封装。
 *
 * 【无级缩放如何继承】子图子树挂一个常数贴合变换（fitSubmapTransform 的 scale），
 * 再被根 world.scale 连带缩放；子图内部 LOD 用「等效缩放 = 父图缩放 × 贴合 scale」
 * 查**子图自己**的 naturalScales / levelAlphas（见 `submapContentPlan`）。于是
 * 「缩进去看子图」时它自己的洲/国家/郡逐级显露，与父图完全同构。
 *
 * 【为什么子图有自己的「纸」而不是直接用区块包围盒】
 * 海岸烘焙的四层（浅海带 28、外发光 10、白边 2.4 世界单位）是按**整张纸**的尺度
 * 标定的。若把 submap.bounds 设成区块包围盒（一个郡只有 90×60），28 单位的浅海带
 * 就有半个郡宽，画出来是一圈巨大的光晕 —— 质感立刻与父图脱节。让子图拥有自己的
 * 标准纸（与父图同为 1024²），再由 `fitSubmapTransform` 缩进区块，烘焙参数才成立。
 *
 * 【递归】子图的区块若再嵌子图，由 `buildSubmapNode` 递归调用自身，深度有上限
 * （防御数据里出现环）。
 */

import { Container, Graphics, Sprite, Texture, type ColorMatrixFilter, type Renderer } from "pixi.js";
import { SPRITE_MAP } from "../../sprites";
import {
  REGION_BORDER_ALPHA,
  REGION_BORDER_COLOR,
  REGION_BORDER_PX,
  REGION_FILL_ALPHA,
  type MapRegion,
} from "../../regions";
import { fitSubmapTransform, type SubmapFit } from "../../coords";
import {
  elementSizeFactor,
  elementWeight,
  enterScaleForRegion,
  levelAlphas as computeLevelAlphas,
  levelCountsOf,
  naturalScales,
  polygonLongEdge,
  submapEffectiveScale,
  submapEnterWeight,
} from "../../lod";
import { BAKE_MARGIN, bakeCoast, bakeKeyOf } from "../../coastBake";
import { filterFor } from "../../style";
import { applyLabelWeights, setLabelScale, syncLabels } from "./labelSync";
import type { MapSubmap } from "../../types";

/* ───────────────────────── 常量 ───────────────────────── */

/**
 * 递归深度上限。
 *
 * 【为什么需要】`MapSubmap.regions` 是递归结构，文档若被手工编辑出环（或将来
 * 做「同一张子图贴到多个区块」的引用模型），递归会直接爆栈 —— 而爆栈发生在
 * Pixi 的 addChild 里，堆栈信息与「哪张子图套住了自己」毫无关系。
 */
export const SUBMAP_MAX_DEPTH = 16;

/**
 * 子图海岸烘焙的分辨率上下限。
 *
 * 上限 3 与父图的 `STATIC_CACHE_MAX_RES` 同口径：子图被整体放大时，纹理最多被
 * 拉伸 3 倍，再高只会无上限涨纹理内存（每张 2304² ≈ 21MB）。
 * 下限 0.5：子图在屏幕上还很小时（等效缩放 0.26）没必要烤满分辨率。
 */
export const SUBMAP_BAKE_MAX_RES = 3;
export const SUBMAP_BAKE_MIN_RES = 0.5;

/**
 * 子图区块边界线宽的量化档。
 *
 * 与父图 `BORDER_WIDTH_QUANTIZE` 同一个思路：边界线宽是**屏幕恒定**的（`px / 缩放`），
 * 缩放一变数值就变，而 Graphics 一旦描边就固化，只能整层重建。量化到 1.15 的幂次档
 * 后，屏显线宽最多差 8%（肉眼不可辨），重建频率降一个数量级。
 */
export const SUBMAP_BORDER_QUANTIZE = 1.15;

/* ───────────────────────── 纯几何层（可脱离 Pixi 单测） ───────────────────────── */

/** 一个子图节点需要的全部几何/门控参数（由 `submapNodeSpec` 算出，不含任何 Pixi 对象） */
export interface SubmapNodeSpec {
  /** 该区块是否存在子图（false = 普通区块，不挂子树） */
  hasSubmap: boolean;
  /** 贴合变换：子图本地 → 父图世界 */
  fit: SubmapFit;
  /** 子图渐入权重 ∈ [0,1]（父图缩放低于阈值时为 0） */
  enterWeight: number;
  /** 子图局部的等效缩放（供子图内部 LOD 查表） */
  effectiveScale: number;
  /** 渐入阈值（区块显式指定，或按区块长边反推） */
  enterScale: number;
  /** 区块包围盒（clipMask 用，也即贴合变换的目标矩形） */
  targetRect: { x: number; y: number; width: number; height: number };
}

/**
 * 子图内容的分组计划（纯函数产物）。
 *
 * 【为什么把「层级权重 + 分级区块」一起算】两者必须来自同一组 `naturalScales`
 * （用子图自己的 bounds 与区块数量算出的），分成两处算就会出现「权重按 4 级、
 * 分组按 3 级」的错位 —— 表现是某一级的分区永远不亮。
 */
export interface SubmapContentPlan {
  /** 子图内部各层级的可见权重（长度 = 子图层级数，Σα ≡ 1；空 = 没有区块） */
  levelAlphas: number[];
  /** 按层级分好组的子图区块（只含非空层级，按 level 升序） */
  levels: Array<{ level: number; regions: MapRegion[] }>;
}

/**
 * 区块的「子图渐入阈值」：显式指定优先，否则按区块长边反推。
 *
 * 抽成独立函数，让 `submapNodeSpec`（几何层）与 MapCanvas 的权重同步 effect
 * 共用**同一份口径** —— 否则两处各写一遍「显式 vs 反推」的判断，改一处漏一处
 * 就会出现「结构期按 A 算、权重期按 B 算」的错位。
 */
export function submapEnterScaleOf(region: MapRegion): number {
  const explicit = region.submapEnterScale;
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) return explicit;
  return enterScaleForRegion(polygonLongEdge(region.polygon));
}

/**
 * 计算一个区块的「子图节点规格」（纯函数）。
 *
 * @param region      父图里的区块（可能带 submap）
 * @param parentScale 父图当前缩放（根 world.scale）
 *
 * 【门控的三段】见 nested-submap-main.md §5.3：
 *   · 父图缩放 < enterScale  → enterWeight ≈ 0（只露父图区块轮廓）
 *   · enterScale ~ 之上      → 平滑淡入（大致轮廓）
 *   · 深进去                 → 子图内部无级 LOD（由 `submapContentPlan` 驱动）
 */
export function submapNodeSpec(region: MapRegion, parentScale: number): SubmapNodeSpec {
  const submap = region.submap;
  const targetRect = polygonBounds(region.polygon);
  const empty: SubmapNodeSpec = {
    hasSubmap: false,
    fit: { x: 0, y: 0, scale: 1 },
    enterWeight: 0,
    effectiveScale: 0,
    enterScale: Infinity,
    targetRect,
  };

  if (!submap) return empty;

  const fit = fitSubmapTransform(submap.bounds, targetRect);
  const enterScale = submapEnterScaleOf(region);
  const enterWeight = submapEnterWeight(parentScale, enterScale);
  const effectiveScale = submapEffectiveScale(parentScale, fit.scale);

  return {
    hasSubmap: true,
    fit,
    enterWeight,
    effectiveScale,
    enterScale,
    targetRect,
  };
}

/**
 * 子图内部各层级的可见权重（纯函数）。
 *
 * 【为什么用「等效缩放」而不是父图缩放】子图的 naturalScales 是用**子图自己的
 * bounds + 区块数量**算出来的，单位是子图局部坐标里的缩放；而驱动整个场景的只有
 * 根 `world.scale`。子图子树挂在 `fit.scale`（≈0.09）这个常数之下，所以「子图内容
 * 在屏幕上的真实放大倍率」= 父图缩放 × fit.scale。拿父图缩放直接查表会错位一整档
 * （在县城尺度就把小溪村的郡级分区全点亮）。
 */
export function submapLevelAlphas(submap: MapSubmap, effectiveScale: number): number[] {
  const counts = levelCountsOf(submap.regions);
  if (counts.length === 0) return [];
  const scales = naturalScales(counts, submap.bounds);
  if (scales.length === 0) return [];
  return computeLevelAlphas(effectiveScale, scales);
}

/** 子图内容的完整分组计划（层级权重 + 分级区块），纯函数 */
export function submapContentPlan(
  submap: MapSubmap,
  effectiveScale: number,
): SubmapContentPlan {
  const levelAlphaList = submapLevelAlphas(submap, effectiveScale);

  // 按层级分组：用 Map 保序（首次出现的顺序 = 区块生成顺序，天然是粗→细）
  const byLevel = new Map<number, MapRegion[]>();
  for (const region of submap.regions) {
    if (region.polygon.length < 3) continue;
    const bucket = byLevel.get(region.level);
    if (bucket) bucket.push(region);
    else byLevel.set(region.level, [region]);
  }

  const levels = [...byLevel.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([level, regions]) => ({ level, regions }));

  return { levelAlphas: levelAlphaList, levels };
}

/**
 * 子图区块边界的**世界单位**线宽（屏幕恒定 `REGION_BORDER_PX` 像素）。
 *
 * 量化到 1.15 的幂次档：数值稳定 ⇒ `sync` 里可以「变没变」决定要不要重画，
 * 而不是每滚一格都重建几十个多边形。
 */
export function submapBorderWidth(effectiveScale: number): number {
  const s = Math.max(1e-6, Number.isFinite(effectiveScale) ? effectiveScale : 1);
  const quantized = SUBMAP_BORDER_QUANTIZE ** (Math.round(Math.log(s) / Math.log(SUBMAP_BORDER_QUANTIZE)));
  return REGION_BORDER_PX / Math.max(1e-6, quantized);
}

/**
 * 子图海岸烘焙的分辨率倍率（纯函数）。
 *
 * 【为什么要跟着等效缩放走】`bakeCoast` 产出的是一张**固定像素**的纹理，之后由
 * `world`（× `fit.scale`）放大。等效缩放越大，纹理被拉得越开；固定 1 倍会让
 * 缩进子图深处时海岸糊成一片（与父图「子图比父图糊」的断层）。
 *
 * 【为什么量化到 2 的幂次档】分辨率一变就要重烘（三次高斯模糊）。滚轮每格都重烘
 * 等于把烘焙变成纯损耗；跨档才重烘后，一次重烘覆盖 2 倍的缩放区间。
 *
 * `0` / `NaN` 一律退回下限 —— 让「子图不可见」时不至于算出 0 尺寸的纹理。
 */
export function submapBakeResolution(effectiveScale: number, baseResolution: number): number {
  const scale = Number.isFinite(effectiveScale) ? Math.max(0, effectiveScale) : 0;
  const base =
    Number.isFinite(baseResolution) && baseResolution > 0 ? baseResolution : 1;
  const raw = scale * base;
  if (!(raw > 0)) return SUBMAP_BAKE_MIN_RES;
  const tiered = 2 ** Math.round(Math.log2(raw));
  return Math.min(SUBMAP_BAKE_MAX_RES, Math.max(SUBMAP_BAKE_MIN_RES, tiered));
}

/** 区块多边形的轴对齐包围盒（世界坐标）。与 facade 的 regionBoundsOf 同义，独立一份避免循环依赖 */
export function polygonBounds(polygon: readonly { x: number; y: number }[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** 多边形顶点 → Pixi Graphics.poly() 需要的扁平坐标数组（与 MapCanvas 的 toFlatPoints 同义） */
function toFlatPoints(polygon: readonly { x: number; y: number }[]): number[] {
  const out: number[] = [];
  for (const p of polygon) out.push(p.x, p.y);
  return out;
}

/* ───────────────────────── Pixi 挂载层（MapCanvas 调用） ───────────────────────── */

/** 子图渲染所需的共享资源（父图的渲染器与纹理，子图与父图共用） */
export interface SubmapRenderEnv {
  renderer: Renderer | null;
  /** 已加载纹理表（键 = 素材 id / 底图 id） */
  textures: Record<string, Texture | undefined>;
  /** 父图烘焙分辨率（设备像素比封顶 2） */
  baseResolution: number;
}

/**
 * 环境对象的**可变引用**。
 *
 * 【为什么传 ref 而不是快照】子图节点只构建一次，而渲染器 / 纹理是随后才就绪的
 * （`app` 异步 init、纹理经 `Assets.load`）。若构建时把 env 快照进闭包，纹理晚到
 * 时这个节点永远拿不到 —— 表现是「子图海面与海岸永远空白」。传 ref 之后，
 * 每次烘焙/刷新都读 `env.current`，晚到的资源自然被下一次 `refreshCoast` 用上。
 */
export interface SubmapEnvRef {
  readonly current: SubmapRenderEnv;
}

/**
 * 一个已挂载的子图节点句柄。
 *
 * 【为什么返回句柄而不是裸 Container】缩放的每一格都要更新「渐入权重 + 内部层级
 * 权重 + 标注缩放」，跨档时还要补烘海岸。这些都需要节点内部的那几张容器表 ——
 * 让 MapCanvas 自己持有它们就等于把子图的私有簿记泄漏到组件里（卸载时漏清一行
 * 就是泄漏）。句柄把这些收进去，组件只喊 `sync(scale)`。
 */
export interface SubmapNode {
  /** 所属父图区块 id */
  regionId: string;
  /** 构建时的子图对象引用（内容变了要整棵重建） */
  submap: MapSubmap;
  /** 挂到父容器下的那棵子树 */
  container: Container;
  /** 按父图缩放同步：只改 alpha / 标注缩放，几何不动（跨档才补烘海岸） */
  sync(parentScale: number): void;
  /** 底图纹理或渲染器晚到时补烤一次海岸 */
  refreshCoast(): void;
  /** 销毁（含烘焙纹理与风格滤镜） */
  destroy(): void;
}

/**
 * 构建一个区块的「子图子树」并挂到父容器下（递归）。
 *
 * @param parent      挂载目标（父图的 submapLayer，或上层子图的 nestedRoot）
 * @param region      带 submap 的区块
 * @param parentScale 父图（或上层子图）当前缩放，用于算渐入权重与内部层级权重
 * @param env         渲染环境（经 ref 取，允许晚到）
 * @param depth       剩余递归深度
 */
export function buildSubmapNode(
  parent: Container,
  region: MapRegion,
  parentScale: number,
  env: SubmapEnvRef,
  depth = SUBMAP_MAX_DEPTH,
): SubmapNode | null {
  const submap = region.submap;
  if (!submap || depth <= 0) return null;

  const spec = submapNodeSpec(region, parentScale);
  if (!spec.hasSubmap) return null;

  // ── 节点根：位置/缩放 = 贴合变换；alpha = 渐入权重 ──
  const container = new Container();
  container.position.set(spec.fit.x, spec.fit.y);
  container.scale.set(spec.fit.scale);
  container.alpha = spec.enterWeight;

  // clipMask：区块多边形（画在节点本地坐标 —— 节点已含贴合变换的位移+缩放，
  // 区块 polygon 是父图世界坐标，需先换算到「贴合变换的本地」）
  const mask = new Graphics();
  mask.poly(toFlatPoints(toLocalPolygon(region.polygon, spec.fit)));
  mask.fill({ color: 0xffffff, alpha: 1 });
  container.addChild(mask);
  container.mask = mask;

  const content = new Container();
  container.addChild(content);

  // ── 内容分层（z 序：海面 → 海岸 → 分区 → 素材 → 嵌套子图 → 地名）──
  const sea = new Sprite();
  const coast = new Sprite();
  const regionRoot = new Container();
  const elementRoot = new Container();
  const nestedRoot = new Container();
  const labelRoot = new Container();
  content.addChild(sea, coast, regionRoot, elementRoot, nestedRoot, labelRoot);

  // ── 子图海面：子图自己的底图（缺纹理时留空精灵，纹理到位后由 refreshCoast 补）──
  //
  // 【为什么「没有陆地就不画海」】圈定生成的子图（路径 B）是从父图陆地里圈出来的一块，
  // 它没有自己的陆地 —— 此时若铺一层海面，就会在父图的陆地中央凭空开出一片海，
  // 边界处还会留下一条生硬的矩形接缝。没有陆地就保持透明，让父图的地表直接透上来，
  // 这正是路径 B「无缝长在区块里」要的效果。
  // 有陆地（路径 A′ 绑定了一张完整小地图）时才有"自己的海"，海岸烘焙也需要它垫底。
  const hasLand = Boolean(submap.land && submap.land.polygons.length > 0);
  const applySea = () => {
    sea.visible = hasLand;
    if (!hasLand) return;
    const tex = env.current.textures[submap.baseImageId];
    if (!tex) return;
    sea.texture = tex;
    sea.anchor.set(0.5);
    sea.position.set(
      submap.bounds.x + submap.bounds.width / 2,
      submap.bounds.y + submap.bounds.height / 2,
    );
    sea.width = Math.max(1, submap.bounds.width);
    sea.height = Math.max(1, submap.bounds.height);
  };
  applySea();

  // ── 风格滤镜：分区 / 素材 / 地名跟着**子图自己的**风格走（海岸在烘焙期上色）──
  //
  // 【为什么每次 new 一个实例】`ColorMatrixFilter` 的 saturate/brightness 是就地累乘，
  // 复用实例会让"切回原色"回不到原色（见 style.ts 的 filterFor）。
  const styleFilter: ColorMatrixFilter | null = filterFor(submap.style);
  if (styleFilter) {
    const filters = [styleFilter];
    regionRoot.filters = filters;
    elementRoot.filters = filters;
    labelRoot.filters = filters;
  }

  /** 最近一次 sync 用到的父图缩放（`refreshCoast` 没有入参，靠它取当前值） */
  let lastParentScale = parentScale;

  // ── 子图分区：按层级分容器，容器 alpha = 子图自己的层级权重 ──
  //
  // 【分组是静态的，权重是动态的】`plan.levels`（哪一级有哪些区块）只在内容变化时
  // 变；而 `levelAlphas` 随等效缩放连续变 —— 把它抄进 build 期就等于把权重冻在
  // 「进入子图那一瞬间」的缩放上，之后再怎么放大也不会逐级显露。
  const plan = submapContentPlan(submap, spec.effectiveScale);
  const levelContainers = new Map<number, Container>();
  /** 每级的边界 Graphics 与它对应的多边形（跨档重画时用） */
  const borderGraphics: Array<{ g: Graphics; regions: MapRegion[] }> = [];

  for (const { level, regions } of plan.levels) {
    const levelContainer = new Container();
    levelContainer.alpha = plan.levelAlphas[level] ?? 0;

    // 填充：只建一次（与层级权重无关，权重落在容器 alpha 上）
    const fill = new Graphics();
    for (const subRegion of regions) {
      fill.poly(toFlatPoints(subRegion.polygon));
      fill.fill({ color: subRegion.color, alpha: REGION_FILL_ALPHA });
    }

    // 边界：屏幕恒定线宽，线宽变了要重画（见 `drawBorders`）
    const border = new Graphics();
    levelContainer.addChild(fill, border);
    regionRoot.addChild(levelContainer);
    levelContainers.set(level, levelContainer);
    borderGraphics.push({ g: border, regions });
  }

  /**
   * 重画全部边界（线宽随等效缩放变化）。
   *
   * 【为什么要重画而不是改样式】Graphics 的描边在 `stroke()` 那一刻就固化进几何，
   * 之后没有「改线宽」的接口 —— 这一步只能重建。
   */
  let drawnBorderWidth = -1;
  const drawBorders = (effectiveScale: number) => {
    const width = submapBorderWidth(effectiveScale);
    if (width === drawnBorderWidth) return;
    drawnBorderWidth = width;
    for (const { g, regions } of borderGraphics) {
      g.clear();
      for (const subRegion of regions) {
        g.poly(toFlatPoints(subRegion.polygon));
        g.stroke({
          width,
          color: REGION_BORDER_COLOR,
          alpha: REGION_BORDER_ALPHA,
          alignment: 0.5,
        });
      }
    }
  };
  drawBorders(spec.effectiveScale);

  // ── 子图素材：与父图同一条渲染规则（脚底锚点 + 层级尺寸因子 + 层级容器 alpha）──
  const elementContainers = new Map<number, Container>();
  const looseElementKey = -1;
  const levelCount = plan.levelAlphas.length;
  for (const el of submap.elements) {
    const def = SPRITE_MAP[el.spriteId];
    if (!def) continue;
    const key =
      el.level === null || !Number.isFinite(el.level)
        ? looseElementKey
        : Math.max(0, Math.min(levelCount - 1, Math.trunc(el.level)));
    let target = elementContainers.get(key);
    if (!target) {
      target = new Container();
      target.alpha = key === looseElementKey ? 1 : plan.levelAlphas[key] ?? 0;
      elementContainers.set(key, target);
      elementRoot.addChild(target);
    }
    const sprite = new Sprite(env.current.textures[el.spriteId] ?? Texture.EMPTY);
    sprite.anchor.set(0.5, 1);
    sprite.position.set(el.x, el.y);
    const factor = elementSizeFactor(el.level, levelCount);
    sprite.width = def.baseWidth * el.scale * factor;
    sprite.height = def.baseHeight * el.scale * factor;
    sprite.rotation = (el.rotation * Math.PI) / 180;
    target.addChild(sprite);
  }

  // ── 子图地名：复用 labelSync（同一套层级容器 + 避让 + 屏幕恒定字号）──
  const labelHandles = syncLabels(labelRoot, submap.labels, levelCount);
  applyLabelWeights(labelRoot, plan.levelAlphas);
  setLabelScale(labelHandles.values(), Math.max(1e-6, spec.effectiveScale));

  // ── 海岸烘焙（子图自己的陆地 + 风格 + 纸纹）──
  let coastRt: ReturnType<typeof bakeCoast> | null = null;
  let bakedKey: string | null = null;

  const bake = (effectiveScale: number) => {
    const land = submap.land;
    const renderer = env.current.renderer;
    // 没陆地 / 渲染器未就绪：保持隐藏（不销毁容器，下次直接复用）
    if (!land || land.polygons.length === 0 || !renderer) {
      coast.visible = false;
      return;
    }
    const resolution = submapBakeResolution(effectiveScale, env.current.baseResolution);
    const paper = env.current.textures[submap.baseImageId] ?? null;
    // 指纹含分辨率与纸纹：跨档/换底图才重烘（烘焙是三次高斯模糊，不能每格跑）
    const key = `${bakeKeyOf(land, submap.style, resolution) ?? "none"}|${paper ? "paper" : "flat"}`;
    if (key === bakedKey) return;
    bakedKey = key;

    // 先建后换，避免闪一帧空白
    const next = bakeCoast({
      renderer,
      land,
      style: submap.style,
      paperTexture: paper,
      // 子图有自己的纸：纸纹要铺满**子图自己的** bounds，而不是父图的纸
      paperRect: submap.bounds,
      resolution,
    });
    const prev = coastRt;
    coast.texture = next;
    // 纹理覆盖「陆地包围盒外扩 BAKE_MARGIN」这块子图本地矩形（与父图同一口径）
    coast.position.set(land.bounds.x - BAKE_MARGIN, land.bounds.y - BAKE_MARGIN);
    coast.width = land.bounds.width + BAKE_MARGIN * 2;
    coast.height = land.bounds.height + BAKE_MARGIN * 2;
    coast.visible = true;
    coastRt = next;
    prev?.destroy(true);
  };
  bake(spec.effectiveScale);

  // ── 递归：子图的区块若再嵌子图，继续挂（坐标系 = 子图本地）──
  const nestedNodes: SubmapNode[] = [];
  for (const subRegion of submap.regions) {
    if (!subRegion.submap) continue;
    const child = buildSubmapNode(nestedRoot, subRegion, spec.effectiveScale, env, depth - 1);
    if (child) nestedNodes.push(child);
  }

  parent.addChild(container);

  return {
    regionId: region.id,
    submap,
    container,
    sync(parentScale: number) {
      lastParentScale = parentScale;
      // 父图尺度重算一次规格（渐入权重与等效缩放都随父图缩放变）
      const live = submapNodeSpec(region, parentScale);
      if (!live.hasSubmap) return;
      container.alpha = live.enterWeight;

      // 渐入权重只管"子图整体显不显示"；它一旦为 0，内部权重算出来也没人看得见
      if (live.enterWeight <= 0.004) return;

      // 内部层级权重**必须重算**：它由等效缩放驱动，是「缩进去逐级显露洲/国家/郡」
      // 的全部来源。抄 build 期那份就等于把子图冻在最粗一级。
      const alphas = submapLevelAlphas(submap, live.effectiveScale);
      for (const [level, levelContainer] of levelContainers) {
        levelContainer.alpha = alphas[level] ?? 0;
      }
      for (const [key, elementContainer] of elementContainers) {
        elementContainer.alpha =
          key === looseElementKey ? 1 : elementWeight(key, alphas);
      }
      applyLabelWeights(labelRoot, alphas);
      setLabelScale(labelHandles.values(), Math.max(1e-6, live.effectiveScale));
      drawBorders(live.effectiveScale);
      // 跨分辨率档才真的重烘（`bake` 内部按指纹短路）
      if (coast.visible) bake(live.effectiveScale);

      for (const child of nestedNodes) child.sync(live.effectiveScale);
    },
    refreshCoast() {
      applySea();
      // 纹理晚到：指纹里的纸纹标记会变，`bake` 会真的重烘一次
      bakedKey = null;
      bake(submapNodeSpec(region, lastParentScale).effectiveScale);
    },
    destroy() {
      for (const child of nestedNodes) child.destroy();
      coastRt?.destroy(true);
      coastRt = null;
      styleFilter?.destroy();
      container.destroy({ children: true });
    },
  };
}

/**
 * 把「父图世界坐标的多边形」换算到「贴合变换本地坐标」。
 *
 * clipMask 画在 node 本地（node 已乘了 fit 的位移+缩放），所以 mask 的顶点必须是
 * 「子图本地坐标」—— 但区块 polygon 是父图世界坐标。换算：本地 = (世界 - fit 中心) / scale。
 */
function toLocalPolygon(
  polygon: readonly { x: number; y: number }[],
  fit: SubmapFit,
): Array<{ x: number; y: number }> {
  const s = fit.scale;
  return polygon.map((p) => ({ x: (p.x - fit.x) / s, y: (p.y - fit.y) / s }));
}
