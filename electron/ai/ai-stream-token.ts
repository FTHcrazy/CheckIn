/**
 * AI 流式端点的一次性令牌（PRD 红线 C：端点凭证「一次性 + 可失效」）
 *
 * ## 为什么不是校验 Origin
 *
 * 早先的实现在 `protocol.handle` 里读 `request.headers.get("origin")`，只放行
 * `app://` 与 dev 的 localhost。真机日志是这样的：
 *
 * ```text
 * [WARN ] [main] [ai-stream] 拒绝非本应用来源的流式请求:
 * ```
 *
 * 冒号后面是**空的** —— 自定义 scheme 的跨 scheme fetch 压根不发送 `Origin`
 * 请求头（实测端点收到的只有 accept / content-type / user-agent），于是
 * `isTrustedInitiator("")` 恒为 false：每一次续写都被自己的端点拒掉
 * （HTTP 403，响应体一句英文 `Forbidden`，直接显示给作者）。
 * dev 下页面 origin 是 `http://localhost:5173`，恰好命中放行分支，所以这个
 * 缺陷在开发期完全看不见。
 *
 * 顺带记一笔：Electron 原生字段 `request.initiatorOrigin`（本版本实测有值，
 * 如 `app://checkin`）才是「谁发起的」的正当来源；`Origin` 请求头不是。
 * 但它只写进拒绝日志，**不参与放行** —— 放行只认令牌，令牌不依赖页面
 * origin 的形态，不会再因为换加载方式（app:// 文件 / dev server）而失效。
 *
 * ## 现在的口径
 *
 * 1. 渲染层每次发起流式请求前，经 `ai-stream-token` IPC 领一张 32 字节随机令牌；
 * 2. 主进程在端点第一行核销：命中即删（**单次有效**，重放无效）；
 * 3. 令牌表只在主进程内存里，外部页面拿不到（它连 preload 都碰不到），
 *    渲染层也拿不到「别人的」令牌（每次现领现用）。
 *
 * 令牌不是密钥：它不携带任何凭据，泄漏了也只能换来一次「已核销」的空洞，
 * Key 依旧只在主进程内解密后注入 header（红线 C 不变）。
 */
import { randomBytes } from "node:crypto";

/**
 * 令牌有效期：从 IPC 领取到真正发出 fetch 只有几毫秒（同进程内的两跳），
 * 60s 是给「窗口被切到后台 / 事件循环被长任务占住」留的余量。
 */
const TOKEN_TTL_MS = 60_000;

/**
 * 未核销令牌的数量上限。正常路径上一领一销，表恒为空；上限只防
 * 「领了令牌但请求没发出去」（fetch 被同步异常打断、窗口在 IPC 后立即销毁）
 * 这类漏网情形让 Map 无界增长。
 */
const MAX_PENDING_TOKENS = 64;

/** token → 过期时间戳（Map 迭代顺序 = 插入顺序，淘汰取最早的） */
const pending = new Map<string, number>();

function pruneExpired(now: number): void {
  for (const [token, expiresAt] of pending) {
    if (expiresAt <= now) pending.delete(token);
  }
}

/**
 * 领取一张一次性令牌。由 `ai-handlers.ts` 的 `ai-stream-token` 通道调用。
 *
 * `now` 只为单测注入，生产路径不传。
 */
export function issueAiStreamToken(now: number = Date.now()): string {
  pruneExpired(now);
  while (pending.size >= MAX_PENDING_TOKENS) {
    const oldest = pending.keys().next();
    if (oldest.done) break;
    pending.delete(oldest.value);
  }
  const token = randomBytes(32).toString("hex");
  pending.set(token, now + TOKEN_TTL_MS);
  return token;
}

/**
 * 核销令牌：命中即删除，返回是否有效。
 *
 * 无论是否过期都删除 —— 过期令牌留着没有任何用途，只会占住上限名额。
 * 端点在核销失败时返回 403（见 `ai-stream.ts`）。
 */
export function consumeAiStreamToken(
  token: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!token) return false;
  const expiresAt = pending.get(token);
  if (expiresAt === undefined) return false;
  pending.delete(token);
  return expiresAt > now;
}

/** 仅供单测：清空令牌表（生产代码不得调用，否则会误伤在途请求） */
export function resetAiStreamTokens(): void {
  pending.clear();
}
