import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";
import type { ColorMatrixFilter, RenderTexture } from "pixi.js";
import { BASE_IMAGE, SPRITE_MAP } from "../../sprites";
import {
  REGION_BORDER_COLOR,
  REGION_BORDER_PX,
  regionBorderAlphaOf,
  regionFillAlphaOf,
  type Point,
} from "../../regions";
import { elementSizeFactor, elementWeight, resolveElementLevel } from "../../lod";
import { buildParentIdSet } from "../../regionEdit";
import { WORLD_LAYER_ORDER, type WorldLayerName } from "./layers";
import type { MapDocument } from "../../types";
import type { MapLabel, MapLand, MapPolyline, MapStyle } from "../../types";
import { elementFlipXOf, elementOpacityOf, elementTintHueOf, tintColorOf } from "../../types";
import { BAKE_MARGIN, bakeCoast, bakeKeyOf } from "../../coastBake";
import { filterFor } from "../../style";
import { layerVisibleOf } from "../../layerState";
import { effectiveWidthWorld, POLYLINE_PICK_PAD_PX, polylineStyleOf } from "../../polylineStyle";
import { controlIndexFor, dashPath, nearestOnPath, smoothPolyline } from "../../polylineGeometry";
import { drawPolyline } from "./polylineRender";
import { getPaperGrainTexture } from "../../paperGrain";
import {
  applyLabelWeights,
  labelAt,
  setLabelScale,
  syncLabels,
  type LabelHandle,
} from "./labelSync";
import { cullLayers, createCullCache, screenCullRect } from "./cull";
import { buildSubmapNode, type SubmapNode, type SubmapRenderEnv } from "./submapRender";
import {
  hitTestElement,
  screenToWorld,
  worldToScreen,
  type CanvasSize,
  type Viewport,
} from "../../coords";
import type { TextureMap } from "../../hooks/useTextureCache";
import "./index.scss";

/**
 * 场景句柄 —— 渲染层交出去的**最小**能力集（只给导出用）。
 *
 * 刻意不把 `app` 整个交出去：一旦页面拿到 `Application`，就会出现"在组件外
 * `addChild`"这类拿不到 z 序纪律的代码。这里只给导出真正需要的四项 + 两个
 * 选中框钩子。
 */
export interface MapSceneHandle {
  /** 取图能力（`renderer.extract`） */
  renderer: Application["renderer"];
  /** ⚠️ 必须是 `app.stage`：`world` 之上还有投影等外层内容 */
  stage: Container;
  /** 承载视口变换的容器（导出期间会被临时改写，之后必须复原） */
  world: Container;
  /** 纸张在世界坐标里的矩形 */
  rect: { x: number; y: number; width: number; height: number };
  /** 导出前清空选中框（它是交互指示，不是地图内容） */
  clearOverlay: () => void;
  /** 导出后把选中框重绘回来（`clear()` 之后不重绘，框会消失到下次点选） */
  redrawOverlay: () => void;
}

interface MapCanvasProps {
  doc: MapDocument;
  viewport: Viewport;
  textures: TextureMap;
  texturesReady: boolean;
  selectedId: string | null;
  /** 待放置素材：非空时点击画布为"落位"而非"选择" */
  pendingSpriteId: string | null;
  /**
   * 素材层是否锁定（B4-1）。
   *
   * 【为什么要传到画布】"按下已选中素材 = 开始拖拽"这个判定在画布的
   * `pointerdown` 里，页面看不见。锁定层若还允许从这里起拖，就等于"锁了还能动"——
   * 用户会认为锁定坏了，而实际上只是少传了一个开关。
   *
   * 缺省 `false`（= 老用法不锁）。
   */
  elementLocked?: boolean;
  /**
   * 地名层是否锁定（B4-1）：锁定时双击标注不再进入编辑。
   *
   * 缺省 `false`。
   */
  labelLocked?: boolean;
  /**
   * 各层级当前的可见权重（见 `lod.ts`），长度即层级数。
   *
   * 【契约】由上层算好传入，本组件只消费。原因有二：
   *   · 自然缩放只跟"每级块数与地图范围"有关，与画布无关，属于编辑器状态而非视图状态；
   *   · 工具栏的"当前层级"指示要用同一组权重，两边各算一次必然出现显示不一致。
   *
   * 缺省为空数组（= 不画任何区块）：本组件会被单独挂载测试，
   * 不该因为少传一个可选项就直接抛异常。
   */
  levelAlphas?: number[];
  /**
   * 陆地几何；`null` / 缺省 = 不画海岸四层（老用法照常渲染）。
   *
   * 【为什么走 prop 而不是直接读 doc.land】画布是纯消费组件：所有输入都从
   * props 进，才能在单测里用最小文档驱动它，不必构造一整份 MapDocument。
   */
  land?: MapLand | null;
  /**
   * 全局风格预设（缺省 "none"）。
   *
   * 它参与 `bakeKey`：切风格要重建海岸纹理，而其余图层只换 `filters`（B4 再做）。
   */
  style?: MapStyle;
  /**
   * 分区显隐（缺省 true，= 老用法）。
   *
   * 只改 `regionLayer.alpha`，不改几何、不做条件渲染 —— 关掉是"给读者看的成品图"，
   * 用户会频繁切换，必须零成本。
   */
  showRegions?: boolean;
  /**
   * 当前选中的区块 id；`null` / 缺省 = 无高亮。
   *
   * 【为什么必须有视觉高亮】区块是"面"，点中它时**画面本身没有任何变化** ——
   * 用户只能靠右侧浮出的操作面板去猜"我到底选中了哪一块"。高亮是选区反馈的
   * 唯一载体，不能省。
   */
  selectedRegionId?: string | null;
  /**
   * 手画草稿的已落顶点（世界坐标，首尾不重复）。
   *
   * 【为什么 `null` 表示"不在画区模式"】画区模式本身没有第二个需要渲染的状态：
   * "在模式里但一个点都没落"与"不在模式里"在画布上**完全一样**（都是什么都不画），
   * 但指针行为不同。用 `null` 把两者区分开，就不必再加一个 `drafting` 布尔
   * （两个 prop 迟早会不同步，例如退出模式时忘了把数组清空）。
   */
  draftPoints?: readonly Point[] | null;
  /**
   * 请求闭合草稿（**画布判定、页面执行**）。
   *
   * 画布在两处调它，都是"这一下不落点"的判定已经成立之后：
   *   ① 双击 —— 与上一次 down 的时间差 < 350ms 且屏幕距离在 `DRAFT_CLOSE_PX` 内；
   *   ② 命中首顶点 —— 已落 ≥3 点，且这一下落在首顶点的命中圈里。
   *
   * 【为什么判定放在画布、落库放在页面】判定需要的是像素几何（屏幕距离 ×
   * 1/scale）与 `draftPoints`，那两样画布都有；而"校验 + 写文档 + 弹提示"是页面的
   * 职责。画布只回答"这一下算不算闭合"，不碰 `doc`。
   *
   * 【为什么不挂在 dblclick 上】`dblclick` 在两次 down/up **之后**才派发 ——
   * 那时顶点已经落下了，只能事后补救（多一个顶点 / 残留一个孤立点）。
   */
  onDraftClose?: () => void;
  /**
   * 地名标注；缺省 `[]` = 一个文字对象都不建（老用法照常渲染）。
   *
   * 【为什么是 `readonly`】渲染层只读它，绝不写回 —— 避让偏移只活在渲染句柄上
   * （见 `labelSync.ts` 的 `applyAvoidance`）。
   */
  labels?: readonly MapLabel[];
  /**
   * 折线（B4-2）；缺省 `[]` = 不画任何线（老用法照常渲染）。
   *
   * 与 `labels` 同一条纪律：画布只读，绝不写回 —— 增删改一律由页面调 store。
   */
  polylines?: readonly MapPolyline[];
  /**
   * 折线层是否锁定（B4-1 的图层锁在 B4-2 的消费点）。
   *
   * 语义与素材层完全一致：**命中跳过、拖不动**，渲染不变。缺省 `false`。
   */
  polylinesLocked?: boolean;
  /** 当前选中的折线 id（画节点手柄与高亮）；`null` = 未选中 */
  selectedPolylineId?: string | null;
  /**
   * 折线绘制态的已落控制点；`null` = 不在折线模式。
   *
   * 与 `draftPoints` 同构：用 `null` 而不是空数组区分"在模式里但还没落点"
   * 与"不在模式里" —— 两者画面一样、指针语义不同。
   */
  polylineDraft?: readonly Point[] | null;
  /**
   * 绘制态用的样式档 id（预览按真实样式画：选「河流」时就该看到蓝绿线，
   * 而不是一条通用的蓝草稿）。缺省走 `road-main`。
   */
  polylineDraftStyleId?: string;
  /** 绘制态下"这一下算收尾"时回调（双击 / 点回起点），由页面负责落库 */
  onPolylineDraftFinish?: () => void;
  /** 开始拖动折线节点：页面据此把当前文档压一次撤销快照（全程只记一次） */
  onPolylineNodeDragStart?: () => void;
  /** 拖动节点中的世界坐标（高频，不入撤销栈） */
  onPolylineNodeMove?: (index: number, world: Point) => void;
  /** 双击线段：请求在第 `index` 个控制点之前插入一个点 */
  onPolylinePointInsert?: (index: number, world: Point) => void;
  /** 双击节点：请求删除第 `index` 个控制点 */
  onPolylinePointDelete?: (index: number) => void;
  /**
   * 双击标注请求编辑，回调收到**画布本地屏幕坐标**。
   *
   * 【为什么给屏幕坐标而不是世界坐标】编辑用的是一个绝对定位的 DOM `<input>`，
   * 它活在 CSS 像素空间里；换算在这里做（画布持有真实像素几何），页面直接拿去
   * 定位即可。反过来让页面自己换算，就会出现"页面按 canvasSize 算、画布按
   * clientRect 算"的两套几何 —— 两处差一点，输入框就会偏出光标。
   */
  onLabelEditRequest?: (id: string, screen: { x: number; y: number }) => void;
  /**
   * 场景就绪回调（导出用）。
   *
   * 【为什么要把 stage/world 交出去】导出要做三件只有渲染层才做得到的事：
   * 取图（`renderer.extract`）、临时改写 `world` 的变换、清空选中框。
   * 让页面自己去 `new Application()` 拿这些东西是不可能的 —— 画布是纯消费组件，
   * 唯一的出口就是这个回调。卸载时回调 `null`，页面据此禁用导出按钮。
   */
  onSceneReady?: (scene: MapSceneHandle | null) => void;
  /**
   * 视口粗剔除开关（缺省 `true`）。
   *
   * 单独给一个开关是为了**测试**：剔除会把容器的 `visible` 改成 false，
   * 与"层级权重 / 子节点数"这类断言混在一起时，谁把谁弄红了很难分辨。
   * 渲染断言里显式关掉它，剔除自己另有专门的用例。
   */
  enableCulling?: boolean;
  onSizeChange: (size: CanvasSize) => void;
  onWheel: (deltaY: number, anchor: { x: number; y: number }) => void;
  onPan: (dx: number, dy: number) => void;
  /**
   * 画布点击（空白处单击 / 待放置态落位）。
   *
   * 【契约】回调收到的是 **世界坐标**，screen→world 的换算由本组件完成。
   * 上层**不得**再按 viewport 换算一次 —— 本组件持有画布真实的像素几何
   * （容器尺寸、指针本地坐标），是坐标换算的唯一权威。
   * 双重换算会让落点偏离光标极远（缩放越小偏得越狠）。
   */
  onCanvasClickWorld: (world: { x: number; y: number }) => void;
  onElementDragStart: () => void;
  /**
   * 拖拽已选中元素 —— 传入**世界坐标增量**而非绝对坐标。
   * 增量式可保持「按下时抓取点」与元素的相对位置不变，
   * 元素不会在第一次移动时"跳"到光标下方（锚点在元素底部，跳变尤其明显）。
   */
  onElementDragDelta: (dxWorld: number, dyWorld: number) => void;
}

/**
 * 底图在世界坐标中的矩形（世界原点在底图中心）。
 * 与 useMapEditor 的 BASE_BOUNDS、区块生成的 bounds 必须一致。
 */
const BASE_RECT = {
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
const SHEET_SHADOW = {
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
const SEA_VIGNETTE = {
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
const REGION_PICK_COLOR = 0x5b8def;
const REGION_PICK_PX = 2.2;
const REGION_PICK_GLOW_PX = 8;

/**
 * **非叶子**选中时的容器描边宽度（屏幕像素，PRD §4.4 的 1.6px）。
 *
 * 【为什么非叶子只有一笔】面高亮（填充 + 外发光）只对**叶子**（最小可操作单位）
 * 生效。大区域铺满整屏会"糊成一片"，把内部所有子区块的边界线压掉 —— 用户看不出
 * 自己在操作哪一块。容器态只沿 `P.polygon` 描一笔强调边：信息量足够（"范围在这里"），
 * 且不遮内部子边界（PRD §6-A 的第 2 条论据）。
 */
const REGION_CONTAINER_PX = 1.6;

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
const DRAFT_DOUBLE_CLICK_MS = 350;
/** 草稿连线宽度（屏幕像素） */
const DRAFT_LINE_PX = 1.5;
/** 已落顶点的半径（屏幕像素） */
const DRAFT_POINT_PX = 3.5;
/** 首顶点在"可以闭合"时的半径（屏幕像素）—— 变大即"这里能点" */
const DRAFT_SNAP_PX = 6;
/** 草稿色（与区块选中同色系，但草稿全程更亮/更细） */
const DRAFT_COLOR = 0x5b8def;
/** 预览虚线的实/虚长度（屏幕像素） */
const DRAFT_DASH_ON_PX = 6;
const DRAFT_DASH_OFF_PX = 4;
/** 虚线段数上限（防御：极端缩放下长度/步长会很大，不能让 for 循环无限跑） */
const DRAFT_DASH_MAX = 400;


/**
 * 边界线宽的"量化档"倍率。
 *
 * 【为什么需要】区块边界是**屏幕恒定线宽**（`REGION_BORDER_PX` 个像素），换算成
 * 世界单位就是 `px / 缩放` —— 缩放一变，线宽就变，而 Pixi 的 Graphics 一旦描边
 * 就固化了线宽，只能整层重建。滚轮每滚一格都重建 200 多个多边形（约 1.5 万顶点）
 * 会明显掉帧。
 *
 * 这里把缩放量化到 1.06 的幂次档位上，只有跨档才重建：线宽最多差 3%（肉眼不可辨），
 * 重建频率却降到原来的十几分之一。**注意只量化线宽** —— 交叉淡化的权重走的是
 * 容器 `alpha`（零成本），不参与量化，否则过渡会出现台阶。
 *
 * 【与缩放上限无关，已手算】线宽 = `REGION_BORDER_PX / quantize(scale)`，屏幕上
 * 恒为 `1.2 × (scale / quantize(scale))`。量化误差的相对上界是 `√1.06 = 1.0296`
 * （最坏落在档位的中点），因此**无论缩放上限抬到 21 还是 40**，屏显线宽都落在
 * 1.166~1.235 px —— 抬上限不会让边界线变粗/变细，这条常量不需要跟着调。
 */
const BORDER_WIDTH_QUANTIZE = 1.06;

/**
 * 静态层缓存的倍率上限。
 *
 * 【为什么跟着缩放走】`cacheAsTexture` 会把整组内容烤成一张**固定分辨率**的纹理，
 * 之后由世界变换放大。若只用 1 倍，放到郡级（≈350%）时底图与海岸就是一张被拉大
 * 3.5 倍的图 —— 变软是必然的。所以缓存倍率取 `ceil(缩放)` 并封顶 3：
 * 1024² 的纸最大烤成 3072²（约 36MB），既能覆盖最深的缩放档，也不会无上限地涨。
 */
const STATIC_CACHE_MAX_RES = 3;

/** 把缩放吸附到最近的量化档（用于线宽，见上） */
function quantizeScale(scale: number): number {
  const s = Math.max(1e-6, scale);
  return BORDER_WIDTH_QUANTIZE ** Math.round(Math.log(s) / Math.log(BORDER_WIDTH_QUANTIZE));
}

/**
 * 多边形顶点数组 → Pixi Graphics.poly() 需要的扁平坐标数组 [x0,y0,x1,y1,...]
 *
 * 每帧重建数组（而非缓存）是划算的：区块只在生成/清除时变化，
 * 平时这个 effect 根本不会跑。
 */
function toFlatPoints(polygon: Array<{ x: number; y: number }>): number[] {
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
function appendDashedLine(g: Graphics, a: Point, b: Point, px: number): void {
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

/** 一个层级的渲染容器：填充与边界分两份 Graphics，边界按需重建、填充只建一次 */
interface LevelLayers {
  container: Container;
  fill: Graphics;
  border: Graphics;
}

/**
 * 素材层级容器的哨兵键：**层级无关**。
 *
 * 生成区块之前放置的素材没有层级可言（那时还没有任何分区），放在这个容器里、
 * alpha 恒为 1，任何缩放下都可见。它排在所有层级容器之后，因此永远画在最上层。
 */
const LOOSE_LEVEL_KEY = -1;

/** 一个已放置素材的渲染句柄：精灵本体 + 它当前挂在哪个层级容器下 */
interface ElementSprite {
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
function elementKeyOf(level: number | null | undefined, levelCount: number): number {
  const resolved = resolveElementLevel(level, levelCount);
  return resolved === null ? LOOSE_LEVEL_KEY : resolved;
}

/** 缺省权重（不画任何区块）。用模块级常量避免每次渲染都造一个新数组引用。 */
const NO_LEVELS: number[] = [];

/** 缺省标注（同上：稳定引用，否则标注同步 effect 每次渲染都会重跑一遍） */
const NO_LABELS: readonly MapLabel[] = [];

/** 缺省折线（同上：稳定引用，否则折线重绘 effect 每帧都会重跑） */
const NO_POLYLINES: readonly MapPolyline[] = [];

/**
 * 折线节点手柄的命中半径（**屏幕像素**）。
 *
 * 【为什么按屏幕而不是世界单位】世界单位会随缩放变大变小：缩小到整图时
 * 8 世界单位只有 2 像素（根本点不中），放大到郡级时又变成 28 像素（旁边的线都
 * 被吸过来）。屏幕恒定才是"手柄看起来多大就能点多大"。
 */
const POLYLINE_NODE_HIT_PX = 8;

/** 折线节点手柄的绘制半径（屏幕像素，比命中圈略小：看得见的不该比点得中的大） */
const POLYLINE_NODE_PX = 4;

/** 选中折线时的高亮描边宽度（屏幕像素） */
const POLYLINE_PICK_PX = 1.4;

/**
 * 绘制态预览的虚线节奏（屏幕像素，`[实, 虚]`）。
 *
 * 【为什么这里按屏幕像素、而线本身按世界单位】预览只是"从末点到光标"的一段
 * 临时指示，它不是内容：缩得再远也应该是一眼可辨的虚线。真正的线用世界单位
 * （见 `polylineStyle.ts`），因为它是地图内容、要随图缩放。
 */
const POLYLINE_PREVIEW_DASH_PX: readonly [number, number] = [7, 5];

/**
 * 折线绘制态的预览：已落的一段按**真实样式**画 + 顶点圆点 + 末点到光标的虚线。
 *
 * 【为什么按真实样式画】用户选的是"河流"，屏幕上却是一条通用的蓝线，收尾之后
 * 突然变成蓝绿色 —— 预览与结果不一致会让人反复重画。样式档在绘制态就能改，
 * 预览必须跟着改。
 */
function drawPolylinePreview(
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

/**
 * 地图画布（PixiJS / WebGL 渲染）。
 *
 * 【架构】单一 viewport 事实源 → 驱动一个 Pixi 场景图根容器：
 *   stage
 *   └─ world            ← 承载 viewport 变换（position + scale）
 *      ├─ staticLayer    z0 静态层（**整体 cacheAsTexture**，内容永不变化）
 *      │   ├─ sheet        ← 图纸投影（底图之下，撑起四周留白）
 *      │   └─ sea          ← 海面（底图纹理；陆地生成前它就是"整张底图"）
 *      ├─ coast          z2 海岸烘焙层（容器，内部挂一张 RenderTexture 精灵）
 *      │   └─ coastSprite   ← bakeCoast 的产出，随「陆地/风格/分辨率」重建
 *      ├─ regionLayer    z3 区块层（容器，内部按层级分若干子容器）
 *      │   ├─ L0 容器     ├─ 填充 Graphics
 *      │   │              └─ 边界 Graphics  ← 屏幕恒定线宽
 *      │   └─ L1 / L2 / L3 …（同上）
 *      ├─ polylineLayer  z4 折线层（容器，按层级分容器，与 elementLayer 同构）
 *      │   ├─ L0 容器    ← 在"大陆"那一级画的河，alpha = α_0
 *      │   ├─ L1 / L2 / L3 …（同上）
 *      │   └─ LOOSE 容器 ← 层级无关的折线，alpha 恒为 1
 *      ├─ elementLayer   z5 素材层（容器，同样按层级分若干子容器）
 *      │   ├─ L0 容器    ← 在"大陆"那一级放置的素材，alpha = α_0
 *      │   ├─ L1 / L2 / L3 …（同上）
 *      │   └─ LOOSE 容器 ← 层级无关的素材（生成区块之前放的），alpha 恒为 1
 *      ├─ labelLayer     z6 标注层（容器，按层级分容器，与 elementLayer 同构）
 *      │   ├─ L0 容器    ← 在"大陆"那一级起的地名，alpha = α_0
 *      │   ├─ L1 / L2 / L3 …（同上）
 *      │   └─ LOOSE 容器 ← 层级无关的地名（生成区块之前起的），alpha 恒为 1
 *      └─ overlay        z7 选中框等交互指示（Graphics，不挂滤镜）
 *
 *  z 序的**唯一定义处**是 `./layers.ts` 的 `WORLD_LAYER_ORDER`（初始化时按它建层，
 *  测试按它取索引）。`draftLayer`（手画草稿）排在最后，即压在所有交互指示之上。
 *  上面这张图只是给读者的地图，改顺序请只改那个数组。
 *
 * 【新增节点的挂载纪律】一律在**初始化 effect 里一次性**按数组顺序 addChild；
 * 后续 effect 禁止再 addChild —— 否则 z 序会变成 effect 执行顺序的函数，
 * 表现为"素材钻进区块底下"且**不报错**，极难排查。
 * `render-stack-guard.test.ts` 守着这个顺序。
 *
 * 【海岸为什么在区块之下】区块是"地表的划分"，要能透出陆地材质；反过来盖住
 * 就成了色块图。素材在区块之上：山是"长在地表上的东西"，不能被分区线切断。
 *
 * 区块层为什么按"层级的容器"而不是"一个 Graphics"：
 * 无极缩放要求相邻两级**同时可见**、此消彼长（见 lod.ts）。把权重落在容器 alpha
 * 上，滚轮每一格就只是改几个浮点数；若把 alpha 烘进 Graphics 的填充/描边样式，
 * 每滚一格都要重建两百多个多边形的几何，帧率立刻塌。层级容器本身还能顺手把
 * 线宽重建的频率从"每格"降到"每跨一档"。
 *
 * 素材层用同一套结构、同一份权重，于是素材与区块**同呼吸**：所属层级淡出它就淡出，
 * 切到别的层级它就消失。素材按"放置时所处的层级"归属（见 types.ts 的
 * `MapElement.level`）—— 在郡那一级摆的山属于郡的世界，缩到洲去看时不该还在。
 * 同样是为了"每格只改几个浮点数"，而不是遍历两千个精灵逐个设 alpha。
 *
 * 层级顺序即数组顺序：区块压在底图之上、素材之下，
 * 这样素材看起来是"落在"某个区块里，而不是被区块盖住。
 *
 * 关键点：**只有 world 容器的变换被更新**，素材精灵的世界坐标保持不变。
 * 这样 2000+ 元素时每帧只改 2 个数值（position/scale），而非遍历全部元素 —— 
 * 这正是 WebGL 相对 Canvas 2D 的核心优势（架构报告 §2.2）。
 *
 * 与 Canvas 2D 版的对外契约完全一致（props/事件不变），
 * 因此上层 useMapEditor 与页面组件无需改动。
 */
export default function MapCanvas({
  doc,
  viewport,
  textures,
  texturesReady,
  selectedId,
  pendingSpriteId,
  elementLocked = false,
  labelLocked = false,
  levelAlphas = NO_LEVELS,
  land = null,
  style = "none",
  showRegions = true,
  selectedRegionId = null,
  draftPoints = null,
  onDraftClose,
  labels = NO_LABELS,
  polylines = NO_POLYLINES,
  polylinesLocked = false,
  selectedPolylineId = null,
  polylineDraft = null,
  polylineDraftStyleId,
  onPolylineDraftFinish,
  onPolylineNodeDragStart,
  onPolylineNodeMove,
  onPolylinePointInsert,
  onPolylinePointDelete,
  onLabelEditRequest,
  onSceneReady,
  enableCulling = true,
  onSizeChange,
  onWheel,
  onPan,
  onCanvasClickWorld,
  onElementDragStart,
  onElementDragDelta,
}: MapCanvasProps) {
  /**
   * 是否处于画区模式。
   *
   * 【为什么从 `draftPoints` 派生而不是另设一个 prop】两者不同步的唯一表现是
   * "在模式里但草稿是空的" —— 那个状态在画布上与"不在模式里"完全一样，
   * 但指针行为不同。派生值不可能不同步，多加一个 prop 就可能。
   */
  const drafting = draftPoints !== null;

  const hostRef = useRef<HTMLDivElement>(null);
  const [app, setApp] = useState<Application | null>(null);
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 });

  /** 场景图层（ref 持有，避免 effect 依赖抖动） */
  const worldRef = useRef<Container | null>(null);
  /**
   * 静态层：图纸投影 + 海面（`sheet` / `sea`）。
   *
   * 这两样在编辑过程中**永远不变**，缓存成一张纹理后整组只剩一次 draw call。
   * 不把 `coast` 一起放进来：PRD §6.4 要求"海面不挂滤镜、海岸挂滤镜"，
   * 而缓存会把这一组烤成一张图 —— 两者共用一个缓存就必然一起被染色。
   * 详见 `staticLayer` 初始化处与 `styleFilter` effect 的注释。
   */
  const staticLayerRef = useRef<Container | null>(null);
  /** 静态层缓存是否已建（首帧不调 `updateCacheTexture`，只能 `cacheAsTexture`） */
  const staticCachedRef = useRef(false);
  /** 上次烘焙缓存用的倍率；跨档才重烤（见常量 `STATIC_CACHE_MAX_RES`） */
  const staticResRef = useRef(0);
  /** 上次烤进缓存时的纸纹；纹理晚到时靠它触发 `updateCacheTexture()` */
  const staticPaperRef = useRef<unknown>(undefined);
  const sheetRef = useRef<Graphics | null>(null);
  /** 海面（底图纹理）。未生成陆地时它就是"整张底图"，老观感不变 */
  const seaRef = useRef<Sprite | null>(null);
  /** 海面暗角（纸缘向内压暗，见 SEA_VIGNETTE） */
  const seaShadeRef = useRef<Graphics | null>(null);
  /**
   * 海岸烘焙层：容器 + 一张承接 RenderTexture 的精灵。
   * 容器而不是裸精灵 —— 风格滤镜要挂在"整组静态层"上（B4），且未来
   * `cacheAsTexture` 需要一个稳定的容器句柄。一层 Container 成本可忽略。
   */
  const coastRef = useRef<Container | null>(null);
  const coastSpriteRef = useRef<Sprite | null>(null);
  const regionLayerRef = useRef<Container | null>(null);
  /** 每个层级一份「容器 + 填充 + 边界」，索引即层级序号 */
  const levelLayersRef = useRef<LevelLayers[]>([]);
  /**
   * 折线层（B4-2）：容器 + 按层级分的子容器，与素材层同构。
   *
   * 【为什么也按层级分容器】折线的 `level` 语义与素材、地名完全一样
   * （在郡那一级画的河属于郡）。把权重落在容器 alpha 上，滚轮每一格只改几个
   * 浮点数；逐条线设 alpha 的话每格要遍历全部折线。
   */
  const polylineLayerRef = useRef<Container | null>(null);
  /** 折线的层级容器（键同 `elementKeyOf`：`LOOSE_LEVEL_KEY` = 层级无关） */
  const polylineLayersRef = useRef<Map<number, Container>>(new Map());
  /** id → Graphics，增量重绘用（只 clear 内容，不重建显示对象） */
  const polylineGraphicsRef = useRef<Map<string, Graphics>>(new Map());
  const elementLayerRef = useRef<Container | null>(null);
  /** 素材按层级分容器（键见 `LOOSE_LEVEL_KEY`），容器 alpha 跟该层级权重走 */
  const elementLayersRef = useRef<Map<number, Container>>(new Map());
  /**
   * 嵌套子地图层：承载「区块内嵌子图」的递归子树（Phase 2）。
   *
   * z 序插在素材层与标注层之间（子图内容读作「地表之上、地名之下」）。
   * 每棵子树 = 一个带 submap 的区块对应一个节点（见 `submapRender.ts`）。
   */
  const submapLayerRef = useRef<Container | null>(null);
  /** 区块 id → 已挂载的子图句柄，增量同步用（避免每次 regions 变化重建全部） */
  const submapNodeByIdRef = useRef<Map<string, SubmapNode>>(new Map());
  /**
   * 子图渲染环境（渲染器 + 纹理表 + 烘焙分辨率）。
   *
   * 【为什么是 ref 而不是直接传快照】子图节点只构建一次，而 `app` 与纹理是随后
   * 才就绪的。传 ref 后，节点在真正烘焙（或 `refreshCoast`）时读到的是**当时**
   * 的环境，晚到的纹理自然被用上；传快照则会让"纹理晚于子图创建"这一常见时序
   * 永久留下空白海面与缺失海岸。
   */
  const submapEnvRef = useRef<SubmapRenderEnv>({
    renderer: null,
    textures: {},
    baseResolution: 1,
  });
  /** 标注层（按层级分容器，与素材层同构） */
  const labelLayerRef = useRef<Container | null>(null);
  /**
   * 标注的渲染句柄（id → Text）。由 `syncLabels` 原地维护，这里只是持有引用：
   * 视口 effect 要拿它遍历（`setLabelScale`），而它**不能**成为视口 effect 的依赖，
   * 否则会退化成"每格重建"。
   */
  const labelHandlesRef = useRef<Map<string, LabelHandle>>(new Map());
  /**
   * 当前视口缩放 —— 给"新建标注"兜底用。
   *
   * 【为什么要有这个 ref】`syncLabels` 新建出来的 `Text` 默认 scale 是 1，
   * 而屏幕恒定字号要求它是 `1/viewport.scale`。若让同步 effect 依赖 `viewport.scale`，
   * 滚轮每格都要跑一遍全量同步（"视口变化不触碰标注"直接被破坏）。
   * 因此同步 effect 从 ref 里读**当前**缩放，而 ref 由下面的视口 effect 维护。
   */
  const labelScaleRef = useRef(viewport.scale);
  /**
   * 当前视口缩放的**只读影子**（供子图结构 effect 取初值）。
   *
   * 【为什么要多一个 ref】子图结构 effect 只该随 `doc.regions` 重建，不能把
   * `viewport.scale` 放进依赖（那会让滚轮每格都整棵重建子树）。但建节点时又需要
   * 一个"当前缩放"来算首帧的渐入权重与内部层级权重 —— 从 ref 读即避开依赖，
   * 而首帧权重哪怕略旧也会被紧随其后的权重 effect 在同一提交里改正。
   */
  const viewportScaleRef = useRef(viewport.scale);
  /**
   * 当前风格滤镜。
   *
   * 【为什么每次换新实例】`ColorMatrixFilter` 的 `saturate()` / `brightness()`
   * 是**就地累乘**：在同一个实例上反复切换，"原色 → 墨色 → 原色"回不到原色
   * （矩阵变换不可逆）。所以 `filterFor` 每次都 new，旧的在赋新之后销毁。
   */
  const styleFilterRef = useRef<ColorMatrixFilter | null>(null);
  const overlayRef = useRef<Graphics | null>(null);
  /**
   * 手画草稿层（world 的最后一层，压在 overlay 之上）。
   *
   * 【为什么是独立 Graphics 而不是复用 overlay】三个理由，缺一都会出问题：
   *   · `clearOverlay()`（导出用）会清掉 overlay 的全部内容 —— 复用它等于导出时
   *     顺手把用户画到一半的线抹掉；
   *   · 每次指针移动只该重画草稿。复用时会把选中框与整片高亮一起重画一遍，
   *     而那是 O(顶点数) 的重建（与"只重画草稿层"直接冲突）；
   *   · z 序：草稿必须压在高亮之上（见 `layers.ts`）。
   */
  const draftLayerRef = useRef<Graphics | null>(null);
  /**
   * 光标预览点（世界坐标）。
   *
   * ❗**只进 ref，绝不再进 React state**：它跟着 `pointermove` 每像素变一次，
   * 进 state 就是每像素一次 React 提交 + 一次 200 多块区块容器的 diff。
   * 已落顶点（低频、且是文档的候选内容）才进 state。
   */
  const draftCursorRef = useRef<Point | null>(null);
  /**
   * 上一次 `pointerdown` 的时刻与世界坐标（**画区态专用**，用于双击判定）。
   *
   * 【为什么不进 state】它只在指针事件里读、只有"和这次比一下"这一个用途 ——
   * 进 state 等于每次按下都触发一次 React 提交，而它一帧都不会被渲染出来。
   *
   * 【为什么记世界坐标而不是屏幕坐标】双击的第二个条件要与 `draftPoints`
   * （世界坐标）比距离，统一在世界域里比可以省一次换算，也避免"缩放变了之后
   * 旧屏幕坐标失效"这类只在缩放中双击才复现的错。
   */
  const lastDownRef = useRef<{ at: number; world: Point } | null>(null);
  /** 实例 id → 渲染句柄，增量同步用（避免每帧重建全部精灵） */
  const spriteByIdRef = useRef<Map<string, ElementSprite>>(new Map());

  /**
   * 当前已烘焙的内容指纹；`undefined` = 还没跑过第一次。
   *
   * 【初值为什么是 undefined 而不是 null】`null` 是"无陆地"这个**合法**指纹。
   * 若初值也是 null，首次挂载且没有陆地时会被"指纹未变"短路掉，
   * 于是 coast 容器停在默认 visible = true 上 —— 空精灵虽然画不出东西，
   * 但这个短路会让人误以为"清空逻辑跑过了"。undefined 保证首次一定执行。
   */
  const bakeKeyRef = useRef<string | null | undefined>(undefined);
  /** 当前烘焙用的纸纹；纹理晚于陆地加载时要补烘一次 */
  const bakePaperRef = useRef<unknown>(undefined);
  /** 当前挂在 coastSprite 上的 RenderTexture（替换成功后才销毁旧的） */
  const bakeRtRef = useRef<RenderTexture | null>(null);

  /**
   * 剔除用的包围盒缓存（见 `cull.ts` 的 `CullCache`）。
   *
   * 内容变化时整表清空；视口变化时复用 —— 滚轮每一格都重算 600 个多边形的
   * 并集，剔除省下的绘制还不够付自己的账。
   */
  const cullCacheRef = useRef(createCullCache());
  /**
   * 上一次剔除时的内容指纹（只用来判断"要不要清包围盒缓存"）。
   *
   * 用**引用**比较而不是版本号：`doc.regions` / `doc.elements` / `labels` 在
   * 数据层都是不可变更新（改一次换一个数组），引用相等就等于"内容没动"，
   * 不需要任何一方记得自增版本号 —— 忘自增的那种缺陷只在特定顺序下复现。
   */
  const cullContentRef = useRef<{
    regions: readonly unknown[];
    elements: readonly unknown[];
    labels: readonly unknown[];
    polylines: readonly unknown[];
    levelCount: number;
  } | null>(null);

  /**
   * 烘焙分辨率：跟随设备像素比，但封顶 2。
   *
   * 用 `useMemo` 而不是每次渲染重算：`devicePixelRatio` 读的是 window，
   * 放进 `bakeKey` 的依赖项时必须引用稳定，否则每次渲染都是"新分辨率"。
   */
  const bakeResolution = useMemo(() => Math.min(window.devicePixelRatio || 1, 2), []);

  /**
   * 烘焙指纹 —— 烘焙的唯一触发源。
   *
   * 只由「陆地几何 + 风格 + 分辨率」决定，**不含 viewport**：
   * 滚轮缩放绝不能触发重烘（那会让每滚一格都做三次高斯模糊）。
   */
  const bakeKey = useMemo(
    () => bakeKeyOf(land ?? null, style, bakeResolution),
    [land, style, bakeResolution],
  );

  /**
   * 当前底图纹理（纸纹）：按文档底图 id 取（B3 底图选择器），
   * 未加载 / 老存档指向已不存在的 id 时回落默认海面，不白屏。
   */
  const paperTexture = textures[doc.baseImageId] ?? textures[BASE_IMAGE.id];

  /**
   * 陆地纸纹（中性灰颗粒）。
   *
   * 【为什么不再用底图当纸纹】底图是**海**（青绿水纹漩涡）。把它 multiply 到
   * 陆地上，陆地会带上一层青灰旋纹、整体发暗 —— 参考实现的陆地是米黄纸 +
   * 细颗粒。纸纹与海面是两回事，各用各的（见 `paperGrain.ts`）。
   *
   * 【只取用，不拥有；**绝对不要在卸载时 destroy 它**】
   * 它是模块级单例。`Texture.destroy(true)` 会把 `_source` 置成 null，而
   * StrictMode 的「挂载 → cleanup → 再挂载」里 `useMemo` **不会重算** ——
   * 第二轮拿到的就是同一张已销毁的纹理，Sprite 进 batcher 时读
   * `_source.alphaMode` 直接抛 null，整个画布一片空白（2.27.0 的事故）。
   * 生命周期归进程/渲染器，不归组件（守卫见 `render-stack-guard.test.ts`）。
   */
  const landGrain = useMemo(() => getPaperGrainTexture(), []);

  /**
   * 线宽用的量化缩放。
   *
   * 用 `useMemo` 缓存：缩放连续变化时它只在跨档那一刻换值，
   * 于是下面的边界重建 effect 不会因为滚轮每一格都跑一遍。
   */
  const borderScale = useMemo(() => quantizeScale(viewport.scale), [viewport.scale]);

  /**
   * 缩放档（2 的幂次档，与 PRD §6.6.2 一致）。
   *
   * 只在跨档时才重烤静态层缓存 —— 每格都重烤等于把缓存变成纯损耗（每滚一格
   * 多一次全屏离屏渲染，比不缓存还慢）。
   */
  const zoomTier = useMemo(
    () => Math.round(Math.log2(Math.max(1e-6, viewport.scale))),
    [viewport.scale],
  );

  /**
   * 手势态。
   *
   * `travel` 累计本次按下的总位移（像素），用于区分「单击」与「拖拽」——
   * 不能用单次事件的位移判断：缓慢拖动时每次 pointermove 只移动 1~2px，
   * 单次位移永远低于阈值，会被误判成单击（松手时触发落位/取消选中）。
   */
  const gesture = useRef<
    | { kind: "none" }
    | { kind: "pan"; lastX: number; lastY: number; travel: number }
    | { kind: "drag"; lastWorld: { x: number; y: number } }
    /** 拖动折线节点：只记节点下标，位置由世界坐标直接给（绝对坐标，不用增量） */
    | { kind: "polyline"; index: number }
  >({ kind: "none" });
  /** 超过该累计位移即视为拖拽而非单击（PRD §4.7） */
  const CLICK_SLOP = 4;

  /**
   * 叶子判定索引（`parentId → 有子节点`）：只在 `doc.regions` 变时重算 O(n)。
   *
   * ❗**绝不放进 `drawOverlay` 内部**：它的依赖含 `viewport.scale`，滚轮每格都会跑，
   * 在里面遍历 600 块建集合等于给缩放路径加一个 O(n) 的税（架构 §5-6）。
   */
  const parentIdSet = useMemo(() => buildParentIdSet(doc.regions), [doc.regions]);

  /**
   * 选中框重绘函数（供"选中态"effect 与导出后的 `redrawOverlay` 共用）。
   *
   * 【为什么抽成函数而不是继续用 effect 内联】导出前必须 `overlay.clear()`
   * （成品图里不能有选中框），但 `Graphics` 清了就是清了 —— 那个 effect 的依赖
   * 一个都没变，不会自己重画，于是导完之后选中框会一直消失到下次点选。
   * 早期用一个自增的 state 令牌去"戳"它重跑，但令牌不参与任何计算，
   * 依赖数组里就会多出一个"多余依赖"，是把时序缺陷藏进 lint 豁免里的写法。
   * 抽成一个函数后，导出侧直接调用它，语义直白、也没有多余的重渲染。
   */
  const drawOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.clear();

    // ── 选中区块的高亮（画在素材选中框之前，让更细的素材框压在上层）──
    //
    // 【三笔叠加，而不是一笔】区块动辄几百个顶点、覆盖面积很大，单描一条边在
    // 米黄陆地上几乎看不见。这里用「淡填充 + 宽而虚的外发光 + 细白内描边」，
    // 在任何底色上都读得出来是"这块被选中了"。
    //
    // 【线宽按屏幕像素换算】和区块边界同一个口径（`px / scale`）：缩远了不至于
    // 细到看不见，放大了也不会粗成一条带子。
    //
    // 【分级：叶子三笔 / 非叶子一笔】判据是"运行时有没有子节点"（`parentIdSet`），
    // **不是** `level === maxLevel` —— 合并会造出 `level` 更浅的叶子（PRD §6-A）。
    const picked = selectedRegionId
      ? doc.regions.find((r) => r.id === selectedRegionId)
      : undefined;
    if (picked && picked.polygon.length >= 3) {
      // 层级淡出时高亮一起淡：否则会出现"区块已经看不见了，高亮框还挂在空中"
      const weight = levelAlphas[picked.level] ?? 1;
      if (weight > 0.02) {
        const px = 1 / Math.max(1e-6, viewport.scale);
        const flat = toFlatPoints(picked.polygon);
        if (!parentIdSet.has(picked.id)) {
          // ── 叶子：现状三笔，**逐参数不变**（这是 R-REG-05 的回归基线）──
          // 淡填充 α0.16 / 外发光 8px α0.28 / 白内描边 2.2px α0.95。
          // "顺手优化"其中任何一个参数都会让 `MapCanvas/index.test.tsx` 的
          // 既有高亮用例失去意义 —— 那条用例正是"没改坏"的证明。
          overlay.poly(flat);
          overlay.fill({ color: REGION_PICK_COLOR, alpha: 0.16 * weight });
          overlay.poly(flat);
          overlay.stroke({
            width: REGION_PICK_GLOW_PX * px,
            color: REGION_PICK_COLOR,
            alpha: 0.28 * weight,
            alignment: 0.5,
          });
          overlay.poly(flat);
          overlay.stroke({ width: REGION_PICK_PX * px, color: 0xffffff, alpha: 0.95 * weight });
        } else {
          // ── 非叶子：容器态，只一笔强调描边（不铺面、不加外发光）──
          // 不铺面的理由：淡填充铺满整屏会把内部子区块的边界压掉，用户看不出
          // 自己在操作哪一块；而"面高亮只对最小可操作单位生效"正是 PRD §4.4 的裁决。
          overlay.poly(flat);
          overlay.stroke({
            width: REGION_CONTAINER_PX * px,
            color: REGION_PICK_COLOR,
            alpha: 0.9 * weight,
            alignment: 0.5,
          });
        }
      }
    }

    // ── 选中折线的高亮 + 节点手柄（B4-2）──
    //
    // 【为什么画在 overlay 而不是折线层】overlay 是交互指示层：导出时会被
    // `clearOverlay()` 清掉（成品图里不该有手柄），而折线层是内容、必须进导出。
    // 若把手柄画进折线层，导出的 PNG 上会挂着一串白点。
    //
    // 【为什么手柄半径按屏幕像素】世界单位会随缩放变大变小 —— 缩到整图时 4 世界
    // 单位的手柄不到 1.5px（看不见也点不中），放大到郡级时又大成一块膏药。
    if (selectedPolylineId) {
      const line = polylines.find((p) => p.id === selectedPolylineId);
      const weight = line ? elementWeight(line.level, levelAlphas) : 0;
      if (line && weight > 0 && line.points.length >= 2) {
        const px = 1 / Math.max(1e-6, viewport.scale);
        // 与 drawPolyline / pickPolyline 同一条退化守卫：<3 点的闭环是零面积来回线
        const closed = line.closed && line.points.length >= 3;
        const path = smoothPolyline(line.points, closed);
        overlay.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i += 1) overlay.lineTo(path[i].x, path[i].y);
        if (closed) overlay.lineTo(path[0].x, path[0].y);
        overlay.stroke({
          width: POLYLINE_PICK_PX * px,
          color: REGION_PICK_COLOR,
          alpha: 0.9 * weight,
          alignment: 0.5,
        });
        for (const pt of line.points) {
          overlay.circle(pt.x, pt.y, POLYLINE_NODE_PX * px);
          overlay.fill({ color: 0xffffff, alpha: 0.95 * weight });
          overlay.circle(pt.x, pt.y, POLYLINE_NODE_PX * px);
          overlay.stroke({
            width: px,
            color: REGION_PICK_COLOR,
            alpha: 0.9 * weight,
          });
        }
      }
    }

    if (!selectedId) return;
    const el = doc.elements.find((e) => e.id === selectedId);
    const def = el ? SPRITE_MAP[el.spriteId] : undefined;
    if (!el || !def) return;

    // 尺寸三处之一（另两处：精灵同步、命中测试）：
    // 素材按层级缩小（见 `lod.ts` 的 `elementSizeFactor`），选中框必须跟着缩，
    // 否则郡级素材的框会是它视觉尺寸的 8 倍。
    const factor = elementSizeFactor(el.level, levelAlphas.length);
    const w = def.baseWidth * el.scale * factor;
    const h = def.baseHeight * el.scale * factor;
    // 选中框画在 world 之外的 overlay 上（不随素材所在的层级容器淡出），
    // 所以这里要手动乘上该素材的层级权重，否则会出现"框还在、素材已经淡没了"。
    const weight = elementWeight(el.level, levelAlphas);
    if (weight <= 0) return;

    // 元素锚点是底部中心；选中框用世界坐标绘制，随 world 一起缩放
    overlay
      .rect(el.x - w / 2, el.y - h, w, h)
      .stroke({ width: 2, color: 0x5b6cf9, alignment: 0.5, alpha: weight });
  }, [
    selectedId,
    selectedRegionId,
    doc.elements,
    doc.regions,
    levelAlphas,
    viewport.scale,
    parentIdSet,
    selectedPolylineId,
    polylines,
  ]);

  /** 上面那个函数的最新引用：给初始化 effect 里的 `redrawOverlay` 与选中态 effect 取用 */
  const drawOverlayRef = useRef(drawOverlay);
  useEffect(() => {
    drawOverlayRef.current = drawOverlay;
  }, [drawOverlay]);

  /**
   * 重画草稿层。
   *
   * 【性能底线（架构 §2.6.1）】一次重画只做 `draftLayer.clear()` + 重写
   * 「n 个顶点圈 + 1 条折线 + ≤ 2 条虚线」，**不碰** `doc.regions`、不重跑任何
   * 区块几何、不触发 React 提交。这条由 `index.test.tsx` 的
   * 「连续 20 次 pointermove 不重建区块几何」用例守着。
   *
   * 【为什么顶点用 `circle` 而不是 `poly` 画方块】`circle` 在顶点数上千时才是
   * 性能负担，而草稿顶点几十个；圆点在任意缩放/旋转下都比方块像"顶点"。
   *
   * 【为什么所有尺寸都乘 px】线宽与半径都是**屏幕恒定**的：不除 scale 的话，
   * 放大到郡级（≈350%）时草稿会粗成一条带子、顶点圈大得盖住整块地。
   */
  const drawDraft = useCallback(() => {
    const layer = draftLayerRef.current;
    if (!layer) return;
    layer.clear();

    // 折线绘制态（B4-2）：与画区态**共用同一层**，因为两者互斥（工具只有一个）。
    // 共用一层省掉一套"草稿压在哪"的 z 序推理，也保证导出前只需清这一层。
    if (polylineDraft) {
      drawPolylinePreview(
        layer,
        polylineDraft,
        polylineDraftStyleId ?? "road-main",
        viewport.scale,
        draftCursorRef.current,
      );
      return;
    }

    if (!draftPoints || draftPoints.length === 0) return;

    const px = 1 / Math.max(1e-6, viewport.scale);
    const cursor = draftCursorRef.current;

    // ① 已确定的边：一条**开链**折线（用 moveTo/lineTo 而不是 poly —— poly 会
    //    自动把首尾连起来，画到第二个点时就出现一条"假闭合边"）。
    if (draftPoints.length >= 2) {
      layer.moveTo(draftPoints[0].x, draftPoints[0].y);
      for (let i = 1; i < draftPoints.length; i += 1) {
        layer.lineTo(draftPoints[i].x, draftPoints[i].y);
      }
      layer.stroke({
        width: DRAFT_LINE_PX * px,
        color: DRAFT_COLOR,
        alpha: 0.9,
        alignment: 0.5,
      });
    }

    // ② 顶点：首顶点白心 + 大一圈；光标靠近且已够 3 点时再放大（"能点了"的提示）
    for (let i = 0; i < draftPoints.length; i += 1) {
      const p = draftPoints[i];
      const first = i === 0;
      const snapable =
        first &&
        cursor !== null &&
        draftPoints.length >= 3 &&
        Math.hypot(cursor.x - p.x, cursor.y - p.y) <= DRAFT_CLOSE_PX * px;
      const radius = (snapable ? DRAFT_SNAP_PX : DRAFT_POINT_PX) * px;
      layer.circle(p.x, p.y, radius);
      layer.fill({ color: first ? 0xffffff : DRAFT_COLOR, alpha: 0.95 });
      layer.circle(p.x, p.y, radius);
      layer.stroke({ width: px, color: DRAFT_COLOR, alpha: 0.9 });
    }

    // ③ 光标预览：末点 → 光标（虚线）；够 3 点后补 光标 → 首顶点（收口提示）
    if (cursor) {
      appendDashedLine(layer, draftPoints[draftPoints.length - 1], cursor, px);
      if (draftPoints.length >= 3) {
        appendDashedLine(layer, cursor, draftPoints[0], px);
      }
      layer.stroke({ width: DRAFT_LINE_PX * px, color: DRAFT_COLOR, alpha: 0.55 });
      layer.circle(cursor.x, cursor.y, DRAFT_POINT_PX * 0.8 * px);
      layer.stroke({ width: px, color: DRAFT_COLOR, alpha: 0.7 });
    }
  }, [draftPoints, polylineDraft, polylineDraftStyleId, viewport.scale]);

  /** 同上：事件回调里要用最新那份（不把它塞进每个 handler 的依赖） */
  const drawDraftRef = useRef(drawDraft);
  useEffect(() => {
    drawDraftRef.current = drawDraft;
  }, [drawDraft]);

  /**
   * 草稿重绘的时机：草稿点变化、场景就绪。
   *
   * 【为什么缩放不进这里】缩放已由 `drawDraft` 的依赖覆盖（`viewport.scale`），
   * 但"缩放后光标的世界坐标"会变 —— 见下一条 effect。
   */
  useEffect(() => {
    if (!app) return;
    drawDraftRef.current();
  }, [drawDraft, app]);

  /**
   * 缩放后丢掉光标预览点。
   *
   * 【为什么必须丢】`draftCursorRef` 存的是世界坐标，而缩放后光标下的世界坐标
   * 已经变了（同一个屏幕位置对应另一个世界点）。不丢的话会看到一条**指向错误位置**
   * 的预览线，且它会一直挂在那里直到下一次移动 —— 用户会以为"鼠标卡住了"。
   *
   * 【双击历史一起丢】判定用的是 `DRAFT_CLOSE_PX / scale` 换算出来的世界距离，
   * 缩放一变这个距离的含义就变了。跨缩放的双击本来就不是双击，留着它只会让
   * "缩放到一半又点了一下"被误判成收尾。
   */
  useEffect(() => {
    draftCursorRef.current = null;
    lastDownRef.current = null;
    if (!app) return;
    drawDraftRef.current();
  }, [viewport.scale, app]);

  /**
   * 把 onSizeChange 存进 ref。
   *
   * Pixi Application 的初始化必须**只执行一次** —— 若把它作为 effect 依赖，
   * 回调一旦变化就会销毁重建 WebGL 上下文（画面闪烁 + 资源泄漏）。
   * 同步动作放在 effect 里（render 期不得写 ref）。
   */
  const onSizeChangeRef = useRef(onSizeChange);
  useEffect(() => {
    onSizeChangeRef.current = onSizeChange;
  }, [onSizeChange]);

  /** 同上：导出回调也只经 ref 取用，免得它一变就重建 WebGL 上下文 */
  const onSceneReadyRef = useRef(onSceneReady);
  useEffect(() => {
    onSceneReadyRef.current = onSceneReady;
  }, [onSceneReady]);

  // ── 初始化 Pixi Application ──
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    const instance = new Application();

    /**
     * 【关键】init 是否已完成。
     *
     * Pixi v8 的 `Application.init()` 是异步的，且插件（ResizePlugin 等）的
     * `init` 挂载在 `await autoDetectRenderer()` **之后**才执行 ——
     * 也就是说 `this._cancelResize` 等插件字段在 await 期间尚不存在。
     *
     * 而 React StrictMode 下 effect 会「挂载 → 卸载 → 再挂载」：
     * 第一次卸载时 init 可能仍在 await 中，此刻调 `destroy()` 就会走到
     * `ResizePlugin.destroy()` 里的 `this._cancelResize()`，抛
     * "this._cancelResize is not a function"。
     *
     * 因此必须记录 init 完成情况：未完成就等它完成后再销毁，不得提前 destroy。
     */
    let initDone = false;
    /** 卸载请求在 init 完成前到达时置位，init 完成后据此自行销毁 */
    let destroyPending = false;

    const initPromise = (async () => {
      await instance.init({
        /**
         * 画布背景保持**透明**：底图之外的那圈空白交给 CSS 的 `--app-bg`
         * （见 MapCanvas/index.scss 的 `.map-canvas`）。
         *
         * 早期这里硬编码 0x1b2620（深墨绿），在深色主题下勉强能用，但默认主题
         * aurora 是浅色 —— 那会让整个画布被一块深绿糊满，既看不出"这是一张
         * 地图"，也谈不上四周留白。透明之后留白自动跟随主题。
         */
        backgroundAlpha: 0,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
        // 画布尺寸由 CSS 撑满，这里只跟随容器
        resizeTo: host,
        preference: "webgl",
      });
      initDone = true;

      // init 期间组件已卸载：此刻才能安全销毁（插件字段已就绪）
      if (disposed || destroyPending) {
        instance.destroy(true, { children: true });
        return;
      }

      host.appendChild(instance.canvas);

      // 场景图：world 承载全部视口变换
      const world = new Container();
      /**
       * 静态层：图纸投影 + 海面。
       *
       * 这两样在编辑过程中永远不变（投影是常量几何、海面是底图纹理），
       * 缓存成一张纹理后整组只剩一次 draw call。换纸张尺寸/换底图时才需要
       * `updateCacheTexture()`。
       *
       * 【为什么海岸不在这组里】PRD §6.6.2 想把「投影 / 海面 / 海岸」整组缓存，
       * 但 §6.4 又要求"海面不挂滤镜、海岸挂滤镜"。整组缓存会把它们烤成一张图，
       * 于是滤镜只能二选一：要么海面被染色（§6.4 明令禁止），要么海岸不变色
       * （用户看到的是"切风格海岸没反应"）。两条要求在这里互斥 ——
       * 取 §6.4：滤镜纪律是本批的硬约束，而海岸本身只是一张烘焙好的精灵
       * （1 次 draw call），缓存它并不会省下什么。
       */
      const staticLayer = new Container();
      const sheet = new Graphics();
      const sea = new Sprite();
      const seaShade = new Graphics();
      staticLayer.addChild(sheet, sea, seaShade);
      /**
       * 海岸层：容器 + 一张精灵（承接烘焙出的 RenderTexture）。
       *
       * 为什么不是直接把四层 Graphics 挂上来：其中三层带 BlurFilter，
       * 挂在每帧重绘的容器上等于每帧三次高斯模糊。四层在**烘焙期**才存在，
       * 运行期只剩这一张纹理（见 coastBake.ts 文件头）。
       */
      const coast = new Container();
      const coastSprite = new Sprite();
      coast.addChild(coastSprite);
      // 区块层本身是个容器：真正的内容按层级分成若干子容器（见下方各 effect），
      // 这样"交叉淡化"只需要改子容器的 alpha，不必重建任何几何。
      const regionLayer = new Container();
      // 折线层：与区块层同样是个空容器，真正的内容按层级分成子容器（见折线 effect）
      const polylineLayer = new Container();
      const elementLayer = new Container();
      const submapLayer = new Container();
      const labelLayer = new Container();
      const overlay = new Graphics();
      // ★ 手画草稿层（R-REG-03）：压在 overlay 之上，见 `layers.ts` 的顺序表
      const draftLayer = new Graphics();
      /**
       * ★ 一次性按 `WORLD_LAYER_ORDER` 的顺序加入；后续 effect 一律不得再 addChild
       *   （staticLayer 内部是 sheet → sea → seaShade，见上）。
       *
       * 【为什么用"具名清单 + 映射"而不是一串实参】z 序一旦散在实参顺序里，
       * "再加一层"就必然打掉几个测试文件的裸下标（`children[4]`、`at(-1)`、
       * `toHaveLength(7)`），而失败信息只是"长度不对"。抽成常量后，插层只改一处。
       */
      const layersByName: Record<WorldLayerName, Container> = {
        staticLayer,
        coast,
        regionLayer,
        polylineLayer,
        elementLayer,
        submapLayer,
        labelLayer,
        overlay,
        draftLayer,
      };
      world.addChild(...WORLD_LAYER_ORDER.map((name) => layersByName[name]));
      instance.stage.addChild(world);

      worldRef.current = world;
      staticLayerRef.current = staticLayer;
      sheetRef.current = sheet;
      seaRef.current = sea;
      seaShadeRef.current = seaShade;
      coastRef.current = coast;
      coastSpriteRef.current = coastSprite;
      regionLayerRef.current = regionLayer;
      polylineLayerRef.current = polylineLayer;
      elementLayerRef.current = elementLayer;
      submapLayerRef.current = submapLayer;
      labelLayerRef.current = labelLayer;
      overlayRef.current = overlay;
      draftLayerRef.current = draftLayer;

      setApp(instance);
      const rect = host.getBoundingClientRect();
      const next = { width: Math.round(rect.width), height: Math.round(rect.height) };
      setSize(next);
      onSizeChangeRef.current(next);
      // 交出场景句柄（导出用）。注意 `clearOverlay` 只清 Graphics，
      // 重绘由 `redrawOverlay` 令牌驱动 —— 两者必须成对使用，否则框会一直消失。
      onSceneReadyRef.current?.({
        renderer: instance.renderer,
        stage: instance.stage,
        world,
        rect: BASE_RECT,
        clearOverlay: () => {
          overlayRef.current?.clear();
        },
        // 直接调同一个绘制函数（不靠 state 令牌戳 effect，见 `drawOverlay`）
        redrawOverlay: () => drawOverlayRef.current(),
      });
    })();

    return () => {
      disposed = true;
      onSceneReadyRef.current?.(null);
      spriteByIdRef.current.clear();
      worldRef.current = null;
      staticLayerRef.current = null;
      sheetRef.current = null;
      seaRef.current = null;
      seaShadeRef.current = null;
      coastRef.current = null;
      coastSpriteRef.current = null;
      regionLayerRef.current = null;
      // 子容器随 world 一起被 destroy(true, {children:true}) 回收，这里只清引用
      levelLayersRef.current = [];
      polylineLayerRef.current = null;
      polylineLayersRef.current.clear();
      polylineGraphicsRef.current.clear();
      elementLayerRef.current = null;
      elementLayersRef.current.clear();
      submapLayerRef.current = null;
      // 子图节点持有烘焙出的 RenderTexture（不是显示对象，不会随 world 一起回收），
      // 必须显式销毁；`destroy()` 对已销毁的容器是幂等的，随后的
      // `instance.destroy(true, {children:true})` 不会因此报错。
      for (const handle of submapNodeByIdRef.current.values()) handle.destroy();
      submapNodeByIdRef.current.clear();
      labelLayerRef.current = null;
      labelHandlesRef.current.clear();
      overlayRef.current = null;
      draftLayerRef.current = null;
      draftCursorRef.current = null;
      lastDownRef.current = null;

      if (initDone) {
        // init 已完成：插件字段齐备，可直接销毁
        instance.destroy(true, { children: true });
      } else {
        // init 仍在进行中：标记待销毁，交由 initPromise 完成后处理
        destroyPending = true;
        void initPromise.catch(() => {
          /* init 失败时无需再销毁，避免掩盖原始错误 */
        });
      }
      setApp(null);
    };
    // 空依赖：Pixi 上下文只初始化一次（回调经 ref 取用，见上）
  }, []);

  // ── 容器尺寸跟随 ──
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const apply = () => {
      const rect = host.getBoundingClientRect();
      const next = { width: Math.round(rect.width), height: Math.round(rect.height) };
      setSize((prev) =>
        prev.width === next.width && prev.height === next.height ? prev : next,
      );
      onSizeChangeRef.current(next);
    };
    const ro = new ResizeObserver(apply);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  // ── 图纸投影（绘制在底图之下，把"留白"衬出来）──
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.clear();

    // 由外向内逐圈叠加，落在内部的像素被更多圈覆盖，透明度自然累积成柔和衰减。
    // 顺序必须是 rings → 1：后画的矩形盖在先画的之上，这样最内侧（贴纸边）
    // 才是最暗的一圈。
    for (let i = SHEET_SHADOW.rings; i >= 1; i -= 1) {
      const grow = SHEET_SHADOW.step * i;
      sheet.rect(
        BASE_RECT.x - grow,
        BASE_RECT.y - grow + SHEET_SHADOW.offsetY,
        BASE_RECT.width + grow * 2,
        BASE_RECT.height + grow * 2,
      );
      sheet.fill({ color: SHEET_SHADOW.color, alpha: SHEET_SHADOW.alpha });
    }

    // 纸边：极淡的一圈描边，深浅主题下"底图 / 留白"的交界都清晰可辨。
    // 线宽用世界单位（与区块边界一致）—— 放大到能看见画框时，人已在图外，
    // 不必为屏幕恒定线宽引入额外的重绘。
    sheet.rect(BASE_RECT.x, BASE_RECT.y, BASE_RECT.width, BASE_RECT.height);
    sheet.stroke({ width: 1.5, color: 0x0f1a15, alpha: 0.26, alignment: 0.5 });

    // ── 海面暗角（画在海面**之上**，所以是独立节点，见 SEA_VIGNETTE）──
    const shade = seaShadeRef.current;
    if (!shade) return;
    shade.clear();
    for (let i = 1; i <= SEA_VIGNETTE.bands; i += 1) {
      const inset = SEA_VIGNETTE.step * i;
      // t = 0（最内环）→ 1（最外环）：环越靠外越沉，累加成平滑的四周压暗
      const t = i / SEA_VIGNETTE.bands;
      const alpha = SEA_VIGNETTE.alphaFrom + (SEA_VIGNETTE.alphaTo - SEA_VIGNETTE.alphaFrom) * t;
      shade.rect(
        BASE_RECT.x + inset,
        BASE_RECT.y + inset,
        BASE_RECT.width - inset * 2,
        BASE_RECT.height - inset * 2,
      );
      shade.stroke({ width: SEA_VIGNETTE.step, color: SEA_VIGNETTE.color, alpha, alignment: 0.5 });
    }
  }, [app]);

  // ── 海面（底图纹理铺满整张纸）──
  useEffect(() => {
    const sea = seaRef.current;
    if (!sea) return;
    const tex = textures[doc.baseImageId] ?? textures[BASE_IMAGE.id];
    if (tex) {
      sea.texture = tex;
      sea.width = BASE_IMAGE.width;
      sea.height = BASE_IMAGE.height;
      // 海面以世界原点为中心铺开（世界原点在地图中心）
      sea.anchor.set(0.5);
      sea.position.set(0, 0);
    }
  }, [textures, app, doc.baseImageId]);

  // ── 静态层缓存（投影 + 海面，整组烤成一张纹理）──
  //
  // 【为什么声明在"海岸烘焙"与"剔除"之前】本批有一条硬顺序：**先更新缓存，
  // 再做剔除**。剔除读的是容器的局部包围盒，而 `cacheAsTexture` 会把子树折叠成
  // 一个精灵 —— 那个时刻的包围盒与"未缓存"时不同。先剔除后建缓存，那一帧的
  // `visible` 就是按旧布局算的，缓存建好后没人再来重算（表现是偶尔错一帧）。
  // 目前 `staticLayer` 自己**不参与剔除**（见剔除 effect 的 ⚠️），所以这条顺序
  // 暂时不会出事；但它是本组 effect 的纪律，别等改了剔除范围才发现踩空。
  //
  // 【为什么只在跨档时重烤】`cacheAsTexture` 烤出的是一张**固定分辨率**的纹理，
  // 之后由世界变换放大。分辨率必须跟着缩放走（否则放到郡级就是 1 倍图拉 3.5 倍，
  // 海面与投影边缘会糊），但每格都重烤等于每滚一格多一次全屏离屏渲染 ——
  // 比不缓存还慢。折中：倍率量化到 2 的幂次档（`zoomTier`），只在跨档时重烤。
  //
  // ⚠️ **不要把 `filters` 挂在这个被缓存的节点上**：pixi 的缓存是"先把子树渲染
  // 成纹理、再把纹理画出来"，节点自己的滤镜会被烤进纹理之前的那一步吃掉。
  // 滤镜一律挂在 `regionLayer` / `elementLayer` / `labelLayer` 上
  // （见下面的风格 effect）；`staticLayer` 则永远不挂 —— 它里面的海面本来也不该变色。
  useEffect(() => {
    const layer = staticLayerRef.current;
    if (!layer) return;

    // 目标倍率 = 2^tier 封顶 STATIC_CACHE_MAX_RES；tier < 0（缩小）时用 1 倍
    const resolution = Math.min(
      STATIC_CACHE_MAX_RES,
      Math.max(1, 2 ** Math.max(0, zoomTier)),
    );

    // 纸纹变化也要重烤：缓存烤的是"此刻的画面"，海面纹理晚于初始化到达时
    // 不重烤就会把一张空精灵烤进去，之后无论怎么缩放都是空白。
    const paperChanged = staticPaperRef.current !== paperTexture;
    const resChanged = staticResRef.current !== resolution;
    if (staticCachedRef.current && !paperChanged && !resChanged) return;

    staticPaperRef.current = paperTexture;
    staticResRef.current = resolution;

    if (!staticCachedRef.current || resChanged) {
      // 首次建缓存，或倍率跨档：重复调用 `cacheAsTexture` = 以新参数重建，
      // 不会叠出第二层缓存（pixi 内部会先释放旧的 RenderTexture）
      layer.cacheAsTexture({ resolution, antialias: true });
      staticCachedRef.current = true;
    } else {
      // 只是内容变了（纸纹到位）：按当前参数重新烤一遍，比重建整个缓存便宜
      layer.updateCacheTexture();
    }
  }, [zoomTier, paperTexture, app]);

  // ── 海岸烘焙（只随「陆地几何 / 风格 / 纸纹」变，绝不随 viewport 变）──
  //
  // 【为什么用指纹而不是布尔脏标记】指纹是派生的，改完不用记得"置脏"；
  // 布尔标记漏置位就表现为"改了但画面没变"，排查成本极高。
  useEffect(() => {
    const coast = coastRef.current;
    const sprite = coastSpriteRef.current;
    if (!coast || !sprite) return;

    // 指纹与纸纹都没变 ⇒ 完全跳过（连 RenderTexture.create 都不会调）
    if (bakeKeyRef.current === bakeKey && bakePaperRef.current === landGrain) return;
    bakeKeyRef.current = bakeKey;
    bakePaperRef.current = landGrain;

    // 没有陆地：清空并隐藏（不销毁容器，下次生成陆地时直接复用）
    if (bakeKey === null || !land) {
      const stale = bakeRtRef.current;
      bakeRtRef.current = null;
      sprite.texture = Texture.EMPTY;
      coast.visible = false;
      stale?.destroy(true);
      return;
    }

    const renderer = app?.renderer;
    if (!renderer) {
      // app 还没就绪：把指纹退回"未跑过"，等下一次 effect 再试
      bakeKeyRef.current = undefined;
      return;
    }

    // 先算出新的 → 成功后原子替换 → 再销毁旧的（避免闪一帧空白）
    const next = bakeCoast({
      renderer,
      land,
      // 【风格在这里乘一次】海岸的观感（含配色）全部由烘焙产出，见 coastBake
      // 文件头：`bakeKey` 含 style，所以切风格本来就要重烘一次 —— 那次重烘
      // 必须真的改变像素，否则就是白付三次高斯模糊。
      style,
      // 【纸纹只喂纸，不喂海】中性灰颗粒（见 paperGrain.ts）；`landGrain` 在
      // jsdom 下为 null，此时烘焙退化成纯米黄陆地，不抛错。
      paperTexture: landGrain,
      paperRect: BASE_RECT,
      resolution: bakeResolution,
    });
    const prev = bakeRtRef.current;
    sprite.texture = next;
    // 纹理覆盖的是「陆地包围盒外扩 BAKE_MARGIN」这块世界矩形
    sprite.position.set(land.bounds.x - BAKE_MARGIN, land.bounds.y - BAKE_MARGIN);
    sprite.width = land.bounds.width + BAKE_MARGIN * 2;
    sprite.height = land.bounds.height + BAKE_MARGIN * 2;
    coast.visible = true;
    bakeRtRef.current = next;
    prev?.destroy(true);
    // `style` 与 `bakeKey` 的重合是刻意的：`bakeKey` 已经含 style（它是唯一的
    // 触发源），但 effect 体里直接读了 `style`，显式列出来才不用为 lint 开口子。
  }, [bakeKey, land, style, landGrain, bakeResolution, app]);

  // ── 卸载时释放最后一张烘焙纹理 ──
  //
  // 单独一个空依赖 effect：上面那个 effect 刻意**不在** cleanup 里销毁纹理
  // （React 会先跑旧 effect 的 cleanup 再跑新 effect，那样就变成"先销毁再重建"，
  // 会闪一帧空白）。因此销毁只放在这里（真正的卸载）与"指纹变 null"分支。
  useEffect(
    () => () => {
      const rt = bakeRtRef.current;
      bakeRtRef.current = null;
      bakeKeyRef.current = undefined;
      bakePaperRef.current = undefined;
      rt?.destroy(true);
    },
    [],
  );

  // ── 全局风格滤镜（B4 / PRD §6.4）──
  //
  // 【分工：海岸在烘焙期上色，其余三层在运行期换 filters】
  //   `coast`              ✘ **不挂**：风格已经在 `bakeCoast` 里乘进纹理了。
  //                           再挂一次 = 同一个矩阵乘两遍（羊皮纸会明显发暗发黄）。
  //                           而且 `bakeKey` 含 style，切风格必然重烘 —— 那次
  //                           重烘是有效产出，不需要运行期再补一次。
  //   `regionLayer`        ✔ 挂：分区填充色
  //   `elementLayer`       ✔ 挂：素材色
  //   `labelLayer`         ✔ 挂：地名色
  //   `sea`（在静态层里）  ✘ 不挂：海面就是底图本身，染色等于把整张图改色
  //   `staticLayer`        ✘ 不挂：被 `cacheAsTexture` 烤成一张图，而**被缓存的
  //                           节点会吞掉自己的滤镜**（缓存是"先渲染成纹理再画纹理"，
  //                           滤镜在更外层那一步才生效）。挂在它上面只会得到
  //                           "切风格海面/投影不变色"的假象。
  //   `overlay`            ✘ **绝不**挂：选中框是交互指示，染色会让"选中"看起来变淡
  //   `world`              ✘ **绝不**挂：会把上面全部（含 overlay、含四周留白）
  //                           一起过滤
  //
  // 【为什么每次切风格都换新实例】`ColorMatrixFilter` 的 `saturate()` /
  // `brightness()` 是**就地累乘**：在旧实例上再叠一次，"原色 → 墨色 → 原色"
  // 回不到原色（矩阵不可逆），来回切几次画面就废了。见 `style.ts` 的 `filterFor`。
  useEffect(() => {
    if (!app) return;
    const filter = filterFor(style);
    const prev = styleFilterRef.current;
    styleFilterRef.current = filter;

    const targets = [
      regionLayerRef.current,
      elementLayerRef.current,
      labelLayerRef.current,
    ];
    for (const target of targets) {
      if (!target) continue;
      // `"none"` 时赋空数组（而不是保留旧数组）：这是"原色"真正生效的地方，
      // 少了这一句，切回原色会残留上一档的颜色。
      target.filters = filter ? [filter] : [];
    }

    // 先赋新的、再销毁旧的：反过来的话两者之间有一步 filters 指向已销毁对象
    prev?.destroy();
  }, [style, app]);

  // ── 卸载时销毁最后一个风格滤镜 ──
  //
  // 单独一个空依赖 effect：上面的 effect 没有 cleanup（它靠"赋新后销毁旧"保证
  // 不累乘、不泄漏增量），真正的最后一个只能在这里销毁，否则每个画布实例
  // 都会漏一个 Filter 的 uniform group。
  useEffect(
    () => () => {
      styleFilterRef.current?.destroy();
      styleFilterRef.current = null;
    },
    [],
  );

  // ── 分区显隐：只改容器 alpha，不动几何 ──
  //
  // 关掉分区 = "给读者看的成品图"，用户会频繁切换，因此必须是零成本的
  // 一次赋值；条件渲染会让区块几何反复重建（223 个多边形 × 1.5 万顶点）。
  useEffect(() => {
    const layer = regionLayerRef.current;
    if (!layer) return;
    layer.alpha = showRegions ? 1 : 0;
  }, [showRegions, app]);

  // ── 逻辑图层显隐（B4-1）：只改容器 visible，不动几何 ──
  //
  // 【为什么区块不在这一组】区块走上一段的 `alpha`（它要在 0.16 填充里继续透出
  // 陆地材质，且"显示分区"是成品图开关，历史上就是 alpha 语义）。这里只管
  // 三个"有就画、没有就空"的纯内容层：关掉它们用 `visible=false` 最省 ——
  // 整棵子树的绘制与批处理都被跳过，比 alpha=0 少一遍 draw call。
  //
  // 【为什么读 `layerVisibleOf` 而不是自己判 `!== false`】`region` 的分支在
  // 那个函数里（事实源是 showRegions）；这里虽然不处理 region，但保持
  // "读点只有一个"的纪律，将来把 region 挪进来时不会漏掉。
  useEffect(() => {
    const host = { showRegions, layerState: doc.layerState };
    const pairs: Array<[Container | null, boolean]> = [
      [polylineLayerRef.current, layerVisibleOf(host, "polyline")],
      [elementLayerRef.current, layerVisibleOf(host, "element")],
      [submapLayerRef.current, layerVisibleOf(host, "submap")],
      [labelLayerRef.current, layerVisibleOf(host, "label")],
    ];
    for (const [layer, on] of pairs) {
      if (layer && layer.visible !== on) layer.visible = on;
    }
  }, [doc.layerState, showRegions, app]);

  // ── 区块层 · 第一步：按层级建/拆子容器 ──
  //
  // 每个层级一个子容器，容器内部是「填充 + 边界」两份 Graphics，靠容器 alpha 做
  // 交叉淡化。这样把三件互相牵制的事解耦开：
  //   · 权重变化（滚轮每一格）→ 只改 alpha，几何零重建
  //   · 区块变化（生成/清除/撤销）→ 只重建填充与边界
  //   · 缩放变化（跨量化档）→ 只重建边界（线宽是屏幕恒定的，见 BORDER_WIDTH_QUANTIZE）
  useEffect(() => {
    const layer = regionLayerRef.current;
    if (!layer) return;
    const want = levelAlphas.length;

    while (levelLayersRef.current.length < want) {
      const container = new Container();
      const fill = new Graphics();
      const border = new Graphics();
      container.addChild(fill, border);
      layer.addChild(container);
      levelLayersRef.current.push({ container, fill, border });
    }
    while (levelLayersRef.current.length > want) {
      const extra = levelLayersRef.current.pop();
      if (!extra) break;
      layer.removeChild(extra.container);
      extra.container.destroy({ children: true });
    }
  }, [levelAlphas.length, app]);

  // ── 区块层 · 填充（只随区块变化重建）──
  //
  // 填充与描边必须是两份独立 Graphics（而不是"填一块、描一块"地交替）：
  // 边界线以多边形路径为中心向两侧各铺一半（alignment 0.5），交替绘制时后画区块
  // 的填充会把前一块的边界压掉一半，边界就会粗细不均、看上去断断续续。
  // 分成两份 Graphics 后，"先全填、再全描"由容器内部的子节点顺序天然保证。
  useEffect(() => {
    const levels = levelLayersRef.current;
    if (levels.length === 0) return;
    for (const lv of levels) lv.fill.clear();
    // 按层级分组：细级排在后面，边界压在粗级之上 —— 缩到深处时"新长出来"的
    // 边界更清晰，粗级的边界则正在淡出，互不抢戏。
    for (const region of doc.regions) {
      const lv = levels[region.level];
      if (!lv || region.polygon.length < 3) continue;
      lv.fill.poly(toFlatPoints(region.polygon));
      // 静态层次衰减（P2-2）：填充 = 全局填充 × 层次系数（越深的层级越淡）。
      // 【不要换成 levelAlphas】那是缩放驱动的 LOD 权重（已写进容器 alpha），
      // 再乘一次就是双重衰减 —— 见 regions.ts 的 REGION_LEVEL_FILL_SCALE。
      lv.fill.fill({ color: region.color, alpha: regionFillAlphaOf(region.level) });
    }
  }, [doc.regions, levelAlphas.length, app]);

  // ── 区块层 · 边界（屏幕恒定线宽；只在缩放跨量化档时重建）──
  //
  // 线宽换算成世界单位 = 像素 / 缩放。早期版本用固定世界单位，结果缩远了细到
  // 看不见、放到最大比山脉还宽 —— 区块的可见缩放跨了 40 倍，这个换算不能省。
  useEffect(() => {
    const levels = levelLayersRef.current;
    if (levels.length === 0) return;
    const width = REGION_BORDER_PX / borderScale;
    for (const lv of levels) lv.border.clear();
    for (const region of doc.regions) {
      const lv = levels[region.level];
      if (!lv || region.polygon.length < 3) continue;
      lv.border.poly(toFlatPoints(region.polygon));
      lv.border.stroke({
        width,
        color: REGION_BORDER_COLOR,
        // 边界与填充共用同一张静态系数表（P2-2）：两者必须同比例衰减，
        // 否则"线比面还淡"。见 regions.ts 的 regionBorderAlphaOf。
        alpha: regionBorderAlphaOf(region.level),
        alignment: 0.5,
      });
    }
  }, [doc.regions, borderScale, levelAlphas.length, app]);

  // ── 区块层 · 权重（无极衔接的核心：相邻两级此消彼长）──
  //
  // 上层保证 Σα ≡ 1（见 lod.ts 的帽函数），因此这里逐级赋 alpha 即可，
  // 不存在"过渡带里所有层级都太淡"或"多级叠加发黑"的情况。
  //
  // 【依赖里必须有 app】首次挂载时 app 还是 null、层级容器尚未建立，本 effect 会
  // 空跑一次；而 levelAlphas 由上层 useMemo 而来、引用常年不变，若只依赖它，
  // 容器建好之后就再也没有机会把权重写进去 —— 结果是所有层级都停在容器默认的
  // alpha 1 上，四级区块和各级素材同时全亮。这种事在"恰好又改了缩放（引用变了）"
  // 时会被悄悄掩盖，正是最容易漏掉的一类时序缺陷。
  useEffect(() => {
    levelLayersRef.current.forEach((lv, i) => {
      lv.container.alpha = levelAlphas[i] ?? 0;
    });
  }, [levelAlphas, app]);

  // ── 折线层 · 第一步：按层级建/拆子容器（与素材层同构）──
  //
  // 与素材层同一套键（`elementKeyOf`）：`LOOSE_LEVEL_KEY` 排在最后且恒不透明，
  // 其余每层一个容器、alpha 跟 `levelAlphas` 走。折线的 `level` 语义与素材完全一致，
  // 复用同一个键函数而不是另写一份"层级 → 容器"的映射。
  useEffect(() => {
    const group = polylineLayerRef.current;
    if (!group) return;
    const keys = [...levelAlphas.keys(), LOOSE_LEVEL_KEY];
    for (const key of keys) {
      if (!polylineLayersRef.current.has(key)) {
        polylineLayersRef.current.set(key, new Container());
      }
    }
    // 已存在的容器不销毁（Graphics 还挂在里面），只重建挂载顺序
    for (const container of polylineLayersRef.current.values()) group.removeChild(container);
    for (const key of keys) group.addChild(polylineLayersRef.current.get(key) as Container);
  }, [levelAlphas.length, app]);

  // ── 折线层 · 第二步：重绘（只随折线 / 层级数 / 线宽档变化）──
  //
  // 【为什么 `borderScale` 必须进依赖】线宽是世界单位、但有屏幕下限：
  // 缩放跨过量化档时，下限兜底会改变**实际**线宽。不重绘就会出现"缩到整图后
  // 线细到看不见、再放大也不回来"—— 而 data 一点没变，没有任何报错。
  //
  // 【为什么要按层级选容器】与素材同理：所属层级淡出这条线就该淡出。
  // 容器 alpha 由下一步的权重 effect 统一写，这里只管把线画进正确的容器。
  //
  // 【为什么用"复用 Graphics + clear"而不是每次删了重建】拖节点时本 effect 每帧
  // 都会跑（`doc.polylines` 是新的引用）：每帧 new/ destroy 几十个 Graphics 会让
  // GPU 侧反复分配缓冲。clear 后重描只复用同一批显示对象。
  useEffect(() => {
    const group = polylineLayerRef.current;
    if (!group) return;
    const levelCount = levelAlphas.length;
    const seen = new Set<string>();

    for (const line of polylines) {
      if (line.points.length < 2) continue;
      seen.add(line.id);
      const key = elementKeyOf(line.level, levelCount);
      const target = polylineLayersRef.current.get(key) ?? group;

      let g = polylineGraphicsRef.current.get(line.id);
      if (!g) {
        g = new Graphics();
        polylineGraphicsRef.current.set(line.id, g);
      }
      if (g.parent !== target) {
        g.parent?.removeChild(g);
        target.addChild(g);
      }
      g.clear();
      // alpha 由层级容器统一给（这里只画内容），因此传 1
      drawPolyline(g, line, { scale: borderScale, alpha: 1 });
    }

    // 删除已不存在的折线（含"删点删到整条消失"）
    for (const [id, g] of polylineGraphicsRef.current) {
      if (seen.has(id)) continue;
      g.parent?.removeChild(g);
      g.destroy();
      polylineGraphicsRef.current.delete(id);
    }
  }, [polylines, levelAlphas.length, borderScale, app]);

  // ── 折线层 · 第三步：权重（与区块、素材、地名同一份 levelAlphas）──
  //
  // 依赖里必须有 app，理由与其余权重 effect 完全一致：首次挂载时容器还没建好，
  // 少了 app 就会永远停在默认 alpha 1 —— 表现为"所有层级的线同时可见"。
  useEffect(() => {
    polylineLayersRef.current.forEach((container, key) => {
      container.alpha = key === LOOSE_LEVEL_KEY ? 1 : levelAlphas[key] ?? 0;
    });
  }, [levelAlphas, app]);

  // ── 素材层 · 第一步：按层级建容器（层级数变化时重排顺序）──
  //
  // 素材不是"浮在地图上的一层贴纸"，而是某个尺度下的地形：在郡那一级摆的山属于
  // 郡的世界，缩到洲/国家去看时就该退场。做法与区块层完全一致 —— 每个层级一个
  // 容器，容器的 alpha 跟着该层级的权重走（见下面的权重 effect）。
  //
  // 为什么不用"逐个精灵设 alpha"：那样滚轮每滚一格都要遍历全部素材（2000+ 元素时
  // 每个 notch 两千次写入），而按容器分组后每格只改三四个浮点数 —— 这正是本组件
  // 一直守着的"视口变化不得触碰元素"的底线。
  useEffect(() => {
    const group = elementLayerRef.current;
    if (!group) return;

    // "层级无关"排在最后：它恒为不透明，不能排在会被淡出的层级下面
    const keys = [...levelAlphas.keys(), LOOSE_LEVEL_KEY];
    for (const key of keys) {
      if (!elementLayersRef.current.has(key)) {
        elementLayersRef.current.set(key, new Container());
      }
    }

    // 已存在的容器不销毁（精灵还挂在里面），只重建挂载顺序。
    // 层级数是可以改的，新层级若直接 append 会跑到"层级无关"之上，顺序就乱了。
    for (const container of elementLayersRef.current.values()) group.removeChild(container);
    for (const key of keys) group.addChild(elementLayersRef.current.get(key) as Container);
  }, [levelAlphas.length, app]);

  // ── 素材层 · 第二步：增量同步精灵（只随素材/纹理变化重建）──
  useEffect(() => {
    const group = elementLayerRef.current;
    if (!group) return;

    const existing = spriteByIdRef.current;
    const seen = new Set<string>();
    /**
     * 层级数 = 权重表长度（`0` = 还没生成区块，此时所有素材层级无关、因子恒为 1）。
     *
     * 因子在这里**按元素算**（`elementSizeFactor` 是一次幂运算，成本可忽略），
     * 但取值规则只有这一份 —— 与选中框、命中测试共用同一个函数，三处不可能错开。
     */
    const levelCount = levelAlphas.length;

    for (const el of doc.elements) {
      seen.add(el.id);
      const def = SPRITE_MAP[el.spriteId];
      const tex = textures[el.spriteId];
      if (!def) continue;

      // 目标容器：该素材所属层级的容器（层级越界时并入最细一级）
      const key = elementKeyOf(el.level, levelAlphas.length);
      const target = elementLayersRef.current.get(key) ?? group;

      let entry = existing.get(el.id);
      if (!entry) {
        const sprite = new Sprite(tex ?? Texture.EMPTY);
        // 锚点：水平居中、垂直底部（贴图"脚底"落在世界 y 上）
        sprite.anchor.set(0.5, 1);
        target.addChild(sprite);
        entry = { sprite, key };
        existing.set(el.id, entry);
      } else if (entry.key !== key) {
        // 层级归属变了（改了层级数、或撤销重做到了另一次放置）：换容器
        elementLayersRef.current.get(entry.key)?.removeChild(entry.sprite);
        target.addChild(entry.sprite);
        entry.key = key;
      }

      const { sprite } = entry;
      if (tex && sprite.texture !== tex) sprite.texture = tex;

      sprite.position.set(el.x, el.y);
      // 尺寸三处之二：绘制尺寸 = 基准尺寸 × 元素自身 scale × 层级因子。
      // 素材与区块同在 `world` 容器下、同倍缩放，所以"素材比郡还大"这个比例
      // 不会因为放大而改变 —— 必须在世界里就把它缩小（见 `elementSizeFactor`）。
      const factor = elementSizeFactor(el.level, levelCount);
      sprite.width = def.baseWidth * el.scale * factor;
      sprite.height = def.baseHeight * el.scale * factor;
      sprite.rotation = (el.rotation * Math.PI) / 180;
      // 外观属性（R-MAP-23）：不透明度与色相。取值一律走 types 的兜底函数 ——
      // 老文档没有这两个字段，读点回落"不透明 + 原色"，迁移函数不补值
      sprite.alpha = elementOpacityOf(el);
      sprite.tint = tintColorOf(elementTintHueOf(el));
      // 镜像翻转（P1-4）：width 赋值会把 scale.x 的**幅值**归正（pixi 8 的
      // `_setWidth` 保留符号），符号必须在这里显式按存档重设，不能增量取反
      // —— 否则上一次的翻面会残留。锚点是 (0.5, 1)：水平居中，翻转绕竖直
      // 中轴进行，脚底点与外接盒都不动 —— 命中区（coords.hitTestElement）与
      // 选中框天然与原图一致，不需要按 baseWidth 反算锚点。
      sprite.scale.x = Math.abs(sprite.scale.x) * (elementFlipXOf(el) ? -1 : 1);
    }

    // 移除已删除的元素精灵
    for (const [id, entry] of existing) {
      if (!seen.has(id)) {
        entry.sprite.parent?.removeChild(entry.sprite);
        entry.sprite.destroy();
        existing.delete(id);
      }
    }
  }, [doc.elements, textures, levelAlphas.length, app]);

  // ── 素材层 · 第三步：权重（与区块层同一份 levelAlphas，因此同呼吸）──
  //
  // 依赖里同样必须有 app，理由与区块层的权重 effect 完全一致（见上方注释）：
  // 少了它，素材的层级容器会一直停在默认 alpha 1，也就是"所有层级的素材同时可见"，
  // 层级归属形同虚设 —— 正是用户报的那个"素材没跟着层级走"。
  useEffect(() => {
    elementLayersRef.current.forEach((container, key) => {
      // 层级无关的素材恒为不透明；其余按所属层级的权重淡入淡出
      container.alpha = key === LOOSE_LEVEL_KEY ? 1 : levelAlphas[key] ?? 0;
    });
  }, [levelAlphas, app]);

  // ── 标注层 · 第一步：视口缩放（只改每个 Text 的 scale，不重建）──
  //
  // 【必须声明在同步 effect **之前**】两个 effect 在同一提交里都会跑，执行顺序
  // 就是声明顺序：先更新 ref 里的当前缩放，后面同步新建的 `Text` 才能立刻拿到
  // 正确的 `1/scale`。反过来（先同步后改 ref）新标注会以"字号 12 世界单位"的
  // 原始尺寸出现一帧，也就是在屏幕上被放大 `scale` 倍 —— 缩到郡那一级时
  // 会看到一行横贯画面的巨字。
  //
  // 【为什么只改 scale，不把 labelLayer 挪到 world 之外】挪出去就得每格用
  // `worldToScreen` 改写 300 个 position（更贵，且坐标换算散到渲染层）；
  // 改 scale 只是一个标量赋值，Pixi 的变换是懒计算的。
  useEffect(() => {
    labelScaleRef.current = viewport.scale;
    // 子图结构 effect（声明在本条之后）建节点时要一个"当前缩放"，见 `viewportScaleRef`
    viewportScaleRef.current = viewport.scale;
    setLabelScale(labelHandlesRef.current.values(), viewport.scale);
  }, [viewport.scale, app]);

  // ── 标注层 · 第二步：内容同步（层级容器 + 按 id 增量增删）──
  //
  // 依赖里没有 `viewport.scale`：视口变化绝不能触发全量同步（见上一条）。
  // `levelAlphas.length` 必须在：层级数变了要重建容器分组。
  useEffect(() => {
    const root = labelLayerRef.current;
    if (!root) return;
    labelHandlesRef.current = syncLabels(root, labels, levelAlphas.length);
    // 新建的 Text 默认 scale = 1，这里补一次屏幕恒定字号（用 ref 里的当前缩放）
    setLabelScale(labelHandlesRef.current.values(), labelScaleRef.current);
  }, [labels, levelAlphas.length, app]);

  // ── 标注层 · 第三步：权重（与区块、素材共用同一份 levelAlphas，因此同呼吸）──
  //
  // 依赖里必须有 app，理由与区块层、素材层的权重 effect 完全一致
  // （见上方 `:506` 那段注释）：少了它，层级容器会一直停在默认 alpha 1，
  // 也就是"所有层级的地名同时可见"，层级归属形同虚设。
  useEffect(() => {
    const root = labelLayerRef.current;
    if (!root) return;
    applyLabelWeights(root, levelAlphas);
  }, [levelAlphas, app]);

  // ── 嵌套子地图 · 第一步：结构同步（只随「区块 + 子图」变化，增量增删子树）──
  //
  // 【为什么结构同步与权重同步拆成两个 effect】
  // 子树的结构（区块有没有 submap、贴合变换怎么算）只随 `doc.regions` 变；
  // 而渐入权重随 `viewport.scale` 高频变。若合在一个 effect、依赖里塞 viewport，
  // 滚轮每格都会整棵重建子树（mask Graphics + 子图分区 + 海岸烘焙全部重来一遍）——
  // 违反「视口变化不重建几何」的底线。拆开后：结构只在数据变时建一次，
  // 缩放只走 `handle.sync()`（改几个 alpha 与一次标注缩放）。
  //
  // 【为什么用「子图对象引用」判断要不要重建】`doc` 是不可变更新，重新圈定 / 撤销
  // 重做都会给出**新的** `submap` 对象；引用没变就等于内容没动。早期只判断
  // 「这个区块有没有节点」，于是重新圈定之后画面还停在旧分区上（不报错、不刷新）。
  useEffect(() => {
    const layer = submapLayerRef.current;
    if (!layer) return;

    const existing = submapNodeByIdRef.current;
    const seen = new Set<string>();

    for (const region of doc.regions) {
      if (!region.submap) continue;
      seen.add(region.id);

      const prev = existing.get(region.id);
      if (prev && prev.submap === region.submap) continue;

      // 内容变了（重新圈定 / 撤销重做 / 剥离子图后再绑）：整棵重建
      if (prev) {
        layer.removeChild(prev.container);
        prev.destroy();
        existing.delete(region.id);
      }

      const handle = buildSubmapNode(
        layer,
        region,
        viewportScaleRef.current,
        submapEnvRef,
      );
      if (handle) existing.set(region.id, handle);
    }

    // 移除已删除/已剥离子图的区块对应子树
    for (const [id, handle] of existing) {
      if (seen.has(id)) continue;
      layer.removeChild(handle.container);
      handle.destroy();
      existing.delete(id);
    }
  }, [doc.regions, app]);

  // ── 嵌套子地图 · 第二步：权重同步（视口缩放只改 alpha，不重建）──
  //
  // 两件事一起做，但都是"改浮点数"级别的成本：
  //   ① 子图整体渐入权重 `submapEnterWeight(父图缩放, 阈值)`；
  //   ② 子图**内部**的层级权重（用它自己的等效缩放查它自己的 levelAlphas）。
  // ② 是「缩进去逐级显露洲/国家/郡」的全部来源 —— 少了它，子图内部所有层级会
  // 同时全亮，看起来像一堆叠在一起的分区线。
  useEffect(() => {
    const existing = submapNodeByIdRef.current;
    if (existing.size === 0) return;
    for (const handle of existing.values()) handle.sync(viewport.scale);
  }, [viewport.scale, doc.regions, app]);

  // ── 嵌套子地图 · 第三步：纹理/渲染器晚到 → 补烘一次海岸 ──
  //
  // 依赖 `textures` / `app`：子图可能在纹理加载完之前就建好了（打开即有子图），
  // 那时 `bake` 拿不到渲染器与纸纹，只能停在"隐藏"。这个 effect 让它在资源到位后
  // 补一次 —— 否则用户会看到"子图有分区线但底下一片空白"。
  useEffect(() => {
    submapEnvRef.current = {
      renderer: app?.renderer ?? null,
      textures,
      baseResolution: bakeResolution,
    };
    for (const handle of submapNodeByIdRef.current.values()) handle.refreshCoast();
  }, [app, textures, bakeResolution]);

  // ── 视口变换（每次 viewport 变化只改 world 容器的两个属性）──
  useEffect(() => {
    const world = worldRef.current;
    if (!world || size.width === 0) return;
    world.scale.set(viewport.scale);
    world.position.set(
      size.width / 2 - viewport.x * viewport.scale,
      size.height / 2 - viewport.y * viewport.scale,
    );
  }, [viewport, size, app]);

  // ── 视口粗剔除（B5 / PRD §6.6.1）──
  //
  // 【坐标系】比较的两边都在**屏幕空间**：视野框是画布矩形（`screenCullRect`），
  // 包围盒是容器局部矩形经 `toGlobal` 现算出的舞台矩形（见 `cull.ts` 文件头）。
  // 缓存的是**局部**矩形（与视口无关），所以视口怎么变都不会读到旧变换的结果。
  //
  // 【为什么按"层级容器"粗剔，不做逐块】逐块要遍历 600 个多边形、每个算一次
  // 相交，省下的绘制反而更少 —— 同一层级的区块在屏幕上本来就成簇出现。
  //
  // ⚠️ **绝不剔除 `coast` / `staticLayer` / `overlay`**：
  //   · `staticLayer` 是整张纸（全屏且被缓存）；把缓存节点 `visible = false`
  //     会让下一次 `updateCacheTexture()` 烤出一张空纹理 —— 之后即使恢复可见也是白的；
  //   · `coast` 与 `overlay` 都是全幅内容，判了也永远是"相交"，白花一次遍历。
  //   这里只遍历三层里**按层级分出来的子容器**，父容器本身不碰。
  //
  // 【为什么还要 `enableCulling` 开关】剔除改的是 `visible`，与"层级权重 / 子节点数"
  // 这类断言混在一个用例里时，谁把谁弄红了很难分辨。渲染断言里显式关掉，
  // 剔除自身另有专门的用例（关闭时必须把 `visible` 复原，而不是一关了事）。
  useEffect(() => {
    const regionLayer = regionLayerRef.current;
    const elementLayer = elementLayerRef.current;
    const labelLayer = labelLayerRef.current;
    if (!regionLayer || !elementLayer || !labelLayer) return;

    // 三层各自的层级容器 —— 直接读 `children` 而不是各存一份列表：
    // 层级容器由上面几个 effect 增删，另存一份就是第二处需要同步的状态。
    const levelContainers: Container[] = [
      ...levelLayersRef.current.map((lv) => lv.container),
      // 折线的层级容器（B4-2）：与区块、素材同一档，整层剔除
      ...polylineLayersRef.current.values(),
      ...elementLayersRef.current.values(),
      ...labelLayer.children,
      // 子图子树：整棵一票（视口外整棵剪掉，进视野才画）。
      // 【为什么可以按"整棵"剔】子图内容被 clipMask 限制在区块多边形内，
      // 它的包围盒就是那块地；逐层递归下去省下的绘制还不够付自己的遍历成本。
      ...(submapLayerRef.current?.children ?? []),
    ];

    if (!enableCulling) {
      // 关掉剔除要把上一轮写下的 `visible` **复原**：写 false 很容易，
      // 忘了复原就是"某几层永久隐身"，且只在"先开过后关"的顺序下复现。
      for (const container of levelContainers) container.visible = true;
      cullCacheRef.current.clear();
      cullContentRef.current = null;
      return;
    }

    // 内容变了才清包围盒缓存：视口变化（滚轮每一格、拖拽每一帧）复用上一轮结果。
    const fingerprint = cullContentRef.current;
    const contentChanged =
      fingerprint === null ||
      fingerprint.regions !== doc.regions ||
      fingerprint.elements !== doc.elements ||
      fingerprint.labels !== labels ||
      fingerprint.polylines !== polylines ||
      fingerprint.levelCount !== levelAlphas.length;
    if (contentChanged) {
      cullContentRef.current = {
        regions: doc.regions,
        elements: doc.elements,
        labels,
        polylines,
        levelCount: levelAlphas.length,
      };
      cullCacheRef.current.clear();
    }

    // 画布还没有尺寸时包围盒全是相对原点的点，判"相交"没有意义，直接跳过
    if (size.width === 0 || size.height === 0) return;
    cullLayers(levelContainers, screenCullRect(size, viewport), cullCacheRef.current);
  }, [
    viewport,
    size,
    enableCulling,
    app,
    doc.regions,
    doc.elements,
    labels,
    polylines,
    levelAlphas.length,
  ]);

  // ── 选中态（Graphics 重绘）──
  //
  // 绘制本身在 `drawOverlay` 里（导出后要复用它，见该函数的注释）；
  // 这个 effect 只负责"什么时候重画"：选中项 / 素材 / 层级权重 / 场景就绪
  // 任一变化都要重画。`app` 必须在依赖里 —— 首次挂载时 `overlay` 还是 null，
  // 只依赖选中项的话，"打开编辑器时已经选中了某个素材"这种情况永远画不出框。
  useEffect(() => {
    if (!app) return;
    drawOverlayRef.current();
  }, [drawOverlay, app]);

  // ── 指针事件 ──

  /** 事件对象只用到 clientX/clientY：收窄成最小结构，pointer / mouse / wheel 事件通用 */
  const getLocalPoint = useCallback((e: { clientX: number; clientY: number }) => {
    const host = hostRef.current;
    if (!host) return { x: 0, y: 0 };
    const rect = host.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  /**
   * 屏幕 → 世界。
   *
   * 【换算只说一遍】以前这里手写了一遍 `screenToWorld` 的公式，与 `coords.ts`
   * 各维护一份 —— 改任一处都会让"点在哪、落哪"错位，且错误是渐进的（缩放越小
   * 偏得越远），排查成本极高。现在一律转调 `coords.ts`。
   */
  const worldAt = useCallback(
    (screen: { x: number; y: number }) => screenToWorld(screen, viewport, size),
    [size, viewport],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const local = getLocalPoint(e);

      // ── 画区态 / 折线绘制态：闭合判定全部落在 pointerdown ────────────────
      //
      // 【为什么必须在这里而不是 dblclick】`dblclick` 是浏览器在**两次 down/up
      // 之后**才派发的事件 —— 那时顶点已经落下了。旧实现只能事后补救，症状是
      // "双击收尾多出一个顶点"或"双击首顶点后残留一个孤立点"。在 down 里判，
      // 第二次 down 根本不会进入落点分支（`gesture` 保持 none，pointerup 不会
      // 再回调 `onCanvasClickWorld`）。
      //
      // 判定顺序（短路）：
      //   ① 双击 —— 与上一次 down 的时间差 < DRAFT_DOUBLE_CLICK_MS 且屏幕距离
      //      在 DRAFT_CLOSE_PX 内 ⇒ 收尾，**不落点**；
      //   ② 命中首顶点 —— 已落 ≥3 点且本次 down 落在首顶点的命中圈内 ⇒ 闭合，
      //      **不落点**（只有画区态有这一条：折线 v1 只画开链）；
      //   ③ 都不是 ⇒ 走下面的原有逻辑，由 pointerup 落点（页面里的同点去重仍在）。
      //
      // ⚠️ 为什么落点不在 down 里做：两种绘制态都仍然允许"拖空白平移"，落点放在
      // down 会让每次拖动都先撒一个顶点。down 只负责**判定**，up 才负责**提交**。
      const polylineDrawing = polylineDraft !== null;
      if (drafting || polylineDrawing) {
        const world = worldAt(local);
        const px = 1 / Math.max(1e-6, viewport.scale);
        const at = Number.isFinite(e.timeStamp) && e.timeStamp > 0 ? e.timeStamp : performance.now();
        const prev = lastDownRef.current;
        // 先记下这次 down：即使下面命中了闭合分支也要记 ——
        // 双击的**第二下**正是靠"上一笔就是第一下"才被判成双击的。
        // （如果命中 ① 之后把它清空，第二下就会落点，孤立顶点又回来了。）
        lastDownRef.current = { at, world };

        const isDouble =
          prev !== null &&
          // `at >= prev.at` 是时钟护栏：`e.timeStamp` 与 `performance.now()` 在
          // 浏览器里同源（都是"导航起点的毫秒数"），但测试环境可能只提供其中一个；
          // 万一拿到倒流的时刻，负差值会让"每次点击都算双击"——宁可判成不是双击。
          at >= prev.at &&
          at - prev.at < DRAFT_DOUBLE_CLICK_MS &&
          Math.hypot(world.x - prev.world.x, world.y - prev.world.y) <= DRAFT_CLOSE_PX * px;
        const hitsFirst =
          drafting &&
          draftPoints !== null &&
          draftPoints.length >= 3 &&
          Math.hypot(world.x - draftPoints[0].x, world.y - draftPoints[0].y) <=
            DRAFT_CLOSE_PX * px;

        if (isDouble || hitsFirst) {
          // ① 双击命中后**清掉上一笔**：草稿已空，下一次点击必须是"新多边形的
          //    第一个顶点"。留着它会让 350ms 内在同一处的第三下又被判成双击、
          //    被静默吞掉（表现：新多边形的第一个点点了没反应）。
          //    ② 命中首顶点时则**必须保留** —— 紧接着的第二下要靠它判双击。
          if (isDouble) lastDownRef.current = null;
          gesture.current = { kind: "none" };
          // 两种绘制态共用一个"收尾"判定，落库交给各自的页面分支
          if (drafting) onDraftClose?.();
          else onPolylineDraftFinish?.();
          return;
        }
      } else {
        // 非绘制态不留双击历史：切走再切回来时，"上一次 down"早已过期，
        // 留着只会让进模式后的第一下被误判成双击。
        lastDownRef.current = null;
      }

      // 折线节点拖动（B4-2）：比素材命中更优先 —— 节点是一个 8px 的小目标，
      // 且只在自己被选中时存在；若排在素材之后，一个压在线上的素材会抢走手柄。
      if (!drafting && !polylineDrawing && selectedPolylineId && !polylinesLocked) {
        const line = polylines.find((p) => p.id === selectedPolylineId);
        if (line) {
          const world = worldAt(local);
          const tol = POLYLINE_NODE_HIT_PX / Math.max(1e-6, viewport.scale);
          // 从后往前找：后落的点压在前面的点之上，重叠时抓上面那个
          for (let i = line.points.length - 1; i >= 0; i -= 1) {
            const p = line.points[i];
            if (Math.hypot(world.x - p.x, world.y - p.y) <= tol) {
              gesture.current = { kind: "polyline", index: i };
              onPolylineNodeDragStart?.();
              return;
            }
          }
        }
      }

      // 左键按在已选中元素上 = 拖拽该元素，否则 = 平移画布
      //
      // ⚠️ 绘制态下**不做**素材命中：左键在那时的语义只有"落一个顶点"。
      // 否则按在一个已选中的素材上会变成拖素材（还顺带进撤销栈），而用户以为
      // 自己在画的第一个点根本没落下 —— 表现为"绘制模式下点哪儿都没反应"。
      if (!drafting && !polylineDrawing && selectedId && !elementLocked) {
        const world = worldAt(local);
        const el = doc.elements.find((x) => x.id === selectedId);
        const def = el ? SPRITE_MAP[el.spriteId] : undefined;
        if (
          el &&
          def &&
          // 尺寸三处之三：命中区与绘制尺寸必须是同一个数（否则"点得中的地方看不见、
          // 看见的地方点不中"）。因子与精灵同步用的是同一个 `elementSizeFactor`。
          hitTestElement(world, {
            x: el.x,
            y: el.y,
            width: def.baseWidth,
            height: def.baseHeight,
            scale: el.scale * elementSizeFactor(el.level, levelAlphas.length),
          })
        ) {
          // 记录按下的世界坐标：后续按增量移动，抓取点不会跳
          gesture.current = { kind: "drag", lastWorld: world };
          onElementDragStart();
          return;
        }
      }

      gesture.current = { kind: "pan", lastX: e.clientX, lastY: e.clientY, travel: 0 };
    },
    [
      drafting,
      polylineDraft,
      draftPoints,
      onDraftClose,
      onPolylineDraftFinish,
      viewport.scale,
      selectedId,
      elementLocked,
      selectedPolylineId,
      polylinesLocked,
      polylines,
      doc.elements,
      levelAlphas,
      getLocalPoint,
      worldAt,
      onElementDragStart,
      onPolylineNodeDragStart,
    ],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // 绘制态（画区 / 折线）：光标预览点只进 ref 并直接重画草稿层 ——
      // 不触发任何 React 提交。（这条在 `handlePointerUp` 之前，因为一次
      // "拖动平移"里也会持续 mousemove。）
      if (drafting || polylineDraft !== null) {
        draftCursorRef.current = worldAt(getLocalPoint(e));
        drawDraftRef.current();
      }

      const g = gesture.current;
      if (g.kind === "pan") {
        const dx = e.clientX - g.lastX;
        const dy = e.clientY - g.lastY;
        if (dx === 0 && dy === 0) return;
        g.lastX = e.clientX;
        g.lastY = e.clientY;
        // 累计位移判定"是否算拖拽"，避免慢速拖动被误判为单击
        g.travel += Math.abs(dx) + Math.abs(dy);
        onPan(dx, dy);
      } else if (g.kind === "drag") {
        const world = worldAt(getLocalPoint(e));
        const dxWorld = world.x - g.lastWorld.x;
        const dyWorld = world.y - g.lastWorld.y;
        if (dxWorld === 0 && dyWorld === 0) return;
        g.lastWorld = world;
        onElementDragDelta(dxWorld, dyWorld);
      } else if (g.kind === "polyline") {
        // 节点用**绝对坐标**而不是增量：控制点没有"锚点偏移"的语义
        // （素材是底部锚点，必须保持抓取点相对位置；点就是点）。
        onPolylineNodeMove?.(g.index, worldAt(getLocalPoint(e)));
      }
    },
    [
      drafting,
      polylineDraft,
      onPan,
      onElementDragDelta,
      onPolylineNodeMove,
      worldAt,
      getLocalPoint,
    ],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const g = gesture.current;
      gesture.current = { kind: "none" };
      // 只有「几乎没移动过的平移手势」才算单击，且必须换算成世界坐标
      if (g.kind === "pan" && g.travel <= CLICK_SLOP && e.button === 0) {
        onCanvasClickWorld(worldAt(getLocalPoint(e)));
      }
    },
    [onCanvasClickWorld, worldAt, getLocalPoint],
  );

  /**
   * 双击标注 → 请求编辑。
   *
   * 【为什么用原生 dblclick 而不是在 pointerup 里数点击次数】浏览器已经处理好了
   * 双击间隔与移动容差（系统设置里调过的那套），自己数会与用户预期不一致。
   * 地名编辑是"选中式"操作，误判的代价只是多开一次输入框 —— 交给浏览器最省事。
   *
   * 【画区态直接不响应】草稿的闭合判定已经整体搬到 `handlePointerDown`（见那里
   * 的注释），`dblclick` 不再是闭合的第二条路径。这里留一个显式 return 而不是
   * "依靠闭合后草稿恰好为空"，是因为**空草稿画区态**（刚进模式 / 刚闭合完）依然
   * 会走到这里 —— 那时双击画布不该弹出地名编辑框。
   *
   * 【为什么回调给屏幕坐标】编辑框是 DOM `<input>`，活在 CSS 像素空间里；
   * `worldToScreen` 是唯一权威换算（AGENTS 硬约定 1），在这里做掉，
   * 页面只管绝对定位。
   */
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // 绘制态不响应：收尾判定已在 `pointerdown` 里做（见那里的注释），
      // 这里再判一次会让"双击收尾"顺带弹出一个地名输入框。
      if (drafting || polylineDraft !== null) return;
      const world = worldAt(getLocalPoint(e));
      const px = 1 / Math.max(1e-6, viewport.scale);

      // ── 选中折线的双击：节点上 = 删点，线上 = 插点（B4-2）──
      //
      // 【为什么节点优先】节点几乎总是落在线段附近（端点尤其如此）：先判线段的
      // 话，双击端点会变成"在旁边插一个点"，而用户想删掉它。
      if (selectedPolylineId && !polylinesLocked) {
        const line = polylines.find((p) => p.id === selectedPolylineId);
        if (line) {
          let removed = false;
          for (let i = line.points.length - 1; i >= 0; i -= 1) {
            const p = line.points[i];
            if (Math.hypot(world.x - p.x, world.y - p.y) <= POLYLINE_NODE_HIT_PX * px) {
              onPolylinePointDelete?.(i);
              removed = true;
              break;
            }
          }
          if (removed) return;

          // 与 drawPolyline / pickPolyline 同一条退化守卫：<3 点的闭环按开链算
          const closed = line.closed && line.points.length >= 3;
          const near = nearestOnPath(smoothPolyline(line.points, closed), world, closed);
          if (near) {
            const style = polylineStyleOf(line.styleId, line.kind);
            const width = effectiveWidthWorld(style, line.widthScale, viewport.scale);
            if (near.distance <= width / 2 + POLYLINE_PICK_PAD_PX * px) {
              // 插在"最近采样段所属的两个控制点之间"；位置用**线上最近点**，
              // 而不是鼠标位置 —— 否则新点会把线拽出一个小尖角
              onPolylinePointInsert?.(controlIndexFor(near.pathIndex), near.point);
              return;
            }
          }
        }
      }

      if (!onLabelEditRequest) return;
      // 地名层锁定：双击不该进编辑（锁的语义就是"别动这一层"）
      if (labelLocked) return;
      const hit = labelAt(labels, levelAlphas, world);
      if (!hit) return;
      onLabelEditRequest(hit.id, worldToScreen(hit, viewport, size));
    },
    [
      drafting,
      polylineDraft,
      onLabelEditRequest,
      labelLocked,
      labels,
      levelAlphas,
      worldAt,
      getLocalPoint,
      viewport,
      size,
      selectedPolylineId,
      polylinesLocked,
      polylines,
      onPolylinePointDelete,
      onPolylinePointInsert,
    ],
  );

  // ── 滚轮（原生监听，passive:false 才能 preventDefault）──
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      onWheel(e.deltaY, getLocalPoint(e as unknown as PointerEvent));
    };
    host.addEventListener("wheel", onNativeWheel, { passive: false });
    return () => host.removeEventListener("wheel", onNativeWheel);
  }, [onWheel, getLocalPoint]);

  return (
    <div
      ref={hostRef}
      className="map-canvas"
      style={{
        // 画区模式的指针语义是"放点"，十字星比抓手准确（抓手会让人以为能拖动画面）
        cursor: drafting || pendingSpriteId ? "crosshair" : "grab",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={handleDoubleClick}
    >
      {!texturesReady && <div className="map-canvas__loading">素材加载中…</div>}
    </div>
  );
}
