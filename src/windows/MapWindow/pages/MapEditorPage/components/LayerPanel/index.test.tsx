import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import LayerPanel from "./index";
import { createEmptyDocument, createLabelId, type MapDocument } from "../../types";
import type { MapRegion } from "../../regions";

/**
 * 图层面板（R-MAP-24 / B4-1）。
 *
 * 【为什么在这一层测】面板是纯展示组件（吃 `doc` + 两个回调），要钉的规则全在
 * "行怎么呈现"上：六行齐全、只读行没有开关、计数从文档来、隐藏/锁定体现在
 * `data-*` 上、折叠不丢行。页面级覆盖这些得先生成一张图再点，既贵又会把
 * 面板的规则与画布的渲染混在一起。
 */

const noop = () => {};

/** 造一个最小区块（面板不碰几何，三角形足够） */
function mkRegion(id: string, name: string, submap?: MapRegion["submap"]): MapRegion {
  return {
    id,
    parentId: null,
    level: 0,
    name,
    seed: { x: 0, y: 0 },
    polygon: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ],
    color: 0x445566,
    ...(submap ? { submap } : {}),
  };
}

/** 造一个"每层都有内容"的文档（计数断言要有区分度，不能全是 0） */
function withContent(): MapDocument {
  return {
    ...createEmptyDocument(),
    regions: [
      mkRegion("r1", "普通区块"),
      mkRegion("r2", "带子图的区块", {
        id: "sm_1",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        land: null,
        regions: [],
        elements: [],
        labels: [],
        style: "none",
        baseImageId: "base-1",
      }),
    ],
    elements: [
      { id: "el_1", spriteId: "mountain-1", x: 0, y: 0, scale: 1, rotation: 0, level: null },
    ],
    labels: [{ id: createLabelId(), text: "临安", x: 0, y: 0, size: 12, level: null }],
    polylines: [
      {
        id: "pl_1",
        kind: "river",
        styleId: "river",
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        closed: false,
        level: null,
      },
    ],
  };
}

function rowOf(id: string): HTMLElement {
  const row = document.querySelector(`[data-layer="${id}"]`);
  if (!row) throw new Error(`找不到图层行 ${id}`);
  return row as HTMLElement;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("LayerPanel · 行结构", () => {
  it("六行齐全且顺序固定（底图在最下，地名在最上）", () => {
    render(<LayerPanel doc={withContent()} onToggleVisible={noop} onToggleLock={noop} />);
    const ids = Array.from(document.querySelectorAll("[data-layer]")).map((el) =>
      el.getAttribute("data-layer"),
    );
    expect(ids).toEqual(["base", "region", "polyline", "element", "submap", "label"]);
    expect(screen.getByText("图层")).toBeTruthy();
  });

  it("底图行是只读的：没有眼睛/锁按钮，只有一颗静态锁", () => {
    render(<LayerPanel doc={withContent()} onToggleVisible={noop} onToggleLock={noop} />);
    const base = rowOf("base");
    expect(base.querySelectorAll("button")).toHaveLength(0);
    expect(base.className).toContain("layer-row--readonly");
    // 底图不显示计数
    expect(base.querySelector(".layer-row__count")).toBeNull();
  });

  it("计数从文档算：区块 2 / 折线 1 / 素材 1 / 子图 1 / 地名 1", () => {
    render(<LayerPanel doc={withContent()} onToggleVisible={noop} onToggleLock={noop} />);
    const counts = (id: string) => rowOf(id).querySelector(".layer-row__count")?.textContent;
    expect(counts("region")).toBe("2");
    expect(counts("polyline")).toBe("1");
    expect(counts("element")).toBe("1");
    // 只有 r2 挂了子图
    expect(counts("submap")).toBe("1");
    expect(counts("label")).toBe("1");
  });

  it("空文档也照常显示六行（层是能力，不是数据）", () => {
    render(<LayerPanel doc={createEmptyDocument()} onToggleVisible={noop} onToggleLock={noop} />);
    expect(document.querySelectorAll("[data-layer]")).toHaveLength(6);
    expect(rowOf("element").querySelector(".layer-row__count")?.textContent).toBe("0");
  });
});

describe("LayerPanel · 开关", () => {
  it("点眼睛回传层 id（隐藏素材层）", () => {
    const onToggleVisible = vi.fn();
    render(
      <LayerPanel
        doc={withContent()}
        onToggleVisible={onToggleVisible}
        onToggleLock={noop}
      />,
    );
    fireEvent.click(screen.getByLabelText("隐藏素材层"));
    expect(onToggleVisible).toHaveBeenCalledWith("element");
  });

  it("点锁回传层 id", () => {
    const onToggleLock = vi.fn();
    render(<LayerPanel doc={withContent()} onToggleVisible={noop} onToggleLock={onToggleLock} />);
    fireEvent.click(screen.getByLabelText("锁定地名层"));
    expect(onToggleLock).toHaveBeenCalledWith("label");
  });

  it("隐藏态体现在 data-visible=0 与弱化样式上，图标换成「已隐藏」", () => {
    const doc: MapDocument = { ...withContent(), layerState: { element: { visible: false } } };
    render(<LayerPanel doc={doc} onToggleVisible={noop} onToggleLock={noop} />);
    const row = rowOf("element");
    expect(row.getAttribute("data-visible")).toBe("0");
    expect(row.className).toContain("layer-row--hidden");
    // 隐藏后按钮语义反过来：现在点它是「显示」
    expect(screen.getByLabelText("显示素材层")).toBeTruthy();
  });

  it("锁定态体现在 data-locked=1 上，且不影响可见性", () => {
    const doc: MapDocument = { ...withContent(), layerState: { label: { locked: true } } };
    render(<LayerPanel doc={doc} onToggleVisible={noop} onToggleLock={noop} />);
    expect(rowOf("label").getAttribute("data-locked")).toBe("1");
    expect(rowOf("label").getAttribute("data-visible")).toBe("1");
    expect(screen.getByLabelText("解锁地名层")).toBeTruthy();
  });

  it("区块层的可见性读 showRegions（D4：不在 layerState 里）", () => {
    const doc: MapDocument = { ...withContent(), showRegions: false };
    render(<LayerPanel doc={doc} onToggleVisible={noop} onToggleLock={noop} />);
    expect(rowOf("region").getAttribute("data-visible")).toBe("0");
  });
});

describe("LayerPanel · 折叠", () => {
  it("默认展开；点标题折叠后行消失，偏好写入 localStorage", () => {
    render(<LayerPanel doc={createEmptyDocument()} onToggleVisible={noop} onToggleLock={noop} />);
    expect(document.querySelectorAll("[data-layer]")).toHaveLength(6);

    fireEvent.click(screen.getByText("图层"));
    expect(document.querySelectorAll("[data-layer]")).toHaveLength(0);
    expect(window.localStorage.getItem("map-layer-panel-collapsed")).toBe("1");
  });

  it("上次折叠过的话，再打开是折叠态（偏好跨会话保留）", () => {
    window.localStorage.setItem("map-layer-panel-collapsed", "1");
    render(<LayerPanel doc={createEmptyDocument()} onToggleVisible={noop} onToggleLock={noop} />);
    expect(document.querySelectorAll("[data-layer]")).toHaveLength(0);
  });
});
