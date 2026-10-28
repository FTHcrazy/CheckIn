import { describe, expect, it } from "vitest";
import { AI_INTENT_LABELS } from "../ai/context/prompt/registry";
import { NOVEL_HELP_DOC, searchHelpDoc } from "./guide-doc";

/**
 * 帮助文档检索单测
 *
 * 检索是帮助中心的核心能力（PRD G-04：引导消失后功能仍能自助找到），
 * 重点覆盖「作者实际会怎么搜」：带空格的快捷键、口语化问题、跨分区命中。
 */

describe("searchHelpDoc", () => {
  it("空关键词返回空（首屏不该被刷满）", () => {
    expect(searchHelpDoc(NOVEL_HELP_DOC, "")).toEqual([]);
    expect(searchHelpDoc(NOVEL_HELP_DOC, "   ")).toEqual([]);
  });

  it("命中功能名", () => {
    const hits = searchHelpDoc(NOVEL_HELP_DOC, "模板库");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((hit) => hit.title === "模板库")).toBe(true);
  });

  it("命中正文描述（不只搜标题）", () => {
    const hits = searchHelpDoc(NOVEL_HELP_DOC, "不可恢复");
    expect(hits.some((hit) => hit.kind === "faq")).toBe(true);
  });

  it("快捷键带空格也能搜到（作者常直接粘贴「Ctrl + Shift + S」）", () => {
    const hits = searchHelpDoc(NOVEL_HELP_DOC, "Ctrl + Shift + S");
    expect(hits.some((hit) => hit.kind === "shortcut")).toBe(true);
  });

  it("大小写不敏感", () => {
    expect(searchHelpDoc(NOVEL_HELP_DOC, "CTRL+S").length).toBeGreaterThan(0);
  });

  it("四类内容都能命中", () => {
    expect(searchHelpDoc(NOVEL_HELP_DOC, "新建").some((h) => h.kind === "flow")).toBe(true);
    expect(searchHelpDoc(NOVEL_HELP_DOC, "快照").some((h) => h.kind === "entry")).toBe(true);
    expect(searchHelpDoc(NOVEL_HELP_DOC, "F11").some((h) => h.kind === "shortcut")).toBe(true);
    expect(searchHelpDoc(NOVEL_HELP_DOC, "右键").some((h) => h.kind === "faq")).toBe(true);
  });

  it("每条命中都带所属分区，便于结果里归类展示", () => {
    for (const hit of searchHelpDoc(NOVEL_HELP_DOC, "设定")) {
      expect(hit.group).toBeTruthy();
      expect(hit.detail).toBeTruthy();
    }
  });

  it("搜不到时返回空数组（不是返回全部）", () => {
    expect(searchHelpDoc(NOVEL_HELP_DOC, "不存在的词xyz")).toEqual([]);
  });
});

describe("文档结构", () => {
  it("Tour 讲过的 6 步都在快速上手里（引导消失后功能仍找得到）", () => {
    expect(NOVEL_HELP_DOC.flow).toHaveLength(6);
    const titles = NOVEL_HELP_DOC.flow.map((step) => step.title);
    expect(titles).toContain("新建小说");
    expect(titles).toContain("新建卷与章节");
    expect(titles).toContain("创建全书总设定");
    expect(titles).toContain("行囊：主角状态盘点");
    expect(titles).toContain("写正文与右键菜单");
    expect(titles).toContain("跨作品复用设定");
  });

  it("行囊 10 个模块全部在索引里（模块管理默认只开 3 块，其余要靠文档补）", () => {
    const pack = NOVEL_HELP_DOC.sections.find((section) => section.id === "pack");
    const terms = pack?.entries.map((entry) => entry.term) ?? [];
    for (const label of [
      "总属性汇总",
      "人物属性",
      "属性映射",
      "装备栏",
      "物品栏",
      "技能栏",
      "境界",
      "货币",
      "状态效果",
      "备注速记",
    ]) {
      expect(terms).toContain(label);
    }
  });

  it("删除章节与删除卷都在索引里（两条删除路径都有二次确认，都要能自助查到）", () => {
    const chapter = NOVEL_HELP_DOC.sections.find((section) => section.id === "chapter");
    const terms = chapter?.entries.map((entry) => entry.term) ?? [];
    expect(terms).toContain("删除章节");
    expect(terms).toContain("删除卷");
  });

  it("FAQ 里有两个最容易踩的坑：右键前置条件与设定中心心智", () => {
    const ids = NOVEL_HELP_DOC.faq.map((item) => item.id);
    expect(ids).toContain("ctx-menu");
    expect(ids).toContain("no-character-section");
  });
});

/**
 * AI 功能覆盖（维护契约）
 *
 * 「功能做了但用户不知道在哪」等价于没做。这条契约把帮助手册钉在**能力的单一
 * 产地**上：`AI_INTENT_LABELS` 里每多一个意图，这里就红一次，逼着当次就把手册补上
 * ——而不是等半年后有人问「AI 到底能做几件事」再回头翻代码。
 *
 * 同理，配置 / 授权 / 记录这类「非 prompt 的基础设施」也单列断言：它们没有意图，
 * 但缺了任何一条，用户都会卡在「按钮在哪 / 为什么灰的 / 我的稿子上传到哪」。
 */
describe("AI 功能覆盖（新增功能必须同步本手册）", () => {
  const aiSection = NOVEL_HELP_DOC.sections.find((section) => section.id === "ai");
  const aiTerms = aiSection?.entries.map((entry) => entry.term) ?? [];
  const aiText = (aiSection?.entries ?? [])
    .map((entry) => `${entry.term}\n${entry.desc}`)
    .join("\n");

  it("存在「AI 创作助手」分区", () => {
    expect(aiSection).toBeTruthy();
    expect(aiTerms.length).toBeGreaterThan(0);
  });

  it("每个 AI 意图都有可检索词条（漏写 = 新功能等于不存在）", () => {
    for (const [intent, label] of Object.entries(AI_INTENT_LABELS)) {
      expect(aiText, `AI 意图「${intent}」(${label}) 在帮助手册里没有词条`).toContain(label);
    }
  });

  it("配置 / 授权 / 记录这类基础设施也各有词条", () => {
    for (const term of ["配置 AI 服务", "本地模型", "整章内容授权", "AI 记录", "用量与效果"]) {
      expect(aiTerms, `缺少词条「${term}」`).toContain(term);
    }
  });

  it("AI 分区每条词条都能被搜索命中（作者是靠搜索找功能的）", () => {
    for (const entry of aiSection?.entries ?? []) {
      const hits = searchHelpDoc(NOVEL_HELP_DOC, entry.term);
      expect(hits.some((hit) => hit.title === entry.term), `搜不到「${entry.term}」`).toBe(true);
    }
  });

  it("AI FAQ 覆盖最高频的三个疑问：不可用 / 隐私 / 是否重复扣费", () => {
    const ids = NOVEL_HELP_DOC.faq.map((item) => item.id);
    expect(ids).toEqual(
      expect.arrayContaining(["ai-not-configured", "ai-privacy", "ai-summary-charge"]),
    );
  });

  it("全库词条名唯一（重复会让检索结果与列表 key 一起出问题）", () => {
    const seen = new Set<string>();
    for (const section of NOVEL_HELP_DOC.sections) {
      for (const entry of section.entries) {
        expect(seen.has(entry.term), `词条重复：${entry.term}`).toBe(false);
        seen.add(entry.term);
      }
    }
  });

  it("词条名不超过 8 字（索引列定宽 96px，超了会换成竖条）", () => {
    for (const section of NOVEL_HELP_DOC.sections) {
      for (const entry of section.entries) {
        expect(
          entry.term.length,
          `词条「${entry.term}」过长，细节请写进 desc`,
        ).toBeLessThanOrEqual(8);
      }
    }
  });
});
