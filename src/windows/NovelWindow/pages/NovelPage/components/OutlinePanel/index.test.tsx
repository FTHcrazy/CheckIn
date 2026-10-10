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
        foreshadows: 1,
        openForeshadows: 1,
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
        foreshadows: 0,
        openForeshadows: 0,
      },
      {
        kind: "foreshadow",
        id: "f1",
        entryId: "f1",
        volumeId: "v1",
        chapterId: "c1",
        title: "断伞骨",
        note: "回收时让陆昭修伞",
        resolved: false,
        source: "第一章 雨夜叩门",
      },
      {
        kind: "foreshadow",
        id: "f2",
        entryId: "f2",
        volumeId: "v1",
        chapterId: "",
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

/**
 * antd 默认给两字中文按钮插一个字间距空格（「记录」→「记 录」）。
 * 应用里由 ThemeProvider 的 ConfigProvider 关掉了，但组件测试直接 render、
 * 不走 ThemeProvider —— 所以按「去掉空白后相等」匹配，而不是把断言改成
 * 带空格的怪写法（那样以后关掉字间距又会全红）。
 */
const stripped = (text: string | null | undefined): string =>
  (text ?? "").replace(/\s+/g, "");

/**
 * 按「按钮」查文本：限定 tagName 是必须的 —— antd 的 Button 会把文字包一层
 * `<span>`，不限制的话按钮与它的内层 span 会同时命中（Found multiple elements）。
 */
const looseText = (text: string): HTMLElement =>
  screen.getByText(
    (_content, element) =>
      element?.tagName === "BUTTON" &&
      stripped(element.textContent) === stripped(text),
  );

const switcherButton = (container: HTMLElement, label: string): HTMLElement => {
  const switcher = container.querySelector<HTMLElement>(".nv-outline__switch");
  // antd 把「章节」与计数「2」分成了两个子节点，所以按 textContent 前缀匹配
  // 整颗按钮，断言那边再去掉空白比对
  const hit = Array.from(
    switcher?.querySelectorAll<HTMLElement>("button") ?? [],
  ).find((button) => stripped(button.textContent).startsWith(label));
  expect(hit).toBeDefined();
  return hit as HTMLElement;
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

    expect(stripped(switcherButton(container, "章节").textContent)).toBe("章节2");
    expect(stripped(switcherButton(container, "伏笔").textContent)).toBe("伏笔2");
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

    fireEvent.click(screen.getByTitle("在本卷添加卷级伏笔（不绑具体章）"));
    fireEvent.click(looseText("记录"));
    expect(onAddForeshadow).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("伏笔标题"), {
      target: { value: "三年之约" },
    });
    fireEvent.change(screen.getByLabelText("伏笔说明"), {
      target: { value: "第十章回收" },
    });
    fireEvent.click(looseText("记录"));

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

    fireEvent.click(screen.getByTitle("在本卷添加卷级伏笔（不绑具体章）"));
    fireEvent.change(screen.getByLabelText("伏笔标题"), {
      target: { value: "断碑" },
    });

    // 埋设章节已改为组件库 Select：按「第二章 旧剑」选中 c2
    const chapterSelect = container.querySelector<HTMLElement>(
      ".nv-outline__select",
    );
    expect(chapterSelect).not.toBeNull();
    await pickSelectOption(chapterSelect as HTMLElement, "第二章 旧剑");

    fireEvent.click(looseText("记录"));

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

  it("伏笔可就地编辑标题与说明，绑定章节随草稿一起提交", () => {
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
    // 编辑表单带埋设章节下拉：把 f1 从「第一章」改绑到「第二章」
    const chapterSelect = container.querySelector<HTMLElement>(
      ".nv-outline__select",
    );
    expect(chapterSelect).not.toBeNull();
    fireEvent.click(looseText("保存"));

    expect(onUpdateForeshadow).toHaveBeenCalledWith("f1", {
      title: "断伞骨（改）",
      note: "回收时让陆昭修伞",
      chapterId: "c1",
    });
  });

  it("章节行加号：表单内联在该章下方，绑定预设为本章", async () => {
    const onAddForeshadow = vi.fn();
    const { container } = render(
      <OutlinePanel
        outline={outline}
        activeChapterId={null}
        onSelectChapter={vi.fn()}
        actions={buildActions({ onAddForeshadow })}
      />,
    );

    // 第一颗「＋」属于第一章的行容器（悬停浮现，但 jsdom 里直接可点）
    fireEvent.click(screen.getAllByTitle("在本章添加伏笔")[0]);

    // 表单内联在对应 li 里，而不是挂在卷尾
    const form = container.querySelector<HTMLElement>(
      ".nv-outline__item .nv-outline__form",
    );
    expect(form).not.toBeNull();

    fireEvent.change(screen.getByLabelText("伏笔标题"), {
      target: { value: "伞骨裂缝" },
    });
    // 预设绑定 = 第一章：下拉直接显示该章（未打开下拉、未手动选择）
    const chapterSelect = container.querySelector<HTMLElement>(
      ".nv-outline__select",
    );
    expect(chapterSelect?.textContent).toContain("雨夜叩门");

    fireEvent.click(looseText("记录"));
    expect(onAddForeshadow).toHaveBeenCalledWith("v1", "伞骨裂缝", "", "c1");
  });

  it("编辑表单可改绑埋设章节", async () => {
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

    const chapterSelect = container.querySelector<HTMLElement>(
      ".nv-outline__select",
    );
    expect(chapterSelect).not.toBeNull();
    await pickSelectOption(chapterSelect as HTMLElement, "第二章 旧剑");
    fireEvent.click(looseText("保存"));

    expect(onUpdateForeshadow).toHaveBeenCalledWith(
      "f1",
      expect.objectContaining({ chapterId: "c2" }),
    );
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

  it("章节行标出本章埋了几条伏笔（绑了章的才标）", () => {
    const { container } = render(
      <OutlinePanel
        outline={outline}
        activeChapterId={null}
        onSelectChapter={vi.fn()}
        actions={buildActions()}
      />,
    );

    const pills = Array.from(
      container.querySelectorAll<HTMLElement>(".nv-outline__ch-fs"),
    );
    // 只有 c1 埋了伏笔；卷级伏笔（f2）不该标到任何章节上
    expect(pills).toHaveLength(1);
    expect(stripped(pills[0].textContent)).toBe("1");
    expect(pills[0].className).toContain("is-open");
    // 标识是**按钮**：白底上是 span 就点不开（点开清单才是这轮要解决的事）；
    // 而且它必须与整行按钮并列 —— 嵌在里面浏览器会拆坏 DOM
    expect(pills[0].tagName).toBe("BUTTON");
    expect(pills[0].closest("button")).toBe(pills[0]);
    expect(pills[0].getAttribute("aria-expanded")).toBe("false");
  });

  it("悬浮标识先给一份预览：不点开也能看清埋的是哪几条", async () => {
    const { container } = render(
      <OutlinePanel
        outline={outline}
        activeChapterId={null}
        onSelectChapter={vi.fn()}
        actions={buildActions()}
      />,
    );

    const pill = container.querySelector<HTMLElement>(".nv-outline__ch-fs");
    expect(pill).not.toBeNull();
    // React 的 onMouseEnter 是由 mouseover 合成出来的，mouseenter 事件不冒泡、触发不到
    fireEvent.mouseOver(pill as HTMLElement);

    // 组件库 Tooltip 的弹层挂在 body 的 portal 上（必须查 document）：
    // antd 6 的内容容器是 .ant-tooltip-container[role=tooltip]
    const inner = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[role="tooltip"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    expect(stripped(inner.textContent)).toContain("本章埋了1条伏笔，其中1条待回收");
    expect(stripped(inner.textContent)).toContain("断伞骨");
    expect(stripped(inner.textContent)).toContain("点击在本章下方展开");
  });

  it("点章节行标识就在本章下方列出是哪几条，回收 / 编辑都在原地做", () => {
    const onToggleForeshadow = vi.fn();
    const { container } = render(
      <OutlinePanel
        outline={outline}
        activeChapterId={null}
        onSelectChapter={vi.fn()}
        actions={buildActions({ onToggleForeshadow })}
      />,
    );

    const pill = container.querySelector<HTMLElement>(".nv-outline__ch-fs");
    expect(pill).not.toBeNull();
    // 默认收起：清单不进 DOM，骨架不被长出来的内容挤乱
    expect(container.querySelector(".nv-outline__ch-fs-list")).toBeNull();

    fireEvent.click(pill as HTMLElement);

    const list = container.querySelector(".nv-outline__ch-fs-list");
    expect(list).not.toBeNull();
    const text = stripped(list?.textContent);
    // 只列本章那条；卷级伏笔「旧剑铭」不该混进来
    expect(text).toContain("断伞骨");
    expect(text).not.toContain("旧剑铭");
    // 行内清单不再重复标「埋在哪一章」（它就在那一章下面）
    expect(text).not.toContain("第一章雨夜叩门");
    expect(pill?.getAttribute("aria-expanded")).toBe("true");
    expect(pill?.className).toContain("is-expanded");

    // 就地回收，不用切到「伏笔」页
    fireEvent.click(screen.getByTitle("标记为已回收"));
    expect(onToggleForeshadow).toHaveBeenCalledWith("f1", true);

    // 再点一次收起
    fireEvent.click(pill as HTMLElement);
    expect(container.querySelector(".nv-outline__ch-fs-list")).toBeNull();
    expect(pill?.getAttribute("aria-expanded")).toBe("false");
  });

  it("在章节行新增伏笔后自动展开该章清单（否则只多一个数字，还是不知道是哪条）", () => {
    const onAddForeshadow = vi.fn();
    const { container } = render(
      <OutlinePanel
        outline={outline}
        activeChapterId={null}
        onSelectChapter={vi.fn()}
        actions={buildActions({ onAddForeshadow })}
      />,
    );

    fireEvent.click(screen.getByLabelText("在本章（第一章 雨夜叩门）添加伏笔"));
    const title = screen.getByLabelText("伏笔标题");
    fireEvent.change(title, { target: { value: "断伞骨后续" } });
    fireEvent.keyDown(title, { key: "Enter" });

    expect(onAddForeshadow).toHaveBeenCalledWith("v1", "断伞骨后续", "", "c1");
    expect(container.querySelector(".nv-outline__ch-fs-list")).not.toBeNull();
  });

  it("章节的伏笔全部回收后标识降为中性色但仍保留，清单照旧能点开", () => {
    const resolved: OutlineNode[] = [
      {
        kind: "volume",
        id: "v1",
        title: "第一卷",
        note: "",
        openForeshadows: 0,
        children: [
          {
            kind: "chapter",
            id: "c1",
            chapterId: "c1",
            title: "雨夜叩门",
            label: "第一章",
            note: "",
            wordCount: 0,
            status: "done",
            foreshadows: 2,
            openForeshadows: 0,
          },
          {
            kind: "foreshadow",
            id: "f1",
            entryId: "f1",
            volumeId: "v1",
            chapterId: "c1",
            title: "断伞骨",
            note: "",
            resolved: true,
            source: "第一章 雨夜叩门",
          },
          {
            kind: "foreshadow",
            id: "f2",
            entryId: "f2",
            volumeId: "v1",
            chapterId: "c1",
            title: "旧剑铭",
            note: "",
            resolved: true,
            source: "第一章 雨夜叩门",
          },
        ],
      },
    ];
    const { container } = render(
      <OutlinePanel
        outline={resolved}
        activeChapterId={null}
        onSelectChapter={vi.fn()}
        actions={buildActions()}
      />,
    );

    const pill = container.querySelector<HTMLElement>(".nv-outline__ch-fs");
    expect(pill).not.toBeNull();
    expect(stripped(pill?.textContent)).toBe("2");
    // 中性态标记是 `.is-open` 的缺席（配色在同选择器里按它换），标识本身仍在
    expect(pill?.className).not.toContain("is-open");

    fireEvent.click(pill as HTMLElement);
    const text = stripped(
      container.querySelector(".nv-outline__ch-fs-list")?.textContent,
    );
    expect(text).toContain("断伞骨");
    expect(text).toContain("旧剑铭");
    // 已回收的条目在清单里也是划线态
    expect(
      container.querySelectorAll(".nv-outline__fs-item.is-resolved").length,
    ).toBe(2);
  });
});
