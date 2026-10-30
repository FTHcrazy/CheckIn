/**
 * 导出 PNG 两条主进程通道的源码守卫（R27 / S5，RG-X 系列）
 *
 * 导出是「不报错但图坏了」的高发区，四条约束都必须源码钉死，因为运行时
 * 你只会拿到一个「看起来成功、打开是黑图 / 打不开」的结果：
 *
 * ① 二进制落盘走**独立通道** `novel-export-binary`，绝不复用 `novel-export-file`
 *    （那条是 `writeFile(path, content, "utf8")`，用文本写 PNG = 图坏且零报错）；
 * ② `writeFile` 调用**不带 encoding**（带了等于又变成文本写二进制）；
 * ③ 截图有「判空 + 重试 3 次 + 最小字节兜底」——首帧为空是 Electron 生态已知抖动；
 * ④ 最小化时 `restore()` 一次，兜底「恢复后立刻点导出」撞上的空图。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HANDLER = readFileSync(
  resolve(process.cwd(), "electron/handlers/novel-export-handlers.ts"),
  "utf8",
);
/** 剥掉注释后的源码，专供否定断言（注释里点名了 utf8 通道是为了解释为什么不复用） */
const HANDLER_CODE = HANDLER.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /(^|[^:])\/\/[^\n]*/g,
  "$1",
);
const PRELOAD = readFileSync(resolve(process.cwd(), "electron/preload.ts"), "utf8");
const MAIN = readFileSync(resolve(process.cwd(), "electron/main.ts"), "utf8");

describe("通道归属", () => {
  it("二进制落盘走独立的 novel-export-binary，不碰 novel-export-file 的 utf8 通道", () => {
    expect(HANDLER_CODE).toContain('"novel-export-binary"');
    // 这条 handler 里绝不该出现文本导出通道名（复用它 = 图坏且零报错）
    expect(HANDLER_CODE).not.toContain("novel-export-file");
  });

  it("取景走 relation-window-export（只有 capturePage 能截用户眼前那一帧）", () => {
    expect(HANDLER_CODE).toContain('"relation-window-export"');
    expect(HANDLER_CODE).toContain("capturePage");
  });

  it("main.ts 注册了这条 handler", () => {
    expect(MAIN).toContain("registerNovelExportHandlers()");
  });
});

describe("二进制写入的硬约束", () => {
  it("writeFile 不带 encoding（带 utf8 就是按文本写二进制）", () => {
    // 找 writeFile 调用，断言调用后紧跟的参数里没有第三/第四个 string 参数
    expect(HANDLER_CODE).toContain("fsp.writeFile(result.filePath, buffer)");
    // 全文件（除注释）不允许出现 writeFile 带 encoding 的形态
    expect(HANDLER_CODE).not.toMatch(/writeFile\([^)]*,\s*["'](utf8|utf-8)["']/);
  });

  it("只收字节：toBuffer 只认 Uint8Array / ArrayBuffer，空 buffer 不弹框", () => {
    expect(HANDLER_CODE).toContain("instanceof Uint8Array");
    expect(HANDLER_CODE).toContain("instanceof ArrayBuffer");
    expect(HANDLER_CODE).toContain("buffer.byteLength === 0");
  });
});

describe("空图兜底（Electron 首帧为空是已知抖动）", () => {
  it("判空 + 重试 3 次 + 每次间隔等合成器出新帧", () => {
    expect(HANDLER_CODE).toContain("CAPTURE_ATTEMPTS = 3");
    expect(HANDLER_CODE).toContain("CAPTURE_RETRY_DELAY_MS = 90");
    expect(HANDLER_CODE).toContain("isEmpty()");
  });

  it("纯色帧不是空图：用最小字节数兜第二道（不只看 isEmpty）", () => {
    expect(HANDLER_CODE).toContain("MIN_PNG_BYTES");
    expect(HANDLER_CODE).toContain("byteLength < MIN_PNG_BYTES");
  });

  it("最小化时 restore 一次，兜底「恢复后立刻点导出」", () => {
    expect(HANDLER_CODE).toContain("isMinimized()");
    expect(HANDLER_CODE).toContain("restore()");
  });
});

describe("preload 通路", () => {
  it("captureWindow 走 relation-window-export，exportBinary 走 novel-export-binary", () => {
    expect(PRELOAD).toContain("'relation-window-export'");
    expect(PRELOAD).toContain("'novel-export-binary'");
  });
});
