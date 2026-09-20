import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
      },
    ],
  },
];

describe("OutlinePanel 组件", () => {
  afterEach(() => {
    cleanup();
  });

  it("汇总卷章数并高亮待回收伏笔数", () => {
    render(
      <OutlinePanel
        outline={outline}
        activeChapterId="c2"
        onSelectChapter={vi.fn()}
        actions={buildActions()}
      />,
    );

    expect(screen.getByText("1 卷 · 2 章")).toBeInTheDocument();
    expect(screen.getByText("1 条待回收")).toBeInTheDocument();
    expect(screen.getByText("少年游")).toBeInTheDocument();
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

  it("伏笔可切换回收状态与删除", () => {
    const onToggleForeshadow = vi.fn();
    const onRemoveForeshadow = vi.fn();
    render(
      <OutlinePanel
        outline={outline}
        activeChapterId={null}
        onSelectChapter={vi.fn()}
        actions={buildActions({ onToggleForeshadow, onRemoveForeshadow })}
      />,
    );

    fireEvent.click(screen.getByTitle("标记为已回收"));
    expect(onToggleForeshadow).toHaveBeenCalledWith("f1", true);

    fireEvent.click(screen.getByTitle("删除伏笔"));
    expect(onRemoveForeshadow).toHaveBeenCalledWith("f1", "断伞骨");
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
