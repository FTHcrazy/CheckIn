import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TODAY_ADDED_LABEL, TODAY_GOAL_LABEL, WORD_UNIT } from "./today-stats";

/**
 * 「今日」字数口径守卫（UI 需求稿 UI-08 / 审查报告 PX-08）
 *
 * 缺陷形态是**静默漂移**：同一个指标在多个面板各写各的文案与取值来源，
 * 改一处口径不会报错、不跑挂任何测试，只是三个地方慢慢显示成三种样子
 * （历史上就是：书架卡「今日新增」= 跨会话累计、「今日 1,284 / 2,000 字」
 * 用 `toLocaleString` 跟着系统区域变、状态条「今日 +N」= 会话内计数）。
 *
 * 所以这里做两件事：
 * 1. 钉住术语与单位本身（防止有人顺手把常量改了）；
 * 2. 钉住**消费方必须引用常量**，并禁止已知的错法（硬编码字面量、
 *    `toLocaleString`、读会话内计数）回潮。
 */

const root = process.cwd();
const read = (...segments: string[]): string =>
  readFileSync(join(root, ...segments), "utf8").replace(/\\/g, "/");

/** 去掉块注释与行注释（含 JSX 花括号注释），反向断言必须先用它 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** 递归收集 src 下的产品源码（跳过测试与声明文件） */
function collectSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSources(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry) || /\.d\.ts$/.test(entry)) continue;
    // 测试自身要钉死文案（`toBe("今日新增")`），不参与「禁止字面量」扫描
    if (/\.test\.tsx?$/.test(entry)) continue;
    out.push(full.replace(/\\/g, "/"));
  }
  return out;
}

const SHELF_PAGE = "src/windows/NovelWindow/pages/BookshelfPage/BookshelfPage.tsx";
const HERO = "src/windows/NovelWindow/pages/BookshelfPage/components/ContinueHero/index.tsx";
const STATUS_BAR = "src/windows/NovelWindow/pages/NovelPage/components/StatusBar/index.tsx";
const STORE = "src/windows/NovelWindow/pages/NovelPage/store/useNovelEditorStore.ts";
const STATS_MODULE = "src/shared/novel/today-stats.ts";

describe("today-stats —— 术语与单位", () => {
  it("术语固定为「今日新增」/「今日目标」，单位固定为「字」", () => {
    // 钉死文案：改这里等于改全应用口径，必须是有意为之
    expect(TODAY_ADDED_LABEL).toBe("今日新增");
    expect(TODAY_GOAL_LABEL).toBe("今日目标");
    expect(WORD_UNIT).toBe("字");
  });
});

describe("today-stats —— 消费方不许各写各的（源码守卫）", () => {
  it("三处消费方都引用了术语常量", () => {
    for (const file of [SHELF_PAGE, HERO, STATUS_BAR]) {
      expect(read(file), `${file} 未引用 TODAY_ADDED_LABEL`).toContain(
        "TODAY_ADDED_LABEL",
      );
    }
    // 单位跟在数字后（不写进标签）是三处的共同约定
    for (const file of [SHELF_PAGE, HERO, STATUS_BAR]) {
      expect(read(file), `${file} 未引用 WORD_UNIT`).toContain("WORD_UNIT");
    }
    expect(read(STATUS_BAR)).toContain("TODAY_GOAL_LABEL");
  });

  it("状态条读的是今日累计（todayTotal），不是会话内计数", () => {
    const bar = read(STATUS_BAR);
    expect(bar).toContain("stats.todayTotal");
    expect(stripComments(bar)).not.toContain("todayAdded");
  });

  it("整仓只有 today-stats.ts 允许出现「今日新增」字面量", () => {
    const offenders = collectSources(join(root, "src"))
      .filter((file) => stripComments(readFileSync(file, "utf8")).includes("今日新增"))
      .map((file) => file.slice(root.length + 1).replace(/\\/g, "/"))
      .filter((file) => file !== STATS_MODULE);

    expect(offenders).toEqual([]);
  });

  it("字数格式化统一走 formatThousands，禁止 toLocaleString（随系统区域变）", () => {
    const offenders = [SHELF_PAGE, HERO, STATUS_BAR].filter((file) =>
      stripComments(read(file)).includes("toLocaleString"),
    );
    expect(offenders).toEqual([]);
    // 反向自证：这条断言真的在扫文件，不是空数组巧合
    expect(read(HERO)).toContain("formatThousands");
  });

  it("store 与 WritingStats 里不再有第二个「今日」字段", () => {
    expect(stripComments(read(STORE))).not.toContain("todayAdded");
    expect(stripComments(read("src/windows/NovelWindow/pages/NovelPage/types.ts"))).not.toContain(
      "todayAdded",
    );
  });
});
