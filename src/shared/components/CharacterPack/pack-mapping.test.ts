import { describe, expect, it } from "vitest";
import { evaluateMappings, mappingRateText, type MappingHit } from "./pack-mapping";
import type { PackMappingRule } from "./types";

/** 快捷构造：id 缺省时按 source->target 合成（与默认 idOf 同口径） */
function rule(source: string, target: string, rate: number): PackMappingRule {
  return { sourceAttrId: source, targetAttrId: target, rate };
}

function evaluate(
  attrOrder: string[],
  base: Record<string, number>,
  mappings: PackMappingRule[],
  sortOrderOf?: (m: PackMappingRule) => number,
) {
  return evaluateMappings({
    attrOrder,
    baseFinal: new Map(Object.entries(base)),
    mappings,
    sortOrderOf,
  });
}

const HIT_KEY = (hit: MappingHit) =>
  `${hit.mappingId}:${hit.sourceAttrId}x${hit.rate}=${hit.applied}(源${hit.sourceValue})`;

describe("evaluateMappings —— 基本换算", () => {
  it("每 1 点力量 → 生命 +100（PRD 里的经典例子）", () => {
    const out = evaluate(["str", "hp"], { str: 10, hp: 1000 }, [rule("str", "hp", 100)]);
    expect(out.addMapped.get("hp")).toBe(1000);
    expect(out.problems.size).toBe(0);
    expect(out.hits.get("hp")).toHaveLength(1);
    expect(out.hits.get("hp")![0]).toEqual({
      mappingId: "str->hp",
      sourceAttrId: "str",
      rate: 100,
      sourceValue: 10,
      applied: 1000,
    });
  });

  it("支持小数系数，且按 round4 收口（0.3333 不会漂成 0.33330000000000004）", () => {
    const out = evaluate(["agi", "crit"], { agi: 3, crit: 5 }, [rule("agi", "crit", 0.3333)]);
    expect(out.addMapped.get("crit")).toBe(0.9999);
    expect(out.hits.get("crit")![0]).toMatchObject({ applied: 0.9999, sourceValue: 3 });
  });

  it("源属性的值是 0 时照样产出一条 applied=0 的明细（证明「算过了，只是没量」）", () => {
    const out = evaluate(["str", "hp"], { str: 0, hp: 1000 }, [rule("str", "hp", 100)]);
    expect(out.addMapped.get("hp")).toBe(0);
    expect(out.hits.get("hp")).toMatchObject([{ applied: 0, sourceValue: 0 }]);
  });

  it("同一目标属性可被多条映射叠加", () => {
    const out = evaluate(["str", "agi", "atk"], { str: 10, agi: 4, atk: 0 }, [
      rule("str", "atk", 2),
      rule("agi", "atk", 5),
    ]);
    expect(out.addMapped.get("atk")).toBe(40);
    expect(out.hits.get("atk")).toHaveLength(2);
  });

  it("没有映射时返回空表（不产生副作用）", () => {
    const out = evaluate(["str", "hp"], { str: 10, hp: 100 }, []);
    expect(out.addMapped.size).toBe(0);
    expect(out.hits.size).toBe(0);
    expect(out.problems.size).toBe(0);
  });
});

describe("evaluateMappings —— 链式依赖（力量 → 攻击 → 战力）", () => {
  it("下游读到的是上游换算**之后**的值，不是基础值", () => {
    // 力量 10 → 攻击 +20（rate 2），攻击基础 100 → 最终 120 → 战力 +1200（rate 10）
    const out = evaluate(["str", "atk", "power"], { str: 10, atk: 100, power: 0 }, [
      rule("str", "atk", 2),
      rule("atk", "power", 10),
    ]);
    expect(out.addMapped.get("atk")).toBe(20);
    expect(out.hits.get("power")![0].sourceValue).toBe(120); // 100 基础 + 20 换算
    expect(out.addMapped.get("power")).toBe(1200);
  });

  it("三层链：中间属性的换算量层层传递", () => {
    const out = evaluate(["a", "b", "c", "d"], { a: 1, b: 0, c: 0, d: 0 }, [
      rule("a", "b", 3),
      rule("b", "c", 4),
      rule("c", "d", 5),
    ]);
    expect(out.addMapped.get("b")).toBe(3);
    expect(out.addMapped.get("c")).toBe(12);
    expect(out.addMapped.get("d")).toBe(60);
  });

  it("逆序书写映射不影响结果（求值顺序由依赖决定，不是数组顺序）", () => {
    const forward = evaluate(["str", "atk", "power"], { str: 10, atk: 100, power: 0 }, [
      rule("str", "atk", 2),
      rule("atk", "power", 10),
    ]);
    const backward = evaluate(["str", "atk", "power"], { str: 10, atk: 100, power: 0 }, [
      rule("atk", "power", 10),
      rule("str", "atk", 2),
    ]);
    expect([...backward.addMapped]).toEqual([...forward.addMapped]);
  });

  it("attrOrder 顺序变化不改变结果（同层加法可交换）", () => {
    const one = evaluate(["str", "agi", "atk"], { str: 10, agi: 4, atk: 0 }, [
      rule("str", "atk", 2),
      rule("agi", "atk", 5),
    ]);
    const two = evaluate(["agi", "atk", "str"], { str: 10, agi: 4, atk: 0 }, [
      rule("str", "atk", 2),
      rule("agi", "atk", 5),
    ]);
    expect(two.addMapped.get("atk")).toBe(one.addMapped.get("atk"));
  });
});

describe("evaluateMappings —— 结构不成立的映射", () => {
  it("自指（源 == 目标）判 self，且不参与换算", () => {
    const out = evaluate(["str", "hp"], { str: 10, hp: 100 }, [rule("str", "str", 2)]);
    expect(out.problems.get("str->str")).toBe("self");
    expect(out.addMapped.size).toBe(0);
  });

  it("源属性已被删除（历史脏数据）判 missing", () => {
    const out = evaluate(["hp"], { hp: 100 }, [rule("gone", "hp", 100)]);
    expect(out.problems.get("gone->hp")).toBe("missing");
    expect(out.addMapped.size).toBe(0);
  });

  it("目标属性已被删除同样判 missing", () => {
    const out = evaluate(["str"], { str: 10 }, [rule("str", "gone", 100)]);
    expect(out.problems.get("str->gone")).toBe("missing");
  });

  it("系数为 0 视同关闭：既不生效也不报问题（用户是主动关掉的，不是配错了）", () => {
    const out = evaluate(["str", "hp"], { str: 10, hp: 100 }, [rule("str", "hp", 0)]);
    expect(out.addMapped.size).toBe(0);
    expect(out.problems.size).toBe(0);
  });

  it("结构问题与正常换算可以共存，互不影响", () => {
    const out = evaluate(["str", "hp", "mp"], { str: 10, hp: 100, mp: 0 }, [
      rule("str", "hp", 100), // 正常
      rule("mp", "mp", 1), // self
      rule("ghost", "mp", 1), // missing
    ]);
    expect(out.addMapped.get("hp")).toBe(1000);
    expect(out.problems.get("mp->mp")).toBe("self");
    expect(out.problems.get("ghost->mp")).toBe("missing");
  });
});

describe("evaluateMappings —— 成环（不猜，整组丢弃并上报）", () => {
  it("二元环：两条映射都判 cycle，属性保持不含映射的值", () => {
    const out = evaluate(["str", "hp"], { str: 10, hp: 100 }, [
      rule("str", "hp", 100),
      rule("hp", "str", 0.5),
    ]);
    expect(out.problems.get("str->hp")).toBe("cycle");
    expect(out.problems.get("hp->str")).toBe("cycle");
    expect(out.addMapped.size).toBe(0);
    expect(out.hits.size).toBe(0);
  });

  it("三元环同样被识别", () => {
    const out = evaluate(["a", "b", "c"], { a: 1, b: 1, c: 1 }, [
      rule("a", "b", 1),
      rule("b", "c", 1),
      rule("c", "a", 1),
    ]);
    expect(out.problems.get("a->b")).toBe("cycle");
    expect(out.problems.get("b->c")).toBe("cycle");
    expect(out.problems.get("c->a")).toBe("cycle");
  });

  it("环的下游报 blocked（不是 cycle）：算不出的中间量不能拿去污染别的属性", () => {
    // a ↔ b 成环，b → c 是环的下游
    const out = evaluate(["a", "b", "c"], { a: 1, b: 1, c: 0 }, [
      rule("a", "b", 1),
      rule("b", "a", 1),
      rule("b", "c", 10), // 下游：目标 c 被环挡住
    ]);
    expect(out.problems.get("a->b")).toBe("cycle");
    expect(out.problems.get("b->a")).toBe("cycle");
    expect(out.problems.get("b->c")).toBe("blocked");
    expect(out.addMapped.size).toBe(0);
    expect(out.hits.size).toBe(0);
  });

  it("整条下游链都被识别为 blocked（层层剥离到出口）", () => {
    const out = evaluate(["a", "b", "c", "d"], { a: 1, b: 1, c: 0, d: 0 }, [
      rule("a", "b", 1),
      rule("b", "a", 1),
      rule("b", "c", 1),
      rule("c", "d", 1),
    ]);
    expect(out.problems.get("b->c")).toBe("blocked");
    expect(out.problems.get("c->d")).toBe("blocked");
  });

  it("判据看目标属性：源在环外但目标是环上 → cycle", () => {
    // x → a，而 a 在 a↔b 环里；x 自己排得到，但 a 的值不可用
    const out = evaluate(["x", "a", "b"], { x: 5, a: 1, b: 1 }, [
      rule("a", "b", 1),
      rule("b", "a", 1),
      rule("x", "a", 3),
    ]);
    expect(out.problems.get("x->a")).toBe("cycle"); // 目标是环本身
    expect(out.addMapped.size).toBe(0);
  });

  it("源在环上但目标是环外（下游）→ blocked", () => {
    // a ↔ b 成环，a → c 里的 c 不在环上
    const out = evaluate(["a", "b", "c"], { a: 1, b: 1, c: 0 }, [
      rule("a", "b", 1),
      rule("b", "a", 1),
      rule("a", "c", 4),
    ]);
    expect(out.problems.get("a->c")).toBe("blocked");
  });

  it("环之外的独立映射不受牵连（各自结算）", () => {
    const out = evaluate(["a", "b", "x", "y"], { a: 1, b: 1, x: 10, y: 0 }, [
      rule("a", "b", 1),
      rule("b", "a", 1),
      rule("x", "y", 3),
    ]);
    expect(out.addMapped.get("y")).toBe(30);
    expect(out.hits.get("y")).toHaveLength(1);
    expect(out.problems.get("a->b")).toBe("cycle");
    expect(out.problems.has("x->y")).toBe(false);
  });
});

describe("evaluateMappings —— id 与排序口径", () => {
  it("自带 id 时用自带 id 报问题", () => {
    const out = evaluateMappings({
      attrOrder: ["a"],
      baseFinal: new Map([["a", 1]]),
      mappings: [
        { id: "m-7", sourceAttrId: "a", targetAttrId: "a", rate: 1 } as PackMappingRule & {
          id: string;
        },
      ],
      idOf: (m) => (m as PackMappingRule & { id: string }).id,
    });
    expect(out.problems.get("m-7")).toBe("self");
  });

  it("同一对 (源, 目标) 的多条按 sortOrder 依次叠加，顺序稳定", () => {
    const a = rule("str", "hp", 2);
    const b = rule("str", "hp", 3);
    const order = new Map<PackMappingRule, number>([
      [a, 1],
      [b, 2],
    ]);
    const out = evaluate(["str", "hp"], { str: 10, hp: 0 }, [a, b], (m) => order.get(m) ?? 0);
    expect(out.addMapped.get("hp")).toBe(50);
    expect(out.hits.get("hp")!.map(HIT_KEY)).toEqual([
      "str->hp:strx2=20(源10)",
      "str->hp:strx3=30(源10)",
    ]);
  });

  it("明细按目标属性归组，且带上真实源值（供「来源明细」逐条展示）", () => {
    const out = evaluate(["str", "agi", "atk"], { str: 10, agi: 4, atk: 0 }, [
      rule("str", "atk", 2),
      rule("agi", "atk", 5),
    ]);
    expect(out.hits.get("atk")!.map(HIT_KEY)).toEqual([
      "str->atk:strx2=20(源10)",
      "agi->atk:agix5=20(源4)",
    ]);
    expect(out.hits.has("str")).toBe(false);
  });
});

describe("mappingRateText", () => {
  it("整数系数不带小数点", () => {
    expect(mappingRateText(100)).toBe("×100");
  });

  it("小数系数去掉尾随零", () => {
    expect(mappingRateText(0.5)).toBe("×0.5");
    expect(mappingRateText(2.5)).toBe("×2.5");
  });

  it("浮点毛刺被 round4 收口", () => {
    expect(mappingRateText(0.30000000000000004)).toBe("×0.3");
    expect(mappingRateText(0.3333)).toBe("×0.3333");
  });
});
