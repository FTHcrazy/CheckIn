import { describe, expect, it } from "vitest";
import {
  LEVEL_COUNT_RANGE,
  MAX_LEVEL_CANDIDATES,
  buildLevelCandidates,
  countLevelPicks,
  normalizeLevelName,
  pickedLevelNames,
  type LevelCandidate,
} from "./level-gen";
import { clampLevelCount } from "@/shared/ai/context/prompt/level-gen";

/**
 * 等级体系候选构造的契约（R-AI-18）
 *
 * 钉的是「AI 给的一列文字 → 能安全追加进作者阶梯的那几条」：
 * 归一错了会建出怪名字，重名没挡住会出现两行同名等级（角色卡指向哪一个说不清），
 * 顺序被本地重排会替作者猜高低。这三件事都不会崩，只是把脏数据留在库里。
 */

const gen = (entries: unknown[], existing: string[] = [], mode: "generate" | "extend" = "generate") =>
  buildLevelCandidates(entries, { existing, mode });

describe("等级名归一", () => {
  it("剥掉模型爱加的序号前缀（数字 / 括号 / 圈号 / 第N级）", () => {
    expect(normalizeLevelName("1. 练气")).toBe("练气");
    expect(normalizeLevelName("2、筑基")).toBe("筑基");
    expect(normalizeLevelName("（3）金丹")).toBe("金丹");
    expect(normalizeLevelName("①元婴")).toBe("元婴");
    expect(normalizeLevelName("第三级 化神")).toBe("化神");
    expect(normalizeLevelName("1.2. 练气")).toBe("练气");
  });

  it("不误伤本身带数字的名字（「三层」「九品」是名字不是序号）", () => {
    expect(normalizeLevelName("三层")).toBe("三层");
    expect(normalizeLevelName("九品")).toBe("九品");
    expect(normalizeLevelName("一品金丹")).toBe("一品金丹");
  });

  it("剥包裹符号与尾部标点，但不改动名字本体", () => {
    expect(normalizeLevelName("《练气》")).toBe("练气");
    expect(normalizeLevelName("「练气」")).toBe("练气");
    expect(normalizeLevelName("练气。")).toBe("练气");
    expect(normalizeLevelName("  练气  ")).toBe("练气");
  });
});

describe("候选构造", () => {
  it("保留模型给的阶梯序，序号接着现有最高一级往下排", () => {
    const picks = gen(
      [{ name: "筑基" }, { name: "金丹" }, { name: "元婴" }],
      ["练气"],
      "extend",
    );
    expect(picks.map((item) => item.name)).toEqual(["筑基", "金丹", "元婴"]);
    expect(picks.map((item) => item.sequence)).toEqual([2, 3, 4]);
  });

  it("生成模式从第 1 级开始编号（现有为空）", () => {
    const picks = gen([{ name: "练气" }, { name: "筑基" }]);
    expect(picks.map((item) => item.sequence)).toEqual([1, 2]);
  });

  it("与已有阶梯重名的标 duplicate 且默认不勾，其余默认勾上", () => {
    const picks = gen([{ name: "筑基" }, { name: "金丹" }], ["筑基"]);
    const [dup, fresh] = picks;
    expect(dup.duplicate).toBe(true);
    expect(dup.selected).toBe(false);
    expect(fresh.duplicate).toBe(false);
    expect(fresh.selected).toBe(true);
  });

  it("重名判定先归一：已有「练气」时，「1. 练气 」同样算重名", () => {
    const picks = gen([{ name: "1. 练气 " }], ["练气"]);
    expect(picks[0].duplicate).toBe(true);
    expect(picks[0].name).toBe("练气");
  });

  it("列表内同名只留一条（模型同一级写两次很常见）", () => {
    const picks = gen([{ name: "练气" }, { name: "1. 练气" }, { name: "筑基" }]);
    expect(picks.map((item) => item.name)).toEqual(["练气", "筑基"]);
  });

  it("丢掉 1 字残片与超长解释（那不是等级名）", () => {
    const picks = gen([
      { name: "气" },
      { name: "半步大罗金仙境之上者" },
      { name: "金丹" },
    ]);
    expect(picks.map((item) => item.name)).toEqual(["金丹"]);
  });

  it("条数受 limit 与上限夹取（派生兜底产出几十条时不至于塞爆面板）", () => {
    const many = Array.from({ length: 40 }, (_, index) => ({ name: `第${index + 1}重天` }));
    expect(gen(many, [], "generate").length).toBe(MAX_LEVEL_CANDIDATES);
    expect(
      buildLevelCandidates(many, {
        existing: [],
        mode: "generate",
        limit: 5,
      }).length,
    ).toBe(5);
  });

  it("note 取不到就给空串，取到就截到 40 字（只展示，不落库）", () => {
    const picks = gen([
      { name: "练气", note: "刚引气入体" },
      { name: "筑基", note: "很".repeat(80) },
      { name: "金丹" },
    ]);
    expect(picks[0].note).toBe("刚引气入体");
    expect(picks[1].note.length).toBe(40);
    expect(picks[2].note).toBe("");
  });

  it("字段名漂移也能取到（name/level/title，note/summary/desc）", () => {
    const picks = gen([{ level: "练气", summary: "入门" }, { title: "筑基", desc: "小成" }]);
    expect(picks.map((item) => item.name)).toEqual(["练气", "筑基"]);
    expect(picks.map((item) => item.note)).toEqual(["入门", "小成"]);
  });

  it("非法条目一律跳过，不抛错", () => {
    const picks = buildLevelCandidates(
      [null, undefined, 42, "练气", [], { name: 123 }, { name: "金丹" }],
      { existing: [], mode: "generate" },
    );
    expect(picks.map((item) => item.name)).toEqual(["金丹"]);
  });

  it("空输入给空数组（「分类名不是有序体系」时模型就该给空）", () => {
    expect(gen([])).toEqual([]);
  });
});

describe("写入范围", () => {
  const candidates: LevelCandidate[] = [
    { key: "练气", name: "练气", note: "", sequence: 2, selected: true, duplicate: false },
    { key: "筑基", name: "筑基", note: "", sequence: 3, selected: false, duplicate: false },
    { key: "金丹", name: "金丹", note: "", sequence: 4, selected: true, duplicate: true },
  ];

  it("只算「勾选且不重名」的条数", () => {
    expect(countLevelPicks(candidates)).toBe(1);
  });

  it("写入名保序，且不含未勾选与重名项", () => {
    expect(pickedLevelNames(candidates)).toEqual(["练气"]);
    const allPicked = candidates.map((item) => ({ ...item, selected: true }));
    expect(pickedLevelNames(allPicked)).toEqual(["练气", "筑基"]);
  });
});

describe("与提示词侧的口径一致", () => {
  /**
   * 两处各有一份条数区间：`LEVEL_COUNT_RANGE`（面板夹取）与
   * `clampLevelCount`（提示词夹取）。漂移的表现是「面板写着 12 条，
   * 模板让模型给 9 条」——用户看到条数不符却找不到原因，所以钉死采样点。
   *
   * ⚠️ `0` / 非数字 的语义是「未填」→ 回落默认值，**不是**夹到下限：
   * 面板里清空输入框得到的就是 0，此时应回到「默认 9 级」而不是「最少 3 级」。
   */
  it("面板区间与 clampLevelCount 对同一输入的夹取结果相同", () => {
    for (const mode of ["generate", "extend"] as const) {
      const { min, max, fallback } = LEVEL_COUNT_RANGE[mode];
      for (const sample of [0, 1, 3, 5, 9, 12, 20, 40]) {
        const clamped = clampLevelCount(mode, sample);
        const expected = sample > 0 ? Math.min(max, Math.max(min, sample)) : fallback;
        expect(clamped).toBe(expected);
      }
    }
  });

  it("缺省条数一致（面板不填时与模板默认值相同）", () => {
    expect(clampLevelCount("generate", undefined)).toBe(LEVEL_COUNT_RANGE.generate.fallback);
    expect(clampLevelCount("extend", undefined)).toBe(LEVEL_COUNT_RANGE.extend.fallback);
  });
});
