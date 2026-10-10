import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RecordDrawer from "./index";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import type { PackDoc } from "../../hooks/usePackData";
import type { LadderRung } from "../../pack-utils";
import { DEFAULT_UI_PREFS, type PackAttribute, type PackItem, type PackRecord } from "../../types";

/**
 * 盘点记录抽屉（REQ-029 的对比视图 + REQ-044 的回退点）。
 *
 * 这里钉的主要是**空态的三分支**：没有起点 / 起点读不出来 / 有起点但没变化，
 * 三者含义完全不同，混成一个「暂无数据」就等于把「旧记录读不出来」
 * 长期藏起来 —— 那种沉默正是这类功能最容易烂掉的地方。
 */

const LADDER: LadderRung[] = [
  { id: "l1", name: "炼气", rank: 1, subLevels: 9, power: 100 },
  { id: "l2", name: "筑基", rank: 2, subLevels: 9, power: 1000 },
];

function attr(partial: Partial<PackAttribute> = {}): PackAttribute {
  return {
    id: "a1",
    characterId: "c1",
    groupName: "基础",
    name: "攻击",
    baseValue: 0,
    decimals: 0,
    unit: "",
    sortOrder: 1,
    updatedAt: 0,
    ...partial,
  };
}

function item(partial: Partial<PackItem> = {}): PackItem {
  return {
    id: "i1",
    characterId: "c1",
    name: "破境丹",
    category: "丹药",
    qty: 2,
    rarity: "fine",
    icon: "",
    desc: "",
    tags: [],
    equippedSlotId: "",
    slotIndex: null,
    sourceChapterId: "",
    weight: 0,
    updatedAt: 0,
    ...partial,
  };
}

/** 记录 payload = 保存前的库内快照（与 PackDoc 同构，另加 realmLink 那一格） */
function payloadOf(partial: Record<string, unknown> = {}): string {
  return JSON.stringify({
    character: { id: "c1", workId: "w1", name: "主角", entityId: "e1", realmAt: "" },
    attributes: [],
    slots: [],
    items: [],
    skills: [],
    modifiers: [],
    unitSystems: [],
    layouts: [],
    presets: [],
    realmLink: null,
    ...partial,
  });
}

function record(partial: Partial<PackRecord> = {}): PackRecord {
  return {
    id: "r1",
    characterId: "c1",
    chapterId: "ch1",
    takenAt: Date.now() - 60_000,
    reason: "改动前自动存档：手动保存",
    payload: payloadOf(),
    ...partial,
  };
}

const currentDoc: PackDoc = {
  character: {
    id: "c1",
    workId: "w1",
    name: "主角",
    avatar: "",
    isProtagonist: true,
    entityId: "e1",
    realmAt: "",
    weightLimit: 0,
    capacityLimit: 0,
    note: "",
    sortOrder: 1,
  },
  attributes: [attr({ baseValue: 100 })],
  slots: [],
  items: [],
  skills: [],
  modifiers: [],
  unitSystems: [],
  layouts: [],
  presets: [],
};

function makeApi(over: Partial<PackPanelApi> = {}) {
  const records = [record()];
  return {
    recordDrawerOpen: true,
    chapterBaseline: records[0],
    doc: currentDoc,
    meta: { records, levelSystems: [], realmLink: null },
    rungs: LADDER,
    prefs: { ...DEFAULT_UI_PREFS, collapsed: {} },
    restoreFromRecord: vi.fn(() => true),
    showToast: vi.fn(),
    setRecordDrawerOpen: vi.fn(),
    ...over,
  } as unknown as PackPanelApi;
}

const diffBlock = () => document.querySelector(".cpk-diff") as HTMLElement;
const diffRows = () =>
  Array.from(document.querySelectorAll(".cpk-diff__row")).map((row) => row.textContent);

/**
 * antd 默认给两字中文按钮插一个字间距空格（「载入」→「载 入」）。应用里由
 * ThemeProvider 关掉了，但组件测试直接 render、不走 ThemeProvider ——
 * 所以按「去掉空白后相等」匹配，而不是把断言写成带空格的怪样子
 * （那样以后关掉字间距又会全红）。
 */
const stripped = (text: string | null | undefined): string => (text ?? "").replace(/\s+/g, "");

/** 按「按钮」查文本：限定 tagName 是必须的，antd 会把文字再包一层 `<span>` */
const buttonText = (scope: HTMLElement | Document, text: string): HTMLElement =>
  within(scope as HTMLElement).getByText(
    (_content, element) =>
      element?.tagName === "BUTTON" && stripped(element.textContent) === stripped(text),
  );

describe("RecordDrawer —— 与本章初对比（REQ-029）", () => {
  afterEach(cleanup);

  it("本章没有起点 → 明确说是「还没保存过」，并给出怎么才能有", () => {
    render(<RecordDrawer api={makeApi({ chapterBaseline: null })} />);
    expect(screen.getByText("与本章初对比")).toBeInTheDocument();
    expect(screen.getByText(/本章还没有盘点起点/)).toBeInTheDocument();
    // 不该退化成「没有变化」——那是另一种事实
    expect(screen.queryByText("与本章初相比没有变化。")).toBeNull();
  });

  it("有起点但 payload 读不出来 → 如实说读不出来，不当成「全被删了」", () => {
    render(<RecordDrawer api={makeApi({ chapterBaseline: record({ payload: "{ 坏掉的 json" }) })} />);
    expect(screen.getByText(/无法对比/)).toBeInTheDocument();
    expect(diffRows()).toEqual([]);
    expect(screen.queryByText("与本章初相比没有变化。")).toBeNull();
  });

  it("有起点、确实没变 → 说没变化（而不是空着）", () => {
    const api = makeApi({
      chapterBaseline: record({ payload: payloadOf({ attributes: [attr({ baseValue: 100 })] }) }),
    });
    render(<RecordDrawer api={api} />);
    expect(screen.getByText("与本章初相比没有变化。")).toBeInTheDocument();
    expect(screen.getByText("起点：改动前自动存档：手动保存", { exact: false })).toBeInTheDocument();
  });

  it("列出变动、按组归类，并在标题上给出总条数", () => {
    const api = makeApi({
      chapterBaseline: record({
        payload: payloadOf({ attributes: [attr({ baseValue: 0 })], items: [item({ qty: 2 })] }),
      }),
    });
    render(<RecordDrawer api={api} />);

    // 属性：0 → 100；物品：破境丹 ×2 用尽（当前文档里没有这件物品）
    expect(diffRows()).toEqual(["攻击0→100", "−破境丹×2"]);
    expect(diffBlock().textContent).toContain("2 处变动");
    expect(screen.getByText("属性")).toBeInTheDocument();
    expect(screen.getByText("物品")).toBeInTheDocument();
  });

  it("起点记录上打「本章初」标记（与「最新」是两回事）", () => {
    render(<RecordDrawer api={makeApi()} />);
    expect(screen.getByText("本章初")).toBeInTheDocument();
    expect(screen.getByText("最新")).toBeInTheDocument();
  });

  it("没有起点时不打「本章初」标记", () => {
    render(<RecordDrawer api={makeApi({ chapterBaseline: null })} />);
    expect(screen.queryByText("本章初")).toBeNull();
    expect(screen.getByText("最新")).toBeInTheDocument();
  });
});

describe("RecordDrawer —— 回退点（REQ-044 回归）", () => {
  afterEach(cleanup);

  it("列表与「载入」入口不受对比区影响", () => {
    render(<RecordDrawer api={makeApi()} />);
    expect(screen.getByText("回退点")).toBeInTheDocument();
    expect(screen.getByText("改动前自动存档：手动保存")).toBeInTheDocument();
    expect(buttonText(document, "载入")).toBeInTheDocument();
  });

  it("载入仍要先确认，确认后才回写", () => {
    const api = makeApi();
    render(<RecordDrawer api={api} />);
    fireEvent.click(buttonText(document, "载入"));

    // 行上的「载入」不直接生效：先出确认框
    expect(api.restoreFromRecord).not.toHaveBeenCalled();
    const confirm = screen.getByText("载入这个回退点？").closest(".ant-modal") as HTMLElement;
    expect(confirm).not.toBeNull();

    fireEvent.click(buttonText(confirm, "载入"));
    expect(api.restoreFromRecord).toHaveBeenCalledTimes(1);
  });
});
