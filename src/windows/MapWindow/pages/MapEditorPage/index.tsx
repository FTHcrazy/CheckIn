import { useCallback, useEffect, useMemo, useState } from "react";
import { App as AntApp, Button, Divider, InputNumber, Tooltip } from "antd";
import {
  ClearOutlined,
  DeleteOutlined,
  MinusCircleOutlined,
  RedoOutlined,
  ThunderboltOutlined,
  UndoOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  ExpandOutlined,
} from "@ant-design/icons";
import type { CanvasSize } from "./coords";
import { REGION_LEVELS, REGION_LEVEL_COUNT_LIMITS } from "./regions";
import { resolveElementLevel } from "./lod";
import { useMapEditor } from "./hooks/useMapEditor";
import MapCanvas from "./components/MapCanvas";
import SpritePanel from "./components/SpritePanel";
import "./index.scss";

/** 权重低于此值的层级不再出现在工具栏的指示里（与渲染层的阈值同源） */
const LEVEL_CHIP_EPSILON = 0.004;

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
      if (pendingSpriteId) {
        editor.placeSprite(pendingSpriteId, world);
        editor.setPendingSpriteId(null);
        return;
      }
      const hit = editor.pickElement(world);
      editor.setSelectedId(hit ? hit.id : null);
    },
    [editor, pendingSpriteId],
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
        </div>

        <div className="map-editor__toolbar-spacer" />
        <span className="map-editor__count">素材 {doc.elements.length}</span>
      </div>

      {/* ── 主体：左素材区 + 右画布 ── */}
      <div className="map-editor__body">
        <SpritePanel
          pendingSpriteId={pendingSpriteId}
          onPick={editor.setPendingSpriteId}
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
            onSizeChange={setCanvasSize}
            onWheel={editor.handleWheel}
            onPan={editor.handlePan}
            onCanvasClickWorld={handleCanvasClickWorld}
            onElementDragStart={handleElementDragStart}
            onElementDragDelta={handleElementDragDelta}
          />
          <div className="map-editor__canvas-hint">
            滚轮缩放（大陆 → 洲 → 国家 → 郡 连续衔接）· 拖动空白平移 · 点击素材选中后拖动可移动
            {currentLevel === null
              ? " · 素材不归属层级（未生成区块）"
              : ` · 新素材归入「${REGION_LEVELS[currentLevel].label}」级，缩放到别级会淡出`}
          </div>
        </div>
      </div>
    </div>
  );
}
