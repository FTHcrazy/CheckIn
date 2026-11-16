/**
 * AI 排阶梯的编排守卫（R-AI-18）
 *
 * 这一层出错不会崩，只会悄悄多花钱、多写数据或越级发数据，所以逐条钉死：
 *
 * 1. **`run` 只产候选，`apply` 才写**：AI 产出必须人工确认后才入库
 *    （与 08 / 15 同一纪律）。断言 `run` 的正文里没有写入通道调用。
 * 2. **不新增写通道**：写入只走 `onBatchAddLevels`（既有批量追加 IPC）。
 * 3. **不越级授权**：只发分类名 / 说明 / 现有阶梯名 / 作品题材，
 *    **不含正文** ⇒ L1/L2，不许出现 L3 授权链路（`useAiConsent` / 范围载荷）。
 * 4. **两个形态共用一份**：设定中心与全局设定中心挂的是同一个 hook 与弹窗，
 *    否则两份实现必然漂移（一处改了 prompt，另一处还是老口径）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string): string =>
  readFileSync(path.resolve(process.cwd(), relative), "utf8").replace(/\r\n/g, "\n");

const HOOK = read("src/shared/components/SettingCenter/hooks/useAiLevelGen.ts");
const SETTING_CENTER = read("src/shared/components/SettingCenter/index.tsx");
const GS_BODY = read("src/windows/GlobalSettingWindow/components/GsBody/index.tsx");

/** 取两个锚点之间的源码（结构性锚点，不依赖字符数——格式化不会搬走 `const xxx = useCallback`） */
function sliceBetween(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  if (from < 0 || to < 0 || to <= from) return "";
  return source.slice(from, to);
}

describe("候选与写入分离", () => {
  const runBody = sliceBetween(HOOK, "const run = useCallback", "const toggle = useCallback");
  const applyBody = sliceBetween(HOOK, "const apply = useCallback", "return {");

  it("两个函数体都能切出来（锚点还在，守卫本身没失效）", () => {
    expect(runBody).toContain("aiGenerateStructured");
    expect(applyBody).toContain("pickedLevelItems");
  });

  it("run 只产候选：函数体里没有写通道、没有采纳上报", () => {
    expect(runBody).toContain("buildLevelCandidates");
    expect(runBody).not.toContain("onBatchAddLevels");
    expect(runBody).not.toContain("logAiEvent");
  });

  it("apply 才写：走既有批量追加通道 + 上报采纳", () => {
    // 只钉语义（调用在，且第一个参数是本次会话的分类），不钉死一行格式
    expect(applyBody).toMatch(/onBatchAddLevels\(\s*session\.categoryId/);
    expect(applyBody).toContain('step: "adopt"');
  });

  it("写入只取「勾选且不重名」的条目（重名项即便被勾上也不写）", () => {
    // pickedLevelItems 同时带出 name 与 note —— 等级说明必须跟着落库
    expect(applyBody).toContain("pickedLevelItems(session.candidates)");
    // 写完后把候选全部取消勾选，避免同一批被点第二次（会建出两行同名等级）
    expect(applyBody).toContain("selected: false");
  });
});

describe("不新增写通道 / 不碰 IPC", () => {
  it("hook 里没有直接的 electronAPI 调用（写入必须经调用方注入的通道）", () => {
    expect(HOOK).not.toContain("window.electronAPI");
  });

  it("没有新的 novel-* 频道（复用 onBatchAddLevels，不新增 IPC）", () => {
    expect(HOOK).not.toMatch(/novel-[a-z-]+/);
  });
});

describe("不越级授权（L1/L2）", () => {
  it("不引入 L3 授权链路：既没有 useAiConsent，也没有范围载荷构造", () => {
    expect(HOOK).not.toContain("useAiConsent");
    expect(HOOK).not.toContain("AiConsentDialog");
    expect(HOOK).not.toContain("buildChapterScopePayload");
  });

  it("采集的上下文只有作品背景，要素卡一个都不送（否则 prompt 白白翻倍）", () => {
    expect(HOOK).toContain("entities: []");
    expect(HOOK).toContain('"levelGen"');
  });

  it("请求体里不出现正文 / 选区字段（等级体系不需要读书稿）", () => {
    expect(HOOK).not.toContain("chapterText");
    expect(HOOK).not.toContain("contextText");
    expect(HOOK).not.toContain("selection");
  });
});

describe("两个形态共用一份实现", () => {
  it("设定中心（本书域）挂的是同一个 hook 与弹窗", () => {
    expect(SETTING_CENTER).toContain("useAiLevelGen");
    expect(SETTING_CENTER).toContain("AiLevelGenModal");
    // 写入必须落到组件收到的既有通道，而不是自己另开一条
    expect(SETTING_CENTER).toContain("onBatchAddLevels: props.onBatchAddLevels");
  });

  it("全局设定中心挂的也是同一份（写入走全局库自己的批量追加）", () => {
    expect(GS_BODY).toContain("useAiLevelGen");
    expect(GS_BODY).toContain("AiLevelGenModal");
    expect(GS_BODY).toContain("onBatchAddLevels: data.onBatchAddLevels");
  });

  it("两处的入口都是「AI 不可用就不传 onOpenAiGen」（死按钮比没有入口更糟）", () => {
    for (const source of [SETTING_CENTER, GS_BODY]) {
      expect(source).toMatch(/onOpenAiGen=\{\s*aiGen\.hidden\s*\?\s*undefined/);
    }
  });
});
