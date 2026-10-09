import { useCallback, useEffect, useState } from "react";
import { App as AntApp, Button, Divider, Tooltip } from "antd";
import {
  ClearOutlined,
  DeleteOutlined,
  RedoOutlined,
  UndoOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
  ExpandOutlined,
} from "@ant-design/icons";
import type { CanvasSize } from "./coords";
import { useMapEditor } from "./hooks/useMapEditor";
import MapCanvas from "./components/MapCanvas";
import SpritePanel from "./components/SpritePanel";
import "./index.scss";

/**
 * MapEditorPage —— 地图编辑器主页面。
 *
 * 职责：组装「素材面板 + 画布 + 工具栏」，把画布事件翻译成编辑器动作。
 * 全部状态由 useMapEditor 持有；本组件只做编排与 UI，不含数据逻辑。
 */
export default function MapEditorPage() {
  const { message, modal } = AntApp.useApp();
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({ width: 0, height: 0 });
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
  } = editor;

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
    editor.commitDragStart(doc.elements);
  }, [editor, doc.elements]);

  /** 拖拽中：按世界坐标增量移动，保持抓取点与元素的相对位置不变 */
  const handleElementDragDelta = useCallback(
    (dxWorld: number, dyWorld: number) => {
      if (!selectedId) return;
      editor.moveElementBy(selectedId, dxWorld, dyWorld);
    },
    [editor, selectedId],
  );

  const handleZoom = useCallback(
    (factor: number) => {
      // 以画布中心为锚点做按钮缩放
      editor.handleWheel(factor > 1 ? -1 : 1, {
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

        <Divider type="vertical" />

        <div className="map-editor__toolbar-group">
          <Tooltip title="缩小">
            <Button size="small" icon={<ZoomOutOutlined />} onClick={() => handleZoom(1 / 1.2)} />
          </Tooltip>
          <span className="map-editor__zoom-label">
            {Math.round(viewport.scale * 100)}%
          </span>
          <Tooltip title="放大">
            <Button size="small" icon={<ZoomInOutlined />} onClick={() => handleZoom(1.2)} />
          </Tooltip>
          <Tooltip title="适应窗口">
            <Button size="small" icon={<ExpandOutlined />} onClick={editor.fitView} />
          </Tooltip>
        </div>

        <Divider type="vertical" />

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
            onSizeChange={setCanvasSize}
            onWheel={editor.handleWheel}
            onPan={editor.handlePan}
            onCanvasClickWorld={handleCanvasClickWorld}
            onElementDragStart={handleElementDragStart}
            onElementDragDelta={handleElementDragDelta}
          />
          <div className="map-editor__canvas-hint">
            滚轮缩放 · 拖动空白平移 · 点击素材选中后拖动可移动
          </div>
        </div>
      </div>
    </div>
  );
}
