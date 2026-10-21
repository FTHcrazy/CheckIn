/**
 * 关系图画布（S2：可拖拽 + 拖入 / 拖回 + 成员记忆；S3：连线建关系 + 边选中）
 *
 * 选型 @xyflow/react 的唯一决定性理由：节点本身就是 React 组件，紧凑资料卡
 * 可以直接写 JSX，类型色直接吃 `--app-*`（四套主题零改造）。canvas 方案
 * （G6 / cytoscape）只能把卡片「画」出来，做不成可交互的 DOM 卡片。
 *
 * 三条拖拽路径：
 * - 池子卡 → 画布：HTML5 DnD，`screenToFlowPosition` 把屏幕坐标换成画布坐标，
 *   落点即节点的固定坐标（用户放哪就是哪，不 reheat 全图）；
 * - 画布卡 → 池子：React Flow 的节点拖拽松手时，用 `elementFromPoint` 判断
 *   落点是否在池子内 —— 是则「移出」（只删成员，不删关系）；
 * - 手柄 → 另一张卡（S3）：React Flow 的 `onConnect`。**画布只负责「用户连了
 *   谁和谁」**，校验（自身 / 跨作品 / 空名 / 重复）与写库都在上层 —— 画布在
 *   这里给结论的话，弹层就没法把「为什么不行」讲清楚。
 *
 * 刻意关掉 `deleteKeyCode`：画布的 Delete/Backspace 会直接删节点与边，而节点
 * 背后是真实要素与真实关系 —— 误按一次就是「图上看不见了，库里也没了」。
 * 删关系只能回主窗口右栏（W-17 只读边界）。
 */
import { useCallback, useEffect, useMemo, useState, type DragEvent, type Ref } from "react";
import { Button, Dropdown } from "antd";
import { DownOutlined, ExpandOutlined, MinusOutlined, PlusOutlined, DownloadOutlined } from "@ant-design/icons";
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type NodeChange,
  type OnConnect,
  type OnNodeDrag,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from "@xyflow/react";
import { createTypeMetaResolver } from "@/shared/novel/entity-type-meta";
import type { CustomEntityTypeDef } from "@/shared/novel/entity-model";
import type { RelationGraphDoc } from "@/shared/novel/relation-graph";
import EntityNode, { type EntityFlowNode } from "../EntityNode";
import { REL_NODE_DND_TYPE } from "../EntityPool";
import type { GraphPoint, GraphViewport } from "../../utils/graph-doc";
import { resolveDensity } from "../../utils/graph-density";
import type { LayoutPoint } from "../../utils/graph-layout";
import "./index.scss";

const NODE_TYPES = { entity: EntityNode };

export interface RelationCanvasProps {
  doc: RelationGraphDoc;
  positions: Map<string, LayoutPoint>;
  /** 库里恢复的视口；null = 首次打开（走 fitView） */
  viewport: GraphViewport | null;
  customTypes: CustomEntityTypeDef[];
  selectedId: string | null;
  selectedEdgeId: string | null;
  saving: boolean;
  onSelect: (nodeId: string | null) => void;
  onSelectEdge: (edgeId: string | null) => void;
  onAddNode: (nodeId: string, point: GraphPoint) => void;
  onRemoveNode: (nodeId: string) => void;
  onMoveNode: (nodeId: string, point: GraphPoint) => void;
  /** 缩放 / 平移结束：写回视口（与坐标共用去抖） */
  onViewportChange: (view: GraphViewport) => void;
  /** 打开要素资料卡：双击节点 / 详情卡按钮（跨窗口导航） */
  onOpenNode?: (nodeId: string) => void;
  /** 用户从手柄拖到了另一张卡：把两端交给上层校验并弹确认 */
  onConnectDraft: (sourceId: string, targetId: string) => void;
  /** 导出：App 层持有取景 hook，这里只放按钮 + 把根节点 ref 交出去 */
  rootRef?: Ref<HTMLDivElement>;
  exporting?: boolean;
  onExport?: () => void;
}

/** 拖拽结束事件可能是鼠标也可能是触摸（OnNodeDrag 是两者的联合类型） */
function pointerOf(event: MouseEvent | TouchEvent): GraphPoint {
  if ("changedTouches" in event && event.changedTouches.length > 0) {
    const touch = event.changedTouches[0];
    return { x: touch.clientX, y: touch.clientY };
  }
  const mouse = event as MouseEvent;
  return { x: mouse.clientX, y: mouse.clientY };
}

function CanvasInner({
  doc,
  positions,
  viewport,
  customTypes,
  selectedId,
  selectedEdgeId,
  saving,
  onSelect,
  onSelectEdge,
  onAddNode,
  onRemoveNode,
  onMoveNode,
  onViewportChange,
  onOpenNode,
  onConnectDraft,
  rootRef,
  exporting = false,
  onExport,
}: RelationCanvasProps) {
  const { fitView, zoomIn, zoomOut, screenToFlowPosition } = useReactFlow();
  const metaOf = useMemo(() => createTypeMetaResolver(customTypes), [customTypes]);

  /**
   * 密度档（S4）：按**成员数**算，不按筛选后的可见数。
   * 筛选只决定「哪些淡出」，换档会连带改文字/边样式，两者混在一起会让人
   * 以为「筛一下就丢东西了」。
   */
  const plan = useMemo(() => resolveDensity(doc.nodes.length), [doc.nodes.length]);

  /**
   * 库里有真实视口才恢复（k=1/tx=0/ty=0 是新建文档的初始值，等价于「没存过」）。
   * 恢复时不跑 fitView —— 否则每次打开都回到全景，等于视口没存。
   */
  const restoredViewport =
    viewport && !(viewport.k === 1 && viewport.tx === 0 && viewport.ty === 0) ? viewport : null;

  /** 从 props 派生的「理想节点集」：位置来自记忆，选中态来自 props */
  const derivedNodes = useMemo<EntityFlowNode[]>(
    () =>
      doc.nodes.map((node) => {
        const meta = metaOf(node.type);
        return {
          id: node.id,
          type: "entity",
          position: positions.get(node.id) ?? { x: 0, y: 0 },
          selected: node.id === selectedId,
          draggable: true,
          connectable: true,
          data: {
            node,
            color: meta.color,
            colorWeak: meta.colorWeak,
            typeLabel: meta.label,
            plan,
          },
        };
      }),
    [doc.nodes, metaOf, plan, positions, selectedId],
  );

  // 拖拽必须走本地状态：受控 nodes 若不接 onNodesChange，拖一次会立刻弹回原位
  const [nodes, setNodes] = useState<EntityFlowNode[]>(derivedNodes);
  useEffect(() => {
    setNodes(derivedNodes);
  }, [derivedNodes]);

  /** 拖线过程中：手柄常显 + 画布虚线走主题色 */
  const [connecting, setConnecting] = useState(false);
  /** 缩放很小的时候手柄要加大（见 EntityNode/index.scss） */
  const [zoomedOut, setZoomedOut] = useState(false);

  const flowEdges = useMemo<Edge[]>(
    () =>
      doc.edges.map((edge) => {
        const selected = edge.id === selectedEdgeId;
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          // 极简档默认不画关系名（200+ 条边时字会盖住边本身），选中那条仍然画
          label: plan.showEdgeLabel || selected ? edge.label : undefined,
          type: "default",
          style: {
            stroke: selected ? "var(--app-primary)" : "var(--app-border-strong)",
            strokeWidth: selected ? 2 : plan.edgeWidth,
            opacity: selected ? 1 : plan.edgeOpacity,
          },
          labelStyle: { fill: "var(--app-text-secondary)", fontSize: plan.level === "compact" ? 10 : 11 },
          labelBgStyle: { fill: "var(--app-surface)", stroke: "var(--app-border)" },
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 4,
        };
      }),
    [doc.edges, plan, selectedEdgeId],
  );

  const handleNodesChange = useCallback((changes: NodeChange<EntityFlowNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const handleNodeClick = useCallback<NodeMouseHandler<EntityFlowNode>>(
    (_event, node) => {
      onSelectEdge(null);
      onSelect(node.id);
    },
    [onSelect, onSelectEdge],
  );

  /**
   * 双击节点 = 去主窗口看这个要素的完整资料卡（W-13 的最近路径）。
   * 单击仍是「选中」，两者不冲突：双击必然先触发两次 click，选中态多一次也无害。
   */
  const handleNodeDoubleClick = useCallback<NodeMouseHandler<EntityFlowNode>>(
    (_event, node) => {
      onOpenNode?.(node.id);
    },
    [onOpenNode],
  );

  const handleEdgeClick = useCallback<EdgeMouseHandler>(
    (_event, edge) => {
      onSelect(null);
      onSelectEdge(edge.id);
    },
    [onSelect, onSelectEdge],
  );

  const handleNodeDragStop = useCallback<OnNodeDrag<EntityFlowNode>>(
    (event, node) => {
      const point = pointerOf(event);
      // 松手在池子区域 → 移出画布（只删成员，关系仍在右栏）
      const hit = document.elementFromPoint(point.x, point.y);
      if (hit && hit.closest("[data-rel-pool]")) {
        onRemoveNode(node.id);
        return;
      }
      onMoveNode(node.id, node.position);
    },
    [onMoveNode, onRemoveNode],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const nodeId = event.dataTransfer.getData(REL_NODE_DND_TYPE);
      if (!nodeId) return;
      event.preventDefault();
      // 落点换算：screenToFlowPosition 已考虑当前缩放与平移
      onAddNode(nodeId, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [onAddNode, screenToFlowPosition],
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    // 不 preventDefault 就不会触发 drop（HTML5 DnD 的硬性要求）
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const handleConnect = useCallback<OnConnect>(
    (connection) => {
      if (!connection.source || !connection.target) return;
      onConnectDraft(connection.source, connection.target);
    },
    [onConnectDraft],
  );

  const handlePaneClick = useCallback(() => {
    onSelect(null);
    onSelectEdge(null);
  }, [onSelect, onSelectEdge]);

  return (
    <div
      ref={rootRef}
      className={`rel-canvas${connecting ? " is-connecting" : ""}${zoomedOut ? " is-zoomed-out" : ""}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <div className="rel-canvas__toolbar">
        <div className="rel-canvas__stats">
          <b>{doc.diagnostics.nodeCount}</b> 个要素
          <span className="rel-canvas__sep">·</span>
          <b>{doc.diagnostics.edgeCount}</b> 条关联
          {doc.diagnostics.poolCount > 0 && (
            <>
              <span className="rel-canvas__sep">·</span>
              <span className="rel-canvas__pool-hint">
                另有 {doc.diagnostics.poolCount} 个要素在左侧池子里
              </span>
            </>
          )}
          {saving && <span className="rel-canvas__saving">保存中…</span>}
        </div>
        <div className="rel-canvas__actions">
          <Button
            size="small"
            className="rel-canvas__btn"
            aria-label="缩小"
            icon={<MinusOutlined />}
            onClick={() => zoomOut()}
          />
          <Button
            size="small"
            className="rel-canvas__btn"
            aria-label="放大"
            icon={<PlusOutlined />}
            onClick={() => zoomIn()}
          />
          <Button
            size="small"
            className="rel-canvas__btn rel-canvas__fit"
            icon={<ExpandOutlined />}
            onClick={() => void fitView({ padding: 0.22, duration: 200 })}
          >
            适应画布
          </Button>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                { key: "direct", label: "导出 PNG", icon: <DownloadOutlined /> },
                { key: "fit", label: "先适应画布再导出" },
              ],
              onClick: ({ key }) => {
                if (key === "fit") {
                  // 先无动画地适应画布，再导出：hook 内部的两帧等待会覆盖这次重绘
                  void fitView({ padding: 0.22, duration: 0 });
                  onExport?.();
                } else {
                  onExport?.();
                }
              },
            }}
          >
            <Button
              size="small"
              className="rel-canvas__btn rel-canvas__export"
              icon={<DownloadOutlined />}
              loading={exporting}
            >
              导出
              <DownOutlined className="rel-canvas__export-caret" />
            </Button>
          </Dropdown>
        </div>
      </div>

      {plan.notice && (
        <p className="rel-canvas__dense" role="note">
          {plan.notice}
        </p>
      )}

      <ReactFlow
        nodes={nodes}
        edges={flowEdges}
        nodeTypes={NODE_TYPES}
        onNodesChange={handleNodesChange}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeDragStop={handleNodeDragStop}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        onConnect={handleConnect}
        onConnectStart={() => setConnecting(true)}
        onConnectEnd={() => setConnecting(false)}
        onMove={(_event, viewportValue) => setZoomedOut(viewportValue.zoom < 0.5)}
        // 平移 / 缩放结束才写回：onMove 每帧都触发，写库会被拖垮
        onMoveEnd={(_event, viewportValue) => {
          setZoomedOut(viewportValue.zoom < 0.5);
          onViewportChange({ k: viewportValue.zoom, tx: viewportValue.x, ty: viewportValue.y });
        }}
        nodesConnectable
        // RG-I-64：节点不进 tab 序（200 个节点会把 Tab 序列彻底堵死），
        // 键盘路径由左侧池子承担（行内 ↑↓ / Enter），这里只保留「选中」语义
        nodesFocusable={false}
        edgesFocusable={false}
        // 画布的键盘删除会直接删真实关系（见文件头注释），一律禁用
        deleteKeyCode={null}
        connectionLineStyle={{
          stroke: "var(--app-primary)",
          strokeWidth: 1.6,
          strokeDasharray: "5 4",
        }}
        connectionLineType={ConnectionLineType.SmoothStep}
        connectionRadius={28}
        onlyRenderVisibleElements
        defaultViewport={
          restoredViewport
            ? { x: restoredViewport.tx, y: restoredViewport.ty, zoom: restoredViewport.k }
            : undefined
        }
        fitView={!restoredViewport}
        fitViewOptions={{ padding: 0.22 }}
        minZoom={0.15}
        maxZoom={1.8}
        panOnScroll
        selectionOnDrag={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={26} size={1} color="var(--app-border)" />
        <Controls showInteractive={false} />
      </ReactFlow>

      {doc.nodes.length === 0 && (
        <div className="rel-canvas__empty">
          <p>{doc.diagnostics.poolCount > 0 ? "画布是空的" : "这本书还没有任何关联"}</p>
          <span>
            {doc.diagnostics.poolCount > 0
              ? "把左侧池子里的要素拖到画布上，再从卡片右缘的小圆点拖到另一张卡，就能建一条关系。"
              : "在右栏的要素资料卡里给两个要素建一条关系，再回到这里就能看到结构。"}
          </span>
        </div>
      )}
    </div>
  );
}

export default function RelationCanvas(props: RelationCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
