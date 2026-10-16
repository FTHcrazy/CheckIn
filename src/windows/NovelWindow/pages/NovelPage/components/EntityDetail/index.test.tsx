import path from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import * as sass from "sass";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NovelEntity, SettingCategory } from "../../types";
import EntityDetail, { APPEAR_ROW_HEIGHT } from "./index";

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
 * 原来的区块整个挂在 `levelSystems.length > 0` 上：新开的书还没有境界体系时
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
  settings: [] as SettingCategory[],
  highlighted: false,
  onToggleHighlight: vi.fn(),
  onExportCard: vi.fn(),
  onSaveEntity: vi.fn(),
  onAddRelation: vi.fn(),
  onRemoveRelation: vi.fn(),
  onSetEntityLevel: vi.fn(),
  onOpenSettings: vi.fn(),
  isProtagonist: false,
  onSetProtagonist: vi.fn(),
  onSelectChapter: vi.fn(),
  onBack: vi.fn(),
  ...over,
});

const realmCategory: SettingCategory = {
  id: "ls1",
  workId: "w1",
  name: "修仙阶位",
  color: "#5B8DEF",
  kind: "realm",
  sortOrder: 1,
  note: "",
  subLevels: 1,
  carryDir: "asc",
  subPattern: "第{n}层",
  levels: [
    {
      id: "r1",
      categoryId: "ls1",
      name: "炼气",
      rank: 1,
      aliases: [],
      note: "",
      subLevels: 1,
      subPattern: "",
      power: null,
      parentId: null,
      segFrom: null,
      segTo: null,
    },
    {
      id: "r2",
      categoryId: "ls1",
      name: "筑基",
      rank: 2,
      aliases: [],
      note: "",
      subLevels: 1,
      subPattern: "",
      power: null,
      parentId: null,
      segFrom: null,
      segTo: null,
    },
  ],
};

describe("EntityDetail：当前境界入口", () => {
  afterEach(() => {
    cleanup();
  });

  it("角色卡还没有境界体系时给出空态与建体系入口（而不是整块消失）", () => {
    const onOpenSettings = vi.fn();
    const { container } = render(
      <EntityDetail {...buildProps({ onOpenSettings })} />,
    );

    expect(screen.getByText("当前境界")).toBeInTheDocument();
    expect(container.querySelector(".nv-edetail__lvlempty")).not.toBeNull();
    // 阶梯区还没到能用的时候
    expect(container.querySelector(".nv-edetail__ladder")).toBeNull();
    // 空态里已有「＋新建境界体系」，不再并列一个同样打开管理弹框的「管理」
    expect(screen.queryByText("管理")).toBeNull();

    fireEvent.click(screen.getByText("新建境界体系"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("非角色卡且没有境界体系时不出现这一格（不给地点 / 物品添噪音）", () => {
    render(
      <EntityDetail
        {...buildProps({ entity: { ...entity, type: "location" } })}
      />,
    );

    expect(screen.queryByText("当前境界")).toBeNull();
  });

  it("有境界体系时照旧出阶梯，点等级项即设当前境界", () => {
    const onSetEntityLevel = vi.fn();
    render(
      <EntityDetail
        {...buildProps({ settings: [realmCategory], onSetEntityLevel })}
      />,
    );

    expect(screen.queryByText("还没有境界体系")).toBeNull();
    // 有体系时「管理」照旧在（空态才收起，避免与「新建境界体系」重复）
    expect(screen.getByText("管理")).toBeInTheDocument();
    fireEvent.click(screen.getByText("筑基"));
    // 第二参显式 undefined：筑基没有子层级，note 里不写 {sub}
    // （与「父阶是组」那条 1.38.1 用例同一口径）
    expect(onSetEntityLevel).toHaveBeenCalledWith("r2", undefined);
  });

  it("已绑定的等级项再点一次即取消绑定", () => {
    const onSetEntityLevel = vi.fn();
    render(
      <EntityDetail
        {...buildProps({
          settings: [realmCategory],
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

  it("拆分后的子层级不当独立阶平铺：只列父阶，段是阶内进度（1.38.1）", () => {
    const { container } = render(
      <EntityDetail
        {...buildProps({
          settings: [
            {
              ...realmCategory,
              levels: [
                { ...realmCategory.levels[0], subLevels: 9 },
                {
                  ...realmCategory.levels[0],
                  id: "r1__seg1",
                  name: "炼气 · 第1段",
                  rank: 2,
                  parentId: "r1",
                  segFrom: 1,
                  segTo: 1,
                  subLevels: 1,
                },
              ],
            },
          ],
          relations: [
            {
              id: "l1",
              direction: "out",
              targetId: "r1__seg1",
              targetName: "炼气 · 第1段",
              targetType: "level",
              relation: "当前境界",
            },
          ],
        })}
      />,
    );

    // 父阶只出现一次：绑在派生段上也不多出一行「阶」
    expect(screen.getByText("炼气")).toBeInTheDocument();
    // 段以阶内进度小条出现，且带高亮
    expect(container.querySelector(".nv-edetail__rung-seg.is-on")).not.toBeNull();
    // 父阶行内标注境界内进度（1–1 / 共 9 层）并带「当前」
    expect(screen.getByText(/1–1 \/ 共 9 层/)).toBeInTheDocument();
    expect(container.querySelector(".nv-edetail__rung.is-on")).not.toBeNull();
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
    expect(short!.style.height).toBe("76px"); // 2 行 × 38px（REQ-046 行高 34→38）

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

  it("父阶是组：点父阶绑定 (根阶, 第 1 层)，与行囊共用同一坐标（1.38.1）", () => {
    const onSetEntityLevel = vi.fn();
    render(
      <EntityDetail
        {...buildProps({
          settings: [
            {
              ...realmCategory,
              levels: [
                { ...realmCategory.levels[0], subLevels: 9 },
                {
                  ...realmCategory.levels[0],
                  id: "r1__seg1",
                  name: "第1层",
                  rank: 2,
                  parentId: "r1",
                  segFrom: 1,
                  segTo: 1,
                  subLevels: 1,
                },
                {
                  ...realmCategory.levels[0],
                  id: "r1__seg2",
                  name: "第2层",
                  rank: 3,
                  parentId: "r1",
                  segFrom: 2,
                  segTo: 2,
                  subLevels: 1,
                },
                realmCategory.levels[1],
              ],
            },
          ],
          onSetEntityLevel,
        })}
      />,
    );

    // 切到有子层级的父阶 = 绑定 (根阶, 第 1 层)，而不是组本身或子层级 id
    fireEvent.click(screen.getByText("炼气"));
    expect(onSetEntityLevel).toHaveBeenCalledWith("r1", 1);

    // 没有子层级的父阶照旧绑自己
    fireEvent.click(screen.getByText("筑基"));
    expect(onSetEntityLevel).toHaveBeenLastCalledWith("r2", undefined);
  });

  it("绑定统一落 (根阶, note.sub)：行囊写回的进度在实体卡上高亮对应子层级", () => {
    const { container } = render(
      <EntityDetail
        {...buildProps({
          settings: [
            {
              ...realmCategory,
              levels: [
                { ...realmCategory.levels[0], subLevels: 9 },
                {
                  ...realmCategory.levels[0],
                  id: "r1__seg1",
                  name: "第1层",
                  rank: 2,
                  parentId: "r1",
                  segFrom: 1,
                  segTo: 1,
                  subLevels: 1,
                },
                {
                  ...realmCategory.levels[0],
                  id: "r1__seg2",
                  name: "第2层",
                  rank: 3,
                  parentId: "r1",
                  segFrom: 2,
                  segTo: 2,
                  subLevels: 1,
                },
              ],
            },
          ],
          relations: [
            {
              id: "l1",
              direction: "out",
              targetId: "r1",
              targetName: "炼气",
              targetType: "level",
              relation: "当前境界",
              note: '{"sub":2}',
            },
          ],
        })}
      />,
    );

    // 根阶行高亮 + 标注阶内进度（2–2 / 共 9 层）
    expect(container.querySelector(".nv-edetail__rung.is-on")).not.toBeNull();
    expect(screen.getByText(/2–2 \/ 共 9 层/)).toBeInTheDocument();
    // 对应子层级小条高亮
    expect(container.querySelector(".nv-edetail__rung-seg.is-on")).not.toBeNull();
  });
});

/**
 * REQ-045：要素境界支持选「小境界」。
 *
 * 原实现里，**未拆分**但配了多个小层的阶（`sub_levels > 1` 且没有派生段）
 * 只能绑到阶本身，选不到第 N 层 —— 与行囊 ±1 层的坐标（novel_links.note.sub）
 * 对不上。新增的小层 chip 组把阶内每一层都列出来，绑定坐标是 (根阶 id, 第 N 层)。
 * 「已拆分」的阶仍走派生段那行，两行**互斥**渲染，不并列。
 */
describe("EntityDetail：当前境界可选小境界（REQ-045）", () => {
  afterEach(() => {
    cleanup();
  });

  /** 造一个「未拆分、但配了 subLevels 个小层」的体系 */
  const ladder = (subLevels: number): SettingCategory => ({
    ...realmCategory,
    subLevels,
    levels: [
      { ...realmCategory.levels[0], subLevels, subPattern: "第{n}层" },
      realmCategory.levels[1],
    ],
  });

  it("未拆分但配了 13 层的阶 → 点第 7 层 → 回调 (根阶 id, 7)", () => {
    const onSetEntityLevel = vi.fn();
    const { container } = render(
      <EntityDetail
        {...buildProps({ settings: [ladder(13)], onSetEntityLevel })}
      />,
    );

    // 阶内小层 chip 组渲染出来（而不是派生段那行）
    expect(container.querySelector(".nv-edetail__rung-subs")).not.toBeNull();
    expect(container.querySelector(".nv-edetail__rung-segs")).toBeNull();

    fireEvent.click(screen.getByText("第7层"));
    expect(onSetEntityLevel).toHaveBeenCalledWith("r1", 7);
  });

  it("sub_levels <= 1 的阶不出现小层 chip，绑定照旧落 undefined", () => {
    const onSetEntityLevel = vi.fn();
    const { container } = render(
      <EntityDetail
        {...buildProps({ settings: [ladder(1)], onSetEntityLevel })}
      />,
    );

    expect(container.querySelector(".nv-edetail__rung-subs")).toBeNull();
    fireEvent.click(screen.getByText("炼气"));
    expect(onSetEntityLevel).toHaveBeenCalledWith("r1", undefined);
  });

  it("已拆分（有派生段）的阶保持派生段那行，不并列小层 chip（互斥）", () => {
    const { container } = render(
      <EntityDetail
        {...buildProps({
          settings: [
            {
              ...realmCategory,
              levels: [
                { ...realmCategory.levels[0], subLevels: 9 },
                {
                  ...realmCategory.levels[0],
                  id: "r1__seg1",
                  name: "第1段",
                  rank: 2,
                  parentId: "r1",
                  segFrom: 1,
                  segTo: 1,
                  subLevels: 1,
                },
              ],
            },
          ],
        })}
      />,
    );

    expect(container.querySelector(".nv-edetail__rung-segs")).not.toBeNull();
    expect(container.querySelector(".nv-edetail__rung-subs")).toBeNull();
  });

  it("当前绑定的那一层（note.sub）高亮为 .is-on，再点即取消绑定", () => {
    const onSetEntityLevel = vi.fn();
    const { container } = render(
      <EntityDetail
        {...buildProps({
          settings: [ladder(13)],
          onSetEntityLevel,
          relations: [
            {
              id: "l1",
              direction: "out",
              targetId: "r1",
              targetName: "炼气",
              targetType: "level",
              relation: "当前境界",
              note: '{"sub":7}',
            },
          ],
        })}
      />,
    );

    const on = container.querySelector(".nv-edetail__rung-sub.is-on");
    expect(on).not.toBeNull();
    // 小层名与阶内层号一致（模板「第{n}层」→ 第7层）
    expect(on!.textContent).toBe("第7层");

    fireEvent.click(on!);
    // 再点当前层 → 解除绑定（不落回阶本身）
    expect(onSetEntityLevel).toHaveBeenCalledWith(null);
  });
});

/**
 * REQ-046：出场章节列表行间距 4 → 8，行高常量与 SCSS 成对同步。
 *
 * 这是本项唯一的「常量与 SCSS 成对」契约：`APPEAR_ROW_HEIGHT` 给 Virtuoso
 * 换算滚动区间，SCSS 的 `padding-bottom` 决定真实行盒高度；两者不一致会出现
 * 跳白条 / 行错位 —— 且没有任何类型或构建错误提示你改漏了一边。
 */
describe("EntityDetail：出场列表行高契约（REQ-046）", () => {
  it("APPEAR_ROW_HEIGHT 为 38（= 行盒 18 + padding 5×2 + 描边 1×2 + 行间距 8）", () => {
    expect(APPEAR_ROW_HEIGHT).toBe(38);
  });

  it("index.scss 的行间距与常量同步（padding-bottom: 8px）", () => {
    const css = sass
      .compile(
        path.resolve(
          process.cwd(),
          "src/windows/NovelWindow/pages/NovelPage/components/EntityDetail/index.scss",
        ),
        { style: "expanded" },
      )
      .css.replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = css.match(
      /\.nv-edetail__appear-list\s*>\s*div\s*>\s*div\s*\{([^}]*)\}/,
    );
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain("padding-bottom: 8px");
  });
});
