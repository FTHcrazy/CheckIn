/**
 * Git Webhook 日志查询接口
 *
 * 请求在渲染进程内直接发出（统一走 shared/http 客户端）。
 * 认证 Cookie 由 ensureSessionCookie 一次性写入 session jar，
 * 请求带 credentials:'include' 自动携带 —— 主进程不参与请求链路。
 */

import { ensureSessionCookie, getScopedHttpClient } from "@/shared/http";

const BASE_URL = "https://elf.smart.cn/rest/r";

/** Cookie 播种的作用域（按域名而非接口路径，覆盖该域名下所有请求） */
const COOKIE_URL = new URL(BASE_URL).origin;

/** 查询参数 */
interface GitWebhookLogQuery {
  pageSize?: number;
  page?: number;
  orderBy?: string;
  query?: {
    "email.like"?: string;
    "commitTime.gte"?: string;
    "commitTime.lte"?: string;
  };
}

/** 单条提交记录 */
export interface GitWebhookLogItem {
  id: string;
  author: string;
  email: string;
  commitTime: string;
  comments: string;
  branch: string;
  hash: string;
  projectName: string;
  repositoryName: string;
  teamName: string;
  insertions: string;
  deletions: string;
  fileChanges: string;
  effective: string;
  project: string;
  repository: string;
}

/** 分页信息 */
export interface PageInfo {
  pageNum: number;
  pageSize: number;
  total: number;
  pages: number;
  list: GitWebhookLogItem[];
}

/** 接口响应 */
export interface GitWebhookLogResponse {
  gitwebhooklog: {
    pageInfo: PageInfo;
    queryParam: Record<string, unknown>;
  };
  result: string;
}

/** 认证 Cookie（token 过期后需更新） */
const AUTH_COOKIE = [
  "cep_language_uat-dc=zh-CN",
  "sidebar_status_uat-dc=closed",
  "cep_access_token_dcs_uat-dc=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIyIiwiZW50cnkiOiJhcGkiLCJleHBpcmVzIjo3MjAwLCJjb2RlIjoi57O757uf566h55CG5ZGYLTEiLCJyb2xlcyI6WzIsMTExNSwxMTMxLDExMzUsMTEzOSwxMTUxLDExOTEsMTIzNywxMjU0LDEyNTUsMTI4NCwxMzIyLDEzMjMsMTMyNCwxMzMzLDEzMzUsMTMzNywxMzU5LDEzODMsMTM5NywxNDEyLDE0MTQsMTQyMSwxNDQ3LDE0NDksMTQ1MiwxNDU0LDE0NTUsMTQ1Nl0sImlzcyI6IlhTVEFSVFVQIiwibmFtZSI6Iuezu-e7n-euoeeQhuWRmC0xIiwiZXhwIjoxNzgyMjcyNzYyLCJpYXQiOjE3ODIyNjU1NjIsIm9yZ0lkIjo3ODg3NjAsImFjY291bnQiOiLns7vnu5_nrqHnkIblkZgtMSIsInVuaXF1ZUlkIjoiMDUyMzQxNzM3NWRlNGY2ZGFkZTliMDAzMjczYjIwYTAifQ.xXJakDj-_-wN3znldsfhcfsQV4d8oWzZVgH6GW9F5QM",
].join("; ");

/** Git 接口专用 client：携带 session cookie，作用域与资讯接口隔离 */
const http = getScopedHttpClient("git", {
  baseURL: BASE_URL,
  timeout: 15_000,
  retry: 1,
  credentials: "include",
  headers: {
    Accept: "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
  },
});

/**
 * 查询 Git Webhook 提交日志
 *
 * @param email    邮箱（模糊匹配），默认当前用户
 * @param dateFrom 开始时间，格式 "2026/6/24 00:00:00"
 * @param dateTo   结束时间，格式 "2026/6/24 23:59:59"
 * @param page     页码，默认 1
 * @param pageSize 每页条数，默认 9999
 */
export async function fetchGitWebhookLogs(
  email: string = "e-tiehan.fang@smart.com",
  dateFrom: string,
  dateTo: string,
  page: number = 1,
  pageSize: number = 9999,
): Promise<GitWebhookLogResponse> {
  const body: { gitwebhooklog: GitWebhookLogQuery } = {
    gitwebhooklog: {
      pageSize,
      page,
      orderBy: "commitTime desc",
      query: {
        "email.like": `%${email}%`,
        "commitTime.gte": dateFrom,
        "commitTime.lte": dateTo,
      },
    },
  };

  // Cookie 是浏览器 forbidden request header，渲染进程 fetch 无法手动设置：
  // 先一次性播种到 session jar，再用 credentials:'include' 让网络栈自动携带。
  await ensureSessionCookie(COOKIE_URL, AUTH_COOKIE);

  const res = await http.post<GitWebhookLogResponse>("/gitwebhooklog", body);

  if (!res.ok) {
    throw new Error(`请求失败: ${res.status}`);
  }

  return res.data;
}
