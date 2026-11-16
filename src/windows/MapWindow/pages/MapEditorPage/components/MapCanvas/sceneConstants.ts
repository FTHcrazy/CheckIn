/**
 * 地图画布的渲染常量与纯绘制辅助（渲染层配置）。
 *
 * 从 MapCanvas/index.tsx 外移：不含 React / Pixi 生命周期，
 * 场景图 effect 区的实现仍留在 index.tsx 由 render-stack-guard 钉住。
 */
import { Container, Graphics, Sprite } from "pixi.js";
import { BASE_IMAGE } from "../../sprites";
import type { Point } from "../../regions";
import { resolveElementLevel } from "../../lod";
import type { MapLabel, MapPolyline } from "../../types";
import { polylineStyleOf } from "../../polylineStyle";
import { dashPath } from "../../polylineGeometry";
import { drawPolyline } from "./polylineRender";
export const BASE_RECT = {
  x: -BASE_IMAGE.width / 2,
  y: -BASE_IMAGE.height / 2,
  width: BASE_IMAGE.width,
  height: BASE_IMAGE.height,
} as const;

/**
 * 图纸投影参数（世界单位 —— 与"纸张"同尺度，缩放时一起变化才自然）。
 *
 * 【为什么需要】底图之外留了一圈空白，若没有投影，深色底图在深色主题下会与
 * 背景糊成一片、边界消失。淡淡一圈投影让底图读作"铺在桌面上的一张图纸"，
 * 留白才成为有意义的留白，而不是"图没画满"。
 *
 * 用多圈半透明矩形叠加来近似柔和的衰减：每圈只是一次 fill，
 * 10 圈的成本可以忽略，也不需要额外的滤镜/贴图资源。
 */
export const SHEET_SHADOW = {
  /** 叠加圈数：越多衰减越柔 */
  rings: 10,
  /** 单圈外扩距离 = 底图宽度 × 0.28%（约 29 世界单位） */
  step: BASE_IMAGE.width * 0.0028,
  /** 单圈不透明度：10 圈累加后最内侧约 0.36 */
  alpha: 0.045,
  color: 0x0a1410,
  /** 整体下移，模拟顶光，纸面才有"浮起来"的立体感 */
  offsetY: BASE_IMAGE.width * 0.0035,
} as const;

/**
 * 海面暗角：纸缘向内一圈圈加深。
 *
 * 【为什么需要】海面只有一张平铺纹理时，画面是"一块均匀的布"—— 没有光、
 * 没有纵深。参考实现的海面四角明显比中心沉，读起来才像"一张被拍下来的纸"。
 *
 * 【为什么用一组窄环而不是一次径向渐变】Pixi 的径向渐变要 `FillGradient`
 * （8.x 各小版本签名不一致），而这组环只是 14 次 `stroke`，烘一次就进缓存；
 * 每环不透明度只差 0.002，肉眼看不出分层。
 */
export const SEA_VIGNETTE = {
  /** 环数（= 渐变的分段数） */
  bands: 14,
  /** 单环宽度（世界单位）：14 × 14 ≈ 196，占纸宽的 19%，只压四周不碰中心 */
  step: 14,
  /** 最内环不透明度 */
  alphaFrom: 0.004,
  /** 最外环不透明度 */
  alphaTo: 0.026,
  color: 0x06171c,
} as const;

/**
 * 选中区块的高亮参数。
 *
 * 【为什么和素材选中框不同色】素材框是 `0x5b6cf9`（偏紫蓝），区块高亮用
 * `0x5b8def`（偏天蓝）—— 同色系但能区分"我选中的是一个点"还是"一片地"。
 *
 * 【为什么描边分两笔】区块面积大、底色从米黄陆地到深绿海面都有，一条细线在
 * 米黄上几乎消失。宽而淡的外发光负责"远处也看得见"，细白线负责"近处边界清楚"。
 * 两者都是**屏幕恒定**宽度（`px / scale`），与区块边界同一口径。
 */
export const REGION_PICK_COLOR = 0x5b8def;
export const REGION_PICK_PX = 2.2;
export const REGION_PICK_GLOW_PX = 8;

/**
 * **非叶子**选中时的容器描边宽度（屏幕像素，PRD §4.4 的 1.6px）。
 *
 * 【为什么非叶子只有一笔】面高亮（填充 + 外发光）只对**叶子**（最小可操作单位）
 * 生效。大区域铺满整屏会"糊成一片"，把内部所有子区块的边界线压掉 —— 用户看不出
 * 自己在操作哪一块。容器态只沿 `P.polygon` 描一笔强调边：信息量足够（"范围在这里"），
 * 且不遮内部子边界（PRD §6-A 的第 2 条论据）。
 */
export const REGION_CONTAINER_PX = 1.6;

/* ───────────────────── 手画草稿（R-REG-03）的常量 ───────────────────── */

/**
 * 「两个屏幕点算不算同一个点」的容差（**屏幕像素**）。
 *
 * 【一个语义，三个消费者】这个数回答的永远只有一个问题：**这两个屏幕位置
 * 算同一个位置吗**。三处用它，各自问的是同一句话：
 *   ① 首顶点命中 —— "我按下的这一点，算按在首顶点上了吗"（瞄准误差）；
 *   ② 双击判定 —— "这两下 down 算同一个位置吗"（手抖 / 触控板抖动）；
 *   ③ 同点去重 —— "这个新顶点和上一个算同一个位置吗"（手抖，见页面 `index.tsx`）。
 *
 * 【为什么可以共用，而且是**必须**共用】①② 若用两个不同的半径，就会出现
 * "这一下既在双击窗口内、又在首顶点命中圈外"这类**判定打架**：同一个物理动作
 * 在两种走法下给出不同结论（一次闭合、一次只落点），用户看到的是"有时候要点两下
 * 才收尾、有时候点一下就收尾"。共用一个数之后，两条分支在同一处必然给出同一个
 * 结论 —— 都通向 `closeDraft()`。
 *
 * 【③ 为什么也用它，而不另立一个更小的数】小于 10px 的两个顶点在屏幕上本来就
 * 点不准（顶点视觉半径 3.5px、首顶点命中圈 10px），用户无法有意画出那样的边；
 * 而"手抖在同一位置点两下（间隔 > 350ms，所以没被双击吃掉）"是真实场景。
 * 换句话说：这个距离以下，**用户自己也分不清**那是不是同一个点。
 *
 * 【为什么导出】页面要在 `onCanvasClickWorld` 里做同点去重（③），画布要在
 * `drawDraft` 里把首顶点画成"可闭合"的样子（①）。三处必须是**同一个数**。
 *
 * 【为什么按屏幕像素而不是世界单位】世界单位的阈值会随缩放变化：放大到郡级时
 * 10 世界单位只有几像素（几乎点不中），缩到全景时又大得能误吃掉相邻的顶点。
 */
export const DRAFT_CLOSE_PX = 10;

/**
 * 双击判定窗口（毫秒）。
 *
 * 【为什么是 350 而不是系统的 500】这里判的不是"打开文件"那种双击，而是
 * "我要结束这个多边形"—— 用户在收尾时是**有意识**地快点两下的，窗口越宽越容易
 * 把"两个相邻的顶点"误判成收尾。350ms 比 Windows 默认 500 更严，且仍远宽于
 * 正常人的 double-click（150~250ms）。
 *
 * 【为什么必须落在 `pointerdown` 而不是 `dblclick`】`dblclick` 是浏览器在**两次
 * down/up 之后**才派发的事件 —— 那时顶点已经落下了，只能补救（多一个顶点或残留
 * 一个孤立点）。在 `pointerdown` 里判，第二次 down 根本不会进入落点分支。
 */
export const DRAFT_DOUBLE_CLICK_MS = 350;
/** 草稿连线宽度（屏幕像素） */
export const DRAFT_LINE_PX = 1.5;
/** 已落顶点的半径（屏幕像素） */
export const DRAFT_POINT_PX = 3.5;
/** 首顶点在"可以闭合"时的半径（屏幕像素）—— 变大即"这里能点" */
export const DRAFT_SNAP_PX = 6;
/** 草稿色（与区块选中同色系，但草稿全程更亮/更细） */
export const DRAFT_COLOR = 0x5b8def;
/** 预览虚线的实/虚长度（屏幕像素） */
export const DRAFT_DASH_ON_PX = 6;
export const DRAFT_DASH_OFF_PX = 4;
/** 虚线段数上限（防御：极端缩放下长度/步长会很大，不能让 for 循环无限跑） */
export const DRAFT_DASH_MAX = 400;


/**
 * 影/晕线宽的"量化档"倍率。
 *
 * 【为什么需要】白外影 / 内阴影是**屏幕恒定**的（`REGION_RIM_PX` /
 * `REGION_INNER_SHADOW_PX` 个屏幕像素），换算成世界单位是 `px / 缩放` ——
 * 缩放一变，线宽就变，而 Pixi 的 Graphics 一旦描边就固化了线宽，只能整层重建。
 * 滚轮每滚一格都重建全部多边形会明显掉帧，因此把缩放量化到 1.06 的幂次档位上，
 * 只有跨档才重建：线宽最多差 3%（肉眼不可辨），重建频率降到十几分之一。
 * **注意只量化影/晕线宽** —— 交叉淡化的权重走的是容器 `alpha`（零成本）。
 *
 * 【国家边界为什么不在其中（2.52.0）】参考的边界线宽是 `border_size *= 缩放`
 * —— **世界恒定**（`REGION_BORDER_WIDTH_WORLD`），不随缩放变化，描边几何也
 * 换成了抽稀 + 插值的平滑环（`smoothBorderRing`），与缩放解耦。
 */
export const BORDER_WIDTH_QUANTIZE = 1.06;

/**
 * 静态层缓存的倍率上限。
 *
 * 【为什么跟着缩放走】`cacheAsTexture` 会把整组内容烤成一张**固定分辨率**的纹理，
 * 之后由世界变换放大。若只用 1 倍，放到郡级（≈350%）时底图与海岸就是一张被拉大
 * 3.5 倍的图 —— 变软是必然的。所以缓存倍率取 `ceil(缩放)` 并封顶 3：
 * 1024² 的纸最大烤成 3072²（约 36MB），既能覆盖最深的缩放档，也不会无上限地涨。
 */
export const STATIC_CACHE_MAX_RES = 3;

/** 把缩放吸附到最近的量化档（用于线宽，见上） */
export function quantizeScale(scale: number): number {
  const s = Math.max(1e-6, scale);
  return BORDER_WIDTH_QUANTIZE ** Math.round(Math.log(s) / Math.log(BORDER_WIDTH_QUANTIZE));
}

/**
 * 多边形顶点数组 → Pixi Graphics.poly() 需要的扁平坐标数组 [x0,y0,x1,y1,...]
 *
 * 每帧重建数组（而非缓存）是划算的：区块只在生成/清除时变化，
 * 平时这个 effect 根本不会跑。
 */
export function toFlatPoints(polygon: Array<{ x: number; y: number }>): number[] {
  const out: number[] = [];
  for (const p of polygon) out.push(p.x, p.y);
  return out;
}

/**
 * 在 Graphics 上追加一条**虚线**（多段子路径，调用方统一 `stroke()` 一次）。
 *
 * 【为什么自己切段】Pixi v8 的 Graphics 没有原生 dash 样式（`stroke` 只认实线）。
 * 用 `moveTo/lineTo` 画若干独立子路径、最后一次 stroke，等价于"一条虚线"，
 * 且**只产生一次描边调用**（不是 20 次 stroke）—— 后者在每帧重画时是白付的。
 *
 * @param px 世界单位 / 屏幕像素（= 1 / scale）；所有"屏幕像素"常量都要乘它
 */
export function appendDashedLine(g: Graphics, a: Point, b: Point, px: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-9)) return;
  const ux = dx / len;
  const uy = dy / len;
  const on = DRAFT_DASH_ON_PX * px;
  const off = DRAFT_DASH_OFF_PX * px;
  const step = on + off;
  for (let i = 0; i < DRAFT_DASH_MAX; i += 1) {
    const start = i * step;
    if (start >= len) break;
    const end = Math.min(len, start + on);
    g.moveTo(a.x + ux * start, a.y + uy * start);
    g.lineTo(a.x + ux * end, a.y + uy * end);
  }
}

/** 一个层级的渲染容器：白外影 / 填充 / 内阴影 / 边界分四份 Graphics（重建时机各不同） */
export interface LevelLayers {
  container: Container;
  /** 白外影（2.43.0，`paint_shadow.shadow`）：画在填充**之下**，见 regions.ts 常量注释 */
  rim: Graphics;
  fill: Graphics;
  /** 内阴影（2.43.0，`paint_shadow.inner_shadow`）：画在填充之上、边界之下 */
  innerShadow: Graphics;
  border: Graphics;
  /**
   * 国名容器（该层区块的名称文字，`regionNameLayer.ts`）。
   *
   * 【为什么挂在层级容器**内部**、排在填充与边界之后】三件事一次解决：
   *   · z 序：名字必须压在边界之上（同一次 `addChild` 的顺序即保证）；
   *   · 透明度：层级容器写着 LOD 权重，名字自然跟着淡入淡出，**不需要第二处赋值**
   *     （写在节点上就是双重衰减，也会让滚轮每格多改几百个节点）；
   *   · 显隐：`showRegions` 关掉整层时名字一起消失（国名是"分区"的一部分）。
   */
  names: Container;
}

/**
 * 素材层级容器的哨兵键：**层级无关**。
 *
 * 生成区块之前放置的素材没有层级可言（那时还没有任何分区），放在这个容器里、
 * alpha 恒为 1，任何缩放下都可见。它排在所有层级容器之后，因此永远画在最上层。
 */
export const LOOSE_LEVEL_KEY = -1;

/** 一个已放置素材的渲染句柄：精灵本体 + 它当前挂在哪个层级容器下 */
export interface ElementSprite {
  sprite: Sprite;
  /** 层级容器的键（见 `LOOSE_LEVEL_KEY`）。与 `elementLayersRef` 的键同域 */
  key: number;
}

/**
 * 素材所属的层级容器键。
 *
 * 与 `lod.ts` 的 `resolveElementLevel` 同一条规则（越界并入最细一级、无层级归 LOOSE），
 * 只差在把 `null` 映射成哨兵键 —— 渲染层要的是一个可索引的容器编号。
 */
export function elementKeyOf(level: number | null | undefined, levelCount: number): number {
  const resolved = resolveElementLevel(level, levelCount);
  return resolved === null ? LOOSE_LEVEL_KEY : resolved;
}

/** 缺省权重（不画任何区块）。用模块级常量避免每次渲染都造一个新数组引用。 */
export const NO_LEVELS: number[] = [];

/** 缺省标注（同上：稳定引用，否则标注同步 effect 每次渲染都会重跑一遍） */
export const NO_LABELS: readonly MapLabel[] = [];

/** 缺省折线（同上：稳定引用，否则折线重绘 effect 每帧都会重跑） */
export const NO_POLYLINES: readonly MapPolyline[] = [];

/**
 * 折线节点手柄的命中半径（**屏幕像素**）。
 *
 * 【为什么按屏幕而不是世界单位】世界单位会随缩放变大变小：缩小到整图时
 * 8 世界单位只有 2 像素（根本点不中），放大到郡级时又变成 28 像素（旁边的线都
 * 被吸过来）。屏幕恒定才是"手柄看起来多大就能点多大"。
 */
export const POLYLINE_NODE_HIT_PX = 8;

/** 折线节点手柄的绘制半径（屏幕像素，比命中圈略小：看得见的不该比点得中的大） */
export const POLYLINE_NODE_PX = 4;

/** 选中折线时的高亮描边宽度（屏幕像素） */
export const POLYLINE_PICK_PX = 1.4;

/**
 * 绘制态预览的虚线节奏（屏幕像素，`[实, 虚]`）。
 *
 * 【为什么这里按屏幕像素、而线本身按世界单位】预览只是"从末点到光标"的一段
 * 临时指示，它不是内容：缩得再远也应该是一眼可辨的虚线。真正的线用世界单位
 * （见 `polylineStyle.ts`），因为它是地图内容、要随图缩放。
 */
export const POLYLINE_PREVIEW_DASH_PX: readonly [number, number] = [7, 5];

/**
 * 折线绘制态的预览：已落的一段按**真实样式**画 + 顶点圆点 + 末点到光标的虚线。
 *
 * 【为什么按真实样式画】用户选的是"河流"，屏幕上却是一条通用的蓝线，收尾之后
 * 突然变成蓝绿色 —— 预览与结果不一致会让人反复重画。样式档在绘制态就能改，
 * 预览必须跟着改。
 */
export function drawPolylinePreview(
  g: Graphics,
  points: readonly Point[],
  styleId: string,
  scale: number,
  cursor: Point | null,
): void {
  const px = 1 / Math.max(1e-6, scale);

  // ① 已确定的部分：用真样式画（半透明，表示"还没落库"）
  if (points.length >= 2) {
    // kind 只是回退依据：styleId 命中时以样式为准
    const style = polylineStyleOf(styleId, "road");
    drawPolyline(
      g,
      {
        id: "__polyline_draft__",
        kind: style.kind,
        styleId: style.id,
        points: [...points],
        closed: false,
        level: null,
      },
      { scale, alpha: 0.8 },
    );
  }

  // ② 顶点：白心 + 强调边（与选中手柄同一套观感，用户不会以为是两种东西）
  for (const p of points) {
    g.circle(p.x, p.y, POLYLINE_NODE_PX * px);
    g.fill({ color: 0xffffff, alpha: 0.95 });
    g.circle(p.x, p.y, POLYLINE_NODE_PX * px);
    g.stroke({ width: px, color: DRAFT_COLOR, alpha: 0.9 });
  }

  // ③ 末点 → 光标：虚线（表示"下一段会这样连"）
  if (cursor && points.length > 0) {
    const last = points[points.length - 1];
    const pieces = dashPath(
      [last, cursor],
      POLYLINE_PREVIEW_DASH_PX[0] * px,
      POLYLINE_PREVIEW_DASH_PX[1] * px,
    );
    for (const piece of pieces) {
      g.moveTo(piece[0].x, piece[0].y);
      for (let i = 1; i < piece.length; i += 1) g.lineTo(piece[i].x, piece[i].y);
      g.stroke({ width: 1.2 * px, color: DRAFT_COLOR, alpha: 0.6, alignment: 0.5 });
    }
  }
}
