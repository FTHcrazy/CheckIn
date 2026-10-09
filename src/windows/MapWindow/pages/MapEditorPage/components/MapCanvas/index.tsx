import { useCallback, useEffect, useRef, useState } from "react";
import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";
import { BASE_IMAGE, SPRITE_MAP } from "../../sprites";
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
 * 地图画布（PixiJS / WebGL 渲染）。
 *
 * 【架构】单一 viewport 事实源 → 驱动一个 Pixi 场景图根容器：
 *   stage
 *   └─ world            ← 承载 viewport 变换（position + scale）
 *      ├─ baseSprite    底图
 *      ├─ elementLayer  素材精灵（按放置顺序，后放盖上层）
 *      └─ overlayLayer  选中框等交互指示（Graphics）
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
  const baseRef = useRef<Sprite | null>(null);
  const elementLayerRef = useRef<Container | null>(null);
  const overlayRef = useRef<Graphics | null>(null);
  /** 实例 id → 精灵，增量同步用（避免每帧重建全部精灵） */
  const spriteByIdRef = useRef<Map<string, Sprite>>(new Map());

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
        background: 0x1b2620,
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
      const baseSprite = new Sprite();
      const elementLayer = new Container();
      const overlay = new Graphics();
      world.addChild(baseSprite, elementLayer, overlay);
      instance.stage.addChild(world);

      worldRef.current = world;
      baseRef.current = baseSprite;
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
      baseRef.current = null;
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
