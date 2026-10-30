import { describe, expect, it } from "vitest";
import { SETTING_PRESETS } from "./setting-presets";

/**
 * 内置预设的形状守卫
 *
 * 预设是产品口径（常量数据），错一条就会原样灌进用户的作品 ——
 * 用单测把「灌进去的东西至少是合法的」钉死。
 */
describe("内置设定预设", () => {
  it("id 唯一且非空（应用入口按 id 查找）", () => {
    const ids = SETTING_PRESETS.map((preset) => preset.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.trim()).toBeTruthy();
  });

  it("每个预设至少一个等级、等级名非空、分类名非空", () => {
    for (const preset of SETTING_PRESETS) {
      expect(preset.name.trim()).toBeTruthy();
      expect(preset.levels.length).toBeGreaterThan(0);
      for (const level of preset.levels) {
        expect(level.name.trim()).toBeTruthy();
        if (level.subLevels !== undefined) {
          expect(level.subLevels).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it("修仙预设覆盖需求口径：练气 9/13 层，其余各分初期/中期/后期/圆满", () => {
    for (const preset of SETTING_PRESETS.filter((item) =>
      item.id.startsWith("preset-xiuxian"),
    )) {
      const qi = preset.levels[0];
      expect(qi.name).toBe("练气");
      expect([9, 13]).toContain(qi.subLevels);
      for (const stage of preset.levels.slice(1)) {
        expect(stage.subLevels).toBe(4);
        expect(stage.subPattern).toBe("初期,中期,后期,圆满");
      }
    }
    expect(
      SETTING_PRESETS.map((preset) => preset.levels[0].subLevels),
    ).toEqual(expect.arrayContaining([9, 13]));
  });

  it("都市评级用倒序进位（F 到 SSS，展示时 SSS 在顶）", () => {
    const dushi = SETTING_PRESETS.find((preset) => preset.id === "preset-dushi");
    expect(dushi?.carryDir).toBe("desc");
    expect(dushi?.levels.at(-1)?.name).toBe("SSS");
  });
});
