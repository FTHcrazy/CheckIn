/**
 * 页面级 HTTP client
 *
 * 组件卸载时自动中断该页面发起的全部在途请求，
 * 避免页面来回切换时堆积无人关心的请求（各窗口/页面彼此隔离）。
 */

import { useEffect, useMemo } from "react";
import {
  createHttpClient,
  type HttpClient,
  type HttpClientConfig,
} from "./client";

export function useHttpClient(config?: HttpClientConfig): HttpClient {
  // client 只创建一次：config 每次渲染都是新对象，不应触发重建
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const client = useMemo(() => createHttpClient(config), []);

  useEffect(() => () => client.abortAll("unmount"), [client]);

  return client;
}
