import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FIT_PADDING,
  ZOOM_LIMITS,
  fitScaleFor,
  fitToRect,
  hitTestElement,
  panByScreenDelta,
  zoomAt,
  type CanvasSize,
  type Viewport,
} from "../coords";
import { BASE_IMAGE, SPRITE_MAP } from "../sprites";
import {
  REGION_LEVELS,
  REGION_LEVEL_COUNT_LIMITS,
  generateHierarchy,
  type MapRegion,
} from "../regions";
import {
  activeLevel,
  elementWeight,
  levelAlphas as computeLevelAlphas,
  levelCountsOf,
  naturalScales,
  zoomLimitsFor,
  ELEMENT_PICK_MIN_WEIGHT,
} from "../lod";
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
 * 撤销栈条目 —— 一次编辑**之前**的文档快照。
 *
 * 只存会进历史的字段（素材 + 区块）：底图与 version 目前不可变，
 * 存进去只会让每步快照多占内存。
 */
interface DocSnapshot {
  elements: MapElement[];
  regions: MapRegion[];
}

function snapshotOf(doc: MapDocument): DocSnapshot {
  return { elements: doc.elements, regions: doc.regions };
}

/** 底图在世界坐标中的范围（原点居中的 1024×1024） */
const BASE_BOUNDS = {
  x: -BASE_IMAGE.width / 2,
  y: -BASE_IMAGE.height / 2,
  width: BASE_IMAGE.width,
  height: BASE_IMAGE.height,
} as const;

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
  const [undoStack, setUndoStack] = useState<DocSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<DocSnapshot[]>([]);

  const { textures, ready } = useTextureCache();

  /* ───────────────── 层级 LOD（无极缩放的衔接） ───────────────── */

  /**
   * 各级的"自然缩放"—— 在该缩放下，这一级的一块在屏幕上正好一个舒适大小。
   *
   * 用**实际生成结果**统计每级数量，而不是常量表 `REGION_LEVELS`：数量会被
   * `REGION_TOTAL_LIMIT` 截断，拿常量算出来的自然缩放会和画面对不上。
   */
  const regionScales = useMemo(() => {
    const counts = levelCountsOf(doc.regions);
    return counts.length === 0 ? [] : naturalScales(counts, BASE_BOUNDS);
  }, [doc.regions]);

  /** 各层级当前的可见权重（Σα ≡ 1），画布与工具栏共用同一份 */
  const levelAlphas = useMemo(
    () => (regionScales.length === 0 ? [] : computeLevelAlphas(viewport.scale, regionScales)),
    [regionScales, viewport.scale],
  );

  /**
   * 当前主导层级 —— 新放下的素材就归到这一级（也是工具栏层级胶囊显示的那一级）。
   *
   * `null` = 还没生成区块，此时素材层级无关（任何缩放下都可见）。
   * 与上面的 `levelAlphas` 同源（`activeLevel` 内部就是取它的最大项），
   * 不会出现"工具栏说国家、素材却落进郡"的不一致。
   */
  const currentLevel = useMemo(
    () => (regionScales.length === 0 ? null : activeLevel(viewport.scale, regionScales)),
    [regionScales, viewport.scale],
  );

  /**
   * 缩放上下限：由层级反推，但**下限不得大于"整图适配"** ——
   * 否则层级配置一变（自然缩放下限被抬高），用户就再也缩不回整张地图了。
   */
  const zoomLimits = useMemo(() => {
    if (regionScales.length === 0) return ZOOM_LIMITS;
    const fromLevels = zoomLimitsFor(regionScales);
    const fitScale = fitScaleFor(BASE_BOUNDS, canvasSize, FIT_PADDING);
    return { min: Math.min(fromLevels.min, fitScale), max: fromLevels.max };
  }, [regionScales, canvasSize]);

  /** 层级变化后把当前缩放夹回合法区间（否则可能停在"画不出任何一级"的缩放上） */
  useEffect(() => {
    setViewport((vp) => {
      const s = Math.min(zoomLimits.max, Math.max(zoomLimits.min, vp.scale));
      return s === vp.scale ? vp : { ...vp, scale: s };
    });
  }, [zoomLimits]);

  /**
   * 选中的素材若因层级切换而隐没，自动取消选中。
   *
   * 与 `pickElement` 的过滤是同一件事的两面：既然"看不见的素材点不中"，
   * 那已经选中的素材淡出时也不该继续被选中 —— 否则会出现"选中框看不见、
   * 但删除按钮亮着"，用户按一下 Delete 就删掉了一个自己根本没看见的东西。
   */
  useEffect(() => {
    if (!selectedId) return;
    const el = doc.elements.find((e) => e.id === selectedId);
    if (!el) return;
    if (elementWeight(el.level, levelAlphas) < ELEMENT_PICK_MIN_WEIGHT) setSelectedId(null);
  }, [selectedId, doc.elements, levelAlphas]);

  /**
   * 提交一次文档变更（自动入撤销栈）。
   *
   * 入参是**整份文档的变换函数**而非仅素材数组：区块生成、清空等操作
   * 同样需要撤销，只快照 elements 会让这些操作无法回退。
   * 所有会改变文档的操作都必须走这里，否则撤销会漏。
   */
  const commit = useCallback((mutate: (doc: MapDocument) => MapDocument) => {
    setDoc((prev) => {
      setUndoStack((stack) => {
        const next = [...stack, snapshotOf(prev)];
        return next.length > HISTORY_LIMIT ? next.slice(-HISTORY_LIMIT) : next;
      });
      setRedoStack([]);
      return mutate(prev);
    });
  }, []);

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const prev = stack[stack.length - 1];
      setDoc((d) => {
        setRedoStack((r) => [...r, snapshotOf(d)]);
        return { ...d, elements: prev.elements, regions: prev.regions };
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
          const merged = [...u, snapshotOf(d)];
          return merged.length > HISTORY_LIMIT ? merged.slice(-HISTORY_LIMIT) : merged;
        });
        return { ...d, elements: next.elements, regions: next.regions };
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
    setViewport(fitToRect(BASE_BOUNDS, canvasSize, FIT_PADDING, zoomLimits));
  }, [canvasSize, zoomLimits]);

  /** 适应窗口 */
  const fitView = useCallback(() => {
    setViewport(fitToRect(BASE_BOUNDS, canvasSize, FIT_PADDING, zoomLimits));
  }, [canvasSize, zoomLimits]);

  /** 缩放（滚轮，以光标为锚点）。上下限由层级反推 —— 缩到底能看到整片大陆，
   *  放到最大正好落在最细一级的自然缩放附近，不会白放大一段"什么也长不出来"的区间。 */
  const handleWheel = useCallback(
    (deltaY: number, anchor: { x: number; y: number }) => {
      const factor = deltaY < 0 ? 1.1 : 1 / 1.1;
      setViewport((vp) => zoomAt(vp, anchor, factor, canvasSize, zoomLimits));
    },
    [canvasSize, zoomLimits],
  );

  /** 平移（拖动空白区域） */
  const handlePan = useCallback((dx: number, dy: number) => {
    setViewport((vp) => panByScreenDelta(vp, dx, dy));
  }, []);

  /**
   * 放置素材到世界坐标。
   *
   * **素材会记住放置时所处的层级**（`currentLevel`）：那一刻用户看着哪一级的地图，
   * 摆下的就是哪一级的地形。之后缩放到别的层级时它随之淡出/消失（见 types.ts 的
   * `MapElement.level`）。尚未生成区块时记 `null`，即"层级无关、始终可见"。
   */
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
        level: currentLevel,
      };
      commit((d) => ({ ...d, elements: [...d.elements, element] }));
      setSelectedId(element.id);
    },
    [commit, currentLevel],
  );

  /**
   * 命中测试：返回最上层（后放置 = 上层）被点中的元素。
   *
   * 只挑**当前缩放下属实可见**的元素（权重 ≥ `ELEMENT_PICK_MIN_WEIGHT`）：
   * 别级素材正在淡出、只剩一层几乎看不见的影子时，若还能点中，用户会在
   * "看着什么都没有"的地方选中东西，比点不中更让人困惑。
   */
  const pickElement = useCallback(
    (world: { x: number; y: number }): MapElement | null => {
      for (let i = doc.elements.length - 1; i >= 0; i -= 1) {
        const el = doc.elements[i];
        const def = SPRITE_MAP[el.spriteId];
        if (!def) continue;
        if (elementWeight(el.level, levelAlphas) < ELEMENT_PICK_MIN_WEIGHT) continue;
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
    [doc.elements, levelAlphas],
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
  const commitDragStart = useCallback((doc: MapDocument) => {
    setUndoStack((stack) => {
      const next = [...stack, snapshotOf(doc)];
      return next.length > HISTORY_LIMIT ? next.slice(-HISTORY_LIMIT) : next;
    });
    setRedoStack([]);
  }, []);

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    commit((d) => ({ ...d, elements: d.elements.filter((el) => el.id !== selectedId) }));
    setSelectedId(null);
  }, [commit, selectedId]);

  const clearAll = useCallback(() => {
    if (doc.elements.length === 0) return;
    commit((d) => ({ ...d, elements: [] }));
    setSelectedId(null);
  }, [commit, doc.elements.length]);

  /**
   * 随机生成一棵层级区块树，替换掉现有区块。
   *
   * 用 Math.random 取种子而非固定值：每次点击都应给出**不同的**划分，
   * 这是"重新生成"的语义。种子不写进文档 —— 文档只存生成结果（多边形与父子关系），
   * 落库时无需关心随机性从哪来。
   *
   * @param levelCount 层级数（1 ~ 4）。只生成前 levelCount 级 —— 少生成一级意味着
   *                   最细一级的尺度更大，自然缩放带也随之整体外扩，这正是用户
   *                   调"要看多细"的手段。
   */
  const regenerateHierarchy = useCallback(
    (levelCount: number) => {
      const depth = Math.max(
        REGION_LEVEL_COUNT_LIMITS.min,
        Math.min(REGION_LEVEL_COUNT_LIMITS.max, Math.round(levelCount)),
      );
      const regions = generateHierarchy({
        seed: Math.floor(Math.random() * 0x7fffffff),
        bounds: BASE_BOUNDS,
        levelCounts: REGION_LEVELS.slice(0, depth).map((l) => l.count),
      });
      if (regions.length === 0) return;
      commit((d) => ({ ...d, regions }));
    },
    [commit],
  );

  /** 清除全部区块（可撤销） */
  const clearRegions = useCallback(() => {
    if (doc.regions.length === 0) return;
    commit((d) => ({ ...d, regions: [] }));
  }, [commit, doc.regions.length]);

  return {
    doc,
    viewport,
    selectedId,
    pendingSpriteId,
    images: textures,
    imagesReady: ready,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    /** 各层级可见权重（空数组 = 还没有区块） */
    levelAlphas,
    /** 当前主导层级（`null` = 还没生成区块）；新放下的素材归到这一级 */
    currentLevel,
    /** 各级的自然缩放（空数组 = 还没有区块），工具栏用来显示配置是否生效 */
    regionScales,
    /** 由层级反推的缩放上下限 */
    zoomLimits,
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
    regenerateHierarchy,
    clearRegions,
    undo,
    redo,
  };
}

export type MapEditorApi = ReturnType<typeof useMapEditor>;
