/**
 * 全局设定中心 · **独立对抗性验证**（QA / P1-1 纯函数边界）
 *
 * 覆盖实现者测试未触达的**边界与脏串**面：
 * - `toChineseOrdinal` / `formatNumberedLabel`：进位、零压缩、万级、越界回落；
 * - `formatSubLevel`：固定名单越界、`{n}` 模板、纯文本补号、空模板、index 0 / 负数；
 * - `listSubLevels`：cap 夹取、subLevels<=1、非法值；
 * - rank 重排纯函数在「rank 有空洞」的旧数据上是否会错位（与主进程同口径的镜像算法）。
 *
 * 这是纯函数层，不碰 better-sqlite3，可在 vitest 直接跑。
 */
import { describe, expect, it } from "vitest";
import {
  insertLevel,
  listSubLevels,
  rootLevels,
  effectiveSubPattern,
  countSubLevels,
  normalizeRanks,
  moveLevel,
  removeLevels,
  formatBoundRealmName,
  parseRealmNoteSub,
  previewSplit,
  SUB_PATTERN_TOKEN,
  formatSubLevel,
} from "@/shared/novel/setting-utils";
import {
  formatNumberedLabel,
  toChineseOrdinal,
} from "@/shared/novel/number-label";
import { formatReferenceCountLabel } from "@/shared/novel/setting-reference";
import type { SettingCategory, SettingLevel } from "@/shared/novel/setting-types";

const level = (over: Partial<SettingLevel>): SettingLevel => ({
  id: "l1",
  categoryId: "c1",
  name: "筑基",
  rank: 1,
  aliases: [],
  note: "",
  subLevels: 1,
  subPattern: "",
  power: null,
  parentId: null,
  segFrom: null,
  segTo: null,
  ...over,
});

const category = (over: Partial<SettingCategory>): SettingCategory => ({
  id: "c1",
  workId: "w1",
  name: "境界",
  color: "#5B8DEF",
  kind: "realm",
  sortOrder: 1,
  note: "",
  subLevels: 1,
  carryDir: "asc",
  subPattern: "",
  levels: [],
  ...over,
});

describe("toChineseOrdinal：进位 / 零压缩 / 万级 / 越界", () => {
  const cases: Array<[number, string]> = [
    [1, "一"],
    [9, "九"],
    [10, "十"],
    [11, "十一"],
    [12, "十二"],
    [19, "十九"],
    [20, "二十"],
    [21, "二十一"],
    [99, "九十九"],
    [100, "一百"],
    [101, "一百零一"],
    [110, "一百一十"],
    [1000, "一千"],
    [1001, "一千零一"],
    [10001, "一万零一"],
    [10500, "一万零五百"],
  ];
  for (const [n, text] of cases) {
    it(`${n} → ${text}`, () => {
      expect(toChineseOrdinal(n)).toBe(text);
    });
  }

  it("超出常规序号范围回退阿拉伯数字（>= 1e8）", () => {
    expect(toChineseOrdinal(100_000_000)).toBe("100000000");
  });

  it("下界夹取：0 / 负数都回落到「一」，不产出「零」「负」", () => {
    expect(toChineseOrdinal(0)).toBe("一");
    expect(toChineseOrdinal(-7)).toBe("一");
  });

  it("formatNumberedLabel：样式与后缀自由组合（空后缀退化为纯序号）", () => {
    expect(formatNumberedLabel("chinese", "章", 12)).toBe("第十二章");
    expect(formatNumberedLabel("arabic", "章", 12)).toBe("第12章");
    expect(formatNumberedLabel("chinese", "", 7)).toBe("第七");
    expect(formatNumberedLabel("arabic", "", 7)).toBe("第7");
  });
});

describe("formatSubLevel：三类模板 + 越界/空值/脏 index", () => {
  it("{n} 模板：阿拉伯（默认）与中文两种样式", () => {
    expect(formatSubLevel("第{n}层", 7)).toBe("第7层");
    expect(formatSubLevel("第{n}层", 7, "chinese")).toBe("第七层");
  });

  it("多占位 {n} 模板：全部替换，且与 previewSplit 同模板同结果（两处口径一致）", () => {
    // P2-3 已修：`formatSubLevel` 改用 /\{n\}/g 全局替换，与 previewSplit 同口径。
    // 断言从「记录旧单点行为」升级为「正向多占位 + 跨函数一致性」——
    // 后者才是真正要守住的契约：同一个模板在「正文渲染」与「拆分预览」两处
    // 必须逐字相同，否则作者会看到预览与落实后的名字对不上。
    expect(formatSubLevel("{n}层（第{n}阶）", 3)).toBe("3层（第3阶）");
    expect(formatSubLevel("{n}层（第{n}阶）", 3, "chinese")).toBe("三层（第三阶）");

    // 把「两处一致」钉死：同一多占位模板，逐段比对两函数结果
    const pattern = "{n}段·第{n}阶";
    const segments = previewSplit(level({ id: "r1", name: "筑基" }), 2, 4, pattern);
    expect(segments).toHaveLength(2);
    expect(segments[0].name).toBe(formatSubLevel(pattern, 1));
    expect(segments[1].name).toBe(formatSubLevel(pattern, 2));
    expect(segments[0].name).toBe("1段·第1阶");
    expect(segments[1].name).toBe("2段·第2阶");

    // {name} 分支同样全局替换 {n}（previewSplit 另一条支路）
    const named = previewSplit(level({ name: "筑基" }), 2, 4, "{name}·{n}/{n}");
    expect(named[0].name).toBe("筑基·1/1");
    expect(named[1].name).toBe("筑基·2/2");
  });

  it("固定名单：按序取名，越界回落「第 n 层」而不是 undefined", () => {
    const pattern = "初期,中期,后期,圆满";
    expect(formatSubLevel(pattern, 1)).toBe("初期");
    expect(formatSubLevel(pattern, 4)).toBe("圆满");
    // 越界：名单不够长时回落编号（绝不渲染 undefined / 空串）
    expect(formatSubLevel(pattern, 5)).toBe("第5层");
    expect(formatSubLevel(pattern, 5)).not.toContain("undefined");
  });

  it("固定名单：顿号 / 中文逗号 / 英文逗号都识别为名单", () => {
    expect(formatSubLevel("初期、中期、后期", 2)).toBe("中期");
    expect(formatSubLevel("初期，中期，后期", 3)).toBe("后期");
  });

  it("空模板 / 空白模板：退化为「第 n 层」", () => {
    expect(formatSubLevel("", 3)).toBe("第3层");
    expect(formatSubLevel("   ", 3)).toBe("第3层");
  });

  it("纯文本模板：补层号后缀（避免多个同名小层）", () => {
    expect(formatSubLevel("层", 2)).toBe("层2");
  });

  it("脏 index（0 / 负数）不抛异常、不产出 undefined（调用方负责夹取）", () => {
    for (const bad of [0, -1, -100]) {
      const out = formatSubLevel("初期,中期", bad);
      expect(typeof out).toBe("string");
      expect(out).not.toContain("undefined");
    }
  });
});

describe("listSubLevels：cap 夹取与非法 subLevels", () => {
  const c = category({ subPattern: "第{n}层" });

  it("正常展开：subLevels 层、唯一口径生成名字", () => {
    expect(listSubLevels(level({ subLevels: 3 }), c)).toEqual([
      "第1层",
      "第2层",
      "第3层",
    ]);
  });

  it("cap 夹取上限：超过 cap 只渲染 cap 个", () => {
    expect(listSubLevels(level({ subLevels: 50 }), c, 4)).toEqual([
      "第1层",
      "第2层",
      "第3层",
      "第4层",
    ]);
  });

  it("subLevels <= 1 / 0 / 负数：至少渲染 1 个（绝不会空数组）", () => {
    expect(listSubLevels(level({ subLevels: 1 }), c).length).toBe(1);
    expect(listSubLevels(level({ subLevels: 0 }), c).length).toBe(1);
    expect(listSubLevels(level({ subLevels: -5 }), c).length).toBe(1);
  });

  it("有本阶模板时优先用本阶（effectiveSubPattern 唯一读取口）", () => {
    const own = level({ subLevels: 2, subPattern: "{n}品" });
    expect(effectiveSubPattern(own, c)).toBe("{n}品");
    expect(listSubLevels(own, c)).toEqual(["1品", "2品"]);
    // 本阶空白 ⇒ 沿用分类
    expect(effectiveSubPattern(level({ subPattern: "  " }), c)).toBe("第{n}层");
  });
});

describe("rank 重排纯函数：rank 有空洞的旧数据不越界（与主进程同口径）", () => {
  it("末尾插入用 max(rank)+1，不是 行数+1（洞：1,2,5 → 插到 6 而不是 4）", () => {
    const levels = [
      level({ id: "a", rank: 1 }),
      level({ id: "b", rank: 2 }),
      level({ id: "c", rank: 5 }),
    ];
    const next = insertLevel(levels, 3, level({ id: "d", name: "新阶" }));
    const d = next.find((item) => item.id === "d")!;
    // 旧写法「长度 + 1 = 4」会把新行插到金丹（rank 5）之前 —— 正是「末尾插入无效」
    expect(d.rank).toBe(6);
    // 既有行的相对顺序不被破坏（洞仍在，落库由主进程按行序换算 rank）
    expect(next.find((item) => item.id === "c")!.rank).toBe(5);
    expect(next.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("中间插入落点 = 目标行 rank（洞场景下目标 rank 可能是 5 而非 3）", () => {
    const levels = [
      level({ id: "a", rank: 1 }),
      level({ id: "b", rank: 2 }),
      level({ id: "c", rank: 5 }),
    ];
    const next = insertLevel(levels, 2, level({ id: "d", name: "新阶" }));
    const d = next.find((item) => item.id === "d")!;
    expect(d.rank).toBe(5);
  });

  it("normalizeRanks 压实成 1..n", () => {
    const next = normalizeRanks([
      level({ id: "a", rank: 1 }),
      level({ id: "b", rank: 7 }),
      level({ id: "c", rank: 9 }),
    ]);
    expect(next.map((item) => item.rank)).toEqual([1, 2, 3]);
  });

  it("removeLevels 删掉一批后前移补位（连续序号）", () => {
    const next = removeLevels(
      [
        level({ id: "a", rank: 1 }),
        level({ id: "b", rank: 2 }),
        level({ id: "c", rank: 3 }),
      ],
      ["a", "c"],
    );
    expect(next).toHaveLength(1);
    expect(next[0].rank).toBe(1);
  });

  it("moveLevel 抽出插入并重排为连续 rank", () => {
    const next = moveLevel(
      [
        level({ id: "a", rank: 1 }),
        level({ id: "b", rank: 2 }),
        level({ id: "c", rank: 3 }),
      ],
      "a",
      2,
    );
    expect(next.map((item) => item.id)).toEqual(["b", "c", "a"]);
    expect(next.map((item) => item.rank)).toEqual([1, 2, 3]);
  });
});

describe("rootLevels / countSubLevels：派生段不当作独立阶、不重复计数", () => {
  it("rootLevels 只取根阶并按方向排序", () => {
    const levels = [
      level({ id: "a", rank: 1 }),
      level({ id: "a__seg1", rank: 2, parentId: "a" }),
      level({ id: "b", rank: 3 }),
    ];
    expect(rootLevels(levels, "asc").map((item) => item.id)).toEqual(["a", "b"]);
    expect(rootLevels(levels, "desc").map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("countSubLevels：父阶 + 派生段取最大 segTo，拆一次不翻倍", () => {
    const levels = [
      level({ id: "a", subLevels: 9 }),
      level({ id: "a__s1", parentId: "a", segTo: 4, subLevels: 4 }),
      level({ id: "a__s2", parentId: "a", segTo: 9, subLevels: 5 }),
    ];
    expect(countSubLevels(levels)).toBe(9);
  });
});

describe("绑定读数辅助：parseRealmNoteSub / formatBoundRealmName 脏输入兜底", () => {
  it("note 非 JSON / 缺 sub / sub<1 都回落到 1", () => {
    expect(parseRealmNoteSub(null)).toBe(1);
    expect(parseRealmNoteSub("")).toBe(1);
    expect(parseRealmNoteSub("not-json")).toBe(1);
    expect(parseRealmNoteSub("{}")).toBe(1);
    expect(parseRealmNoteSub('{"sub":0}')).toBe(1);
    expect(parseRealmNoteSub('{"sub":-3}')).toBe(1);
    expect(parseRealmNoteSub('{"sub":7}')).toBe(7);
    expect(parseRealmNoteSub('{"sub":"7"}')).toBe(7);
  });

  it("formatBoundRealmName：id 不在序列返回空串（不抛）", () => {
    const levels = [level({ id: "a", name: "练气" })];
    expect(formatBoundRealmName(levels, null)).toBe("");
    expect(formatBoundRealmName(levels, "ghost")).toBe("");
    expect(formatBoundRealmName(levels, "a")).toBe("练气");
  });
});

describe("引用文案常量（不脱离 spec）", () => {
  it("formatReferenceCountLabel：0/负 → 暂无引用，正数 → N 部书引用", () => {
    expect(formatReferenceCountLabel(0)).toBe("暂无引用");
    expect(formatReferenceCountLabel(-3)).toBe("暂无引用");
    expect(formatReferenceCountLabel(3)).toBe("3 部书引用");
    expect(formatReferenceCountLabel(2.9)).toBe("2 部书引用");
  });

  it("SUB_PATTERN_TOKEN 是唯一占位符字面量", () => {
    expect(SUB_PATTERN_TOKEN).toBe("{n}");
  });
});
