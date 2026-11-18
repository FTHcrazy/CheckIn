import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 面试题页样式与控件守卫。
 *
 * 【第一组：两条「不报错、只是难看」的布局回归】
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
 *
 * 【第二组：全模块扫描】
 * 原生控件在暗色主题下不跟随换肤、字号越界、自写 hover 属性规则压不过 antd、
 * 硬编码色值换肤后掉色 —— 这四类同样「不报错、只是坏」，只能靠源码断言。
 */
const PAGE = path.resolve(process.cwd(), "src/windows/BaseWindow/pages/InterviewPage");

function read(relative: string): string {
  return readFileSync(path.join(PAGE, relative), "utf8");
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const FILES = walk(PAGE);
const SOURCE_TSX = FILES.filter(
  (file) => /\.tsx$/.test(file) && !/\.test\.tsx$/.test(file),
);
const SOURCE_TS = FILES.filter(
  (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file),
);
const SCSS = FILES.filter((file) => /\.scss$/.test(file));

/** 逻辑目录（`data/` 里是题库正文，示例代码带着 `console.log` 不算违规） */
const LOGIC_TS = SOURCE_TS.filter(
  (file) => !file.includes(`${path.sep}data${path.sep}`),
);

function source(file: string): string {
  return readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

function relative(file: string): string {
  return path.relative(process.cwd(), file).replace(/\\/g, "/");
}

/** 剥掉块注释与行注释：文档里举例的 `<button>` / `font-size: 11px` 不能算违规 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
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

describe("面试页 UI 规范（全模块源码扫描）", () => {
  it("渲染层不出现原生表单控件（原生按钮 / 输入框 / 下拉）", () => {
    // 不加 i：组件库标签是大写（<Button> / <Input>），原生标签才是小写
    const native = /<(?:button|input|textarea|select|option)\b/;
    const offenders = SOURCE_TSX.filter((file) =>
      native.test(stripComments(source(file))),
    );
    expect(offenders.map(relative)).toEqual([]);
  });

  it("所有 scss 字号满足 ≥12px / 整数 / 偶数三条约束", () => {
    const offenders: string[] = [];
    for (const file of SCSS) {
      const text = stripComments(source(file));
      for (const match of text.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g)) {
        const size = Number(match[1]);
        if (!Number.isInteger(size) || size < 12 || size % 2 !== 0) {
          offenders.push(`${relative(file)}: ${match[1]}px`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("hover 只改变量，不写属性规则（组件库外观由 --ant-* 驱动）", () => {
    const offenders: string[] = [];
    for (const file of SCSS) {
      const text = stripComments(source(file));
      for (const match of text.matchAll(/:hover\s*\{([\s\S]*?)\}/g)) {
        const declarations = match[1]
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        for (const declaration of declarations) {
          if (!/^--[a-z0-9-]+\s*:/i.test(declaration)) {
            offenders.push(`${relative(file)}: ${declaration}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("不硬编码色值（样式与内联样式都只认 var(--app-*)）", () => {
    const color = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;
    const offenders = [...SCSS, ...SOURCE_TSX].filter((file) =>
      color.test(stripComments(source(file))),
    );
    expect(offenders.map(relative)).toEqual([]);
  });

  it("逻辑目录的日志统一走 rendererLog，不直接打 console", () => {
    const offenders = LOGIC_TS.filter((file) =>
      /console\.(?:log|warn|error|debug)\b/.test(stripComments(source(file))),
    );
    expect(offenders.map(relative)).toEqual([]);
  });
});
