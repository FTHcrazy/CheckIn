/**
 * AI 采纳 / 放弃上报守卫（B1 判据②，G1 修复）
 *
 * 钉住「度量闭环的最后一公里」：渲染层必须在用户确认采纳 / 主动放弃时
 * 上报 `adopt` / `cancel` 事件，否则看板「采纳率」恒为 0，数据驱动排期
 * 失去依据（review G1）。
 *
 * 为什么用源码断言：useNovelPage 依赖编辑器实例（CodeMirror），纯单元测
 * 代价高，把「存在 adopt/cancel 上报调用点」这条不变量钉在源码上最省。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  path.resolve(
    process.cwd(),
    "src/windows/NovelWindow/pages/NovelPage/hooks/useNovelPage.ts",
  ),
  "utf8",
);

describe("AI 采纳/放弃事件上报（G1 守卫）", () => {
  it("引入了 logAiEvent 上报入口", () => {
    expect(SRC).toContain('logAiEvent');
    expect(SRC).toContain('from "@/shared/ai/ai-client"');
  });

  it("至少存在一处 step: \"adopt\" 的上报调用（采纳率因此可算）", () => {
    // adopt 分散在起名插入 / 润色替换 / 续写确认 / 摘要落库四处，只断言「存在」即可
    expect(SRC).toMatch(/step:\s*"adopt"/);
    // 至少覆盖起名（B1 判据②的硬要求）
    expect(SRC).toMatch(/intent:\s*"naming",\s*step:\s*"adopt"/);
  });

  it("至少存在一处 step: \"cancel\" 的主动放弃上报", () => {
    expect(SRC).toMatch(/step:\s*"cancel"/);
  });

  it("润色 / 变换的 adopt 带子类型 intent，不写死笼统 transform", () => {
    expect(SRC).toMatch(/`transform:\$\{TRANSFORM_INTENT_SUB\[polish\.mode\]\}`/);
  });
});
