/**
 * 关闭守卫：窗口**真要销毁**之前，先问渲染层一句「还有未保存的改动吗」。
 *
 * 解决的是什么：行囊（CharacterPack）的编辑只落内存 + 草稿，「写库」是显式动作。
 * 只要窗口还在，草稿就是安全的；但窗口一旦销毁 / 应用退出，渲染层连
 * `useEffect` 的 cleanup 都不保证跑完 —— 用户那几分钟的编辑就只剩「草稿最后一版」。
 * 所以退出前必须给一次「保存并退出 / 丢弃 / 取消」的机会（PRD REQ-043）。
 *
 * 三条设计约束（不是随意选的）：
 *
 * 1. **只有「有未保存改动」才拦**。渲染层在脏计数 0→n 时打开这里的开关、
 *    回到 0 时关掉。常态下退出是零往返的 —— 不能因为一个守护把正常的
 *    「关窗即退」变成「每次都要等渲染层回话」。
 * 2. **拦截必须发生在 `before-quit` 的清理之前**。main.ts 的 `before-quit`
 *    会 `closeDb()`；如果在窗口 `close` 时才问，用户慢慢选完，库早关了，
 *    「保存并退出」必然失败。故退出路径在此处先 `preventDefault()` 问完再重退。
 * 3. **渲染层崩了 / 窗口已销毁就必须放行**。守卫状态是渲染层写入的，
 *    渲染层死了没人来清 —— 不留兜底就会变成「应用永远退不出去」。
 */
import { BrowserWindow, ipcMain } from "electron";

/** 渲染层 → 主进程：本窗口是否有未保存改动（布尔） */
const ENABLE_CHANNEL = "window-close-guard";
/** 主进程 → 渲染层：请你确认能不能关（负载 `{ reason }`） */
const REQUEST_CHANNEL = "window-close-request";
/** 渲染层 → 主进程：答复（布尔，true = 放行） */
const RESPONSE_CHANNEL = "window-close-response";

/**
 * 询问超时。渲染层没在时限内答复就按「取消关闭」处理 ——
 * 宁可不退让用户自己再点一次，也不要吞掉他的改动。
 */
const ASK_TIMEOUT_MS = 120_000;

/** 当前有未保存改动的窗口（key = `webContents.id`） */
const armed = new Set<number>();
/** 本轮已获用户放行的窗口：同一个 `close` 流程里不再二次询问 */
const approved = new Set<number>();
/** 在途询问的答复回调（key = `webContents.id`） */
const pending = new Map<number, (allow: boolean) => void>();

function readBoolean(payload: unknown): boolean {
  if (typeof payload === "boolean") return payload;
  if (payload && typeof payload === "object" && "enabled" in payload) {
    return (payload as { enabled: unknown }).enabled === true;
  }
  if (payload && typeof payload === "object" && "allow" in payload) {
    return (payload as { allow: unknown }).allow === true;
  }
  return false;
}

/** 该窗口此刻是否处于「已武装且未放行」状态（已销毁则顺手清掉，防止僵尸状态卡住退出） */
function isArmed(win: BrowserWindow): boolean {
  if (win.isDestroyed()) return false;
  const id = win.webContents.id;
  if (!armed.has(id)) return false;
  if (win.webContents.isDestroyed()) {
    armed.delete(id);
    return false;
  }
  return !approved.has(id);
}

/**
 * 问一个窗口「能关吗」。
 *
 * 窗口可能是隐藏的（主窗 close → 进托盘，用户随后从托盘选「退出」）——
 * 那种情况下不发 `show()` 就等于把弹窗发给了一个看不见的窗口，
 * 表现是「点了退出，应用没反应，也没有任何提示」。
 */
function askWindow(win: BrowserWindow, reason: string): Promise<boolean> {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return Promise.resolve(true);
  const id = win.webContents.id;

  return new Promise<boolean>((resolve) => {
    const settle = (allow: boolean): void => {
      if (!pending.has(id)) return;
      pending.delete(id);
      clearTimeout(timer);
      resolve(allow);
    };
    const timer = setTimeout(() => settle(false), ASK_TIMEOUT_MS);
    pending.set(id, settle);

    if (!win.isVisible()) win.show();
    win.focus();
    win.webContents.send(REQUEST_CHANNEL, { reason });
  });
}

/**
 * 挂到一个窗口上，接管它「真的要销毁」的那一次 `close`。
 *
 * `shouldGuard` 用来区分「隐藏到托盘」和「真销毁」两种 close：主窗形态下
 * 点 X 只是 `hide()`（渲染层还活着，草稿安全，不该弹拦截），只有退出时才拦。
 * 子窗形态（full 版小说窗）即关即销，默认就该拦。
 */
export function attachCloseGuard(
  win: BrowserWindow,
  shouldGuard: () => boolean = () => true,
): void {
  const id = win.webContents.id;

  win.on("close", (event) => {
    if (!shouldGuard() || !isArmed(win)) return;
    event.preventDefault();
    void askWindow(win, "关闭窗口").then((allow) => {
      if (!allow) return;
      approved.add(id);
      if (!win.isDestroyed()) win.close();
    });
  });

  // 渲染层崩了：守卫状态失去意义，就地作废，否则应用永远退不出去
  win.webContents.on("render-process-gone", () => {
    armed.delete(id);
    approved.delete(id);
    pending.get(id)?.(false);
  });

  // 询问期间窗口被藏起来（主窗点 X → 进托盘）= 用户改主意了：本轮询问就地作废。
  // 不作废的话，那个 Promise 一直悬着，「托盘 → 退出」在弹窗答复前会变成空操作。
  win.on("hide", () => {
    pending.get(id)?.(false);
  });

  win.on("closed", () => {
    armed.delete(id);
    approved.delete(id);
    pending.get(id)?.(false);
  });
}

/** 当前是否存在「有未保存改动」的窗口（退出流程用它决定要不要先问） */
export function hasArmedCloseGuard(): boolean {
  return BrowserWindow.getAllWindows().some((win) => isArmed(win));
}

/**
 * 逐个询问所有武装的窗口，全部放行才返回 true。
 *
 * 中途有人选「取消」时，把这一轮已放行的窗口**恢复成未放行** ——
 * 否则退出被取消之后，那个窗口下次点 X 就会静默关掉未保存的改动。
 */
export async function askCloseGuards(reason: string): Promise<boolean> {
  const asked: number[] = [];
  for (const win of BrowserWindow.getAllWindows()) {
    if (!isArmed(win)) continue;
    const id = win.webContents.id;
    asked.push(id);
    const allow = await askWindow(win, reason);
    if (!allow) {
      for (const askedId of asked) approved.delete(askedId);
      return false;
    }
    approved.add(id);
  }
  return true;
}

/** 注册通道（`app.whenReady` 里调一次） */
export function registerCloseGuardHandlers(): void {
  ipcMain.on(ENABLE_CHANNEL, (event, payload: unknown) => {
    const id = event.sender.id;
    if (readBoolean(payload)) {
      armed.add(id);
      // 重新武装时把上一轮的放行结果作废：改动又来了，就得重新问
      approved.delete(id);
    } else {
      armed.delete(id);
      approved.delete(id);
    }
  });

  ipcMain.on(RESPONSE_CHANNEL, (event, payload: unknown) => {
    pending.get(event.sender.id)?.(readBoolean(payload));
  });
}
