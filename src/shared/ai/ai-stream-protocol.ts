/**
 * `ai-stream://` 内部端点的协议常量（**唯一产地**）。
 *
 * 主进程（`electron/handlers/ai-stream.ts` 的 `protocol.handle`）与渲染层
 * （`src/shared/ai/ai-client.ts` 的 fetch）必须用同一套 scheme / host / path /
 * 请求头名。此前两侧各写一份靠注释「保持一致」，改一处漏一处时的表现是
 * 「请求打到 404 或令牌头名漂移 → 静默 403」，排查成本极高。
 *
 * 这里只放字符串常量：不 import 任何模块（主进程与渲染层都安全），
 * 也不含任何业务/DOM 依赖。
 */

/** 内部端点 scheme（须与 main.ts 的 registerSchemesAsPrivileged 一致） */
export const AI_STREAM_SCHEME = "ai-stream";
/** 内部端点 host */
export const AI_STREAM_HOST = "local";
/** 渲染层 fetch 的完整 origin */
export const AI_STREAM_ORIGIN = `${AI_STREAM_SCHEME}://${AI_STREAM_HOST}`;
/** 端点路径（主进程只服务这一个路径，其余一律 404） */
export const AI_STREAM_PATH = "/api/chat";
/**
 * 一次性令牌请求头。
 *
 * ⚠️ 端点身份**只能**靠它判定：自定义 scheme 的 fetch 不带 `Origin`
 * （详见 `electron/ai-stream-token.ts` 顶部注释）。
 */
export const AI_STREAM_TOKEN_HEADER = "x-ai-stream-token";
