import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  App as AntApp,
  Button,
  Divider,
  Dropdown,
  Input,
  Select,
  Switch,
  Tooltip,
} from "antd";
import {
  BorderOutlined,
  ClearOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DownOutlined,
  DownloadOutlined,
  EditOutlined,
  GlobalOutlined,
  HighlightOutlined,
  MinusCircleOutlined,
  MoreOutlined,
  NodeIndexOutlined,
  PictureOutlined,
  RedoOutlined,
  ThunderboltOutlined,
  UndoOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  ExpandOutlined,
} from "@ant-design/icons";
import { worldToScreen, hitTestPolygon, type CanvasSize } from "./coords";
import { REGION_TOTAL_LIMIT, levelLabelOf, type Point } from "./regions";
import { planMerge, type ManualRegionRejectCode } from "./regionEdit";
import { resolveElementLevel } from "./lod";
import { layerLockedOf } from "./layerState";
import { MAP_STYLES } from "./style";
import { EXPORT_DEFAULT_SIZE, EXPORT_SIZES, exportMapPng, savePng, type ExportSize } from "./export";
import type { GeneratorGear, GeneratorParams } from "./domain/generator";
import { useMapEditor } from "./hooks/useMapEditor";
import MapCanvas, { DRAFT_CLOSE_PX, type MapSceneHandle } from "./components/MapCanvas";
import SpritePanel from "./components/SpritePanel";
import LayerPanel from "./components/LayerPanel";
import ElementPanel from "./components/ElementPanel";
import PolylinePanel from "./components/PolylinePanel";
import { DEFAULT_POLYLINE_STYLE_ID, POLYLINE_STYLES } from "./polylineStyle";
import { BASE_IMAGES, SPRITE_MAP } from "./sprites";
import RegionPanel from "./components/RegionPanel";
import MapLibraryModal from "./components/MapLibraryModal";
import MapGeneratorModal from "./components/MapGeneratorModal";
import SubmapPickerModal from "./components/SubmapPickerModal";
import { useMapPersistence, loadMapDocById } from "./persistence/useMapPersistence";
import { submapFromDoc } from "./submapBind";
import type { MapSaveStatus } from "./store/useMapFileStore";
import { LABEL_DEFAULT_SIZE, LABEL_SIZES, type MapLabelSize, type MapStyle } from "./types";
import "./index.scss";

/** 权重低于此值的层级不再出现在工具栏的指示里（与渲染层的阈值同源） */
const LEVEL_CHIP_EPSILON = 0.004;

/**
 * 方向键 / WASD 的方向表（微移，R-MAP-25）。
 *
 * 值是**单位方向**（乘步长后用）：步长档位（精调 4 / 加速 16）与方向解耦，
 * 改步长不用回来动这张表。世界坐标 y 向下为正，所以"上"是 -1。
 */
const NUDGE_DIRS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  a: [-1, 0],
  d: [1, 0],
  w: [0, -1],
  s: [0, 1],
};

/** 微移步长：精调（默认）与加速（Shift）两档，世界单位 */
const NUDGE_STEP_FINE = 4;
const NUDGE_STEP_FAST = 16;

/**
 * 存档状态 → 一句话说明（工具栏保存指示的 title）。
 *
 * 【为什么集中在一张表】状态机有 6 个值，散在 JSX 的三元里必然漏一个
 * （最典型的是漏掉 `conflict`，于是"冲突"显示成"已保存"——正好相反）。
 */
const MAP_SAVE_STATUS_TEXT: Record<MapSaveStatus, string> = {
  idle: "还没有装载地图",
  dirty: "有改动，正在等待自动保存…",
  saving: "正在保存…",
  saved: "已保存到本地",
  conflict: "库里的版本比当前画面新（点保存可选择覆盖）",
  error: "保存失败，请检查磁盘空间后重试",
};

/**
 * 画布当前的工具（R-REG-03 / B4-2）。
 *
 * 【为什么是"工具"而不是一个 `drawMode` 布尔】画区、画折线与选择是**互斥的指针语义**：
 * 同一个左键，在 select 下是"点选/拖拽"，在 draw 下是"落一个顶点"（构成一个面），
 * 在 polyline 下是"落一个控制点"（构成一条线）。布尔只能表达"某种绘制开着"，
 * 表达不了"三种里现在是哪一种"；多一个值就不可能同时成立。
 *
 * 第三个落位意图（「加标注」`pendingLabel` / 待放置素材 `pendingSpriteId`）没有并进来：
 * 它们的生命周期由各自面板决定（选素材即进入、落位即退出），而 tool 是工具栏状态。
 * 三者互斥靠"进入任一个就清掉另外两个"保证（见 `handlePickTool` / `handlePickSprite`）。
 */
type MapTool = "select" | "draw" | "polyline";

/**
 * 手画拒绝原因 → 中文提示（架构 §5「文案映射（唯一出处）」）。
 *
 * 【为什么在页面这一层】`checkManualRegion` 返回的是**枚举**（`ManualRegionRejectCode`），
 * 纯函数层不该产出面向用户的句子 —— 否则改一句文案要动纯函数、还要改它的用例。
 *
 * 【为什么是函数而不是常量表】三条文案要插值（区块名 / 层级数 / 总数上限），
 * 常量表做不到；用 `switch` 还能让 TS 在新增 code 时**报错**（`never` 兜底），
 * 而 `Record<Code, string>` 只能保证键齐、保证不了插值正确。
 */
function rejectTextOf(
  code: ManualRegionRejectCode,
  conflict: { id: string; name: string } | undefined,
  levelCount: number,
): string {
  // 名字可能为空串（脏数据 / 老文档）：那样文案里出现「」比直接缺字更像 bug
  const name = conflict?.name?.trim() || "上级区块";
  switch (code) {
    case "too-few-points":
      return "至少需要 3 个顶点";
    case "degenerate-edge":
      return "有两个顶点重合了，请撤销上一点重画";
    case "self-intersect":
      return "边线交叉了（区块不能自交），请撤销后重画";
    case "overlap-sibling":
      return `与「${name}」重叠`;
    case "overlap-ancestor":
      return `与上级区块「${name}」重叠`;
    case "outside-parent":
      return `超出「${name}」的范围`;
    case "level-out-of-range":
      return `已达最深层级（共 ${levelCount} 级）`;
    case "total-limit":
      return `区块总数已达上限 ${REGION_TOTAL_LIMIT}，请先合并或清除`;
    default: {
      // 穷尽性检查：新增 code 而忘了加文案时，这里会编译失败
      const exhaustive: never = code;
      return `无法创建区块（${String(exhaustive)}）`;
    }
  }
}

/**
 * 正在编辑的地名草稿。
 *
 * 【为什么要有 `id: null` 这一态】「加标注」是"先给位置、拿到文字才落库"的两段式：
 * 空文本不许进文档（看不见也点不中的幽灵对象）。所以草稿要么是"改一条已有的"
 * （id 有值），要么是"还没建的"（id 为 null，提交时才 `addLabel`）。
 */
interface LabelDraft {
  /** 已有标注 id；`null` = 尚未落库的新地名 */
  id: string | null;
  /** 输入框定位点（画布本地 CSS 像素） */
  screen: { x: number; y: number };
  /** 落位世界坐标（新建时写进文档；改文案时用不到） */
  world: { x: number; y: number };
  /** 输入框当前内容 */
  text: string;
}

/**
 * MapEditorPage —— 地图编辑器主页面。
 *
 * 职责：组装「素材面板 + 画布 + 工具栏」，把画布事件翻译成编辑器动作。
 * 全部状态由 useMapEditor 持有；本组件只做编排与 UI，不含数据逻辑。
 */
export default function MapEditorPage() {
  const { message, modal } = AntApp.useApp();
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({ width: 0, height: 0 });
  /**
   * 「生成陆地」是否**同时划出区块**（R-REG-02）。
   *
   * 【为什么默认 false】用户诉求是"生成大地图后地图上保持干净"，而旧版「生成陆地」
   * 会连带把区块一起切出来 —— 病根在入口而不在生成算法：`doc.regions = []` 这个
   * 状态数据层与渲染层早已支持（`createEmptyDocument()` 初始就是空数组）。
   *
   * 【为什么是组件状态而不是文档字段】它是"下一次点击的行为"，不是成品内容；
   * 进文档会白占一步撤销栈，也会让"关掉窗口再打开"这种无关紧要的偏好变成数据。
   */
  const [splitRegions, setSplitRegions] = useState(false);
  /**
   * 手填的陆地种子（文本态）。
   *
   * 【为什么要能手填】评审要靠截图判断观感变化（PRD §8.3 要求"每张都带同一
   * 随机种子"），而随机种子每次都不一样，改前改后根本不可比。留空 = 随机。
   *
   * 【为什么用 Input 而不是 InputNumber】种子是"抄一个数进来复现同一块陆地"的场景，
   * 文本框足够；而 `InputNumber` 在这个页面里只属于层级配置浮层（层数 / 每级数量），
   * 混进一个"长得一样但不是层级"的数字框会让 aria-label 与肉眼都难分辨。
   */
  const [seedText, setSeedText] = useState<string>("");
  /**
   * 「加标注」工具是否处于激活态。
   *
   * 激活后画布单击 = 给这个位置起个名（进入编辑态），与"待放置素材"是互斥的
   * 两种落位意图 —— 同时开着的话一次点击到底该落山还是起名就说不清了。
   */
  const [pendingLabel, setPendingLabel] = useState(false);
  /** 正在编辑的地名草稿（null = 没在编辑） */
  const [draft, setDraft] = useState<LabelDraft | null>(null);
  /** 属性区「地名」输入框的本地草稿（null = 跟随文档值） */
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  /**
   * 新建地名用的字号档（PRD §4.4：手动选，不按层级自动绑）。
   *
   * 【为什么是页面状态而不是文档字段】它是"下一次落笔的字号"，不是某条地名的
   * 属性 —— 每条地名各自存 `size`（见 `MapLabel.size`），这里只是工具栏的笔。
   * 放进文档会白白多一个跟撤销栈耦合的状态。
   */
  const [labelSize, setLabelSize] = useState<MapLabelSize>(LABEL_DEFAULT_SIZE);

  /** 地图库弹窗是否展开（切换 / 新建 / 改名 / 绑定作品 / 回收站） */
  const [libraryOpen, setLibraryOpen] = useState(false);

  /** 一键成图弹层（B3）与其最近一次摘要 */
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [genSummary, setGenSummary] = useState<string | null>(null);

  /* ───────────────── 画区状态机（R-REG-03 / 架构 §2.7） ───────────────── */

  /** 当前工具（缺省"选择"）。与 `pendingLabel` / `pendingSpriteId` 三者互斥 */
  const [tool, setTool] = useState<MapTool>("select");
  /**
   * 已落顶点（世界坐标，首尾**不重复**）。
   *
   * 【为什么顶点进 state、光标预览点不进】顶点是**低频且已确定**的（一次单击一个），
   * 它还必须参与工具栏「已画 N 点」的渲染；而光标预览点跟着 `pointermove` 每像素
   * 变一次，进 state 等于每像素一次 React 提交 + 一次 200 多块区块容器的 diff
   * （架构 §2.6.1 的性能底线）。因此预览点只活在画布的 `draftCursorRef` 里。
   *
   * 【为什么是 `Point[]` 而不是 `readonly Point[]`】只有页面写它，且写的方式是
   * "整体换新数组"（`[...prev, world]` / `slice(0, -1)`）—— 不可变更新的前提是
   * 可变类型，否则 `push` 也编得过。
   */
  const [draftPoints, setDraftPoints] = useState<Point[]>([]);
  /**
   * 折线绘制态的已落控制点（世界坐标）。与 `draftPoints` 同构 —— 两者互斥
   * （工具只有一个），但**不能共用一个数组**：画区是"闭合的面"、折线是"开放的线"，
   * 同一串点在两种语义下的校验、预览、落库方式完全不同。
   */
  const [polylinePoints, setPolylinePoints] = useState<Point[]>([]);
  /**
   * 当前折线样式档（绘制态与属性面板共用）。
   *
   * 【为什么在页面而不是文档】它是"下一次落笔用哪档"的工具状态，不是任何一条线的
   * 属性；线自身的样式存在 `MapPolyline.styleId` 里。放文档会让"换个样式"变成
   * 一次需要撤销的文档编辑。
   */
  const [polylineStyleId, setPolylineStyleId] = useState(DEFAULT_POLYLINE_STYLE_ID);

  /* ───────────────── 导出（B5 / PRD §6.6.3） ───────────────── */

  /** 导出长边像素档（1024 / 2048 / 4096，默认 2048） */
  const [exportSize, setExportSize] = useState<ExportSize>(EXPORT_DEFAULT_SIZE);
  /** 导出中：按钮转圈并禁用（一次只允许一个导出，切块期间画面会被临时改写） */
  const [exporting, setExporting] = useState(false);
  /**
   * 画布交出的场景句柄。
   *
   * 【为什么用 ref + 一个布尔 state 两份】ref 给事件回调取用（不引起重渲染）；
   * 布尔 state 只用来控制"导出按钮能不能点" —— 它是 UI 状态，必须参与渲染。
   */
  const sceneRef = useRef<MapSceneHandle | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const handleSceneReady = useCallback((scene: MapSceneHandle | null) => {
    sceneRef.current = scene;
    setSceneReady(scene !== null);
  }, []);

  /**
   * 导出 PNG。
   *
   * 【分两步：先渲染成字节，再落盘】渲染失败/取消与环境不支持必须区分开 ——
   * 前者是 bug（要报错），后者（jsdom、无 2D 上下文）只该给一句提示。
   *
   * 【落盘只走 `exportBinary`】`exportFile` 是 utf8 写，写 PNG 会得到一个打不开
   * 的文件且**零报错**（AGENTS §2.1）。这条纪律钉在 `export.ts` 与它的测试里。
   */
  const handleExport = useCallback(async () => {
    const scene = sceneRef.current;
    if (!scene || exporting) return;
    setExporting(true);
    try {
      const bytes = await exportMapPng(
        {
          renderer: scene.renderer,
          stage: scene.stage,
          world: scene.world,
          worldRect: scene.rect,
          clearOverlay: scene.clearOverlay,
          redrawOverlay: scene.redrawOverlay,
        },
        exportSize,
      );
      if (!bytes) {
        message.error("当前环境不支持导出图片");
        return;
      }
      const saved = await savePng(bytes, `地图-${exportSize}.png`);
      if (saved) message.success(`已导出：${saved}`);
      else message.info("已取消导出");
    } catch {
      message.error("导出失败，请重试");
    } finally {
      // 无论成败都要解锁：卡在转圈里比导出失败更让人绝望
      setExporting(false);
    }
  }, [exportSize, exporting, message]);
  /** 文本 → 种子；非法或留空时为 null（= 随机） */
  const landSeed = useMemo(() => {
    const n = Number.parseInt(seedText.trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }, [seedText]);
  const editor = useMapEditor(canvasSize);
  const {
    doc,
    viewport,
    selectedId,
    selectedRegionId,
    selectedRegion,
    /** 选中的折线（B4-2）：属性面板与节点编辑都只认它 */
    selectedPolylineId,
    selectedPolyline,
    /** 当前文档的**有效**层级定义（读时回落；层数的唯一事实源 = `schema.length`） */
    schema,
    /** 选中区块的祖先链 + 自身（供面板面包屑；非叶子才显示） */
    regionPath,
    /** 选中区块是否叶子（决定画布三笔 / 容器态，以及面板是否给面包屑） */
    selectedIsLeaf,
    pendingSpriteId,
    images: textures,
    imagesReady,
    canUndo,
    canRedo,
    levelAlphas,
    /** 当前主导层级（`null` = 还没生成区块）。新放置的素材就归到这一级 */
    currentLevel,
  } = editor;

  /* ───────────────── 存档（map.db）：自动保存 / 启动恢复 ───────────────── */

  /**
   * 地图存档编排：启动打开最近一张（没有就新建）、800ms 防抖自动保存、
   * 乐观锁冲突处理、关窗 flush。页面只消费它的状态与动作。
   */
  const persistence = useMapPersistence();

  /**
   * 切到某张图之后：有存档视口就恢复「上次看到哪」，没有就适应窗口。
   *
   * 【为什么不能在 hook 里直接落位】视口要过 `zoomLimits`（它由该图的区块数反推），
   * 而 zoomLimits 是 `useMapEditor` 的派生值 —— 只有页面同时握着两者。
   * 【依赖只列 docId 与画布宽度】`editor` / `persistence` 每次渲染都是新对象，
   * 放进依赖会让这个 effect 每渲染跑一次（每次都"恢复视口"，等于画面锁死）。
   */
  useEffect(() => {
    if (!persistence.docId || canvasSize.width === 0) return;
    const saved = persistence.takePendingViewport();
    if (saved) editor.applyViewport(saved);
    else editor.fitView();
  }, [persistence.docId, canvasSize.width]);

  /**
   * 打开地图库（先在当前场景上抓一张 320px 缩略图给列表用）。
   *
   * 【为什么抓图放在开库之前】列表卡片靠缩略图区分"东洲全图"与"北境详图"，
   * 而缩略图只有在场景就绪时才生成得出。一次 320px extract 只要几十毫秒；
   * 失败静默（列表回落占位图），绝不允许它挡住开库。
   */
  const handleOpenLibrary = useCallback(async () => {
    const scene = sceneRef.current;
    if (scene && persistence.docId) {
      try {
        const bytes = await exportMapPng(
          {
            renderer: scene.renderer,
            stage: scene.stage,
            world: scene.world,
            worldRect: scene.rect,
            clearOverlay: scene.clearOverlay,
            redrawOverlay: scene.redrawOverlay,
          },
          320,
        );
        if (bytes) await persistence.saveThumb(bytes);
      } catch {
        // 缩略图是可选项：失败不提示、不阻塞
      }
    }
    setLibraryOpen(true);
  }, [persistence]);

  /**
   * 手画区块数量（`origin === "manual"`，缺省读作生成块）。
   *
   * 【为什么页面要关心它】重新生成区块时手画成果与生成块的几何会叠在一张图上
   * （生成器不知道手画块存在）。这类"看起来只是多了一层色块"的后果不该静默发生，
   * 所以确认弹窗里要先报数量（PRD §6-D / 架构 §6-5）。
   */
  const manualCount = useMemo(
    () => doc.regions.reduce((n, r) => (r.origin === "manual" ? n + 1 : n), 0),
    [doc.regions],
  );

  /**
   * 自动生成的区块数量（总数 − 手画数）。
   *
   * 【为什么要分开数】「生成陆地」「重新生成区块」这两条路径**只替换自动块**，
   * 手画块原样保留（主理人裁决 1）。所以文案里"会被清掉的 N 个"必须只数自动块 ——
   * 报总数会让用户以为手画成果也要没了，从而不敢点。
   */
  const autoCount = doc.regions.length - manualCount;

  /**
   * 选中区块的子树摘要（供面板按钮文案与 `disabled`）。
   *
   * 【为什么在页面算而不是面板算】`RegionPanel` 是纯展示组件（不读 store、不碰文档），
   * 子树信息要遍历 `doc.regions`，只有页面拿得到（架构 §6-2）。
   * 叶子 ⇒ `count = 0`（`planMerge` 返回 `null`），面板据此 disabled。
   */
  const subtreeInfo = useMemo(() => {
    if (!selectedRegion) return { count: 0, withSubmap: 0 };
    const plan = planMerge(doc.regions, selectedRegion.id);
    return plan
      ? { count: plan.descendantIds.length, withSubmap: plan.withSubmap.length }
      : { count: 0, withSubmap: 0 };
  }, [selectedRegion, doc.regions]);

  /* ───────────────── 画区：层级判定与闭合 ───────────────── */

  /**
   * 新块将要落在的层级。
   *
   * 【层级与父块**只有这一处**判定】有选中区块 P ⇒ `parentId = P.id`、`level = P.level + 1`；
   * 无选中 ⇒ `parentId = null`、`level = 0`。三处（工具栏指示、落点前的封顶拦截、
   * `addManualRegion` 里真正构造记录）读的都是这一条规则 —— 各算一遍必然出现
   * "指示说在画洲、落库成了国家"这类只在边界复现的错。
   *
   * 落库那次计算在 hook 里（`addManualRegion` 从 store 现取 `selectedRegionId`），
   * 本变量只服务界面上的**预告**；两者同式，因为父块在"进入画区 → 落点 → 闭合"
   * 之间不会变（画区态下左键不改变选中，见裁决 4）。
   */
  const targetLevel = selectedRegion ? selectedRegion.level + 1 : 0;

  /** 目标层级是否已越过 schema 的最后一层（工具栏标红 + 落点前拦截） */
  const targetLevelOverflow = targetLevel > schema.length - 1;

  /**
   * 闭合草稿：校验 → 落库 → 清空并**留在画区模式**（便于连续画）。
   *
   * 【失败时草稿必须保留】用户画了 12 个点，跨出父边界被打回，草稿若被清掉就等于
   * 让他从第 1 个点重画 —— 这是"提示了但更糟"。`checkManualRegion` 的所有拒绝分支
   * 都会走到 `return`，`setDraftPoints([])` 只在成功之后执行。
   *
   * 【< 3 点静默返回，不弹「至少需要 3 个顶点」】四条入口里「完成」是 disabled、
   * Enter 有 ≥3 门槛，但**双击不等 3 点**（判定只看时间差与屏幕距离）：刚落 1~2 个
   * 点就在原地连点两下，是"我在定位"而不是"我要收尾"，此时弹一句红字纯属噪音。
   * 点数现状由工具栏的「已画 N 点」持续表达，不需要一次性的告警。
   *
   * 【成功也不改动选中】画完一块不自动选中它：自动选中会让**下一次**落点的层级
   * 悄悄变成"刚画的这块的子级"（因为层级跟着选中走），而用户的心智是"我还在这层
   * 继续画"。要往下画一层，明确点选父块即可。
   */
  const closeDraft = useCallback(() => {
    if (draftPoints.length < 3) return;
    const result = editor.addManualRegion(draftPoints);
    if (!result.ok) {
      message.error(rejectTextOf(result.code, result.conflict, schema.length));
      return;
    }
    setDraftPoints([]);
    message.success(`已创建区块「${result.region.name}」（可撤销）`);
  }, [draftPoints, editor, message, schema.length]);

  /**
   * 切工具。
   *
   * 【切换到任一工具都要清掉另外两个落位意图】三种"左键要干什么"同时开着时，
   * 一次点击该落顶点、该放素材还是该起名就说不清了。选择 store 里的
   * `pendingSpriteId` 也一并清（它来自素材面板的点击）。
   *
   * 【离开画区要丢草稿，且**不产生快照**】草稿从来没进过文档，丢它不影响撤销栈；
   * 留着的话下次进画区会看到上次的残线，用户会以为"上次已经画上了"。
   */
  const handlePickTool = useCallback(
    (next: MapTool) => {
      // 已经在该工具上：什么都不做。
      // 【为什么必须提前返回】用户画到第 5 个顶点时手滑再点一次「画区」，
      // 若无条件 `setDraftPoints([])`，那 5 个点就没了 —— 而"再点一次同一个按钮"
      // 在心智上更像"确认"而不是"重来"。要重来有明确的「取消」。
      if (next === tool) return;
      if (next === "draw" || next === "polyline") {
        setPendingLabel(false);
        editor.setPendingSpriteId(null);
      }
      // 换工具一律丢草稿，且**不产生快照**（草稿从没进过文档）；
      // 留着的话下次进画区会看到上次的残线，用户会以为"上次已经画上了"。
      setDraftPoints([]);
      setPolylinePoints([]);
      setTool(next);
    },
    [editor, tool],
  );

  /** 撤销上一点（退到 0 点仍留在画区模式：用户只是画错了第一笔） */
  const handleUndoDraftPoint = useCallback(() => {
    setDraftPoints((prev) => prev.slice(0, -1));
  }, []);

  /**
   * 取消画区（与 `Esc` 完全同一套退让顺序，一个按钮一个快捷键，语义不会分叉）：
   *   ① 有草稿 ⇒ 只丢草稿（留在画区，可重画）；
   *   ② 没草稿 ⇒ 退出画区回选择模式。
   *
   * 【为什么按钮永远可点】"没画任何点"时它承担"退出画区"的职责 —— 若按点数
   * disabled，用户就只能再去点一次顶部的「选择」，而且会以为按钮坏了。
   */
  const handleCancelDraft = useCallback(() => {
    if (draftPoints.length > 0) {
      setDraftPoints([]);
      return;
    }
    handlePickTool("select");
  }, [draftPoints.length, handlePickTool]);

  /* ───────────────── 折线（B4-2 / R-MAP-26） ───────────────── */

  /**
   * 收尾折线：≥2 点落库（并自动选中，属性面板随即浮出），<2 点直接丢弃，两者都退出绘制态。
   *
   * 【为什么 <2 点也算"收尾"而不是留在模式里】用户点了一下就按 Enter，意图是
   * "我画完了"（只是画错了），不是"我还要接着画"。留在模式里会让他下一次点击
   * 变成给这条残线续点，而画面上什么都没有 —— 表现为"点了没反应"。
   *
   * 【为什么不弹成功提示】画线是高频动作（一张图几十条），每条都弹一句会把画布
   * 下方的提示区刷满。落库后线立刻可见 + 属性面板浮出，本身就是最直接的反馈。
   *
   * @param options `closed: true` = 首尾相连（湖岸/轮廓）。只在"点回起点"这条
   *   路径里传；按钮 / Enter 的调用即便误传事件对象，`options?.closed` 也是
   *   undefined，不会意外闭合 —— 这是用对象参数而不是布尔参数的原因。
   */
  const finishPolyline = useCallback(
    (options?: { closed?: boolean }) => {
      if (polylinePoints.length >= 2) {
        editor.addPolyline(polylinePoints, {
          styleId: polylineStyleId,
          closed: options?.closed === true,
        });
      }
      setPolylinePoints([]);
      setTool("select");
    },
    [polylinePoints, polylineStyleId, editor],
  );

  /** 退一个控制点（画错了往回退，不影响已落库的线） */
  const handleUndoPolylinePoint = useCallback(() => {
    setPolylinePoints((prev) => prev.slice(0, -1));
  }, []);

  /** 取消折线绘制（与「画区」同款两级退让：有草稿只丢草稿，没草稿退出工具） */
  const handleCancelPolyline = useCallback(() => {
    if (polylinePoints.length > 0) {
      setPolylinePoints([]);
      return;
    }
    handlePickTool("select");
  }, [polylinePoints.length, handlePickTool]);

  /* ───────────────── 文字标注（B3 / PRD §6.3.3） ───────────────── */

  /** 选中的素材（属性区据此决定要不要显示「地名」输入框） */
  const selectedElement = useMemo(
    () => (selectedId ? doc.elements.find((e) => e.id === selectedId) ?? null : null),
    [doc.elements, selectedId],
  );
  /** 选中素材已绑定的地名（有则回填进输入框） */
  const selectedElementLabel = editor.elementLabelOf(selectedId);
  /** 输入框显示值：本地草稿优先，否则跟随文档 */
  const elementNameValue = nameDraft ?? selectedElementLabel?.text ?? "";

  /**
   * 换选中对象时丢掉上一个的地名草稿。
   *
   * 否则会把 A 的名字带进 B 的输入框 —— 而"还没输入"和"输入了但没提交"在界面上
   * 长得一模一样，用户一失焦就把 A 的名字写到了 B 身上。
   */
  useEffect(() => {
    setNameDraft(null);
  }, [selectedId]);

  /**
   * 双击标注 → 打开编辑框。
   *
   * `screen` 是画布用 `worldToScreen` 算好的 CSS 像素坐标（它持有真实像素几何）；
   * 这里只管定位，页面**不得**再换算一次（AGENTS 硬约定 1）。
   */
  const handleLabelEditRequest = useCallback(
    (id: string, screen: { x: number; y: number }) => {
      const label = doc.labels.find((l) => l.id === id);
      if (!label) return;
      setDraft({ id, screen, world: { x: label.x, y: label.y }, text: label.text });
    },
    [doc.labels],
  );

  /**
   * 结束地名编辑。
   *
   * @param keep true = 提交（回车 / 失焦），false = 放弃（Esc）
   *
   * 【空文本的两层语义】新建时输入空文本 = 什么都不做（空文本不创建）；
   * 改已有标注时清空 = 删除它（留一个看不见的对象比删除更糟）。
   */
  const finishDraft = useCallback(
    (keep: boolean) => {
      const current = draft;
      setDraft(null);
      if (!current || !keep) return;
      const text = current.text.trim();
      if (!text) {
        if (current.id) editor.removeLabel(current.id);
        return;
      }
      if (current.id) editor.updateLabel(current.id, { text });
      else editor.addLabel({ ...current.world, text, level: currentLevel, size: labelSize });
    },
    [draft, editor, currentLevel, labelSize],
  );

  /**
   * 属性区「地名」提交。
   *
   * 【提交前必须先比对文本】`commit` 是无条件记账的：文本没变还提交一次，会在
   * 撤销栈里塞一步"空变更"，用户连按 Ctrl+Z 会看到画面毫无反应。
   */
  const handleElementNameCommit = useCallback(() => {
    if (!selectedId) return;
    const next = elementNameValue.trim();
    const prev = selectedElementLabel?.text ?? "";
    setNameDraft(null);
    if (next === prev) return;
    editor.setElementLabel(selectedId, next, labelSize);
  }, [editor, selectedId, elementNameValue, selectedElementLabel, labelSize]);

  /**
   * 改字号档。
   *
   * 【为什么要顺手改"当前选中素材的联动地名"】字号是"给这条地名换一档"的动作，
   * 而选区里正好有一条联动地名时，用户的心智就是"改它"。只改"下次新建用哪档"
   * 会得到"我在下拉里选了 16，画面上还是 12"—— 与 §4.4 要求的手动可调相悖。
   * 走 `updateLabel` 是为了进撤销栈（字号属于成品）。
   */
  const handleLabelSizeChange = useCallback(
    (next: MapLabelSize) => {
      setLabelSize(next);
      const linked = editor.elementLabelOf(selectedId);
      if (linked && linked.size !== next) editor.updateLabel(linked.id, { size: next });
    },
    [editor, selectedId],
  );

  /**
   * 工具栏的层级指示。
   *
   * 直接复用画布那份权重（`levelAlphas`），而不是另算一遍 —— 两边各算一次
   * 迟早会在边界处出现"工具栏说当前是郡、画面明明是国"的不一致。
   */
  const visibleLevels = levelAlphas
    .map((alpha, level) => ({ level, alpha }))
    .filter((v) => v.alpha > LEVEL_CHIP_EPSILON);

  /**
   * 各层级已有的素材数量。
   *
   * 【为什么要在界面上说这个】素材是按层级显隐的（在郡那级摆的山，缩到洲去看就
   * 该退场），于是用户很容易把"缩出去山没了"当成丢数据。这里把每一级的存量摆到
   * 层级胶囊的悬浮说明里，让人一眼看到"山还在，只是属于郡那一级"。
   */
  const elementCountsByLevel = useMemo(() => {
    const counts: number[] = [];
    let loose = 0;
    for (const el of doc.elements) {
      const level = resolveElementLevel(el.level, levelAlphas.length);
      if (level === null) loose += 1;
      else counts[level] = (counts[level] ?? 0) + 1;
    }
    const parts = counts
      .map((n, level) => (n > 0 ? `${levelLabelOf(schema, level)} ${n}` : ""))
      .filter(Boolean);
    if (loose > 0) parts.push(`层级无关 ${loose}`);
    return parts.join(" · ");
  }, [doc.elements, levelAlphas.length, schema]);

  /**
   * 画布点击。
   *
   * 【契约】入参是**世界坐标** —— 由 MapCanvas 用画布真实像素几何换算好再传来。
   * 早期版本在这里又调了一次 `toWorld`，等于把换算做了两遍：
   *   世界坐标被二次当作屏幕坐标换算 → 素材落点远离光标（缩放越小偏得越狠），
   *   同时命中测试的输入也失真 → 点击永远选不中素材（一选就取消选中）。
   * 两处报障（只能拖一次 / 缩放时落位偏移很远）即由此而来。
   */
  const handleCanvasClickWorld = useCallback(
    (world: { x: number; y: number }) => {
      // ── 画区分支（必须最先）─────────────────────────────────────────────
      //
      // 【为什么必须在 pendingLabel / pendingSpriteId 之前】画区态下左键的语义
      // **只有一种**：落一个顶点。若把落顶点排在后面，"上次开过加标注还没落位"
      // 的一次点击会去起名、把顶点吞掉 —— 表现为"画区模式下点哪儿都不落点"。
      // 进入画区时已经清掉了那两个意图（`handlePickTool`），这里的顺序是第二道保险。
      //
      // ⚠️ 本分支内**不得**调用任何选中动作（`pickRegion` / `setSelectedId`）：
      // 画区态在已有区块上点一下，选区必须纹丝不动（裁决 4 / 模式隔离用例）。
      //
      // 【闭合判定不在这里】"双击 / 命中首顶点"是画布在 `pointerdown` 里判的，
      // 一旦命中就不会再回调到这里（见 MapCanvas 的 `handlePointerDown`）。
      // 本分支只负责**落一个顶点**，于是"闭合"在整条链路上只有一个出口
      // ——`closeDraft`（双击 / 首顶点 / Enter / 「完成」四条入口都通向它）。
      if (tool === "draw") {
        const px = 1 / Math.max(1e-6, viewport.scale);

        // 同点去重：手抖在同一位置点两下（间隔 > 350ms，所以没被判成双击）不该
        // 多出一个重合顶点 —— 那会让闭合校验以 `degenerate-edge` 把整条草稿打回。
        // 容差复用 `DRAFT_CLOSE_PX`：与"能不能点到首顶点""算不算双击"同一把尺子
        // （理由见该常量注释：这个距离以下，用户自己也分不清是不是同一个点）。
        const last = draftPoints[draftPoints.length - 1];
        if (last && Math.hypot(world.x - last.x, world.y - last.y) <= DRAFT_CLOSE_PX * px) {
          return;
        }

        // 层级封顶：**落点前**拦，不等闭合。
        // 等到闭合再拦意味着用户花了 12 次点击才被告知"这一层根本不能再画"。
        if (targetLevelOverflow) {
          message.warning(`已达最深层级（共 ${schema.length} 级）`);
          return;
        }

        setDraftPoints((prev) => [...prev, world]);
        return;
      }

      // ── 折线绘制态（B4-2）─────────────────────────────────────────────
      //
      // 与画区态同一套"落一个点 / 同点去重"的规矩，但**不做层级封顶**：
      // 折线没有"必须比父块小一级"的语义（一条路可以横穿几个郡），硬套层级校验
      // 会让用户在郡这一级根本画不出跨区的主路。
      if (tool === "polyline") {
        const px = 1 / Math.max(1e-6, viewport.scale);
        // 点回起点附近（≥3 点）= 闭合收尾（B4-3）：湖岸 / 势力轮廓的正确画法
        // 就是绕一圈回到出发点，容差与"同点去重"同一把尺子（DRAFT_CLOSE_PX）
        if (polylinePoints.length >= 3) {
          const first = polylinePoints[0];
          if (Math.hypot(world.x - first.x, world.y - first.y) <= DRAFT_CLOSE_PX * px) {
            finishPolyline({ closed: true });
            return;
          }
        }
        const last = polylinePoints[polylinePoints.length - 1];
        if (last && Math.hypot(world.x - last.x, world.y - last.y) <= DRAFT_CLOSE_PX * px) {
          return;
        }
        setPolylinePoints((prev) => [...prev, world]);
        return;
      }

      // 「加标注」优先：此刻用户的心智是"给这个地方起名"，不是"选/放素材"
      if (pendingLabel) {
        setDraft({
          id: null,
          // 输入框要贴在这个位置：屏幕坐标只能由 coords.ts 换算
          screen: worldToScreen(world, viewport, canvasSize),
          world,
          text: "",
        });
        setPendingLabel(false);
        return;
      }
      if (pendingSpriteId) {
        // 手工落位避让（P2-3）：落点被已有素材"看得见的盒 + 呼吸边"压住时拒绝
        // 落位。待放素材**保持选中**（不清 pendingSpriteId），用户换个位置再点
        // 即可 —— 这比"吞掉这一次点击"友好，也比"把已有素材挤开"克制。
        if (editor.placeSprite(pendingSpriteId, world)) {
          editor.setPendingSpriteId(null);
        } else {
          message.warning("落点与已有素材重叠：换个位置，或先把压住的素材拖开");
        }
        return;
      }

      // 素材命中优先于区块命中：素材是"面上的点"、z 序在区块之上，且比区块更具体，
      // 点在一个素材上时用户的心智是"选这个素材"，而不是"选它底下的那块地"。
      // 只有没点中素材时，才退而求其次判断"是否点中了某块地"。
      const hit = editor.pickElement(world);
      if (hit) {
        editor.setSelectedRegionId(null);
        editor.setSelectedPolylineId(null);
        editor.setSelectedId(hit.id);
        return;
      }

      // 素材层被锁时的**明确提示**（B4-1）。
      //
      // 【为什么再问一次】`pickElement` 在锁定时一律返回 null —— 用户点在自己的
      // 山上却"什么都没发生"，只会认为功能坏了。这里用 ignoreLock 复问一次，
      // 确认"确实点中了东西、只是被锁住了"，然后说清楚而不是静默。
      // 除提示外，任何编辑路径都不得传 ignoreLock。
      if (layerLockedOf(doc, "element") && editor.pickElement(world, { ignoreLock: true })) {
        message.info("「素材」层已锁定，先解锁再编辑");
        return;
      }

      // ── 折线命中（B4-2）：排在素材之后、区块之前 ──
      //
      // z 序就是答案：线在素材之下、区块之上，命中也按这个顺序问一遍
      // （否则"点在一条穿过素材的河上"会选中底下的区块，与画面上看到的不一致）。
      const lineHit = editor.pickPolyline(world);
      if (lineHit) {
        editor.setSelectedId(null);
        editor.setSelectedRegionId(null);
        editor.setSelectedPolylineId(lineHit.id);
        // 属性面板里的"样式"回填这条线自己的样式，接着画新线也沿用它 ——
        // 用户改完一条官道的粗细，下一条默认还是官道
        setPolylineStyleId(lineHit.styleId);
        return;
      }
      if (editor.polylineLayerLocked && editor.pickPolyline(world, { ignoreLock: true })) {
        message.info("「折线」层已锁定，先解锁再编辑");
        return;
      }

      // 没点中素材：判断是否命中区块（区块是"面"），命中则选中该区块、清素材选中。
      // 区块层锁定同理：命中但不可选，给一次提示。
      const regionLocked = layerLockedOf(doc, "region");
      for (let i = doc.regions.length - 1; i >= 0; i -= 1) {
        const region = doc.regions[i];
        if (!hitTestPolygon(world, region.polygon)) continue;
        if (regionLocked) {
          message.info("「区块」层已锁定，先解锁再编辑");
          return;
        }
        editor.pickRegion(region.id);
        // 选中区块时清掉另外两类选中（三者互斥）
        editor.setSelectedPolylineId(null);
        return;
      }

      // 素材、折线、区块都没命中（点空白）：清空三类选中
      editor.setSelectedRegionId(null);
      editor.setSelectedId(null);
      editor.setSelectedPolylineId(null);
    },
    [
      editor,
      pendingLabel,
      pendingSpriteId,
      viewport,
      canvasSize,
      doc.regions,
      doc.layerState,
      tool,
      draftPoints,
      polylinePoints,
      finishPolyline,
      targetLevelOverflow,
      schema.length,
      message,
    ],
  );

  /** 开始拖拽已选中元素：把当前快照压入撤销栈（全程只记一次） */
  const handleElementDragStart = useCallback(() => {
    editor.commitDragStart(doc);
  }, [editor, doc]);

  /* ───────────────── 折线节点的拖拽 / 增删（B4-2） ───────────────── */

  /**
   * 开始拖折线节点：同样只压一次快照。
   *
   * 【为什么复用 `commitDragStart(doc)` 而不是另立一个】撤销账目只该有一种记法：
   * "拖拽开始时把当前文档拍一张"。素材与折线若各写一套，迟早出现一个入了栈、
   * 一个忘了，表现为"拖完按 Ctrl+Z，线没退回去"。
   */
  const handlePolylineNodeDragStart = useCallback(() => {
    editor.commitDragStart(doc);
  }, [editor, doc]);

  const handlePolylineNodeMove = useCallback(
    (index: number, world: Point) => {
      if (!selectedPolylineId) return;
      editor.movePolylinePoint(selectedPolylineId, index, world);
    },
    [editor, selectedPolylineId],
  );

  const handlePolylinePointInsert = useCallback(
    (index: number, world: Point) => {
      if (!selectedPolylineId) return;
      editor.insertPolylinePoint(selectedPolylineId, index, world);
    },
    [editor, selectedPolylineId],
  );

  const handlePolylinePointDelete = useCallback(
    (index: number) => {
      if (!selectedPolylineId) return;
      editor.deletePolylinePoint(selectedPolylineId, index);
    },
    [editor, selectedPolylineId],
  );

  /** 拖拽中：按世界坐标增量移动，保持抓取点与元素的相对位置不变 */
  const handleElementDragDelta = useCallback(
    (dxWorld: number, dyWorld: number) => {
      if (!selectedId) return;
      editor.moveElementBy(selectedId, dxWorld, dyWorld);
    },
    [editor, selectedId],
  );

  /**
   * 工具栏的缩放按钮。
   *
   * 【为什么只收方向、不收倍率】按钮此前写成 `handleZoom(1.2)` / `handleZoom(1/1.2)`，
   * 读起来像"每点一次 ×1.2"，实际倍率却由 `editor.handleWheel` 统一决定（1.1），
   * 这里传进去的数只被拿去判正负 —— 把 1.2 改成 1.5 不会有任何效果，纯属会骗人的
   * 死数字（写单测时就险些按 1.2 去推缩放档位）。改成只传方向后，步长只剩
   * handleWheel 一个出处。
   */
  const handleZoom = useCallback(
    (direction: "in" | "out") => {
      // 以画布中心为锚点做按钮缩放
      editor.handleWheel(direction === "in" ? -1 : 1, {
        x: canvasSize.width / 2,
        y: canvasSize.height / 2,
      });
    },
    [editor, canvasSize],
  );

  const handleDelete = useCallback(() => {
    if (!selectedId) {
      message.info("请先选中一个素材");
      return;
    }
    // 锁定层的删除按钮仍然可点（面板外的入口），但要说清楚为什么没删 ——
    // 静默无反应是最差的结果（B4-1 §3.4）
    if (layerLockedOf(doc, "element")) {
      message.info("「素材」层已锁定，先解锁再编辑");
      return;
    }
    editor.removeSelected();
  }, [editor, selectedId, doc.layerState, message]);

  const handleClear = useCallback(() => {
    if (doc.elements.length === 0) {
      message.info("画布已是空的");
      return;
    }
    // 锁定层不能被整批清掉（`editor.clearAll` 里还有一道守卫，这里是给提示的）
    if (layerLockedOf(doc, "element")) {
      message.info("「素材」层已锁定，先解锁再清空");
      return;
    }
    modal.confirm({
      title: "清空画布",
      content: `将移除全部 ${doc.elements.length} 个素材，此操作可撤销。`,
      okText: "清空",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => editor.clearAll(),
    });
  }, [editor, doc.elements.length, doc.layerState, modal, message]);

  /**
   * 用新的随机种子重新生成一棵层级区块树（每次结果都不同）。
   *
   * 【不再传层级数】层数的唯一事实源是 `regionSchemaOf(doc).length`
   * （架构 §4-T3）。工具栏的 `levelDepth` 组件状态已删除 —— 两处各存一份层数，
   * 迟早出现"面板显示 2 级、生成出 4 级"。
   */
  const handleGenerateRegions = useCallback(() => {
    editor.regenerateHierarchy();
  }, [editor]);

  /**
   * 【层级配置回调已随面板下线（2.42.0）】区域只有国家一级，无层级可配；
   * `setRegionSchema` / `regenerateHierarchy` 保留在 hook 层（老文档回落默认
   * schema 时仍会用到）。
   */

  /**
   * 生成陆地。
   *
   * 【为什么要先确认】生成陆地会**改写区块状态**：自动生成的区块按勾选态决定
   * "重划"还是"清空"，而**手动区块一律保留**（主理人裁决 1 —— 手画成果是最贵的
   * 用户成果，不能被一次生成抹掉）。文案因此三分：
   *   · 勾选「同时划出区块」⇒「重新划分（现有 N 个自动区块会被替换 [，保留 M 个手动区块]）」；
   *   · 不勾且存在自动块 ⇒「将清除 N 个自动生成的区块 [，保留 M 个手动区块]」；
   *   · 不勾且全是手动块 ⇒「现有区块都是手动区块，将原样保留」。
   * 只要 `manualCount > 0`，无论勾不勾都**必须**追加那句坐标系提醒：手画块是按
   * **旧陆地**画的，新陆地一到，它可能整体落在海面上 —— 这一步静默发生最伤。
   */
  const handleGenerateLand = useCallback(() => {
    const run = () => editor.generateLand(landSeed ?? undefined, { splitRegions });
    if (doc.regions.length > 0) {
      const keepNote = manualCount > 0 ? `，保留 ${manualCount} 个手动区块` : "";
      let content = splitRegions
        ? `将重新划分区块（现有 ${autoCount} 个自动生成的区块会被替换${keepNote}），此操作可撤销。`
        : autoCount > 0
          ? `将清除 ${autoCount} 个自动生成的区块${keepNote}，此操作可撤销。`
          : "现有区块都是手动区块，将原样保留，此操作可撤销。";
      if (manualCount > 0) {
        content +=
          "注意：手动区块是基于当前陆地绘制的，重新生成陆地后可能不在新大陆范围内。";
      }
      modal.confirm({
        title: "生成陆地",
        content,
        okText: "生成",
        cancelText: "取消",
        onOk: run,
      });
      return;
    }
    run();
  }, [editor, landSeed, splitRegions, doc.regions.length, autoCount, manualCount, modal]);

  /** 清除陆地：海岸四层随之消失 */
  const handleClearLand = useCallback(() => {
    editor.clearLand();
  }, [editor]);

  /* ───────────────── 一键成图（B3 / R-MAP-21） ───────────────── */

  /**
   * 生成 / 局部重掷的入口（弹层转来）。
   *
   * 【首次生成前的确认】画布已有内容、且这些内容**不是**本会话生成器产出时
   * （`!editor.hasGenerated`），「生成一张」会整体替换陆地 / 素材 / 地名 ——
   * 必须先说清楚。局部重掷按钮只在 hasGenerated 后可用，天然不进这条确认；
   * 生成器自己产出的图被再次重掷不再确认，否则"换一张"会被确认框打断节奏。
   */
  const handleGenerate = useCallback(
    (params: GeneratorParams, gear: GeneratorGear): string => {
      const hasContent = doc.elements.length > 0 || doc.regions.length > 0 || doc.land !== null;
      const run = (): string => {
        const summary = editor.generateFullMap(params, gear);
        if (summary) setGenSummary(summary);
        return summary;
      };
      if (gear === "all" && hasContent && !editor.hasGenerated) {
        modal.confirm({
          title: "一键成图",
          content: "将替换当前陆地、素材与地名（区块按弹层开关处理），此操作可撤销。",
          okText: "生成",
          cancelText: "取消",
          onOk: run,
        });
        // 确认框路径下摘要由 onOk 里更新；这里返回空串 = 弹层摘要保持原值
        return "";
      }
      return run();
    },
    [doc.elements.length, doc.regions.length, doc.land, editor, modal],
  );

  /* ───────────────── 嵌套子地图（区块操作面板） ───────────────── */

  /** 圈定生成子图（路径 B） */
  /**
   * 圈定生成子图（路径 B）。
   *
   * 【为什么生成完立刻把视口推进去】子图生成后**画面上几乎看不出变化** ——
   * 它只在原区块内部多了一层更细的分区线，而此刻视口可能还停在整张纸上，
   * 那些线细到看不见。用户点完按钮会以为"没反应"。所以这里一步到位：
   * 生成 → 聚焦 → 面板切换成"已嵌入子图"，让"进入子图"这个动作有明确结果。
   */
  const handleCarveSubmap = useCallback(
    (regionId: string) => {
      editor.carveSubmap(regionId);
      editor.focusRegion(regionId);
      message.success("已生成子图并进入该区域，可继续放大查看分区细节");
    },
    [editor, message],
  );

  /** 把视口推进到某个区块（进入子图 / 从子图回到该区域） */
  const handleFocusRegion = useCallback(
    (regionId: string) => {
      editor.focusRegion(regionId);
    },
    [editor],
  );

  /** 回到整张纸（退出子图视野） */
  const handleFocusWorld = useCallback(() => {
    editor.fitView();
  }, [editor]);

  /**
   * 绑定已有子图（路径 A′，nested-submap-main §4.1.1）：
   * 先弹跨图选择器挑一张图，确认后再拉全量文档、拷贝构造、落库。
   *
   * 【为什么分两步而不是点击即绑】绑定要用户在多张图里做选择（语义上是个
   * 「打开文件」动作），一步到位的隐式绑定（比如绑最近一张）几乎一定不是
   * 用户想要的。
   */
  const [submapPickerOpen, setSubmapPickerOpen] = useState(false);
  const [embedTargetRegionId, setEmbedTargetRegionId] = useState<string | null>(null);
  const handleEmbedSubmap = useCallback(
    (regionId: string) => {
      setEmbedTargetRegionId(regionId);
      setSubmapPickerOpen(true);
    },
    [setEmbedTargetRegionId, setSubmapPickerOpen],
  );

  /** 选择器确认：拉全量 → 拷贝构造 → 绑定落库（embedSubmap 自带一步撤销） */
  const handleSubmapPick = useCallback(
    async (docId: string, title: string) => {
      setSubmapPickerOpen(false);
      const regionId = embedTargetRegionId;
      setEmbedTargetRegionId(null);
      if (!regionId) return;
      const loaded = await loadMapDocById(docId);
      if (!loaded) {
        message.error("这张地图打不开了（可能已被删除）");
        return;
      }
      editor.embedSubmap(regionId, submapFromDoc(loaded.doc));
      message.success(`已绑定「${title}」（拷贝快照，可撤销）`);
    },
    [editor, embedTargetRegionId, message, setEmbedTargetRegionId, setSubmapPickerOpen],
  );

  /** 移除区块上的子图 */
  const handleRemoveSubmap = useCallback(
    (regionId: string) => {
      editor.removeSubmap(regionId);
      message.success("已移除子图");
    },
    [editor, message],
  );

  /**
   * 合并子树（PRD §4.3 / §6-C）：把选中区块的**全部后代**删掉，它自己成为叶子。
   *
   * 【四段文案，一段都不能省】
   *   ① 总数 + 最多 3 个名字（再多就「…等 N 个」）—— 让用户能认出是不是自己想的那几块；
   *   ② ⚠ 段：被删子树里带子图的数量 + 名字。子图会**一起消失**且没有回收站，
   *      这是本操作唯一不可逆的副作用（能撤销，但用户可能已经连按了几次 Ctrl+Z）；
   *   ③ P 自身有子图时额外一行"子图保留"—— 否则用户会以为连自己也清了；
   *   ④ 结尾两句固定文案：边界不变 + 可一步撤销。
   *
   * 【为什么先 `planMerge` 再让 store 再算一遍】预览是为了显示数字，执行是为了真的删。
   * 让执行信任传入的计划，等于把"文档可能已被改动"的责任推给调用方（架构 §3.4）。
   */
  const handleMergeRegion = useCallback(
    (regionId: string) => {
      const plan = planMerge(doc.regions, regionId);
      if (!plan) {
        message.info("该区块没有子区域");
        return;
      }
      const root = plan.root;
      const rootName = root.name.trim() || "未命名区块";
      const total = plan.descendantIds.length;
      const names = plan.descendants
        .slice(0, 3)
        .map((r) => r.name.trim())
        .filter(Boolean);
      const nameLine = names.length > 0 ? names.join("、") : `共 ${total} 个子区块`;
      const withSubmap = plan.withSubmap.length;
      const submapNames = plan.withSubmap
        .slice(0, 3)
        .map((r) => r.name.trim())
        .filter(Boolean);

      const content = (
        <div className="map-editor__merge-confirm">
          <p>{`将「${rootName}」下的 ${total} 个子区块合并为一个：`}</p>
          <p>{`${nameLine}${total > 3 ? ` …等 ${total} 个` : ""}`}</p>
          {withSubmap > 0 && (
            <p className="map-editor__merge-warn">
              {`⚠ 其中 ${withSubmap} 个区块关联了子地图（${submapNames.join(" / ")}${
                withSubmap > 3 ? ` …等 ${withSubmap} 个` : ""
              }）。`}
              <br />
              {`合并后这 ${withSubmap} 张子地图的内容会一并删除。`}
            </p>
          )}
          {root.submap && <p>该区块已关联子地图，合并后子地图保留。</p>}
          <p className="map-editor__merge-note">
            {`合并后「${rootName}」成为最小单位，其边界保持原样。`}
            <br />
            此操作可撤销（Ctrl+Z 一步恢复）。
          </p>
        </div>
      );

      modal.confirm({
        title: "合并子区域",
        content,
        okText: "仍要合并",
        okButtonProps: { danger: true },
        cancelText: "取消",
        onOk: () => {
          const result = editor.mergeSubtree(regionId);
          message.success(`已合并 ${result.removed} 个子区块（可撤销）`);
        },
      });
    },
    [doc.regions, editor, message, modal],
  );

  // ── 键盘快捷键：Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z 重做、Delete 删除 ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // 输入框内不劫持快捷键（后续加入重命名等输入场景时必要）
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      // 焦点在滑杆上时，方向键属于滑杆本身（antd 内建键盘步进）：
      // 不拦会"滑杆动一格、素材也挪一步"，两个消费者抢同一组键
      if (target?.closest?.("[role='slider']")) return;

      const mod = e.ctrlKey || e.metaKey;
      // Ctrl/Cmd+S：显式存一次（自动保存之外的唯一手动出口；不弹提示，
      // 因为工具栏的保存指示本身就是反馈 —— 再弹一个"已保存"会打断画图）
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void persistence.saveNow();
        return;
      }
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        // Windows 习惯的重做键
        e.preventDefault();
        editor.redo();
      } else if (mod && e.key.toLowerCase() === "c") {
        // ── 剪贴板（R-MAP-25；B4-3 起折线同享）：应用内剪贴板，不与系统剪贴板互通 ──
        if (!selectedId && !selectedPolylineId) return;
        e.preventDefault();
        editor.copySelected();
      } else if (mod && e.key.toLowerCase() === "x") {
        if (!selectedId && !selectedPolylineId) return;
        e.preventDefault();
        editor.cutSelected();
      } else if (mod && e.key.toLowerCase() === "v") {
        // 粘贴不要求选中（贴到剪贴板源位置附近再拖）；空剪贴板由 store 静默拦
        e.preventDefault();
        editor.pasteClipboard();
      } else if (mod && e.key.toLowerCase() === "d") {
        if (!selectedId && !selectedPolylineId) return;
        e.preventDefault();
        editor.duplicateSelected();
      } else if (e.key === "Enter" && tool === "draw") {
        // Enter 闭合草稿（与「完成」按钮同一动作）。< 3 点由 `closeDraft` 静默拦掉
        e.preventDefault();
        closeDraft();
      } else if (e.key === "Enter" && tool === "polyline") {
        // Enter 收尾折线（与「完成」按钮同一动作）。< 2 点由 `finishPolyline` 丢弃
        e.preventDefault();
        finishPolyline();
      } else if (!mod && (e.key === "Delete" || e.key === "Backspace") && tool === "polyline") {
        // 折线绘制中：退一个控制点。**线还没落库**，所以这里不能走文档撤销 ——
        // 那会把用户上一步的素材操作撤掉，而草稿上的点纹丝不动。
        //
        // 【这条以前是个 bug 的来源】早期这里写成了"Delete 一律 closeDraft()"，
        // 于是选择素材后按 Delete 只会去关一个不存在的草稿（<3 点直接 return），
        // 素材永远删不掉。撤点与删对象是两个动作，必须靠 `tool` 分清。
        e.preventDefault();
        handleUndoPolylinePoint();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        // 折线优先：选中折线时 Delete 删的是这条线（属性面板的删除按钮同款）
        if (selectedPolylineId) {
          e.preventDefault();
          editor.removePolyline(selectedPolylineId);
          return;
        }
        if (!selectedId) return;
        e.preventDefault();
        editor.removeSelected();
      } else if (e.key === "Escape") {
        // ── Esc 的四级退让（架构 §2.7 + B4-2）──────────────────────────
        //   ① 有草稿 ⇒ 只清草稿，**不动选中**：画到一半按 Esc 不该把父块选丢了，
        //      否则"进入/退出子级"这件事会在一次误按后静默重置；
        //   ② 无草稿但还在画区 / 折线 ⇒ 回选择模式（真退出）；
        //   ③ 否则走既有 Esc 分支（清各种中间态与选中）。
        if (draftPoints.length > 0) {
          setDraftPoints([]);
          return;
        }
        if (polylinePoints.length > 0) {
          setPolylinePoints([]);
          return;
        }
        if (tool !== "select") {
          setTool("select");
          return;
        }
        editor.setPendingSpriteId(null);
        editor.setSelectedId(null);
        editor.setSelectedRegionId(null);
        editor.setSelectedPolylineId(null);
        // 标注的两种中间态也一起收掉：Esc 的语义是"退出当前操作"
        setPendingLabel(false);
        setDraft(null);
      } else {
        // ── 方向键 / WASD 微移（R-MAP-25，无修饰键时）─────────────────
        // 精调档 4 个世界单位；Shift 加速档 16（大图上跨半个郡用）。
        // 绘制态不微移：那时左键在落顶点，键盘微移只添乱。
        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        const dir = NUDGE_DIRS[key];
        if (dir && (selectedId || selectedPolylineId) && tool === "select") {
          e.preventDefault();
          const step = e.shiftKey ? NUDGE_STEP_FAST : NUDGE_STEP_FINE;
          editor.nudgeSelected(dir[0] * step, dir[1] * step);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    editor,
    selectedId,
    selectedPolylineId,
    tool,
    draftPoints.length,
    polylinePoints.length,
    closeDraft,
    finishPolyline,
    handleUndoPolylinePoint,
    persistence.saveNow,
  ]);

  return (
    <div className="map-editor">
      {/* ── 工具栏 ── */}
      <div className="map-editor__toolbar">
        {/*
          地图库入口（最左）：显示"我在改哪张图" + 存档状态。
          【为什么放最左而不是收进「更多」】切图是低频但高权重的动作
          （改错图 = 一下午白干），当前文件名必须一直在眼前。
        */}
        <div className="map-editor__toolbar-group">
          <Tooltip title="地图库：切换 / 新建 / 重命名 / 绑定作品">
            <Button
              size="small"
              icon={<DatabaseOutlined />}
              onClick={() => void handleOpenLibrary()}
            >
              {/*
                标题自己包一层 span 做省略：地图名可到 40 字，直接让按钮撑开会把
                工具栏后半截挤到换行；而 antd Button 内部结构不是稳定契约，
                不去给它里面的节点写选择器。
              */}
              <span className="map-editor__library-title">{persistence.title || "地图库"}</span>
            </Button>
          </Tooltip>
          <Tooltip title={MAP_SAVE_STATUS_TEXT[persistence.status]}>
            <span
              className={`map-editor__save-dot map-editor__save-dot--${persistence.status}`}
              role="status"
              aria-label={MAP_SAVE_STATUS_TEXT[persistence.status]}
            />
          </Tooltip>
        </div>

        <Divider orientation="vertical" />

        <div className="map-editor__toolbar-group">
          <Tooltip title="撤销 (Ctrl+Z)">
            <Button
              size="small"
              icon={<UndoOutlined />}
              disabled={!canUndo}
              onClick={editor.undo}
            />
          </Tooltip>
          <Tooltip title="重做 (Ctrl+Shift+Z)">
            <Button
              size="small"
              icon={<RedoOutlined />}
              disabled={!canRedo}
              onClick={editor.redo}
            />
          </Tooltip>
        </div>

        <Divider orientation="vertical" />

        <div className="map-editor__toolbar-group">
          <Tooltip title="删除选中 (Delete)">
            <Button
              size="small"
              icon={<DeleteOutlined />}
              disabled={!selectedId}
              onClick={handleDelete}
            />
          </Tooltip>
        </div>

        <Divider orientation="vertical" />

        {/*
          工具切换：选择 / 画区（R-REG-03）。
          【为什么是两个 Button 而不是 Segmented】`Segmented` 渲染的是 radio，
          键盘与读屏语义是"选项"；这里切换的是**指针语义**（点一下会发生什么），
          按按钮理解才对，也更便于按可访问名取用（`getByRole("button", {name:"画区"})`）。
        */}
        <div className="map-editor__toolbar-group">
          {/*
            三个模式按钮图标化（B1）：文字版曾把工具栏挤到换行，而模式的含义
            Tooltip 一句话就够。可访问名不丢 —— aria-label 与原文案一致，
            测试与读屏都按名字取用。
          */}
          <Tooltip title="选择：点击区块 / 素材进行选中与拖动">
            <Button
              size="small"
              type={tool === "select" ? "primary" : "default"}
              icon={<BorderOutlined />}
              aria-label="选择"
              aria-pressed={tool === "select"}
              onClick={() => handlePickTool("select")}
            />
          </Tooltip>
          <Tooltip title="画区：在画布上逐点勾勒一个区块（Enter 闭合、Esc 取消、双击闭合）">
            <Button
              size="small"
              type={tool === "draw" ? "primary" : "default"}
              icon={<HighlightOutlined />}
              aria-label="画区"
              aria-pressed={tool === "draw"}
              onClick={() => handlePickTool("draw")}
            />
          </Tooltip>
          <Tooltip title="折线：逐点画道路 / 河流 / 山脊 / 势力边界（Enter 收尾、Esc 取消、双击收尾）">
            <Button
              size="small"
              type={tool === "polyline" ? "primary" : "default"}
              icon={<NodeIndexOutlined />}
              aria-label="折线"
              aria-pressed={tool === "polyline"}
              onClick={() => handlePickTool("polyline")}
            />
          </Tooltip>
        </div>

        {/*
          折线动作区：只在折线态出现。
          样式下拉放在这里而不是属性面板里 —— "画之前先选档"比"画完再一个个改"顺，
          而属性面板负责的是"这条线现在长什么样"（两条入口改的是同一个 `styleId`）。
          【为什么没有"层级"指示】折线的层级取落笔时的主导层级（与素材同规则），
          但**不做**区块那种"父块决定层级"的约束：一条官道可以横穿几个郡。
        */}
        {tool === "polyline" && (
          <>
            <Divider orientation="vertical" />
            <div className="map-editor__toolbar-group map-editor__draw-actions">
              <Select
                size="small"
                className="map-editor__polyline-style"
                value={polylineStyleId}
                aria-label="折线样式"
                onChange={(v) => setPolylineStyleId(v)}
                options={POLYLINE_STYLES.map((s) => ({
                  value: s.id,
                  // 档名 + "什么时候用它"的一句话（下拉里就能选对，不必先画一条试试）
                  label: (
                    <span title={s.hint}>
                      {s.label}
                    </span>
                  ),
                }))}
              />
              <span className="map-editor__draw-count">{`已画 ${polylinePoints.length} 点`}</span>
              <Tooltip title="撤掉最后落下的那个控制点（Backspace）">
                <Button
                  size="small"
                  icon={<UndoOutlined />}
                  disabled={polylinePoints.length === 0}
                  aria-label="撤销一个折线控制点"
                  onClick={handleUndoPolylinePoint}
                >
                  撤销上一点
                </Button>
              </Tooltip>
              <Tooltip
                title={
                  polylinePoints.length < 2 ? "至少需要 2 个点才能成一条线" : "落库并选中（Enter）"
                }
              >
                <Button
                  size="small"
                  type="primary"
                  disabled={polylinePoints.length < 2}
                  aria-label="完成折线"
                  onClick={() => finishPolyline()}
                >
                  完成
                </Button>
              </Tooltip>
              <Tooltip title={polylinePoints.length > 0 ? "丢弃草稿（Esc）" : "退出折线"}>
                <Button size="small" aria-label="取消折线" onClick={handleCancelPolyline}>
                  取消
                </Button>
              </Tooltip>
            </div>
          </>
        )}

        {/*
          画区动作区：只在画区态出现。
          【为什么"层级"是只读指示】新块的层级由"当前选中哪一块"唯一决定（裁决 5），
          让用户在这里改层级就等于引入第二个事实源 —— 想换层级，去点选父块。
          【为什么「完成」在 <3 点时 disabled】三点才能构成面；给一个点了没反应的
          按钮比不给更糟（用户会反复点）。
        */}
        {tool === "draw" && (
          <>
            <Divider orientation="vertical" />
            <div className="map-editor__toolbar-group map-editor__draw-actions">
              <span
                className={
                  targetLevelOverflow
                    ? "map-editor__draw-level map-editor__draw-level--overflow"
                    : "map-editor__draw-level"
                }
                title={
                  targetLevelOverflow
                    ? `已达最深层级（共 ${schema.length} 级）：选一个更浅的区块再画`
                    : selectedRegion
                      ? `将作为「${selectedRegion.name}」的子区块`
                      : "未选中区块：将画在顶层"
                }
              >
                {/*
                  【层级文案为什么带 L 序号】只显示名称时，两个层级同名（用户可能把
                  两级都叫"区域"）就看不出自己在画第几层。`levelLabelOf` 对空名回落
                  成 `L{n}`，两者拼起来任何配置下都可读。
                  【2.42.0】层级已下线（schema 仅 1 级）：选中区块后再画必然越界，
                  此时不再拼"层级 L2 L2"这种双 L 回落串，直接给封顶提示。
                */}
                {targetLevelOverflow
                  ? `已达最深层级（共 ${schema.length} 级）`
                  : `层级 L${targetLevel + 1} ${levelLabelOf(schema, targetLevel)}`}
              </span>
              <span className="map-editor__draw-count">
                {`已画 ${draftPoints.length} 点 · 已用 ${doc.regions.length}/${REGION_TOTAL_LIMIT}`}
              </span>
              <Tooltip title="撤掉最后落下的那个顶点">
                <Button
                  size="small"
                  icon={<UndoOutlined />}
                  disabled={draftPoints.length === 0}
                  onClick={handleUndoDraftPoint}
                >
                  撤销上一点
                </Button>
              </Tooltip>
              <Tooltip
                title={
                  draftPoints.length < 3
                    ? "至少需要 3 个顶点才能闭合"
                    : "闭合多边形并创建区块（Enter）"
                }
              >
                <Button
                  size="small"
                  type="primary"
                  disabled={draftPoints.length < 3}
                  onClick={closeDraft}
                >
                  完成
                </Button>
              </Tooltip>
              <Tooltip title={draftPoints.length > 0 ? "丢弃草稿（Esc）" : "退出画区"}>
                <Button size="small" onClick={handleCancelDraft}>
                  取消
                </Button>
              </Tooltip>
            </div>
          </>
        )}

        <Divider orientation="vertical" />

        <div className="map-editor__toolbar-group">
          <Tooltip title="缩小">
            <Button size="small" icon={<ZoomOutOutlined />} onClick={() => handleZoom("out")} />
          </Tooltip>
          <span className="map-editor__zoom-label">
            {Math.round(viewport.scale * 100)}%
          </span>
          <Tooltip title="放大">
            <Button size="small" icon={<ZoomInOutlined />} onClick={() => handleZoom("in")} />
          </Tooltip>
          <Tooltip title="适应窗口">
            <Button size="small" icon={<ExpandOutlined />} onClick={editor.fitView} />
          </Tooltip>
        </div>

        {currentLevel !== null && (
          <>
            <Divider orientation="vertical" />
            <Tooltip
              title={
                `缩放 ${Math.round(viewport.scale * 100)}% · ` +
                visibleLevels
                  .map((v) => `${levelLabelOf(schema, v.level)} ${Math.round(v.alpha * 100)}%`)
                  .join(" · ") +
                (elementCountsByLevel ? `｜素材：${elementCountsByLevel}` : "")
              }
            >
              <span className="map-editor__level-chip">
                {visibleLevels.length > 1
                  ? visibleLevels.map((v) => levelLabelOf(schema, v.level)).join(" ↔ ")
                  : levelLabelOf(schema, currentLevel)}
              </span>
            </Tooltip>
          </>
        )}

        <Divider orientation="vertical" />

        {/*
          一键成图（B3 / R-MAP-21）：生成器入口。
          【为什么在「生成陆地」左边】它是"从零到一张图"的主路径（新用户第一下
          该点的按钮），「生成陆地」等手动动作降为进阶路径。
        */}
        <div className="map-editor__toolbar-group">
          <Tooltip title="随机生成整张图（陆地 + 素材 + 聚落与道路 + 地名，可撤销）">
            <Button
              size="small"
              icon={<PictureOutlined />}
              onClick={() => setGeneratorOpen(true)}
            >
              一键成图
            </Button>
          </Tooltip>
        </div>

        <Divider orientation="vertical" />

        <div className="map-editor__toolbar-group">
          <Tooltip
            title={
              splitRegions
                ? "生成陆地，并在陆地内部重新划分区块（手动区块保留，可撤销）"
                : "只生成陆地，不划分区块（自动区块清除，手动区块保留，可撤销）"
            }
          >
            <Button size="small" icon={<GlobalOutlined />} onClick={handleGenerateLand}>
              生成陆地
            </Button>
          </Tooltip>
          {/*
            「同时划出区块」（R-REG-02）：默认关。
            做成「生成陆地」的**配套下拉**而不是第二个按钮 —— 它是同一个动作的一个选项，
            分开放会让人以为是两条命令。用 `Switch` 而不是勾选菜单项：
            菜单项点一下就关闭，用户看不到"当前是开还是关"。
          */}
          <Dropdown
            trigger={["click"]}
            placement="bottomLeft"
            popupRender={() => (
              <div className="map-editor__land-options">
                <div className="map-editor__more-row map-editor__more-row--between">
                  <span className="map-editor__more-label">同时划出区块</span>
                  <Switch
                    size="small"
                    aria-label="同时划出区块"
                    checked={splitRegions}
                    onChange={setSplitRegions}
                  />
                </div>
                <div className="map-editor__land-options-hint">
                  勾选后与旧版一致（在陆地内逐岛切分）；默认只生成陆地，分区留给你手动划分。
                </div>
              </div>
            )}
          >
            {/*
              ⚠️ 可访问名不能含"生成陆地"（否则按 name=/生成陆地/ 取按钮会命中两个，
              既有页面用例会以 "found multiple elements" 变红，且那与被测行为无关）。
            */}
            <Button size="small" icon={<DownOutlined />} aria-label="陆地选项" />
          </Dropdown>
          {/*
            陆地种子（状态指示，保留在主栏）：生成陆地后紧跟按钮显示，评审/截图
            比对要靠它复现同一块陆地，收进「更多」会让它脱离操作上下文。
          */}
          {doc.land && <span className="map-editor__land-seed">seed {doc.land.seed}</span>}
          <Tooltip title="随机生成层级区块（每次结果都不同，可撤销）">
            <Button size="small" icon={<ThunderboltOutlined />} onClick={handleGenerateRegions}>
              生成区块
            </Button>
          </Tooltip>
          {/*
            层级配置（2.42.0 起下线）：区域只有国家一级，无层级可配 ——
            面板与入口一并移除（用户裁决：关闭层级功能）。
          */}
          {/*
            区块数（状态指示，保留在主栏）：这是「生成区块」后最重要的即时反馈，
            且多个端到端用例靠它确认生成完成，收进「更多」反而打断操作节奏。
          */}
          {doc.regions.length > 0 && (
            <span className="map-editor__region-count">已生成 {doc.regions.length} 块</span>
          )}
        </div>

        <Divider orientation="vertical" />

        <div className="map-editor__toolbar-group">
          <Tooltip title="在画布上单击落位，然后输入地名（回车确认、Esc 取消、空文本不创建）">
            <Button
              size="small"
              type={pendingLabel ? "primary" : "default"}
              icon={<EditOutlined />}
              aria-label="加标注"
              onClick={() => {
                // 与"待放置素材""画区"三者互斥：一次点击只能有一种落位意图
                setPendingLabel((v) => !v);
                editor.setPendingSpriteId(null);
                handlePickTool("select");
              }}
            />
          </Tooltip>
          {/*
            地名计数（状态指示，保留在主栏）：与「素材 N」同理，是「加标注」后
            的即时反馈，紧跟操作点。
            【素材的「地名」输入框已迁入属性面板（B1）】它是"选中对象的属性"，
            跟尺寸 / 旋转同一语境 —— 放工具栏等于把属性拆在两处。
          */}
          <span className="map-editor__label-count">地名 {doc.labels.length}</span>
        </div>

        <div className="map-editor__toolbar-spacer" />

        <Tooltip title="把当前地图导出成 PNG（成品图，不含选中框）">
          <Button
            size="small"
            type="primary"
            icon={<DownloadOutlined />}
            loading={exporting}
            disabled={!sceneReady}
            onClick={handleExport}
          >
            导出 PNG
          </Button>
        </Tooltip>

        {/*
          「更多」收纳面板：低频 / 需要状态说明的操作收进来，主工具栏只留高频，
          避免窗口较窄时工具栏换行错乱。用 popupRender 放 Select/Switch/Input
          （menu items 只适合纯按钮动作）。
        */}
        <Dropdown
          trigger={["click"]}
          placement="bottomRight"
          popupRender={() => (
            <div className="map-editor__more-panel">
              <div className="map-editor__more-row">
                <span className="map-editor__more-label">风格</span>
                <Select<MapStyle>
                  className="map-editor__select map-editor__select--style"
                  size="small"
                  value={doc.style}
                  style={{ width: 108 }}
                  options={MAP_STYLES.map((item) => ({ value: item.key, label: item.label }))}
                  onChange={editor.setStyle}
                />
              </div>
              <div className="map-editor__more-row">
                <span className="map-editor__more-label">底图</span>
                {/*
                  底图家族（B3）：4 档同风格海面/羊皮纸纹理，切换即时生效。
                  换底图走撤销栈（与风格同档）——切错了 Ctrl+Z 能回来。
                */}
                <Select
                  className="map-editor__select map-editor__select--base"
                  size="small"
                  value={doc.baseImageId}
                  style={{ width: 108 }}
                  options={BASE_IMAGES.map((b) => ({ value: b.id, label: b.label }))}
                  onChange={editor.setBaseImage}
                />
              </div>
              <div className="map-editor__more-row">
                <span className="map-editor__more-label">导出尺寸</span>
                <Select<ExportSize>
                  className="map-editor__select map-editor__select--export"
                  size="small"
                  value={exportSize}
                  style={{ width: 108 }}
                  options={EXPORT_SIZES.map((size) => ({ value: size, label: `${size}px` }))}
                  onChange={setExportSize}
                />
              </div>
              <div className="map-editor__more-row">
                <span className="map-editor__more-label">地名字号</span>
                <Select<MapLabelSize>
                  className="map-editor__select map-editor__select--label-size"
                  size="small"
                  value={labelSize}
                  style={{ width: 108 }}
                  options={LABEL_SIZES.map((size) => ({ value: size, label: `${size} 号` }))}
                  onChange={handleLabelSizeChange}
                />
              </div>
              <div className="map-editor__more-row">
                <span className="map-editor__more-label">陆地种子</span>
                <Input
                  size="small"
                  value={seedText}
                  placeholder="留空 = 随机"
                  style={{ width: 108 }}
                  onChange={(e) => setSeedText(e.target.value)}
                />
              </div>
              <div className="map-editor__more-row map-editor__more-row--between">
                <span className="map-editor__more-label">显示分区</span>
                <Switch
                  size="small"
                  checked={doc.showRegions}
                  onChange={editor.toggleRegions}
                />
              </div>
              <Divider style={{ margin: "8px 0" }} />
              <div className="map-editor__more-actions">
                <Button
                  size="small"
                  icon={<MinusCircleOutlined />}
                  disabled={!doc.land}
                  onClick={handleClearLand}
                >
                  清除陆地
                </Button>
                <Button
                  size="small"
                  icon={<MinusCircleOutlined />}
                  disabled={doc.regions.length === 0}
                  onClick={editor.clearRegions}
                >
                  清除区块
                </Button>
                <Button
                  size="small"
                  danger
                  icon={<ClearOutlined />}
                  disabled={doc.elements.length === 0}
                  onClick={handleClear}
                >
                  清空画布
                </Button>
              </div>
            </div>
          )}
        >
          <Button size="small" icon={<MoreOutlined />} />
        </Dropdown>

        <span className="map-editor__count">素材 {doc.elements.length}</span>
      </div>

      {/* ── 主体：左栏（素材库 + 图层）+ 右画布 ── */}
      <div className="map-editor__body">
        {/*
          左栏上下两段：上面"用什么画"（素材库，吃满剩余高度），下面"画在哪一层"
          （图层面板，固定 6 行）。同一栏内堆叠而不是新开一栏 —— 见 B4 PRD D2：
          逆向目标的图层组也在左栏，且 3 栏会把画布压窄。
        */}
        <div className="map-editor__left">
          <SpritePanel
            pendingSpriteId={pendingSpriteId}
            onPick={(id) => {
              // 选素材即退出「加标注」态与画区态：三种落位意图不能同时开着
              setPendingLabel(false);
              handlePickTool("select");
              editor.setPendingSpriteId(id);
            }}
          />
          <LayerPanel
            doc={doc}
            onToggleVisible={editor.toggleLayerVisible}
            onToggleLock={editor.toggleLayerLock}
          />
        </div>
        <div className="map-editor__canvas-area">
          <MapCanvas
            doc={doc}
            viewport={viewport}
            textures={textures}
            texturesReady={imagesReady}
            selectedId={selectedId}
            pendingSpriteId={pendingSpriteId}
            elementLocked={layerLockedOf(doc, "element")}
            labelLocked={layerLockedOf(doc, "label")}
            levelAlphas={levelAlphas}
            land={doc.land}
            style={doc.style}
            showRegions={doc.showRegions}
            selectedRegionId={selectedRegionId}
            /*
              画区草稿：`null` = 不在画区模式（画布据此区分"模式里但没落点"与"不在模式里"）。
              顶点以世界坐标直传 —— 画布持有真实像素几何，页面不再换算一次。
            */
            draftPoints={tool === "draw" ? draftPoints : null}
            onDraftClose={closeDraft}
            /*
              折线（B4-2）：数据、选中、锁定、绘制草稿四件事一起下去。
              `polylineDraft` 用 `null` 表示"不在折线模式"（同 `draftPoints` 的约定）。
            */
            polylines={editor.polylines}
            polylinesLocked={editor.polylineLayerLocked}
            selectedPolylineId={selectedPolylineId}
            polylineDraft={tool === "polyline" ? polylinePoints : null}
            polylineDraftStyleId={polylineStyleId}
            onPolylineDraftFinish={finishPolyline}
            onPolylineNodeDragStart={handlePolylineNodeDragStart}
            onPolylineNodeMove={handlePolylineNodeMove}
            onPolylinePointInsert={handlePolylinePointInsert}
            onPolylinePointDelete={handlePolylinePointDelete}
            labels={doc.labels}
            onLabelEditRequest={handleLabelEditRequest}
            onSceneReady={handleSceneReady}
            onSizeChange={setCanvasSize}
            onWheel={editor.handleWheel}
            onPan={editor.handlePan}
            onCanvasClickWorld={handleCanvasClickWorld}
            onElementDragStart={handleElementDragStart}
            onElementDragDelta={handleElementDragDelta}
          />
          {/*
            区块操作面板：选中区块后浮出，提供「圈定生成子图 / 绑定子图 / 移除子图」。
            只在 `selectedRegion` 非空时渲染（否则返回 null，见 RegionPanel）。
          */}
          <RegionPanel
            region={selectedRegion}
            schema={schema}
            regionPath={regionPath}
            isLeaf={selectedIsLeaf}
            subtreeInfo={subtreeInfo}
            onCarve={handleCarveSubmap}
            onEmbed={handleEmbedSubmap}
            onMerge={handleMergeRegion}
            onRemove={handleRemoveSubmap}
            onFocus={handleFocusRegion}
            onFocusWorld={handleFocusWorld}
            onClose={() => editor.setSelectedRegionId(null)}
          />
          {/*
            素材属性面板（R-MAP-23）：选中素材后浮出，"这个对象长什么样"的语境。
            与 RegionPanel 同位但互斥 —— 素材选中与区块选中本来就互斥（pickRegion /
            placeSprite 各自清对方），不会出现两块面板叠在一起。
          */}
          {selectedElement && (
            <ElementPanel
              element={selectedElement}
              spriteName={SPRITE_MAP[selectedElement.spriteId]?.label ?? selectedElement.spriteId}
              label={selectedElementLabel}
              schema={schema}
              nameDraft={nameDraft}
              onNameDraftChange={setNameDraft}
              onNameCommit={handleElementNameCommit}
              onUpdate={(patch, key) => editor.updateElement(selectedElement.id, patch, key)}
              onReorder={editor.reorderSelected}
              onDuplicate={() => editor.duplicateSelected()}
              onDelete={handleDelete}
              onClose={() => editor.setSelectedId(null)}
            />
          )}
          {/*
            折线属性面板（B4-2）：选中一条线后浮出，与素材面板同位、同样互斥。
            【为什么不在绘制态出现】绘制态下没有"选中的那条线" —— 草稿还没落库，
            改样式改的是"下一笔用哪档"，那是工具栏下拉的职责。
          */}
          {selectedPolyline && (
            <PolylinePanel
              polyline={selectedPolyline}
              schema={schema}
              onUpdate={(patch, key) => editor.updatePolyline(selectedPolyline.id, patch, key)}
              onDelete={() => editor.removePolyline(selectedPolyline.id)}
              onClose={() => editor.setSelectedPolylineId(null)}
            />
          )}
          {/*
            地名编辑覆盖层。
            【为什么用 DOM 而不是 Pixi Text】Pixi 没有输入控件，光标、选区、IME
            全得自己实现 —— 纯浪费。覆盖层用绝对定位贴在浮动坐标上，
            canvas 只负责"画"，编辑交给浏览器。
            【坐标】`draft.screen` 是画布本地 CSS 像素；`.map-canvas` 铺满
            `.map-editor__canvas-area`，两者左上角重合，所以可以直接放在这里。
          */}
          {/*
            【导出期间隐藏】`renderer.extract` 只截 WebGL 画布，理论上这个 DOM 输入框
            不会进图；但导出前后各有一条 `clearOverlay` / `redrawOverlay` 的时序，
            多留一个"看起来像内容"的浮动控件在画面上，人眼没法判断它到底有没有进图。
            索性在导出期间把它摘掉（`draft` 状态保留，导完自动恢复，不丢文字）。
          */}
          {draft && !exporting && (
            <Input
              className="map-canvas__label-input"
              size="small"
              autoFocus
              value={draft.text}
              style={{ left: draft.screen.x, top: draft.screen.y }}
              onChange={(e) => {
                const text = e.target.value;
                setDraft((d) => (d ? { ...d, text } : d));
              }}
              onBlur={() => finishDraft(true)}
              onKeyDown={(e) => {
                // ⚠️ IME 组字过程中的回车 / Esc 属于输入法（确认候选词 / 取消组字），
                // 若把它们当成"提交 / 取消"，中文输入第一个词就被截断。
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Enter") {
                  e.preventDefault();
                  finishDraft(true);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  finishDraft(false);
                }
              }}
            />
          )}
          <div className="map-editor__canvas-hint">
            {tool === "draw" ? (
              // 画区态换一套提示：此时"点击素材选中后拖动"是**错的**（左键只落顶点），
              // 留着原提示会让人以为画区坏了
              `画区：单击落一个顶点 · 点首顶点 / 双击 / Enter 闭合 · 「撤销上一点」退一格 · Esc 取消${
                targetLevelOverflow ? ` · ⚠ 已达最深层级（共 ${schema.length} 级）` : ""
              }`
            ) : (
              <>
                {/*
                  【层级链条从 schema 取，不写死】写死成「大陆 → 洲 → 国家 → 郡」时，
                  2.40.0 砍成三级后这行提示会变成"教用户一个不存在的层级"。
                  现在它跟着文档里的层级名走：改层数 / 改名不会留下过时文案。
                */}
                滚轮缩放（{schema.map((level) => level.name).join(" → ")} 连续衔接）· 拖动空白平移 · 点击素材选中后拖动可移动
                {" · 方向键 / WASD 微移（Shift 加速）· Ctrl+C/V 复制粘贴 · Ctrl+D 复制一份"}
                {" · 双击地名可改名 · 点击区块 → 圈定生成子图并自动进入（Esc 取消选中）"}
                {currentLevel === null
                  ? " · 素材不归属层级（未生成区块）"
                  : ` · 新素材归入「${levelLabelOf(schema, currentLevel)}」级`}
              </>
            )}
          </div>
        </div>
      </div>

      {/*
        地图库（弹窗）。所有写操作转给 `persistence`，弹窗自身只负责列表与局部交互；
        关掉弹窗不会中断编辑（它盖在画布上，画布状态原地保留）。
      */}
      <MapLibraryModal
        open={libraryOpen}
        currentId={persistence.docId}
        onClose={() => setLibraryOpen(false)}
        actions={{
          open: (id) => persistence.openDoc(id),
          create: (options) => persistence.createDoc(options),
          rename: (id, title) => persistence.renameDoc(id, title),
          remove: (id) => persistence.deleteDoc(id),
          restore: (id) => persistence.restoreDoc(id),
          purge: (id) => persistence.purgeDoc(id),
          bind: (id, workId) => persistence.bindWork(id, workId),
        }}
      />

      {/*
        一键成图弹层（B3）。摘要与五档重掷就地展示：生成完不把用户扔回工具栏
        （review §5.3 反馈断点）。弹层保持挂载 —— 关掉再开，参数与摘要还在。
      */}
      <MapGeneratorModal
        open={generatorOpen}
        onClose={() => setGeneratorOpen(false)}
        onGenerate={handleGenerate}
        summary={genSummary}
        hasGenerated={editor.hasGenerated}
        lastParams={editor.lastGeneratorParams}
      />

      {/*
        跨图选择器（路径 A′）。onPick 收摘要、页面拉全量并落库；
        关闭只收起弹窗，不动已选的区块（用户可能想换个区块再绑）。
      */}
      <SubmapPickerModal
        open={submapPickerOpen}
        currentDocId={persistence.docId}
        onClose={() => setSubmapPickerOpen(false)}
        onPick={(item) => void handleSubmapPick(item.id, item.title)}
      />
    </div>
  );
}
