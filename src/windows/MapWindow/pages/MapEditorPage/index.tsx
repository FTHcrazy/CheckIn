import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App as AntApp, Button, Divider, Input, InputNumber, Select, Switch, Tooltip } from "antd";
import {
  ClearOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  GlobalOutlined,
  MinusCircleOutlined,
  RedoOutlined,
  ThunderboltOutlined,
  UndoOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  ExpandOutlined,
} from "@ant-design/icons";
import { worldToScreen, type CanvasSize } from "./coords";
import { REGION_LEVELS, REGION_LEVEL_COUNT_LIMITS } from "./regions";
import { resolveElementLevel } from "./lod";
import { MAP_STYLES } from "./style";
import { EXPORT_DEFAULT_SIZE, EXPORT_SIZES, exportMapPng, savePng, type ExportSize } from "./export";
import { useMapEditor } from "./hooks/useMapEditor";
import MapCanvas, { type MapSceneHandle } from "./components/MapCanvas";
import SpritePanel from "./components/SpritePanel";
import { LABEL_DEFAULT_SIZE, LABEL_SIZES, type MapLabelSize, type MapStyle } from "./types";
import "./index.scss";

/** 权重低于此值的层级不再出现在工具栏的指示里（与渲染层的阈值同源） */
const LEVEL_CHIP_EPSILON = 0.004;

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
  /** 下次生成区块用几个层级（工具栏可调，不影响已生成的区块） */
  const [levelDepth, setLevelDepth] = useState<number>(REGION_LEVEL_COUNT_LIMITS.default);
  /**
   * 手填的陆地种子（文本态）。
   *
   * 【为什么要能手填】评审要靠截图判断观感变化（PRD §8.3 要求"每张都带同一
   * 随机种子"），而随机种子每次都不一样，改前改后根本不可比。留空 = 随机。
   *
   * 【为什么用 Input 而不是 InputNumber】工具栏里已经有一个层级数的
   * InputNumber；再加一个数字框会让"唯一的 spinbutton"不再唯一，
   * 按 role 取层级数的既有用例会被迫改判据。种子本来就是"抄一个数"的场景，
   * 文本框足够。
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
    pendingSpriteId,
    images: textures,
    imagesReady,
    canUndo,
    canRedo,
    levelAlphas,
    /** 当前主导层级（`null` = 还没生成区块）。新放置的素材就归到这一级 */
    currentLevel,
  } = editor;

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
      .map((n, level) => (n > 0 ? `${REGION_LEVELS[level]?.label ?? `L${level}`} ${n}` : ""))
      .filter(Boolean);
    if (loose > 0) parts.push(`层级无关 ${loose}`);
    return parts.join(" · ");
  }, [doc.elements, levelAlphas.length]);

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
        editor.placeSprite(pendingSpriteId, world);
        editor.setPendingSpriteId(null);
        return;
      }
      const hit = editor.pickElement(world);
      editor.setSelectedId(hit ? hit.id : null);
    },
    [editor, pendingLabel, pendingSpriteId, viewport, canvasSize],
  );

  /** 开始拖拽已选中元素：把当前快照压入撤销栈（全程只记一次） */
  const handleElementDragStart = useCallback(() => {
    editor.commitDragStart(doc);
  }, [editor, doc]);

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
    editor.removeSelected();
  }, [editor, selectedId, message]);

  const handleClear = useCallback(() => {
    if (doc.elements.length === 0) {
      message.info("画布已是空的");
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
  }, [editor, doc.elements.length, modal, message]);

  /** 用新的随机种子重新生成一棵层级区块树（每次结果都不同） */
  const handleGenerateRegions = useCallback(() => {
    editor.regenerateHierarchy(levelDepth);
  }, [editor, levelDepth]);

  /**
   * 生成陆地。
   *
   * 【为什么要先确认】生成陆地会**连带重划区块**（否则区块会铺满整张纸、
   * 一半落在海里）。已有的区块会被替换，这一步必须让用户知道。
   */
  const handleGenerateLand = useCallback(() => {
    const run = () => editor.generateLand(landSeed ?? undefined, levelDepth);
    if (doc.regions.length > 0) {
      modal.confirm({
        title: "生成陆地",
        content: `将重新划分区块（现有 ${doc.regions.length} 块会被替换），此操作可撤销。`,
        okText: "生成",
        cancelText: "取消",
        onOk: run,
      });
      return;
    }
    run();
  }, [editor, landSeed, levelDepth, doc.regions.length, modal]);

  /** 清除陆地：海岸四层随之消失 */
  const handleClearLand = useCallback(() => {
    editor.clearLand();
  }, [editor]);

  // ── 键盘快捷键：Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z 重做、Delete 删除 ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // 输入框内不劫持快捷键（后续加入重命名等输入场景时必要）
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;

      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        // Windows 习惯的重做键
        e.preventDefault();
        editor.redo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (!selectedId) return;
        e.preventDefault();
        editor.removeSelected();
      } else if (e.key === "Escape") {
        editor.setPendingSpriteId(null);
        editor.setSelectedId(null);
        // 标注的两种中间态也一起收掉：Esc 的语义是"退出当前操作"
        setPendingLabel(false);
        setDraft(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editor, selectedId]);

  return (
    <div className="map-editor">
      {/* ── 工具栏 ── */}
      <div className="map-editor__toolbar">
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
          <Tooltip title="清空画布">
            <Button
              size="small"
              icon={<ClearOutlined />}
              disabled={doc.elements.length === 0}
              onClick={handleClear}
            />
          </Tooltip>
        </div>

        <Divider orientation="vertical" />

        {/* ── 陆地与海岸 ── */}
        <div className="map-editor__toolbar-group">
          <Tooltip title="陆地种子：留空 = 随机；填了可复现同一块陆地（截图比对用）">
            <Input
              size="small"
              value={seedText}
              placeholder="种子"
              style={{ width: 84 }}
              onChange={(e) => setSeedText(e.target.value)}
            />
          </Tooltip>
          <Tooltip title="生成陆地，并在陆地内部重新划分区块（可撤销）">
            <Button size="small" icon={<GlobalOutlined />} onClick={handleGenerateLand}>
              生成陆地
            </Button>
          </Tooltip>
          {doc.land && (
            <>
              <span className="map-editor__land-seed">seed {doc.land.seed}</span>
              <Tooltip title="清除陆地（海岸四层随之消失，区块保留）">
                <Button
                  size="small"
                  icon={<MinusCircleOutlined />}
                  onClick={handleClearLand}
                />
              </Tooltip>
            </>
          )}
        </div>

        <Divider orientation="vertical" />

        {/* ── 层级区块划分 ── */}
        <div className="map-editor__toolbar-group">
          <Tooltip title="生成几级行政区划：1 = 只切大陆，4 = 大陆 / 洲 / 国家 / 郡">
            <InputNumber
              size="small"
              min={REGION_LEVEL_COUNT_LIMITS.min}
              max={REGION_LEVEL_COUNT_LIMITS.max}
              value={levelDepth}
              style={{ width: 46 }}
              onChange={(v) =>
                setLevelDepth(typeof v === "number" ? v : REGION_LEVEL_COUNT_LIMITS.default)
              }
            />
          </Tooltip>
          <Tooltip title="随机生成层级区块（每次结果都不同，可撤销）">
            <Button size="small" icon={<ThunderboltOutlined />} onClick={handleGenerateRegions}>
              生成区块
            </Button>
          </Tooltip>
          {doc.regions.length > 0 && (
            <span className="map-editor__region-count">已生成 {doc.regions.length} 块</span>
          )}
          {currentLevel !== null && (
            <Tooltip
              title={
                `缩放 ${Math.round(viewport.scale * 100)}% · ` +
                visibleLevels
                  .map((v) => `${REGION_LEVELS[v.level].label} ${Math.round(v.alpha * 100)}%`)
                  .join(" · ") +
                (elementCountsByLevel ? `｜素材：${elementCountsByLevel}` : "")
              }
            >
              <span className="map-editor__level-chip">
                {visibleLevels.length > 1
                  ? visibleLevels.map((v) => REGION_LEVELS[v.level].label).join(" ↔ ")
                  : REGION_LEVELS[currentLevel].label}
              </span>
            </Tooltip>
          )}
          <Tooltip title="清除全部区块">
            <Button
              size="small"
              icon={<MinusCircleOutlined />}
              disabled={doc.regions.length === 0}
              onClick={editor.clearRegions}
            />
          </Tooltip>
          {/*
            「显示分区」开关。
            【为什么是 Switch 而不是按钮】它是一个**状态**（开/关），按钮是**动作**；
            用开关能让人一眼看出当前是开还是关，不必点一下才知道。
            【为什么不在这里额外 commit】`toggleRegions` 内部已经 commit（它进撤销栈，
            PRD §6.2 要求"切错了能撤销"）；外面再提交一次会让一次点击产生两个撤销步。
          */}
          <Tooltip title="显示分区色块与界线（关掉 = 给读者看的成品图，可撤销）">
            <Switch
              size="small"
              checked={doc.showRegions}
              onChange={editor.toggleRegions}
              checkedChildren="分区"
              unCheckedChildren="分区"
            />
          </Tooltip>
        </div>

        <Divider orientation="vertical" />

        {/* ── 文字标注 ── */}
        <div className="map-editor__toolbar-group">
          <Tooltip title="在画布上单击落位，然后输入地名（回车确认、Esc 取消、空文本不创建）">
            <Button
              size="small"
              type={pendingLabel ? "primary" : "default"}
              icon={<EditOutlined />}
              onClick={() => {
                // 与"待放置素材"互斥：一次点击只能有一种落位意图
                setPendingLabel((v) => !v);
                editor.setPendingSpriteId(null);
              }}
            >
              加标注
            </Button>
          </Tooltip>
          {/*
            字号档（PRD §4.4：手动选，不按层级自动绑）。
            【为什么放在这个位置】它紧挨着「加标注」，人一眼就能读出"我现在用多大字"。
            【为什么只有一个下拉】三档互斥、长期有效，是典型的"从固定集合里选一个"；
            三个并排按钮会把工具栏撑宽，也看不出当前是哪一档。
          */}
          <Tooltip title="地名字号：作用于新建标注与选中素材的联动地名">
            <Select<MapLabelSize>
              className="map-editor__select map-editor__select--label-size"
              size="small"
              value={labelSize}
              style={{ width: 72 }}
              options={LABEL_SIZES.map((size) => ({ value: size, label: `${size} 号` }))}
              onChange={handleLabelSizeChange}
            />
          </Tooltip>
          {/*
            素材地名：选中素材时才出现。
            它的"位置"不是这里填的 —— 地名固定浮在素材头顶 8 单位，
            之后跟着素材一起拖动、一起删除（见 useMapEditor 的 moveElementBy /
            removeSelected）。人只需要管文字。
          */}
          {selectedElement && (
            <Tooltip title="给选中的素材起个地名：会浮在它头顶，并随它移动、一起删除">
              <Input
                size="small"
                value={elementNameValue}
                placeholder="地名"
                style={{ width: 92 }}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={handleElementNameCommit}
                onKeyDown={(e) => {
                  // IME 组字中的回车属于输入法（确认候选词），不是"提交"
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleElementNameCommit();
                  }
                }}
              />
            </Tooltip>
          )}
          <span className="map-editor__label-count">地名 {doc.labels.length}</span>
        </div>

        <Divider orientation="vertical" />

        {/* ── 风格预设 + 导出 PNG（B4 / B5） ── */}
        <div className="map-editor__toolbar-group">
          {/*
            风格下拉。
            【为什么用 Select】三档互斥且长期有效，是典型的"从固定集合里选一个"；
            三个并排按钮会把工具栏撑宽，且看不出"当前是哪一档"。
            【为什么 onChange 走 editor.setStyle】它内部 commit（进撤销栈）——
            风格是成品的一部分，选错了应当能撤销回来；同值重复选择不会产生
            空撤销步（见 useMapEditor 的 setStyle）。
          */}
          <Tooltip title="全局配色：羊皮纸 / 墨色会连海岸一起重烘；切换可撤销">
            <Select<MapStyle>
              className="map-editor__select map-editor__select--style"
              size="small"
              value={doc.style}
              style={{ width: 88 }}
              options={MAP_STYLES.map((item) => ({ value: item.key, label: item.label }))}
              onChange={editor.setStyle}
            />
          </Tooltip>
          <Tooltip title="导出长边像素：1024 适合预览、2048 适合分享、4096 适合印刷">
            <Select<ExportSize>
              className="map-editor__select map-editor__select--export"
              size="small"
              value={exportSize}
              style={{ width: 84 }}
              options={EXPORT_SIZES.map((size) => ({ value: size, label: `${size}px` }))}
              onChange={setExportSize}
            />
          </Tooltip>
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
        </div>

        <div className="map-editor__toolbar-spacer" />
        <span className="map-editor__count">素材 {doc.elements.length}</span>
      </div>

      {/* ── 主体：左素材区 + 右画布 ── */}
      <div className="map-editor__body">
        <SpritePanel
          pendingSpriteId={pendingSpriteId}
          onPick={(id) => {
            // 选素材即退出「加标注」态：两种落位意图不能同时开着
            setPendingLabel(false);
            editor.setPendingSpriteId(id);
          }}
        />
        <div className="map-editor__canvas-area">
          <MapCanvas
            doc={doc}
            viewport={viewport}
            textures={textures}
            texturesReady={imagesReady}
            selectedId={selectedId}
            pendingSpriteId={pendingSpriteId}
            levelAlphas={levelAlphas}
            land={doc.land}
            style={doc.style}
            showRegions={doc.showRegions}
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
            滚轮缩放（大陆 → 洲 → 国家 → 郡 连续衔接）· 拖动空白平移 · 点击素材选中后拖动可移动
            {" · 双击地名可改名"}
            {currentLevel === null
              ? " · 素材不归属层级（未生成区块）"
              : ` · 新素材归入「${REGION_LEVELS[currentLevel].label}」级，缩放到别级会淡出`}
          </div>
        </div>
      </div>
    </div>
  );
}
