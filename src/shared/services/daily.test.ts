import { describe, expect, it } from "vitest";
import { minutesToTime, timeToMinutes } from "./daily";

describe("timeToMinutes", () => {
  it("标准 HH:mm 转分钟数", () => {
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("09:30")).toBe(570);
    expect(timeToMinutes("23:59")).toBe(1439);
  });

  it("非补零时间同样可解析", () => {
    expect(timeToMinutes("9:05")).toBe(545);
  });
});

describe("minutesToTime", () => {
  it("分钟数转补零 HH:mm", () => {
    expect(minutesToTime(0)).toBe("00:00");
    expect(minutesToTime(570)).toBe("09:30");
    expect(minutesToTime(1439)).toBe("23:59");
  });

  it("与 timeToMinutes 互逆", () => {
    for (const mins of [0, 1, 60, 545, 1439]) {
      expect(timeToMinutes(minutesToTime(mins))).toBe(mins);
    }
  });
});
