import { describe, expect, it } from "vitest";
import {
  buildAuditIssue,
  normalizeSeverity,
  sortAuditIssues,
  splitIssues,
} from "./useInterviewAudit";

/**
 * 质检结论的归一。
 *
 * 模型的三类偏差都要在这里挡住：
 * ① id 抄错 / 发明 id → 建议会落到别的题上（比丢掉更糟，必须按送检集合过滤）；
 * ② 严重程度写中文 / 写别的话 → 归一成三档，认不出按「该改」；
 * ③ 多个问题挤在一行 / 用分号分隔 → 拆成清单，界面才逐条显示。
 */
const targetIds = new Set(["q-1", "q-2"]);

describe("normalizeSeverity", () => {
  it("英文三档原样认", () => {
    expect(normalizeSeverity("high")).toBe("high");
    expect(normalizeSeverity("medium")).toBe("medium");
    expect(normalizeSeverity("low")).toBe("low");
  });

  it("中文档位也认", () => {
    expect(normalizeSeverity("必改")).toBe("high");
    expect(normalizeSeverity("高")).toBe("high");
    expect(normalizeSeverity("可选")).toBe("low");
  });

  it("认不出按「该改」：不把措辞建议标成必改", () => {
    expect(normalizeSeverity("中等偏上")).toBe("medium");
    expect(normalizeSeverity(undefined)).toBe("medium");
  });
});

describe("splitIssues", () => {
  it("换行与分号都当分隔符，去掉行首的序号 / 圆点", () => {
    expect(splitIssues("1. 答案漏了内存屏障\n2、分类与难度不匹配；- 措辞含糊")).toEqual([
      "答案漏了内存屏障",
      "分类与难度不匹配",
      "措辞含糊",
    ]);
  });

  it("空串返回空数组（模型只回了 id 时不要造一条空清单）", () => {
    expect(splitIssues("")).toEqual([]);
    expect(splitIssues(undefined)).toEqual([]);
  });
});

describe("buildAuditIssue", () => {
  it("id 在送检集合里才收", () => {
    const issue = buildAuditIssue({
      entry: { id: "q-1", severity: "high", issues: "答案写错了", suggestion: "改成 X" },
      targetIds,
    });
    expect(issue).toMatchObject({ id: "q-1", severity: "high", issues: ["答案写错了"] });
    expect(issue?.suggestion).toBe("改成 X");
  });

  it("模型发明 / 抄错 id → 丢弃（建议落到别的题上比丢掉更糟）", () => {
    expect(
      buildAuditIssue({
        entry: { id: "q-999", severity: "high", issues: "答案写错了" },
        targetIds,
      }),
    ).toBeNull();
  });

  it("问题与建议都空 → 丢弃（没有信息量）", () => {
    expect(buildAuditIssue({ entry: { id: "q-1" }, targetIds })).toBeNull();
  });

  it("只有建议没有问题时也收（模型偶尔这么写）", () => {
    const issue = buildAuditIssue({
      entry: { id: "q-2", severity: "low", suggestion: "补一个例子" },
      targetIds,
    });
    expect(issue?.issues).toEqual([]);
    expect(issue?.suggestion).toBe("补一个例子");
  });
});

describe("sortAuditIssues", () => {
  it("必改排在最前，同档保持原顺序（别把同一题的两半拆开）", () => {
    const sorted = sortAuditIssues([
      { id: "a", severity: "low", issues: ["x"], suggestion: "" },
      { id: "b", severity: "high", issues: ["y"], suggestion: "" },
      { id: "c", severity: "medium", issues: ["z"], suggestion: "" },
      { id: "d", severity: "high", issues: ["w"], suggestion: "" },
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["b", "d", "c", "a"]);
  });
});
