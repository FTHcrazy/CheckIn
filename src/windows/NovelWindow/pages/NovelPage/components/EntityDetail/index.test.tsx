import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LevelSystem, NovelEntity } from "../../types";
import EntityDetail from "./index";

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
