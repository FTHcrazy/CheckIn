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

  it("排除嵌套 @types（docx 自带一份 @types/node，顶层规则匹配不到）", () => {
    expect(FILE_STRINGS).toContain("!**/node_modules/@types/**");
  });

  it("排除 node-addon-api（纯 C++ 头文件，运行期只 require prebuilds/*.node）", () => {
    expect(FILE_STRINGS).toContain("!node_modules/node-addon-api/**");
  });

  /**
   * 2.1.2：运行期依赖里大量「同一份代码的多种构建产物」—— Node `require` 只会走
   * exports.require / main 指向的那一个，浏览器版（mammoth.browser*.js）、ESM 版
   * （index.mjs）、IIFE/UMD 版（index.iife.js、index.umd.cjs）、以及库内自带的
   * `dist/` 预打包副本全是死重，合计 ~8 MiB。
   * 删错入口不会在打包期报错，只在运行期抛 `Cannot find module`，故逐条钉死。
   */
  it("排除运行期依赖的重复构建产物（浏览器版 / ESM / IIFE / 包内 dist 副本）", () => {
    for (const pattern of [
      "!node_modules/docx/dist/index.iife.js",
      "!node_modules/docx/dist/index.mjs",
      "!node_modules/docx/dist/index.umd.cjs",
      "!node_modules/docx/node_modules/**",
      "!node_modules/mammoth/mammoth.browser.js",
      "!node_modules/mammoth/mammoth.browser.min.js",
      "!node_modules/jszip/dist/**",
      "!node_modules/pako/dist/**",
      "!node_modules/bluebird/js/browser/**",
      "!node_modules/xml-js/dist/**",
      "!node_modules/underscore/{modules,cjs}/**",
      "!node_modules/underscore/underscore-esm.js",
      "!node_modules/underscore/underscore-esm-min.js",
      "!node_modules/underscore/underscore-umd-min.js",
      "!node_modules/underscore/underscore-min.js",
      "!node_modules/underscore/underscore.js",
    ]) {
      expect(FILE_STRINGS, `build.files 缺少 ${pattern}`).toContain(pattern);
    }
  });

  it("上一条的排除不得命中 require 真正落地的入口", () => {
    // docx：Node 走 exports["."].require.default → dist/index.cjs
    expect(FILE_STRINGS.some((pattern) => pattern.includes("docx/dist/index.cjs"))).toBe(false);
    // underscore：exports["."].require.node → underscore-node.cjs → underscore-node-f.cjs
    expect(FILE_STRINGS.some((pattern) => pattern.includes("underscore-node"))).toBe(false);
    // 任何运行期依赖都不得被整包排除
    for (const name of RUNTIME_DEPENDENCIES) {
      expect(
        FILE_STRINGS,
        `不得整包排除运行期依赖 ${name}`,
      ).not.toContain(`!node_modules/${name}/**`);
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
      // better-sqlite3 ≥13 改 Node-API 后，二进制位置从 build/Release/better_sqlite3.node
      // 换成包根 prebuilds/<platform>-<arch>.node（解析逻辑见 lib/binding.js 的
      // getPrebuildPath()，lib/win32-x64.js 也直接 require('../prebuilds/win32-x64.node')）。
      // 路径写错不会有任何构建期报错，只在运行期抛 "Cannot locate the bindings file"。
      expect(pattern, `asarUnpack 只允许 better-sqlite3 的 .node: ${pattern}`).toContain(
        "node_modules/better-sqlite3/prebuilds/",
      );
      expect(pattern.endsWith(".node"), `asarUnpack 条目必须以 .node 结尾: ${pattern}`).toBe(true);
    }
  });

  it("排除非本平台的预编译二进制（7 份各 2~3 MiB，本应用只出 win-x64）", () => {
    for (const pattern of [
      "!node_modules/better-sqlite3/prebuilds/darwin-*.node",
      "!node_modules/better-sqlite3/prebuilds/linux-*.node",
      "!node_modules/better-sqlite3/prebuilds/linuxmusl-*.node",
      "!node_modules/better-sqlite3/prebuilds/win32-arm64.node",
    ]) {
      expect(FILE_STRINGS, `build.files 缺少 ${pattern}`).toContain(pattern);
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
