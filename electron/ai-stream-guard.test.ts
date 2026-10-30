/**
 * AI 流式生成守卫（B5 / M4）
 *
 * 钉住 B5 判据的三条不变量，防止流式能力悄悄回退：
 * 1. 流式请求 `stream: true`（否则退化成一次性返回，逐字输出无从谈起）；
 * 2. 端点 URL 与 body 不含 Key（Key 只在 Authorization header / 本地 Ollama
 *    无需 Key，§8.7 豁免的安全精神）；
 * 3. 中断能力存在：渲染层 AbortController + 主进程协议端点，中断后连接释放。
 * 4. 端点身份靠**一次性令牌**（PRD 红线 C），不得退回按 `Origin` 判定 ——
 *    自定义 scheme 的 fetch 不带该头，判了就是「自己拒自己」（2.10.4 事故）。
 *
 * 为什么用源码断言：protocol.handle + net.fetch 的流式桥接依赖 Electron 运行
 * 时，vitest（node 进程）下无法起真实流；把「不变量」钉在源码上最省。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const STREAM_EP = readFileSync(
  path.resolve(process.cwd(), "electron/handlers/ai-stream.ts"),
  "utf8",
);
const AI_HANDLERS = readFileSync(
  path.resolve(process.cwd(), "electron/handlers/ai-handlers.ts"),
  "utf8",
);
const AI_CLIENT = readFileSync(
  path.resolve(process.cwd(), "src/shared/ai/ai-client.ts"),
  "utf8",
);
const PRELOAD = readFileSync(path.resolve(process.cwd(), "electron/preload.ts"), "utf8");
const PROTOCOL = readFileSync(
  path.resolve(process.cwd(), "src/shared/ai/ai-stream-protocol.ts"),
  "utf8",
);
const MAIN = readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");

describe("AI 流式端点（B5 判据）", () => {
  it("流式请求构造带 stream: true（非流式退化的守卫）", () => {
    // buildStreamRequest 两路（OpenAI / Ollama）都显式 stream: true
    const matches = AI_HANDLERS.match(/stream:\s*true/g);
    expect(matches && matches.length).toBeGreaterThanOrEqual(2);
  });

  it("流式端点 URL 与 body 不含 Key（Key 只在 header）", () => {
    // buildStreamRequest 返回的 url 是 `${endpoint}/chat/completions` 或
    // `${base}/api/generate`，不含 apiKey / Authorization
    expect(AI_HANDLERS).toMatch(/url:\s*`\$\{endpoint\}\/chat\/completions`/);
    expect(AI_HANDLERS).toMatch(/url:\s*`\$\{base\}\/api\/generate`/);
    // Authorization 只在 header（OpenAI），不在 URL / body
    expect(AI_HANDLERS).toMatch(/Authorization:\s*`Bearer \$\{cfg\.apiKey\}`/);
  });

  it("流式端点只认一次性令牌，且不得退回按 Origin 判定", () => {
    // 认证方式：核销令牌（语义见 ai-stream-token.test.ts）
    expect(STREAM_EP).toContain("consumeAiStreamToken");
    expect(STREAM_EP).toContain("AI_STREAM_TOKEN_HEADER");
    // 拒绝分支仍在（缺令牌 → 403）
    expect(STREAM_EP).toContain("403");
    // 反向断言：Origin 不能作为放行依据 —— 自定义 scheme 的 fetch 不带该头，
    // 早先的 isTrustedInitiator 让每次续写都 403（2.10.4 真机事故）
    expect(STREAM_EP).not.toContain("isTrustedInitiator");
    expect(STREAM_EP).not.toMatch(/startsWith\("app:\/\/"\)/);
  });

  it("令牌通道贯通：主进程发放 → preload 暴露 → 渲染层随请求头下发", () => {
    // 主进程注册发放通道
    expect(AI_HANDLERS).toContain('ipcMain.handle("ai-stream-token"');
    expect(AI_HANDLERS).toContain("issueAiStreamToken");
    // preload 暴露语义化入口
    expect(PRELOAD).toContain("'ai-stream-token'");
    // 渲染层每次发起前现领（不得缓存成模块级常量复用）
    expect(AI_CLIENT).toContain("streamToken()");
    expect(AI_CLIENT).toContain("[AI_STREAM_TOKEN_HEADER]: token");
  });

  it("渲染层 aiGenerateStream 暴露中断能力（AbortController）", () => {
    expect(AI_CLIENT).toContain("AbortController");
    expect(AI_CLIENT).toContain("abort");
    // 端点地址与主进程同源（产地：ai-stream-protocol.ts），不再各写一份字面量
    expect(AI_CLIENT).toContain("AI_STREAM_ORIGIN");
    expect(PROTOCOL).toContain('export const AI_STREAM_SCHEME = "ai-stream"');
    expect(PROTOCOL).toContain('export const AI_STREAM_HOST = "local"');
  });

  it("main.ts 注册 ai-stream scheme 与流式端点", () => {
    expect(MAIN).toContain('scheme: "ai-stream"');
    expect(MAIN).toContain("registerAiStreamEndpoint");
  });
});
