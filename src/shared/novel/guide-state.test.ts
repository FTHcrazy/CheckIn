import { beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "./constants";
import {
  createDefaultRecord,
  fetchGuideState,
  isTooltipUnseen,
  markDeferred,
  markDone,
  markHelpOpened,
  markSkipped,
  markTooltipSeen,
  parseGuideRecord,
  recordStepViewed,
  resetForReplay,
  saveGuideState,
  serializeGuideRecord,
  shouldAutoStart,
  shouldShowHelpBadge,
  type GuideRecord,
} from "./guide-state";

/**
 * 引导状态机单测（PRD FR-04）
 *
 * 重点覆盖两类：① 配置损坏的兜底（引导不是业务数据，宁可重放也不能崩）；
 * ② 状态流转的边界（跳过即终止、重看保留弱提示记录）。
 */

/** config 的读写替身：内存里一个字符串，模拟 novel_config 表 */
let store: string | null = null;
const configGet = vi.fn(async () => store);
const configSet = vi.fn(async (_key: string, value: string) => {
  store = value;
  return true;
});

beforeEach(() => {
  store = null;
  configGet.mockClear();
  configSet.mockClear();
  vi.stubGlobal("window", {
    electronAPI: { novel: { configGet, configSet } },
  });
});

const record = (over: Partial<GuideRecord> = {}): GuideRecord => ({
  ...createDefaultRecord(),
  ...over,
});

describe("parseGuideRecord —— 损坏兜底", () => {
  it("无值（全新安装）按 not_started 处理，不弹迁移提示", () => {
    expect(parseGuideRecord(null).state).toBe("not_started");
  });

  it("JSON 解析失败按 not_started 兜底，不抛", () => {
    expect(parseGuideRecord("{不是 json").state).toBe("not_started");
  });

  it("版本不符按 not_started 兜底（旧版本记录不做兼容读取）", () => {
    const raw = JSON.stringify(record({ version: 0, state: "done" }));
    expect(parseGuideRecord(raw).state).toBe("not_started");
  });

  it("非法 state 值按 not_started 兜底", () => {
    const raw = JSON.stringify({ ...record(), state: "halfway" });
    expect(parseGuideRecord(raw).state).toBe("not_started");
  });

  it("非对象（数组 / 字符串）按 not_started 兜底", () => {
    expect(parseGuideRecord("[1,2]").state).toBe("not_started");
    expect(parseGuideRecord('"x"').state).toBe("not_started");
  });

  it("步骤越界夹取到 1-5，越界步骤不进 stepsViewed", () => {
    const parsed = parseGuideRecord(
      JSON.stringify({ ...record(), currentStep: 99, stepsViewed: [1, 7, -2, 3] }),
    );
    expect(parsed.currentStep).toBe(5);
    expect(parsed.stepsViewed).toEqual([1, 3]);
  });

  it("序列化后可无损还原（version 一致）", () => {
    const source = record({ state: "in_progress", currentStep: 3, tooltipSeen: ["T-02"] });
    expect(parseGuideRecord(serializeGuideRecord(source))).toEqual(source);
  });
});

describe("状态流转", () => {
  it("展示步骤累加 stepsViewed 并推进 currentStep", () => {
    const next = recordStepViewed(record(), 2);
    expect(next.state).toBe("in_progress");
    expect(next.currentStep).toBe(2);
    expect(next.stepsViewed).toEqual([2]);
  });

  it("重复看同一步不重复记入", () => {
    const once = recordStepViewed(record(), 2);
    expect(recordStepViewed(once, 2).stepsViewed).toEqual([2]);
  });

  it("走完最后一步置 done", () => {
    expect(markDone(record()).state).toBe("done");
  });

  it("任一步跳过即终止全程（不是只跳当前步）", () => {
    const skipped = markSkipped(record({ state: "in_progress", currentStep: 3 }));
    expect(skipped.state).toBe("skipped");
    // 关键：跳过之后不再自动播放
    expect(shouldAutoStart(skipped)).toBe(false);
  });

  it("延后不是终止：deferred 仅本次会话不弹", () => {
    const deferred = markDeferred(record({ state: "in_progress" }));
    expect(deferred.state).toBe("deferred");
    expect(shouldAutoStart(deferred)).toBe(false);
  });

  it("重看引导重置步骤但保留弱提示记录（不把长尾提示再骚扰一遍）", () => {
    const done = record({
      state: "done",
      currentStep: 4,
      stepsViewed: [1, 2, 3, 4],
      tooltipSeen: ["T-02", "T-03"],
    });
    const replay = resetForReplay(done);
    expect(replay.state).toBe("not_started");
    expect(replay.currentStep).toBe(1);
    expect(replay.stepsViewed).toEqual([]);
    expect(replay.tooltipSeen).toEqual(["T-02", "T-03"]);
    // 重看过帮助中心的人不该继续顶着红点
    expect(replay.helpOpened).toBe(true);
    expect(shouldAutoStart(replay)).toBe(true);
  });
});

describe("弱提示记录", () => {
  it("标记已看后 isTooltipUnseen 转假", () => {
    const seen = markTooltipSeen(record(), "T-03");
    expect(isTooltipUnseen(seen, "T-03")).toBe(false);
    expect(isTooltipUnseen(seen, "T-04")).toBe(true);
  });

  it("重复标记不产生重复项（幂等）", () => {
    const once = markTooltipSeen(record(), "T-02");
    expect(markTooltipSeen(once, "T-02").tooltipSeen).toEqual(["T-02"]);
  });

  it("已看过时返回原对象，便于调用方跳过写库", () => {
    const once = markTooltipSeen(record(), "T-02");
    expect(markTooltipSeen(once, "T-02")).toBe(once);
  });

  it("空 id 不写库", () => {
    const base = record();
    expect(markTooltipSeen(base, "")).toBe(base);
  });
});

describe("帮助入口红点（B-01）", () => {
  it("未开始且没打开过帮助中心 → 亮", () => {
    expect(shouldShowHelpBadge(record())).toBe(true);
  });

  it("引导走完 → 灭", () => {
    expect(shouldShowHelpBadge(record({ state: "done" }))).toBe(false);
  });

  it("打开过一次帮助中心 → 灭（即使引导没走完）", () => {
    const opened = markHelpOpened(record({ state: "skipped" }));
    expect(shouldShowHelpBadge(opened)).toBe(false);
  });
});

describe("持久化读写", () => {
  it("读取走 configGet，键为 novel_guide_state_v1", async () => {
    store = JSON.stringify(record({ state: "done" }));
    const result = await fetchGuideState();
    expect(configGet).toHaveBeenCalledWith("novel_guide_state_v1");
    expect(result.state).toBe("done");
  });

  it("键盘入 constants 的 STORAGE_KEYS（不散落字面量）", () => {
    expect(STORAGE_KEYS.guideState).toBe("novel_guide_state_v1");
  });

  it("写入走 configSet 且内容可解析回原记录", async () => {
    const source = record({ state: "in_progress", currentStep: 3 });
    await saveGuideState(source);
    expect(configSet).toHaveBeenCalledTimes(1);
    expect(parseGuideRecord(store)).toEqual(source);
  });

  it("库未就绪（无 electronAPI）返回默认记录，不抛", async () => {
    vi.stubGlobal("window", {});
    await expect(fetchGuideState()).resolves.toMatchObject({ state: "not_started" });
    await expect(saveGuideState(record())).resolves.toBe(false);
  });

  it("读写抛错被吞掉：引导状态丢了最多重放一次，不该弹错误", async () => {
    const boom = vi.fn(async () => {
      throw new Error("库未就绪");
    });
    vi.stubGlobal("window", {
      electronAPI: { novel: { configGet: boom, configSet: boom } },
    });
    await expect(fetchGuideState()).resolves.toMatchObject({ state: "not_started" });
    await expect(saveGuideState(record())).resolves.toBe(false);
  });
});
