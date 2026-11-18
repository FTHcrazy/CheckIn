import { describe, expect, it } from "vitest";
import {
  EXPORT_FORMAT,
  EXPORT_SCHEMA_VERSION,
  buildExportDocument,
  planImport,
  validateExportDocument,
  type ExportDocument,
  type ExportRow,
  type ExportTaxonomyRow,
  type PlanImportContext,
} from "./interview-transfer";

const NOW = Date.parse("2026-11-20T10:31:02.411Z");

function row(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    id: "u-q-demo",
    kind: "question",
    action: "new",
    base_id: null,
    status: "adopted",
    origin: "ai",
    category_id: "foundation-react",
    track: "foundation",
    title: "StrictMode 下 useEffect 为什么执行两次",
    payload_json: JSON.stringify({
      id: "u-q-demo",
      title: "StrictMode 下 useEffect 为什么执行两次",
      stem: "为什么开发环境会跑两次？",
      answer: "StrictMode 故意多跑一次 mount→unmount→mount。",
      track: "foundation",
      categoryId: "foundation-react",
      difficulty: "medium",
      tags: ["StrictMode"],
      topic: "React 副作用",
      reviewedAt: "2026-11",
      heat: 50,
      updatedAt: "2026-11-19",
    }),
    base_stamp: null,
    base_hash: null,
    ack_base_hash: null,
    source_intent: "interviewDraft:question",
    reviewed_at: NOW,
    created_at: NOW - 1000,
    updated_at: NOW,
    ...overrides,
  };
}

const TAXONOMY: ExportTaxonomyRow = {
  id: "u-c-rsc",
  label: "RSC 与服务端组件",
  track: "foundation",
  order_no: 101,
  status: "adopted",
  origin: "manual",
  note: "服务端组件边界。",
  created_at: NOW,
  updated_at: NOW,
};

/** 文件里的分类条目（时间已转 ISO），上面的库内行由 buildExportDocument 转换 */
const FILE_TAXONOMY = {
  id: "u-c-rsc",
  action: "new" as const,
  status: "adopted",
  origin: "manual",
  label: "RSC 与服务端组件",
  track: "foundation",
  orderNo: 101,
  note: "服务端组件边界。",
  createdAt: "2026-11-20T10:31:02.411Z",
  updatedAt: "2026-11-20T10:31:02.411Z",
};

const BASELINE = { version: "2.62.0", questions: 243, glossary: 101, diagrams: 24, categories: 22 };

function build(overrides: Partial<Parameters<typeof buildExportDocument>[0]> = {}) {
  return buildExportDocument({
    kind: "delta",
    rows: [row()],
    taxonomy: [TAXONOMY],
    baseline: BASELINE,
    source: { appVersion: "2.62.0", edition: "full", device: "win32" },
    now: NOW,
    ...overrides,
  });
}

describe("导出文件", () => {
  it("delta 只装增量，计数与实际条目一致", () => {
    const doc = build();
    expect(doc.format).toBe(EXPORT_FORMAT);
    expect(doc.schemaVersion).toBe(EXPORT_SCHEMA_VERSION);
    expect(doc.counts).toEqual({ questions: 1, glossary: 0, diagrams: 0, taxonomy: 1 });
    expect(doc.items.questions[0].id).toBe("u-q-demo");
  });

  it("时间字段导出成 ISO（人可读），不是毫秒整数", () => {
    const doc = build();
    expect(doc.items.questions[0].updatedAt).toBe("2026-11-20T10:31:02.411Z");
    expect(doc.items.questions[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("按 kind 过滤（只导词条时不带题目）", () => {
    const doc = build({ rows: [row(), row({ id: "u-g-x", kind: "glossary" })], filters: { kinds: ["glossary"] } });
    expect(doc.items.questions).toHaveLength(0);
    expect(doc.items.glossary).toHaveLength(1);
  });

  it("按分类过滤（只导 React 分类）", () => {
    const doc = build({
      rows: [row(), row({ id: "u-q-vue", category_id: "foundation-vue" })],
      filters: { categoryIds: ["foundation-react"] },
    });
    expect(doc.items.questions.map((item) => item.id)).toEqual(["u-q-demo"]);
  });

  it("full 模式把基线快照以 action: 'baseline' 追加在增量之后", () => {
    const doc = build({
      kind: "full",
      baselineItems: {
        questions: [
          { id: "js-event-loop", title: "事件循环", track: "foundation", categoryId: "foundation-js" },
        ],
        glossary: [],
        diagrams: [],
      },
    });
    expect(doc.items.questions).toHaveLength(2);
    expect(doc.items.questions[0].action).toBe("new");
    expect(doc.items.questions[1].action).toBe("baseline");
    expect(doc.items.questions[1].id).toBe("js-event-loop");
    expect(doc.counts.questions).toBe(2);
  });

  it("delta 模式不带基线快照（即使传了 baselineItems）", () => {
    const doc = build({ baselineItems: { questions: [{ id: "js-event-loop" }] } });
    expect(doc.items.questions).toHaveLength(1);
  });
});

describe("整包闸门", () => {
  it("认不出的 format 整包拒绝", () => {
    const result = validateExportDocument({ ...build(), format: "not-mine" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("format 不匹配");
  });

  it("schemaVersion 不匹配整包拒绝并说明版本", () => {
    const result = validateExportDocument({ ...build(), schemaVersion: 99 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("只能读 1 版");
  });

  it("缺 items 段或某组不是数组都拒绝", () => {
    expect(validateExportDocument({ format: EXPORT_FORMAT, schemaVersion: 1 }).ok).toBe(false);
    const bad = build() as unknown as Record<string, unknown>;
    bad.items = { questions: [], glossary: [], diagrams: [], taxonomy: "x" };
    const result = validateExportDocument(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("items.taxonomy");
  });

  it("正常文件通过并原样返回", () => {
    const doc = build();
    const result = validateExportDocument(doc);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc.items.questions[0].id).toBe("u-q-demo");
  });
});

function context(overrides: Partial<PlanImportContext> = {}): PlanImportContext {
  return {
    conflict: "skip",
    existingIds: new Set(),
    baselineIds: new Set(["js-event-loop"]),
    knownCategories: new Set(["foundation-react", "foundation-js", "foundation-vue"]),
    ...overrides,
  };
}

function docWith(overrides: Partial<ExportDocument["items"]>): ExportDocument {
  const base = build();
  return { ...base, items: { ...base.items, ...overrides } };
}

describe("导入分流", () => {
  it("baseline 条目一律 skip（连 overwrite 也不碰）", () => {
    const doc = docWith({
      questions: [
        {
          ...build().items.questions[0],
          id: "js-event-loop",
          action: "baseline",
          baseId: null,
        },
      ],
    });
    for (const conflict of ["skip", "overwrite"] as const) {
      const plan = planImport(doc, context({ conflict }), NOW);
      expect(plan.skipped).toBe(1);
      expect(plan.inserts).toHaveLength(0);
      expect(plan.updates).toHaveLength(0);
    }
  });

  it("new 条目 id 没有 u- 前缀记 error 并跳过", () => {
    const doc = docWith({
      questions: [{ ...build().items.questions[0], id: "no-prefix", payload: { ...(build().items.questions[0].payload as object), id: "no-prefix" } }],
    });
    const plan = planImport(doc, context(), NOW);
    expect(plan.errors.join()).toContain("没有 u- 前缀");
    expect(plan.inserts).toHaveLength(0);
  });

  it("override 条目 baseId 与 id 不一致记 error 并跳过", () => {
    const doc = docWith({
      questions: [
        { ...build().items.questions[0], id: "js-event-loop", action: "override", baseId: "other" },
      ],
    });
    const plan = planImport(doc, context(), NOW);
    expect(plan.errors.join()).toContain("baseId 必须与 id 相同");
    expect(plan.inserts).toHaveLength(0);
  });

  it("回收站里的行不跟着文件走（status=deleted 计 skipped）", () => {
    const doc = docWith({ questions: [{ ...build().items.questions[0], status: "deleted" }] });
    const plan = planImport(doc, context(), NOW);
    expect(plan.skipped).toBe(1);
    expect(plan.inserts).toHaveLength(0);
  });

  it("墓碑没有 payload 时标题取 title 列（否则列表会变成一串 id）", () => {
    const doc = docWith({
      questions: [
        {
          ...build().items.questions[0],
          id: "js-event-loop",
          action: "override",
          baseId: "js-event-loop",
          status: "hidden",
          payload: null,
          title: "事件循环里微任务与宏任务的执行顺序",
        },
      ],
    });
    const plan = planImport(doc, context(), NOW);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].payloadJson).toBeNull();
    expect(plan.inserts[0].title).toBe("事件循环里微任务与宏任务的执行顺序");
  });

  it("结构不合法的条目记 error 并跳过，其余条目照常导入", () => {
    const doc = docWith({
      questions: [
        { ...build().items.questions[0], id: "u-q-broken", payload: { id: "u-q-broken" } },
        build().items.questions[0],
      ],
    });
    const plan = planImport(doc, context(), NOW);
    expect(plan.errors).toHaveLength(1);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].id).toBe("u-q-demo");
  });

  it("分类既不在基线也不在本机也不在本包里 → 记 error 并跳过", () => {
    const doc = docWith({
      questions: [{ ...build().items.questions[0], categoryId: "u-c-unknown" }],
    });
    const plan = planImport(doc, context(), NOW);
    expect(plan.errors.join()).toContain("在本机不存在");
  });

  it("本包自带的新分类算已知（换机导入时自己建的分类不该把题判死）", () => {
    const doc = docWith({
      questions: [{ ...build().items.questions[0], categoryId: "u-c-rsc" }],
    });
    const plan = planImport(doc, context(), NOW);
    expect(plan.errors).toHaveLength(0);
    expect(plan.inserts).toHaveLength(1);
  });

  it("override 指向本机不存在的基线题 → 孤儿（入库但不渲染，要上报）", () => {
    const doc = docWith({
      questions: [
        {
          ...build().items.questions[0],
          id: "js-removed",
          action: "override",
          baseId: "js-removed",
          baseStamp: "2026-01",
          payload: { ...(build().items.questions[0].payload as object), id: "js-removed" },
        },
      ],
    });
    const plan = planImport(doc, context(), NOW);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.orphaned).toEqual([
      { id: "js-removed", title: "StrictMode 下 useEffect 为什么执行两次", baseStamp: "2026-01" },
    ]);
  });

  it("id 已存在且策略为 skip → 计入 skipped", () => {
    const plan = planImport(build(), context({ existingIds: new Set(["u-q-demo"]) }), NOW);
    expect(plan.skipped).toBeGreaterThanOrEqual(1);
    expect(plan.inserts).toHaveLength(0);
  });

  it("id 已存在且策略为 overwrite → 进 updates（createdAt 由写库时保留库内值）", () => {
    const plan = planImport(
      build(),
      context({ conflict: "overwrite", existingIds: new Set(["u-q-demo"]) }),
      NOW,
    );
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].id).toBe("u-q-demo");
  });

  it("分类 id 不是 u-c- 开头或名称超长都记 error", () => {
    const doc = docWith({
      taxonomy: [
        { ...FILE_TAXONOMY, id: "bad-id" },
        { ...FILE_TAXONOMY, id: "u-c-long", label: "这是一个超过十二个字的分类名称" },
      ],
    });
    const plan = planImport(doc, context(), NOW);
    expect(plan.errors).toHaveLength(2);
    expect(plan.taxonomyInserts).toHaveLength(0);
  });

  it("分类冲突同样遵守 skip / overwrite", () => {
    const skip = planImport(build(), context({ existingIds: new Set(["u-c-rsc"]) }), NOW);
    expect(skip.taxonomyInserts).toHaveLength(0);
    const overwrite = planImport(
      build(),
      context({ conflict: "overwrite", existingIds: new Set(["u-c-rsc"]) }),
      NOW,
    );
    expect(overwrite.taxonomyUpdates).toHaveLength(1);
  });

  it("分类 orderNo 小于 100 时被抬到 100（不许插进基线分组中间）", () => {
    const doc = docWith({ taxonomy: [{ ...FILE_TAXONOMY, orderNo: 3 }] });
    const plan = planImport(doc, context(), NOW);
    expect(plan.taxonomyInserts[0].orderNo).toBe(100);
  });

  it("完整 delta 往返：导出再导入到干净机器，条目与分类全部落地", () => {
    const doc = build();
    const plan = planImport(doc, context(), NOW);
    expect(plan.errors).toHaveLength(0);
    expect(plan.inserts).toHaveLength(1);
    expect(plan.taxonomyInserts).toHaveLength(1);
    expect(plan.inserts[0].updatedAt).toBe(NOW);
  });
});
