/**
 * 区块名称层 —— 把 `MapRegion.name` 当作**国名**画在区块中央（对齐逆向目标的呈现）。
 *
 * 【为什么需要它】参考目标的国名（拂秣国 / 薛国 / 南诏 / 倾安）是"政治区划"的可读性
 * 载体：色块只说明"这里有一块"，名字才说明"这是哪一块"。本项目 2.38.0 之前，
 * 区块只有填充与边界、**没有任何名称**，用户读到的是"很多格子"，不是"很多国家"。
 *
 * 【为什么是独立一层，而不是塞进 `labelLayer`】
 *   · 归属不同：地名（`MapLabel`）属于**文档内容**，可编辑、进撤销栈、写进 `doc.labels`；
 *     国名是**区块的派生显示**，改名要改 `region.name`，不能混进标注表；
 *   · 层级不同：国名的透明度必须跟**区块**的 LOD 权重走（和填充、边界同呼吸），
 *     而地名跟的是"素材/标注"那一套权重；
 *   · 顺序不同：国名要压在区块边界之上、素材与地名之下 —— 它是"分区层"的最上面，
 *     参考目标里树林直接盖住了"南诏"两个字，正是这个关系。
 *
 * 【与 `labelSync` 的三条纪律完全一致】
 *   1. **增量**：只在"层级首次可见"或"区块变了"时建节点，不是每帧；
 *   2. **字号写死在世界坐标**：国名随地图缩放（它属于地表），不像地名那样反向缩放。
 *      这一点是刻意的 —— 参考目标的国名是"印在地图上"的，放大时会跟着变大；
 *   3. **层级权重落在容器 alpha 上**：由调用方（`MapCanvas`）写，本模块不碰。
 *
 * 【为什么只给 0~2 层建名】第 3 层是郡（默认 160 块）。郡名会与地名抢同一片区域、
 * 且字号只有十几像素，读不出内容还糊住地形。参考目标在同等缩放下也只显示国名。
 */

import { Container, Text, TextStyle } from "pixi.js";
import { polygonArea, type MapRegion } from "../../regions";

/**
 * 国名的字体族。
 *
 * 与地名同一族（`labelSync.LABEL_FONT_FAMILY`）：宋体/思源的衬线笔画才是"古地图
 * 上的字"。无衬线会让国名读起来像 UI 文案 —— 参考目标的国名是明显的衬线。
 * 这里不 import 那个常量，是为了避免"改地名样式顺手改了国名"的隐式耦合：
 * 两者是**同一族但不同用途**，将来地名换成别的字族时国名不该跟着变。
 */
export const REGION_NAME_FONT_FAMILY = '"Songti SC","Noto Serif SC",serif';

/**
 * 字色：纯白。
 *
 * 【2.42.0 对齐逆向目标】参考实现的国名是 `#ffffff`（取证：decoded.js 国名文本段），
 * 压在色块与地形符号上都很稳；深褐会让国名跟边界色混在一起，读不出"国"的层级感。
 */
export const REGION_NAME_FILL = 0xffffff;

/**
 * 整体不透明度。
 *
 * 0.6 —— 对齐逆向目标（取证：国名 α 0.6）：半透明白压在色块上，能读，
 * 但地形与树林仍透得过来。地名带 3px 白描边仍是前景信息，不会被压过。
 */
export const REGION_NAME_ALPHA = 0.6;

/**
 * 字距系数（× 字号）。
 *
 * 0.22 —— 古地图的国名是**疏排**的（"拂 秣 国"三个字之间有明显间隙），
 * 紧排会读成现代排版。这个比例在 2 字与 4 字的名字上都站得住。
 */
export const REGION_NAME_LETTER_SPACING = 0.22;

/**
 * 字号系数：`世界字号 = 系数 × √区块面积`。
 *
 * 【0.19 的推导】字号要按**屏幕**看：`屏幕字号 = 系数 × √面积 × 当前缩放`。
 * 而 LOD 让每一级在自己的主视区间里落在一个固定缩放带上（`naturalScales`），
 * 于是"√面积 × 缩放"在同一层内近似常数 —— 实测全图视角（scale≈0.8）下
 * `√面积 × 缩放 ≈ 158`，0.19 × 158 ≈ **30 px**，正是参考目标国名的量级。
 * 换成屏幕恒定字号（像地名那样 `1/scale`）反而错了：国名会在地图放大时不变大，
 * 看起来像浮在图上的贴纸。
 */
export const REGION_NAME_SIZE_RATIO = 0.19;

/** 单块字号相对该层均值的下限 / 上限（防止"小碎片配大字"与"大国配小字"） */
export const REGION_NAME_SIZE_MIN_SCALE = 0.75;
export const REGION_NAME_SIZE_MAX_SCALE = 1.3;

/**
 * 面积小于该层均值这一比例的区块不出名字。
 *
 * 0.28² ≈ 0.08：块小到连一个字都放不下时，名字只会糊在边界上。参考目标里
 * 那些细长的沿海小国同样没有名字。
 */
export const REGION_NAME_MIN_AREA_RATIO = 0.28;

/**
 * 最高到哪一层出名字（含）。
 *
 * 【2.42.0】层级已下线：区域只有国家一级（level 0），本常量只要不低于 0 即可；
 * 保留 2 让显式多级的测试文档（引擎仍支持 `generateHierarchy(显式 levelCounts)`）
 * 同样能出名字，不随产品层收口而收窄。
 */
export const REGION_NAME_MAX_LEVEL = 2;

/**
 * 层级容器 alpha 低于此值就不建名字节点。
 *
 * 与 `lod.ts` 的 `LOD_ALPHA_EPSILON`（0.004）同量级但不共用：那个是"层级算不算
 * 可见"的判据，这个是"值不值得为它建 160 个文字节点"的成本门槛 —— 0.02 时屏幕上
 * 本来也读不出字。
 */
export const REGION_NAME_ALPHA_EPS = 0.02;

/** 文字纹理分辨率上限（跟随 DPR，封顶 2；与 `labelSync.labelResolution` 同口径） */
export const REGION_NAME_RESOLUTION_MAX = 2;

/**
 * 单块国名的世界字号。
 *
 * @param area      该区块多边形面积（世界单位²）
 * @param meanArea  同层区块的平均面积（决定"这一层的字该多大"）
 */
export function regionNameFontSize(area: number, meanArea: number): number {
  const base = Math.sqrt(Math.max(1, meanArea)) * REGION_NAME_SIZE_RATIO;
  const own = Math.sqrt(Math.max(1, area)) * REGION_NAME_SIZE_RATIO;
  return Math.min(
    base * REGION_NAME_SIZE_MAX_SCALE,
    Math.max(base * REGION_NAME_SIZE_MIN_SCALE, own),
  );
}

/** 文字纹理分辨率：跟随设备像素比、封顶 2（jsdom 下 devicePixelRatio 缺省 1） */
function nameResolution(): number {
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  return Math.min(dpr, REGION_NAME_RESOLUTION_MAX);
}

/**
 * 清空一个国名容器（销毁全部节点）。
 *
 * 【为什么以"容器现有子节点"为准，而不是另存一份节点表】国名容器只由本模块写入
 * （`syncRegionNameGroup`），子节点即事实源 —— 多存一份数组就多一处可能与场景图
 * 不一致的记账。与 `labelSync` 用 WeakMap 存句柄的理由不同：那里要按 id 做增量，
 * 这里每次都是整层重建。
 */
function clearRegionNameContainer(container: Container): void {
  for (const child of [...container.children]) {
    container.removeChild(child);
    child.destroy({ children: true });
  }
}

/**
 * 按 `regions` 重建该层的国名（清空 + 重建）。
 *
 * 【为什么是"清空重建"而不是增量】区块的增删改几乎总是整批发生（生成 / 清除 /
 * 撤销），且名字与面积都来自区块本身 —— 增量比对省下的那点时间抵不上"漏更新一个
 * 名字"的排查成本。真正的成本控制靠**调用时机**（只在层级首次可见时做一次），
 * 不靠这里省。
 *
 * 【透明度不在这里写】`container` 是层级容器的子节点，层级 alpha（LOD 权重）
 * 由 `MapCanvas` 写在**层级容器**上，文字自然跟着淡入淡出 —— 若在节点上再乘一次
 * 权重，就是双重衰减。
 *
 * @returns 实际创建的节点数（0 = 该层没有可用区块或全部太小）
 */
export function syncRegionNameGroup(
  container: Container,
  regions: readonly MapRegion[],
  level: number,
): number {
  clearRegionNameContainer(container);

  const pool: MapRegion[] = [];
  const areas: number[] = [];
  for (const region of regions) {
    if (region.level !== level) continue;
    if (region.polygon.length < 3) continue;
    if (!region.name.trim()) continue;
    pool.push(region);
    areas.push(polygonArea(region.polygon));
  }
  if (pool.length === 0) return 0;

  let sum = 0;
  for (const a of areas) sum += a;
  const meanArea = sum / pool.length;
  // 面积门槛按**线性尺度**比较：区域线性尺寸小于均值的 0.28 就放不下名字
  const minArea = meanArea * REGION_NAME_MIN_AREA_RATIO * REGION_NAME_MIN_AREA_RATIO;
  const resolution = nameResolution();

  let created = 0;
  for (let i = 0; i < pool.length; i += 1) {
    if (areas[i] < minArea) continue;
    const region = pool[i];
    const fontSize = regionNameFontSize(areas[i], meanArea);
    const node = new Text({
      text: region.name,
      style: new TextStyle({
        fontFamily: REGION_NAME_FONT_FAMILY,
        fontSize,
        fill: REGION_NAME_FILL,
        letterSpacing: fontSize * REGION_NAME_LETTER_SPACING,
        align: "center",
      }),
    });
    // 锚点居中：位置用区块的 `seed`（生成时就已 `settleInside` 拉进多边形，
    // 比质心更稳 —— 质心对凹形区块可能落在块外）
    node.anchor.set(0.5, 0.5);
    node.position.set(region.seed.x, region.seed.y);
    node.alpha = REGION_NAME_ALPHA;
    node.resolution = resolution;
    container.addChild(node);
    created += 1;
  }
  return created;
}
