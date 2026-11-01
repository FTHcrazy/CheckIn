import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FIT_PADDING,
  ZOOM_LIMITS,
  fitScaleFor,
  fitToRect,
  hitTestElement,
  panByScreenDelta,
  wheelZoomFactor,
  zoomAt,
  type CanvasSize,
  type Viewport,
} from "../coords";
import { BASE_IMAGE, SPRITE_MAP } from "../sprites";
import {
  REGION_LEVELS,
  REGION_LEVEL_COUNT_LIMITS,
  generateHierarchy,
  polygonArea,
  type MapRegion,
} from "../regions";
// 别名：本 hook 要暴露一个同名动作 `generateLand`，避免与纯函数撞名
import { generateLand as buildLand } from "../land";
import {
  activeLevel,
  elementSizeFactor,
  elementWeight,
  finestBlockLongEdge,
  levelAlphas as computeLevelAlphas,
  levelCountsOf,
  naturalScales,
  zoomLimitsForBlocks,
  ELEMENT_PICK_MIN_WEIGHT,
} from "../lod";
import {
  createElementId,
  createEmptyDocument,
  createLabelId,
  LABEL_ABOVE_ELEMENT,
  LABEL_DEFAULT_SIZE,
  type MapDocument,
  type MapElement,
  type MapLabel,
  type MapLabelSize,
  type MapLand,
  type MapStyle,
} from "../types";
import { useTextureCache } from "./useTextureCache";

/** 撤销栈最大深度（PRD §4.8） */
const HISTORY_LIMIT = 50;

/**
 * 撤销栈条目 —— 一次编辑**之前**的文档快照。
 *
 * 只存会进历史的字段（素材 / 区块 / 陆地 / 标注 / 风格 / 分区开关）：
 * 底图与 version 目前不可变，存进去只会让每步快照多占内存。
 *
 * 【为什么"显示分区"也要进】它影响画面 —— 用户切错了会期望能撤销
 * （PRD §6.2 明确要求）。漏掉它，撤销后画面不回退，用户会以为"撤销坏了"。
 *
 * 【扩容几乎是零成本的】数组与对象是**引用共享**的：没被改动的字段在快照里
 * 只是同一个引用，不会复制一份。
 */
interface DocSnapshot {
  elements: MapElement[];
  regions: MapRegion[];
  land: MapLand | null;
  labels: MapLabel[];
  style: MapStyle;
  showRegions: boolean;
}

function snapshotOf(doc: MapDocument): DocSnapshot {
  return {
    elements: doc.elements,
    regions: doc.regions,
    land: doc.land,
    labels: doc.labels,
    style: doc.style,
    showRegions: doc.showRegions,
  };
}

/** 把快照写回文档（撤销 / 重做共用） */
function applySnapshot(doc: MapDocument, snap: DocSnapshot): MapDocument {
  return {
    ...doc,
    elements: snap.elements,
    regions: snap.regions,
    land: snap.land,
    labels: snap.labels,
    style: snap.style,
    showRegions: snap.showRegions,
  };
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
   * 最细一级区块多边形的**长边**（世界单位，取低分位见 `ZOOM_FINEST_PERCENTILE`）。
   *
   * 【只随区块变化重算】它要扫最细一级那 160 个多边形的全部顶点，绝不能进入
   * 视口（滚轮每格 / 拖拽每帧）的依赖路径 —— 那会把"每帧只改几个浮点数"的
   * 底线一次性废掉。
   *
   * 层级数取 `regionScales.length`（由实际生成结果统计而来，不是常量表），
   * 因此"只生成 2 级"时这里算的就是"洲"那一级的长边。
   */
  const finestBlockLong = useMemo(() => {
    const levelCount = regionScales.length;
    if (levelCount === 0) return 0;
    return finestBlockLongEdge(doc.regions, levelCount - 1);
  }, [doc.regions, regionScales.length]);

  /**
   * 缩放上下限：由「层级 + 最细一级的实际块长边 + 画布尺寸」反推。
   *
   * 上限的语义是"**最细一级的一块长边能把画布短边铺满**"—— 这正是用户要的
   * "最小的单位能放大到全屏"。旧的 `scales[last] * 4` 只保证"读得清"，
   * 实测只有 8.89，而中位郡铺满需要 10~11 倍（见 `lod.ts` 的
   * `zoomLimitsForBlocks`）。
   *
   * 下限与"整图适配"取小者：层级配置一变（自然缩放下限被抬高），用户不能
   * 因此再也缩不回整张地图。
   */
  const zoomLimits = useMemo(() => {
    if (regionScales.length === 0) return ZOOM_LIMITS;
    const fitScale = fitScaleFor(BASE_BOUNDS, canvasSize, FIT_PADDING);
    return zoomLimitsForBlocks({
      scales: regionScales,
      fitScale,
      finestBlockLong,
      canvas: canvasSize,
    });
  }, [regionScales, finestBlockLong, canvasSize]);

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
        return applySnapshot(d, prev);
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
        return applySnapshot(d, next);
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

  /** 缩放（滚轮，以光标为锚点）。上下限由层级 + 实际块大小反推 —— 缩到底能看到整片
   *  大陆，放到最大正好是"最细一级的一块铺满画布"。
   *
   *  步长见 `coords.ts` 的 `wheelZoomFactor`：小 delta 恒为一档（1.1 倍，保住
   *  "小格微调"的精度），大 delta（触控板一次滑动）按比例折算、最多 6 档，
   *  否则从适配缩放走到新上限要滚三十多格。 */
  const handleWheel = useCallback(
    (deltaY: number, anchor: { x: number; y: number }) => {
      const factor = wheelZoomFactor(deltaY);
      if (factor === 1) return;
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
   *
   * 【命中区必须乘层级尺寸因子】素材的绘制尺寸是
   * `baseWidth × el.scale × elementSizeFactor(level, levelCount)`（见
   * `MapCanvas` 的精灵同步）。只放开缩放上限而不缩素材时，这两处是同一个数；
   * 素材按层级缩小之后，若这里仍按 `baseWidth` 判命中，郡级素材的命中区会是
   * 它视觉尺寸的 8 倍 —— 点在空白处也会选中东西。
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
            scale: el.scale * elementSizeFactor(el.level, levelAlphas.length),
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
   * 第一次移动元素就会跳半个身高，且松手后抓取点与元素错位。
   *
   * 【联动标注必须在同一次更新里跟着走】它挂在素材"头顶"，素材一动而文字留在
   * 原地，看起来就是"山走了，名字还漂在原地"。这里用同一个 `setDoc` updater
   * 同时写两张表：既保证原子性（不会出现"素材动了、地名没动"的中间帧），
   * 也避免第二次 `setDoc` 带来的额外渲染。
   */
  const moveElementBy = useCallback((id: string, dxWorld: number, dyWorld: number) => {
    setDoc((prev) => ({
      ...prev,
      elements: prev.elements.map((el) =>
        el.id === id ? { ...el, x: el.x + dxWorld, y: el.y + dyWorld } : el,
      ),
      // 绝大多数文档没有标注，先短路掉，避免拖拽时每帧都分配一个新数组
      labels:
        prev.labels.length === 0
          ? prev.labels
          : prev.labels.map((l) =>
              l.elementId === id ? { ...l, x: l.x + dxWorld, y: l.y + dyWorld } : l,
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

  /**
   * 删除选中素材 —— **必须连带删掉它绑定的地名**，且写在同一个 mutate 里。
   *
   * 【为什么不能发两次 commit】两次提交会在撤销栈里留下两步：撤销一次只回滚素材、
   * 地名还留着，变成一条没有归属的孤儿标注（点它才发现在编辑一个不存在的素材）。
   * 同一个 mutate 只产生一步快照，撤销即同时复原。
   */
  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    commit((d) => ({
      ...d,
      elements: d.elements.filter((el) => el.id !== selectedId),
      labels:
        d.labels.length === 0
          ? d.labels
          : d.labels.filter((l) => l.elementId !== selectedId),
    }));
    setSelectedId(null);
  }, [commit, selectedId]);

  /**
   * 清空全部素材（同样连带清掉联动地名）。
   *
   * 只清"绑定了素材"的那些：手放的独立地名不受影响 —— 用户清的是素材，
   * 地名是有独立价值的产出，不该跟着一起没。
   */
  const clearAll = useCallback(() => {
    if (doc.elements.length === 0) return;
    commit((d) => ({
      ...d,
      elements: [],
      labels: d.labels.filter((l) => !l.elementId),
    }));
    setSelectedId(null);
  }, [commit, doc.elements.length]);

  /**
   * 按层级数生成一棵区块树。
   *
   * 【有陆地时必须在陆地内切分】否则区块会铺满整张纸 —— 一半落在海里，
   * 陆地内切分的全部意义就没了（PRD §6.1.3）。
   *
   * 【多岛的两条纪律】
   *   · 逐岛调用后 concat，每个岛传自己的 `container`；
   *   · 必须传**互不相同**的 `idPrefix`：`nextId` 的计数器是每次调用新建的，
   *     不传则两岛的第 1 块都叫 `rg_<seed>_1`（React key 冲突、撤销栈错乱）。
   * 【各级数量按岛面积加权】保证每岛的"郡级密度"一致 —— 否则小岛会被塞进
   * 和大岛一样多的区块，看上去密得发黑。
   *
   * 【种子取陆地的 seed】同一颗陆地种子必得同一套分区，截图才可复现对比
   * （PRD §10.1）。没有陆地时退回随机种子 —— "重新生成"要给出新的划分。
   */
  const buildRegions = useCallback(
    (land: MapLand | null, levelCount: number): MapRegion[] => {
      const depth = Math.max(
        REGION_LEVEL_COUNT_LIMITS.min,
        Math.min(REGION_LEVEL_COUNT_LIMITS.max, Math.round(levelCount)),
      );
      const counts = REGION_LEVELS.slice(0, depth).map((l) => l.count);
      const seed = land
        ? land.seed
        : Math.floor(Math.random() * 0x7fffffff);

      if (!land || land.polygons.length === 0) {
        return generateHierarchy({ seed, bounds: BASE_BOUNDS, levelCounts: counts });
      }

      const areas = land.polygons.map((ring) => Math.max(1e-6, polygonArea(ring)));
      const total = areas.reduce((sum, a) => sum + a, 0);
      const out: MapRegion[] = [];
      for (let i = 0; i < land.polygons.length; i += 1) {
        const share = areas[i] / Math.max(1e-9, total);
        out.push(
          ...generateHierarchy({
            seed,
            bounds: BASE_BOUNDS,
            levelCounts: counts.map((c) => Math.max(1, Math.round(c * share))),
            container: land.polygons[i],
            idPrefix: `i${i}_`,
          }),
        );
      }
      return out;
    },
    [],
  );

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
      const regions = buildRegions(doc.land, levelCount);
      if (regions.length === 0) return;
      commit((d) => ({ ...d, regions }));
    },
    [buildRegions, commit, doc.land],
  );

  /** 清除全部区块（可撤销） */
  const clearRegions = useCallback(() => {
    if (doc.regions.length === 0) return;
    commit((d) => ({ ...d, regions: [] }));
  }, [commit, doc.regions.length]);

  /**
   * 生成陆地，并**在同一次提交里**把区块改成"陆地内切分"。
   *
   * 【为什么必须一次 commit】分两步会留下一个中间状态：陆地已生成、区块还在海里。
   * 用户看到的是"海岸出来了但区块没跟上"，而撤销一次只回退一半。
   *
   * @param seed 陆地种子；不给则随机取（渲染期外调用，允许 Math.random）
   * @param levelCount 同时重划区块的层级数
   */
  const generateLand = useCallback(
    (seed?: number, levelCount?: number) => {
      const nextSeed = (Math.floor(seed ?? Math.random() * 0x7fffffff) >>> 0) || 1;
      const land = buildLand({ seed: nextSeed, bounds: BASE_BOUNDS });
      if (land.polygons.length === 0) return;
      const depth = levelCount ?? REGION_LEVEL_COUNT_LIMITS.default;
      const regions = buildRegions(land, depth);
      commit((d) => ({ ...d, land, regions }));
    },
    [buildRegions, commit],
  );

  /** 清除陆地（海岸四层随之消失；区块保留 —— 它们仍在原来的多边形里） */
  const clearLand = useCallback(() => {
    if (!doc.land) return;
    commit((d) => ({ ...d, land: null }));
  }, [commit, doc.land]);

  /**
   * 切换"显示分区"（关掉 = 给读者看的成品图）。
   *
   * 走 `commit` 而不是直接 setState：它影响画面，用户会期望能撤销
   * （快照里已有 `showRegions`）。
   */
  const toggleRegions = useCallback(() => {
    commit((d) => ({ ...d, showRegions: !d.showRegions }));
  }, [commit]);

  /**
   * 切换全局风格预设（B4 / PRD §6.4）。
   *
   * 【为什么也进撤销栈】风格是**成品的一部分**（"给读者看的配色"），不是视图
   * 偏好：选错了想按撤销回去，和"关掉分区"是同一种心智。写进快照的字段只有
   * 一个 3 值的枚举，成本可以忽略。
   *
   * 【同值不提交】下拉每次重选同一项也会触发 `onChange`。不过滤就会产生一串
   * "什么也没变"的撤销步，按三次撤销画面还停在原样 —— 用户会以为撤销坏了。
   */
  const setStyle = useCallback(
    (next: MapStyle) => {
      if (next === doc.style) return;
      commit((d) => ({ ...d, style: next }));
    },
    [commit, doc.style],
  );

  /* ───────────────── 文字标注（B3 / PRD §6.3.3） ───────────────── */

  /**
   * 新建一条地名。
   *
   * @returns 新标注 id；**空文本返回 null 且不创建**
   *
   * 【为什么空文本不创建】一个空文字的 `Text` 既看不见、也点不中（包围盒为空），
   * 用户无法再把这个"幽灵对象"选中删掉，它只会在文档里越积越多。
   * "加标注"工具因此是"先给位置、拿到文字才落库"的两段式。
   */
  const addLabel = useCallback(
    (input: {
      x: number;
      y: number;
      text: string;
      level: number | null;
      size?: MapLabelSize;
    }): string | null => {
      const text = input.text.trim();
      if (!text) return null;
      const label: MapLabel = {
        id: createLabelId(),
        text,
        x: input.x,
        y: input.y,
        size: input.size ?? LABEL_DEFAULT_SIZE,
        level: input.level,
      };
      commit((d) => ({ ...d, labels: [...d.labels, label] }));
      return label.id;
    },
    [commit],
  );

  /**
   * 改一条地名（文案 / 位置 / 字号 / 层级）。
   *
   * 改成空文本等价于删除 —— 与 `addLabel` 的理由相同：不留看不见的对象。
   */
  const updateLabel = useCallback(
    (id: string, patch: Partial<Pick<MapLabel, "text" | "x" | "y" | "size" | "level">>) => {
      commit((d) => {
        const target = d.labels.find((l) => l.id === id);
        if (!target) return d;
        const text = patch.text === undefined ? target.text : patch.text.trim();
        if (!text) return { ...d, labels: d.labels.filter((l) => l.id !== id) };
        return {
          ...d,
          labels: d.labels.map((l) => (l.id === id ? { ...l, ...patch, text } : l)),
        };
      });
    },
    [commit],
  );

  const removeLabel = useCallback(
    (id: string) => {
      commit((d) => ({
        ...d,
        labels: d.labels.length === 0 ? d.labels : d.labels.filter((l) => l.id !== id),
      }));
    },
    [commit],
  );

  /**
   * 给某个素材起名（属性区的「地名」输入框）—— 有则改、无则建。
   *
   * 【位置定在素材上方 8 单位】素材的 `y` 是脚底，地名浮在头顶，两者锚点垂直
   * 相差 `LABEL_ABOVE_ELEMENT`。之后拖动素材时由 `moveElementBy` 按同一增量
   * 一起搬，所以这里只算一次初始位置。
   *
   * 【层级跟着素材走】地名属于素材所在的那个世界（郡里的山配郡里的地名），
   * 缩到别级时两者一起淡出，不会出现"山没了、名字还在"。
   *
   * 【文本没变时提前返回同一个 `doc`】让 React 直接 bail out（不重渲染）。
   * 注意快照**仍然会入栈** —— `commit` 是无条件记账的，所以调用方要先比对文本，
   * 别把"每次失焦都 commit 一次空变更"变成撤销栈里的噪音。
   *
   * 【为什么带 `size`】新建联动地名时要跟随工具栏选的字号档（PRD §4.4
   * "手动选，不按层级自动绑"）。缺省用 `LABEL_DEFAULT_SIZE`，老调用点不受影响。
   */
  const setElementLabel = useCallback(
    (elementId: string, text: string, size: MapLabelSize = LABEL_DEFAULT_SIZE) => {
      const next = text.trim();
      commit((d) => {
        const el = d.elements.find((e) => e.id === elementId);
        if (!el) return d;
        const existing = d.labels.find((l) => l.elementId === elementId);
        if (existing && existing.text === next) return d;
        if (!next) {
          return existing
            ? { ...d, labels: d.labels.filter((l) => l.id !== existing.id) }
            : d;
        }
        if (existing) {
          return {
            ...d,
            labels: d.labels.map((l) => (l.id === existing.id ? { ...l, text: next } : l)),
          };
        }
        const label: MapLabel = {
          id: createLabelId(),
          text: next,
          x: el.x,
          y: el.y - LABEL_ABOVE_ELEMENT,
          size,
          level: el.level,
          elementId,
        };
        return { ...d, labels: [...d.labels, label] };
      });
    },
    [commit],
  );

  /** 选中素材绑定的地名；没有则 null（属性区据此决定输入框的初始值） */
  const elementLabelOf = useCallback(
    (elementId: string | null): MapLabel | null =>
      elementId ? doc.labels.find((l) => l.elementId === elementId) ?? null : null,
    [doc.labels],
  );

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
    generateLand,
    clearLand,
    toggleRegions,
    setStyle,
    addLabel,
    updateLabel,
    removeLabel,
    setElementLabel,
    elementLabelOf,
    undo,
    redo,
  };
}

export type MapEditorApi = ReturnType<typeof useMapEditor>;
