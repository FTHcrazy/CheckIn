import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import DiagramFigure from "./index";
import { DIAGRAMS, type InterviewDiagram } from "../../data/interview-diagrams";

/** 按图型取一张真实数据，避免用例里手写假数据与线上结构脱节 */
function pick(kind: InterviewDiagram["kind"]): InterviewDiagram {
  const found = DIAGRAMS.find((diagram) => diagram.kind === kind);
  if (!found) throw new Error(`缺少 ${kind} 类型的图`);
  return found;
}

describe("DiagramFigure", () => {
  afterEach(() => {
    cleanup();
  });

  it("流程图：节点数正确，箭头数 = 节点数 - 1", () => {
    const diagram = pick("flow");
    if (diagram.kind !== "flow") throw new Error("类型不符");
    const { container } = render(<DiagramFigure diagram={diagram} />);

    expect(container.querySelectorAll(".interview-dg__node")).toHaveLength(
      diagram.nodes.length,
    );
    expect(container.querySelectorAll(".interview-dg__arrow")).toHaveLength(
      diagram.nodes.length - 1,
    );
    expect(container.querySelector(".interview-dg__caption")?.textContent).toBe(
      diagram.caption,
    );
    expect(container.querySelector(".interview-dg__title")?.textContent).toBe(diagram.title);
  });

  it("步骤图：每条事件都有序号与标题", () => {
    const diagram = pick("timeline");
    if (diagram.kind !== "timeline") throw new Error("类型不符");
    const { container } = render(<DiagramFigure diagram={diagram} />);

    const events = container.querySelectorAll(".interview-dg__event");
    expect(events).toHaveLength(diagram.events.length);
    expect(events[0].querySelector(".interview-dg__dot")?.textContent).toBe("1");
    expect(events[0].querySelector(".interview-dg__event-title")?.textContent).toBe(
      diagram.events[0].title,
    );
  });

  it("对照图：左右两栏都渲染，条目数对得上", () => {
    const diagram = pick("compare");
    if (diagram.kind !== "compare") throw new Error("类型不符");
    const { container } = render(<DiagramFigure diagram={diagram} />);

    const columns = container.querySelectorAll(".interview-dg__column");
    expect(columns).toHaveLength(2);
    expect(columns[0].querySelectorAll("li")).toHaveLength(diagram.left.items.length);
    expect(columns[1].querySelectorAll("li")).toHaveLength(diagram.right.items.length);
  });

  it("架构图：分层自上而下，标签渲染为 chip", () => {
    const diagram = pick("layers");
    if (diagram.kind !== "layers") throw new Error("类型不符");
    const { container } = render(<DiagramFigure diagram={diagram} />);

    const layers = container.querySelectorAll(".interview-dg__layer");
    expect(layers).toHaveLength(diagram.layers.length);
    expect(layers[0].querySelector(".interview-dg__layer-index")?.textContent).toBe("L1");

    const tags = diagram.layers.reduce((total, layer) => total + (layer.tags?.length ?? 0), 0);
    expect(container.querySelectorAll(".interview-dg__layer-tag")).toHaveLength(tags);
  });

  it("可选字段缺省时不渲染空的编号列表与提醒条", () => {
    // 用最小结构验证「可选」的语义：真实数据每条都写了 steps，直接拿真实数据测不出来
    const minimal: InterviewDiagram = {
      id: "dg-test-minimal",
      kind: "flow",
      title: "极简图",
      caption: "只验证可选字段缺省时的渲染分支",
      nodes: [{ label: "A" }, { label: "B" }, { label: "C" }],
    };
    const { container } = render(<DiagramFigure diagram={minimal} />);

    expect(container.querySelectorAll(".interview-dg__node")).toHaveLength(3);
    expect(container.querySelector(".interview-dg__steps")).toBeNull();
    expect(container.querySelector(".interview-dg__note")).toBeNull();
  });

  it("易错提醒必带前缀，便于扫读时快速定位", () => {
    const diagram = DIAGRAMS.find((item) => item.note !== undefined);
    const { container } = render(<DiagramFigure diagram={diagram as InterviewDiagram} />);

    expect(container.querySelector(".interview-dg__note")?.textContent).toMatch(/^易错：/);
  });
});
