import { useCallback, useEffect, useRef, useState } from "react";
import {
  ZOOM_LIMITS,
  fitToRect,
  hitTestElement,
  panByScreenDelta,
  zoomAt,
  type CanvasSize,
  type Viewport,
} from "../coords";
import { BASE_IMAGE, SPRITE_MAP } from "../sprites";
import {
  createElementId,
  createEmptyDocument,
  type MapDocument,
  type MapElement,
} from "../types";
import { useTextureCache } from "./useTextureCache";

/** 撤销栈最大深度（PRD §4.8） */
const HISTORY_LIMIT = 50;

/**
 * 地图编辑器核心状态机。
 *
 * 职责：持有文档与视口，暴露全部编辑动作，并维护撤销/重做。
 * 组件只消费本 hook 的返回值，不自行维护画布状态（AGENTS §6.2.1）。
 *
 * 撤销策略：文档变更前快照 elements。视口（缩放平移）不进撤销栈
 * —— 与 PRD §4.8 一致（视口变化属"浏览"而非"编辑"）。
 */
export function useMapEditor(canvasSize: CanvasSize) {
  const [doc, setDoc] = useState<MapDocument>(() => createEmptyDocument());
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, scale: 0.5 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 当前待放置的素材（点击面板后进入"待放置"态，再点画布落位） */
  const [pendingSpriteId, setPendingSpriteId] = useState<string | null>(null);

  /**
   * 撤销/重做栈。
   *
   * 用 state 而非 ref：按钮的可用态（canUndo/canRedo）需要在 render 期读取，
   * 而 React 明确禁止在 render 期访问 ref.current（会拿到过期值且不触发重渲染）。
   */
  const [undoStack, setUndoStack] = useState<MapElement[][]>([]);
  const [redoStack, setRedoStack] = useState<MapElement[][]>([]);

  const { textures, ready } = useTextureCache();

  /**
   * 提交一次文档变更（自动入撤销栈）。
   * 所有会改变 elements 的操作都必须走这里，否则撤销会漏。
   */
  const commit = useCallback(
    (mutate: (elements: MapElement[]) => MapElement[]) => {
      setDoc((prev) => {
        setUndoStack((stack) => {
          const next = [...stack, prev.elements];
          return next.length > HISTORY_LIMIT ? next.slice(-HISTORY_LIMIT) : next;
        });
        setRedoStack([]);
        return { ...prev, elements: mutate(prev.elements) };
      });
    },
    [],
  );

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const prev = stack[stack.length - 1];
      setDoc((d) => {
        setRedoStack((r) => [...r, d.elements]);
        return { ...d, elements: prev };
      });
      setSelectedId(null);
      return stack.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setRedoStack((stack) => {
      if (stack.length === 0) return stack;
      const next = stack[stack.length - 1];
      setDoc((d) => {
        setUndoStack((u) => {
          const merged = [...u, d.elements];
          return merged.length > HISTORY_LIMIT ? merged.slice(-HISTORY_LIMIT) : merged;
        });
        return { ...d, elements: next };
      });
      setSelectedId(null);
      return stack.slice(0, -1);
    });
  }, []);

  /** 首次拿到画布尺寸时，把底图适配进视口 */
  const didInitialFit = useRef(false);
  useEffect(() => {
    if (didInitialFit.current) return;
    if (canvasSize.width === 0 || canvasSize.height === 0) return;
    didInitialFit.current = true;
    setViewport(
      fitToRect(
        {
          x: -BASE_IMAGE.width / 2,
          y: -BASE_IMAGE.height / 2,
          width: BASE_IMAGE.width,
          height: BASE_IMAGE.height,
        },
        canvasSize,
      ),
    );
  }, [canvasSize]);

  /** 适应窗口 */
  const fitView = useCallback(() => {
    setViewport(
      fitToRect(
        {
          x: -BASE_IMAGE.width / 2,
          y: -BASE_IMAGE.height / 2,
          width: BASE_IMAGE.width,
          height: BASE_IMAGE.height,
        },
        canvasSize,
      ),
    );
  }, [canvasSize]);

  /** 缩放（滚轮，以光标为锚点） */
  const handleWheel = useCallback(
    (deltaY: number, anchor: { x: number; y: number }) => {
      const factor = deltaY < 0 ? 1.1 : 1 / 1.1;
      setViewport((vp) => zoomAt(vp, anchor, factor, canvasSize, ZOOM_LIMITS));
    },
    [canvasSize],
  );

  /** 平移（拖动空白区域） */
  const handlePan = useCallback((dx: number, dy: number) => {
    setViewport((vp) => panByScreenDelta(vp, dx, dy));
  }, []);

  /** 放置素材到世界坐标 */
  const placeSprite = useCallback(
    (spriteId: string, world: { x: number; y: number }) => {
      const def = SPRITE_MAP[spriteId];
      if (!def) return;
      const element: MapElement = {
        id: createElementId(),
        spriteId,
        x: world.x,
        // 元素 y 为底部锚点：点击处即"落地点"
        y: world.y,
        scale: 1,
        rotation: 0,
      };
      commit((els) => [...els, element]);
      setSelectedId(element.id);
    },
    [commit],
  );

  /** 命中测试：返回最上层（后放置 = 上层）被点中的元素 */
  const pickElement = useCallback(
    (world: { x: number; y: number }): MapElement | null => {
      for (let i = doc.elements.length - 1; i >= 0; i -= 1) {
        const el = doc.elements[i];
        const def = SPRITE_MAP[el.spriteId];
        if (!def) continue;
        if (
          hitTestElement(world, {
            x: el.x,
            y: el.y,
            width: def.baseWidth,
            height: def.baseHeight,
            scale: el.scale,
          })
        ) {
          return el;
        }
      }
      return null;
    },
    [doc.elements],
  );

  /**
   * 按**世界坐标增量**移动已选中元素（拖拽中高频调用，不入撤销栈）。
   *
   * 用增量而非绝对坐标：元素锚点在贴图底部，若把锚点直接钉到光标上，
   * 第一次移动元素就会"跳"半个身高，且松手后抓取点与元素错位。
   */
  const moveElementBy = useCallback((id: string, dxWorld: number, dyWorld: number) => {
    setDoc((prev) => ({
      ...prev,
      elements: prev.elements.map((el) =>
        el.id === id ? { ...el, x: el.x + dxWorld, y: el.y + dyWorld } : el,
      ),
    }));
  }, []);

  /** 拖拽结束：把起始位置压入撤销栈（拖拽全程只记一次） */
  const commitDragStart = useCallback((snapshot: MapElement[]) => {
    setUndoStack((stack) => {
      const next = [...stack, snapshot];
      return next.length > HISTORY_LIMIT ? next.slice(-HISTORY_LIMIT) : next;
    });
    setRedoStack([]);
  }, []);

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    commit((els) => els.filter((el) => el.id !== selectedId));
    setSelectedId(null);
  }, [commit, selectedId]);

  const clearAll = useCallback(() => {
    if (doc.elements.length === 0) return;
    commit(() => []);
    setSelectedId(null);
  }, [commit, doc.elements.length]);

  return {
    doc,
    viewport,
    selectedId,
    pendingSpriteId,
    images: textures,
    imagesReady: ready,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    setSelectedId,
    setPendingSpriteId,
    handleWheel,
    handlePan,
    fitView,
    placeSprite,
    pickElement,
    moveElementBy,
    commitDragStart,
    removeSelected,
    clearAll,
    undo,
    redo,
  };
}

export type MapEditorApi = ReturnType<typeof useMapEditor>;
