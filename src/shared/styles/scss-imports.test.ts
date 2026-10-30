import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 样式引用守卫（1.47.0）
 *
 * 由一次真实事故换来：`SettingsWindow/components/ShortcutRecorder/index.scss`
 * 里写成 `@use "../../../shared/styles/widget"`，少了一层 `../`（组件目录在
 * `src/windows/SettingsWindow/components/<C>/`，到 `src` 要退四层）。后果是
 * **点开设置窗口直接白屏**：vite 在浏览器里弹 `[sass] Can't find stylesheet
 * to import` 的遮罩，窗口本身一行内容都不渲染。
 *
 * 这类错误三处都查不出来：
 * - `tsc` 不管 `.scss`；
 * - `eslint` 不管 `.scss`；
 * - vitest 只有 `novel-ui-kit` 会编译 NovelWindow 那一部分的样式，其余组件
 *   的 scss 在测试里根本不会被解析。
 *
 * 所以这里把「构建期才发现」提前到「测试期」，只做两件静态检查（不起 sass
 * 编译器，避免每次跑测试把整棵 import 图编译一遍）：
 * 1. 所有相对 `@use` / `@import` 都能解析到真实文件（含 sass 的偏文件与
 *    `_index.scss` / `index.scss` 目录写法）；
 * 2. 组件目录里 `index.scss` 与 `index.tsx` 成对存在时，tsx 必须引这份样式
 *    —— 忘了 import 的话样式**完全不会进产物**，界面上表现为「改样式没反应」，
 *    比报错更难查。
 */

const ROOT = path.resolve(process.cwd(), "src");

function walkScss(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkScss(full, out);
    else if (entry.name.endsWith(".scss")) out.push(full);
  }
  return out;
}

const SCSS_FILES = walkScss(ROOT);

/** 相对引用的候选路径（sass 的解析顺序：偏文件 → 同名 → 目录 index） */
function candidatesFor(fromFile: string, spec: string): string[] {
  const base = path.resolve(path.dirname(fromFile), spec);
  const dir = path.dirname(base);
  const name = path.basename(base);
  const list: string[] = [];

  if (/\.(scss|sass|css)$/.test(name)) {
    list.push(base, path.join(dir, `_${name}`));
  }
  for (const ext of ["scss", "sass"]) {
    list.push(path.join(dir, `_${name}.${ext}`), path.join(dir, `${name}.${ext}`));
  }
  list.push(path.join(base, "_index.scss"), path.join(base, "index.scss"));
  return list;
}

function isResolvable(fromFile: string, spec: string): boolean {
  return candidatesFor(fromFile, spec).some((candidate) => {
    try {
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

const RELATIVE_USE_RE = /^[ \t]*@(?:use|import)\s+["']([^"']+)["']/gm;

describe("样式引用：相对路径都能解析", () => {
  it("样本非空（扫不到文件说明 walk 失效，下面的断言会假通过）", () => {
    expect(SCSS_FILES.length).toBeGreaterThan(100);
  });

  it("每个相对 @use / @import 都指向真实文件", () => {
    const offenders: string[] = [];
    let relativeCount = 0;

    for (const file of SCSS_FILES) {
      const source = readFileSync(file, "utf8");
      RELATIVE_USE_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = RELATIVE_USE_RE.exec(source))) {
        const spec = match[1];
        // `sass:math` 这类内置模块、包名（不带 `./` / `../`）交给 sass 自己解析
        if (!spec.startsWith(".")) continue;
        relativeCount += 1;
        if (!isResolvable(file, spec)) {
          const rel = path.relative(ROOT, file).replace(/\\/g, "/");
          offenders.push(`${rel} → ${spec}`);
        }
      }
    }

    // 一条相对引用都扫不到 = 正则或注释剥离出错，先让它响
    expect(relativeCount).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });
});

describe("样式引用：组件目录的 index.scss 真的被引入了", () => {
  it("有 index.tsx 的目录，其 index.scss 必须在 tsx 里 import", () => {
    const offenders: string[] = [];

    for (const scss of SCSS_FILES) {
      if (path.basename(scss) !== "index.scss") continue;
      const tsx = scss.replace(/index\.scss$/, "index.tsx");
      if (!existsSync(tsx)) continue;
      const source = readFileSync(tsx, "utf8");
      // 只认侧效引入；`styles.module.scss` 之类统一从 index.scss 转出，故只查这一份
      if (!/["']\.\/index\.scss["']/.test(source)) {
        offenders.push(path.relative(ROOT, scss).replace(/\\/g, "/"));
      }
    }

    expect(offenders).toEqual([]);
  });
});
