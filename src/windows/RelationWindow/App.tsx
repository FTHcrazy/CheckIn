/**
 * RelationWindow —— 人物关系网络独立窗口（R27 / S3）
 *
 * 形态：左「要素资料池」+ 中「力导向画布」+ 右「点击后的完整资料卡 / 边详情」。
 * 图上节点只显示「类型 + 名称」，点击才展开完整信息（用户口径 v2.2）。
 *
 * S2 交付的是「能摆、记得住」；S3 交付的是「能连、写得回」：
 * - 手柄拖到另一张卡 → 「新建关系」二次确认（五项：起终点 / 关系名 / 重复判定 / 目标作品）
 *   → 主进程单事务落库 → 本窗口合并增量 + 主窗口右栏三处自动更新；
 * - 点边 → 边详情（逐条平行关系 + 备注 ≤200 字 + 「去右栏删除」导航）；
 * - 失败不静默：弹层不关、内容不清空、按钮可重按；`stale` 给「重新载入」。
 *
 * 写回的范围刻意只到「新建关系 + 备注」：删关系、改关系名仍回主窗口右栏 ——
 * 图上能删会让「一条边 = 哪一行」难以解释，而删除是不可逆动作。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Modal } from "antd";
import { ApartmentOutlined, ReloadOutlined } from "@ant-design/icons";
import WindowHeader from "@/shared/components/WindowHeader";
import { createTypeMetaResolver } from "@/shared/novel/entity-type-meta";
import type { RelationGraphNode } from "@/shared/novel/relation-graph";
import EdgeDetailCard from "./components/EdgeDetailCard";
import EntityPool from "./components/EntityPool";
import NodeDetailCard from "./components/NodeDetailCard";
import RelationCanvas from "./components/RelationCanvas";
import RelationCreateDialog from "./components/RelationCreateDialog";
import WorkSwitchBanner from "./components/WorkSwitchBanner";
import { useGraphCommit, toNovelLinks } from "./hooks/useGraphCommit";
import { useGraphDoc, type GraphSource } from "./hooks/useGraphDoc";
import { useExportPng } from "./hooks/useExportPng";
import { useRelationContext } from "./hooks/useRelationContext";
import { useRelationData } from "./hooks/useRelationData";
import { focusEntityInMainWindow } from "./services/relation-service";
import { buildDraftLink, type DraftEndpoint } from "./utils/relation-draft";
import { failReasonOf, logLinkCreated, relationLenOf } from "./utils/link-telemetry";
import { suggestNodeSpot } from "./utils/graph-layout";

/** 创建成功后的提示停留时间（够看清，又不挡住下一次连线） */
const FEEDBACK_TTL_MS = 2600;

interface PendingLink {
  sourceId: string;
  targetId: string;
}

export default function RelationWindowApp() {
  const { workId, pendingWorkId, adoptPending, dismissPending } = useRelationContext();
  const { state, refresh, applyLinkDelta } = useRelationData(workId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [pendingLink, setPendingLink] = useState<PendingLink | null>(null);
  const [closeAsk, setCloseAsk] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 切书 / 重置模板后旧节点的选中必须作废（否则右侧卡显示上一本书的要素）
  useEffect(() => {
    setSelectedId(null);
    setSelectedEdgeId(null);
    setPendingLink(null);
  }, [workId]);

  const data = state.status === "ready" ? state.data : null;

  // W-01：窗口标题带作品名（任务栏 / 多窗口切换时才分得清是哪本书）
  const windowTitle = data?.workName ? `${data.workName} · 关系网络` : "人物关系网络";
  useEffect(() => {
    document.title = windowTitle;
  }, [windowTitle]);

  // ── 导出 PNG（S5）：取景 hook + 画布根节点引用 ──
  const canvasRootRef = useRef<HTMLDivElement | null>(null);
  const { exporting, exportPng } = useExportPng({
    rootRef: canvasRootRef,
    workName: data?.workName ?? "",
  });

  // source 必须是稳定引用：每次渲染新建对象会让 useGraphDoc 的装载 effect 反复重跑
  const source = useMemo<GraphSource | null>(
    () =>
      data
        ? {
            workId: data.workId,
            entities: data.entities,
            links: data.links,
            settings: data.settings,
            baseDoc: data.baseDoc,
          }
        : null,
    [data],
  );

  const graph = useGraphDoc(source, {
    hasDraft: pendingLink !== null,
    onCloseBlocked: () => setCloseAsk(true),
  });
  const doc = graph.doc;

  const metaOf = useMemo(
    () => createTypeMetaResolver(data?.customTypes ?? []),
    [data?.customTypes],
  );

  const nodeById = useMemo(
    () => new Map((doc?.all ?? []).map((node) => [node.id, node])),
    [doc],
  );

  const selectedNode = selectedId ? nodeById.get(selectedId) ?? null : null;

  // ── 埋点 rel_graph_open（A-10：一次性写入，事后无法补采） ──
  const openedAtRef = useRef<number | null>(null);
  const loggedRef = useRef<number | null>(null);
  useEffect(() => {
    openedAtRef.current = performance.now();
  }, []);
  useEffect(() => {
    if (!data || !doc) return;
    if (loggedRef.current === data.loadedAt) return;
    loggedRef.current = data.loadedAt;

    // 首帧用 rAF 近似：回调触发时浏览器已完成本次绘制排程
    requestAnimationFrame(() => {
      const firstPaintMs = Math.round(
        performance.now() - (openedAtRef.current ?? performance.now()),
      );
      void window.electronAPI?.novel
        ?.usageLog("rel_graph_open", {
          entry: "tool-launcher",
          nodeCount: doc.diagnostics.nodeCount,
          edgeCount: doc.diagnostics.edgeCount,
          // S4（RG-I-50 改写）：成员 / 池中两数进 payload —— 只看 nodeCount 分不清
          // 「用户拖走了 30 个」和「有 30 个没上图」
          memberCount: doc.diagnostics.nodeCount,
          poolCount: doc.diagnostics.poolCount,
          relationCount: doc.diagnostics.linkCount,
          ignored: {
            level: doc.diagnostics.dropped.level,
            dangling: doc.diagnostics.dropped.dangling,
            selfLoop: doc.diagnostics.dropped.selfLoop,
            duplicate: doc.diagnostics.dropped.duplicate,
          },
          deriveMs: data.deriveMs,
          firstPaintMs,
          settleMs: firstPaintMs,
          stopReason: "fit",
        })
        .catch(() => {
          // 埋点失败静默：不能影响画布
        });
    });
  }, [data, doc]);

  // ── 反馈条：建成功 / 被阻断的一句话（自动消失，不打断操作） ──
  const feedbackTimer = useRef<number | null>(null);
  const showFeedback = useCallback((type: "success" | "error", text: string) => {
    setFeedback({ type, text });
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = window.setTimeout(() => {
      feedbackTimer.current = null;
      setFeedback(null);
    }, FEEDBACK_TTL_MS);
  }, []);
  useEffect(
    () => () => {
      if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
    },
    [],
  );

  // ── 提交（新建关系 / 改备注共用一条事务） ──
  /**
   * 正在提交的那次连线的埋点上下文（W-18）。
   * 失败回调发生在 `commit()` 返回之前，拿不到 handleSubmitDraft 的局部变量，
   * 所以先放 ref：成功 / 失败两条路径共用同一份 from/to/relationLen/起点时间。
   */
  const linkTrace = useRef<{
    fromType: string;
    toType: string;
    relationLen: number;
    merged: boolean;
    startedAt: number;
  } | null>(null);

  const commit = useGraphCommit({
    workId: data?.workId ?? "",
    snapshot: graph.snapshot,
    flush: graph.flush,
    onCommitted: (result) => {
      applyLinkDelta({
        created: toNovelLinks(result.created),
        notes: result.notes,
      });
      graph.adoptRev(result.rev);
      if (result.created.length > 0) {
        showFeedback(
          "success",
          result.merged.length > 0
            ? `已创建 ${result.created.length} 条关系（${result.merged.length} 条并入已有）`
            : "关系已创建，主窗口右栏已同步",
        );
      } else if (result.notes.length > 0) {
        showFeedback("success", "备注已保存");
      }
    },
    onFailed: (code) => {
      const trace = linkTrace.current;
      if (!trace) return;
      // 立刻清掉：失败后用户可能改去存备注，那条失败不该再记成一次「连线」
      linkTrace.current = null;
      logLinkCreated({
        fromType: trace.fromType,
        toType: trace.toType,
        relationLen: trace.relationLen,
        merged: trace.merged,
        ms: performance.now() - trace.startedAt,
        failReason: failReasonOf(code),
      });
    },
  });

  const handleSelect = useCallback((nodeId: string | null) => {
    setSelectedId((current) => (current === nodeId ? current : nodeId));
  }, []);

  const handleSelectEdge = useCallback((edgeId: string | null) => {
    setSelectedEdgeId((current) => (current === edgeId ? current : edgeId));
  }, []);

  /** 池子「一键上图」：落点按黄金角螺旋排，连续点上图不会叠在一起 */
  const handleAdd = useCallback(
    (nodeId: string) => {
      graph.addNode(nodeId, suggestNodeSpot(graph.positions.size));
    },
    [graph],
  );

  /** 手柄拖到另一张卡：自身连线当场阻断（不弹确认框），其余进二次确认 */
  const handleConnectDraft = useCallback(
    (sourceId: string, targetId: string) => {
      if (sourceId === targetId) {
        showFeedback("error", "不能与自己建立关系");
        return;
      }
      commit.clearError();
      setSelectedEdgeId(null);
      setPendingLink({ sourceId, targetId });
    },
    [commit, showFeedback],
  );

  const endpointOf = useCallback(
    (node: RelationGraphNode): DraftEndpoint => ({
      id: node.id,
      name: node.name,
      type: node.type,
      typeLabel: metaOf(node.type).label,
      workId: data?.workId ?? "",
    }),
    [data?.workId, metaOf],
  );

  const draftSource = pendingLink ? nodeById.get(pendingLink.sourceId) ?? null : null;
  const draftTarget = pendingLink ? nodeById.get(pendingLink.targetId) ?? null : null;

  /** 同一对端点已存在的关系名（边是无向的：正反向都算同一对） */
  const existingRelations = useMemo(() => {
    if (!pendingLink || !doc) return [];
    const edge = doc.edges.find(
      (item) =>
        (item.source === pendingLink.sourceId && item.target === pendingLink.targetId) ||
        (item.source === pendingLink.targetId && item.target === pendingLink.sourceId),
    );
    return edge?.relations ?? [];
  }, [doc, pendingLink]);

  /** 关系名候选：本书出现过的全部关系名（可自由输入新名） */
  const knownRelations = useMemo(() => {
    const names = new Set<string>();
    for (const link of data?.links ?? []) {
      if (link.relation) names.add(link.relation);
    }
    return [...names].sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [data?.links]);

  const selectedEdge = selectedEdgeId
    ? doc?.edges.find((edge) => edge.id === selectedEdgeId) ?? null
    : null;

  // 反向同步补丁（S4）：主窗口删掉的关系会让选中的那条边消失，此时把选中态
  // 一起清掉 —— 否则 edgeId 一直挂着，用户再点同一对要素时详情卡会「闪一下又没了」
  useEffect(() => {
    if (selectedEdgeId && !selectedEdge) setSelectedEdgeId(null);
  }, [selectedEdge, selectedEdgeId]);

  const handleSubmitDraft = useCallback(
    (relation: string, merge: boolean) => {
      if (!pendingLink || !draftSource || !draftTarget) return;
      const sourceEndpoint = endpointOf(draftSource);
      const targetEndpoint = endpointOf(draftTarget);
      const link = buildDraftLink(sourceEndpoint, targetEndpoint, relation);
      const startedAt = performance.now();
      // 失败路径（onFailed）要在 commit 返回前读到它，所以先落 ref
      linkTrace.current = {
        fromType: link.fromType,
        toType: link.toType,
        relationLen: relationLenOf(link.relation),
        merged: merge,
        startedAt,
      };
      void (async () => {
        const result = await commit.commit({
          addLinks: [
            {
              id: link.id,
              fromType: link.fromType,
              fromId: link.fromId,
              toType: link.toType,
              toId: link.toId,
              relation: link.relation,
            },
          ],
        });
        // 备注提交复用 commit 时不带 trace：那条不该记成「连线」
        const trace = linkTrace.current;
        linkTrace.current = null;
        if (!result) return;
        if (trace) {
          logLinkCreated({
            fromType: trace.fromType,
            toType: trace.toType,
            relationLen: trace.relationLen,
            // 主进程也可能判定为合并（同 id 重投 / 同四元组已存在）
            merged: trace.merged || result.merged.length > 0,
            ms: performance.now() - startedAt,
          });
        }
        setPendingLink(null);
      })();
    },
    [commit, draftSource, draftTarget, endpointOf, pendingLink],
  );

  const handleCancelDraft = useCallback(
    (relation?: string, merge?: boolean) => {
      const sourceType = draftSource?.type ?? "";
      const targetType = draftTarget?.type ?? "";
      if (relation !== undefined) {
        logLinkCreated({
          fromType: sourceType,
          toType: targetType,
          relationLen: relationLenOf(relation),
          merged: Boolean(merge),
          ms: 0,
          failReason: "cancelled",
        });
      }
      linkTrace.current = null;
      commit.clearError();
      setPendingLink(null);
    },
    [commit, draftSource, draftTarget],
  );

  /** 点了确认但校验没过（回车那一下）：独立记一条，别和「成功」混在一起 */
  const handleBlockedDraft = useCallback(
    (relation: string, merge: boolean) => {
      logLinkCreated({
        fromType: draftSource?.type ?? "",
        toType: draftTarget?.type ?? "",
        relationLen: relationLenOf(relation),
        merged: merge,
        ms: 0,
        failReason: "blocked",
      });
      showFeedback("error", "关系名不能为空");
    },
    [draftSource, draftTarget, showFeedback],
  );

  /** stale / 用户主动重载：把库里的记忆接回来，再重取一次数据 */
  const handleReload = useCallback(() => {
    commit.clearError();
    setPendingLink(null);
    void (async () => {
      const ok = await graph.reload();
      if (!ok) {
        // 失败必须如实说：恒报「已重新载入」会让用户在同一个 stale 错误上反复重试
        showFeedback("error", "重新载入失败，请稍后再试");
        return;
      }
      refresh();
      showFeedback("success", "已重新载入这本书的画布");
    })();
  }, [commit, graph, refresh, showFeedback]);

  /** 跨窗口导航：抬起主窗口并打开该要素的资料卡（双击节点 / 详情卡按钮共用） */
  const openEntityInMain = useCallback(
    (entityId: string) => {
      void focusEntityInMainWindow(data?.workId ?? "", entityId);
    },
    [data?.workId],
  );

  const handleSaveNote = useCallback(
    async (linkId: string, note: string): Promise<boolean> => {
      const result = await commit.commit({ noteUpdates: [{ id: linkId, note }] });
      return Boolean(result);
    },
    [commit],
  );

  /** 导出 PNG：先冲刷未落库的坐标，再取景，成功 / 取消 / 失败各给一句反馈 */
  const handleExport = useCallback(() => {
    void (async () => {
      await graph.flush();
      const outcome = await exportPng();
      if (outcome === "ok") {
        showFeedback("success", "关系图已导出为 PNG");
      } else if (outcome === "cancelled") {
        // 取消不算失败：不打扰
      } else {
        showFeedback("error", "导出失败，请把窗口置于前台后重试");
      }
    })();
  }, [exportPng, graph, showFeedback]);

  /** 确认切到主窗口那本书：先把当前书的坐标写掉，再换（避免丢手工成果） */
  const handleAdopt = useCallback(() => {
    void (async () => {
      await graph.flush();
      adoptPending();
    })();
  }, [adoptPending, graph]);

  const pendingName =
    (pendingWorkId && data?.works.find((work) => work.id === pendingWorkId)?.name) || "另一部作品";

  return (
    <div className="window-shell rel-window">
      <WindowHeader title={windowTitle} icon={<ApartmentOutlined />} />

      <div className="rel-window__bar">
        <div className="rel-window__work">
          <span className="rel-window__work-name">
            {data?.workName ?? (state.status === "error" ? "—" : "载入中…")}
          </span>
          {doc && (
            <span className="rel-window__work-meta">
              画布 {doc.diagnostics.nodeCount} · 池中 {doc.diagnostics.poolCount} · 全书{" "}
              {doc.diagnostics.entityCount}
              {doc.diagnostics.dropped.level > 0
                ? ` · ${doc.diagnostics.dropped.level} 条境界绑定已收进资料卡`
                : ""}
            </span>
          )}
        </div>
        <div className="rel-window__actions">
          <Button
            size="small"
            icon={<ReloadOutlined />}
            onClick={refresh}
            disabled={!workId || state.status === "loading"}
          >
            刷新
          </Button>
        </div>
      </div>

      {data && pendingWorkId && (
        <WorkSwitchBanner
          currentName={data.workName}
          pendingName={pendingName}
          dirty={graph.dirty}
          onAdopt={handleAdopt}
          onDismiss={dismissPending}
        />
      )}

      {graph.notice && (
        <Alert
          className="rel-window__notice"
          type="warning"
          showIcon
          closable
          message={graph.notice}
          onClose={graph.dismissNotice}
        />
      )}

      {feedback && (
        <Alert
          className="rel-window__notice"
          type={feedback.type}
          showIcon
          message={feedback.text}
          onClose={() => setFeedback(null)}
        />
      )}

      <div className="rel-window__body">
        {!workId && <p className="rel-window__hint">正在等待作品上下文…</p>}

        {workId && state.status === "error" && (
          <div className="rel-window__hint rel-window__hint--error">
            <p>{state.message}</p>
            <Button size="small" onClick={refresh}>
              重试
            </Button>
          </div>
        )}

        {workId && (state.status === "loading" || graph.status === "loading") && (
          <p className="rel-window__hint">正在读取本书的要素、关联与画布位置…</p>
        )}

        {workId && state.status === "ready" && !data?.workId && (
          <p className="rel-window__hint">当前没有打开的作品。</p>
        )}

        {doc && (
          <div className="rel-window__main">
            <EntityPool
              nodes={doc.all}
              metaOf={metaOf}
              selectedId={selectedId}
              onSelect={handleSelect}
              onAdd={handleAdd}
              onRemove={graph.removeNode}
            />

            <RelationCanvas
              doc={doc}
              positions={graph.positions}
              viewport={graph.viewport}
              customTypes={data?.customTypes ?? []}
              selectedId={selectedId}
              selectedEdgeId={selectedEdgeId}
              saving={graph.saving || commit.submitting}
              onSelect={handleSelect}
              onSelectEdge={handleSelectEdge}
              onAddNode={graph.addNode}
              onRemoveNode={graph.removeNode}
              onMoveNode={graph.moveNode}
              onViewportChange={graph.saveViewport}
              onOpenNode={openEntityInMain}
              onConnectDraft={handleConnectDraft}
              rootRef={canvasRootRef}
              exporting={exporting}
              onExport={handleExport}
            />

            {selectedEdge ? (
              <EdgeDetailCard
                edge={selectedEdge}
                nodeById={nodeById}
                typeLabelOf={(type) => metaOf(type).label}
                saving={commit.submitting}
                onSaveNote={handleSaveNote}
                onOpenInMain={openEntityInMain}
                onSelectNode={(nodeId) => {
                  setSelectedEdgeId(null);
                  handleSelect(nodeId);
                }}
                onClose={() => setSelectedEdgeId(null)}
              />
            ) : (
              selectedNode && (
                <NodeDetailCard
                  node={selectedNode}
                  meta={metaOf(selectedNode.type)}
                  edges={doc.edges}
                  nodeById={nodeById}
                  onSelectNode={handleSelect}
                  onClose={() => setSelectedId(null)}
                  onOpenInMain={openEntityInMain}
                />
              )
            )}
          </div>
        )}
      </div>

      <RelationCreateDialog
        open={pendingLink !== null && draftSource !== null && draftTarget !== null}
        source={draftSource ? endpointOf(draftSource) : null}
        target={draftTarget ? endpointOf(draftTarget) : null}
        existingRelations={existingRelations}
        knownRelations={knownRelations}
        workName={data?.workName ?? ""}
        submitting={commit.submitting}
        error={commit.error}
        stale={commit.staleRev !== null}
        onCancel={handleCancelDraft}
        onSubmit={handleSubmitDraft}
        onBlocked={handleBlockedDraft}
        onReload={handleReload}
      />

      <Modal
        open={closeAsk}
        title="还有未确认的关系"
        centered
        zIndex={1300}
        okText="放弃并关闭"
        cancelText="继续编辑"
        onOk={() => {
          setCloseAsk(false);
          window.electronAPI?.windowAPI?.respondClose(true);
        }}
        onCancel={() => {
          setCloseAsk(false);
          window.electronAPI?.windowAPI?.respondClose(false);
        }}
      >
        <p className="rel-window__dialog-text">
          刚才拖出的那条关系还没创建。关闭窗口会丢弃这次输入，关系数据不受影响。
        </p>
      </Modal>
    </div>
  );
}
