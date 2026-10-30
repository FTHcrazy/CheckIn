import { describe, expect, it } from "vitest";
import {
  isHighlightEnabled,
  resolveHighlightSource,
  SENSITIVE_MODE_META,
} from "./types";

/**
 * 回归守卫：正文标什么，由模式唯一决定。
 *
 * 这里出过两次事故，根因是同一个 —— 「标什么」与「何时统计」被绑在一起：
 *   1. 手动模式整层不挂 → 扫出 15 处、正文一个字不标，看着像功能没生效；
 *   2. 手动模式改吃词库 → 从关闭切到手动的瞬间全文凭空标红，
 *      而面板与状态条还是 0，用户根本不知道这些红色从哪来。
 *
 * 现在拆成三件事：什么时候扫（按钮 / 防抖）、标什么（词库 / 扫描结果）、
 * 标不标（关闭）。第一条断言钉的就是第二种事故。
 */
describe("resolveHighlightSource：标什么由模式唯一决定", () => {
  it("手动模式只标扫描结果（没扫过 = 空 = 一个字不标）", () => {
    expect(resolveHighlightSource("manual")).toBe("scan");
  });

  it("自动模式按词库实时标", () => {
    expect(resolveHighlightSource("auto")).toBe("live");
  });

  it("关闭模式不标", () => {
    expect(resolveHighlightSource("off")).toBe("none");
  });
});

describe("isHighlightEnabled：只有关闭才摘层", () => {
  it("手动模式仍挂层（手动模式标注为空时才不显示，层本身在）", () => {
    expect(isHighlightEnabled("manual")).toBe(true);
  });

  it("自动模式高亮", () => {
    expect(isHighlightEnabled("auto")).toBe(true);
  });

  it("关闭模式不标", () => {
    expect(isHighlightEnabled("off")).toBe(false);
  });

  it("三档都有文案与提示（新增档位时必须同步补）", () => {
    for (const mode of ["off", "auto", "manual"] as const) {
      expect(SENSITIVE_MODE_META[mode].label.length).toBeGreaterThan(0);
      expect(SENSITIVE_MODE_META[mode].hint.length).toBeGreaterThan(0);
    }
  });
});
