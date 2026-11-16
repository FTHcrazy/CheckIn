import { describe, expect, it } from "vitest";
import {
  LEVEL_CHIP_EPSILON,
  MAP_SAVE_STATUS_TEXT,
  NUDGE_DIRS,
  NUDGE_STEP_FAST,
  NUDGE_STEP_FINE,
  rejectTextOf,
} from "./editorConstants";

describe("editorConstants —— 页面级配置与文案", () => {
  it("方向表覆盖方向键与 WASD，向上为 y 负方向", () => {
    expect(NUDGE_DIRS.ArrowUp).toEqual([0, -1]);
    expect(NUDGE_DIRS.w).toEqual([0, -1]);
    expect(NUDGE_DIRS.ArrowLeft).toEqual(NUDGE_DIRS.a);
    expect(NUDGE_STEP_FAST).toBeGreaterThan(NUDGE_STEP_FINE);
  });

  it("存档状态六种取值都有文案，冲突文案不能写成已保存", () => {
    for (const key of ["idle", "dirty", "saving", "saved", "conflict", "error"] as const) {
      expect(MAP_SAVE_STATUS_TEXT[key].length).toBeGreaterThan(0);
    }
    expect(MAP_SAVE_STATUS_TEXT.conflict).toContain("新");
    expect(MAP_SAVE_STATUS_TEXT.conflict).not.toContain("已保存到本地");
  });

  it("拒绝原因映射：固定文案、插值与总数上限", () => {
    expect(rejectTextOf("too-few-points", undefined, 1)).toContain("3 个顶点");
    expect(rejectTextOf("overlap-sibling", { id: "r1", name: "青州" }, 1)).toContain("青州");
    expect(rejectTextOf("overlap-ancestor", { id: "r1", name: "" }, 1)).toContain("上级区块");
    expect(rejectTextOf("level-out-of-range", undefined, 1)).toContain("共 1 级");
    expect(rejectTextOf("total-limit", undefined, 1)).toContain("上限");
  });

  it("层级胶囊阈值与渲染层同源且为正", () => {
    expect(LEVEL_CHIP_EPSILON).toBeGreaterThan(0);
    expect(LEVEL_CHIP_EPSILON).toBeLessThan(0.1);
  });
});
