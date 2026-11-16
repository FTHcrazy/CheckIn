import type { ReactNode } from "react";
import {
  DIAGRAM_KIND_LABEL,
  type CompareDiagram,
  type FlowDiagram,
  type InterviewDiagram,
  type LayersDiagram,
  type TimelineDiagram,
} from "../../data/interview-diagrams";
import "./index.scss";

interface DiagramFigureProps {
  diagram: InterviewDiagram;
  /** 抽屉里用紧凑一档间距，卡片里用默认 */
  compact?: boolean;
}

/** 步骤链：节点 + 箭头，宽度不够时整体换行 */
function FlowBody({ diagram }: { diagram: FlowDiagram }): ReactNode {
  return (
    <div className="interview-dg__flow">
      {diagram.nodes.map((node, index) => (
        <div className="interview-dg__flow-item" key={`${node.label}-${index}`}>
          <div className={`interview-dg__node is-${node.tone ?? "muted"}`}>
            <span className="interview-dg__node-label">{node.label}</span>
            {node.note ? <span className="interview-dg__node-note">{node.note}</span> : null}
          </div>
          {index < diagram.nodes.length - 1 ? (
            <span className="interview-dg__arrow" aria-hidden="true" />
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** 时序 / 步骤：左侧竖轴 + 圆点 */
function TimelineBody({ diagram }: { diagram: TimelineDiagram }): ReactNode {
  return (
    <ol className="interview-dg__timeline">
      {diagram.events.map((event, index) => (
        <li className={`interview-dg__event is-${event.tone ?? "primary"}`} key={`${event.title}-${index}`}>
          <span className="interview-dg__dot" aria-hidden="true">
            {index + 1}
          </span>
          <div className="interview-dg__event-body">
            <span className="interview-dg__event-title">{event.title}</span>
            {event.detail ? (
              <span className="interview-dg__event-detail">{event.detail}</span>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** 左右对照：列数不写死，窄容器自动折成一列 */
function CompareBody({ diagram }: { diagram: CompareDiagram }): ReactNode {
  const columns = [diagram.left, diagram.right];
  return (
    <div className="interview-dg__compare">
      {columns.map((column) => (
        <div className="interview-dg__column" key={column.title}>
          <div className="interview-dg__column-head">
            <span className="interview-dg__column-title">{column.title}</span>
            {column.note ? (
              <span className="interview-dg__column-note">{column.note}</span>
            ) : null}
          </div>
          <ul className="interview-dg__column-items">
            {column.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** 分层：自上而下堆叠，每层可带关键词 chip */
function LayersBody({ diagram }: { diagram: LayersDiagram }): ReactNode {
  return (
    <div className="interview-dg__layers">
      {diagram.layers.map((layer, index) => (
        <div className="interview-dg__layer" key={`${layer.label}-${index}`}>
          <span className="interview-dg__layer-index" aria-hidden="true">
            L{index + 1}
          </span>
          <div className="interview-dg__layer-body">
            <span className="interview-dg__layer-label">{layer.label}</span>
            {layer.note ? (
              <span className="interview-dg__layer-note">{layer.note}</span>
            ) : null}
          </div>
          {layer.tags && layer.tags.length > 0 ? (
            <div className="interview-dg__layer-tags">
              {layer.tags.map((tag) => (
                <span className="interview-dg__layer-tag" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function DiagramBody({ diagram }: { diagram: InterviewDiagram }): ReactNode {
  switch (diagram.kind) {
    case "flow":
      return <FlowBody diagram={diagram} />;
    case "timeline":
      return <TimelineBody diagram={diagram} />;
    case "compare":
      return <CompareBody diagram={diagram} />;
    case "layers":
      return <LayersBody diagram={diagram} />;
    default:
      return null;
  }
}

/**
 * 图解卡片。
 *
 * 纯布局组件：所有内容来自 `interview-diagrams.ts`，颜色只消费 `--app-*`。
 * 每个图都强制带一句 caption，因为「图看懂了但结论说错」比不看图更糟。
 */
export default function DiagramFigure({
  diagram,
  compact = false,
}: DiagramFigureProps): ReactNode {
  return (
    <figure className={`interview-dg is-${diagram.kind}${compact ? " is-compact" : ""}`}>
      <figcaption className="interview-dg__head">
        <span className="interview-dg__kind">{DIAGRAM_KIND_LABEL[diagram.kind]}</span>
        <span className="interview-dg__title">{diagram.title}</span>
      </figcaption>

      <div className="interview-dg__canvas">
        <DiagramBody diagram={diagram} />
      </div>

      <p className="interview-dg__caption">{diagram.caption}</p>

      {diagram.steps && diagram.steps.length > 0 ? (
        <ol className="interview-dg__steps">
          {diagram.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}

      {diagram.note ? <p className="interview-dg__note">易错：{diagram.note}</p> : null}
    </figure>
  );
}
