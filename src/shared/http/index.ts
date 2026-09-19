/**
 * 窗口级 client 作用域
 *
 * 每个渲染进程（= 每个窗口）拥有独立的 client 实例集合：
 * 同一套标准、互不影响，某个页面的请求风暴不会波及同窗口其他页面，
 * 也不会传导到主进程。
 */

import { createHttpClient, type HttpClient, type HttpClientConfig } from "./client";

const registry = new Map<string, HttpClient>();

/**
 * 取指定作用域的 client（同名 scope 复用同一实例）。
 * 业务层按模块/页面划分 scope，如 "news" / "git" / "daily"。
 */
export function getScopedHttpClient(
  scope: string,
  config?: HttpClientConfig,
): HttpClient {
  const existing = registry.get(scope);
  if (existing) return existing;
  const client = createHttpClient(config);
  registry.set(scope, client);
  return client;
}

/** 中断某作用域的全部在途请求（窗口关闭 / 页面切换时调用） */
export function abortScope(scope: string, reason?: string): void {
  registry.get(scope)?.abortAll(reason);
}

/** 中断所有作用域的在途请求 */
export function abortAllScopes(reason?: string): void {
  for (const client of registry.values()) client.abortAll(reason);
}

export * from "./client";
export { ensureSessionCookie } from "./sessionCookie";
