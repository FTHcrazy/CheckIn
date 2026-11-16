import { describe, expect, it } from "vitest";
import { DIAGRAMS, DIAGRAM_BY_ID } from "./interview-diagrams";
import { QUESTION_BANK } from "./interview-bank";
import { KNOWLEDGE_TOPICS } from "./interview-knowledge";

/**
 * 图解数据守卫。
 *
 * 图是「有结构的数据」：字段缺失不会报错，只会渲染出一张空白卡。
 * 同时它还必须被题库或知识体系真的引用 —— 否则等于写了没人看的文档，
 * 这一条用「双向引用检查」钉住。
 */
describe("图解数据", () => {
  it("id 全局唯一", () => {
    const ids = DIAGRAMS.map((diagram) => diagram.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每个图都有标题与一句话结论", () => {
    const offenders = DIAGRAMS.filter(
      (diagram) => diagram.title.trim().length < 6 || diagram.caption.trim().length < 12,
    ).map((diagram) => diagram.id);
    expect(offenders).toEqual([]);
  });

  it("每种图型的必备内容都不为空", () => {
    const offenders: string[] = [];
    for (const diagram of DIAGRAMS) {
      switch (diagram.kind) {
        case "flow":
          if (diagram.nodes.length < 3) offenders.push(`${diagram.id}: nodes < 3`);
          if (diagram.nodes.some((node) => node.label.trim().length === 0)) {
            offenders.push(`${diagram.id}: 空节点`);
          }
          break;
        case "timeline":
          if (diagram.events.length < 3) offenders.push(`${diagram.id}: events < 3`);
          if (diagram.events.some((event) => event.title.trim().length === 0)) {
            offenders.push(`${diagram.id}: 空事件`);
          }
          break;
        case "compare":
          if (diagram.left.items.length < 2 || diagram.right.items.length < 2) {
            offenders.push(`${diagram.id}: 对照条目 < 2`);
          }
          break;
        case "layers":
          if (diagram.layers.length < 2) offenders.push(`${diagram.id}: layers < 2`);
          if (diagram.layers.some((layer) => layer.label.trim().length === 0)) {
            offenders.push(`${diagram.id}: 空层`);
          }
          break;
        default:
          // 图型 union 新增成员时这里会被 TS 收窄成 never，属兜底
          offenders.push("存在未覆盖的图型");
      }
    }
    expect(offenders).toEqual([]);
  });

  it("步骤说明要么不写，写了就至少两条且每条有实质内容", () => {
    const offenders = DIAGRAMS.filter(
      (diagram) =>
        diagram.steps !== undefined &&
        (diagram.steps.length < 2 ||
          diagram.steps.some((step) => step.trim().length < 10)),
    ).map((diagram) => diagram.id);
    expect(offenders).toEqual([]);
  });

  it("每张图都被题库或知识体系引用（拒绝无人消费的死数据）", () => {
    const used = new Set<string>();
    for (const question of QUESTION_BANK) {
      if (question.diagramId) used.add(question.diagramId);
    }
    for (const topic of KNOWLEDGE_TOPICS) {
      if (topic.diagramId) used.add(topic.diagramId);
    }
    const unused = DIAGRAMS.filter((diagram) => !used.has(diagram.id)).map(
      (diagram) => diagram.id,
    );
    expect(unused).toEqual([]);
  });

  it("题库与知识体系引用的图解 id 都真实存在", () => {
    const offenders: string[] = [];
    for (const question of QUESTION_BANK) {
      if (question.diagramId && !DIAGRAM_BY_ID[question.diagramId]) {
        offenders.push(`题目 ${question.id} → ${question.diagramId}`);
      }
    }
    for (const topic of KNOWLEDGE_TOPICS) {
      if (topic.diagramId && !DIAGRAM_BY_ID[topic.diagramId]) {
        offenders.push(`主题 ${topic.id} → ${topic.diagramId}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
