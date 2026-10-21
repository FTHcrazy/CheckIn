/**
 * 节点详情卡（点击画布节点后展开）
 *
 * 用户口径：图上只显示「类型 + 名称」，**点击后才给完整资料卡信息**。
 * 这里聚合的是要素本体（别名 / 一句话 / 当前境界）与它的全部关系
 * （合并边按「关系名」逐条列出，平行关系不隐藏）。
 *
 * 不提供字段编辑：要素字段的唯一真相源仍是主窗口的资料卡（delta §2 N-3）。
 * S3 起关系可以在图上新建（拖手柄），本卡仍是**只读**：改名 / 删除都回右栏。
 */
import { useEffect, type ReactNode } from "react";
import { Button } from "antd";
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CloseOutlined,
  ExportOutlined,
} from "@ant-design/icons";
import type { RelationGraphEdge, RelationGraphNode } from "@/shared/novel/relation-graph";
import type { EntityTypeMeta } from "@/shared/novel/entity-type-meta";
import "./index.scss";

export interface NodeDetailCardProps {
  node: RelationGraphNode;
  meta: EntityTypeMeta;
  edges: readonly RelationGraphEdge[];
  nodeById: ReadonlyMap<string, RelationGraphNode>;
  onSelectNode: (nodeId: string) => void;
  onClose: () => void;
  /** 跨窗口导航：抬起主窗口并打开这个要素的资料卡（W-13 / W-17 的出口） */
  onOpenInMain?: (entityId: string) => void;
}

/** 关系方向用箭头图标表达（S2 不画边上的箭头，避免与 P1-9「方向箭头」抢语义） */
function DirectionMark({ direction }: { direction: "out" | "in" }) {
  return (
    <span className="rel-card__dir" aria-label={direction === "out" ? "指向" : "来自"}>
      {direction === "out" ? <ArrowRightOutlined /> : <ArrowLeftOutlined />}
    </span>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rel-card__field">
      <span className="rel-card__label">{label}</span>
      <div className="rel-card__value">{children}</div>
    </div>
  );
}

export default function NodeDetailCard({
  node,
  meta,
  edges,
  nodeById,
  onSelectNode,
  onClose,
  onOpenInMain,
}: NodeDetailCardProps) {
  // 详情卡是最外层浮层：Esc 只收起它，不关窗口（窗口级防误关由主进程控制）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const relations = edges.flatMap((edge) => {
    if (edge.source !== node.id && edge.target !== node.id) return [];
    const outgoing = edge.source === node.id;
    const otherId = outgoing ? edge.target : edge.source;
    const other = nodeById.get(otherId);
    return edge.relations.map((relation, index) => ({
      key: `${edge.id}:${index}`,
      relation,
      note: index === 0 ? edge.note : undefined,
      direction: (outgoing ? "out" : "in") as "out" | "in",
      otherId,
      otherName: other?.name ?? "（已删除的要素）",
    }));
  });

  return (
    <aside className="rel-card" aria-label={`${node.name} 的资料卡`}>
      <header className="rel-card__head">
        <span className="rel-card__type" style={{ background: meta.colorWeak, color: meta.color }}>
          {meta.label}
        </span>
        <h2 className="rel-card__name" title={node.name}>
          {node.name}
        </h2>
        <Button
          type="text"
          size="small"
          className="rel-card__close"
          aria-label="关闭资料卡"
          icon={<CloseOutlined />}
          onClick={onClose}
        />
      </header>

      <div className="rel-card__body">
        {node.aliases.length > 0 && <Field label="别名">{node.aliases.join("、")}</Field>}
        {node.realm && <Field label="当前境界">{node.realm}</Field>}
        <Field label="简介">
          {node.summary.trim() ? (
            node.summary
          ) : (
            <span className="rel-card__muted">还没有一句话简介</span>
          )}
        </Field>

        <div className="rel-card__section">
          <span className="rel-card__section-title">
            关联 <b>{relations.length}</b>
          </span>
          {relations.length === 0 ? (
            <p className="rel-card__empty">
              这个要素还没有任何关联。把两张卡连起来就能建一条关系：从卡片边缘的小圆点拖到另一张卡上。
            </p>
          ) : (
            <ul className="rel-card__relations">
              {relations.map((item) => (
                <li key={item.key}>
                  <Button
                    type="text"
                    block
                    className="rel-card__relation"
                    onClick={() => onSelectNode(item.otherId)}
                  >
                    <DirectionMark direction={item.direction} />
                    <span className="rel-card__rel-name">{item.relation}</span>
                    <span className="rel-card__rel-target">{item.otherName}</span>
                  </Button>
                  {item.note ? <p className="rel-card__rel-note">{item.note}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <footer className="rel-card__foot">
        <Button
          size="small"
          block
          className="rel-card__open"
          icon={<ExportOutlined />}
          aria-label={`在主窗口打开「${node.name}」的资料卡`}
          onClick={() => onOpenInMain?.(node.entityId)}
        >
          在主窗口打开资料卡
        </Button>
        <p className="rel-card__foot-hint">
          要素内容的编辑仍在主窗口的要素资料卡里完成；图上建的关系会在保存后同步回右栏。
        </p>
      </footer>
    </aside>
  );
}
