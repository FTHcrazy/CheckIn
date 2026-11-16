import { describe, expect, it } from "vitest";
import {
  createOllamaAccumulator,
  createOpenAiSseAccumulator,
} from "./ai-stream-parse";

describe("createOpenAiSseAccumulator（OpenAI 兼容 SSE 解析）", () => {
  it("把分帧的 data 增量拼接成文本", () => {
    const acc = createOpenAiSseAccumulator();
    let out = "";
    out += acc.push('data: {"choices":[{"delta":{"content":"你"}}]}\n\n');
    out += acc.push('data: {"choices":[{"delta":{"content":"好"}}]}\n\n');
    out += acc.push('data: {"choices":[{"delta":{"content":"。"}}]}\n\n');
    out += acc.push("data: [DONE]\n\n");
    expect(out).toBe("你好。");
  });

  it("跨块分帧：一个 data 帧被拆成两次 push 也能正确解析", () => {
    const acc = createOpenAiSseAccumulator();
    // 第一块只给半截帧，第二块补全
    let out = acc.push('data: {"choices":[{"delta":{"content":"续');
    out += acc.push('写"}}]}\n\n');
    expect(out).toBe("续写");
  });

  it("[DONE] 之后不再产出（忽略后续残留）", () => {
    const acc = createOpenAiSseAccumulator();
    let out = acc.push('data: {"choices":[{"delta":{"content":"正文"}}]}\n\n');
    out += acc.push("data: [DONE]\n\n");
    out += acc.push('data: {"choices":[{"delta":{"content":"不该出现"}}]}\n\n');
    expect(out).toBe("正文");
  });

  it("空 delta / 非 data 行 / 坏 JSON 均跳过，不中断流", () => {
    const acc = createOpenAiSseAccumulator();
    let out = "";
    out += acc.push(": ping\n\n");
    out += acc.push("data: {broken json}\n\n");
    out += acc.push('data: {"choices":[{"delta":{"content":"好"}}]}\n\n');
    expect(out).toBe("好");
  });

  it("flush 冲刷未闭合帧（末尾缺空行）", () => {
    const acc = createOpenAiSseAccumulator();
    let out = acc.push('data: {"choices":[{"delta":{"content":"结尾"}}]}');
    out += acc.flush();
    expect(out).toBe("结尾");
  });
});

describe("createOllamaAccumulator（Ollama 逐行 JSON 解析）", () => {
  it("逐行拼接 response 字段", () => {
    const acc = createOllamaAccumulator();
    let out = "";
    out += acc.push('{"response":"第一","done":false}\n');
    out += acc.push('{"response":"句","done":false}\n');
    out += acc.push('{"response":"。","done":true}\n');
    expect(out).toBe("第一句。");
  });

  it("跨块拆行也能正确解析", () => {
    const acc = createOllamaAccumulator();
    let out = acc.push('{"response":"拆');
    out += acc.push('行","done":false}\n');
    expect(out).toBe("拆行");
  });

  it("done:true 后不再产出", () => {
    const acc = createOllamaAccumulator();
    let out = acc.push('{"response":"正文","done":false}\n');
    out += acc.push('{"response":"","done":true}\n');
    out += acc.push('{"response":"不该出现","done":false}\n');
    expect(out).toBe("正文");
  });
});
