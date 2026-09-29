import { describe, expect, it } from "vitest";
import {
  fromPosition,
  getPanelRealm,
  getRealm,
  parseRealmRaw,
  parseSub,
  setRealm,
  toPosition,
  type RealmState,
} from "./pack-realm";
import type { LadderRung } from "./pack-utils";

const RUNGS: LadderRung[] = [
  { id: "l1", name: "炼气", rank: 1, subLevels: 9, power: 100 },
  { id: "l2", name: "筑基", rank: 2, subLevels: 9, power: 1000 },
  { id: "l3", name: "金丹", rank: 3, subLevels: 9, power: 10000 },
];

function state(partial: Partial<RealmState>): RealmState {
  return {
    link: null,
    realmRaw: "",
    rungs: RUNGS,
    bound: false,
    entityId: "",
    ...partial,
  };
}

describe("境界口子 —— 读（REQ-048）", () => {
  it("已绑定：两侧读同一份 novel_links（linked 语义）", () => {
    const s = state({
      bound: true,
      entityId: "e-主角",
      link: {
        id: "lk1",
        fromType: "character",
        fromId: "e-主角",
        toType: "level",
        toId: "l2",
        relation: "当前境界",
        note: JSON.stringify({ sub: 7 }),
      },
    });
    expect(getRealm(s)).toEqual({ index: 1, sub: 7 });
    expect(getPanelRealm(s)).toEqual({ index: 1, sub: 7 });
  });

  it("未绑定且行囊自持境界存在时，行囊视角可用而面板视角回落到首阶", () => {
    const s = state({
      realmRaw: JSON.stringify({ levelId: "l2", sub: 3 }),
      bound: false,
    });
    expect(getRealm(s)).toEqual({ index: 1, sub: 3 });
    expect(getPanelRealm(s)).toEqual({ index: 0, sub: 1 });
  });

  it("小层超过该阶上限时被夹取（不会读出越界位置）", () => {
    const s = state({
      bound: true,
      entityId: "e1",
      link: {
        id: "lk1",
        fromType: "character",
        fromId: "e1",
        toType: "level",
        toId: "l2",
        relation: "当前境界",
        note: JSON.stringify({ sub: 99 }),
      },
    });
    expect(getRealm(s)).toEqual({ index: 1, sub: 9 });
  });

  it("realmRaw 非法 JSON 时静默回落到首阶", () => {
    expect(parseRealmRaw("{oops")).toBeNull();
    expect(getRealm(state({ realmRaw: "{oops" }))).toEqual({ index: 0, sub: 1 });
  });
});

describe("境界口子 —— 写（origin 决定路由目标）", () => {
  it("已绑定：写入 novel_links，且 fromId 用的是实体 id（不同源坑）", () => {
    const s = state({ bound: true, entityId: "e-叶尘" });
    const plan = setRealm(s, { index: 2, sub: 4 }, "pack", { linkId: "lk-new" });
    expect(plan.realmRaw).toBeNull();
    expect(plan.link).not.toBeNull();
    expect(plan.link!.fromId).toBe("e-叶尘");
    expect(plan.link!.toId).toBe("l3");
    expect(plan.link!.note).toBe(JSON.stringify({ sub: 4 }));
  });

  it("已绑定：已有行沿用原 id，幂等 upsert 不新增孤儿行", () => {
    const s = state({
      bound: true,
      entityId: "e1",
      link: {
        id: "lk-old",
        fromType: "character",
        fromId: "e1",
        toType: "level",
        toId: "l1",
        relation: "当前境界",
        note: "",
      },
    });
    expect(setRealm(s, { index: 1, sub: 2 }, "pack").link!.id).toBe("lk-old");
  });

  it("未绑定：不写 novel_links，改写行囊自持字段", () => {
    const s = state({ bound: false });
    const plan = setRealm(s, { index: 1, sub: 5 }, "pack");
    expect(plan.link).toBeNull();
    expect(plan.realmRaw).toBe(JSON.stringify({ levelId: "l2", sub: 5 }));
  });

  it("未绑定 + origin='r25'：没有面板那份可写，直接返回空计划（不产生孤儿关系行）", () => {
    const plan = setRealm(state({ bound: false }), { index: 1, sub: 5 }, "r25");
    expect(plan.link).toBeNull();
    expect(plan.realmRaw).toBeNull();
  });

  it("carry 模式：满层自动进位到下一阶第 1 层", () => {
    const s = state({ bound: true, entityId: "e1" });
    const plan = setRealm(s, { index: 1, sub: 9 }, "pack", { carry: true, delta: 1 });
    expect(plan.link!.toId).toBe("l3");
    expect(plan.link!.note).toBe(JSON.stringify({ sub: 1 }));
  });
});

describe("parseSub：novel_links.note 只写 {sub}（不能用 parseRealmRaw 代读）", () => {
  it("正常解析小层", () => {
    expect(parseSub(JSON.stringify({ sub: 7 }))).toBe(7);
  });

  it("note 为空 / 非法 JSON / 缺 sub 时回落到 1", () => {
    expect(parseSub("")).toBe(1);
    expect(parseSub("{oops")).toBe(1);
    expect(parseSub(JSON.stringify({ levelId: "l2" }))).toBe(1);
  });

  it("带 levelId 的完整 JSON（旧数据）也能读出 sub", () => {
    expect(parseSub(JSON.stringify({ levelId: "l2", sub: 4 }))).toBe(4);
  });

  it("非正数 / 小数被规范化", () => {
    expect(parseSub(JSON.stringify({ sub: 0 }))).toBe(1);
    expect(parseSub(JSON.stringify({ sub: 3.7 }))).toBe(3);
  });
});

describe("阶梯下标与等级 id 往返", () => {  it("toPosition / fromPosition 互为逆运算", () => {
    const position = toPosition(RUNGS, "l2", 6);
    expect(position).toEqual({ index: 1, sub: 6 });
    expect(fromPosition(RUNGS, position)).toEqual({ levelId: "l2", sub: 6 });
  });

  it("等级 id 不存在时回落到首阶", () => {
    expect(toPosition(RUNGS, "missing", 5)).toEqual({ index: 0, sub: 5 });
  });
});
