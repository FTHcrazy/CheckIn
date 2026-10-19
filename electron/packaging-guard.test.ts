/**
 * 打包与依赖归位守卫（2.0.0）
 *
 * 背景：electron-builder 默认把 production `dependencies` 的**整棵依赖树**塞进
 * app.asar，而渲染层依赖（antd / react / framer-motion …）早已被 Vite 打进
 * `dist`。1.44.0 的 asar 有 117 MiB，其中 110 MiB 是这份永远不被 require 的冗余。
 *
 * 这类错误没有任何运行期症状 —— 开发时一切正常、打包后一切正常，只有安装包悄悄
 * 胖了 5 倍，人工 review package.json 又极容易漏。所以把四条不变量钉成守卫：
 *
 * 1. production `dependencies` 只能是被主进程 `require` 的 4 个包；
 * 2. `vite.config.ts` 里 external 掉的包必须都在 `dependencies` 里
 *    （否则打包后运行期 `Cannot find module`）；
 * 3. `build.files` 必须带 node_modules 冗余排除（@types / 编译期 C 源码等）；
 * 4. `build.asarUnpack` 必须精确到原生 `.node`，不得整包外置。
 *
 * 纯 fs 读取，不 import electron（vitest 跑在 node 环境，见 vitest.config.ts）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/** 读取仓库内文本文件（统一 utf8，路径用 posix 分隔符更可读） */
function read(relativePath: string): string {
  return readFileSync(path.resolve(ROOT, relativePath), "utf8");
}

/**
 * 粗粒度去除行注释与块注释。
 * AGENTS.md §6.6：**反向断言**（"源码不许含 X"）前必须先 stripComments()，
 * 否则注释里抄着的旧写法会被误判成真实代码。
 * 保留换行符以维持行号可读性。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const PACKAGE_JSON = JSON.parse(read("package.json")) as {
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  build?: {
    files?: Array<string | Record<string, unknown>>;
    asarUnpack?: string[];
    electronLanguages?: string[];
  };
};

const VITE_CONFIG_SOURCE = stripComments(read("vite.config.ts"));

/** 主进程运行期真正 require 的第三方包（唯一允许留在 dependencies 的集合） */
const RUNTIME_DEPENDENCIES = ["better-sqlite3", "docx", "jszip", "mammoth"] as const;

/** 主进程 external 清单里剔除 electron 自身后，必须与上面的集合一致 */
const EXTERNAL_EXPECTED = RUNTIME_DEPENDENCIES;

/**
 * 从源码里抽出所有 `external: [...]` 数组的字符串字面量。
 * @param source 已 stripComments 的源码
 * @returns 每个 external 数组对应一个字符串数组
 */
function parseExternalArrays(source: string): string[][] {
  const arrays: string[][] = [];
  const pattern = /external\s*:\s*\[([\s\S]*?)\]/g;
  let match: RegExpExecArray | null = pattern.exec(source);
  while (match) {
    const body = match[1];
    const items = [...body.matchAll(/["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
    if (items.length > 0) {
      arrays.push(items);
    }
    match = pattern.exec(source);
  }
  return arrays;
}

/**
 * 解析 semver 的 major 段（只用于断言 major >= 2，不引入 semver 依赖）。
 * @returns major 数字；格式不合法返回 null
 */
function semverMajor(version: string): number | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(version);
  return match ? Number(match[1]) : null;
}

/** build.files 里的字符串条目（对象条目保持原样，只取字符串做排除规则断言） */
const FILE_STRINGS = (PACKAGE_JSON.build?.files ?? []).filter(
  (entry): entry is string => typeof entry === "string",
);

/** build.asarUnpack */
const ASAR_UNPACK = PACKAGE_JSON.build?.asarUnpack ?? [];

describe("打包守卫：依赖归位", () => {
  it("production dependencies 严格等于主进程运行期依赖集合", () => {
    const actual = Object.keys(PACKAGE_JSON.dependencies ?? {}).sort();
    expect(actual).toEqual([...RUNTIME_DEPENDENCIES].sort());
  });

  it("渲染层依赖全部落在 devDependencies（否则会整棵进 asar）", () => {
    const devDependencies = PACKAGE_JSON.devDependencies ?? {};
    for (const name of [
      "antd",
      "@ant-design/icons",
      "react",
      "react-dom",
      "react-router-dom",
      "framer-motion",
      "@codemirror/view",
      "lunar-typescript",
      "zustand",
    ]) {
      expect(devDependencies, `${name} 应该留在 devDependencies`).toHaveProperty([name]);
      expect(PACKAGE_JSON.dependencies ?? {}).not.toHaveProperty([name]);
    }
  });

  it("vite.config.ts 里 external 掉的包都声明在 dependencies（否则运行期 Cannot find module）", () => {
    const arrays = parseExternalArrays(VITE_CONFIG_SOURCE);
    expect(arrays.length, "vite.config.ts 里找不到 external 数组").toBeGreaterThan(0);

    // 取包含主进程依赖的那一个数组，避免误伤其它 external 配置
    const externalList =
      arrays.find((items) => items.some((item) => EXTERNAL_EXPECTED.includes(item as never))) ??
      arrays[0];

    const thirdParty = externalList.filter((item) => item !== "electron");
    expect(thirdParty.length).toBeGreaterThan(0);

    const dependencies = Object.keys(PACKAGE_JSON.dependencies ?? {});
    for (const name of thirdParty) {
      expect(dependencies, `external 了 ${name} 但没写进 dependencies`).toContain(name);
    }
  });

  it("external 清单与 dependencies 一致（不多不少，防止悄悄漏 external）", () => {
    const arrays = parseExternalArrays(VITE_CONFIG_SOURCE);
    const externalList =
      arrays.find((items) => items.some((item) => EXTERNAL_EXPECTED.includes(item as never))) ??
      arrays[0];
    const thirdParty = externalList
      .filter((item) => item !== "electron")
      .sort();
    expect(thirdParty).toEqual([...RUNTIME_DEPENDENCIES].sort());
  });
});

describe("打包守卫：build.files 冗余排除", () => {
  it("排除 better-sqlite3 的编译期 C 源码（deps / src）", () => {
    expect(FILE_STRINGS).toContain("!node_modules/better-sqlite3/{deps,src}/**");
  });

  it("排除 @types（纯类型，无运行期用途）", () => {
    expect(FILE_STRINGS).toContain("!node_modules/@types/**");
  });

  it("排除 sourcemap / 文档 / 类型声明 / 测试与示例目录", () => {
    for (const pattern of [
      "!node_modules/**/*.map",
      "!node_modules/**/*.md",
      "!node_modules/**/*.d.ts",
      "!node_modules/**/{test,tests,__tests__,spec,docs,example,examples,benchmark}/**",
    ]) {
      expect(FILE_STRINGS, `build.files 缺少 ${pattern}`).toContain(pattern);
    }
  });
});

describe("打包守卫：asarUnpack 精确到原生模块", () => {
  it("只外置 better-sqlite3 的 .node，不得整包外置", () => {
    expect(ASAR_UNPACK.length).toBeGreaterThan(0);
    for (const pattern of ASAR_UNPACK) {
      expect(pattern, `asarUnpack 出现了整包外置写法: ${pattern}`).not.toMatch(
        /node_modules\/\*\*\/\*\.node$/,
      );
      expect(pattern, `asarUnpack 只允许 better-sqlite3 的 .node: ${pattern}`).toContain(
        "node_modules/better-sqlite3/build/Release/",
      );
      expect(pattern.endsWith(".node"), `asarUnpack 条目必须以 .node 结尾: ${pattern}`).toBe(true);
    }
  });

  it("electronLanguages 限制为中文与英文（替代事后删 53 个 locale）", () => {
    const languages = PACKAGE_JSON.build?.electronLanguages ?? [];
    expect([...languages].sort()).toEqual(["en-US", "zh-CN"]);
  });
});

describe("打包守卫：版本号", () => {
  it("version 是合法 semver 且 major >= 2", () => {
    const major = semverMajor(PACKAGE_JSON.version);
    expect(major, `version 不是合法 semver: ${PACKAGE_JSON.version}`).not.toBeNull();
    expect(major as number).toBeGreaterThanOrEqual(2);
  });
});
