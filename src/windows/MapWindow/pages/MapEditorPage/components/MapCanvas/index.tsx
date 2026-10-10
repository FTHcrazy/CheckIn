import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";
import { BASE_IMAGE, SPRITE_MAP } from "../../sprites";
import {
  REGION_BORDER_ALPHA,
  REGION_BORDER_COLOR,
  REGION_BORDER_PX,
  REGION_FILL_ALPHA,
} from "../../regions";
import type { MapDocument } from "../../types";
import { hitTestElement, type CanvasSize, type Viewport } from "../../coords";
import type { TextureMap } from "../../hooks/useTextureCache";
import "./index.scss";

interface MapCanvasProps {
  doc: MapDocument;
  viewport: Viewport;
  textures: TextureMap;
  texturesReady: boolean;
  selectedId: string | null;
  /** 待放置素材：非空时点击画布为"落位"而非"选择" */
  pendingSpriteId: string | null;
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
 */
const BORDER_WIDTH_QUANTIZE = 1.06;

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

/** 一个层级的渲染容器：填充与边界分两份 Graphics，边界按需重建、填充只建一次 */
interface LevelLayers {
  container: Container;
  fill: Graphics;
  border: Graphics;
}

/** 缺省权重（不画任何区块）。用模块级常量避免每次渲染都造一个新数组引用。 */
const NO_LEVELS: number[] = [];

/**
 * 地图画布（PixiJS / WebGL 渲染）。
 *
 * 【架构】单一 viewport 事实源 → 驱动一个 Pixi 场景图根容器：
 *   stage
 *   └─ world            ← 承载 viewport 变换（position + scale）
 *      ├─ sheetShadow   图纸投影（底图之下，撑起四周留白）
 *      ├─ baseSprite    底图
 *      ├─ regionLayer   区块层（容器，内部按层级分若干子容器）
 *      │   ├─ L0 容器     ├─ 填充 Graphics
 *      │   │              └─ 边界 Graphics  ← 屏幕恒定线宽
 *      │   └─ L1 / L2 / L3 …（同上）
 *      ├─ elementLayer  素材精灵（按放置顺序，后放盖上层）
 *      └─ overlayLayer  选中框等交互指示（Graphics）
 *
 * 区块层为什么按"层级的容器"而不是"一个 Graphics"：
 * 无极缩放要求相邻两级**同时可见**、此消彼长（见 lod.ts）。把权重落在容器 alpha
 * 上，滚轮每一格就只是改几个浮点数；若把 alpha 烘进 Graphics 的填充/描边样式，
 * 每滚一格都要重建两百多个多边形的几何，帧率立刻塌。层级容器本身还能顺手把
 * 线宽重建的频率从"每格"降到"每跨一档"。
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
  levelAlphas = NO_LEVELS,
  onSizeChange,
  onWheel,
  onPan,
  onCanvasClickWorld,
  onElementDragStart,
  onElementDragDelta,
}: MapCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [app, setApp] = useState<Application | null>(null);
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 });

  /** 场景图层（ref 持有，避免 effect 依赖抖动） */
  const worldRef = useRef<Container | null>(null);
  const sheetRef = useRef<Graphics | null>(null);
  const baseRef = useRef<Sprite | null>(null);
  const regionLayerRef = useRef<Container | null>(null);
  /** 每个层级一份「容器 + 填充 + 边界」，索引即层级序号 */
  const levelLayersRef = useRef<LevelLayers[]>([]);
  const elementLayerRef = useRef<Container | null>(null);
  const overlayRef = useRef<Graphics | null>(null);
  /** 实例 id → 精灵，增量同步用（避免每帧重建全部精灵） */
  const spriteByIdRef = useRef<Map<string, Sprite>>(new Map());

  /**
   * 线宽用的量化缩放。
   *
   * 用 `useMemo` 缓存：缩放连续变化时它只在跨档那一刻换值，
   * 于是下面的边界重建 effect 不会因为滚轮每一格都跑一遍。
   */
  const borderScale = useMemo(() => quantizeScale(viewport.scale), [viewport.scale]);

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
  >({ kind: "none" });
  /** 超过该累计位移即视为拖拽而非单击（PRD §4.7） */
  const CLICK_SLOP = 4;

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
      const sheet = new Graphics();
      const baseSprite = new Sprite();
      // 区块层本身是个容器：真正的内容按层级分成若干子容器（见下方各 effect），
      // 这样"交叉淡化"只需要改子容器的 alpha，不必重建任何几何。
      const regionLayer = new Container();
      const elementLayer = new Container();
      const overlay = new Graphics();
      world.addChild(sheet, baseSprite, regionLayer, elementLayer, overlay);
      instance.stage.addChild(world);

      worldRef.current = world;
      sheetRef.current = sheet;
      baseRef.current = baseSprite;
      regionLayerRef.current = regionLayer;
      elementLayerRef.current = elementLayer;
      overlayRef.current = overlay;

      setApp(instance);
      const rect = host.getBoundingClientRect();
      const next = { width: Math.round(rect.width), height: Math.round(rect.height) };
      setSize(next);
      onSizeChangeRef.current(next);
    })();

    return () => {
      disposed = true;
      spriteByIdRef.current.clear();
      worldRef.current = null;
      sheetRef.current = null;
      baseRef.current = null;
      regionLayerRef.current = null;
      // 子容器随 world 一起被 destroy(true, {children:true}) 回收，这里只清引用
      levelLayersRef.current = [];
      elementLayerRef.current = null;
      overlayRef.current = null;

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
  }, [app]);

  // ── 底图纹理 ──
  useEffect(() => {
    const baseSprite = baseRef.current;
    if (!baseSprite) return;
    const tex = textures[BASE_IMAGE.id];
    if (tex) {
      baseSprite.texture = tex;
      baseSprite.width = BASE_IMAGE.width;
      baseSprite.height = BASE_IMAGE.height;
      // 底图以世界原点为中心铺开（世界原点在地图中心）
      baseSprite.anchor.set(0.5);
      baseSprite.position.set(0, 0);
    }
  }, [textures, app]);

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
      lv.fill.fill({ color: region.color, alpha: REGION_FILL_ALPHA });
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
        alpha: REGION_BORDER_ALPHA,
        alignment: 0.5,
      });
    }
  }, [doc.regions, borderScale, levelAlphas.length, app]);

  // ── 区块层 · 权重（无极衔接的核心：相邻两级此消彼长）──
  //
  // 上层保证 Σα ≡ 1（见 lod.ts 的帽函数），因此这里逐级赋 alpha 即可，
  // 不存在"过渡带里所有层级都太淡"或"多级叠加发黑"的情况。
  useEffect(() => {
    levelLayersRef.current.forEach((lv, i) => {
      lv.container.alpha = levelAlphas[i] ?? 0;
    });
  }, [levelAlphas]);

  // ── 素材精灵增量同步 ──
  useEffect(() => {
    const layer = elementLayerRef.current;
    if (!layer) return;

    const existing = spriteByIdRef.current;
    const seen = new Set<string>();

    for (const el of doc.elements) {
      seen.add(el.id);
      const def = SPRITE_MAP[el.spriteId];
      const tex = textures[el.spriteId];
      if (!def) continue;

      let sprite = existing.get(el.id);
      if (!sprite) {
        sprite = new Sprite(tex ?? Texture.EMPTY);
        // 锚点：水平居中、垂直底部（贴图"脚底"落在世界 y 上）
        sprite.anchor.set(0.5, 1);
        layer.addChild(sprite);
        existing.set(el.id, sprite);
      }
      if (tex && sprite.texture !== tex) sprite.texture = tex;

      sprite.position.set(el.x, el.y);
      sprite.width = def.baseWidth * el.scale;
      sprite.height = def.baseHeight * el.scale;
      sprite.rotation = (el.rotation * Math.PI) / 180;
    }

    // 移除已删除的元素精灵
    for (const [id, sprite] of existing) {
      if (!seen.has(id)) {
        layer.removeChild(sprite);
        sprite.destroy();
        existing.delete(id);
      }
    }
  }, [doc.elements, textures, app]);

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

  // ── 选中态（Graphics 重绘）──
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.clear();

    if (!selectedId) return;
    const el = doc.elements.find((e) => e.id === selectedId);
    const def = el ? SPRITE_MAP[el.spriteId] : undefined;
    if (!el || !def) return;

    const w = def.baseWidth * el.scale;
    const h = def.baseHeight * el.scale;
    // 元素锚点是底部中心；选中框用世界坐标绘制，随 world 一起缩放
    overlay
      .rect(el.x - w / 2, el.y - h, w, h)
      .stroke({ width: 2, color: 0x5b6cf9, alignment: 0.5 });
  }, [selectedId, doc.elements, viewport.scale, app]);

  // ── 指针事件 ──
  const getLocalPoint = useCallback((e: React.PointerEvent | PointerEvent) => {
    const host = hostRef.current;
    if (!host) return { x: 0, y: 0 };
    const rect = host.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const worldAt = useCallback(
    (screen: { x: number; y: number }) => ({
      x: (screen.x - size.width / 2) / viewport.scale + viewport.x,
      y: (screen.y - size.height / 2) / viewport.scale + viewport.y,
    }),
    [size, viewport],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      const local = getLocalPoint(e);

      // 左键按在已选中元素上 = 拖拽该元素，否则 = 平移画布
      if (selectedId) {
        const world = worldAt(local);
        const el = doc.elements.find((x) => x.id === selectedId);
        const def = el ? SPRITE_MAP[el.spriteId] : undefined;
        if (
          el &&
          def &&
          hitTestElement(world, {
            x: el.x,
            y: el.y,
            width: def.baseWidth,
            height: def.baseHeight,
            scale: el.scale,
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
    [selectedId, doc.elements, getLocalPoint, worldAt, onElementDragStart],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
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
      }
    },
    [onPan, onElementDragDelta, worldAt, getLocalPoint],
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
      style={{ cursor: pendingSpriteId ? "crosshair" : "grab" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {!texturesReady && <div className="map-canvas__loading">素材加载中…</div>}
    </div>
  );
}
