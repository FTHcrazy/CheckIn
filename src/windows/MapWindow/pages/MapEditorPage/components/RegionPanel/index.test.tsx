import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import RegionPanel from "./index";
import type { MapRegion } from "../../regions";

/**
 * `RegionPanel` 的层级面包屑（R-REG-05）。
 *
 * 【为什么在这一层测】面板是**纯展示组件**（只吃 props、不读 store），
 * 面包屑的输入就是 `regionPath` + `isLeaf` 两个 prop。页面级要覆盖它，得先
 * 生成 223 块、再在画布上点中一个"恰好有祖父"的区块 —— 又贵又不稳定，
 * 而真正要钉的不变量只有"叶子不显示 / 非叶子显示且顺序是根→父→自身 /
 * 断链或空名不得留空段"。这些都是纯 props 行为。
 */

const noop = () => {};

function mk(
  id: string,
  parentId: string | null,
  level: number,
  name: string,
): MapRegion {
  return {
    id,
    parentId,
    level,
    name,
    seed: { x: 0, y: 0 },
    // 面板不碰几何，一个最小三角形足够（避免用空数组触发"没有多边形"的分支）
    polygon: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ],
    color: 0x445566,
  };
}

const ROOT = mk("r0", null, 0, "大陆 1");
const PARENT = mk("r1", "r0", 1, "洲 3");
const SELF = mk("r2", "r1", 2, "国家 12");

function panel(options: {
  region: MapRegion;
  regionPath: MapRegion[];
  isLeaf: boolean;
  subtreeInfo?: { count: number; withSubmap: number };
}) {
  return (
    <RegionPanel
      region={options.region}
      regionPath={options.regionPath}
      isLeaf={options.isLeaf}
      subtreeInfo={options.subtreeInfo ?? { count: 0, withSubmap: 0 }}
      onCarve={noop}
      onEmbed={noop}
      onMerge={noop}
      onRemove={noop}
      onFocus={noop}
      onFocusWorld={noop}
      onClose={noop}
    />
  );
}

/** 面包屑容器（用 `aria-label` 取，不依赖 class 名） */
function breadcrumb(): HTMLElement | null {
  return screen.queryByLabelText("层级路径");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RegionPanel 层级面包屑", () => {
  it("非叶子选中：显示「根 → 父 → 自身」三段", () => {
    render(panel({ region: SELF, regionPath: [ROOT, PARENT, SELF], isLeaf: false }));

    const crumb = breadcrumb();
    expect(crumb).not.toBeNull();
    const text = (crumb as HTMLElement).textContent ?? "";
    // 段与段之间是 `/`，顺序必须是 根 → 父 → 自身
    expect(text.replace(/\s/g, "")).toMatch(/^大陆1\/洲3\/国家12$/);
  });

  it("叶子选中：不显示面包屑（叶子有面高亮，路径只是噪声）", () => {
    render(panel({ region: SELF, regionPath: [ROOT, PARENT, SELF], isLeaf: true }));
    expect(breadcrumb()).toBeNull();
  });

  it("一级区块选中（非叶子）：只有一段，不出现前导 / 结尾 / 分隔符", () => {
    render(panel({ region: ROOT, regionPath: [ROOT], isLeaf: false }));
    const text = (breadcrumb() as HTMLElement).textContent ?? "";
    expect(text.replace(/\s/g, "")).toBe("大陆1");
  });

  it("祖先被合并过（name 为空）：跳过该段，不留空段也不出现 undefined", () => {
    // 断链场景：中间那一段没有名字（例如老数据 / 被合并过）
    const nameless = mk("r9", "r0", 1, "");
    render(panel({ region: SELF, regionPath: [ROOT, nameless, SELF], isLeaf: false }));

    const text = (breadcrumb() as HTMLElement).textContent ?? "";
    const compact = text.replace(/\s/g, "");
    expect(compact).toBe("大陆1/国家12");
    expect(compact).not.toContain("//"); // 空段
    expect(compact).not.toContain("undefined");
  });

  it("未选中区块时整体不渲染（既没有面板也没有面包屑）", () => {
    render(
      <RegionPanel
        region={null}
        regionPath={[]}
        isLeaf={false}
        onCarve={noop}
        onEmbed={noop}
        onMerge={noop}
        onRemove={noop}
        onFocus={noop}
        onFocusWorld={noop}
        onClose={noop}
      />,
    );
    expect(breadcrumb()).toBeNull();
    expect(screen.queryByText("区块操作")).toBeNull();
  });
});

/**
 * 「合并子区域」按钮（R-REG-04 / PRD §4.3）。
 *
 * 【为什么在这一层测"灰化"】叶子与非叶子的区别就是 `isLeaf` + `subtreeInfo.count`
 * 两个 prop；页面级要复现"选中一个叶子"得先生成 223 块再在画布上点中一块 ——
 * 又贵又不定。而"叶子点不动、非叶子带数量"正是 PRD 表格里的两行状态。
 */
describe("RegionPanel 合并子区域按钮", () => {
  /** 按钮的可访问名里带数量，所以用正则取（叶子时没有括号） */
  const mergeBtn = () => screen.getByRole("button", { name: /合并子区域/ });

  it("叶子：按钮存在但 disabled（不隐藏 —— 隐藏会让按钮数量随选中对象跳变）", () => {
    render(panel({ region: SELF, regionPath: [ROOT, PARENT, SELF], isLeaf: true }));
    expect(mergeBtn()).toBeDisabled();
  });

  it("非叶子：按钮可用，并在可访问名里报出后代数量", () => {
    render(
      panel({
        region: SELF,
        regionPath: [ROOT, PARENT, SELF],
        isLeaf: false,
        subtreeInfo: { count: 7, withSubmap: 2 },
      }),
    );
    const btn = mergeBtn();
    expect(btn).not.toBeDisabled();
    expect(btn.textContent ?? "").toContain("7");
  });

  it("非叶子但子树计数为 0（脏数据）：仍然禁用，不给人一条通向空操作的按钮", () => {
    render(
      panel({
        region: SELF,
        regionPath: [ROOT, PARENT, SELF],
        isLeaf: false,
        subtreeInfo: { count: 0, withSubmap: 0 },
      }),
    );
    expect(mergeBtn()).toBeDisabled();
  });
});
