/**
 * 续写复用「上一章 AI 摘要」守卫（R-AI-09 的第二消费方）
 *
 * 钉的是 PRD 里那条**跨功能复利**：摘要生成过一次、作者付过一次 token，
 * 就应该在人看（恢复上下文）之外再被续写消费一次（机器看）。
 *
 * 三件容易回退的事：
 * 1. 调用方没取 `aiSummary`（只取 `outlineNote` 一句话，那是另一回事）；
 * 2. 阈值判断被复制到调用方 —— 两个产地必然漂移，此处必须是模板层唯一产地；
 * 3. 章节顺序没用 `data.groups` 扁平化 —— 扁平 `chapters` 不带卷序，
 *    取到的「上一章」可能跨卷错位。
 *
 * 为什么用源码断言：`runContinuation` 依赖编辑器实例，纯单元测代价高；
 * 模板层的行为（前文长则丢弃摘要）已由 `prompt.test.ts` 正面覆盖，这里只钉接线。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const USE_NOVEL_PAGE = readFileSync(
  path.resolve(
    process.cwd(),
    "src/windows/NovelWindow/pages/NovelPage/hooks/useNovelPage.ts",
  ),
  "utf8",
).replace(/\r\n/g, "\n");

/**
 * 去掉行注释后的代码：注释里**允许**提到阈值常量名（那是给人看的指路牌），
 * 但代码里不许真的引用它 —— 否则就是第二个产地。
 */
const CODE_ONLY = USE_NOVEL_PAGE.replace(/\/\/[^\n]*/g, "");

/** 只截 `runContinuation` 那一段，避免被同文件其它 aiSummary / groups 用法假命中 */
const runContinuationBody = ((): string => {
  const start = USE_NOVEL_PAGE.indexOf("const runContinuation = useCallback(");
  if (start < 0) return "";
  const end = USE_NOVEL_PAGE.indexOf("const handleContinuationConfirm", start);
  return USE_NOVEL_PAGE.slice(start, end > start ? end : start + 6000);
})();

describe("续写复用上一章摘要（跨功能复利守卫）", () => {
  it("runContinuation 取的是上一章的 aiSummary", () => {
    expect(runContinuationBody).not.toBe("");
    expect(runContinuationBody).toMatch(/aiSummary/);
  });

  it("摘要随请求下发到续写模板（不传 = 摘要永远只给人看）", () => {
    expect(runContinuationBody).toMatch(/previousSummary/);
  });

  it("阈值只在模板层判断，调用方不得复制一份", () => {
    // 调用方只管「有就传」；一旦这里出现阈值常量或长度比较，两个产地就开始漂移
    expect(CODE_ONLY).not.toContain("CONTINUATION_SUMMARY_MIN_BEFORE_CHARS");
    expect(runContinuationBody).not.toMatch(/before\.text\.length\s*[<>]/);
  });

  it("「上一章」按卷分组的章节顺序取，不用扁平 chapters（会跨卷错位）", () => {
    expect(runContinuationBody).toMatch(/data\.groups\.flatMap/);
  });

  it("不拿大纲梗概（outlineNote）冒充摘要", () => {
    expect(runContinuationBody).not.toMatch(/outlineNote/);
  });
});
