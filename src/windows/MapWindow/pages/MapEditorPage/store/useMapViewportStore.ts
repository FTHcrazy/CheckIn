/**
 * 地图视口 store（模块级 zustand 单例）。
 *
 * 只持有**原始视口状态**（平移 + 缩放）与高频的纯视图动作。LOD 派生
 * （regionScales / levelAlphas / currentLevel / zoomLimits）不落本 store——
 * 它们同时依赖 doc.regions、viewport、canvasSize 三者，放在 facade
 * （useMapEditor）里用 useMemo 派生，避免把派生值写进 store 造成
 * 「源变一次、派生算两遍」的不一致。
 *
 * ── 为什么视口要独立成 store ──
 * 滚轮缩放 / 拖动平移是**每帧级高频**动作。拆分前它们挂在同一个 hook 里，
 * 每改一个浮点数都触发整棵树（含 74KB 的 MapCanvas 同步）重渲染。
 * 独立后：只有订阅了 viewport 的组件会跟着重渲染，文档树纹丝不动。
 */
import { create } from "zustand";
import {
  FIT_PADDING,
  ZOOM_LIMITS,
  fitToRect,
  panByScreenDelta,
  wheelZoomFactor,
  zoomAt,
  type CanvasSize,
  type Viewport,
} from "../coords";
import { BASE_IMAGE } from "../sprites";

/** 底图在世界坐标中的范围（原点居中的 1024×1024） */
export const BASE_BOUNDS = {
  x: -BASE_IMAGE.width / 2,
  y: -BASE_IMAGE.height / 2,
  width: BASE_IMAGE.width,
  height: BASE_IMAGE.height,
} as const;

interface MapViewportState {
  viewport: Viewport;
  setViewport: (updater: (vp: Viewport) => Viewport) => void;
  /** 滚轮缩放（以光标为锚点，上下限由 zoomLimits 约束） */
  handleWheel: (
    deltaY: number,
    anchor: { x: number; y: number },
    canvasSize: CanvasSize,
    zoomLimits: { min: number; max: number },
  ) => void;
  /** 平移（拖动空白区域） */
  handlePan: (dx: number, dy: number) => void;
  /** 适应窗口 */
  fitView: (canvasSize: CanvasSize, zoomLimits: { min: number; max: number }) => void;
  /**
   * 把视口推进到某个世界矩形（"钻进这一块看"）。
   *
   * 【为什么内边距比 fitView 小】`fitView` 要留出纸外投影与四边留白，所以
   * `FIT_PADDING` 较大；而"聚焦一个区块"是要让这块地**充满视野**，
   * 留白太多会让人觉得"点了没反应"。
   *
   * @param minScale 缩放下限。子图有渐入阈值：区块的包围盒可能比整张纸还大
   *   （level-0 的大陆），"适配该包围盒"得到的缩放会低于渐入阈值 ——
   *   此时推进过去仍然看不见子图，等于白推。传渐入阈值进来即可保证"进去了就看得见"。
   */
  focusRect: (
    rect: { x: number; y: number; width: number; height: number },
    canvasSize: CanvasSize,
    zoomLimits: { min: number; max: number },
    minScale?: number,
  ) => void;
}

const INITIAL_VIEWPORT: Viewport = { x: 0, y: 0, scale: 0.5 };

/** 聚焦矩形时四周留白的比例（相对短边）。0.12 ≈ 视觉上"贴边但没切到" */
const FOCUS_PADDING = 0.12;

export const useMapViewportStore = create<MapViewportState>()((set) => ({
  viewport: INITIAL_VIEWPORT,

  setViewport: (updater) => set((state) => ({ viewport: updater(state.viewport) })),

  handleWheel: (deltaY, anchor, canvasSize, zoomLimits) => {
    const factor = wheelZoomFactor(deltaY);
    if (factor === 1) return;
    set((state) => ({ viewport: zoomAt(state.viewport, anchor, factor, canvasSize, zoomLimits) }));
  },

  handlePan: (dx, dy) => {
    set((state) => ({ viewport: panByScreenDelta(state.viewport, dx, dy) }));
  },

  fitView: (canvasSize, zoomLimits) => {
    set({ viewport: fitToRect(BASE_BOUNDS, canvasSize, FIT_PADDING, zoomLimits) });
  },

  focusRect: (rect, canvasSize, zoomLimits, minScale = 0) => {
    const vp = fitToRect(rect, canvasSize, FOCUS_PADDING, zoomLimits);
    // 只抬不放：适配包围盒已经够近时不要无谓地再放大
    const scale =
      Number.isFinite(minScale) && minScale > vp.scale
        ? Math.min(minScale, zoomLimits.max)
        : vp.scale;
    set({ viewport: { ...vp, scale } });
  },
}));

/** 复位视口 store（测试隔离 + 窗口即关即销时清空） */
export function resetMapViewportStore(): void {
  useMapViewportStore.setState({ viewport: INITIAL_VIEWPORT });
}

export { INITIAL_VIEWPORT, ZOOM_LIMITS };
