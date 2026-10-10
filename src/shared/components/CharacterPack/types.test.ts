import { describe, expect, it } from "vitest";
import { RARITY_KEYS, RARITY_META, rarityMetaOf } from "./types";

/**
 * 稀有度的**取值口径**（REQ-010：圆点即下拉入口）。
 *
 * 这两条都不是「跑一下就看得见」的错误：
 *  - 菜单顺序如果跟着 `RARITY_META` 的键序走，某天有人为了分组把 META 重排一遍，
 *    菜单会静默变成 普通 / 传说 / 精良…，没有任何报错，review 也极难看出来。
 *  - 库里的 `rarity` 是自由字符串（历史数据、手工改库、旧版本写入的值），
 *    查不到时若直接返回 undefined，圆点会退化成「没有背景色的透明块」，
 *    读起来像「这条没设稀有度」，而不是「这个值不认识」。
 */
describe("稀有度取值口径（REQ-010）", () => {
  it("RARITY_KEYS 是按稀有度由弱到强的产品口径，不跟 RARITY_META 的键序绑定", () => {
    expect([...RARITY_KEYS]).toEqual(["common", "fine", "rare", "epic", "legend"]);
  });

  it("每个取值都有文案与配色（少一个会让圆点变成透明块）", () => {
    for (const key of RARITY_KEYS) {
      const meta = RARITY_META[key] as { label?: string; color?: string } | undefined;
      expect(meta, `RARITY_META 缺 ${key}`).toBeTruthy();
      expect(meta?.label).toBeTruthy();
      expect(meta?.color).toBeTruthy();
    }
  });

  it("菜单项顺序 = 由弱到强（下拉里看到的顺序就是这一份）", () => {
    const labels = RARITY_KEYS.map((key) => rarityMetaOf(key).label);
    expect(labels).toEqual(["普通", "精良", "稀有", "史诗", "传说"]);
  });

  it("未知取值给中性兜底，且保留原值当文案（不显示 undefined）", () => {
    expect(rarityMetaOf("mythic")).toEqual({
      label: "mythic",
      color: "var(--app-text-disabled)",
    });
    // 空串（老数据没填）不能显示成空标签
    expect(rarityMetaOf("").label).toBe("未知");
  });

  it("已知取值原样返回，不做包装", () => {
    expect(rarityMetaOf("legend")).toBe(RARITY_META.legend);
  });
});
