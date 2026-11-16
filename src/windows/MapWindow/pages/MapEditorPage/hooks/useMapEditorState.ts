/**
 * 地图编辑器编辑状态（§6.2.1 EditorState 层）。
 *
 * 只持有输入草稿、临时选择、工具档位与弹窗开关；不访问 IPC、不读文档数据。
 * 返回的键名与页面原本的局部变量同名，页面只做解构，不改变任何消费点。
 */
import { useMemo, useRef, useState } from "react";
import type { CanvasSize } from "../coords";
import { EXPORT_DEFAULT_SIZE, type ExportSize } from "../export";
import { DEFAULT_POLYLINE_STYLE_ID } from "../polylineStyle";
import type { Point } from "../regions";
import { LABEL_DEFAULT_SIZE, type MapLabelSize } from "../types";
import type { MapSceneHandle } from "../components/MapCanvas";
import type { LabelDraft, MapTool } from "../editorConstants";

export function useMapEditorState() {  const [canvasSize, setCanvasSize] = useState<CanvasSize>({ width: 0, height: 0 });
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

  const landSeed = useMemo(() => {
    const n = Number.parseInt(seedText.trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }, [seedText]);

  const [submapPickerOpen, setSubmapPickerOpen] = useState(false);
  const [embedTargetRegionId, setEmbedTargetRegionId] = useState<string | null>(null);

  return {
    canvasSize,
    setCanvasSize,
    splitRegions,
    setSplitRegions,
    seedText,
    setSeedText,
    pendingLabel,
    setPendingLabel,
    draft,
    setDraft,
    nameDraft,
    setNameDraft,
    labelSize,
    setLabelSize,
    libraryOpen,
    setLibraryOpen,
    generatorOpen,
    setGeneratorOpen,
    genSummary,
    setGenSummary,
    tool,
    setTool,
    draftPoints,
    setDraftPoints,
    polylinePoints,
    setPolylinePoints,
    polylineStyleId,
    setPolylineStyleId,
    exportSize,
    setExportSize,
    exporting,
    setExporting,
    sceneRef,
    sceneReady,
    setSceneReady,
    landSeed,
    submapPickerOpen,
    setSubmapPickerOpen,
    embedTargetRegionId,
    setEmbedTargetRegionId,
  };
}
