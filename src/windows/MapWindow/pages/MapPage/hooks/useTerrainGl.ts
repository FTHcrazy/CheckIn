/**
 * WebGL 地形层生命周期 Hook（AGENTS.md 6.2.1 Hook 分层）
 *
 * 职责：
 * - 创建 / 销毁 TerrainRenderer（GL 上下文、program、贴图）
 * - 视口 / 地形 / 尺寸变化时请求重绘；动画开关决定是否跑 rAF
 * - **任何 GL 失败都必须在同帧降级**：置 ready=false 让调用方走 Canvas2D，
 *   绝不把「一片空白的画布」留在界面上
 *
 * 三条硬约束（都由实测踩坑反推而来，勿回退）：
 * 1. **一个渲染器一个 canvas**：本 hook 自己 `document.createElement("canvas")` 挂到
 *    glHostRef 下，卸载即 `remove()`。原因是 Pixi 的 `GlContextSystem.destroy` 会强制
 *    `loseContext()`，若沿用 React 渲染的同一个 canvas，StrictMode 的「挂载→卸载→再挂载」
 *    会让第二个实例拿到已丢失的上下文。
 * 2. **每帧 try/catch**：draw 抛错（shader/几何不匹配、上下文丢失）时立刻停表并降级，
 *    避免「每帧重建 shader」把主线程占满导致整窗无响应。
 * 3. **动画按 30fps 节流 + 隐藏时停表**：地形流动是慢速效果，30fps 无感知差异，
 *    但 GPU 负载减半；窗口不可见时完全不画。
 *
 * 不负责：Canvas2D 标注层绘制与任何交互（见 MapCanvas）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { BuiltWorld } from "../map-terrain";
import { createTerrainRenderer, type TerrainRenderer } from "../map-gl";

export interface UseTerrainGlParams {
  /** GL canvas 挂载点（本 hook 会往里塞一个自建 canvas） */
  glHostRef: React.RefObject<HTMLDivElement | null>;
  /** 尺寸参照容器（CSS px，通常是 .cv） */
  hostRef: React.RefObject<HTMLElement | null>;
  world: BuiltWorld | null;
  viewport: { tx: number; ty: number; scale: number };
  /** 是否运行流动动画（指针进入画布 + 开关打开） */
  animate: boolean;
}

export interface UseTerrainGlResult {
  /** GL 地形层是否可用（false 时调用方必须走 Canvas2D 回退） */
  ready: boolean;
  /** 同步一次重绘（供外部在非 React 时序下主动触发） */
  requestDraw: () => void;
}

/** 动画帧间隔下限（30fps）：慢速流动足够，GPU 负载减半 */
const MIN_ANIM_FRAME_MS = 1000 / 30;
/** 连续慢帧阈值：超过则把 DPR 降一档（弱显卡自保） */
const SLOW_FRAME_MS = 22;
const SLOW_FRAME_STREAK = 20;

export function useTerrainGl(params: UseTerrainGlParams): UseTerrainGlResult {
  const { glHostRef, hostRef, world, viewport, animate } = params;
  const [ready, setReady] = useState(false);
  /** 一旦失败就永久回退，不再尝试重建 GL（避免失败循环把 CPU 吃满） */
  const [failed, setFailed] = useState(false);
  const rendererRef = useRef<TerrainRenderer | null>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const lastPaintRef = useRef(0);
  const slowStreakRef = useRef(0);
  const dprCapRef = useRef<number | null>(null);
  const animateRef = useRef(animate);
  const viewportRef = useRef(viewport);

  useEffect(() => {
    animateRef.current = animate;
  }, [animate]);
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  /** 失败 → 停表 + 释放 + 降级（幂等） */
  const fail = useCallback((err: unknown) => {
    console.error("[map-gl] 地形层不可用，已回退 Canvas2D：", err);
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const renderer = rendererRef.current;
    rendererRef.current = null;
    renderer?.dispose();
    setReady(false);
    setFailed(true);
  }, []);

  // rAF 续帧需要引用 tick 自身；经 ref 间接持有，避免「声明前访问」与渲染期写 ref
  const tickRef = useRef<(() => void) | null>(null);

  /** 单帧执行；animate 时按 30fps 节流续帧，否则画完即停（静止不空转） */
  const tick = useCallback(() => {
    rafRef.current = null;
    const renderer = rendererRef.current;
    const host = hostRef.current;
    if (!renderer || !host) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

    const now = performance.now();
    const animating = animateRef.current;
    // 动画节流：距上次成帧不足半帧间隔时跳过本轮绘制，仅排下一帧
    const due = !animating || now - lastPaintRef.current >= MIN_ANIM_FRAME_MS - 4;
    if (due) {
      try {
        if (renderer.isLost()) throw new Error("GL context lost");
        if (startRef.current === 0) startRef.current = now;
        const dpr = Math.min(window.devicePixelRatio || 1, dprCapRef.current ?? 1.5);
        renderer.resize(host.clientWidth, host.clientHeight, dpr);
        renderer.draw(viewportRef.current, {
          time: (now - startRef.current) / 1000,
          animate: animating,
        });
        lastPaintRef.current = now;
        // 弱显卡自保：连续慢帧则降一档 DPR（只降一次）
        if ((dprCapRef.current ?? 1.5) > 1) {
          slowStreakRef.current = performance.now() - now > SLOW_FRAME_MS ? slowStreakRef.current + 1 : 0;
          if (slowStreakRef.current >= SLOW_FRAME_STREAK) {
            dprCapRef.current = 1;
            slowStreakRef.current = 0;
          }
        }
      } catch (err) {
        fail(err);
        return;
      }
    }
    if (animating) {
      rafRef.current = requestAnimationFrame(() => {
        const fn = tickRef.current;
        if (fn) fn();
      });
    }
  }, [hostRef, fail]);

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  const requestDraw = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  // ── 渲染器生命周期：自建 canvas，一实例一画布（Pixi dispose 会 loseContext）──
  useEffect(() => {
    const glHost = glHostRef.current;
    if (!glHost || failed) return;
    const canvas = document.createElement("canvas");
    canvas.className = "cv__gl-canvas";
    glHost.appendChild(canvas);

    let cancelled = false;
    let instance: TerrainRenderer | null = null;
    createTerrainRenderer(canvas)
      .then((renderer) => {
        if (cancelled) {
          renderer?.dispose();
          return;
        }
        if (!renderer) {
          fail(new Error("createTerrainRenderer 返回 null"));
          return;
        }
        instance = renderer;
        rendererRef.current = renderer;
        startRef.current = 0;
        slowStreakRef.current = 0;
        dprCapRef.current = null;
        setReady(true);
        requestDraw();
      })
      .catch((err) => {
        if (!cancelled) fail(err);
      });

    return () => {
      cancelled = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      instance?.dispose();
      rendererRef.current = null;
      canvas.remove();
    };
  }, [glHostRef, failed, fail, requestDraw]);

  // ── 地形数据变更 → 重传贴图（依赖 ready：Pixi 就绪前 renderer 尚不存在）──
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !world) return;
    try {
      renderer.setWorld(world);
    } catch (err) {
      fail(err);
      return;
    }
    requestDraw();
  }, [world, ready, requestDraw, fail]);

  // ── 视口 / 动画开关变更 → 重绘 ──
  useEffect(() => {
    requestDraw();
  }, [viewport, animate, requestDraw]);

  // ── 容器尺寸变化 → 重绘（静止帧也需要重画，否则画布被拉伸）──
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => requestDraw());
    ro.observe(host);
    return () => ro.disconnect();
  }, [hostRef, requestDraw]);

  // ── 窗口重新可见 → 补一帧（隐藏期间 tick 直接 return，不会续帧）──
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") requestDraw();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [requestDraw]);

  return { ready: ready && !failed, requestDraw };
}
