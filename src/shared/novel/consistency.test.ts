import { describe, expect, it } from "vitest";
import {
  buildConsistencyIndex,
  createConsistencyScanner,
  scanChapterForConsistency,
  type ConsistencyChapterInput,
  type ConsistencyEntityInput,
  type ConsistencyLevelInput,
} from "./consistency";

/**
 * 一致性校对（R-AI-10a）单测
 *
 * 重点不是「能报错」，而是**不误报**：这个功能的价值全在信噪比上。
 * 作者看到 3 条真问题会去改；看到 200 条疑似会直接关掉面板再也不点。
 * 所以每条用例都写清「为什么这条该报 / 不该报」。
 */

const liXuan: ConsistencyEntityInput = {
  id: "e1",
  name: "李玄",
  type: "character",
  aliases: ["玄哥"],
};

const qingyun: ConsistencyEntityInput = {
  id: "e2",
  name: "青云山",
  type: "location",
  aliases: [],
};

/** 把若干段正文拼成一章（段落间用换行，模拟真实排版） */
function chapter(id: string, title: string, lines: string[]): ConsistencyChapterInput {
  return { id, title, content: lines.join("\n") };
}

/** 便捷：只喂一章 + 立刻 finalize */
function scanOnce(
  entities: ConsistencyEntityInput[],
  realmLevels: ConsistencyLevelInput[],
  chapters: ConsistencyChapterInput[],
) {
  const scanner = createConsistencyScanner({ entities, realmLevels });
  for (const item of chapters) scanner.scanChapter(item);
  return scanner.finalize();
}

describe("buildConsistencyIndex", () => {
  it("只收 2–6 字的纯汉字词条（单字词在正文里全是常用字，收进来就是噪声源）", () => {
    const index = buildConsistencyIndex({
      entities: [
        { id: "a", name: "玄", type: "character", aliases: [] },
        { id: "b", name: "李玄", type: "character", aliases: [] },
        { id: "c", name: "A1", type: "item", aliases: [] },
      ],
      realmLevels: [],
    });
    expect(index.exact.has("李玄")).toBe(true);
    expect(index.exact.has("玄")).toBe(false);
    expect(index.exact.has("A1")).toBe(false);
    expect(index.lens).toEqual([2]);
  });

  it("长词的真子串被屏蔽：正文里的「青云」是「青云山」的片段，不是它的错写", () => {
    const index = buildConsistencyIndex({ entities: [qingyun], realmLevels: [] });
    expect(index.blocked.has("青云")).toBe(true);
    expect(index.blocked.has("云山")).toBe(true);
  });
});

describe("人物/别名近似", () => {
  it("同姓差一字的错写会被报出来（这是本功能的主场景）", () => {
    const issues = scanOnce(
      [liXuan],
      [],
      [
        chapter("c1", "第一章", [
          "李玄推门而入，李玄看见案上那封信。",
          "李玄没有回头。",
        ]),
        chapter("c2", "第二章", ["李元握紧了刀。", "李元知道自己回不去了。"]),
      ],
    );
    expect(issues).toHaveLength(1);
    const issue = issues[0];
    expect(issue.kind).toBe("name-near-miss");
    expect(issue.found).toBe("李元");
    expect(issue.expected).toBe("李玄");
    expect(issue.expectedLabel).toBe("人物：李玄");
    // 同姓 + 出现两次 → 判「确定」；只报一次且同姓才是「疑似」
    expect(issue.severity).toBe("sure");
    expect(issue.count).toBe(2);
    expect(issue.chapterId).toBe("c2");
    expect(issue.evidence).toContain("李元");
  });

  it("只出现一次的近似写法降为「疑似」（可能是另一个路人，不替作者定罪）", () => {
    const issues = scanOnce(
      [liXuan],
      [],
      [
        chapter("c1", "第一章", ["李玄开口。", "李玄又停下。", "李玄走了。"]),
        chapter("c2", "第二章", ["李元点头。"]),
      ],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe("suspect");
  });

  it("两个频率相当的同姓角色不算不一致（「李玄」50 次 + 「李四」20 次是真两个人）", () => {
    const many = Array.from({ length: 10 }, () => "李玄继续往前走。");
    const other = Array.from({ length: 6 }, () => "李四没有说话。");
    const issues = scanOnce([liXuan], [], [chapter("c1", "第一章", [...many, ...other])]);
    expect(issues).toHaveLength(0);
  });

  it("正确写法在书里不足 3 次时不做近似比对（基准太弱，报出来都是噪声）", () => {
    const issues = scanOnce(
      [liXuan],
      [],
      [chapter("c1", "第一章", ["李玄开口。", "李元点头。", "李元走了。"])],
    );
    expect(issues).toHaveLength(0);
  });

  it("精确命中不产生任何问题（写对了就是写对了）", () => {
    const issues = scanOnce(
      [liXuan],
      [],
      [chapter("c1", "第一章", ["李玄开口。", "李玄点头。", "李玄走了。", "李玄笑了。"])],
    );
    expect(issues).toHaveLength(0);
  });

  it("长地名被当整体命中后，其片段不会被误判成错名", () => {
    const issues = scanOnce(
      [qingyun],
      [],
      [
        chapter("c1", "第一章", [
          "青云山下了一夜雨。",
          "青云山外有青云。",
          "青云山的雾散了。",
        ]),
      ],
    );
    // 「青云」只是「青云山」的片段（blocked），不该报成「青去山」之类
    expect(issues.filter((item) => item.kind === "name-near-miss")).toHaveLength(0);
  });

  it("跨章累计：同一对错写分布在不同章时合并成一条（列表按问题聚合，不按出现位置铺开）", () => {
    const issues = scanOnce(
      [liXuan],
      [],
      [
        chapter("c1", "第一章", ["李玄开口。", "李玄点头。", "李玄走了。"]),
        chapter("c2", "第二章", ["李元进来。"]),
        chapter("c3", "第三章", ["李元退下。"]),
      ],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].count).toBe(2);
    // 跳转定位取首次出现那一章
    expect(issues[0].chapterId).toBe("c2");
  });
});

describe("境界写法", () => {
  const levels: ConsistencyLevelInput[] = [{ name: "金丹", aliases: ["金丹期"] }];

  it("正文写「金丹后期」而体系只登记「金丹」→ 给出加别名的建议", () => {
    const issues = scanOnce(
      [],
      levels,
      [chapter("c1", "第一章", ["他已入金丹后期。", "金丹后期的修士不多。"])],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("realm-variant");
    expect(issues[0].found).toBe("金丹后期");
    expect(issues[0].expected).toBe("金丹");
    expect(issues[0].expectedLabel).toBe("境界：金丹");
    expect(issues[0].suggestion).toContain("别名");
  });

  it("已登记为别名的写法不再报（「金丹期」是别名，正文出现就是正常引用）", () => {
    const issues = scanOnce(
      [],
      levels,
      [chapter("c1", "第一章", ["他已是金丹期。", "金丹期修士。", "金丹修士。"])],
    );
    expect(issues).toHaveLength(0);
  });

  it("只出现一次的偶发写法不占列表（「金丹大圆满」写成一次就报，噪声会盖过真问题）", () => {
    const issues = scanOnce([], levels, [chapter("c1", "第一章", ["他已是金丹大圆满。"])]);
    expect(issues).toHaveLength(0);
  });

  it("长后缀优先：「大圆满」不会被拆成「圆满」再报一遍", () => {
    const issues = scanOnce(
      [],
      levels,
      [
        chapter("c1", "第一章", [
          "金丹大圆满。",
          "金丹大圆满之境。",
        ]),
      ],
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].found).toBe("金丹大圆满");
  });

  it("没有境界体系时不产出境界问题（比对基准不存在）", () => {
    const issues = scanOnce([], [], [chapter("c1", "第一章", ["金丹后期。", "金丹后期。"])]);
    expect(issues).toHaveLength(0);
  });
});

describe("实机误报回归（2.15.1）", () => {
  /**
   * 以下用例的数据全部照抄 2.15.0 在真实长篇上的误报清单
   * （《惊悚世界》几十万字，99 条「确定」里 96 条是这类碎片）。
   *
   * 归因：错名判据只看「等长 + 差一字 + 首尾字命中」，于是**词内碎片**
   * 全部中招——`布`+任何常用字都算 `布偶` 的近似写法。
   * 修法是「按名字整体看写法种数」：一个名字冒出 3 种以上写法，说明它的
   * 首/尾字是高频字，正文里到处是「它 + 常用字」的正常词。
   */
  const entities: ConsistencyEntityInput[] = [
    { id: "buou", name: "布偶", type: "item", aliases: [] },
    { id: "kongo", name: "恐怖屋", type: "location", aliases: [] },
    { id: "chenge", name: "陈歌", type: "character", aliases: [] },
    { id: "bing", name: "第三病栋", type: "location", aliases: [] },
    { id: "lixuan", name: "李玄", type: "character", aliases: [] },
  ];

  /** 布偶 / 恐怖屋 / 陈歌 各写对若干次，再混入真实误报清单里的碎片 */
  const noisy: ConsistencyChapterInput[] = [
    chapter("c1", "第一章", [
      "布偶站在门口。",
      "布偶没有说话。",
      "布偶回头看了他一眼。",
      "恐怖屋的灯亮着。",
      "恐怖屋在街角。",
      "恐怖屋的门开着。",
      "陈歌推门进来。",
      "陈歌坐下。",
      "陈歌抬头。",
      "第三病栋在院区最里侧。",
      "第三病栋的走廊很暗。",
      "第三病栋的门牌褪了色。",
    ]),
    chapter("c2", "第二章", [
      // 布偶：三种词内碎片（布控 / 布游 / 布鬼）
      "警方布控了整条街。",
      "布控范围又扩大了。",
      "他沿着布游的方向看去。",
      "布游的画面一闪而过。",
      "布鬼的影子贴在墙上。",
      "布鬼没有动。",
      // 恐怖屋：四种碎片（恐怖了 / 恐怖感 / 恐怖和 / 恐怖吗）
      "他忽然觉得恐怖了。",
      "恐怖感从背后爬上来。",
      "恐怖和惊悚是两回事。",
      "你说恐怖吗？",
      // 陈歌：三种碎片（陈医 / 陈育 / 陈列）
      "陈医生，我是第一次来。",
      "陈育点了点头。",
      "陈列室的灯还亮着。",
      // 两个真实地名，只差一个数字
      "第二病栋没有通电。",
      "第二病栋的窗户全钉死了。",
    ]),
  ];

  it("高频碎片源（布偶 / 恐怖屋 / 陈歌）整组不报——这是 96% 误报的来源", () => {
    const issues = scanOnce(entities, [], noisy);
    const noisyNames = ["布偶", "恐怖屋", "陈歌"];
    const leaked = issues.filter((item) => noisyNames.includes(item.expected));
    expect(leaked.map((item) => `${item.found}→${item.expected}`)).toEqual([]);
  });

  it("只差一个数字的两个真名不报（第二病栋 ≠ 第三病栋的手滑）", () => {
    const issues = scanOnce(entities, [], noisy);
    expect(issues.filter((item) => item.expected === "第三病栋")).toEqual([]);
  });

  it("同一本书里的真错字照旧报出来——抑制是按名字分组的，不会连带压掉别的名字", () => {
    const issues = scanOnce(
      [...entities],
      [],
      [
        ...noisy,
        chapter("c3", "第三章", [
          "李玄推门而入。",
          "李玄看见案上那封信。",
          "李玄没有回头。",
          "李元握紧了刀。",
          "李元知道自己回不去了。",
        ]),
      ],
    );
    const real = issues.filter((item) => item.expected === "李玄");
    expect(real).toHaveLength(1);
    expect(real[0].found).toBe("李元");
    expect(real[0].severity).toBe("sure");
  });

  it("写法种数到 3 才丢弃；到 2 时保留但降为「疑似」，不再替作者定罪", () => {
    const issues = scanOnce(
      [{ id: "sun", name: "孙越", type: "character", aliases: [] }],
      [],
      [
        chapter("c1", "第一章", ["孙越开口。", "孙越点头。", "孙越走了。"]),
        chapter("c2", "第二章", ["孙悦笑了。", "孙跃没有答话。"]),
      ],
    );
    expect(issues.map((item) => item.found).sort()).toEqual(["孙悦", "孙跃"]);
    expect(issues.every((item) => item.severity === "suspect")).toBe(true);
  });
});

describe("健壮性与性能", () => {
  it("空正文 / 空词表都不崩", () => {
    expect(scanOnce([], [], [{ id: "c1", title: "空章", content: "" }])).toEqual([]);
    const scanner = createConsistencyScanner({ entities: [], realmLevels: [] });
    expect(scanner.scanChapter({ id: "c1", title: "x", content: "随便写点什么。" }).nameHits).toEqual(
      [],
    );
    expect(scanner.finalize()).toEqual([]);
  });

  it("scanChapter 返回本章命中与精确计数，供调用方做进度/预览", () => {
    const index = buildConsistencyIndex({ entities: [liXuan], realmLevels: [] });
    const result = scanChapterForConsistency(index, {
      id: "c1",
      title: "第一章",
      content: "李玄开口，李玄又停。",
    });
    expect(result.termCounts.get("李玄")).toBe(2);
    expect(result.nameHits).toEqual([]);
  });

  /**
   * 性能门槛（Q1 的裁决依据）：分片让出能不能用，取决于**单章**耗时。
   *
   * 取 200 章 × 3000 字（约 60 万字，长篇上限）+ 60 张卡：
   * - 单章必须在 16ms 内（一帧），否则分片再细也会掉帧；
   * - 全书总耗时只作量级参考（CI 机器差异大，给的是宽松上限）。
   */
  it("60 万字 / 60 张卡：单章 < 16ms，全书 < 6s", () => {
    const entities: ConsistencyEntityInput[] = Array.from({ length: 60 }, (_, i) => ({
      id: `e${i}`,
      name: `${["李", "王", "张", "赵", "沈", "陆"][i % 6]}${String.fromCharCode(0x4e00 + i)}`,
      type: "character",
      aliases: [],
    }));
    const filler =
      "他抬头看天，云层压得很低，远处的山脊像一道未干的墨痕，风从谷口灌进来，吹得衣袖猎猎作响。";

    const scanner = createConsistencyScanner({
      entities,
      realmLevels: [{ name: "金丹", aliases: [] }],
    });
    const startedAll = performance.now();
    let worst = 0;
    for (let c = 0; c < 200; c += 1) {
      const body = Array.from({ length: 30 }, () => filler).join("");
      const started = performance.now();
      scanner.scanChapter({ id: `c${c}`, title: `第${c}章`, content: body });
      worst = Math.max(worst, performance.now() - started);
    }
    const totalMs = performance.now() - startedAll;

    expect(worst).toBeLessThan(16);
    expect(totalMs).toBeLessThan(6000);
    expect(scanner.scanned).toBe(200);
  });
});
