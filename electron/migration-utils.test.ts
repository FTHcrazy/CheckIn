/**
 * 数据迁移纯函数单测（migration-utils.ts）
 *
 * 覆盖：范围归一化 / 清单构造与校验 / todo 行归一化与父子重排 / 备忘文件名清洗去重 / 包内条目筛选。
 */
import { describe, it, expect } from "vitest";
import {
  MIGRATION_FORMAT_VERSION,
  buildExportFilename,
  buildManifest,
  dedupeMemoName,
  listMemoEntries,
  normalizeScopes,
  normalizeTodoRow,
  parseManifest,
  parseTodoRows,
  planTodoInserts,
  sanitizeMemoName,
  type MigrationTodoRow,
} from "./migration-utils";

describe("normalizeScopes", () => {
  it("过滤非法值并去重，按 todo → memo 固定顺序输出", () => {
    expect(normalizeScopes(["memo", "todo", "todo", "other", 1, null])).toEqual(["todo", "memo"]);
  });

  it("非数组入参返回空数组", () => {
    expect(normalizeScopes(undefined)).toEqual([]);
    expect(normalizeScopes("todo")).toEqual([]);
    expect(normalizeScopes([])).toEqual([]);
  });
});

describe("buildManifest / parseManifest", () => {
  it("构造的清单可被原样解析回来", () => {
    const manifest = buildManifest({
      scopes: ["memo", "todo"],
      counts: { todo: 3, memo: 2 },
      exportedAt: "2026-09-21T14:32:05.000Z",
      email: "a@b.com",
    });
    expect(manifest.app).toBe("checkin");
    expect(manifest.format).toBe(MIGRATION_FORMAT_VERSION);
    expect(manifest.scopes).toEqual(["todo", "memo"]);

    const parsed = parseManifest(JSON.stringify(manifest));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.manifest).toEqual(manifest);
  });

  it("未传邮箱时不写入 email 字段", () => {
    const manifest = buildManifest({
      scopes: ["todo"],
      counts: { todo: 0, memo: 0 },
      exportedAt: "2026-09-21T14:32:05.000Z",
    });
    expect("email" in manifest).toBe(false);
  });

  it("拒绝非 JSON / 非对象清单", () => {
    expect(parseManifest("{oops")).toEqual({ ok: false, error: "清单文件不是合法 JSON" });
    expect(parseManifest("null").ok).toBe(false);
  });

  it("拒绝非 CheckIn 来源的包", () => {
    expect(parseManifest(JSON.stringify({ app: "other", format: 1, scopes: ["todo"] })).ok).toBe(
      false,
    );
  });

  it("拒绝缺失版本或更高版本的包", () => {
    const missing = parseManifest(JSON.stringify({ app: "checkin", scopes: ["todo"] }));
    expect(missing.ok).toBe(false);
    const future = parseManifest(
      JSON.stringify({ app: "checkin", format: MIGRATION_FORMAT_VERSION + 1, scopes: ["todo"] }),
    );
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.error).toContain("高于当前应用支持");
  });

  it("范围为空时拒绝导入", () => {
    expect(parseManifest(JSON.stringify({ app: "checkin", format: 1, scopes: [] })).ok).toBe(false);
  });

  it("缺失 counts 时按 0 处理", () => {
    const parsed = parseManifest(JSON.stringify({ app: "checkin", format: 1, scopes: ["memo"] }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.manifest.counts).toEqual({ todo: 0, memo: 0 });
  });
});

describe("normalizeTodoRow", () => {
  it("裁剪内容并把真假值收敛为 0/1", () => {
    const row = normalizeTodoRow({
      id: 1,
      parentId: null,
      content: "  写周报  ",
      done: 1,
      note: "",
      important: 0,
      workHour: "2.5",
      createdAt: "2026-09-21 14:00:00",
      doneAt: null,
    });
    expect(row).toMatchObject({ id: 1, content: "写周报", done: 1, important: 0, workHour: 2.5 });
    expect(row?.note).toBeNull();
  });

  it("空内容或非法 id 直接跳过", () => {
    expect(normalizeTodoRow({ id: 1, content: "   " })).toBeNull();
    expect(normalizeTodoRow({ content: "x" })).toBeNull();
    expect(normalizeTodoRow(null)).toBeNull();
  });

  it("自引用父 id 退化为顶层", () => {
    const row = normalizeTodoRow({ id: 7, parentId: 7, content: "x" });
    expect(row?.parentId).toBeNull();
  });

  it("缺失 createdAt 时补当前时间", () => {
    const row = normalizeTodoRow({ id: 1, content: "x" });
    expect(typeof row?.createdAt).toBe("string");
    expect(row?.createdAt.length).toBeGreaterThan(0);
  });
});

describe("parseTodoRows", () => {
  it("兼容顶层数组与 { todos } 包装", () => {
    const payload = [{ id: 1, parentId: null, content: "a" }];
    expect(parseTodoRows(JSON.stringify(payload))).toHaveLength(1);
    expect(parseTodoRows(JSON.stringify({ todos: payload }))).toHaveLength(1);
  });

  it("非法 JSON 返回空数组，重复 id 只保留首条", () => {
    expect(parseTodoRows("{")).toEqual([]);
    expect(parseTodoRows("{}")).toEqual([]);
    const rows = parseTodoRows(
      JSON.stringify([
        { id: 1, content: "first" },
        { id: 1, content: "dup" },
      ]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("first");
  });
});

describe("planTodoInserts", () => {
  it("子项排在父项之后（即便原数组子项在前）", () => {
    const rows: MigrationTodoRow[] = [
      { id: 2, parentId: 1, content: "child", done: 0, note: null, important: 0, workHour: null, createdAt: "t2", doneAt: null },
      { id: 1, parentId: null, content: "parent", done: 0, note: null, important: 0, workHour: null, createdAt: "t1", doneAt: null },
    ];
    const plan = planTodoInserts(rows);
    expect(plan.map((item) => item.sourceId)).toEqual([1, 2]);
    expect(plan[1].parentSourceId).toBe(1);
  });

  it("父项缺失时退化为顶层且不丢数据", () => {
    const rows: MigrationTodoRow[] = [
      { id: 9, parentId: 404, content: "orphan", done: 0, note: null, important: 0, workHour: null, createdAt: "t", doneAt: null },
    ];
    const plan = planTodoInserts(rows);
    expect(plan).toHaveLength(1);
    expect(plan[0].parentSourceId).toBe(404);
  });

  it("父子成环时不会死循环且两行都保留", () => {
    const rows: MigrationTodoRow[] = [
      { id: 1, parentId: 2, content: "a", done: 0, note: null, important: 0, workHour: null, createdAt: "t", doneAt: null },
      { id: 2, parentId: 1, content: "b", done: 0, note: null, important: 0, workHour: null, createdAt: "t", doneAt: null },
    ];
    const plan = planTodoInserts(rows);
    expect(plan.map((item) => item.sourceId).sort()).toEqual([1, 2]);
  });

  it("顶层项保持原有相对顺序", () => {
    const rows: MigrationTodoRow[] = [3, 1, 2].map((id) => ({
      id,
      parentId: null,
      content: `t${id}`,
      done: 0,
      note: null,
      important: 0,
      workHour: null,
      createdAt: "t",
      doneAt: null,
    }));
    expect(planTodoInserts(rows).map((item) => item.sourceId)).toEqual([3, 1, 2]);
  });
});

describe("sanitizeMemoName", () => {
  it("剥离目录前缀，杜绝路径穿越", () => {
    expect(sanitizeMemoName("../../evil.md")).toBe("evil.md");
    expect(sanitizeMemoName("memos\\sub\\note.md")).toBe("note.md");
  });

  it("补齐 .md 后缀并去掉非法字符", () => {
    expect(sanitizeMemoName("周报")).toBe("周报.md");
    expect(sanitizeMemoName("a:b*c?.md")).toBe("abc.md");
    expect(sanitizeMemoName("note.MD")).toBe("note.MD");
  });

  it("空名或仅分隔符时回退为默认名", () => {
    expect(sanitizeMemoName("")).toBe("未命名备忘.md");
    expect(sanitizeMemoName("///")).toBe("未命名备忘.md");
    expect(sanitizeMemoName("...")).toBe("未命名备忘.md");
  });

  it("压缩空白并截断超长文件名", () => {
    expect(sanitizeMemoName("a  b\tc.md")).toBe("a b c.md");
    expect(sanitizeMemoName(`${"x".repeat(200)}.md`)).toBe(`${"x".repeat(80)}.md`);
  });
});

describe("dedupeMemoName", () => {
  it("未占用时原样返回", () => {
    expect(dedupeMemoName("a.md", ["b.md"])).toBe("a.md");
  });

  it("重名依次追加序号", () => {
    expect(dedupeMemoName("a.md", ["a.md"])).toBe("a (1).md");
    expect(dedupeMemoName("a.md", ["a.md", "a (1).md"])).toBe("a (2).md");
  });
});

describe("listMemoEntries", () => {
  it("只取 memos/ 下的一级 .md 文件", () => {
    const entries = [
      "memos/a.md",
      "memos/sub/b.md",
      "memos/c.txt",
      "memos/",
      "todos.json",
      "manifest.json",
      "",
    ];
    expect(listMemoEntries(entries)).toEqual(["memos/a.md"]);
  });
});

describe("buildExportFilename", () => {
  it("按本地时间生成 zip 文件名", () => {
    expect(buildExportFilename(new Date(2026, 8, 21, 14, 32, 5))).toBe(
      "checkin-data-20260921-143205.zip",
    );
  });
});
