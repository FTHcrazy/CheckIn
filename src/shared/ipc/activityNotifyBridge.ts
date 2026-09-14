/**
 * 窗口级 IPC 桥接：把主进程推送的 'activity-notify' 转发为窗口内 CustomEvent。
 * 仅由需要活动提醒的窗口入口显式调用一次，避免模块副作用扩散到其他窗口。
 */
export interface ActivityNotifyData {
  name: string;
  start: string;
  end: string;
  color: string;
}

let registered = false;

export function registerActivityNotifyBridge(): void {
  if (registered || !window.electronAPI) return;
  registered = true;

  window.electronAPI.receive("activity-notify", (data: unknown) => {
    window.dispatchEvent(
      new CustomEvent("activity-notify", { detail: data }),
    );
  });
}
