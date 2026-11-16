import { describe, expect, it } from "vitest";
import { WORLD_LAYER_ORDER, worldLayerIndexOf, type WorldLayerName } from "./layers";

/**
 * z 序清单的自洽性（AGENTS §6.6 第 4 条：纯函数必须有同名单测）。
 *
 * `render-stack-guard.test.ts` 钉的是「哪几层在谁上面」这类业务约束；
 * 这里只钉清单本身的不变量：名字不重复、下标与数组一致、未知名字不误命中。
 */
describe("MapCanvas 图层清单", () => {
  it("图层名互不重复，且每个名字都能反查回自己的下标", () => {
    expect(new Set(WORLD_LAYER_ORDER).size).toBe(WORLD_LAYER_ORDER.length);
    WORLD_LAYER_ORDER.forEach((name, index) => {
      expect(worldLayerIndexOf(name)).toBe(index);
    });
  });

  it("worldLayerIndexOf 对未知名字返回 -1（不静默落到第一层）", () => {
    const unknown = "notALayer" as WorldLayerName;
    expect(worldLayerIndexOf(unknown)).toBe(-1);
  });

  it("草稿层永远在最上、静态层永远在最下", () => {
    expect(worldLayerIndexOf("staticLayer")).toBe(0);
    expect(worldLayerIndexOf("draftLayer")).toBe(WORLD_LAYER_ORDER.length - 1);
  });
});
