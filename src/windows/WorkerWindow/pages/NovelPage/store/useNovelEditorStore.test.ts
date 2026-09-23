import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, SAVE } from "../novel-config";
import { countWords } from "../novel-utils";
import type { NovelEntity } from "../types";
import {
  editorActions,
  registerEditorRunner,
  useNovelEditorStore,
} from "./useNovelEditorStore";

const state = () => useNovelEditorStore.getState();

/** 每个用例都从干净状态起步（store 是模块级单例） */
function reset(): void {
  registerEditorRunner(null);
  useNovelEditorStore.setState({
    draftMap: {},
    activeChapterId: null,
    saveState: "idle",
    lastSavedAt: null,
    settings: DEFAULT_SETTINGS,
    selection: null,
    recoveryDismissed: false,
    todayAdded: 0,
    todayTotal: 0,
    speed: 0,
  });
}

function entity(name: string): NovelEntity {
  return {
    id: `e-${name}`,
    workId: "w1",
    type: "character",
    name,
    aliases: [],
    summary: "",
    content: "",
    fields: {},
    sort: 1,
  };
}

describe("useNovelEditorStore（编辑器交互状态）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reset();
  });

  afterEach(() => {
    reset();
    vi.useRealTimers();
  });

  it("输入写入逐章草稿，并按字数差累计今日字数", () => {
    registerEditorRunner({
      persistChapter: async () => true,
      markSelectionAsEntity: () => null,
      persistSettings: () => {},
    });

    state().setContent("c1", "苏晚走进灵潮");
    const words = countWords("苏晚走进灵潮", DEFAULT_SETTINGS.wordCountMode);

    expect(state().draftMap.c1).toBe("苏晚走进灵潮");
    expect(state().activeChapterId).toBe("c1");
    expect(state().todayAdded).toBe(words);
    expect(state().todayTotal).toBe(words);
    expect(state().saveState).toBe("pending");
  });

  it("内容没变时不改写草稿、不重启防抖", () => {
    registerEditorRunner({
      persistChapter: async () => true,
      markSelectionAsEntity: () => null,
      persistSettings: () => {},
    });

    state().setContent("c1", "苏晚");
    vi.advanceTimersByTime(SAVE.debounceMs - 1);
    state().setContent("c1", "苏晚");
    const before = state().draftMap;
    state().setContent("c1", "苏晚");
    expect(state().draftMap).toBe(before);
    expect(state().saveState).toBe("pending");
  });

  it("程序化文档同步（切章灌入）带基线时不计字数、不排保存", () => {
    registerEditorRunner({
      persistChapter: async () => true,
      markSelectionAsEntity: () => null,
      persistSettings: () => {},
    });

    // 切到无草稿的新章：编辑器把整章正文灌进 CodeMirror，回调带着
    // 「变更前正文」上报——previous === next，必须整体提前返回
    state().setContent("c1", "第一章正文", "第一章正文");

    expect(state().draftMap.c1).toBeUndefined();
    expect(state().todayAdded).toBe(0);
    expect(state().todayTotal).toBe(0);
    expect(state().saveState).toBe("idle");
    expect(state().activeChapterId).toBe("c1");
  });

  it("带基线的真实输入：增量按基线算，而不是按空串", () => {
    registerEditorRunner({
      persistChapter: async () => true,
      markSelectionAsEntity: () => null,
      persistSettings: () => {},
    });

    // 首次输入发生在无草稿的章节：基线是灌入时的正文，而不是空串
    state().setContent("c1", "第一章正文更多", "第一章正文");
    const delta = countWords("更多", DEFAULT_SETTINGS.wordCountMode);

    expect(state().todayAdded).toBe(delta);
    expect(state().todayTotal).toBe(delta);
  });

  it("换章后立刻输入：旧章在途保存立即落库，不被新章防抖吞掉", async () => {
    const saved: Array<[string, string]> = [];
    registerEditorRunner({
      persistChapter: async (id, content) => {
        saved.push([id, content]);
        return true;
      },
      markSelectionAsEntity: () => null,
      persistSettings: () => {},
    });

    state().setContent("c1", "旧章草稿");
    await vi.advanceTimersByTimeAsync(SAVE.debounceMs - 1);
    expect(saved).toEqual([]);

    // 换到 c2 的第一次真实输入：c1 的在途防抖被换成立即落库
    state().setContent("c2", "新章开头");
    expect(saved).toEqual([["c1", "旧章草稿"]]);

    await vi.advanceTimersByTimeAsync(SAVE.debounceMs + 1);
    expect(saved).toEqual([
      ["c1", "旧章草稿"],
      ["c2", "新章开头"],
    ]);
    expect(state().saveState).toBe("saved");
  });

  it("flushSave 在换章后仍能落库旧章的在途草稿", async () => {
    const saved: string[] = [];
    registerEditorRunner({
      persistChapter: async (id) => {
        saved.push(id);
        return true;
      },
      markSelectionAsEntity: () => null,
      persistSettings: () => {},
    });

    // 手动保存（无在途防抖）：只写当前章
    state().setContent("c1", "正文一");
    await editorActions.flushSave();
    expect(saved).toEqual(["c1"]);

    // 再改一次 c1 制造在途防抖；随后程序化灌入 c2（previous === next）只挪
    // 活动章、不重启防抖——在途保存仍属于 c1，flush 必须落库 c1 而不是漏掉。
    // （首轮 flush 已清掉在途状态，不补这次真实输入的话切章后并无在途可 flush）
    state().setContent("c1", "正文一改");
    state().setContent("c2", "第二章正文", "第二章正文");
    expect(state().activeChapterId).toBe("c2");
    await editorActions.flushSave();
    expect(saved).toEqual(["c1", "c1"]);
    expect(state().saveState).toBe("saved");
  });

  it("停顿满防抖时长才落库，成功后转为 saved 并记录时间", async () => {
    let calls = 0;
    registerEditorRunner({
      persistChapter: async () => {
        calls += 1;
        return true;
      },
      markSelectionAsEntity: () => null,
      persistSettings: () => {},
    });

    state().setContent("c1", "正文");
    await vi.advanceTimersByTimeAsync(SAVE.debounceMs - 1);
    expect(calls).toBe(0);
    expect(state().saveState).toBe("pending");

    await vi.advanceTimersByTimeAsync(2);
    expect(calls).toBe(1);
    expect(state().saveState).toBe("saved");
    expect(state().lastSavedAt).not.toBeNull();
  });

  it("落库失败转为 failed，且保留上一次成功时间", async () => {
    registerEditorRunner({
      persistChapter: async () => false,
      markSelectionAsEntity: () => null,
      persistSettings: () => {},
    });

    await editorActions.flushSave(); // 没有正文，直接返回
    state().setContent("c1", "正文");
    await vi.advanceTimersByTimeAsync(SAVE.debounceMs + 1);

    expect(state().saveState).toBe("failed");
    expect(state().lastSavedAt).toBeNull();
  });

  it("flushSave 立即落库并取消在途防抖（只写一次）", async () => {
    let calls = 0;
    registerEditorRunner({
      persistChapter: async () => {
        calls += 1;
        return true;
      },
      markSelectionAsEntity: () => null,
      persistSettings: () => {},
    });

    state().setContent("c1", "正文");
    await editorActions.flushSave();
    expect(calls).toBe(1);

    // 防抖已被取消，后续计时器不再触发第二次写入
    await vi.advanceTimersByTimeAsync(SAVE.debounceMs * 2);
    expect(calls).toBe(1);
    expect(state().saveState).toBe("saved");
  });

  it("未注册 runner 时草稿照常保留，保存落到 failed", async () => {
    state().setContent("c1", "正文");
    await vi.advanceTimersByTimeAsync(SAVE.debounceMs + 1);
    expect(state().draftMap.c1).toBe("正文");
    expect(state().saveState).toBe("failed");
  });

  it("外部灌入正文（回滚 / 恢复）也走同一条保存路径", async () => {
    let saved: string | null = null;
    registerEditorRunner({
      persistChapter: async (_id, content) => {
        saved = content;
        return true;
      },
      markSelectionAsEntity: () => null,
      persistSettings: () => {},
    });

    state().applyExternalContent("c1", "回滚后的正文");
    await vi.advanceTimersByTimeAsync(SAVE.debounceMs + 1);
    expect(saved).toBe("回滚后的正文");
  });

  it("改排版设置即时持久化，且不动草稿", () => {
    let persisted = 0;
    registerEditorRunner({
      persistChapter: async () => true,
      markSelectionAsEntity: () => null,
      persistSettings: () => {
        persisted += 1;
      },
    });

    state().setContent("c1", "正文");
    state().updateSetting("fontSize", 20);
    expect(state().settings.fontSize).toBe(20);
    expect(persisted).toBe(1);

    // 默认标注类型里含 character：先关掉，再开回来
    expect(state().settings.annotationTypes).toContain("character");
    state().toggleAnnotationType("character");
    expect(state().settings.annotationTypes).not.toContain("character");
    expect(persisted).toBe(2);

    state().toggleAnnotationType("character");
    expect(state().settings.annotationTypes).toContain("character");
    expect(persisted).toBe(3);
  });

  it("标记选区：交给 runner 建卡并清空选区", () => {
    const created = entity("苏晚");
    registerEditorRunner({
      persistChapter: async () => true,
      markSelectionAsEntity: () => ({ entity: created, mode: "created" }),
      persistSettings: () => {},
    });

    state().setSelection({ text: "苏晚", from: 0, to: 2 });
    const result = state().markSelection("character");

    expect(result?.mode).toBe("created");
    expect(state().selection).toBeNull();

    // 无选区时不调用 runner
    expect(state().markSelection("character")).toBeNull();
  });

  it("今日累计与恢复横幅的开关各自独立", () => {
    registerEditorRunner({
      persistChapter: async () => true,
      markSelectionAsEntity: () => null,
      persistSettings: () => {},
    });

    state().hydrateUsage(1200);
    expect(state().todayTotal).toBe(1200);
    expect(state().todayAdded).toBe(0);

    state().dismissRecovery();
    expect(state().recoveryDismissed).toBe(true);
  });
});
