/**
 * `app://` 缓存策略单测。
 *
 * 分两部分：
 * - 纯函数行为（`isHashedAssetPath` / `resolveAppProtocolCacheControl`）——用例直接
 *   取 `dist/` 里的真实产物文件名，防止 vite 改哈希长度 / 字符集后策略静默失效。
 * - 源码守卫——协议处理器挂在 Electron 主进程上（`protocol.handle`），vitest 跑不了
 *   真实请求，只能钉住「缓存头被写进响应」与「app scheme 开了 V8 代码缓存」两条
 *   容易被顺手删掉的不变量。同先例 `pack-window-guards.test.ts`。
 *
 * ⚠️ `codeCache: true` 是自定义 scheme 写 V8 字节码缓存的前提（Chromium 默认只对
 * http(s) 开启）；删掉它不会报错，只是功能窗口的「执行层」耗时悄悄回到原点。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DYNAMIC_FILE_CACHE_CONTROL,
  HASHED_ASSET_CACHE_CONTROL,
  isHashedAssetPath,
  resolveAppProtocolCacheControl,
} from "./app-protocol-cache";

const MAIN = readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");

describe("哈希资产判定", () => {
  it("识别真实产物文件名（含 base64url 的 `-` / `_`）", () => {
    expect(isHashedAssetPath("assets/antd-BW5-K5RM.js")).toBe(true);
    expect(isHashedAssetPath("assets/antd-B5BXDqMa.css")).toBe(true);
    expect(isHashedAssetPath("assets/themes-Z_G_STkm.css")).toBe(true);
    expect(isHashedAssetPath("assets/rolldown-runtime-Cyuzqnbw.js")).toBe(true);
    // 哈希段自身含连字符，必须整体吃掉而不能被前一个 `-` 截断
    expect(isHashedAssetPath("assets/vendor-BH1R-mb2.js")).toBe(true);
    expect(isHashedAssetPath("assets/pack-CKL2LKHy.js")).toBe(true);
  });

  it("固定文件名资源一律不算哈希资产", () => {
    expect(isHashedAssetPath("src/windows/BaseWindow/index.html")).toBe(false);
    expect(isHashedAssetPath("src/windows/PackWindow/index.html")).toBe(false);
    expect(isHashedAssetPath("favicon.svg")).toBe(false);
    expect(isHashedAssetPath("icon.ico")).toBe(false);
    expect(isHashedAssetPath("icons.svg")).toBe(false);
    expect(isHashedAssetPath("tray/tray.png")).toBe(false);
  });

  it("HTML 即使带哈希后缀也不 immutable（URL 由主进程写死，不随内容变化）", () => {
    expect(isHashedAssetPath("src/windows/BaseWindow/index-a1b2c3d4.html")).toBe(false);
  });

  it("剥掉查询段后判定（登录入口带 ?email=… ，不能影响资源本身的分档）", () => {
    expect(isHashedAssetPath("assets/pack-CKL2LKHy.js?v=2")).toBe(true);
    expect(isHashedAssetPath("src/windows/LoginWindow/index.html?email=a%40b.c")).toBe(false);
  });

  it("兼容前导斜杠 / 反斜杠 / 空值", () => {
    expect(isHashedAssetPath("/assets/pack-CKL2LKHy.js")).toBe(true);
    expect(isHashedAssetPath("assets\\pack-CKL2LKHy.js")).toBe(true);
    expect(isHashedAssetPath("")).toBe(false);
    expect(isHashedAssetPath("assets/")).toBe(false);
  });

  it("resolveAppProtocolCacheControl 按档返回对应头值", () => {
    expect(resolveAppProtocolCacheControl("assets/antd-BW5-K5RM.js")).toBe(
      HASHED_ASSET_CACHE_CONTROL,
    );
    expect(resolveAppProtocolCacheControl("src/windows/BaseWindow/index.html")).toBe(
      DYNAMIC_FILE_CACHE_CONTROL,
    );
    expect(HASHED_ASSET_CACHE_CONTROL).toMatch(/immutable/);
    expect(DYNAMIC_FILE_CACHE_CONTROL).toBe("no-store");
  });
});

describe("dist 产物与策略一致性（构建产物存在时校验）", () => {
  const assetsDir = path.resolve(process.cwd(), "dist/assets");

  it("dist/assets 下的产物文件名都能被识别为哈希资产（自证正则字符集 / 长度）", () => {
    // 没有构建产物时跳过：单测不应强依赖一次 build。
    if (!existsSync(assetsDir)) {
      console.warn("[app-protocol-cache] dist/assets 不存在，跳过动态扫描");
      return;
    }
    const entries = readdirSync(assetsDir).filter((f) => !f.endsWith(".html"));
    // 必须有足量的真实产物，避免「目录空 → 用例 vacuously 通过」。
    expect(entries.length).toBeGreaterThan(10);
    for (const file of entries) {
      expect(isHashedAssetPath(`assets/${file}`)).toBe(true);
    }
  });
});

describe("app:// 协议接入守卫", () => {
  it("协议响应写入 Cache-Control", () => {
    const start = MAIN.indexOf('protocol.handle("app"');
    expect(start).toBeGreaterThan(-1);
    const body = MAIN.slice(start, start + 1200);
    expect(body).toMatch(/"Cache-Control":\s*resolveAppProtocolCacheControl\(/);
  });

  it("app scheme 开启 V8 代码缓存（自定义 scheme 默认不写字节码缓存）", () => {
    const start = MAIN.indexOf("protocol.registerSchemesAsPrivileged");
    expect(start).toBeGreaterThan(-1);
    const body = MAIN.slice(start, start + 600);
    expect(body).toMatch(/codeCache:\s*true/);
    expect(body).toMatch(/standard:\s*true/);
  });

  it("渲染侧 createWebPreferences 跳过 V8 码缓存热度判断（配套 scheme 侧 codeCache）", () => {
    // scheme 侧 codeCache 默认只对「足够热」的脚本生效，本应用窗口即关即销，
    // 启发式大概率不满足 → 必须由渲染侧 bypassHeatCheck 兜底，否则 codeCache 空转。
    const start = MAIN.indexOf("function createWebPreferences");
    expect(start).toBeGreaterThan(-1);
    const body = MAIN.slice(start, start + 900);
    expect(body).toMatch(/v8CacheOptions:\s*"bypassHeatCheck"/);
  });
});
