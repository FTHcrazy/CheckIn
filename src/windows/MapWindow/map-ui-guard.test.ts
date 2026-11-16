import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * MapWindow UI 规范守卫（AGENTS §6.1 / §6.1.2 / §6.3.1 / §8.3）。
 *
 * 这一批 P0 问题的共同点是「静态检查能确证、运行期却完全静默」：
 * 原生按钮在暗色主题下不跟随换肤、11px 字体不符下限、自写 hover 属性
 * 规则压不过 antd 的状态选择器、console 日志不落盘 —— 都不会报错。
 * 所以钉在源码上，比等截图比对更早失败。
 *
 * 【两条书写纪律】
 *   1. 只断言「能被违反的事实」，不钉整行源码（格式化拆行会造成假红）；
 *   2. 扫描前剥注释，否则文档里举例的 `<button>` / `<input>` 会误报。
 */
const ROOT = path.resolve(process.cwd(), "src/windows/MapWindow");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const FILES = walk(ROOT);
const SOURCE_TS = FILES.filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));
const SOURCE_TSX = SOURCE_TS.filter((file) => /\.tsx$/.test(file));
const SCSS = FILES.filter((file) => /\.scss$/.test(file));

function read(file: string): string {
  return readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

function relative(file: string): string {
  return path.relative(process.cwd(), file).replace(/\\/g, "/");
}

/** 剥掉块注释与行注释；字符串里的 `//` 被一并截断不影响本文件的判定 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("MapWindow UI 规范（源码守卫）", () => {
  it("渲染层不出现原生表单控件（原生按钮 / 输入框 / 下拉）", () => {
    // 不加 i：JSX 里组件库标签是大写（<Button> / <Input>），原生标签才是小写
    const native = /<(?:button|input|textarea|select|option)\b/;
    const offenders = SOURCE_TSX.filter((file) => native.test(stripComments(read(file))));
    expect(offenders.map(relative)).toEqual([]);
  });

  it("所有 scss 字号满足 ≥12px / 整数 / 偶数三条约束", () => {
    const offenders: string[] = [];
    for (const file of SCSS) {
      for (const match of stripComments(read(file)).matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/g)) {
        const size = Number(match[1]);
        if (!Number.isInteger(size) || size < 12 || size % 2 !== 0) {
          offenders.push(`${relative(file)}: ${match[1]}px`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("hover 状态只改变量，不写属性规则（组件库外观由 --ant-* 驱动）", () => {
    const offenders: string[] = [];
    for (const file of SCSS) {
      const source = stripComments(read(file));
      for (const match of source.matchAll(/:hover\s*\{([\s\S]*?)\}/g)) {
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

  it("渲染层日志统一走 rendererLog，不直接打 console", () => {
    const offenders = SOURCE_TS.filter((file) =>
      /console\.(?:log|warn|error|debug)\b/.test(stripComments(read(file))),
    );
    expect(offenders.map(relative)).toEqual([]);
  });

  it("素材卡用 antd Button 承载，且清零点与控件变量在同一选择器里", () => {
    const tsx = read(
      path.resolve(ROOT, "pages/MapEditorPage/components/SpritePanel/index.tsx"),
    );
    const scss = read(
      path.resolve(ROOT, "pages/MapEditorPage/components/SpritePanel/index.scss"),
    );
    expect(tsx).toMatch(/import\s*\{[^}]*\bButton\b[^}]*\}\s*from\s*"antd"/);
    expect(scss).toMatch(/@use\s+"[^"]*shared\/styles\/widget"\s+as\s+widget/);
    expect(scss).toMatch(/\.sprite-card\.ant-btn\s*\{/);
    expect(scss).toMatch(/@include\s+widget\.ant-button-reset/);
    expect(scss).toMatch(/--ant-button-default-hover-bg\s*:/);
  });
});
