/**
 * 每日打卡服务：封装打卡 IPC，提供语义化 API
 *
 * 页面与组件不直接触碰 window.electronAPI，统一走这里；
 * 业务日切分（次日 5 点重置）在主进程完成，渲染层只消费结果。
 */
import type { CheckinResultDTO, CheckinStatusDTO } from "@/shared/types/electron";

/** 非 Electron 环境（如单测/浏览器预览）下给出可读提示，避免 undefined 调用 */
function getCheckinApi() {
  const api = window.electronAPI?.checkin;
  if (!api) throw new Error("当前环境不支持打卡，请在客户端中使用");
  return api;
}

/** 查询当前业务日打卡状态（挂载时拉取 + 跨过 resetAt 后重拉） */
export function getCheckinStatus(): Promise<CheckinStatusDTO> {
  return getCheckinApi().status();
}

/** 为当前业务日打卡（幂等，重复打卡返回 created: false） */
export function submitCheckin(): Promise<CheckinResultDTO> {
  return getCheckinApi().today();
}

/** 区间内已打卡的业务日集合（闭区间，YYYY-MM-DD） */
export async function getCheckinDates(start: string, end: string): Promise<Set<string>> {
  const dates = await getCheckinApi().dates(start, end);
  return new Set(dates);
}
