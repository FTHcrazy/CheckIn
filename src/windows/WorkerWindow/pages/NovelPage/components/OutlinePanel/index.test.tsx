import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutlineNode } from "../../types";
import OutlinePanel, { type OutlineActions } from "./index";

const buildActions = (over: Partial<OutlineActions> = {}): OutlineActions => ({
  onEditChapterNote: vi.fn(),
  onAddForeshadow: vi.fn(),
  onUpdateForeshadow: vi.fn(),
  onToggleForeshadow: vi.fn(),
  onRemoveForeshadow: vi.fn(),
  ...over,
});

const outline: OutlineNode[] = [
  {
    kind: "volume",
    id: "v1",
    title: "第一卷",
    note: "少年游",
    openForeshadows: 1,
    children: [
      {
        kind: "chapter",
        id: "c1",
        chapterId: "c1",
        title: "雨夜叩门",
        label: "第一章",
        note: "沈砚雨夜回山。",
        wordCount: 3200,
        status: "done",
      },
      {
        kind: "chapter",
        id: "c2",
        chapterId: "c2",
        title: "旧剑",
        label: "第二章",
        note: "",
        wordCount: 1200,
        status: "draft",
      },
      {
        kind: "foreshadow",
        id: "f1",
        entryId: "f1",
        title: "断伞骨",
        note: "回收时让陆昭修伞",
        resolved: false,
        source: "第一章 雨夜叩门",
      },
      {
        kind: "foreshadow",
        id: "f2",
        entryId: "f2",
        title: "旧剑铭",
        note: "",
        resolved: true,
        source: "",
      },
    ],
  },
];

/** 子视图切换器里的按钮：大纲内多处同名文本，必须限定作用域 */
const clickView = (container: HTMLElement, label: string): void => {
  const switcher = container.querySelector<HTMLElement>(".nv-outline__switch");
  expect(switcher).not.toBeNull();
  fireEvent.click(within(switcher as HTMLElement).getByText(label));
};

/**
 * 组件库 Select 的选中动作：jsdom 里 fireEvent.change 对 antd Select 无效，
 * 必须 mousedown 打开下拉、再点弹层里的选项（弹层挂在 body 的 portal 上）
 */
const pickSelectOption = async (
  root: HTMLElement,
  label: string,
): Promise<void> => {
  // antd 6 的可点区域是内层只读 input（v5 的 .ant-select-selector 已移除）
  const trigger = root.querySelector<HTMLElement>("input.ant-select-input");
  expect(trigger).not.toBeNull();
  fireEvent.mouseDown(trigger as HTMLElement);

  const options = await waitFor(() => {
    const nodes = Array.from(
      document.body.querySelectorAll<HTMLElement>(
        ".ant-select-item-option-content",
      ),
    );
    expect(nodes.length).toBeGreaterThan(0);
    return nodes;
  });

  const target = options.find((node) => node.textContent === label);
  expect(target).toBeDefined();
  fireEvent.click(target as HTMLElement);
};

const switcherButton = (container: HTMLElement, label: string): HTMLElement => {
  const switcher = container.querySelector<HTMLElement>(".nv-outline__switch");
  return within(switcher as HTMLElement).getByText(label);
};

describe("OutlinePanel 组件", () => {
  afterEach(() => {
    cleanup();
  });

  it("汇总卷 / 章 / 待回收伏笔", () => {
    const { container } = render(
      <OutlinePanel
        outline={outline}
        activeChapterId="c2"
        onSelectChapter={vi.fn()}
        actions={buildActions()}
      />,
    );

    const summary = container.querySelector(".nv-outline__summary");
    expect(summary?.textContent).toBe("1卷2章1待回收伏笔");
    expect(screen.getByText("少年游")).toBeInTheDocument();
  });

  it("章节与伏笔是两个子视图，切换器带各自计数", () => {
    const { container } = render(
      <OutlinePanel
        outline={outline}
        activeChapterId={null}
        onSelectChapter={vi.fn()}
        actions={buildActions()}
      />,
    );

    expect(switcherButton(container, "章节").textContent).toBe("章节2");
    expect(switcherButton(container, "伏笔").textContent).toBe("伏笔2");
  });

  it("点击章节行带真实 chapterId 跳转（回归：不能再用桩 id）", () => {
    const onSelectChapter = vi.fn();
    render(
      <OutlinePanel
        outline={outline}
        activeChapterId={null}
        onSelectChapter={onSelectChapter}
        actions={buildActions()}
      />,
    );

    fireEvent.click(screen.getByText("雨夜叩门"));
    expect(onSelectChapter).toHaveBeenCalledWith("c1");
  });

  it("未填梗概显示占位，点击后行内编辑并回车提交", () => {
    const onEditChapterNote = vi.fn();
    render(
      <OutlinePanel
        outline={outline}
        activeChapterId={null}
        onSelectChapter={vi.fn()}
        actions={buildActions({ onEditChapterNote })}
      />,
    );

    fireEvent.click(screen.getByText("＋ 一句话梗概"));
    const input = screen.getByLabelText("章节梗概");
    fireEvent.change(input, { target: { value: "  旧剑出鞘  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onEditChapterNote).toHaveBeenCalledWith("c2", "旧剑出鞘");
    expect(screen.queryByLabelText("章节梗概")).toBeNull();
  });

  it("梗概未改动时不提交，避免无意义的保存提示", () => {
    const onEditChapterNote = vi.fn();
    render(
      <OutlinePanel
        outline={outline}
        activeChapterId={null}
        onSelectChapter={vi.fn()}
        actions={buildActions({ onEditChapterNote })}
      />,
    );

    fireEvent.click(screen.getByText("沈砚雨夜回山。"));
    fireEvent.keyDown(screen.getByLabelText("章节梗概"), { key: "Enter" });

    expect(onEditChapterNote).not.toHaveBeenCalled();
  });

  it("卷头加号新增伏笔：标题为空不提交，填了才落", () => {
    const onAddForeshadow = vi.fn();
    render(
      <OutlinePanel
        outline={outline}
        activeChapterId={null}
        onSelectChapter={vi.fn()}
        actions={buildActions({ onAddForeshadow })}
      />,
    );

    fireEvent.click(screen.getByTitle("在本卷添加伏笔"));
    fireEvent.click(screen.getByText("记录"));
    expect(onAddForeshadow).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("伏笔标题"), {
      target: { value: "三年之约" },
    });
    fireEvent.change(screen.getByLabelText("伏笔说明"), {
      target: { value: "第十章回收" },
    });
    fireEvent.click(screen.getByText("记录"));

    expect(onAddForeshadow).toHaveBeenCalledWith("v1", "三年之约", "第十章回收", undefined);
    expect(screen.queryByLabelText("伏笔标题")).toBeNull();
  });

  it("新增伏笔可选埋设章节，选了就带上 chapterId", async () => {
    const onAddForeshadow = vi.fn();
    const { container } = render(
      <OutlinePanel
        outline={outline}
        activeChapterId={null}
        onSelectChapter={vi.fn()}
        actions={buildActions({ onAddForeshadow })}
      />,
    );

    fireEvent.click(screen.getByTitle("在本卷添加伏笔"));
    fireEvent.change(screen.getByLabelText("伏笔标题"), {
      target: { value: "断碑" },
    });

    // 埋设章节已改为组件库 Select：按「第二章 旧剑」选中 c2
    const chapterSelect = container.querySelector<HTMLElement>(
      ".nv-outline__select",
    );
    expect(chapterSelect).not.toBeNull();
    await pickSelectOption(chapterSelect as HTMLElement, "第二章 旧剑");

    fireEvent.click(screen.getByText("记录"));

    expect(onAddForeshadow).toHaveBeenCalledWith("v1", "断碑", "", "c2");
  });

  it("伏笔视图默认只看待回收，切到「全部」才出现已回收", () => {
    const { container } = render(
      <OutlinePanel
        outline={outline}
        activeChapterId={null}
        onSelectChapter={vi.fn()}
        actions={buildActions()}
      />,
    );

    clickView(container, "伏笔");
    expect(screen.getByText("断伞骨")).toBeInTheDocument();
    expect(screen.queryByText("旧剑铭")).toBeNull();

    fireEvent.click(screen.getByText("全部"));
    expect(screen.getByText("旧剑铭")).toBeInTheDocument();
  });

  it("伏笔条展示埋设来源，卷级伏笔给出兜底文案", () => {
    const { container } = render(
      <OutlinePanel
        outline={outline}
        activeChapterId={null}
        onSelectChapter={vi.fn()}
        actions={buildActions()}
      />,
    );

    clickView(container, "伏笔");
    expect(screen.getByText("第一章 雨夜叩门")).toBeInTheDocument();

    fireEvent.click(screen.getByText("全部"));
    expect(screen.getByText("卷级伏笔 · 不绑定具体章")).toBeInTheDocument();
  });

  it("伏笔可切换回收状态与删除", () => {
    const onToggleForeshadow = vi.fn();
    const onRemoveForeshadow = vi.fn();
    const { container } = render(
      <OutlinePanel
        outline={outline}
        activeChapterId={null}
        onSelectChapter={vi.fn()}
        actions={buildActions({ onToggleForeshadow, onRemoveForeshadow })}
      />,
    );

    clickView(container, "伏笔");
    fireEvent.click(screen.getByTitle("标记为已回收"));
    expect(onToggleForeshadow).toHaveBeenCalledWith("f1", true);

    fireEvent.click(screen.getByTitle("删除伏笔"));
    expect(onRemoveForeshadow).toHaveBeenCalledWith("f1", "断伞骨");
  });

  it("伏笔可就地编辑标题与说明", () => {
    const onUpdateForeshadow = vi.fn();
    const { container } = render(
      <OutlinePanel
        outline={outline}
        activeChapterId={null}
        onSelectChapter={vi.fn()}
        actions={buildActions({ onUpdateForeshadow })}
      />,
    );

    clickView(container, "伏笔");
    fireEvent.click(screen.getByTitle("编辑伏笔"));
    fireEvent.change(screen.getByLabelText("伏笔标题"), {
      target: { value: "断伞骨（改）" },
    });
    fireEvent.click(screen.getByText("保存"));

    expect(onUpdateForeshadow).toHaveBeenCalledWith("f1", {
      title: "断伞骨（改）",
      note: "回收时让陆昭修伞",
    });
  });

  it("面板头「＋ 伏笔」信号：切回章节视图并在首卷展开表单", () => {
    const { rerender } = render(
      <OutlinePanel
        outline={outline}
        activeChapterId={null}
        onSelectChapter={vi.fn()}
        actions={buildActions()}
        addForeshadowSignal={0}
      />,
    );
    expect(screen.queryByLabelText("伏笔标题")).toBeNull();

    rerender(
      <OutlinePanel
        outline={outline}
        activeChapterId={null}
        onSelectChapter={vi.fn()}
        actions={buildActions()}
        addForeshadowSignal={1}
      />,
    );
    expect(screen.getByLabelText("伏笔标题")).toBeInTheDocument();
  });

  it("没有卷时给出启用引导", () => {
    render(
      <OutlinePanel
        outline={[]}
        activeChapterId={null}
        onSelectChapter={vi.fn()}
        actions={buildActions()}
      />,
    );

    expect(screen.getByText(/在左栏新建一卷/)).toBeInTheDocument();
  });
});
