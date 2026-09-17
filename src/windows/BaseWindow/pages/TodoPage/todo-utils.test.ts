import { describe, expect, it } from "vitest";
import { formatWorkHour, parseWorkHourTag, sortChildrenByDone } from "./todo-utils";

describe("formatWorkHour", () => {
  it("null / undefined 返回空字符串", () => {
    expect(formatWorkHour(null)).toBe("");
    expect(formatWorkHour(undefined)).toBe("");
  });

  it("整数小时不显示小数位", () => {
    expect(formatWorkHour(2)).toBe("2h");
  });

  it("非整小时保留一位小数", () => {
    expect(formatWorkHour(1.5)).toBe("1.5h");
    expect(formatWorkHour(0.25)).toBe("0.3h");
  });

  it("字符串数字会被转为数字格式化", () => {
    expect(formatWorkHour("3" as unknown as number)).toBe("3h");
  });
});

describe("parseWorkHourTag", () => {
  it("空输入返回空内容与 null 工时", () => {
    expect(parseWorkHourTag("")).toEqual({ content: "", workHour: null });
    expect(parseWorkHourTag("   ")).toEqual({ content: "", workHour: null });
  });

  it("无 #h 标签时原样返回（trim 后）", () => {
    expect(parseWorkHourTag("  写周报  ")).toEqual({
      content: "写周报",
      workHour: null,
    });
  });

  it("解析行尾的 #2h 标签并从内容中移除", () => {
    expect(parseWorkHourTag("修复登录页 #2h")).toEqual({
      content: "修复登录页",
      workHour: 2,
    });
  });

  it("解析行首标签", () => {
    expect(parseWorkHourTag("#1.5h 代码评审")).toEqual({
      content: "代码评审",
      workHour: 1.5,
    });
  });

  it("解析中间的标签并压缩多余空格", () => {
    expect(parseWorkHourTag("修复登录页   #2h   并补充测试")).toEqual({
      content: "修复登录页 并补充测试",
      workHour: 2,
    });
  });

  it("大小写不敏感（#2H）", () => {
    expect(parseWorkHourTag("部署 #2H")).toEqual({
      content: "部署",
      workHour: 2,
    });
  });

  it("数字与 h 之间允许空格（# 2 h）", () => {
    expect(parseWorkHourTag("联调 # 3 h")).toEqual({
      content: "联调",
      workHour: 3,
    });
  });

  it("负数标签不匹配（# 后非数字原样保留）", () => {
    // 正则只匹配无符号数字，"#-2h" 不构成工时标签
    expect(parseWorkHourTag("温度 #-2h 变化")).toEqual({
      content: "温度 #-2h 变化",
      workHour: null,
    });
  });

  it("h 后紧跟字母（如 #2home）不误匹配", () => {
    // \b 词边界要求 h 后是非单词字符
    expect(parseWorkHourTag("任务 #2home")).toEqual({
      content: "任务 #2home",
      workHour: null,
    });
  });

  it("出现多个标签时取第一个标签的值，并全部清除", () => {
    expect(parseWorkHourTag("任务 #1h 中段 #2h")).toEqual({
      content: "任务 中段",
      workHour: 1,
    });
  });
});

describe("sortChildrenByDone", () => {
  const make = (id: number, done: 0 | 1) => ({ id, done });

  it("已完成子项沉底，未完成排前面", () => {
    const result = sortChildrenByDone([
      make(1, 1),
      make(2, 0),
      make(3, 1),
      make(4, 0),
    ]);
    expect(result.map((item) => item.id)).toEqual([2, 4, 1, 3]);
  });

  it("同组内保持原有相对顺序（稳定）", () => {
    const result = sortChildrenByDone([
      make(1, 1),
      make(2, 0),
      make(3, 1),
      make(4, 0),
      make(5, 1),
    ]);
    // 未完成组：2、4 保持输入顺序；已完成组：1、3、5 保持输入顺序
    expect(result.map((item) => item.id)).toEqual([2, 4, 1, 3, 5]);
  });

  it("全部未完成时原样返回（复用原数组引用）", () => {
    const input = [make(1, 0), make(2, 0)];
    const result = sortChildrenByDone(input);
    expect(result).toBe(input);
  });

  it("全部已完成时原样返回（复用原数组引用）", () => {
    const input = [make(1, 1), make(2, 1)];
    const result = sortChildrenByDone(input);
    expect(result).toBe(input);
  });

  it("空数组返回空数组", () => {
    expect(sortChildrenByDone([])).toEqual([]);
  });

  it("单个未完成或单个已完成均原样返回", () => {
    const pending = [make(1, 0)];
    const finished = [make(2, 1)];
    expect(sortChildrenByDone(pending)).toBe(pending);
    expect(sortChildrenByDone(finished)).toBe(finished);
  });

  it("不修改传入的数组（纯函数）", () => {
    const input = [make(1, 1), make(2, 0)];
    sortChildrenByDone(input);
    expect(input.map((item) => item.id)).toEqual([1, 2]);
  });
});
