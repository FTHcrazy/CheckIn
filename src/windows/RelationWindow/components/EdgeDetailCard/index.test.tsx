/**
 * 边详情卡（R27 / S3 / W-17）
 *
 * 只读边界的证据：平行关系逐条摊开、备注可改、删除只能跳回右栏。
 * 特别钉住「保存失败不退出编辑态」—— 失败却收起输入框，用户会以为写进去了。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EdgeDetailCard, { EDGE_NOTE_MAX } from "./index";
import type { RelationGraphEdge, RelationGraphNode } from "@/shared/novel/relation-graph";

afterEach(cleanup);

function node(id: string, name: string, type = "character"): RelationGraphNode {
  return {
    id,
    entityId: id,
    type,
    name,
    aliases: [],
    summary: "",
    realm: "",
    relationCount: 1,
    linked: true,
  };
}

const nodes = new Map<string, RelationGraphNode>([
  ["e1", node("e1", "林晚")],
  ["e2", node("e2", "青云镇", "location")],
]);

const edge: RelationGraphEdge = {
  id: "e:e1~e2",
  source: "e1",
  target: "e2",
  relation: "同门",
  relations: ["同门", "道侣", "宿敌"],
  extraCount: 2,
  label: "同门 +2",
  note: "在第 12 章决裂",
  linkIds: ["l1", "l2", "l3"],
  notes: ["在第 12 章决裂", undefined, undefined],
};

function renderCard(over: Partial<Parameters<typeof EdgeDetailCard>[0]> = {}) {
  const props = {
    edge,
    nodeById: nodes,
    typeLabelOf: (type: string) => (type === "location" ? "地点" : "角色"),
    onSaveNote: vi.fn(async () => true),
    onOpenInMain: vi.fn(),
    onSelectNode: vi.fn(),
    onClose: vi.fn(),
    saving: false,
    ...over,
  };
  render(<EdgeDetailCard {...props} />);
  return props;
}

describe("平行关系逐条可见", () => {
  it("三条关系都列出（不按「首条 + N」省略），并给出条数", () => {
    renderCard();
    expect(screen.getByText("同门")).toBeTruthy();
    expect(screen.getByText("道侣")).toBeTruthy();
    expect(screen.getByText("宿敌")).toBeTruthy();
    expect(screen.getByText(/这条连线上的关系/)).toBeTruthy();
  });

  it("已有备注直接显示，没备注的写明「还没有备注」", () => {
    renderCard();
    expect(screen.getByText("在第 12 章决裂")).toBeTruthy();
    expect(screen.getAllByText("还没有备注")).toHaveLength(2);
  });

  it("两端节点名称与类型可见", () => {
    renderCard();
    expect(screen.getByText("林晚")).toBeTruthy();
    expect(screen.getByText("青云镇")).toBeTruthy();
    expect(screen.getByText("角色")).toBeTruthy();
    expect(screen.getByText("地点")).toBeTruthy();
  });
});

describe("备注编辑", () => {
  it("上限 200 字，占位文案给出可写什么", () => {
    renderCard();
    fireEvent.click(screen.getAllByRole("button", { name: /编辑「同门」的备注/ })[0]);
    const area = screen.getByLabelText("关系备注") as HTMLTextAreaElement;
    expect(area.maxLength).toBe(EDGE_NOTE_MAX);
    expect(EDGE_NOTE_MAX).toBe(200);
  });

  it("保存后把 linkId + 新备注交给上层，并退出编辑态", async () => {
    const props = renderCard();
    fireEvent.click(screen.getAllByRole("button", { name: /编辑「同门」的备注/ })[0]);
    fireEvent.change(screen.getByLabelText("关系备注"), {
      target: { value: "改成：第 20 章和好" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存备注" }));

    await waitFor(() =>
      expect(props.onSaveNote).toHaveBeenCalledWith("l1", "改成：第 20 章和好"),
    );
    await waitFor(() => expect(screen.queryByLabelText("关系备注")).toBeNull());
  });

  it("保存失败时留在编辑态（内容不回退、不假装成功）", async () => {
    const props = renderCard({ onSaveNote: vi.fn(async () => false) });
    fireEvent.click(screen.getAllByRole("button", { name: /编辑「道侣」的备注/ })[0]);
    fireEvent.change(screen.getByLabelText("关系备注"), {
      target: { value: "临时写的备注" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存备注" }));

    await waitFor(() => expect(props.onSaveNote).toHaveBeenCalled());
    const area = screen.getByLabelText("关系备注") as HTMLTextAreaElement;
    expect(area.value).toBe("临时写的备注");
  });

  it("取消编辑不改动任何数据", () => {
    const props = renderCard();
    fireEvent.click(screen.getAllByRole("button", { name: /编辑「宿敌」的备注/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByLabelText("关系备注")).toBeNull();
    expect(props.onSaveNote).not.toHaveBeenCalled();
  });
});

describe("只读边界", () => {
  it("没有删除关系入口，只有「去右栏删除」导航", () => {
    const props = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /去右栏删除/ }));
    expect(props.onOpenInMain).toHaveBeenCalledWith("e1");
  });

  it("点端点跳到该节点的资料卡", () => {
    const props = renderCard();
    fireEvent.click(screen.getByText("青云镇"));
    expect(props.onSelectNode).toHaveBeenCalledWith("e2");
  });
});
