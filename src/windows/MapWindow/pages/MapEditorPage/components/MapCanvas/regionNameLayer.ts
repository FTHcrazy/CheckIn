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
import { BASE_IMAGE } from "../../sprites";

/**
 * 投影参数 —— 对齐参考 `shadow: "10"` / `shadow_color: "#000000"`。
 *
 * 模糊半径直接取参考的 10（世界单位）：30 号的小国字半径 10 会把字吃掉，
 * 所以按**字号的 1/6** 换算会在 5~17 之间浮动；但参考是恒定 10、且它最小字号
 * 也是 30 —— 说明 10 在 30 号字上仍是"外圈一圈灰"。这里照抄 10，不自己发明比例。
 *
 * `distance: 0` 是刻意的：距离非 0 会让字在背光侧明显"脱开"色块，读着像浮字；
 * 纯模糊投影只压边缘，正文字形不动。
 */
export const REGION_NAME_SHADOW_COLOR = 0x000000;
export const REGION_NAME_SHADOW_BLUR = 10;
export const REGION_NAME_SHADOW_DISTANCE = 0;
/**
 * 1 —— 参考的 `shadow_color: "#000000"` 是**不透明黑**（取证：decoded.js 国名文本段，
 * `shadow_color` 字段没有独立 alpha，渲染层按不透明画）。
 *
 * 【2.51.0 从 0.5 提到 1 的实测依据】用户对比参考成图后指认"国名很不明显"：
 * 参考的白字 α0.6 之所以读得出，靠的是**整圈不透明黑晕**把浅色底先压暗一圈，
 * 白笔画浮在黑晕上形成灰白字形 —— 远看反而像"深色大字"（这正是参考截图里的
 * 观感）。α0.5 的淡晕压不住 2.43.0 粉彩的浅底，字形糊进色块里。
 * 之前注释里"投影再重会变成黑边字"的顾虑不成立：字本身 α0.6 是半透的，
 * 黑晕透进来正形成参考那种灰调，不是生硬的黑描边。
 */
export const REGION_NAME_SHADOW_ALPHA = 1;

/**
 * 国名的字体族。
 *
 * 【2.51.0 起首推隶书】参考国名的 `font: "隶书"`（取证：decoded.js 国名文本段）。
 * 隶书笔画粗、白色实心面积大，是参考国名"一眼可见"的另一半原因 —— 宋体/思源的
 * 细横细竖压在浅粉彩上只剩一圈若隐若现的白丝。Windows 自带 `LiSu`、macOS 无
 * 隶书时回落宋体/思源衬线，观感稍细但仍是"古地图上的字"。
 * （参考的 `device_type 1` 用"阿里妈妈刀隶体"是它的分发字体，本项目不引入。）
 */
export const REGION_NAME_FONT_FAMILY = '"LiSu","隶书","Songti SC","Noto Serif SC",serif';

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
 * **0 —— 与逆向目标一致**：参考的国名文本样式是 `word_spacing: 0`
 * （取证：decoded.js 国名文本段）。2.42.0 曾取 0.22 做"古地图疏排"效果，
 * 但那是自造：疏排把 3 字国名拉宽 44%，压到小国的边界上就溢出去了，
 * 而参考本身就是紧排。系数留成常量是为了让调用点仍走同一个乘式。
 */
export const REGION_NAME_LETTER_SPACING = 0;

/**
 * 国名字号的**基准值** —— 逆向目标的原值。
 *
 * 参考的 country 文本默认 `size: 56`（取证：decoded.js@575177 国名文本段）。
 * 它是**世界单位**：页面高 1123 ⇒ 56 约占纸高 5%，适配缩放（0.57）下屏幕上
 * 约 32px，正是参考成图里国名的量级。
 *
 * 【为什么没有参考的 48 那一支】参考里还有 `.7 > scale_radio && (size = 48)`——
 * 那是它按**生成时屏幕比例**做的补偿（同一份文档在小窗口里生成，字要小一号）。
 * 我们的字号落在世界坐标、随视口统一缩放，没有"生成时屏幕比例"这个输入，
 * 等价于恒取它 ≥0.7 的那一支。
 */
export const REGION_NAME_SIZE_BASE = 56;

/**
 * 判据里参与比较的**字数**。
 *
 * 【为什么恒为 4】参考在决定字号时用的还是默认名 `name: "蒙特公国"`（4 字）——
 * 真正的国名是在字号定完之后才从词池里抽的（`ctrls.rand_text` 调用在
 * `size` 判据之后）。所以这条判据跟实际国名几个字**无关**，恒按 4 字算。
 */
export const REGION_NAME_REF_LEN = 4;

/**
 * 大国的字号（参考 `size: 100`）与小国的字号（参考 `size: 30`）。
 *
 * 参考只有三档：块够宽就给 100，窄到放不下就给 30，其余用基准 56。
 * 不是"按面积连续插值"—— 那会让一块地的名字大小取决于邻居的平均面积，
 * 同一张图上字号参差又互不成规律，读起来像排版事故。
 */
export const REGION_NAME_SIZE_BIG = 100;
export const REGION_NAME_SIZE_TINY = 30;

/** 参考页宽（`page_size.width`），把它的绝对阈值折算成"占纸宽的比例"用 */
const REF_PAGE_WIDTH = 1587;

/**
 * 判据阈值（占纸宽比例）：
 *   块宽 > `字数 × 字号 × 4.5` ⇒ 给 100；块宽 < `字数 × 字号 × 2` ⇒ 给 30。
 *
 * 【为什么要按纸宽折算】参考的阈值是绝对世界单位（1008 / 448，页面宽 1587）。
 * 我们的纸是 1447 宽 —— 直接照抄绝对数会让"同一张图上的国家"整体偏小一档。
 * 折算成比例后，等价于参考的观感：纸宽的 63.5% 以上算"大国"，28.2% 以下算"小国"。
 */
export const REGION_NAME_BIG_WIDTH_RATIO =
  (REGION_NAME_REF_LEN * REGION_NAME_SIZE_BASE * 4.5) / REF_PAGE_WIDTH;
export const REGION_NAME_TINY_WIDTH_RATIO =
  (REGION_NAME_REF_LEN * REGION_NAME_SIZE_BASE * 2) / REF_PAGE_WIDTH;

/**
 * 面积小于该层均值这一比例的区块不出名字。
 *
 * 0.28² ≈ 0.08：块小到连一个字都放不下时，名字只会糊在边界上。参考没有这道
 * 门槛（它只有三档字号，最小 30），但它的块来自六边形格集合生长、下限有保证；
 * 我们的块可能含"两格宽的长条"，30 号字压上去会横穿到邻国 —— 所以保留这道闸。
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
 * 单块国名的世界字号 —— 照抄逆向目标的三档判据（`decoded.js@575177`）：
 *
 * ```js
 * h = { size: 56, ... };                       // 基准
 * k = extent[2] - extent[0];                   // 该块外接矩形**宽度**
 * k > g.name.length * g.size * 4.5 && (g.size = 100);
 * k < g.name.length * g.size * 2   && (g.size = 30);
 * ```
 *
 * 【为什么是"块宽"而不是"面积"】参考真正在判的是**这行字放不放得下**：
 * 国名是横排的，宽度才是约束；面积大的块未必宽（细长的沿海国横排照样溢出），
 * 面积小的块也可能很宽（横贯半岛的窄条）。用 √面积 当尺子，是"看起来差不多"
 * 的近似，会把宽而扁的块判成大字号。
 *
 * @param blockWidth 该块外接矩形宽度（世界单位，含飞地）
 * @param pageWidth  纸宽（世界单位）。默认取底图宽 —— 阈值是"占纸宽的比例"。
 */
export function regionNameFontSize(
  blockWidth: number,
  // 标 `number`：`BASE_IMAGE` 是 `as const`，默认值会把参数收窄成字面量 1447，
  // 调用方传别的纸宽（单测、将来的 A 系列纸上尺寸）会直接类型报错
  pageWidth: number = BASE_IMAGE.width,
): number {
  const w = Number.isFinite(blockWidth) ? Math.max(0, blockWidth) : 0;
  const page = Number.isFinite(pageWidth) && pageWidth > 0 ? pageWidth : REF_PAGE_WIDTH;
  if (w > page * REGION_NAME_BIG_WIDTH_RATIO) return REGION_NAME_SIZE_BIG;
  if (w < page * REGION_NAME_TINY_WIDTH_RATIO) return REGION_NAME_SIZE_TINY;
  return REGION_NAME_SIZE_BASE;
}

/**
 * 区块外接矩形的**宽度**（世界单位）。
 *
 * 【为什么要算飞地】多块单元（`MapRegion.pieces`，如被海湾切开的沿海国）的
 * 主体只占其中一块，只量主体会把"横跨两岸的宽国"判成窄国、字号掉到 30。
 */
function blockWidthOf(region: MapRegion): number {
  let minX = Infinity;
  let maxX = -Infinity;
  const visit = (ring: readonly { x: number; y: number }[]) => {
    for (const p of ring) {
      if (!Number.isFinite(p.x)) continue;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
    }
  };
  visit(region.polygon);
  for (const ring of region.pieces ?? []) visit(ring);
  return Number.isFinite(minX) ? maxX - minX : 0;
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
    const fontSize = regionNameFontSize(blockWidthOf(region));
    const node = new Text({
      text: region.name,
      style: new TextStyle({
        fontFamily: REGION_NAME_FONT_FAMILY,
        fontSize,
        fill: REGION_NAME_FILL,
        letterSpacing: fontSize * REGION_NAME_LETTER_SPACING,
        align: "center",
        /**
         * 深色投影 —— 对齐参考的 `shadow: "10"` + `shadow_color: "#000000"`。
         *
         * 【为什么必须有】2.43.0 换粉彩色板之后，白字 α0.6 压在浅粉/浅黄块上
         * 对比度极低（合成后只差 ~9 级），单靠不透明度已经读不出字形。参考用
         * 阴影而不是描边来解决：描边会把 30 号的小国字糊成一团，模糊投影只在
         * 笔画外侧压一圈灰，字仍然干净。
         */
        dropShadow: {
          color: REGION_NAME_SHADOW_COLOR,
          alpha: REGION_NAME_SHADOW_ALPHA,
          blur: REGION_NAME_SHADOW_BLUR,
          distance: REGION_NAME_SHADOW_DISTANCE,
          angle: 90,
        },
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
