import { describe, expect, it } from "vitest";
import type { SettingCategory, SettingLevel } from "../types";
import {
  applyMerge,
  applySplit,
  buildBatchNames,
  buildCarryExample,
  effectiveSubPattern,
  findRealmPosition,
  formatBoundRealmName,
  formatSubLevel,
  insertLevel,
  listSubLevels,
  countSubLevels,
  moveLevel,
  parseRealmNoteSub,
  previewSplit,
  removeLevels,
  rootLevels,
  sortLevels,
} from "./setting-utils";

function level(
  id: string,
  rank: number,
  extra: Partial<SettingLevel> = {},
): SettingLevel {
  return {
    id,
    categoryId: "c1",
    name: id,
    rank,
    aliases: [],
    note: "",
    subLevels: 9,
    subPattern: "",
    power: null,
    parentId: null,
    segFrom: null,
    segTo: null,
    ...extra,
  };
}

function category(levels: SettingLevel[], extra: Partial<SettingCategory> = {}): SettingCategory {
  return {
    id: "c1",
    workId: "w1",
    name: "境界体系",
    color: "#5B8DEF",
    kind: "realm",
    sortOrder: 1,
    note: "",
    subLevels: 9,
    carryDir: "asc",
    subPattern: "第{n}层",
    levels,
    ...extra,
  };
}

const ladder = [level("引气", 1), level("筑基", 2), level("金丹", 3)];

describe("设定：小层命名与进位示例", () => {
  it("模板里的 {n} 换成层号", () => {
    expect(formatSubLevel("第{n}层", 3)).toBe("第3层");
    expect(formatSubLevel("{n}品", 1)).toBe("1品");
  });

  it("模板不含占位符时补层号后缀，避免多个小层同名", () => {
    expect(formatSubLevel("层", 2)).toBe("层2");
  });

  it("固定名单按序取名（顿号/中英文逗号都认）—— 初期/中期/后期/圆满不是 {n} 能表达的", () => {
    expect(formatSubLevel("初期,中期,后期,圆满", 1)).toBe("初期");
    expect(formatSubLevel("初期,中期,后期,圆满", 4)).toBe("圆满");
    expect(formatSubLevel("初期、中期、后期、圆满", 2)).toBe("中期");
    expect(formatSubLevel("初期，中期，后期，圆满", 3)).toBe("后期");
  });

  it("固定名单不够长时回退层号，绝不渲染出同名的两个小层", () => {
    expect(formatSubLevel("初期,中期", 3)).toBe("第3层");
    expect(formatSubLevel("初期,中期", 9)).toBe("第9层");
  });

  it("进位示例演示满层进位到下一阶", () => {
    expect(buildCarryExample(category(ladder))).toBe(
      "引气 第1层 → 引气 第9层 →（满层进位）→ 筑基 第1层",
    );
  });

  it("每阶小层数可以不同：示例按第一阶自己的层数演示满层", () => {
    const mixed = category([
      level("练气", 1, { subLevels: 13, subPattern: "第{n}层" }),
      level("筑基", 2, { subLevels: 4, subPattern: "初期,中期,后期,圆满" }),
    ]);
    expect(buildCarryExample(mixed)).toBe(
      "练气 第1层 → 练气 第13层 →（满层进位）→ 筑基 初期",
    );
  });

  it("effectiveSubPattern：本级为空沿用分类，本级非空覆盖分类", () => {
    const cat = category(ladder, { subPattern: "第{n}层" });
    expect(effectiveSubPattern(level("练气", 1), cat)).toBe("第{n}层");
    expect(
      effectiveSubPattern(level("筑基", 2, { subPattern: "初期,中期" }), cat),
    ).toBe("初期,中期");
  });

  it("listSubLevels 把一阶展开成真实的小境界清单 —— 练气九层必须看得到一~九层", () => {
    const cat = category(ladder, { subPattern: "第{n}层" });
    expect(listSubLevels(level("练气", 1, { subLevels: 9 }), cat)).toEqual([
      "第1层",
      "第2层",
      "第3层",
      "第4层",
      "第5层",
      "第6层",
      "第7层",
      "第8层",
      "第9层",
    ]);
  });

  it("listSubLevels 认本阶自己的命名模板（固定名单）与上限", () => {
    const cat = category(ladder, { subPattern: "第{n}层" });
    const root = level("筑基", 2, { subLevels: 4, subPattern: "初期,中期,后期,圆满" });
    expect(listSubLevels(root, cat)).toEqual(["初期", "中期", "后期", "圆满"]);
    // 超过 cap 时按 cap 截断，而不是把整份名单灌进 DOM
    expect(listSubLevels(level("练气", 1, { subLevels: 99 }), cat, 3)).toEqual([
      "第1层",
      "第2层",
      "第3层",
    ]);
  });

  it("countSubLevels 只算真正的阶，派生段不重复计数", () => {
    const cat = category([
      level("练气", 1, { subLevels: 9 }),
      level("筑基", 2, { subLevels: 4 }),
    ]);
    expect(countSubLevels(cat.levels)).toBe(13);

    // 旧模型拆分数据（父阶占第一段）：合计仍是 9，不允许被算成 9 + 4 + 5
    const split = category([
      level("练气", 1, { subLevels: 4, segFrom: 1, segTo: 4 }),
      level("练气 · 第2段", 2, {
        subLevels: 5,
        segFrom: 5,
        segTo: 9,
        parentId: "练气",
      }),
      level("筑基", 3, { subLevels: 4 }),
    ]);
    expect(countSubLevels(split.levels)).toBe(13);

    // 1.38.1 新模型：父阶是分组（不占段、持有整阶总数），段从 1 起
    const grouped = category([
      level("练气", 1, { subLevels: 9 }),
      level("练气 · 第1段", 2, { subLevels: 1, segFrom: 1, segTo: 1, parentId: "练气" }),
      level("练气 · 第2段", 3, { subLevels: 1, segFrom: 2, segTo: 2, parentId: "练气" }),
      level("筑基", 4, { subLevels: 4 }),
    ]);
    expect(countSubLevels(grouped.levels)).toBe(13);
  });

  it("批量生成按模板逐号渲染，纯文本补序号", () => {
    expect(buildBatchNames(3, "第{n}阶")).toEqual(["第1阶", "第2阶", "第3阶"]);
    expect(buildBatchNames(2, "练气第{n}层")).toEqual(["练气第1层", "练气第2层"]);
    expect(buildBatchNames(2, "阶")).toEqual(["阶1", "阶2"]);
  });

  it("批量生成夹取数量（0 → 1，超出 99 → 99）", () => {
    expect(buildBatchNames(0, "第{n}层")).toHaveLength(1);
    expect(buildBatchNames(500, "第{n}层")).toHaveLength(99);
    expect(buildBatchNames(Number.NaN, "第{n}层")).toHaveLength(1);
  });

  it("倒序分类的示例跟着反向 —— 否则与作者实际的进位方向相反", () => {
    const desc = category(
      [level("一品", 1), level("二品", 2, { subLevels: 3 })],
      {
        carryDir: "desc",
      },
    );
    expect(buildCarryExample(desc)).toBe(
      "二品 第1层 → 二品 第3层 →（满层进位）→ 一品 第1层",
    );
  });

  it("空分类给占位文案而不是崩", () => {
    expect(buildCarryExample(category([]))).toBe("尚无等级，新增后自动生成示例");
  });
});

describe("设定：排序只改展示不改 rank", () => {
  it("desc 时展示反向，但 rank 保持由低到高", () => {
    const ordered = sortLevels(ladder, "desc");
    expect(ordered.map((l) => l.name)).toEqual(["金丹", "筑基", "引气"]);
    expect(ordered.map((l) => l.rank)).toEqual([3, 2, 1]);
  });
});

describe("设定：插入 / 删除 / 移动的 rank 连续性", () => {
  it("插入把落点及之后的 rank 全部 +1", () => {
    const next = insertLevel(ladder, 1, level("元丹", 0));
    expect(next.map((l) => l.name)).toEqual(["引气", "元丹", "筑基", "金丹"]);
    expect(next.map((l) => l.rank)).toEqual([1, 2, 3, 4]);
  });

  it("插到最前时全部后移", () => {
    const next = insertLevel(ladder, 0, level("凡境", 0));
    expect(next.map((l) => l.name)).toEqual(["凡境", "引气", "筑基", "金丹"]);
  });

  it("落点越界时夹到末尾，不留空洞", () => {
    const next = insertLevel(ladder, 99, level("登仙", 0));
    expect(next.map((l) => l.rank)).toEqual([1, 2, 3, 4]);
    expect(next.at(-1)!.name).toBe("登仙");
  });

  it("rank 有空洞时「在末尾插入」仍落在最后一行 —— 落点按行序而非数组长度", () => {
    // 旧数据裁剪后常见形态：rank 是 1、2、5（max=5，行数=3）
    const holed = [level("引气", 1), level("筑基", 2), level("金丹", 5)];
    const next = insertLevel(holed, holed.length, level("登仙", 0));
    expect(next.map((l) => l.name)).toEqual(["引气", "筑基", "金丹", "登仙"]);
    expect(next.at(-1)!.rank).toBe(6);
  });

  it("rank 倒序残留时「在末尾插入」也不会插到行首", () => {
    // 历史数据里 rank 最大的行排在数组前面（未按 rank 排序的脏数据）
    const messy = [level("金丹", 3), level("引气", 1), level("筑基", 2)];
    const next = insertLevel(messy, messy.length, level("登仙", 0));
    expect(next.map((l) => l.name)).toEqual(["引气", "筑基", "金丹", "登仙"]);
  });

  it("中间插入按行序定位，与 rank 空洞无关", () => {
    const holed = [level("引气", 1), level("筑基", 2), level("金丹", 5)];
    const next = insertLevel(holed, 1, level("元丹", 0));
    expect(next.map((l) => l.name)).toEqual(["引气", "元丹", "筑基", "金丹"]);
    expect(next.map((l) => l.rank)).toEqual([1, 2, 3, 6]);
  });

  it("删除后后面的 rank 前移补位（不补会出现 1、2、4）", () => {
    const next = removeLevels(ladder, ["筑基"]);
    expect(next.map((l) => l.rank)).toEqual([1, 2]);
    expect(next.map((l) => l.name)).toEqual(["引气", "金丹"]);
  });

  it("移动与拖拽落点一一对应：抽出后按下标插回", () => {
    const next = moveLevel(ladder, "金丹", 0);
    expect(next.map((l) => l.name)).toEqual(["金丹", "引气", "筑基"]);
    expect(next.map((l) => l.rank)).toEqual([1, 2, 3]);
  });

  it("移动未知 id 时原样返回，不产生脏 rank", () => {
    expect(moveLevel(ladder, "不存在", 0)).toEqual(ladder);
  });
});

describe("设定：拆分与合并互为逆操作（1.38.1 父阶=分组）", () => {
  it("全部子层级从第 1 段起新建 —— 父阶是分组，不占用任何段", () => {
    const segments = previewSplit(level("金丹", 3), 2, 18);
    expect(segments[0]).toMatchObject({ id: "金丹__seg1", name: "金丹 · 第1段", segFrom: 1 });
    expect(segments[1].id).toBe("金丹__seg2");
  });

  it("分段覆盖完整小层区间，最后一段吃掉余数", () => {
    const segments = previewSplit(level("金丹", 3), 4, 18);
    expect(segments[0].segFrom).toBe(1);
    expect(segments.at(-1)!.segTo).toBe(18);
    const covered = segments.reduce((sum, s) => sum + (s.segTo - s.segFrom + 1), 0);
    expect(covered).toBe(18);
  });

  it("拆分后阶梯增长、rank 无空洞，派生段指回分组且分组不占段", () => {
    const segments = previewSplit(level("金丹", 3), 2, 18);
    const next = applySplit(ladder, "金丹", segments);
    expect(next.map((l) => l.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(next.map((l) => l.name)).toEqual([
      "引气",
      "筑基",
      "金丹",
      "金丹 · 第1段",
      "金丹 · 第2段",
    ]);
    expect(next.filter((l) => l.parentId === "金丹")).toHaveLength(2);
    const group = next.find((l) => l.id === "金丹")!;
    expect(group.segFrom).toBeNull();
    expect(group.segTo).toBeNull();
    // 分组持有整阶小层总数：行囊换算按它展开
    expect(group.subLevels).toBe(18);
  });

  it("段名模板缺省「原名 · 第N段」，段号从一开始", () => {
    const segments = previewSplit(level("金丹", 3), 3, 9);
    expect(segments.map((s) => s.name)).toEqual([
      "金丹 · 第1段",
      "金丹 · 第2段",
      "金丹 · 第3段",
    ]);
  });

  it("段名模板 {name}/{n} 可自定义 —— 拆分时就能把名字起好", () => {
    const segments = previewSplit(level("练气", 1), 3, 9, "{name}·{n}重");
    expect(segments.map((s) => s.name)).toEqual([
      "练气·1重",
      "练气·2重",
      "练气·3重",
    ]);
  });

  it("段名模板用固定名单：练气拆初期/中期/后期/圆满", () => {
    const segments = previewSplit(level("练气", 1), 4, 12, "初期,中期,后期,圆满");
    expect(segments.map((s) => s.name)).toEqual(["初期", "中期", "后期", "圆满"]);
    // 段全部新建（父阶是分组），不再复用原行 id
    expect(segments[0].id).toBe("练气__seg1");
  });

  it("段名模板既无 {name} 也无 {n} 时补段号，避免多个段同名", () => {
    const segments = previewSplit(level("金丹", 3), 2, 9, "段");
    expect(segments.map((s) => s.name)).toEqual(["段1", "段2"]);
  });

  it("合并回退到拆分前的阶梯，且小层总数还原（新模型）", () => {
    const segments = previewSplit(level("金丹", 3), 2, 18);
    const split = applySplit(ladder, "金丹", segments);
    const merged = applyMerge(split, "金丹");
    expect(merged.map((l) => l.name)).toEqual(["引气", "筑基", "金丹"]);
    expect(merged.map((l) => l.rank)).toEqual([1, 2, 3]);
    expect(merged.every((l) => l.parentId === null)).toBe(true);
    expect(merged.find((l) => l.id === "金丹")!.subLevels).toBe(18);
  });

  it("合并兼容旧模型（父阶占第一段、总数散在段里）——总数仍还原", () => {
    // 1.38.1 前的拆分数据：父阶自己占 1–9（subLevels 被改小成 9），段占 10–18
    const legacy = [
      ...ladder.filter((l) => l.id !== "金丹"),
      level("金丹", 3, { subLevels: 9, segFrom: 1, segTo: 9 }),
      level("金丹__seg2", 4, {
        name: "金丹 · 第2段",
        parentId: "金丹",
        segFrom: 10,
        segTo: 18,
        subLevels: 9,
      }),
    ];
    const merged = applyMerge(legacy, "金丹");
    expect(merged.map((l) => l.name)).toEqual(["引气", "筑基", "金丹"]);
    expect(merged.find((l) => l.id === "金丹")!.subLevels).toBe(18);
  });
});

describe("设定：绑定展示优先父等级，子层级折算境界内进度（1.38.1）", () => {
  // 新模型：父阶是分组（不占段、持有整阶总数），子层级从第 1 段起
  const splitLadder = [
    level("练气", 1, { subLevels: 9 }),
    level("练气__seg1", 2, {
      name: "练气 · 第1段",
      parentId: "练气",
      segFrom: 1,
      segTo: 1,
      subLevels: 1,
    }),
    level("练气__seg2", 3, {
      name: "第2段", // 自定义段名没带父前缀
      parentId: "练气",
      segFrom: 2,
      segTo: 2,
      subLevels: 1,
    }),
    level("练气__seg3", 4, {
      name: "第3段",
      parentId: "练气",
      segFrom: 3,
      segTo: 3,
      subLevels: 1,
    }),
    // 段只覆盖第 1–3 层，第 4–9 层是「未覆盖区间」—— 下面用它测
    // 「落点不在任何段里 → 无段进度」这条分支
    level("筑基", 5, { subLevels: 3 }),
  ];

  it("rootLevels 只留根阶：派生段不是独立的新阶", () => {
    const roots = rootLevels(splitLadder, "asc");
    expect(roots.map((item) => item.id)).toEqual(["练气", "筑基"]);
  });

  it("findRealmPosition：绑在派生段上给出根阶 + 段 + 整阶小层总数", () => {
    const position = findRealmPosition(splitLadder, "练气__seg2");
    expect(position?.root.id).toBe("练气");
    expect(position?.segment?.id).toBe("练气__seg2");
    expect(position?.total).toBe(9);
  });

  it("findRealmPosition：分组上落点未覆盖任何段 → 无段进度；旧模型绑在父阶上按第一段算", () => {
    expect(findRealmPosition(splitLadder, "筑基")?.segment).toBeNull();
    /*
      「无段进度」指的是**落点不在任何段的区间里**，不是「绑在分组上就一定没进度」：
      分组（练气）持有整阶 9 层，段各占一段；第 5 层没有被任何段覆盖，
      所以折算不出段 —— 只有根阶名。

      旧写法断言 `findRealmPosition(splitLadder, "练气")` 为 null，但缺省
      noteSub = 1，而第 1 段恰好覆盖 1–1，于是它落到第 1 段上、断言与
      「sub=2 → 第2段 / sub=3 → 第3段」自相矛盾。未覆盖分支改用真正没被
      覆盖的层号（5），覆盖关系不变。
    */
    expect(findRealmPosition(splitLadder, "练气", 5)?.segment).toBeNull();
    // 旧模型数据：父阶自己占 1–4，绑在它上面仍有进度
    const legacy = [
      level("练气", 1, { subLevels: 4, segFrom: 1, segTo: 4 }),
      level("练气__seg2", 2, {
        name: "练气 · 第2段",
        parentId: "练气",
        segFrom: 5,
        segTo: 9,
        subLevels: 5,
      }),
    ];
    expect(findRealmPosition(legacy, "练气")?.segment?.segTo).toBe(4);
    expect(findRealmPosition(splitLadder, "不存在")).toBeNull();
    expect(findRealmPosition(splitLadder, null)).toBeNull();
  });

  it("findRealmPosition：绑在分组 + note.sub 时按落点段给进度（统一口径）", () => {
    // 统一口径（1.38.1 起）：绑定 = 根阶 + note.sub，落在哪个段区间就是哪段
    const position = findRealmPosition(splitLadder, "练气", 2);
    expect(position?.root.id).toBe("练气");
    expect(position?.segment?.id).toBe("练气__seg2");
    expect(position?.total).toBe(9);
    // sub 没落在任何段区间（段只覆盖 1–3，第 5 层未覆盖）→ 无段进度
    expect(findRealmPosition(splitLadder, "练气", 5)?.segment).toBeNull();
  });

  it("parseRealmNoteSub：{sub} 解析，缺省 / 非法回落 1", () => {
    expect(parseRealmNoteSub('{"sub":4}')).toBe(4);
    expect(parseRealmNoteSub("")).toBe(1);
    expect(parseRealmNoteSub(undefined)).toBe(1);
    expect(parseRealmNoteSub("不是 JSON")).toBe(1);
    expect(parseRealmNoteSub('{"sub":-2}')).toBe(1);
  });

  it("formatBoundRealmName：段名没带父前缀时补上，带了就原样", () => {
    expect(formatBoundRealmName(splitLadder, "练气__seg2")).toBe("练气 · 第2段");
    expect(formatBoundRealmName(splitLadder, "练气__seg1")).toBe("练气 · 第1段");
    expect(formatBoundRealmName(splitLadder, "筑基")).toBe("筑基");
    expect(formatBoundRealmName(splitLadder, null)).toBe("");
  });

  it("formatBoundRealmName：根阶 + note.sub 折算成「父阶 · 层名」", () => {
    expect(formatBoundRealmName(splitLadder, "练气", 2)).toBe("练气 · 第2段");
    expect(formatBoundRealmName(splitLadder, "练气", 3)).toBe("练气 · 第3段");
    // sub 没有对应段（未覆盖区间，段只覆盖 1–3）→ 只有根阶名
    expect(formatBoundRealmName(splitLadder, "练气", 5)).toBe("练气");
  });
});
