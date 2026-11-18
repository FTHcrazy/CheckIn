import { describe, expect, it } from "vitest";
import {
  buildDraftCandidate,
  buildTakenKeys,
  extractJsonObject,
  glossaryKeysOf,
} from "./useInterviewAi";

/**
 * AI 产物的归一（T06-B）。
 *
 * 模型不会照着契约写字：`tags` 写顿号串、`detail` 写一整段、难度写「中级」、
 * 图解塞在代码围栏里。这一层负责把它们变成**能通过结构校验**的产物；
 * 归不动的必须变成 `errors`（界面红字），绝不能静默丢掉或少字段落库。
 */
const base = {
  categoryId: "foundation-react",
  track: "foundation" as const,
  difficulty: "medium" as const,
};

describe("buildDraftCandidate · question", () => {
  it("补全应用侧字段，并把顿号串拆成标签数组", () => {
    const candidate = buildDraftCandidate({
      ...base,
      kind: "question",
      entry: {
        title: "StrictMode 下 useEffect 为什么执行两次",
        stem: "开发环境挂载时的副作用执行了两次，这是 bug 吗？",
        answer: "不是，开发环境会故意多跑一次。",
        difficulty: "高级",
        topic: "React 渲染",
        tags: "StrictMode、useEffect、开发环境",
      },
    });

    expect(candidate).not.toBeNull();
    expect(candidate?.errors).toEqual([]);
    const payload = candidate?.payload as {
      id: string;
      tags: string[];
      difficulty: string;
      categoryId: string;
      track: string;
    };
    expect(payload.id.startsWith("u-q-")).toBe(true);
    expect(payload.tags).toEqual(["StrictMode", "useEffect", "开发环境"]);
    // 中文档位要归一成枚举，否则结构校验直接红
    expect(payload.difficulty).toBe("hard");
    expect(payload.categoryId).toBe("foundation-react");
    expect(payload.track).toBe("foundation");
  });

  it("缺题干 = 整条丢掉（返回 null，不留半截内容）", () => {
    expect(
      buildDraftCandidate({
        ...base,
        kind: "question",
        entry: { title: "只有标题", answer: "有答案" },
      }),
    ).toBeNull();
  });
});

describe("buildDraftCandidate · glossary", () => {
  it("换行分隔的 detail 拆成数组，别名按顿号拆", () => {
    const candidate = buildDraftCandidate({
      ...base,
      kind: "glossary",
      entry: {
        term: "render 阶段",
        en: "Render Phase",
        short: "React 计算要改什么的那一段。",
        detail: "只做 diff，不碰 DOM\n- 不能放副作用",
        aliases: "渲染阶段、render phase",
        domain: "React",
      },
    });

    expect(candidate?.errors).toEqual([]);
    const payload = candidate?.payload as {
      detail: string[];
      aliases: string[];
      domain: string;
    };
    expect(payload.detail).toEqual(["只做 diff，不碰 DOM", "不能放副作用"]);
    expect(payload.aliases).toEqual(["渲染阶段", "render phase"]);
    expect(payload.domain).toBe("react");
  });

  it("没给 detail 时补一句占位，避免结构校验因为空数组判非法", () => {
    const candidate = buildDraftCandidate({
      ...base,
      kind: "glossary",
      entry: { term: "Lane 模型", short: "优先级模型。" },
    });
    expect((candidate?.payload as { detail: string[] }).detail.length).toBeGreaterThan(0);
  });
});

describe("buildDraftCandidate · diagram", () => {
  it("图型与键名原样保留，缺 caption 用标题兜底", () => {
    const candidate = buildDraftCandidate({
      ...base,
      kind: "diagram",
      entry: {
        kind: "flow",
        title: "事件循环",
        nodes: [
          { label: "宏任务", note: "setTimeout" },
          { label: "微任务", note: "Promise.then" },
        ],
      },
    });

    expect(candidate?.errors).toEqual([]);
    const payload = candidate?.payload as { id: string; caption: string };
    expect(payload.id.startsWith("u-d-")).toBe(true);
    expect(payload.caption).toBe("事件循环");
  });
});

describe("extractJsonObject", () => {
  it("能从代码围栏与前后寒暄里抠出对象", () => {
    const text = '好的，结果如下：\n```json\n{"kind":"flow","title":"x"}\n```\n希望对你有帮助';
    expect(extractJsonObject(text)).toEqual({ kind: "flow", title: "x" });
  });

  it("数组或多段 JSON 一律不认（图解只收一个对象）", () => {
    expect(extractJsonObject("[1,2,3]")).toBeNull();
    expect(extractJsonObject("没什么可解析的")).toBeNull();
  });
});

/**
 * 词条键冲突（规范 §10.3）。
 *
 * 这一层必须挡住三件事：撞已有词条、撞草稿词条、同一批里出现两条同名词条。
 * 冲突**不丢候选**（用户改个词名还能用），但采纳按钮必须被禁用 —— 否则
 * matcher 里两个词条抢同一段文本，「点开看到谁」取决于数组顺序。
 */
describe("词条键冲突", () => {
  const owners = [
    { id: "g-closure", term: "闭包", en: "Closure", aliases: ["词法作用域"] },
    { id: "u-g-draft", term: "事件循环", aliases: ["Event Loop"] },
  ];

  it("键归一后去重（大小写 / 空白不影响判定）", () => {
    expect(glossaryKeysOf({ term: " Event Loop ", aliases: ["event loop", "循环"] })).toEqual([
      "event loop",
      "循环",
    ]);
    expect(buildTakenKeys(owners).get("closure")?.id).toBe("g-closure");
  });

  it("命中已有词条的 term / en / alias 都算冲突，并指出是谁占的键", () => {
    const takenKeys = buildTakenKeys(owners);
    const candidate = buildDraftCandidate({
      ...base,
      kind: "glossary",
      entry: { term: "Closure", short: "闭包是函数与其词法环境的组合。", detail: "捕获变量" },
      takenKeys,
    });
    expect(candidate?.errors).toHaveLength(1);
    expect(candidate?.errors[0]).toContain("闭包");
  });

  it("与草稿词条撞键时，错误文案点明是草稿（用户要去草稿箱处理）", () => {
    const candidate = buildDraftCandidate({
      ...base,
      kind: "glossary",
      entry: { term: "Event Loop", short: "事件循环的调度机制。", detail: "宏任务与微任务" },
      takenKeys: buildTakenKeys(owners),
    });
    expect(candidate?.errors.join("；")).toContain("草稿");
  });

  it("补充释义：同名词条会被挡住并给出可照做的命名方式，related 仍指回原词条", () => {
    const takenKeys = buildTakenKeys(owners);
    const candidate = buildDraftCandidate({
      ...base,
      kind: "glossary",
      entry: { term: "闭包", short: "补充：闭包在内存与 GC 上的影响。", detail: "引用不被回收" },
      takenKeys,
      supplementId: "g-closure",
    });
    // 同名不是「预期冲突」而是必须改的：matcher 同键只认先出现的词条
    expect(candidate?.errors.join("；")).toContain("原词条");
    expect((candidate?.payload as { related?: string[] }).related).toEqual(["g-closure"]);
  });

  it("补充释义换成可独立检索的词名就能采纳", () => {
    const candidate = buildDraftCandidate({
      ...base,
      kind: "glossary",
      entry: {
        term: "闭包的内存与 GC",
        short: "补充：闭包捕获的变量为何不会被回收。",
        detail: "引用链可达即存活",
      },
      takenKeys: buildTakenKeys(owners),
      supplementId: "g-closure",
    });
    expect(candidate?.errors).toEqual([]);
    expect((candidate?.payload as { related?: string[] }).related).toEqual(["g-closure"]);
  });
});

/**
 * 同名但不同领域（规范 §10.4）。
 *
 * 「节流」在浏览器性能与 RxJS 里不是一回事。这类同名**不是**重复，两条都该留下：
 * 匹配器把它们并列进 `variants`，弹层里按领域分开展示。挡住它等于强迫用户
 * 用别扭的词名（「RxJS 的节流」）去绕开一个并不存在的冲突。
 */
describe("同名不同领域：允许共存", () => {
  const owners = [
    { id: "g-throttle", term: "节流", domain: "browser", aliases: ["throttle"] },
  ];

  it("同名词条、领域不同 → 不报冲突（进 variants 并列展示）", () => {
    const candidate = buildDraftCandidate({
      ...base,
      kind: "glossary",
      entry: {
        term: "节流",
        domain: "javascript",
        short: "丢弃窗口内后续的值。",
        detail: "与防抖的区别",
      },
      takenKeys: buildTakenKeys(owners),
    });
    expect(candidate?.errors).toEqual([]);
  });

  it("同名词条、同领域 → 仍算重复（这才是重复出词条）", () => {
    const candidate = buildDraftCandidate({
      ...base,
      kind: "glossary",
      entry: {
        term: "节流",
        domain: "browser",
        short: "限制单位时间内的执行次数。",
        detail: "窗口内只跑一次",
      },
      takenKeys: buildTakenKeys(owners),
    });
    expect(candidate?.errors.join("；")).toContain("键重复");
  });

  it("草稿词条没有领域 → 按冲突处理（宁可挡住，也不造一条被遮蔽的词条）", () => {
    const candidate = buildDraftCandidate({
      ...base,
      kind: "glossary",
      entry: { term: "节流", domain: "javascript", short: "丢弃窗口内后续的值。", detail: "x" },
      takenKeys: buildTakenKeys([{ id: "u-g-draft", term: "节流" }]),
    });
    expect(candidate?.errors.join("；")).toContain("草稿");
  });
});

/**
 * 划词原文当别名（`anchor`）。
 *
 * 这是「采纳成功但正文里那个词点不动」的根因修复：模型把 `loader` 交成
 * `Webpack Loader` 时，词表按整词命中，原文那一段不会被识别成名词。
 * 原文补成别名之后，无论模型怎么起名，用户划中的那段一定能点亮。
 */
describe("划词原文补成别名", () => {
  it("模型换了个叫法：原文进 aliases", () => {
    const candidate = buildDraftCandidate({
      ...base,
      kind: "glossary",
      entry: { term: "Webpack Loader", short: "把源文件转成模块的函数。", detail: "串行执行" },
      anchor: "loader",
    });
    expect(candidate?.errors).toEqual([]);
    expect((candidate?.payload as { aliases?: string[] }).aliases).toEqual(["loader"]);
  });

  it("原文与词名只是大小写不同：不重复加别名", () => {
    const candidate = buildDraftCandidate({
      ...base,
      kind: "glossary",
      entry: { term: "Loader", short: "把源文件转成模块的函数。", detail: "串行执行" },
      anchor: "loader",
    });
    expect((candidate?.payload as { aliases?: string[] }).aliases).toBeUndefined();
  });

  it("原文超过词名长度上限就丢弃（否则整条词条判不合法，连采纳都不能）", () => {
    const candidate = buildDraftCandidate({
      ...base,
      kind: "glossary",
      entry: { term: "Loader", short: "把源文件转成模块的函数。", detail: "串行执行" },
      anchor: "loader 只做单文件内容转换（输入输出都是字符串）",
    });
    expect(candidate?.errors).toEqual([]);
    expect((candidate?.payload as { aliases?: string[] }).aliases).toBeUndefined();
  });

  it("别名已满 8 条时挤掉最后一条（点亮划中的词优先）", () => {
    const full = Array.from({ length: 8 }, (_, index) => `别名${index + 1}`);
    const candidate = buildDraftCandidate({
      ...base,
      kind: "glossary",
      entry: {
        term: "Webpack Loader",
        short: "把源文件转成模块的函数。",
        detail: "串行执行",
        aliases: full.join("、"),
      },
      anchor: "loader",
    });
    const aliases = (candidate?.payload as { aliases?: string[] }).aliases;
    expect(aliases).toHaveLength(8);
    expect(aliases?.[7]).toBe("loader");
    expect(aliases).not.toContain("别名8");
  });
});
