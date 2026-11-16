import { describe, expect, it } from "vitest";
import { CATEGORIES } from "./interview-taxonomy";
import {
  KNOWLEDGE_STAGE_WEIGHT,
  KNOWLEDGE_TOPICS,
  knowledgeOfCategory,
} from "./interview-knowledge";

/**
 * 知识体系守卫。
 *
 * 知识体和题库是两条腿：题库少一题影响不大，某个分类**没有知识条目**则会让
 * 「查看知识体系」直接空一片。这里把覆盖度、链接形态与排序钉成断言。
 */
describe("分类知识体系", () => {
  it("每个分类都有知识主题（新增分类必须同步补数据）", () => {
    const missing = CATEGORIES.filter(
      (node) => knowledgeOfCategory(node.id).length === 0,
    ).map((node) => node.id);
    expect(missing).toEqual([]);
  });

  it("每个分类至少 2 个主题", () => {
    const short = CATEGORIES.filter(
      (node) => knowledgeOfCategory(node.id).length < 2,
    ).map((node) => `${node.id}: ${knowledgeOfCategory(node.id).length}`);
    expect(short).toEqual([]);
  });

  it("主题 id 全局唯一", () => {
    const ids = KNOWLEDGE_TOPICS.map((topic) => topic.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每个主题都有摘要、要点与 https 链接", () => {
    const offenders = KNOWLEDGE_TOPICS.filter(
      (topic) =>
        topic.title.trim().length === 0 ||
        topic.summary.trim().length < 10 ||
        topic.points.length < 2 ||
        topic.links.length === 0 ||
        topic.links.some((link) => !link.url.startsWith("https://")),
    ).map((topic) => topic.id);
    expect(offenders).toEqual([]);
  });

  it("分类内按「入门 → 进阶 → 深入」升序返回", () => {
    const offenders: string[] = [];
    for (const node of CATEGORIES) {
      const topics = knowledgeOfCategory(node.id);
      for (let index = 1; index < topics.length; index += 1) {
        const previous = KNOWLEDGE_STAGE_WEIGHT[topics[index - 1].stage];
        const current = KNOWLEDGE_STAGE_WEIGHT[topics[index].stage];
        if (current < previous) {
          offenders.push(`${node.id}: ${topics[index].id}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("规模足够覆盖全部知识域", () => {
    expect(KNOWLEDGE_TOPICS.length).toBeGreaterThanOrEqual(60);
  });
});
