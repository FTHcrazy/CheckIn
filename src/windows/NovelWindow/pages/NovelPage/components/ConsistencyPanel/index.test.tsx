import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import ConsistencyPanel from ".";
import { useConsistencyStore } from "../../store/useConsistencyStore";
import type { NovelChapter, NovelEntity, SettingCategory } from "../../types";

/**
 * 一致性校对面板的行为契约（R-AI-10a）
 *
 * 钉三件最容易退化的东西：
 * 1. 空态与结果态是**两件事**（没扫过 ≠ 扫了没发现问题）；
 * 2. 点结果必须把跳转意图交出去（面板自己不会动编辑器）；
 * 3. 没有比对基准时不许「点一下什么都没发生」——必须说明原因。
 */

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  useConsistencyStore.getState().reset();
});

function chapter(id: string, title: string, content: string): NovelChapter {
  return {
    id,
    workId: "w1",
    volumeId: "v1",
    title,
    content,
    wordCount: content.length,
    status: "draft",
    sort: 0,
    updatedAt: 0,
  };
}

const liXuan: NovelEntity = {
  id: "e1",
  workId: "w1",
  type: "character",
  name: "李玄",
  aliases: [],
  summary: "",
  content: "",
  fields: {},
  sort: 1,
};

const baseProps = {
  workId: "w1",
  entities: [liXuan],
  realmCategory: null as SettingCategory | null,
  onNotify: vi.fn(),
};

function renderPanel(chapters: NovelChapter[]) {
  return render(<ConsistencyPanel {...baseProps} chapters={chapters} />);
}

describe("ConsistencyPanel", () => {
  it("未扫描时是「尚未扫描」，不是「没有发现问题」", () => {
    renderPanel([chapter("c1", "第一章", "李玄开口。")]);
    expect(screen.getByText("尚未扫描")).toBeTruthy();
    expect(screen.queryByText("没有发现不一致")).toBeNull();
  });

  it("扫描后列出问题；点一行把跳转意图交给页面层", async () => {
    renderPanel([
      chapter("c1", "第一章", "李玄开口。李玄点头。李玄走了。"),
      chapter("c2", "第二章", "李元握刀。李元回头。"),
    ]);

    screen.getByText("扫描全书").click();

    await waitFor(() => {
      expect(screen.queryByText("正在扫描")).toBeNull();
    });
    const issue = useConsistencyStore.getState().issues[0];
    expect(issue?.found).toBe("李元");
    expect(screen.getByText("李元")).toBeTruthy();
    // 结果行里同时给出「正确的那个」
    expect(screen.getByText("李玄")).toBeTruthy();

    screen.getByText("李元").click();
    expect(useConsistencyStore.getState().jumpTarget).toEqual({
      chapterId: "c2",
      from: issue.from,
    });
  });

  it("扫完确实没有问题时说清楚「扫了 N 章」，不留空白", async () => {
    renderPanel([chapter("c1", "第一章", "李玄开口。李玄点头。李玄走了。")]);
    screen.getByText("扫描全书").click();
    await waitFor(() => {
      expect(screen.getByText("没有发现不一致")).toBeTruthy();
    });
    expect(screen.getByText(/扫完 1 章/)).toBeTruthy();
  });

  it("没有比对基准时不扫描，并说明为什么（禁止「点了没反应」）", () => {
    const onNotify = vi.fn();
    render(
      <ConsistencyPanel {...baseProps} entities={[]} chapters={[chapter("c1", "第一章", "正文")]} onNotify={onNotify} />,
    );
    screen.getByText("扫描全书").click();
    expect(onNotify).toHaveBeenCalledTimes(1);
    expect(String(onNotify.mock.calls[0][0])).toContain("比对基准");
    expect(useConsistencyStore.getState().status).toBe("idle");
  });

  it("境界体系存在时，未登记的档位写法会作为「境界」类问题出现", async () => {
    const realm: SettingCategory = {
      id: "cat1",
      workId: "w1",
      name: "境界",
      color: "#000",
      kind: "realm",
      sortOrder: 0,
      note: "",
      subLevels: 0,
      carryDir: "asc",
      subPattern: "",
      levels: [
        {
          id: "l1",
          categoryId: "cat1",
          name: "金丹",
          rank: 1,
          aliases: [],
          note: "",
          subLevels: 0,
          subPattern: "",
          power: null,
          parentId: null,
          segFrom: null,
          segTo: null,
        },
      ],
    };
    render(
      <ConsistencyPanel
        {...baseProps}
        entities={[]}
        realmCategory={realm}
        chapters={[chapter("c1", "第一章", "他已入金丹后期。金丹后期修士不多。")]}
      />,
    );
    screen.getByText("扫描全书").click();
    await waitFor(() => {
      expect(screen.getByText("金丹后期")).toBeTruthy();
    });
    // 筛选器按类型分档：境界 1 条
    expect(screen.getByText("境界")).toBeTruthy();
  });
});

describe("useConsistencyStore", () => {
  it("切作品清空上一次结果（上一本的「没问题」不能当这一本的结论）", () => {
    const store = useConsistencyStore.getState();
    store.scan({
      workId: "w1",
      chapters: [{ id: "c1", title: "第一章", content: "李玄开口。李玄点头。李玄走了。" }],
      entities: [{ id: "e1", name: "李玄", type: "character", aliases: [] }],
      realmLevels: [],
    });
    expect(useConsistencyStore.getState().workId).toBe("w1");

    store.reset();
    const after = useConsistencyStore.getState();
    expect(after.workId).toBeNull();
    expect(after.issues).toEqual([]);
    expect(after.status).toBe("idle");
  });
});
