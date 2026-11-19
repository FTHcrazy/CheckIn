import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  aiGenerateStructured,
  getAiConfig,
  logAiEvent,
  saveAiConfig,
} from "@/shared/ai/ai-client";
import type { ConsistencyIssue } from "@/shared/novel/consistency";
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
 *
 * R-AI-10b 的 AI 复核部分在文件末尾单独一个 describe：
 * 那里要的是「只给建议、勾选才采纳、未授权先弹窗」这三条。
 */
vi.mock("@/shared/ai/ai-client", () => ({
  aiGenerateStructured: vi.fn(),
  getAiConfig: vi.fn(),
  saveAiConfig: vi.fn(),
  logAiEvent: vi.fn(),
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  useConsistencyStore.getState().reset();
  vi.mocked(aiGenerateStructured).mockReset();
  vi.mocked(getAiConfig).mockReset();
  vi.mocked(saveAiConfig).mockReset();
  vi.mocked(logAiEvent).mockReset();
});

beforeEach(() => {
  // 默认「已配置且已授权」：用例要测未授权时自己改
  vi.mocked(getAiConfig).mockResolvedValue({ provider: "openai", l3Enabled: true } as never);
  vi.mocked(saveAiConfig).mockResolvedValue({ ok: true } as never);
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

/* ───────────────────── R-AI-10b：AI 复核 ───────────────────── */

/** 造一条 10a 的结果条目（本 describe 不关心它是怎么判出来的） */
function makeIssue(overrides: Partial<ConsistencyIssue> = {}): ConsistencyIssue {
  return {
    id: "i1",
    kind: "name-near-miss",
    severity: "suspect",
    chapterId: "c1",
    chapterTitle: "第一章",
    found: "李元",
    expected: "李玄",
    expectedLabel: "人物",
    count: 2,
    from: 0,
    evidence: "李元握刀。李元回头。",
    suggestion: "确认为「李玄」",
    ...overrides,
  };
}

/** 直接把面板置为「已扫描完 + 有这些结果」，省掉 Worker 与等待 */
function seedIssues(issues: ConsistencyIssue[]): void {
  const sure = issues.filter((item) => item.severity === "sure").length;
  useConsistencyStore.setState({
    status: "done",
    progress: 1,
    issues,
    workId: "w1",
    scannedAt: 0,
    chapterCount: 1,
    counts: {
      sure,
      suspect: issues.length - sure,
      name: issues.length,
      realm: 0,
    },
  });
}

/** 「AI 复核」按钮：antd 会在两字按钮中间插空格，故用宽松正则 */
const aiButton = () => screen.getByRole("button", { name: /AI\s*复\s*核/ });

describe("ConsistencyPanel · AI 复核（R-AI-10b）", () => {
  it("AI 不可用：按钮禁用并说明原因（不留一颗点了没反应的按钮）", () => {
    render(
      <ConsistencyPanel
        {...baseProps}
        chapters={[chapter("c1", "第一章", "李玄开口。")]}
        aiAvailable={false}
        aiUnavailableText="还没配置模型服务"
      />,
    );
    expect(aiButton()).toBeDisabled();
    expect(aiButton().getAttribute("title")).toBe("还没配置模型服务");
  });

  it("只有「确定」级条目：没有可复核的东西，按钮禁用", () => {
    seedIssues([makeIssue({ severity: "sure" })]);
    render(<ConsistencyPanel {...baseProps} chapters={[chapter("c1", "第一章", "李元握刀。")]} />);
    expect(aiButton()).toBeDisabled();
  });

  it("未授权：点按钮先弹授权弹窗，此时一个字节都没发出去", async () => {
    vi.mocked(getAiConfig).mockResolvedValue({ provider: "openai", l3Enabled: false } as never);
    seedIssues([makeIssue()]);
    render(<ConsistencyPanel {...baseProps} chapters={[chapter("c1", "第一章", "李元握刀。")]} />);

    await waitFor(() => expect(aiButton()).not.toBeDisabled());
    aiButton().click();

    await waitFor(() => expect(screen.getByText("同意并继续")).toBeTruthy());
    expect(aiGenerateStructured).not.toHaveBeenCalled();
  });

  it("判定为「错字」：给出理由与「采纳此判定」勾选；勾选不改正文，只记采纳", async () => {
    vi.mocked(aiGenerateStructured).mockResolvedValue({
      ok: true,
      data: {
        text: "",
        usedFallback: false,
        entries: [
          { expected: "李玄", candidate: "李元", verdict: "错字", reason: "同音笔误" },
        ],
      },
    } as never);
    seedIssues([makeIssue()]);
    render(<ConsistencyPanel {...baseProps} chapters={[chapter("c1", "第一章", "李元握刀。")]} />);

    await waitFor(() => expect(aiButton()).not.toBeDisabled());
    aiButton().click();

    await waitFor(() => expect(screen.getByText("错字")).toBeTruthy());
    expect(screen.getByText("同音笔误")).toBeTruthy();

    const box = screen.getByRole("checkbox");
    expect(box).not.toBeChecked();
    box.click();
    await waitFor(() => expect(box).toBeChecked());
    expect(useConsistencyStore.getState().aiAdopted).toEqual(["i1"]);
  });

  it("判定为「同形异名」：显示「两者不同，不要改」，不给采纳勾选", async () => {
    vi.mocked(aiGenerateStructured).mockResolvedValue({
      ok: true,
      data: {
        text: "",
        usedFallback: false,
        entries: [
          { expected: "李玄", candidate: "李元", verdict: "同形异名", reason: "可能是两个人" },
        ],
      },
    } as never);
    seedIssues([makeIssue()]);
    render(<ConsistencyPanel {...baseProps} chapters={[chapter("c1", "第一章", "李元握刀。")]} />);

    await waitFor(() => expect(aiButton()).not.toBeDisabled());
    aiButton().click();

    await waitFor(() => expect(screen.getByText("同形异名")).toBeTruthy());
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText("两者不同，不要改")).toBeTruthy();
  });
});
