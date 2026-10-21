/**
 * 密度档单测（R27 / S4）
 *
 * 钉的是**产品可判定的四条**（RG-I-39 / 40a 的改写口径）：
 * ① 边界是 60 / 200 / 400，且边界值归低档（60 仍算 full，61 才 compact）；
 * ② 档位只改「画多少信息」，不表达任何裁剪意图（没有 dropCount 之类的字段）；
 * ③ 400 以上多一条提示条，档位不因此再降；
 * ④ 名称截断按码点，不切坏代理对。
 */
import { describe, expect, it } from "vitest";
import {
  COMPACT_NAME_CHARS,
  DENSITY_THRESHOLDS,
  nodeLabelOf,
  resolveDensity,
  truncateName,
} from "./graph-density";

describe("resolveDensity：档位边界", () => {
  it("≤60 完整档：角标 + 名称 + 不透明边", () => {
    for (const count of [0, 11, 60]) {
      const plan = resolveDensity(count);
      expect(plan.level).toBe("full");
      expect(plan.showTypeChip).toBe(true);
      expect(plan.showName).toBe(true);
      expect(plan.nameMaxChars).toBe(0);
      expect(plan.edgeOpacity).toBe(1);
      expect(plan.showEdgeLabel).toBe(true);
      expect(plan.notice).toBeNull();
    }
  });

  it("61–200 紧凑档：隐角标 + 名称 6 字截断 + 边降透明度，标签仍常驻", () => {
    for (const count of [61, 120, 200]) {
      const plan = resolveDensity(count);
      expect(plan.level).toBe("compact");
      expect(plan.showTypeChip).toBe(false);
      expect(plan.showName).toBe(true);
      expect(plan.nameMaxChars).toBe(COMPACT_NAME_CHARS);
      expect(plan.edgeOpacity).toBeLessThan(1);
      // 关系名是这张图的主要信息，紧凑档只调淡、不隐藏
      expect(plan.showEdgeLabel).toBe(true);
      expect(plan.notice).toBeNull();
    }
  });

  it("201–400 极简档：只画色点与边（文字交给悬停/选中），仍无提示条", () => {
    for (const count of [201, 300, 400]) {
      const plan = resolveDensity(count);
      expect(plan.level).toBe("minimal");
      expect(plan.showName).toBe(false);
      expect(plan.showTypeChip).toBe(false);
      expect(plan.showEdgeLabel).toBe(false);
      expect(plan.notice).toBeNull();
    }
  });

  it(">400：档位不再降，只多一条常驻提示条", () => {
    const plan = resolveDensity(401);
    expect(plan.level).toBe("minimal");
    expect(plan.notice).toBe("要素较多，已简化显示");
    expect(resolveDensity(5000).level).toBe("minimal");
  });

  it("异常输入按 0 处理（不因为 NaN 抖动换档）", () => {
    expect(resolveDensity(Number.NaN).level).toBe("full");
    expect(resolveDensity(-3).level).toBe("full");
    expect(resolveDensity(60.9).level).toBe("full");
  });

  it("阈值常量与文档一致（60 / 200 / 400）", () => {
    expect(DENSITY_THRESHOLDS).toEqual({ compact: 60, minimal: 200, notice: 400 });
  });

  it("档位里没有任何「裁剪」字段：密度永不改节点集合", () => {
    const plan = resolveDensity(500);
    expect(Object.keys(plan).some((key) => /drop|hide|limit|top/i.test(key))).toBe(false);
  });
});

describe("truncateName / nodeLabelOf", () => {
  it("超过上限才截断，截断后带省略号", () => {
    expect(truncateName("青云镇", 6)).toBe("青云镇");
    expect(truncateName("一二三四五六七", 6)).toBe("一二三四五六…");
    expect(truncateName("一二三四五六", 6)).toBe("一二三四五六");
    // 0 = 不截断
    expect(truncateName("一二三四五六七", 0)).toBe("一二三四五六七");
  });

  it("按码点截断：emoji / 生僻字不会被切开", () => {
    const name = "🐉🐉🐉🐉🐉🐉🐉";
    const out = truncateName(name, 6);
    expect(Array.from(out)).toHaveLength(7); // 6 个字 + 省略号
    expect(out.endsWith("…")).toBe(true);
    // 没有落单的代理项
    expect(out.slice(0, -1)).toBe("🐉🐉🐉🐉🐉🐉");
  });

  it("极简档返回空串（卡面只留色点）", () => {
    expect(nodeLabelOf("林晚", resolveDensity(300))).toBe("");
    expect(nodeLabelOf("林晚", resolveDensity(100))).toBe("林晚");
  });
});
