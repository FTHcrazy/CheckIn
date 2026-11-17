import { describe, expect, it } from "vitest";
import { QUESTION_BANK } from "./interview-bank";
import { CATEGORIES, CATEGORY_BY_ID } from "./interview-taxonomy";
import { countByCategoryId } from "./interview-filter-utils";
import { diagramById } from "./interview-diagrams";
import { glossaryTermsIn } from "./interview-glossary";
import type { CategoryId } from "./interview-types";

/**
 * 题库内容守卫。
 *
 * 题库是纯数据，没有类型系统能拦住「某个分类只有 3 条」这种退化 ——
 * 而页面侧栏的角标会如实显示 3，用户点进去立刻看到一屏空。
 * 这里把「各分类最低题量」钉成断言，加题 / 删题时越界立刻变红。
 */
const MIN_PER_CATEGORY: Record<CategoryId, number> = {
  "written-coding": 15,
  "written-algorithm": 12,
  "written-design": 5,
  "written-open": 4,
  "foundation-html": 6,
  "foundation-css": 8,
  "foundation-js": 16,
  "foundation-ts": 8,
  "foundation-react": 26,
  "foundation-vue": 20,
  "foundation-electron": 18,
  "foundation-node": 10,
  "foundation-mobile": 7,
  "foundation-miniprogram": 7,
  "foundation-browser": 8,
  "foundation-network": 9,
  "foundation-security": 7,
  "foundation-perf": 7,
  "foundation-engineering": 18,
  "foundation-os": 8,
  "foundation-database": 7,
  "foundation-ai": 14,
};

describe("题库规模", () => {
  it("总量不少于 240 题", () => {
    expect(QUESTION_BANK.length).toBeGreaterThanOrEqual(240);
  });

  it("每个分类都达到最低题量", () => {
    const counts = countByCategoryId(QUESTION_BANK);
    const short: string[] = [];
    for (const node of CATEGORIES) {
      const actual = counts[node.id] ?? 0;
      // 基线分类（`CATEGORIES` 只含 22 个），索引安全收窄回字面量联合
      const expected = MIN_PER_CATEGORY[node.id as CategoryId];
      if (actual < expected) short.push(`${node.id}: ${actual} < ${expected}`);
    }
    expect(short).toEqual([]);
  });

  it("最低题量表覆盖全部 22 个分类（防止新增分类时漏配门槛）", () => {
    expect(Object.keys(MIN_PER_CATEGORY)).toHaveLength(CATEGORIES.length);
  });
});

describe("题库字段完整性", () => {
  it("id 全局唯一", () => {
    const ids = QUESTION_BANK.map((question) => question.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每题都有主题标注、校对时间与热度", () => {
    const offenders = QUESTION_BANK.filter(
      (question) =>
        question.topic.trim().length === 0 ||
        !/^\d{4}-\d{2}$/.test(question.reviewedAt) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(question.updatedAt) ||
        question.heat < 0 ||
        question.heat > 100,
    ).map((question) => question.id);
    expect(offenders).toEqual([]);
  });

  it("每题都有标题、题干与不少于 80 字的参考答案", () => {
    const offenders = QUESTION_BANK.filter(
      (question) =>
        question.title.trim().length === 0 ||
        question.stem.trim().length === 0 ||
        question.answer.trim().length < 80,
    ).map((question) => question.id);
    expect(offenders).toEqual([]);
  });

  it("分类 id 都能在分类表里查到，且轨道与分类表一致", () => {
    const offenders = QUESTION_BANK.filter((question) => {
      // 基线题库里不可能出现 `u-c-*`，收窄回字面量联合后查表
      const node = CATEGORY_BY_ID[question.categoryId as CategoryId];
      return !node || node.track !== question.track;
    }).map((question) => question.id);
    expect(offenders).toEqual([]);
  });

  it("每题至少一个标签", () => {
    expect(
      QUESTION_BANK.filter((question) => question.tags.length === 0).map(
        (question) => question.id,
      ),
    ).toEqual([]);
  });
});

describe("题干代码（读代码类题目的代码必须常显）", () => {
  /** 这些措辞意味着「代码是题目」：代码必须放 stemCode，不能藏在 answer 里 */
  const REQUIRES_STEM_CODE = /(下面|如下|以下|这段)\s*代码|代码(的)?输出|输出(顺序|结果)/;

  it("要求读代码的题目都带 stemCode", () => {
    const offenders = QUESTION_BANK.filter(
      (question) => REQUIRES_STEM_CODE.test(question.stem) && !question.stemCode,
    ).map((question) => question.id);
    expect(offenders).toEqual([]);
  });

  it("stemCode 不是占位符，且带语言标记", () => {
    const offenders = QUESTION_BANK.filter(
      (question) =>
        question.stemCode !== undefined &&
        (question.stemCode.trim().length < 10 ||
          (question.stemCodeLang ?? "").trim().length === 0),
    ).map((question) => question.id);
    expect(offenders).toEqual([]);
  });

  it("至少有一批读代码题（防止这个字段被静默弃用）", () => {
    expect(
      QUESTION_BANK.filter((question) => question.stemCode !== undefined).length,
    ).toBeGreaterThanOrEqual(6);
  });
});

/**
 * 图解与名词词典的接线守卫。
 *
 * 这两份数据都是「题库的附件」：引用了不存在的 id 只会静默不渲染，
 * 而词典与题库脱节时用户看到的是「整屏没有一个可点的词」—— 两种退化
 * 都不会报错，只能靠断言钉住。
 */
describe("图解与名词", () => {
  it("题目引用的图解 id 都能查到", () => {
    const offenders = QUESTION_BANK.filter(
      (question) => question.diagramId !== undefined && !diagramById(question.diagramId),
    ).map((question) => `${question.id} → ${question.diagramId}`);
    expect(offenders).toEqual([]);
  });

  it("带图解的题目达到一定规模（含算法步骤图与框架架构图）", () => {
    expect(
      QUESTION_BANK.filter((question) => question.diagramId !== undefined).length,
    ).toBeGreaterThanOrEqual(15);
  });

  it("题库正文能命中足够多的词条（防止词典与题库脱节）", () => {
    const hits = new Set<string>();
    for (const question of QUESTION_BANK) {
      const text = `${question.title}\n${question.stem}\n${question.answer}`;
      for (const term of glossaryTermsIn(text)) hits.add(term.id);
    }
    // 反向自证：命中集合非空，否则「加词条」变成无人消费的死数据
    expect(hits.size).toBeGreaterThanOrEqual(80);
  });
});
