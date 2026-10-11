/**
 * 「章节序号规则按书独立」的源码守卫（1.34.0）
 *
 * 这条需求横跨四层：导入检测规则 → 落库写按书记录 → 编辑器按书叠加 → 书架按书展示。
 * 任一层被改回「全局一份」，功能就静默退化（不报错、只是换书串味），
 * 所以这里用源码断言把每层的**收口点**钉住 —— 与 novel-db-split.test.ts 同思路：
 * better-sqlite3 的 native 模块在 vitest 的 node 进程里加载不了，
 * 涉及主进程/库的链路只能靠正则钉源码。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (...segments: string[]): string =>
  readFileSync(join(root, ...segments), "utf8");

describe("按书序号规则 · 存储层", () => {
  const constants = read("src/shared/novel/constants.ts");

  it("config 键存在且唯一指向 novel_work_numbering", () => {
    expect(constants).toContain('workNumbering: "novel_work_numbering"');
  });

  it("WorkNumberingRule 三字段齐全（序号样式 + 章后缀 + 卷后缀）", () => {
    const block = constants.slice(constants.indexOf("interface WorkNumberingRule"));
    expect(block).toContain("numberStyle");
    expect(block).toContain("chapterSuffix");
    expect(block).toContain("volumeSuffix");
  });

  const workNumbering = read("src/shared/novel/work-numbering.ts");

  it("读写只走 configGet/configSet，不自建存储", () => {
    expect(workNumbering).toContain("configGet(STORAGE_KEYS.workNumbering)");
    expect(workNumbering).toContain("configSet(");
  });

  it("写入是读改写（先 fetch 再合并），不是整体覆盖", () => {
    // 若非读改写，写入乙书会抹掉甲书的记录 —— 这正是「互不影响」的实现前提
    const writeFn = workNumbering.slice(
      workNumbering.indexOf("export async function saveWorkNumberingRule"),
      workNumbering.indexOf("export function applyWorkNumbering"),
    );
    expect(writeFn).toContain("await fetchWorkNumbering()");
    expect(writeFn).toMatch(/map\[workId\]\s*=\s*\{\s*\.\.\.map\[workId\]/);
  });

  it("映射按键校验：workId 为空时拒绝写入", () => {
    expect(workNumbering).toContain('if (!workId) return false');
  });

  it("本文件不含 React，两个页面可共用（页面隔离规范的跨页共享位）", () => {
    expect(workNumbering).not.toMatch(/from "react"/);
  });
});

describe("按书序号规则 · 导入层", () => {
  const parser = read(
    "src/windows/NovelWindow/pages/BookshelfPage/import/novel-import-parser.ts",
  );

  it("章标题分支剥掉序号前缀后再入库", () => {
    expect(parser).toContain("stripChapterNumbering(normalizeTitle(raw))");
  });

  it("相邻重复标题折叠按原始行判（不能用剥后的空串）", () => {
    // 回归守卫：剥序号后多章标题都是空串，拿空串比会整章丢掉
    expect(parser).toContain("const normalizedRaw = normalizeTitle(raw)");
    expect(parser).toMatch(/if \(normalizedRaw === lastTitle\) continue/);
    expect(parser).toMatch(/openChapter\(title, true, normalizedRaw\)/);
  });

  it("书名 / 作者等元信息行不进 rawTitleLines（不污染规则统计）", () => {
    const chapterBranch = parser.slice(
      parser.indexOf("// ② 章标题"),
      parser.indexOf("// ③ 正文行"),
    );
    // rawTitleLines.push 必须在 isChapterTitle 判定之后
    expect(chapterBranch).toContain("rawTitleLines.push(raw)");
  });

  it("返回结构带上 detectedRule，兜底分支为 null", () => {
    expect(parser).toContain("numberingRule: detectChapterNumbering(rawTitleLines)");
    expect(parser).toMatch(/structured: false,\s*numberingRule: null/);
  });

  const worker = read(
    "src/windows/NovelWindow/pages/BookshelfPage/import/import.worker.ts",
  );

  it("worker 透传 numberingRule 给主线程", () => {
    expect(worker).toContain("numberingRule");
    expect(worker).toMatch(/numberingRule:\s*book\.numberingRule/);
  });

  const service = read(
    "src/windows/NovelWindow/pages/BookshelfPage/services/import-service.ts",
  );

  it("落库时把规则写进该书的记录", () => {
    expect(service).toContain("saveWorkNumberingRule(workId, rule)");
  });

  it("空标题兜底走本书规则，不硬编码「章」", () => {
    expect(service).toContain('rule?.chapterSuffix ?? "章"');
    expect(service).toContain('rule?.numberStyle ?? "arabic"');
  });

  it("写规则失败不阻塞导入（.catch 吞掉）", () => {
    expect(service).toMatch(/saveWorkNumberingRule\(workId, rule\)\.catch\(\(\) => false\)/);
  });
});

describe("按书序号规则 · 编辑器叠加层", () => {
  const editorState = read(
    "src/windows/NovelWindow/pages/NovelPage/hooks/useNovelEditorState.ts",
  );

  it("全局基线与按书映射分开持有", () => {
    expect(editorState).toContain("globalBaseRef");
    expect(editorState).toContain("numberingMap");
  });

  it("加载时把本书规则叠加进 store（所有消费方统一口径）", () => {
    expect(editorState).toMatch(
      /hydrateSettings\(\s*applyWorkNumbering\(globalBaseRef\.current, data\.activeWorkId, numberingMap\)/,
    );
  });

  it("换书时重算叠加（activeWorkId 在依赖里）", () => {
    expect(editorState).toMatch(/\}, \[data\.activeWorkId, numberingMap\]\)/);
  });

  it("设置面板改序号 → 写本书记录，且全局基线保持原序号字段", () => {
    const persist = editorState.slice(
      editorState.indexOf("persistSettings: (next: EditorSettings)"),
      editorState.indexOf("return () => registerEditorRunner(null)"),
    );
    expect(persist).toContain("numberingTouched");
    expect(persist).toContain("saveWorkNumberingRule(workId, rule)");
    // 改动序号时全局基线要回退成旧值，否则换书会把规则带过去
    expect(persist).toMatch(/numberStyle: base\.numberStyle/);
    expect(persist).toMatch(/chapterSuffix: base\.chapterSuffix/);
    expect(persist).toMatch(/volumeSuffix: base\.volumeSuffix/);
  });

  it("setState updater 是纯函数（StrictMode 双跑安全）", () => {
    // 不能再写 `current[workId] === rule`（新对象永远不等，且非纯比较）
    expect(editorState).not.toContain("current[workId] === rule");
    expect(editorState).toContain("prev.chapterSuffix === rule.chapterSuffix");
  });
});

describe("按书序号规则 · 书架展示层", () => {
  const utils = read(
    "src/windows/NovelWindow/pages/BookshelfPage/bookshelf-utils.ts",
  );

  it("resolveHero 支持按书取样式", () => {
    expect(utils).toContain("styleForWork?: (workId: string) => ShelfNumberStyle");
    expect(utils).toContain("styleForWork?.(workId)");
  });

  const data = read(
    "src/windows/NovelWindow/pages/BookshelfPage/hooks/useBookshelfData.ts",
  );

  it("Hero 传入本书规则", () => {
    expect(data).toMatch(/applyWorkNumbering\(style, workId, numberingMap\)/);
  });

  it("不在渲染期调 Date.now()（React 纯度规则）", () => {
    expect(data).not.toMatch(/resolveHero\([\s\S]{0,200}?Date\.now\(\)/);
    expect(data).toContain("setNow(Date.now())");
  });
});
