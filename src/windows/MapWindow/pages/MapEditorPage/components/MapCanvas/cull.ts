/**
 * 视口粗剔除（B5 / PRD §6.6.1）
 *
 * 【为什么要剔除】缩到"国家"那一级时，画面里只看得到十来个区块，而场景图里
 * 躺着 160 个郡级块 + 300 条地名 —— 它们 alpha 为 0、画不出东西，却仍在
 * 提交批次里被遍历。粗剔除把整层容器的 `visible` 关掉，一次赋值省掉整段遍历。
 *
 * 【为什么按"层级容器"粗剔，不做逐块】逐块要遍历 600 个多边形、每个算一次相交，
 * 省下的绘制反而更少 —— 同一层级的区块在屏幕上本来就成簇出现，要么都在、
 * 要么都不在。
 *
 * 【两个坐标系，别混（这是唯一一处真的会静默出错的地方）】
 *   · `getBounds()`      → **舞台空间**：父级变换（`world` 的 position/scale）
 *                          已经乘进去，= 画布像素。**它随视口变化**。
 *   · `getLocalBounds()` → **局部空间**：只有自己的子树，与视口无关。恒定。
 * 剔除比较的"视野框"是当前帧的屏幕矩形（`screenCullRect`），所以参与比较的
 * 包围盒也必须是当前帧的舞台矩形。
 *
 * ⚠️ **所以可以缓存的只有 `getLocalBounds()`**。曾经这里缓存的是 `getBounds()`
 * 的结果，且失效条件只看"内容引用变没变"——视口一变，缓存里躺着的是旧变换下
 * 算出的矩形，拿它跟新视野比得到 `visible=false`，缩回来时命中缓存仍是 false，
 * **整层永久隐身**直到下一次内容变更才自愈。表现为"偶发、时好时坏"。
 * 现在的做法：缓存局部矩形（安全），每次剔除时用容器**当前**的全局变换
 * （`toGlobal`，`getGlobalTransform` 会现算，不会读到脏矩阵）把两个角点搬到
 * 舞台空间 —— 缓存依然有效，且天然随视口变。
 *
 * 【为什么用容器的 `toGlobal` 而不是外部传一个投影函数】层级容器自己就是
 * "局部 → 舞台"的全部信息源；从外面塞一个 `worldToScreen` 进来，就等于把
 * "层级容器相对 world 是恒等变换"变成一个隐含约定，将来谁给层级容器加了
 * 偏移，剔除就会静默错误。
 */
import type { Container } from "pixi.js";
import type { CanvasSize, Viewport } from "../../coords";

/**
 * 剔除余量（**世界单位**，用前按当前缩放折成像素）。
 *
 * 64 的来历：素材有高度（山体底部锚点在 y、图向上延伸一两百世界单位）、
 * 地名以锚点为中心还有半行高、海岸的白边会溢出陆地包围盒 —— 取 64 是在
 * "别把该画的裁掉"与"别把远处的也算进来"之间的折中，与 `BAKE_MARGIN` 同量级。
 */
export const CULL_MARGIN = 64;

/** 轴对齐矩形（与 pixi `Bounds` 的 min/max 表示一致） */
export interface CullRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 两个轴对齐矩形是否相交（共边算相交：贴着视野边缘的内容不该被裁掉） */
export function rectsIntersect(a: CullRect, b: CullRect): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

/**
 * 屏幕空间的"可视裁剪框"：整块画布 + 四周各外扩 `margin × scale` 像素。
 *
 * 外扩必须按缩放折算：`margin` 是世界单位（和地图同一尺度），缩到 40% 时
 * 64 世界单位只有 26 像素，缩到 350% 时是 224 像素 —— 屏幕上的余量本来就该
 * 跟着缩放变，否则缩小后会误裁掉边缘上仍可见的内容。
 */
export function screenCullRect(
  size: CanvasSize,
  viewport: Viewport,
  margin = CULL_MARGIN,
): CullRect {
  const grow = margin * Math.max(1e-6, viewport.scale);
  return {
    minX: -grow,
    minY: -grow,
    maxX: size.width + grow,
    maxY: size.height + grow,
  };
}

/**
 * **局部空间**包围盒缓存（WeakMap 包装：容器的生命周期就是它的生命周期）。
 *
 * 【为什么需要这一层】`getLocalBounds()` 每次调用都要遍历整棵子树、把子节点
 * 并集求出来。剔除是"随视口变化"跑的 —— 滚轮每一格、拖拽每一帧都会跑一次，
 * 而内容（区块 / 素材 / 地名）这时**根本没变**，局部包围盒必然还是同一个。
 * 逐帧重算 600 多个多边形的并集，剔除省下的绘制还不够付自己的账。
 *
 * 【缓存的必须是局部矩形，不能是舞台矩形】见文件头那段 ⚠️。
 *
 * 失效策略刻意做成"外部按内容指纹整表清空"（见 `clear()`），而不是每个
 * 容器各存一个版本号：内容变化时几乎总是**整层**一起变（生成/清除/撤销），
 * 逐容器的版本号既不省事，还多一处可能忘记自增的地方。
 */
export interface CullCache {
  get(container: Container): CullRect | undefined;
  set(container: Container, rect: CullRect): void;
  clear(): void;
}

/** 造一份新的包围盒缓存 */
export function createCullCache(): CullCache {
  let map = new WeakMap<Container, CullRect>();
  return {
    get: (container) => map.get(container),
    set: (container, rect) => {
      map.set(container, rect);
    },
    // WeakMap 没有 clear()，直接换一张新表；旧表随 GC 回收，无需手动清理
    clear: () => {
      map = new WeakMap<Container, CullRect>();
    },
  };
}

/** 取**局部空间**包围盒（优先用缓存；未命中则问 pixi 并记账） */
export function localBoundsOf(container: Container, cache?: CullCache): CullRect {
  const cached = cache?.get(container);
  if (cached) return cached;
  const bounds = container.getLocalBounds();
  const rect: CullRect = {
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
  };
  cache?.set(container, rect);
  return rect;
}

/**
 * 局部矩形 + 容器当前的全局变换 → 舞台矩形。
 *
 * 只取两个对角点：世界变换是"缩放 + 平移"（没有旋转），两点足以定出轴对齐矩形。
 * 用 `Math.min/max` 兜住负缩放，保证 minX ≤ maxX（调用方据此可以直接比较）。
 */
export function stageRectOf(container: Container, local: CullRect): CullRect {
  const a = container.toGlobal({ x: local.minX, y: local.minY });
  const b = container.toGlobal({ x: local.maxX, y: local.maxY });
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

/**
 * 一个容器的包围盒是否与裁剪框（屏幕空间）相交。
 *
 * 非有限值（NaN / Infinity）一律判为**可见**：宁可多画一层，也不能因为一次
 * 空包围盒把整层内容藏掉。空容器的 `getLocalBounds()` 正是这种退化值。
 */
export function isBoundsVisible(
  container: Container,
  view: CullRect,
  cache?: CullCache,
): boolean {
  const local = localBoundsOf(container, cache);
  if (
    !Number.isFinite(local.minX) ||
    !Number.isFinite(local.minY) ||
    !Number.isFinite(local.maxX) ||
    !Number.isFinite(local.maxY)
  ) {
    return true;
  }
  return rectsIntersect(stageRectOf(container, local), view);
}

/**
 * 批量剔除：把每个容器的 `visible` 写成"是否与视野相交"。
 *
 * 只改 `visible`（一次赋值），不动几何、不动 alpha —— 与"分区显隐"同一类
 * 零成本开关。空容器（还没内容）的包围盒是原点处的一个点，通常落在视野内，
 * 于是不会被误判成"要隐藏"。
 */
export function cullLayers(
  containers: Iterable<Container | null | undefined>,
  view: CullRect,
  cache?: CullCache,
): void {
  for (const container of containers) {
    if (!container) continue;
    container.visible = isBoundsVisible(container, view, cache);
  }
}
