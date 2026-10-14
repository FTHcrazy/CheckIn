import { describe, expect, it } from "vitest";
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
  it("Tour 讲过的 5 步都在快速上手里（引导消失后功能仍找得到）", () => {
    expect(NOVEL_HELP_DOC.flow).toHaveLength(5);
    const titles = NOVEL_HELP_DOC.flow.map((step) => step.title);
    expect(titles).toContain("新建小说");
    expect(titles).toContain("新建卷与章节");
    expect(titles).toContain("创建全书总设定");
    expect(titles).toContain("行囊：主角状态盘点");
    expect(titles).toContain("写正文与右键菜单");
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
