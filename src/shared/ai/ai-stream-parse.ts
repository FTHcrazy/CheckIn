/**
 * AI 流式响应解析（M4 / B5）
 *
 * 纯函数：把主进程桥接回来的原始字节流解析成「文本增量」。
 * 支持两种模型服务的流格式：
 * - OpenAI 兼容（SSE）：`data: {"choices":[{"delta":{"content":"..."}}]}\n\n`，
 *   以 `data: ` 开头、空行分帧，末帧 `data: [DONE]`；
 * - Ollama：逐行 JSON，每行 `{"response":"...","done":false}`，末行 `done:true`。
 *
 * 本层不 import novel、不发 IPC、不碰 Key —— 只是把「字节块」变成「文字增量」，
 * 供续写预览逐字渲染（打字机）。
 */

/** 累计解码器：把分片字节块增量解析为文本增量（内部有状态，需按流持有） */
export interface StreamAccumulator {
  /** 喂入一段原始文本（从 TextDecoder 出来的字符串块），返回本次可渲染的增量 */
  push: (chunk: string) => string;
  /** 流结束时调用，冲刷残留缓冲（若有未闭合帧） */
  flush: () => string;
}

/**
 * 创建 OpenAI 兼容（SSE）格式的增量解析器。
 *
 * 分帧规则：以空行（`\n\n`）切帧；帧内取 `data:` 行拼 JSON，取
 * `choices[0].delta.content` 作增量；`data: [DONE]` 表示结束（其后的内容忽略）。
 */
export function createOpenAiSseAccumulator(): StreamAccumulator {
  let buffer = "";
  let finished = false;

  const consumeFrame = (frame: string): string => {
    if (finished) return "";
    let out = "";
    for (const line of frame.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data) continue;
      if (data === "[DONE]") {
        finished = true;
        break;
      }
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const content = json.choices?.[0]?.delta?.content;
        if (typeof content === "string" && content) out += content;
      } catch {
        // 单帧 JSON 解析失败：跳过该帧，不中断整条流
      }
    }
    return out;
  };

  return {
    push(chunk: string): string {
      if (finished) return "";
      buffer += chunk;
      let out = "";
      let idx = buffer.indexOf("\n\n");
      while (idx !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        out += consumeFrame(frame);
        if (finished) {
          buffer = "";
          return out;
        }
        idx = buffer.indexOf("\n\n");
      }
      return out;
    },
    flush(): string {
      if (finished || !buffer.trim()) return "";
      const frame = buffer;
      buffer = "";
      return consumeFrame(frame);
    },
  };
}

/**
 * 创建 Ollama 格式的增量解析器。
 *
 * 每行一个 JSON 对象：`{"response":"...","done":false}`；`done:true` 的末行
 * 表示结束。`response` 字段即本次增量（含换行）。
 */
export function createOllamaAccumulator(): StreamAccumulator {
  let buffer = "";
  let finished = false;

  const consumeLine = (line: string): string => {
    if (finished || !line.trim()) return "";
    try {
      const json = JSON.parse(line) as { response?: string; done?: boolean };
      if (json.done) finished = true;
      return typeof json.response === "string" ? json.response : "";
    } catch {
      return ""; // 单行解析失败：跳过
    }
  };

  return {
    push(chunk: string): string {
      if (finished) return "";
      buffer += chunk;
      let out = "";
      let idx = buffer.indexOf("\n");
      while (idx !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        out += consumeLine(line);
        if (finished) {
          buffer = "";
          return out;
        }
        idx = buffer.indexOf("\n");
      }
      return out;
    },
    flush(): string {
      if (finished || !buffer.trim()) return "";
      const line = buffer;
      buffer = "";
      return consumeLine(line);
    },
  };
}
