import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LevelSystem, NovelEntity } from "../../types";
import EntityDetail from "./index";

// jsdom 没有真实布局，Virtuoso 视口高度为 0 导致不渲染任何行；
// 测试中用平铺渲染等价替身，只保留 data + itemContent 的行为契约。
// 真组件用 computeItemKey 给 item wrapper 上 key，替身同样按索引兜一个，
// 免得刷一堆 React key 警告盖住真实报错。
vi.mock("react-virtuoso", () => ({
  Virtuoso: <T,>(props: {
    data: T[];
    itemContent: (index: number, item: T) => ReactNode;
  }) => (
    <>
      {props.data.map((item, index) => (
        <div key={index}>{props.itemContent(index, item)}</div>
      ))}
    </>
  ),
}));

/**
 * 「当前境界」这一格的回归守卫。
 *
 * 原来的区块整个挂在 `levelSystems.length > 0` 上：新开的书还没有等级体系时
 * 它整块消失 —— 连「管理」按钮也跟着没了，作者在资料卡里找不到任何地方去设
 * 境界关联（用户反馈原话：新开一本书给角色设资料卡时，境界没地方设）。
 */

const entity: NovelEntity = {
  id: "e1",
  workId: "w1",
  type: "character",
  name: "沈砚",
  aliases: [],
  summary: "主角。",
  content: "",
  fields: {},
  sort: 0,
};

const buildProps = (over: Partial<Parameters<typeof EntityDetail>[0]> = {}) => ({
  entity,
  entities: [entity],
  relations: [],
  appearances: [],
  levelSystems: [] as LevelSystem[],
  highlighted: false,
  onToggleHighlight: vi.fn(),
  onExportCard: vi.fn(),
  onSaveEntity: vi.fn(),
  onAddRelation: vi.fn(),
  onRemoveRelation: vi.fn(),
  onSetEntityLevel: vi.fn(),
  onOpenLevelManager: vi.fn(),
  isProtagonist: false,
  onSetProtagonist: vi.fn(),
  onSelectChapter: vi.fn(),
  onBack: vi.fn(),
  ...over,
});

const system: LevelSystem = {
  id: "ls1",
  workId: "w1",
  name: "修仙阶位",
  rungs: [
    { id: "r1", name: "炼气", rank: 1 },
    { id: "r2", name: "筑基", rank: 2 },
  ],
};

describe("EntityDetail：当前境界入口", () => {
  afterEach(() => {
    cleanup();
  });

  it("角色卡还没有等级体系时给出空态与建体系入口（而不是整块消失）", () => {
    const onOpenLevelManager = vi.fn();
    const { container } = render(
      <EntityDetail {...buildProps({ onOpenLevelManager })} />,
    );

    expect(screen.getByText("当前境界")).toBeInTheDocument();
    expect(container.querySelector(".nv-edetail__lvlempty")).not.toBeNull();
    // 阶梯区还没到能用的时候
    expect(container.querySelector(".nv-edetail__ladder")).toBeNull();
    // 空态里已有「＋新建等级体系」，不再并列一个同样打开管理弹框的「管理」
    expect(screen.queryByText("管理")).toBeNull();

    fireEvent.click(screen.getByText("新建等级体系"));
    expect(onOpenLevelManager).toHaveBeenCalledTimes(1);
  });

  it("非角色卡且没有等级体系时不出现这一格（不给地点 / 物品添噪音）", () => {
    render(
      <EntityDetail
        {...buildProps({ entity: { ...entity, type: "location" } })}
      />,
    );

    expect(screen.queryByText("当前境界")).toBeNull();
  });

  it("有等级体系时照旧出阶梯，点等级项即设当前境界", () => {
    const onSetEntityLevel = vi.fn();
    render(
      <EntityDetail
        {...buildProps({ levelSystems: [system], onSetEntityLevel })}
      />,
    );

    expect(screen.queryByText("还没有等级体系")).toBeNull();
    // 有体系时「管理」照旧在（空态才收起，避免与「新建等级体系」重复）
    expect(screen.getByText("管理")).toBeInTheDocument();
    fireEvent.click(screen.getByText("筑基"));
    expect(onSetEntityLevel).toHaveBeenCalledWith("r2");
  });

  it("已绑定的等级项再点一次即取消绑定", () => {
    const onSetEntityLevel = vi.fn();
    render(
      <EntityDetail
        {...buildProps({
          levelSystems: [system],
          onSetEntityLevel,
          relations: [
            {
              id: "l1",
              direction: "out",
              targetId: "r1",
              targetName: "炼气",
              targetType: "level",
              relation: "当前境界",
            },
          ],
        })}
      />,
    );

    expect(screen.getByText("当前")).toBeInTheDocument();
    fireEvent.click(screen.getByText("炼气"));
    expect(onSetEntityLevel).toHaveBeenCalledWith(null);
  });
});

/**
 * 出场章节列表的回归守卫。
 *
 * 这一块此前**完全没有测试**（buildProps 里 appearances 恒为 []），
 * 所以「虚拟化容器只给 max-height → 塌成 0 高度 → 整个列表不可见、
 * 只剩标题上的章数」这个 bug 一路发到用户手里。
 *
 * 两条断言分别钉住两个不会自己报错的退化：
 * 1. 容器必须有**确定高度**（不能只有 max-height）—— 否则 Virtuoso 测不到
 *    可视区，行全部渲染在 0 高盒子里，肉眼看不见但测试查不到元素「缺失」；
 * 2. 点条目必须能跳章 —— 「跳转没显示出来」就是它坏了。
 */
describe("EntityDetail：出场章节列表", () => {
  afterEach(() => {
    cleanup();
  });

  const appearance = (index: number) => ({
    chapterId: `c${index}`,
    label: `第${index}章`,
    title: `第 ${index} 章 正文`,
  });

  it("有确定高度，且随条数自适应、超过上限后封顶", () => {
    const { container, rerender } = render(
      <EntityDetail {...buildProps({ appearances: [appearance(1), appearance(2)] })} />,
    );

    const box = () => container.querySelector<HTMLElement>(".nv-edetail__appear");
    // 少条数：按行高自适应，不留一大片空白
    const short = box();
    expect(short).not.toBeNull();
    expect(short!.style.height).toBe("56px"); // 2 行 × 28px

    // 上千条：封顶 240px，剩下的交给容器内部滚动
    rerender(
      <EntityDetail
        {...buildProps({
          appearances: Array.from({ length: 1996 }, (_, i) => appearance(i)),
        })}
      />,
    );
    expect(box()!.style.height).toBe("240px");
  });

  it("点出场条目跳转到该章（截图里「跳转没显示出来」的那条路径）", () => {
    const onSelectChapter = vi.fn();
    render(
      <EntityDetail
        {...buildProps({
          appearances: [appearance(7)],
          onSelectChapter,
        })}
      />,
    );

    // 标题上的总数还在
    expect(screen.getByText("出场章节")).toBeInTheDocument();
    fireEvent.click(screen.getByText("第 7 章 正文"));
    expect(onSelectChapter).toHaveBeenCalledWith("c7");
  });

  it("没有出场章时整块不渲染（不出现空标题）", () => {
    render(<EntityDetail {...buildProps({ appearances: [] })} />);
    expect(screen.queryByText("出场章节")).toBeNull();
  });
});
