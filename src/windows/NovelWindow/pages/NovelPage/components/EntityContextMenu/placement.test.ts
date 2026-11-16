/**
 * 选区右键菜单落位（REQ-056 守卫）
 *
 * 钉住的是**意图**而不是某组魔数：菜单必须完整落在 stage 可视区内，
 * 不被 `overflow: hidden` 切掉底部菜单项。旧实现按「约 190×320」估算，
 * 菜单长到近 500px 后底部功能直接点不到——这组用例就是那个事故的回归网。
 */
import { describe, expect, it } from "vitest";
import {
  CONTEXT_MENU_MARGIN,
  placeContextMenu,
  type PlacementInput,
} from "./placement";

/** stage 取一个接近真机的高度（1080 窗口下正文区约 550px） */
const STAGE = { width: 760, height: 550 };
/** 实测的菜单高度：文本变换 6 项 + 行囊 1 项 + 资料卡 4 项 + 绑定列表 */
const TALL_MENU = { width: 196, height: 486 };

const place = (over: Partial<PlacementInput> = {}) =>
  placeContextMenu({ x: 100, y: 100, menu: TALL_MENU, stage: STAGE, ...over });

/** 菜单底边不得越过 stage 下沿留白 */
const bottomOf = (p: { top: number; maxHeight?: number }, height: number) =>
  p.top + Math.min(height, p.maxHeight ?? height);

describe("placeContextMenu", () => {
  it("上方空间充足时原地下移展开", () => {
    expect(place({ y: 20 })).toEqual({ left: 100, top: 20 });
  });

  it("靠底部右键：翻到光标上方，底边不越界（旧实现在这里被切掉半截）", () => {
    const p = place({ y: 500 });
    expect(p.top).toBeLessThan(500);
    expect(bottomOf(p, TALL_MENU.height)).toBeLessThanOrEqual(
      STAGE.height - CONTEXT_MENU_MARGIN,
    );
    expect(p.top).toBeGreaterThanOrEqual(CONTEXT_MENU_MARGIN);
  });

  it("上下都放不下（菜单几乎与 stage 等高）：夹到底部留白处并给出 maxHeight", () => {
    const short = { width: 760, height: 420 };
    const p = place({ y: 300, stage: short });
    expect(p.top).toBe(CONTEXT_MENU_MARGIN);
    expect(p.maxHeight).toBe(short.height - CONTEXT_MENU_MARGIN * 2);
    expect(bottomOf(p, TALL_MENU.height)).toBeLessThanOrEqual(
      short.height - CONTEXT_MENU_MARGIN,
    );
  });

  it("菜单不高时不必给 maxHeight（不产生无谓的滚动条）", () => {
    expect(place({ menu: { width: 196, height: 240 }, y: 40 }).maxHeight).toBe(
      undefined,
    );
  });

  it("靠右边缘右键：左移夹回 stage，右边界不越界", () => {
    const p = place({ x: STAGE.width - 10, y: 40 });
    expect(p.left).toBe(STAGE.width - CONTEXT_MENU_MARGIN - TALL_MENU.width);
    expect(p.left + TALL_MENU.width).toBeLessThanOrEqual(
      STAGE.width - CONTEXT_MENU_MARGIN,
    );
  });

  it("stage 比菜单还窄时从左边留白起排（不因负的右边界把菜单推出左边）", () => {
    const p = place({ x: 300, stage: { width: 160, height: 550 } });
    expect(p.left).toBe(CONTEXT_MENU_MARGIN);
  });

  it("坐标在 stage 外（负值）时夹回留白内", () => {
    const p = place({ x: -40, y: -20 });
    expect(p.left).toBe(CONTEXT_MENU_MARGIN);
    expect(p.top).toBe(CONTEXT_MENU_MARGIN);
  });

  it("留白可覆盖（默认 8）", () => {
    expect(place({ x: 0, y: 0, margin: 0 })).toEqual({ left: 0, top: 0 });
  });

  it("尺寸为 0（未测量的首帧）时只做坐标夹取，不产生 maxHeight", () => {
    const p = place({ x: 10, y: 10, menu: { width: 0, height: 0 } });
    expect(p).toEqual({ left: 10, top: 10, maxHeight: undefined });
  });
});
