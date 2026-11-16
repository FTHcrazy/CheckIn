import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 面试题页样式守卫：挡住两类「不报错、只是难看」的布局回归。
 *
 * 1. 行内名词按钮的 hover 不能改变盒模型。
 *    antd 的 hover 规则用整条 `border` shorthand 重写边框
 *    （`.ant-btn-color-default.ant-btn-variant-text:not(:disabled):hover`，特异性 0,4,0），
 *    自写的 `border: 0` 只有 (0,2,0)，压不过 —— 行内按钮 hover 时突然多出 1px 四边框。
 *    无头 Chrome 实测：按钮 25.2×23.4 → 27.2×24.4，段落高 +1px，整张卡片跟着跳一下。
 *    所以：边框宽度必须靠清零 mixin（`--ant-line-width: 0px`）归零，
 *    下划线改用 text-decoration 画（装饰线不参与盒模型），transition 只留颜色。
 *
 * 2. 定高滚动区里的列表项必须 `flex: none`。
 *    缺了它窗口一矮（960×600 最小尺寸）行就被按比例压扁而不是让容器滚 ——
 *    实测 30px → 19px，用户看到的是「左侧列表项被挤压」。
 */
const PAGE = path.resolve(process.cwd(), "src/windows/BaseWindow/pages/InterviewPage");

function read(relative: string): string {
  return readFileSync(path.join(PAGE, relative), "utf8");
}

describe("名词按钮不得在 hover 时改变行高", () => {
  const source = read("components/TermText/index.scss");

  it("用清零 mixin 引入边框宽度归零", () => {
    expect(source).toContain('@use "../../../../../../shared/styles/widget" as widget');
    expect(source).toContain("@include widget.ant-button-reset");
  });

  it("下划线是装饰线，不是 border", () => {
    expect(source).toContain("text-decoration-line: underline");
    expect(source).toContain("text-decoration-style: dashed");
    // border 一旦参与造型，hover 的 border shorthand 就会把盒子撑大 2px
    expect(source).not.toContain("border-bottom:");
  });

  it("过渡只给颜色，禁止 transition: all", () => {
    expect(source).toContain("@include motion.transition-fast(color)");
    expect(source).not.toContain("transition: all");
  });

  it("取色变量用真实生成的 kebab 名（写成 token 的驼峰名会静默失效）", () => {
    expect(source).toContain("--ant-button-text-text-color:");
    expect(source).toContain("--ant-button-text-text-hover-color:");
    expect(source).not.toContain("--ant-button-text-hover-color:");
  });
});

describe("定高滚动区的列表项不被压扁", () => {
  it("分类栏行保持固定高度，超出由容器滚动", () => {
    const source = read("components/CategorySidebar/index.scss");
    const start = source.indexOf("&__item.ant-btn");
    expect(start).toBeGreaterThan(-1);
    expect(source.slice(start, start + 600)).toContain("flex: none");
  });
});
