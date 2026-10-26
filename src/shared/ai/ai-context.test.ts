import { describe, expect, it } from "vitest";
import { buildNamingPrompt, buildPolishPrompt } from "./ai-context";

describe("buildNamingPrompt", () => {
  it("把描述拼成 prompt，约束进 system", () => {
    const { system, prompt } = buildNamingPrompt({
      description: "清冷孤傲的剑修女侠",
      kind: "人名",
      style: "仙侠",
      gender: "女",
      count: 10,
      avoid: ["苏晚", "林惊羽"],
    });

    expect(prompt).toBe("清冷孤傲的剑修女侠");
    expect(system).toContain("名字类型：人名");
    expect(system).toContain("风格：仙侠");
    expect(system).toContain("性别倾向：女");
    expect(system).toContain("每次只输出 10 个名字");
    expect(system).toContain("苏晚、林惊羽");
  });

  it("无约束与避让时不产生多余行", () => {
    const { system } = buildNamingPrompt({
      description: "一个名字",
      count: 6,
    });
    expect(system).not.toContain("名字类型：");
    expect(system).not.toContain("不要与以下已用名字重复");
    expect(system).toContain("每次只输出 6 个名字");
  });
});

describe("buildPolishPrompt", () => {
  it("原文进 prompt，润色约束进 system", () => {
    const { system, prompt } = buildPolishPrompt({ text: "他走到门前，推开了那扇门。" });

    expect(prompt).toBe("他走到门前，推开了那扇门。");
    expect(system).toContain("只润色措辞、句式和流畅度");
    expect(system).toContain("不改变原意");
    expect(system).toContain("直接输出润色后的文字");
  });
});
