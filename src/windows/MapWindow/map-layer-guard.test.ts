import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * MapWindow 分层规范守卫（AGENTS §6.2 / §6.2.1 / §6.1.1）。
 *
 * 巨型容器的修复不能只靠一次性拆分：页面、Hook、store 天然会被继续堆代码。
 * 这里钉住两件事 —— 分层边界（谁不许 import 谁）与四个原巨型文件的行数上限。
 *
 * 【书写纪律】只断言能被违反的事实，不钉整行源码（格式化拆行会造成假红）；
 * 扫描前剥注释，避免文档里举例的 import 路径误报。
 */
const ROOT = path.resolve(process.cwd(), "src/windows/MapWindow");
const PAGE = path.join(ROOT, "pages/MapEditorPage");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function read(file: string): string {
  return readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

function lineCount(file: string): number {
  return read(file).trimEnd().split("\n").length;
}

function relative(file: string): string {
  return path.relative(process.cwd(), file).replace(/\\/g, "/");
}

const LAYER_FILES = [
  "store/docSnapshot.ts",
  "store/mapDocState.ts",
  "hooks/useMapEditorState.ts",
  "hooks/useMapViewState.ts",
  "editorConstants.ts",
  "components/MapCanvas/sceneConstants.ts",
];

const PURE_MODULES = [
  "store/docSnapshot.ts",
  "editorConstants.ts",
  "components/MapCanvas/sceneConstants.ts",
];

describe("MapWindow 分层规范（源码守卫）", () => {
  it("Data / EditorState / ViewState 三层骨架文件齐备", () => {
    const missing = LAYER_FILES.filter((rel) => !existsSync(path.join(PAGE, rel)));
    expect(missing).toEqual([]);
  });

  it("页面组件不直接 import store：文档动作只经 hooks 编排", () => {
    const page = stripComments(read(path.join(PAGE, "index.tsx")));
    expect(page).not.toMatch(/from\s+["']\.\/store\//);
    expect(page).not.toMatch(/window\.electronAPI/);
  });

  it("EditorState 层只持有编辑态，不碰 store / IPC / 生成器", () => {
    const source = stripComments(read(path.join(PAGE, "hooks/useMapEditorState.ts")));
    expect(source).not.toMatch(/from\s+["']\.\.\/store\//);
    expect(source).not.toMatch(/from\s+["']\.\.\/domain\//);
    expect(source).not.toMatch(/electronAPI|electron\//);
  });

  it("ViewState 层只做视图派生，不碰生成器 / 持久化 / 文档编辑", () => {
    const source = stripComments(read(path.join(PAGE, "hooks/useMapViewState.ts")));
    expect(source).not.toMatch(/from\s+["']\.\.\/domain\//);
    expect(source).not.toMatch(/from\s+["']\.\.\/persistence\//);
    expect(source).not.toMatch(/useMapDocStore\.getState\(\)\.(commit|applyGenerated|addLabel)/);
  });

  it("Data 层快照模块不反向依赖 zustand 与 hooks", () => {
    const source = stripComments(read(path.join(PAGE, "store/docSnapshot.ts")));
    expect(source).not.toMatch(/from\s+["']zustand["']/);
    expect(source).not.toMatch(/from\s+["']\.\.\/hooks\//);
  });

  it("MapCanvas 子模块不反向 import 画布入口，避免循环依赖", () => {
    const canvasDir = path.join(PAGE, "components/MapCanvas");
    const offenders = walk(canvasDir)
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .filter((file) => path.basename(file) !== "index.tsx")
      .filter((file) => /from\s+["']\.\/index["']/.test(stripComments(read(file))))
      .map(relative);
    expect(offenders).toEqual([]);
  });

  it("四个原巨型文件维持行数上限，防止重新膨胀", () => {
    const limits: Array<[string, number]> = [
      ["index.tsx", 1500],
      ["hooks/useMapEditor.ts", 1500],
      ["store/useMapDocStore.ts", 700],
      ["components/MapCanvas/index.tsx", 2600],
    ];
    for (const [rel, limit] of limits) {
      const count = lineCount(path.join(PAGE, rel));
      expect(count, `${rel} 现有 ${count} 行，上限 ${limit} 行`).toBeLessThanOrEqual(limit);
    }
  });

  it("拆分出来的纯函数模块都有同名单测（§6.6 测试就近）", () => {
    const missing = PURE_MODULES.filter(
      (rel) => !existsSync(path.join(PAGE, rel.replace(/\.ts$/, ".test.ts"))),
    );
    expect(missing).toEqual([]);
  });

  it("工具栏已外提为独立组件，页面级样式不再堆积工具栏选择器（§5.2）", () => {
    const dir = path.join(PAGE, "components/MapToolbar");
    expect(existsSync(path.join(dir, "index.tsx"))).toBe(true);
    expect(existsSync(path.join(dir, "index.scss"))).toBe(true);

    const toolbar = stripComments(read(path.join(dir, "index.tsx")));
    expect(toolbar).toMatch(/import\s+["']\.\/index\.scss["']/);
    expect(toolbar).not.toMatch(/\buse(State|Effect|Memo|Callback|Ref|Context)\s*\(/);
    expect(toolbar).not.toMatch(/electronAPI|window\./);
    expect(toolbar).not.toMatch(/from\s+["'][^"']*store\//);

    const pageTsx = stripComments(read(path.join(PAGE, "index.tsx")));
    expect(pageTsx).toMatch(/<MapToolbar\b/);
    const pageScss = stripComments(read(path.join(PAGE, "index.scss")));
    expect(pageScss).not.toMatch(/\.map-editor__(toolbar|more-panel|land-options)\b/);
  });

  it("业务样式不出现硬编码色值，换肤全部走 var(--app-*)", () => {
    const offenders = walk(ROOT)
      .filter((file) => /\.scss$/.test(file))
      .filter((file) => /rgba?\(|#[0-9a-fA-F]{3,8}\b/.test(stripComments(read(file))))
      .map(relative);
    expect(offenders).toEqual([]);
  });
});
