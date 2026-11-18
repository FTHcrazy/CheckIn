/**
 * ⚠️ 兼容薄壳（T02）：真正的折叠在 `./index`。
 *
 * 为什么保留：`promptVersionOf` 被 `electron/handlers/ai/ai-handlers.ts:28` 直接引用
 * （主进程不能反向依赖渲染层的桶文件），另有 3 个测试从本路径 import。
 * 一个版本内保持路径可用，下一版统一改到 `@/shared/ai/context/prompt` 后删除。
 *
 * **新代码不要往这里加东西**，直接 import `./index`。
 */
export {
  AI_INTENT_LABELS,
  PROMPT_BUILDERS,
  PROMPT_INTENTS,
  PROMPT_VERSIONS,
  buildPromptSpec,
  promptVersionOf,
  type PromptContextOf,
  type PromptIntent,
  type PromptIntentMap,
  type PromptPayloadOf,
} from "./index";
