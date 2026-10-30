import { beforeEach, describe, expect, it } from "vitest";
import { resetSensitiveStoreForTest, useSensitiveStore } from "./useSensitiveStore";

/**
 * 手动模式的语义守卫：**没扫描就没有标注**。
 *
 * 真实事故：从「关闭」切到「手动」的瞬间，正文全文标红，而面板写着「尚未扫描」、
 * 状态条写着「敏感 0」。根因是编辑器直接吃了词库（自动模式的数据源），
 * 而计数与面板吃的是扫描结果 —— 两套数据源各说各话。
 *
 * 现在标注源只有一份：`chapterMatches`（逐处区间），由扫描写入。
 * 这三条用例把「切换模式不产生标注」「扫描后标注与计数同源」「关闭一起清」
 * 钉住，任何一边被改回去都会红。
 */
describe("敏感词 store：手动模式只标扫描结果", () => {
  beforeEach(() => {
    resetSensitiveStoreForTest();
  });

  /** 用户报告的那条路径：关闭 → 手动 */
  const switchOffThenManual = (): void => {
    useSensitiveStore.getState().setMode("off");
    useSensitiveStore.getState().setMode("manual");
  };

  it("关闭切到手动：没有任何标注源（正文不会凭空标红）", () => {
    switchOffThenManual();
    const state = useSensitiveStore.getState();
    expect(state.chapterMatches).toBeNull();
    expect(state.chapterResult).toBeNull();
    expect(state.chapterResult?.total ?? 0).toBe(0);
  });

  it("扫描本章之后：逐处区间与聚合计数同源（红字与角标一起出现）", () => {
    switchOffThenManual();
    useSensitiveStore.getState().addWords(["敏感测试词"]);

    useSensitiveStore.getState().scanCurrentChapter({
      id: "c1",
      title: "第一章",
      content: "他说了一句敏感测试词，又补了一句敏感测试词。",
    });

    const state = useSensitiveStore.getState();
    // 聚合只留每个词的首个位置，标红要每一处 —— 两者数量必须对得上
    expect(state.chapterMatches).toHaveLength(2);
    expect(state.chapterResult?.total).toBe(2);
    expect(state.chapterResultId).toBe("c1");
  });

  it("切到关闭：结果与区间一起清空（不会留下半套状态）", () => {
    switchOffThenManual();
    useSensitiveStore.getState().addWords(["敏感测试词"]);
    useSensitiveStore.getState().scanCurrentChapter({
      id: "c1",
      title: "第一章",
      content: "敏感测试词",
    });
    expect(useSensitiveStore.getState().chapterMatches).toHaveLength(1);

    useSensitiveStore.getState().setMode("off");

    const state = useSensitiveStore.getState();
    expect(state.chapterMatches).toBeNull();
    expect(state.chapterResult).toBeNull();
    expect(state.chapterResultId).toBeNull();
  });

  it("词库变更会让旧区间失效（否则会标出已删除的词）", () => {
    switchOffThenManual();
    useSensitiveStore.getState().addWords(["敏感测试词"]);
    useSensitiveStore.getState().scanCurrentChapter({
      id: "c1",
      title: "第一章",
      content: "敏感测试词",
    });
    expect(useSensitiveStore.getState().chapterMatches).toHaveLength(1);

    useSensitiveStore.getState().removeWord("敏感测试词");

    expect(useSensitiveStore.getState().chapterMatches).toBeNull();
  });
});

/**
 * 坐标平移的上报通道。
 *
 * 真实事故：手动扫描完改了几个字，高亮停在旧位置、后面全偏。编辑器已经把
 * 装饰平移好了（见 `sensitive-editor.test.ts`），但面板 / 角标读的是 store 里
 * 那份**扫描时的**区间 —— 不把平移结果报回来，屏幕上红的是新位置、右边写的
 * 是旧数量、点一下跳的还是旧坐标。
 */
describe("敏感词 store：编辑后的区间上报", () => {
  beforeEach(() => {
    resetSensitiveStoreForTest();
  });

  /** 扫一章「敏感测试词 ×2」，并把草稿记成同一份正文 */
  const scanTwo = (): void => {
    useSensitiveStore.getState().setMode("manual");
    useSensitiveStore.getState().addWords(["敏感测试词"]);
    const chapter = {
      id: "c1",
      title: "第一章",
      content: "他说敏感测试词，又说了敏感测试词。",
    };
    useSensitiveStore.getState().noteDraft(chapter);
    useSensitiveStore.getState().scanCurrentChapter(chapter);
  };

  it("上报平移后的区间：区间、计数、跳转位置一起对齐", () => {
    scanTwo();
    expect(useSensitiveStore.getState().chapterResult?.total).toBe(2);

    // 正文开头插了 3 个字，编辑器把两处区间整体后移 3 报回来
    useSensitiveStore.getState().syncChapterRanges("c1", [
      { word: "敏感测试词", from: 5, to: 10 },
      { word: "敏感测试词", from: 14, to: 19 },
    ]);

    const state = useSensitiveStore.getState();
    expect(state.chapterMatches).toEqual([
      { word: "敏感测试词", from: 5, to: 10 },
      { word: "敏感测试词", from: 14, to: 19 },
    ]);
    expect(state.chapterResult?.total).toBe(2);
    expect(state.chapterResult?.hits[0].from).toBe(5);
    expect(state.chapterResultId).toBe("c1");
  });

  it("删掉其中一处：计数跟着降，不留下已不存在的命中", () => {
    scanTwo();
    useSensitiveStore.getState().syncChapterRanges("c1", [
      { word: "敏感测试词", from: 5, to: 10 },
    ]);

    const state = useSensitiveStore.getState();
    expect(state.chapterMatches).toHaveLength(1);
    expect(state.chapterResult?.total).toBe(1);
  });

  it("别的章的上报直接丢弃（不把 A 章的坐标写进 B 章）", () => {
    scanTwo();
    const before = useSensitiveStore.getState().chapterMatches;
    useSensitiveStore.getState().syncChapterRanges("c9", [
      { word: "敏感测试词", from: 0, to: 5 },
    ]);

    const state = useSensitiveStore.getState();
    expect(state.chapterResultId).toBe("c1");
    expect(state.chapterMatches).toEqual(before);
  });

  it("还没扫描过：上报不会凭空造出标注", () => {
    useSensitiveStore.getState().setMode("manual");
    useSensitiveStore.getState().syncChapterRanges("c1", [
      { word: "敏感测试词", from: 0, to: 5 },
    ]);
    expect(useSensitiveStore.getState().chapterMatches).toBeNull();
  });
});
